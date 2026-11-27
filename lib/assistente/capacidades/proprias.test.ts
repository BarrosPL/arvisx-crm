/**
 * As três capacidades próprias que não leem o banco com a sessão: ajuda, guia
 * de telas e plano. (As que leem o banco são medidas com PostgREST real em
 * `tests/invariants/assistente-proprias-isolamento.test.ts`.)
 *
 * O que importa aqui: o guia de telas nunca devolve endereço que não esteja no
 * catálogo de navegação nem tela que a pessoa não alcança, e a ajuda sai da
 * base do treinamento, sem texto próprio.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { telaForaDoPlano } from "@/lib/cobranca/trava-do-plano";
import { modulosLigados } from "@/lib/instalacao/modulos";
import { NAV_CATALOG, type NavMetadata } from "@/lib/navigation/catalogo";
import { capacidadesDaOrganizacao } from "@/lib/organizacao/capacidades";

import type { Capacidade, ContextoDoAssistente, PapelHumano } from "../tipos";

vi.mock("@/lib/cobranca/trava-do-plano", () => ({ telaForaDoPlano: vi.fn(async () => false) }));
vi.mock("@/lib/instalacao/modulos", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  modulosLigados: vi.fn(async () => []),
}));
vi.mock("@/lib/organizacao/capacidades", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  capacidadesDaOrganizacao: vi.fn(async () => []),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));

const { CAPACIDADES_PROPRIAS } = await import("./proprias");

const ORG = "11111111-1111-4111-8111-111111111111";
const cap = (nome: string): Capacidade => {
  const achada = CAPACIDADES_PROPRIAS.find((c) => c.nome === nome);
  if (!achada) throw new Error(`capacidade ${nome} não existe`);
  return achada;
};
const ctx = (papel: PapelHumano = "viewer"): ContextoDoAssistente => ({
  orgId: ORG,
  userId: "22222222-2222-4222-8222-222222222222",
  papel,
  idioma: "pt-BR",
  requestId: "req",
  db: {} as never,
});

const DESTINOS = NAV_CATALOG as readonly NavMetadata[];

beforeEach(() => {
  vi.mocked(telaForaDoPlano).mockResolvedValue(false);
  vi.mocked(modulosLigados).mockResolvedValue([]);
  vi.mocked(capacidadesDaOrganizacao).mockResolvedValue([]);
});

describe("ajuda_buscar", () => {
  type Retorno = {
    licoes: { licao: string; tela_no_menu: string; passos: { passo: string; o_que_fazer: string }[] }[];
  };
  const buscarAjuda = (consulta: string) =>
    cap("ajuda_buscar").executar({ consulta } as never, ctx()) as Promise<Retorno>;

  it("devolve o passo a passo da lição, com o nome do menu e não o endereço", async () => {
    const r = await buscarAjuda("credenciais");
    expect(r.licoes.length).toBeGreaterThan(0);
    expect(r.licoes.length).toBeLessThanOrEqual(3);
    for (const l of r.licoes) {
      expect(l.passos.length).toBeGreaterThan(0);
      expect(l.tela_no_menu.startsWith("/")).toBe(false);
    }
  });

  it("nada do que volta para o modelo é endereço de tela ou link", async () => {
    const r = await buscarAjuda("agente");
    expect(JSON.stringify(r)).not.toMatch(/\/app\//);
  });

  it("busca sem resultado devolve lista vazia, não inventa", async () => {
    const r = await buscarAjuda("zzqqxxyy inexistente");
    expect(r.licoes).toEqual([]);
  });
});

describe("telas_apontar", () => {
  const apontar = (href: string, papel: PapelHumano = "viewer") =>
    cap("telas_apontar").executar({ href } as never, ctx(papel)) as Promise<Record<string, unknown>>;

  it("acha a tela pelo NOME do menu, sem acento e sem diferenciar maiúsculas", async () => {
    const r = (await cap("telas_apontar").executar({ nome: "conexoes" } as never, ctx("admin"))) as Record<string, unknown>;
    expect(r).toMatchObject({ existe: true, pode_abrir: true, nome: "Conexões" });
  });

  it("nome que não existe: devolve nomes parecidos, não inventa tela", async () => {
    const r = (await cap("telas_apontar").executar({ nome: "Conexões secretas do sistema" } as never, ctx("admin"))) as Record<string, unknown>;
    expect(r.existe === false || r.pode_abrir !== undefined).toBe(true);
    const nada = (await cap("telas_apontar").executar({ nome: "zzqqxx" } as never, ctx("admin"))) as Record<string, unknown>;
    expect(nada).toEqual({ existe: false, motivo: "tela_desconhecida" });
  });

  it("tela do catálogo que a pessoa alcança: devolve o endereço do catálogo", async () => {
    const r = await apontar("/app/inbox");
    expect(r).toMatchObject({ existe: true, pode_abrir: true, abrir: "/app/inbox" });
  });

  it.each([
    "/app/nao-existe",
    "/app/inbox/../../admin",
    "/app/ai/credentials?next=https://evil.example",
    "/app//evil.example",
  ])("endereço fora do catálogo (%s): não devolve nada para abrir", async (href) => {
    const r = await apontar(href, "admin");
    expect(r).toEqual({ existe: false, motivo: "tela_desconhecida" });
  });

  it("o schema recusa endereço que não começa em /app (site de fora, painel da plataforma)", () => {
    const entrada = cap("telas_apontar").entrada;
    for (const href of ["https://evil.example/app", "/admin/sistema", "javascript:alert(1)", "//evil.example"]) {
      expect(entrada.safeParse({ href }).success, href).toBe(false);
    }
  });

  it("tela acima do papel: diz que existe e não devolve endereço para abrir", async () => {
    const restrita = DESTINOS.find((d) => d.minRole === "admin" && !d.modulo && !d.capacidade);
    expect(restrita, "o catálogo precisa ter ao menos uma tela só de administrador").toBeDefined();
    const r = await apontar(restrita!.href, "agent");
    expect(r).toMatchObject({ existe: true, pode_abrir: false, motivo: "papel_insuficiente" });
    expect(r.abrir).toBeUndefined();
    expect((await apontar(restrita!.href, "admin")).pode_abrir).toBe(true);
  });

  it("tela de módulo desligado na instalação: não abre; ligado, abre", async () => {
    const deModulo = DESTINOS.find((d) => d.modulo && !d.capacidade);
    expect(deModulo).toBeDefined();
    expect(await apontar(deModulo!.href, "admin")).toMatchObject({ pode_abrir: false, motivo: "recurso_desligado" });
    vi.mocked(modulosLigados).mockResolvedValue([deModulo!.modulo!]);
    expect((await apontar(deModulo!.href, "admin")).pode_abrir).toBe(true);
  });

  it("tela fora do plano: explica e aponta só a tela de 'fora do plano'", async () => {
    vi.mocked(telaForaDoPlano).mockResolvedValue(true);
    const r = await apontar("/app/inbox");
    expect(r).toMatchObject({ existe: true, pode_abrir: false, motivo: "fora_do_plano", abrir: "/app/fora-do-plano" });
    expect(telaForaDoPlano).toHaveBeenCalledWith(ORG, "/app/inbox");
  });
});

describe("configuracao_plano", () => {
  it("pergunta pelo plano com a organização do CONTEXTO e lista o que está fora", async () => {
    vi.mocked(telaForaDoPlano).mockImplementation(async (_org, destino) => destino === "/app/products");
    const r = (await cap("configuracao_plano").executar({} as never, ctx())) as {
      fora_do_plano: { tela: string }[];
      tudo_liberado: boolean;
    };
    expect(r.tudo_liberado).toBe(false);
    expect(r.fora_do_plano.map((f) => f.tela)).toEqual(["/app/products"]);
    for (const chamada of vi.mocked(telaForaDoPlano).mock.calls) expect(chamada[0]).toBe(ORG);
  });
});
