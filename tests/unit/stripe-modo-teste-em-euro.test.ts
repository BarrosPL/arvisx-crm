/**
 * ETAPA 4 (TAREFA-CLAUDE-PLANOS-STRIPE) — a Stripe em modo de teste, em euro.
 *
 * O que este arquivo prova, sem nenhuma chamada real (a Stripe aqui é um
 * `fetch` de mentira; o teste contra a conta de teste é scripts/smoke-stripe.ts
 * e o passo a passo de docs/arvisx/STRIPE-MODO-TESTE.md):
 *
 *   1. O produto e o preço saem DO PLANO. Um produto por plano, com id
 *      previsível (`dc_plano_<uuid>`), criado uma vez e só renomeado depois. O
 *      preço vai como `price_data` em cada Checkout e em cada troca: preço da
 *      Stripe é imutável, então mudar o valor é mandar um preço NOVO (nenhum id
 *      de preço é guardado no banco, e nenhum preço velho é reaproveitado).
 *   2. O webhook trata os eventos de euro como os de real: a assinatura do
 *      corpo é conferida e só o ponteiro {id, type} é gravado. Moeda e valor do
 *      corpo nunca viram estado; quem decide é a releitura (`lerSituacao`).
 *   3. A releitura de uma assinatura em euro lê o preço do item em centavos.
 *   4. O portal de gestão abre com o customer pedido e a configuração desta
 *      instalação (cartão, faturas e cancelamento no fim do período; troca de
 *      plano NÃO, que é da nossa tela).
 */
import { createHmac } from "node:crypto";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ModuloStripe from "@/lib/cobranca/provedores/stripe";
import { criarAdaptadorStripe, EVENTOS_DO_WEBHOOK_STRIPE } from "@/lib/cobranca/provedores/stripe";
import objetos from "@/tests/fixtures/stripe/objetos.json";
import { argumentos, bancoFalso, operacao, valorDoFiltro, type BancoFalso, type Cadeia, type Resposta } from "@/tests/helpers/banco-falso-da-cobranca";

// Montados em tempo de execução: literal de chave ou segredo no repositório
// dispara a varredura de segredo do GitHub no push (ver chave-stripe-de-teste-recusa-producao).
const CHAVE_TESTE = ["sk", "test", "51HfakeKeyForUnitTests00"].join("_");
const SEGREDO = ["whsec", "segredoDeMentiraDoTesteEmEuro"].join("_");

const h = vi.hoisted(() => ({ segredo: "", banco: undefined as unknown as BancoFalso }));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: async () => true }));
vi.mock("@/lib/cobranca/configuracao", () => ({ segredoDoWebhook: async () => h.segredo }));
vi.mock("@/lib/cobranca/provedores", async () => {
  const stripe = await vi.importActual<typeof ModuloStripe>("@/lib/cobranca/provedores/stripe");
  return { adaptador: () => ({ verificarWebhook: stripe.verificarWebhookStripe }) };
});
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.banco.cliente }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { POST as webhook } from "@/app/api/v1/webhooks/cobranca/[provedor]/route";

const PLANO = { id: "44444444-4444-4444-8444-444444444444", nome: "Essencial", precoCents: 5990, moeda: "EUR" as const, intervalo: "mes" as const };
const PRODUTO = `dc_plano_${PLANO.id}`;
const ORG = "55555555-5555-4555-8555-555555555555";
const CLIENTE = "cus_QfixtureClienteEuro";
const SESSAO = { id: "cs_test_euro", url: "https://checkout.stripe.com/c/pay/cs_test_euro", expires_at: 1790086400 };

type Rota = (url: URL, corpo: URLSearchParams) => { status?: number; corpo?: unknown };

