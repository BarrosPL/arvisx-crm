/**
 * OS CHAMADOS DO ASSISTENTE, LIDOS PELA EQUIPE DA PLATAFORMA.
 *
 * `GET /api/v1/admin/assistente/chamados` e `PATCH .../:id` nas rotas reais.
 *
 * O que se mede:
 *  - quem NÃO é equipe da plataforma (o administrador de uma empresa cliente
 *    inclusive) recebe a recusa, e o banco nem é consultado;
 *  - a equipe lê os chamados de TODAS as empresas, com o diagnóstico anexado;
 *  - marcar exige o direito de ESCRITA da plataforma, o corpo é estrito, e cada
 *    marcação é auditada na empresa dona do chamado, como ato da plataforma;
 *  - a marcação só escreve estado e carimbos: nunca o texto do chamado.
 *
 * Que a SESSÃO de uma empresa não lê chamado de outra é provado no Postgres, em
 * `tests/invariants/assistente-retencao-lgpd-e-chamados.test.ts`.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";

type Linha = Record<string, unknown>;
const banco = vi.hoisted(() => ({ chamados: [] as Record<string, unknown>[], consultas: 0, atualizacoes: [] as unknown[] }));

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: vi.fn(),
  requirePlatformAdminEscrita: vi.fn(),
  falhaDaEscritaDePlatformAdmin: (_erro: unknown, requestId: string) => fail("forbidden", "Só a equipe da plataforma.", 403, { requestId }),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(tabela: string) {
      banco.consultas += 1;
      const filtros: [string, unknown][] = [];
      let limite = 1000;
      const linhasDaTabela = (): Linha[] =>
        tabela === "assistente_chamados"
          ? banco.chamados
          : [
              { id: ORG_A, display_name: "Empresa A", slug: "empresa-a" },
              { id: ORG_B, display_name: "Empresa B", slug: "empresa-b" },
            ];
      const filtrar = () => linhasDaTabela().filter((l) => filtros.every(([c, v]) => (Array.isArray(v) ? v.includes(l[c]) : l[c] === v)));
      const elo = {
        select: () => elo,
        order: () => elo,
        limit(n: number) {
          limite = n;
          return elo;
        },
        eq(c: string, v: unknown) {
          filtros.push([c, v]);
          return elo;
        },
        in(c: string, v: unknown[]) {
          filtros.push([c, v]);
          return elo;
        },
        maybeSingle: async () => ({ data: filtrar()[0] ?? null, error: null }),
        then: (ok: (v: { data: Linha[]; error: null }) => unknown) => Promise.resolve({ data: filtrar().slice(0, limite), error: null }).then(ok),
        update(valores: Linha) {
          return {
            eq: async (c: string, v: unknown) => {
              banco.atualizacoes.push({ tabela, valores, filtro: [c, v] });
              for (const l of linhasDaTabela()) if (l[c] === v) Object.assign(l, valores);
              return { error: null };
            },
          };
        },
      };
      return elo;
    },
  }),
}));

const { GET } = await import("@/app/api/v1/admin/assistente/chamados/route");
const { PATCH } = await import("@/app/api/v1/admin/assistente/chamados/[id]/route");

const ORG_A = "22222222-2222-4222-8222-222222222222";
const ORG_B = "99999999-9999-4999-8999-999999999999";
const CHAMADO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHAMADO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EQUIPE = "44444444-4444-4444-8444-444444444444";

const listar = (q = "") => GET(new NextRequest(`http://localhost/api/v1/admin/assistente/chamados${q}`));
const marcar = (id: string, corpo: unknown) =>
  PATCH(new NextRequest(`http://localhost/api/v1/admin/assistente/chamados/${id}`, { method: "PATCH", body: JSON.stringify(corpo) }), {
    params: Promise.resolve({ id }),
  });
const atualizacoes = () => banco.atualizacoes as { tabela: string; valores: Linha; filtro: [string, unknown] }[];

beforeEach(() => {
  banco.consultas = 0;
  banco.atualizacoes = [];
  banco.chamados = [
    { id: CHAMADO_A, organization_id: ORG_A, resumo: "canal caiu", diagnostico: { canais: [{ nome: "principal", estado: "caiu" }] }, estado: "aberto", visto_em: null },
    { id: CHAMADO_B, organization_id: ORG_B, resumo: "agente não responde", diagnostico: { turno: "sem credencial" }, estado: "aberto", visto_em: null },
  ];
  vi.mocked(audit).mockClear();
  vi.mocked(requirePlatformAdmin).mockReset();
  vi.mocked(requirePlatformAdminEscrita).mockReset();
  vi.mocked(requirePlatformAdmin).mockResolvedValue({ user: { id: EQUIPE } } as never);
  vi.mocked(requirePlatformAdminEscrita).mockResolvedValue({ user: { id: EQUIPE } } as never);
});

describe("ler", () => {
  it("quem não é equipe da plataforma é recusado e o banco não é consultado", async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValue(new Error("não é da plataforma"));
    const r = await listar();
    expect(r.status).toBe(403);
    expect(banco.consultas).toBe(0);
  });

  it("a equipe lê os chamados de todas as empresas, com o diagnóstico e o nome da empresa", async () => {
    const r = await listar();
    expect(r.status).toBe(200);
    const { data } = (await r.json()) as { data: { id: string; diagnostico: unknown; empresa: { nome: string } }[] };
    expect(data.map((d) => d.id).sort()).toEqual([CHAMADO_A, CHAMADO_B].sort());
    const deA = data.find((d) => d.id === CHAMADO_A)!;
    expect(deA.diagnostico).toEqual({ canais: [{ nome: "principal", estado: "caiu" }] });
    expect(deA.empresa.nome).toBe("Empresa A");
  });

  it("filtro desconhecido ou parâmetro a mais: 422", async () => {
    expect((await listar("?estado=apagado")).status).toBe(422);
    expect((await listar(`?organization_id=${ORG_B}`)).status).toBe(422);
  });
});

describe("marcar", () => {
  it("sem o direito de escrita da plataforma: recusa, nada gravado, nada auditado", async () => {
    vi.mocked(requirePlatformAdminEscrita).mockRejectedValue(new Error("só leitura"));
    const r = await marcar(CHAMADO_A, { acao: "resolvido" });
    expect(r.status).toBe(403);
    expect(atualizacoes()).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it.each([
    ["texto no corpo", { acao: "visto", resumo: "trocado" }],
    ["empresa no corpo", { acao: "visto", organization_id: ORG_B }],
    ["ação desconhecida", { acao: "apagar" }],
    ["corpo vazio", {}],
  ])("%s: 422 e nada gravado", async (_caso, corpo) => {
    const r = await marcar(CHAMADO_A, corpo);
    expect(r.status).toBe(422);
    expect(atualizacoes()).toHaveLength(0);
  });

  it("visto: grava só carimbo e estado, e audita na empresa dona do chamado como ato da plataforma", async () => {
    const r = await marcar(CHAMADO_A, { acao: "visto" });
    expect(r.status).toBe(200);
    expect(atualizacoes()).toHaveLength(1);
    const { valores, filtro } = atualizacoes()[0]!;
    expect(Object.keys(valores).sort()).toEqual(["estado", "updated_at", "visto_em", "visto_por"]);
    expect(valores.estado).toBe("em_andamento");
    expect(valores.visto_por).toBe(EQUIPE);
    expect(filtro).toEqual(["id", CHAMADO_A]);
    const registro = vi.mocked(audit).mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(registro.action).toBe("assistente.chamado_visto");
    expect(registro.organizationId).toBe(ORG_A);
    expect(registro.actingAsPlatformAdmin).toBe(true);
    expect(registro.actorUserId).toBe(EQUIPE);
  });

  it("visto de novo não regrava nem audita de novo", async () => {
    await marcar(CHAMADO_A, { acao: "visto" });
    vi.mocked(audit).mockClear();
    banco.atualizacoes = [];
    const r = await marcar(CHAMADO_A, { acao: "visto" });
    expect(r.status).toBe(200);
    expect(atualizacoes()).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it("resolvido: marca, carimba o visto que faltava e audita; resolver de novo é 409", async () => {
    const r = await marcar(CHAMADO_B, { acao: "resolvido" });
    expect(r.status).toBe(200);
    const { valores } = atualizacoes()[0]!;
    expect(valores.estado).toBe("resolvido");
    expect(valores.resolvido_por).toBe(EQUIPE);
    expect(valores.visto_por).toBe(EQUIPE);
    expect(Object.keys(valores)).not.toContain("resumo");
    expect(Object.keys(valores)).not.toContain("diagnostico");
    expect((vi.mocked(audit).mock.calls[0]![0] as unknown as Record<string, unknown>).action).toBe("assistente.chamado_resolvido");
    expect((await marcar(CHAMADO_B, { acao: "resolvido" })).status).toBe(409);
  });

  it("chamado que não existe, ou id que não é uuid: 404", async () => {
    expect((await marcar("cccccccc-cccc-4ccc-8ccc-cccccccccccc", { acao: "visto" })).status).toBe(404);
    expect((await marcar("nao-e-uuid", { acao: "visto" })).status).toBe(404);
  });
});
