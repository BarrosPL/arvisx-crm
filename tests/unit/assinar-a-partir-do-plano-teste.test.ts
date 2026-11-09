/**
 * ASSINAR A PARTIR DO PLANO "TESTE" (ArvisX, etapa 3 dos planos).
 *
 * A empresa nasce no plano de entrada (o "Teste": 7 dias, completa, sem
 * limites, padrão do cadastro e NÃO oferecido). Para pagar, ela escolhe um dos
 * planos oferecidos no Assinar: o `plano_id` troca para o escolhido e o
 * Checkout da Stripe sai com ele — também depois do fim do teste, com a
 * empresa em atraso/suspensa. Plano menor do que o uso é recusado com o
 * excesso listado; nada é desconectado. O Teste em si nunca vai ao Checkout.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { argumentos, bancoFalso, filtros, operacao, type BancoFalso, type Cadeia, type Resposta } from "@/tests/helpers/banco-falso-da-cobranca";

const h = vi.hoisted(() => ({
  papel: vi.fn(),
  provedor: "stripe" as string | null,
  ad: { lerSituacao: vi.fn(), garantirCliente: vi.fn(), iniciarAssinatura: vi.fn(), lerPagamentoProporcional: vi.fn(), expirarSessao: vi.fn() },
  audit: vi.fn(),
  banco: undefined as unknown as BancoFalso,
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: h.papel }));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: async () => true }));
vi.mock("@/lib/cobranca/configuracao", () => ({ provedorDaInstalacao: async () => h.provedor }));
vi.mock("@/lib/cobranca/provedores", () => ({ adaptador: () => h.ad, modoDoProvedor: async () => "teste" }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.banco.cliente }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/cobranca/emails", () => ({ emailDoAdminDaEmpresa: async () => "ana@loja.com" }));

import { POST } from "@/app/api/v1/cobranca/assinatura/checkout/route";

const ORG = "ffffffff-0000-4000-8000-000000000001";
const TESTE = "aaaaaaaa-0000-4000-8000-000000000000";
const ESSENCIAL = "aaaaaaaa-0000-4000-8000-000000000001";
const PREMIUM = "aaaaaaaa-0000-4000-8000-000000000003";
const NEGOCIADO = "aaaaaaaa-0000-4000-8000-000000000009";

type Plano = Record<string, unknown>;
const PLANOS: Record<string, Plano> = {
  [TESTE]: { id: TESTE, nome: "Teste", preco_cents: 5990, moeda: "BRL", intervalo: "mes", max_assentos: null, max_canais: null, arquivado_em: null, padrao_no_cadastro: true, oferecido_ao_cliente: false },
  [ESSENCIAL]: { id: ESSENCIAL, nome: "Essencial", preco_cents: 5990, moeda: "EUR", intervalo: "mes", max_assentos: 5, max_canais: 3, arquivado_em: null, padrao_no_cadastro: false, oferecido_ao_cliente: true },
  [PREMIUM]: { id: PREMIUM, nome: "Premium", preco_cents: 19990, moeda: "EUR", intervalo: "mes", max_assentos: null, max_canais: null, arquivado_em: null, padrao_no_cadastro: false, oferecido_ao_cliente: true },
  [NEGOCIADO]: { id: NEGOCIADO, nome: "Negociado", preco_cents: 9990, moeda: "EUR", intervalo: "mes", max_assentos: null, max_canais: null, arquivado_em: null, padrao_no_cadastro: false, oferecido_ao_cliente: false },
};
const NO_TESTE = {
  plano_id: TESTE, plano_agendado_id: null, estado: "trial", trial_ate: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  provedor: null, provedor_cliente_id: null, provedor_assinatura_id: null, checkout_url: null, checkout_expira_em: null, checkout_sessao_id: null,
  troca_id: null, troca_status: null, troca_pagamento_ref: null, troca_reserva_ate: null,
};
let linha: Record<string, unknown>;
let uso: { assentos: number; canais: number };

function responder(c: Cadeia): Resposta {
  if (c.tabela === "organizations") return { data: { legal_name: "Clínica Bem Viver Ltda", display_name: "Clínica Bem Viver" } };
  if (c.tabela === "cobranca_planos") {
    const id = filtros(c).find((f) => f[0] === "eq" && f[1] === "id")?.[2] as string;
    return { data: PLANOS[id] ?? null };
  }
  if (c.tabela === "user_organizations") return { count: uso.assentos };
  if (c.tabela === "channel_sessions") return { count: uso.canais };
  if (operacao(c) === "select") return { data: linha };
  return { data: { organization_id: ORG } };
}

const assinar = (corpo: Record<string, unknown> = {}) =>
  POST(
    new NextRequest("http://localhost/api/v1/cobranca/assinatura/checkout", {
      method: "POST",
      headers: { "Idempotency-Key": "3f1c2d4e-0000-4000-8000-000000000001", "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  );
const updates = () =>
  h.banco.cadeias.filter((c) => c.tabela === "cobranca_assinaturas" && operacao(c) === "update");
const erro = async (res: Response) => ((await res.json()) as { error: { code: string; details?: unknown } }).error;

beforeEach(() => {
  vi.clearAllMocks();
  h.provedor = "stripe";
  linha = { ...NO_TESTE };
  uso = { assentos: 2, canais: 1 };
  h.banco = bancoFalso(responder);
  h.papel.mockResolvedValue({ ok: true, user: { id: "admin-1", email: "dono@treinamento.local" }, org: { orgId: ORG } });
  h.ad.garantirCliente.mockResolvedValue("cus_novo");
  h.ad.iniciarAssinatura.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_1", expiraEm: new Date(Date.now() + 86_400_000), assinaturaRef: null, sessaoId: "cs_1" });
});

describe("⭐ assinar a partir do plano Teste", () => {
  it("⭐ escolher o Essencial troca o plano_id (compare-and-set no Teste, sem assinatura no provedor) e abre o Checkout dele, em euro", async () => {
    const res = await assinar({ plano_id: ESSENCIAL });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_1" });

    const [troca, reserva, gravacao] = updates();
    expect(argumentos(troca!, "update")?.[0]).toMatchObject({ plano_id: ESSENCIAL, plano_agendado_id: null, checkout_url: null });
    expect(filtros(troca!)).toContainEqual(["eq", "plano_id", TESTE]);
    expect(filtros(troca!)).toContainEqual(["is", "provedor_assinatura_id", null]);
    expect(argumentos(reserva!, "update")?.[0]).toMatchObject({ checkout_url: null });
    // O link gravado é o do plano NOVO.
    expect(filtros(gravacao!)).toContainEqual(["eq", "plano_id", ESSENCIAL]);

    // O Teste é BRL e o Essencial é EUR: sem assinatura viva no provedor, a moeda muda junto.
    expect(h.ad.iniciarAssinatura.mock.calls[0]?.[0]).toMatchObject({
      plano: { id: ESSENCIAL, nome: "Essencial", precoCents: 5990, moeda: "EUR", intervalo: "mes" },
      // Os dias de teste que sobram seguem para a Stripe.
      trialAte: new Date(NO_TESTE.trial_ate),
    });
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "cobranca.plano_trocado", metadata: { de: TESTE, para: ESSENCIAL, quando: "ao_assinar" },
    }));
  });

  it("⭐ teste VENCIDO, empresa em atraso (a régua já a suspendeu): escolher ainda troca o plano e abre o Checkout, sem teste grátis", async () => {
    linha = { ...NO_TESTE, estado: "em_atraso", trial_ate: new Date(Date.now() - 3 * 86_400_000).toISOString() };
    const res = await assinar({ plano_id: PREMIUM, volta: "hub" });
    expect(res.status).toBe(200);
    expect(argumentos(updates()[0]!, "update")?.[0]).toMatchObject({ plano_id: PREMIUM });
    expect(h.ad.iniciarAssinatura.mock.calls[0]?.[0]).toMatchObject({ plano: { id: PREMIUM }, trialAte: null });
  });

  it("⭐ Assinar SEM escolher, no Teste: 409 escolha_um_plano — nunca se paga pelo plano de entrada", async () => {
    const res = await assinar();
    expect(res.status).toBe(409);
    expect((await erro(res)).code).toBe("escolha_um_plano");
    expect(h.ad.iniciarAssinatura).not.toHaveBeenCalled();
    // A reserva foi liberada.
    expect(argumentos(updates().at(-1)!, "update")?.[0]).toEqual({ checkout_expira_em: null });
  });

  it("⭐ plano menor que o uso: 409 com o excesso de canais e de pessoas, o uso e o teto — nada é trocado nem desconectado", async () => {
    uso = { assentos: 7, canais: 5 };
    const res = await assinar({ plano_id: ESSENCIAL });
    expect(res.status).toBe(409);
    expect(await erro(res)).toMatchObject({
      code: "plan_limit_reached",
      details: { excedente: { canais: 2, assentos: 2 }, uso: { canais: 5, assentos: 7 }, limites: { canais: 3, assentos: 5 } },
    });
    expect(updates()).toEqual([]);
    expect(h.banco.cadeias.some((c) => c.tabela === "channel_sessions" && operacao(c) !== "select")).toBe(false);
    expect(h.banco.cadeias.some((c) => c.tabela === "user_organizations" && operacao(c) !== "select")).toBe(false);
    expect(h.ad.iniciarAssinatura).not.toHaveBeenCalled();
  });

  it("plano não oferecido (negociado, ou o próprio Teste de outra empresa): 422 plano_invalido", async () => {
    linha = { ...NO_TESTE, plano_id: ESSENCIAL };
    expect((await erro(await assinar({ plano_id: NEGOCIADO }))).code).toBe("plano_invalido");
    expect((await erro(await assinar({ plano_id: TESTE }))).code).toBe("plano_invalido");
    expect(updates()).toEqual([]);
  });

  it("assinatura já criada no provedor: 409 assinatura_no_provedor (o caminho é Trocar de plano)", async () => {
    linha = { ...NO_TESTE, provedor: "stripe", provedor_cliente_id: "cus_1", provedor_assinatura_id: "sub_1" };
    expect((await erro(await assinar({ plano_id: ESSENCIAL }))).code).toBe("assinatura_no_provedor");
    expect(updates()).toEqual([]);
  });

  it("link do Teste ainda aberto: a sessão morre na Stripe ANTES da troca, e o link novo sai com o plano escolhido", async () => {
    linha = { ...NO_TESTE, provedor: "stripe", checkout_url: "https://checkout.stripe.com/c/pay/cs_0", checkout_expira_em: new Date(Date.now() + 3_600_000).toISOString(), checkout_sessao_id: "cs_0" };
    const res = await assinar({ plano_id: ESSENCIAL });
    expect(res.status).toBe(200);
    expect(h.ad.expirarSessao).toHaveBeenCalledWith("cs_0");
    expect((await res.json()).data.url).toBe("https://checkout.stripe.com/c/pay/cs_1");
  });

  it("plano_id que não é uuid: 400 (corpo estrito)", async () => {
    expect((await assinar({ plano_id: "essencial" })).status).toBe(400);
  });
});