/** Stripe de mentira: "MÉTODO /caminho" → resposta; o resto é 404 com o nome da rota. */
function montar(rotas: Record<string, Rota>) {
  const chamadas: Array<{ rota: string; url: URL; corpo: URLSearchParams }> = [];
  const fetchFalso: typeof fetch = async (entrada, init) => {
    const url = new URL(String(entrada));
    const rota = `${init?.method ?? "GET"} ${url.pathname.replace(/^\/v1/, "")}`;
    const corpo = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    chamadas.push({ rota, url, corpo });
    const r = rotas[rota]?.(url, corpo);
    if (!r) return Response.json({ error: { code: `rota_nao_declarada:${rota}` } }, { status: 404 });
    return Response.json(r.corpo ?? {}, { status: r.status ?? 200 });
  };
  const adaptador = criarAdaptadorStripe({
    lerChave: async () => CHAVE_TESTE,
    fetch: fetchFalso,
    esperar: async () => {},
    agora: () => new Date("2026-11-09T12:00:00Z"),
    novaChaveDeIdempotencia: () => "idem-fixa",
    marca: "a1b2c3d4e5f60718",
  });
  return { adaptador, chamadas };
}

const doCorpo = (c: { corpo: URLSearchParams } | undefined) => Object.fromEntries(c?.corpo ?? []);

