/**
 * PATCH /api/v1/assistente/configuracao — a chave do assistente POR EMPRESA.
 *
 * O que se mede na rota real:
 *  - só administrador da empresa passa (a recusa de `requireRole` volta como veio);
 *  - o corpo é estrito: a marca `sem_limite`, que é da plataforma, e qualquer
 *    `organization_id` são recusados com 422 e NADA é gravado;
 *  - a gravação nomeia só `ligado` (nunca a marca) e filtra pela empresa da
 *    sessão;
 *  - a mudança é auditada.
 *
 * O banco é um espião: a tabela de verdade e a RLS dela são provadas em
 * `tests/invariants/assistente-tabelas-e-cartao.test.ts`.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";

type Operacao = { tipo: "update" | "insert"; tabela: string; valores: Record<string, unknown>; filtros: [string, unknown][] };
const espiao = vi.hoisted(() => ({ operacoes: [] as unknown[], linhaExiste: true }));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(tabela: string) {
      return {
        update(valores: Record<string, unknown>) {
          const op = { tipo: "update", tabela, valores, filtros: [] as [string, unknown][] };
          espiao.operacoes.push(op);
          const elo = {
            eq(coluna: string, valor: unknown) {
              op.filtros.push([coluna, valor]);
              return elo;
            },
            select: async () => ({ data: espiao.linhaExiste ? [{ organization_id: "x" }] : [], error: null }),
          };
          return elo;
        },
        insert: async (valores: Record<string, unknown>) => {
          espiao.operacoes.push({ tipo: "insert", tabela, valores, filtros: [] });
          return { error: null };
        },
      };
    },
  }),
}));

const { PATCH } = await import("@/app/api/v1/assistente/configuracao/route");

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "99999999-9999-4999-8999-999999999999";
const USER = "11111111-1111-4111-8111-111111111111";

const operacoes = () => espiao.operacoes as Operacao[];
const pedir = (corpo: unknown) =>
  PATCH(new NextRequest("http://localhost/api/v1/assistente/configuracao", { method: "PATCH", body: JSON.stringify(corpo) }));

beforeEach(() => {
  espiao.operacoes = [];
  espiao.linhaExiste = true;
  vi.mocked(audit).mockClear();
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER, idioma: "pt-BR" },
    org: { orgId: ORG, role: "admin" },
  } as never);
});

describe("quem pode", () => {
  it("pede o papel de administrador", async () => {
    await pedir({ ligado: false });
    expect(vi.mocked(requireRole).mock.calls[0]![0]).toBe("admin");
  });

  it("quem não é administrador recebe a recusa e nada é gravado", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: fail("forbidden", "x", 403) } as never);
    const r = await pedir({ ligado: false });
    expect(r.status).toBe(403);
    expect(operacoes()).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("o corpo é estrito", () => {
  it.each([
    ["a marca da plataforma", { ligado: true, sem_limite: true }],
    ["a empresa no corpo", { ligado: false, organization_id: OUTRA_ORG }],
    ["ligado que não é booleano", { ligado: "sim" }],
    ["corpo vazio", {}],
  ])("%s: 422 e nada gravado", async (_caso, corpo) => {
    const r = await pedir(corpo);
    expect(r.status).toBe(422);
    expect(operacoes()).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("a gravação", () => {
  it("desligar: atualiza só `ligado`, na empresa da sessão, e audita", async () => {
    const r = await pedir({ ligado: false });
    expect(r.status).toBe(200);
    expect(operacoes()).toHaveLength(1);
    const op = operacoes()[0]!;
    expect(op.tabela).toBe("assistente_estado_da_empresa");
    expect(op.valores.ligado).toBe(false);
    expect(op.valores.atualizado_por).toBe(USER);
    expect(Object.keys(op.valores)).not.toContain("sem_limite");
    expect(op.filtros).toEqual([["organization_id", ORG]]);
    expect(vi.mocked(audit).mock.calls).toHaveLength(1);
    expect(JSON.stringify(vi.mocked(audit).mock.calls[0])).toContain("assistente.configuracao_alterada");
  });

  it("empresa sem linha: cria a linha só com `ligado`, na empresa da sessão", async () => {
    espiao.linhaExiste = false;
    const r = await pedir({ ligado: false });
    expect(r.status).toBe(200);
    const criada = operacoes().find((o) => o.tipo === "insert")!;
    expect(criada.valores).toEqual({ organization_id: ORG, ligado: false, atualizado_por: USER });
  });
});
