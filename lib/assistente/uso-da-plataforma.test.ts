/**
 * O USO DO ASSISTENTE PARA A PLATAFORMA: quem destoa.
 *
 * O destaque é um aviso, não um bloqueio. Aqui se mede o critério (número
 * absoluto e múltiplo da mediana), que chave ruim cai no padrão, e que a rota
 * só responde à equipe da plataforma.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail } from "@/lib/api/wrappers";

const instalacao = vi.hoisted(() => ({ valores: {} as Record<string, string> }));
const banco = vi.hoisted(() => ({ uso: [] as Record<string, unknown>[], erro: false, consultas: 0 }));

vi.mock("@/lib/instalacao/config", () => ({
  valorDaInstalacao: vi.fn(async (chave: string) => ({ valor: instalacao.valores[chave] ?? null, fonte: "nenhuma" })),
}));
vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: vi.fn(),
  falhaDaEscritaDePlatformAdmin: (_erro: unknown, requestId: string) => fail("forbidden", "Só a equipe da plataforma.", 403, { requestId }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (nome: string) => {
      banco.consultas += 1;
      if (nome !== "fn_assistente_uso_do_mes") throw new Error(`rpc inesperada: ${nome}`);
      return banco.erro ? { data: null, error: { message: "fora" } } : { data: banco.uso, error: null };
    },
    from: () => ({
      select: () => ({
        in: async (_c: string, ids: string[]) => {
          banco.consultas += 1;
          return { data: ids.map((id) => ({ id, display_name: `Empresa ${id}`, slug: `empresa-${id}` })), error: null };
        },
      }),
    }),
  }),
}));

import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";

import { criterioDeAlerta, marcarQuemDestoa, mediana, type UsoDaOrganizacao } from "./uso-da-plataforma";

const { GET } = await import("@/app/api/v1/admin/assistente/uso/route");

const uso = (id: string, mensagens: number): UsoDaOrganizacao => ({
  organization_id: id,
  mensagens,
  tokens_de_entrada: mensagens * 100,
  tokens_de_saida: mensagens * 20,
  falhas: 0,
  usuarios: 1,
});
const PADRAO = { mensagens: 1000, multiplo: 5 };

beforeEach(() => {
  instalacao.valores = {};
  banco.uso = [];
  banco.erro = false;
  banco.consultas = 0;
  vi.mocked(requirePlatformAdmin).mockReset();
  vi.mocked(requirePlatformAdmin).mockResolvedValue({ user: { id: "equipe" } } as never);
});

describe("mediana", () => {
  it("ímpar, par e vazio", () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 2, 3])).toBe(2.5);
    expect(mediana([])).toBe(0);
  });
});

describe("quem destoa", () => {
  it("ninguém destoa quando o uso é parecido (controle)", () => {
    const r = marcarQuemDestoa([uso("a", 60), uso("b", 80), uso("c", 70)], PADRAO);
    expect(r.every((x) => !x.destoa)).toBe(true);
  });

  it("acima do número absoluto destoa, mesmo sozinha", () => {
    const r = marcarQuemDestoa([uso("a", 1000)], PADRAO);
    expect(r[0]).toMatchObject({ destoa: true, motivo: "acima_do_numero" });
    expect(marcarQuemDestoa([uso("a", 999)], PADRAO)[0]!.destoa).toBe(false);
  });

  it("cinco vezes a mediana destoa; quatro vezes e meia, não", () => {
    const base = [uso("b", 20), uso("c", 20), uso("d", 20)];
    expect(marcarQuemDestoa([uso("a", 100), ...base], PADRAO).find((x) => x.organization_id === "a")).toMatchObject({
      destoa: true,
      motivo: "acima_da_mediana",
    });
    expect(marcarQuemDestoa([uso("a", 89), ...base], PADRAO).find((x) => x.organization_id === "a")!.destoa).toBe(false);
  });

  it("com menos de três empresas usando, a mediana não decide nada", () => {
    const r = marcarQuemDestoa([uso("a", 900), uso("b", 1)], PADRAO);
    expect(r.every((x) => !x.destoa)).toBe(true);
  });

  it("uso baixo não destoa por ser 'muitas vezes' quase nada", () => {
    const r = marcarQuemDestoa([uso("a", 40), uso("b", 1), uso("c", 1), uso("d", 1)], PADRAO);
    expect(r.find((x) => x.organization_id === "a")!.destoa).toBe(false);
  });

  it("vem ordenado do maior uso para o menor", () => {
    expect(marcarQuemDestoa([uso("a", 5), uso("b", 50), uso("c", 20)], PADRAO).map((x) => x.organization_id)).toEqual(["b", "c", "a"]);
  });
});

describe("o critério vem da instalação", () => {
  it("vazio: 1000 mensagens e 5 vezes", async () => {
    expect(await criterioDeAlerta()).toEqual(PADRAO);
  });

  it("valores válidos valem", async () => {
    instalacao.valores = { VIX_ALERTA_DE_USO_MENSAGENS: "300", VIX_ALERTA_DE_USO_MULTIPLO: "3" };
    expect(await criterioDeAlerta()).toEqual({ mensagens: 300, multiplo: 3 });
  });

  it.each(["0", "-1", "nunca", "1.5"])("inválido (%s): cai no padrão, o aviso não some", async (valor) => {
    instalacao.valores = { VIX_ALERTA_DE_USO_MENSAGENS: valor, VIX_ALERTA_DE_USO_MULTIPLO: valor };
    expect(await criterioDeAlerta()).toEqual(PADRAO);
  });
});

describe("GET /api/v1/admin/assistente/uso", () => {
  it("quem não é equipe da plataforma é recusado e o banco não é consultado", async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValue(new Error("não é da plataforma"));
    const r = await GET();
    expect(r.status).toBe(403);
    expect(banco.consultas).toBe(0);
  });

  it("a equipe recebe o uso por empresa, com o destaque e o critério em vigor", async () => {
    banco.uso = [
      { organization_id: "a", mensagens: 1200, tokens_de_entrada: 5000, tokens_de_saida: 900, falhas: 2, usuarios: 3 },
      { organization_id: "b", mensagens: 10, tokens_de_entrada: 100, tokens_de_saida: 20, falhas: 0, usuarios: 1 },
    ];
    const r = await GET();
    expect(r.status).toBe(200);
    const { data } = (await r.json()) as {
      data: { criterio: unknown; organizacoes: { organization_id: string; destoa: boolean; empresa: { nome: string }; mensagens: number }[] };
    };
    expect(data.criterio).toEqual(PADRAO);
    expect(data.organizacoes.map((o) => [o.organization_id, o.destoa])).toEqual([
      ["a", true],
      ["b", false],
    ]);
    expect(data.organizacoes[0]!.empresa.nome).toBe("Empresa a");
    // Só contagem e tokens: nenhum campo de texto de mensagem sai daqui.
    expect(Object.keys(data.organizacoes[0]!).sort()).toEqual(
      ["destoa", "empresa", "falhas", "mensagens", "motivo", "organization_id", "tokens_de_entrada", "tokens_de_saida", "usuarios"].sort(),
    );
  });

  it("leitura falhou: 500, sem inventar lista vazia", async () => {
    banco.erro = true;
    expect((await GET()).status).toBe(500);
  });
});