describe("produto e preço em euro a partir do plano", () => {
  const assinar = { clienteRef: CLIENTE, orgId: ORG, trialAte: null, urlDeVolta: "https://crm.example.com/cobranca/volta?para=painel", chaveIdempotencia: "3f1c2d4e-0000-4000-8000-0000000000e4" };

  it("⭐ 1º Checkout: cria o produto do plano (id previsível, nome, plano_id) e o preço em eur, mensal, no valor do plano", async () => {
    const { adaptador, chamadas } = montar({
      "POST /products": () => ({ corpo: { id: PRODUTO } }),
      "POST /checkout/sessions": () => ({ corpo: SESSAO }),
    });
    await adaptador.iniciarAssinatura({ ...assinar, plano: PLANO });
    expect(doCorpo(chamadas.find((c) => c.rota === "POST /products"))).toEqual({ id: PRODUTO, name: "Essencial", "metadata[plano_id]": PLANO.id });
    expect(doCorpo(chamadas.find((c) => c.rota === "POST /checkout/sessions"))).toMatchObject({
      mode: "subscription",
      customer: CLIENTE,
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": "5990",
      "line_items[0][price_data][recurring][interval]": "month",
      "line_items[0][price_data][product]": PRODUTO,
    });
  });

  it("⭐ valor mudou (plano sem assinantes): o produto é o MESMO, só renomeado, e o preço sai NOVO com o valor novo", async () => {
    const { adaptador, chamadas } = montar({
      "POST /products": () => ({ status: 400, corpo: { error: { code: "resource_already_exists" } } }),
      [`POST /products/${PRODUTO}`]: () => ({ corpo: { id: PRODUTO } }),
      "POST /checkout/sessions": () => ({ corpo: SESSAO }),
    });
    await adaptador.iniciarAssinatura({ ...assinar, plano: PLANO });
    await adaptador.iniciarAssinatura({ ...assinar, plano: { ...PLANO, nome: "Essencial+", precoCents: 6990 } });
    const checkouts = chamadas.filter((c) => c.rota === "POST /checkout/sessions").map(doCorpo);
    expect(checkouts.map((c) => [c["line_items[0][price_data][currency]"], c["line_items[0][price_data][unit_amount]"]])).toEqual([
      ["eur", "5990"],
      ["eur", "6990"],
    ]);
    // Nenhum id de preço circula: cada Checkout leva o seu price_data, nunca `price`.
    expect(checkouts.every((c) => !("line_items[0][price]" in c))).toBe(true);
    const renomes = chamadas.filter((c) => c.rota === `POST /products/${PRODUTO}`).map(doCorpo);
    expect(renomes.at(-1)).toEqual({ name: "Essencial+", active: "true" });
  });

  it("⭐ troca de plano em curso: preço NOVO em eur no mesmo item da assinatura, sem proração", async () => {
    const assinatura = {
      ...objetos.assinatura,
      items: { ...objetos.assinatura.items, data: [{ ...objetos.assinatura.items.data[0]!, price: { ...objetos.assinatura.items.data[0]!.price, currency: "eur", unit_amount: 5990 } }] },
    };
    const { adaptador, chamadas } = montar({
      "GET /subscriptions/sub_1QfixtureAtiva": () => ({ corpo: assinatura }),
      "POST /products": () => ({ corpo: { id: "dc_plano_x" } }),
      "POST /subscriptions/sub_1QfixtureAtiva": () => ({ corpo: assinatura }),
    });
    const standard = { id: "66666666-6666-4666-8666-666666666666", nome: "Standard", precoCents: 12990, moeda: "EUR" as const, intervalo: "mes" as const };
    await adaptador.trocarPlano({ assinaturaRef: "sub_1QfixtureAtiva", plano: standard });
    expect(doCorpo(chamadas.find((c) => c.rota === "POST /subscriptions/sub_1QfixtureAtiva"))).toEqual({
      "items[0][id]": "si_QfixtureItem",
      "items[0][price_data][currency]": "eur",
      "items[0][price_data][unit_amount]": "12990",
      "items[0][price_data][recurring][interval]": "month",
      "items[0][price_data][product]": `dc_plano_${standard.id}`,
      proration_behavior: "none",
      "metadata[plano_id]": standard.id,
    });
  });

  it("releitura de assinatura em euro: existe, em dia, e o preço do item (5990) é o que a conferência compara com o plano", async () => {
    const assinatura = {
      ...objetos.assinatura,
      items: { ...objetos.assinatura.items, data: [{ ...objetos.assinatura.items.data[0]!, price: { ...objetos.assinatura.items.data[0]!.price, currency: "eur", unit_amount: 5990 } }] },
    };
    const lista = (...data: unknown[]) => ({ corpo: { object: "list", data, has_more: false } });
    const { adaptador } = montar({
      "GET /subscriptions": () => lista(assinatura),
      "GET /invoices": (url) => (url.searchParams.get("status") === "paid" ? lista({ ...objetos.fatura, amount_paid: 5990 }) : lista()),
    });
    expect(await adaptador.lerSituacao({ clienteRef: CLIENTE })).toMatchObject({ existe: true, emAtraso: false, jaPagou: true, precoCents: 5990, statusBruto: "active" });
  });

  it("⭐ portal de gestão: sessão com o customer pedido, a volta para Plano e cobrança e a configuração DESTA instalação", async () => {
    const { adaptador, chamadas } = montar({
      "GET /billing_portal/configurations": () => ({ corpo: { object: "list", data: [], has_more: false } }),
      "POST /billing_portal/configurations": () => ({ corpo: { id: "bpc_nossa" } }),
      "POST /billing_portal/sessions": () => ({ corpo: { url: "https://billing.stripe.com/p/session/test_x" } }),
    });
    const url = await adaptador.urlDeGerenciar({ clienteRef: CLIENTE, urlDeVolta: assinar.urlDeVolta });
    expect(url).toBe("https://billing.stripe.com/p/session/test_x");
    expect(doCorpo(chamadas.find((c) => c.rota === "POST /billing_portal/sessions"))).toEqual({
      customer: CLIENTE,
      return_url: assinar.urlDeVolta,
      configuration: "bpc_nossa",
    });
    expect(doCorpo(chamadas.find((c) => c.rota === "POST /billing_portal/configurations"))).toMatchObject({
      "features[payment_method_update][enabled]": "true",
      "features[invoice_history][enabled]": "true",
      "features[subscription_cancel][enabled]": "true",
      "features[subscription_cancel][mode]": "at_period_end",
      "features[subscription_update][enabled]": "false",
    });
  });
});

