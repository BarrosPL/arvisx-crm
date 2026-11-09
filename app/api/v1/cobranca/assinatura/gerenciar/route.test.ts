import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoFalso, valorDoFiltro, type BancoFalso } from "@/tests/helpers/banco-falso-da-cobranca";

const h = vi.hoisted(() => ({
  papel: vi.fn(),
  linha: null as Record<string, unknown> | null,
  gerenciar: vi.fn(),
  taxaOk: true,
  banco: undefined as unknown as BancoFalso,
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: h.papel }));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: async () => true }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: h.taxaOk }) }));
vi.mock("@/lib/cobranca/provedores", () => ({ adaptador: () => ({ urlDeGerenciar: h.gerenciar }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.banco.cliente }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));

import { ErroDoProvedor } from "@/lib/cobranca/provedores/contrato";

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  h.linha = { provedor: "stripe", provedor_cliente_id: "cus_1" };
  h.taxaOk = true;
  h.banco = bancoFalso(() => ({ data: h.linha }));
  h.papel.mockResolvedValue({ ok: true, user: { id: "admin-1" }, org: { orgId: "15151515-0000-4000-8000-000000000001" } });
  h.gerenciar.mockResolvedValue("https://billing.stripe.com/p/session/x");
});

describe("gerenciar o pagamento", () => {
  it("⭐ devolve o portal do provedor, com volta para Plano e cobrança", async () => {
    expect((await (await POST()).json()).data).toEqual({ url: "https://billing.stripe.com/p/session/x" });
    expect(h.gerenciar).toHaveBeenCalledWith({ clienteRef: "cus_1", urlDeVolta: expect.stringMatching(/\/cobranca\/volta\?para=painel$/) });
  });

  it("sem assinatura no provedor, ou provedor sem portal: 409 sem_portal", async () => {
    h.linha = { provedor: null, provedor_cliente_id: null };
    expect((await (await POST()).json()).error.code).toBe("sem_portal");
    h.linha = { provedor: "stripe", provedor_cliente_id: "cus_1" };
    h.gerenciar.mockResolvedValue(null);
    expect((await (await POST()).json()).error.code).toBe("sem_portal");
  });

  it("provedor fora do ar: 503", async () => {
    h.gerenciar.mockRejectedValue(new ErroDoProvedor(503, "api_error", true));
    expect((await POST()).status).toBe(503);
  });

  it("acima de 10 por minuto da mesma empresa: 429 sem abrir o portal", async () => {
    h.taxaOk = false;
    expect((await POST()).status).toBe(429);
    expect(h.gerenciar).not.toHaveBeenCalled();
  });

  it("⭐ só o admin da empresa: quem não passa no requireRole('admin') recebe a recusa dele e o portal nem é pedido", async () => {
    h.papel.mockResolvedValue({ ok: false, response: Response.json({ error: { code: "forbidden" } }, { status: 403 }) });
    expect((await POST()).status).toBe(403);
    expect(h.papel).toHaveBeenCalledWith("admin", expect.objectContaining({ resource: "cobranca_assinaturas" }));
    expect(h.gerenciar).not.toHaveBeenCalled();
    expect(h.banco.cadeias).toEqual([]);
  });

  it("⭐ o customer da sessão é o da empresa DA SESSÃO, lido pelo organization_id da autorização (nunca do corpo)", async () => {
    h.linha = { provedor: "stripe", provedor_cliente_id: "cus_DaEmpresaCerta" };
    await POST();
    const leitura = h.banco.cadeias.find((c) => c.tabela === "cobranca_assinaturas");
    expect(leitura && valorDoFiltro(leitura, "eq", "organization_id")).toBe("15151515-0000-4000-8000-000000000001");
    expect(h.gerenciar).toHaveBeenCalledWith(expect.objectContaining({ clienteRef: "cus_DaEmpresaCerta" }));
  });
});
