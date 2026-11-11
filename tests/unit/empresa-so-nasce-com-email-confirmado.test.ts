// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SEM E-MAIL CONFIRMADO NÃO HÁ EMPRESA (auditoria de 11/11/2026).
 *
 * `POST /auth/v1/signup` é público para quem tem a chave do navegador. Com a
 * confirmação automática do GoTrue ligada, quem chamasse o provedor direto saía
 * com sessão e abria empresa em teste sem nunca ter recebido um e-mail. O dono
 * desliga a confirmação automática no servidor; este arquivo prova a defesa do
 * CÓDIGO, que vale com qualquer configuração: `ensureTenantForUser` — a última
 * porta de toda empresa que nasce de um cadastro — recusa a conta cujo
 * `email_confirmed_at` o provedor não preencheu.
 *
 * As outras portas têm teste próprio: `/get-started`
 * (app/actions/auth/recoverOrganization.test.ts), `/auth/confirm`
 * (tests/unit/auth-confirm-recusas-do-cadastro.test.ts) e
 * `POST /api/v1/tenants/provision` (lib/auth/provision-externo.test.ts).
 */

interface Escrita {
  tabela: string;
  op: "insert" | "select";
  payload: Record<string, unknown> | null;
}
const escritas: Escrita[] = [];
const banco = { vinculoExistente: null as string | null };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const e: Escrita = { tabela, op: "select", payload: null };
      const responder = () => {
        if (tabela === "user_organizations" && e.op === "select") {
          return { data: banco.vinculoExistente ? { organization_id: banco.vinculoExistente } : null, error: null };
        }
        if (tabela === "organizations" && e.op === "insert") return { data: { id: "org-nova", slug: "x" }, error: null };
        return { data: null, error: null };
      };
      const b = {
        select: () => b,
        insert: (p: Record<string, unknown>) => {
          e.op = "insert";
          e.payload = p;
          escritas.push(e);
          return b;
        },
        eq: () => b,
        is: () => b,
        limit: () => b,
        single: async () => responder(),
        maybeSingle: async () => responder(),
        then: (ok: (r: unknown) => unknown) => Promise.resolve(responder()).then(ok),
      };
      return b;
    },
  }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const CONTA = { id: "u-1", email: "quem@exemplo.test", user_metadata: { org_name: "Empresa de Fachada" } };

beforeEach(() => {
  escritas.length = 0;
  banco.vinculoExistente = null;
});

describe("emailConfirmado", () => {
  it("só vale a data que o provedor preencheu; ausente, nulo e vazio são NÃO", async () => {
    const { emailConfirmado } = await import("@/lib/auth/email-confirmado");
    expect(emailConfirmado({ email_confirmed_at: "2026-11-11T10:00:00.000Z" })).toBe(true);
    for (const conta of [null, undefined, {}, { email_confirmed_at: null }, { email_confirmed_at: "" }, { email_confirmed_at: "  " }]) {
      expect(emailConfirmado(conta), JSON.stringify(conta)).toBe(false);
    }
    // O `user_metadata` é editável pela própria pessoa: não é lido.
    expect(emailConfirmado({ user_metadata: { email_confirmed_at: "2026-11-11T10:00:00.000Z" } } as never)).toBe(false);
  });
});

describe("ensureTenantForUser", () => {
  it.each([
    ["ausente", {}],
    ["nulo", { email_confirmed_at: null }],
    ["vazio", { email_confirmed_at: "" }],
  ])("⭐ conta com email_confirmed_at %s: recusa, e nenhuma organização nem vínculo é gravado", async (_, confirmacao) => {
    const { ensureTenantForUser } = await import("@/lib/auth/provision");
    const { EmailNaoConfirmadoError } = await import("@/lib/auth/email-confirmado");

    await expect(ensureTenantForUser({ ...CONTA, ...confirmacao })).rejects.toBeInstanceOf(EmailNaoConfirmadoError);
    expect(escritas).toEqual([]);
  });

  it("⭐ vale também para a recuperação (`/get-started`), não só para o cadastro", async () => {
    const { ensureTenantForUser } = await import("@/lib/auth/provision");
    await expect(ensureTenantForUser({ ...CONTA, email_confirmed_at: null }, { source: "recovery" })).rejects.toThrow(
      "email_nao_confirmado",
    );
    expect(escritas).toEqual([]);
  });

  it("CONTROLE: com o e-mail confirmado pelo provedor a empresa nasce, com a pessoa como admin", async () => {
    const { ensureTenantForUser } = await import("@/lib/auth/provision");
    const r = await ensureTenantForUser({ ...CONTA, email_confirmed_at: "2026-11-11T10:00:00.000Z" });
    expect(r).toEqual({ provisioned: true, organizationId: "org-nova" });
    expect(escritas.map((e) => e.tabela)).toEqual(["organizations", "user_organizations"]);
    expect(escritas[1]?.payload).toMatchObject({ user_id: "u-1", organization_id: "org-nova", role: "admin" });
  });

  it("quem JÁ tem empresa segue idempotente: nada é criado, e a conferência nem entra", async () => {
    banco.vinculoExistente = "org-antiga";
    const { ensureTenantForUser } = await import("@/lib/auth/provision");
    expect(await ensureTenantForUser({ ...CONTA })).toEqual({ provisioned: false, organizationId: "org-antiga" });
    expect(escritas).toEqual([]);
  });
});