describe("webhook da Stripe com eventos em euro", () => {
  const EVENTOS_EM_EURO: Array<[string, Record<string, unknown>]> = [
    ["checkout.session.completed", { id: "cs_test_euro", object: "checkout.session", customer: CLIENTE, mode: "subscription", currency: "eur", amount_total: 5990 }],
    ["invoice.paid", { id: "in_euro", object: "invoice", customer: CLIENTE, currency: "eur", amount_paid: 5990, status: "paid" }],
    ["invoice.payment_failed", { id: "in_euro", object: "invoice", customer: CLIENTE, currency: "eur", amount_due: 5990, status: "open" }],
    ["customer.subscription.updated", { id: "sub_euro", object: "subscription", customer: CLIENTE, currency: "eur", status: "active", cancel_at_period_end: true }],
    ["customer.subscription.deleted", { id: "sub_euro", object: "subscription", customer: CLIENTE, currency: "eur", status: "canceled" }],
  ];

  function responder(c: Cadeia): Resposta {
    if (c.tabela === "webhook_events_log") return operacao(c) === "insert" ? { data: { id: "linha-1", status: "received" } } : { data: null };
    if (c.tabela === "cobranca_assinaturas") return { data: { organization_id: ORG } };
    return {};
  }

  function assinado(tipo: string, objeto: Record<string, unknown>, segredo = SEGREDO) {
    const corpo = JSON.stringify({ id: `evt_${tipo.replace(/\W/g, "_")}`, object: "event", livemode: false, type: tipo, data: { object: objeto } });
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", segredo).update(`${t}.${corpo}`, "utf8").digest("hex");
    return new NextRequest("http://localhost/api/v1/webhooks/cobranca/stripe", { method: "POST", body: corpo, headers: { "stripe-signature": `t=${t},v1=${v1}` } });
  }

  beforeEach(() => {
    h.segredo = SEGREDO;
    h.banco = bancoFalso(responder, () => ({ data: "ev-1" }));
  });

  it("os cinco eventos estão entre os que a conexão assina no endpoint", () => {
    for (const [tipo] of EVENTOS_EM_EURO) expect(EVENTOS_DO_WEBHOOK_STRIPE).toContain(tipo);
  });

  it.each(EVENTOS_EM_EURO)("⭐ %s em eur: assinatura conferida, ponteiro {id,type} sem moeda nem valor, sinal para a empresa dona do customer", async (tipo, objeto) => {
    const res = await webhook(assinado(tipo, objeto), { params: Promise.resolve({ provedor: "stripe" }) });
    expect(res.status).toBe(200);
    const insert = h.banco.cadeias.find((c) => c.tabela === "webhook_events_log" && operacao(c) === "insert");
    const linha = argumentos(insert!, "insert")?.[0] as Record<string, unknown>;
    expect(linha).toMatchObject({ provider: "stripe", valid_signature: true, event_type: tipo, organization_id: null });
    expect(String(linha.raw_body)).not.toMatch(/eur|5990/);
    const dona = h.banco.cadeias.find((c) => c.tabela === "cobranca_assinaturas");
    expect(dona && valorDoFiltro(dona, "eq", "provedor_cliente_id")).toBe(CLIENTE);
    expect(h.banco.rpcs.find((r) => r.nome === "emit_event")?.args).toMatchObject({
      p_event_type: "cobranca.sinal",
      p_organization_id: ORG,
      p_payload: { provedor: "stripe", tipo },
    });
  });

  it("evento em euro assinado com OUTRO segredo (o do `stripe listen`, por exemplo): 401 e nenhum sinal", async () => {
    const outro = ["whsec", "doStripeListenNaoGravadoNoPainel"].join("_");
    const res = await webhook(assinado("invoice.paid", EVENTOS_EM_EURO[1]![1], outro), { params: Promise.resolve({ provedor: "stripe" }) });
    expect(res.status).toBe(401);
    expect(h.banco.rpcs.filter((r) => r.nome === "emit_event")).toEqual([]);
  });
});
