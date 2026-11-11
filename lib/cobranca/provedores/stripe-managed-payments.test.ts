import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import objetos from "@/tests/fixtures/stripe/objetos.json";
import type { ModoFiscal } from "@/lib/cobranca/vocabulario";

import { CODIGO_FISCAL_DO_PLANO, criarAdaptadorStripe, idDoProdutoDoPlano, modoFiscalDoPlano } from "./stripe";

/**
 * STRIPE MANAGED PAYMENTS NO ADAPTADOR (ArvisX, migration 9807).
 *
 * O corpo de cada sessão de Checkout, POR MODO FISCAL, conferido inteiro
 * (`toEqual`): parâmetro a mais é parâmetro que a Stripe recusa em Managed
 * Payments (docs.stripe.com/payments/managed-payments/update-checkout). Nenhuma
 * chamada real: é uma Stripe de mentira. O que NÃO foi provado contra a conta
 * real está em docs/arvisx/STRIPE-MANAGED-PAYMENTS.md.
 */
const CHAVE_TESTE = ["sk", "test", "51HfakeKeyForUnitTests00"].join("_");
const ORG = "11111111-1111-4111-8111-111111111111";
const PLANO = { id: "22222222-2222-4222-8222-222222222222", nome: "Premium", precoCents: 19990, moeda: "EUR" as const, intervalo: "mes" as const };
/** O plano com serviço sob medida: fora do Managed Payments. */
const EQUIPE = { ...PLANO, id: "44444444-4444-4444-8444-444444444444", nome: "Equipe Completa", precoCents: 49990, foraDoManagedPayments: true };
const base = {
  clienteRef: "cus_QfixtureCliente",
  orgId: ORG,
  plano: PLANO,
  trialAte: null,
  urlDeVolta: "https://crm.example.com/app/settings/billing",
  chaveIdempotencia: "3f1c2d4e-0000-4000-8000-000000000001",
};

type Chamada = { rota: string; corpo: URLSearchParams };

/** Uma conta com estado: produtos e assinaturas vivem entre as chamadas, como na Stripe. */
function conta(modo: ModoFiscal, assinaturas: Record<string, Record<string, string>> = {}) {
  const produtos = new Map<string, Record<string, string>>();
  const chamadas: Chamada[] = [];
  const fetchFalso: typeof fetch = async (entrada, init) => {
    const url = new URL(String(entrada));
    const caminho = url.pathname.replace(/^\/v1/, "");
    const metodo = init?.method ?? "GET";
    const corpo = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    chamadas.push({ rota: `${metodo} ${caminho}`, corpo });
    if (metodo === "POST" && caminho === "/products") {
      const id = corpo.get("id") ?? "";
      if (produtos.has(id)) return Response.json({ error: { code: "resource_already_exists" } }, { status: 400 });
      produtos.set(id, Object.fromEntries(corpo));
      return Response.json({ id });
    }
    if (metodo === "POST" && caminho.startsWith("/products/")) {
      const id = caminho.split("/")[2] ?? "";
      if (!produtos.has(id)) return Response.json({ error: { code: "resource_missing" } }, { status: 404 });
      produtos.set(id, { ...produtos.get(id), ...Object.fromEntries(corpo) });
      return Response.json({ id });
    }
    if (metodo === "POST" && caminho === "/checkout/sessions") {
      return Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1", expires_at: 1790086400 });
    }
    const sub = /^\/subscriptions\/([^/]+)$/.exec(caminho)?.[1];
    if (sub && assinaturas[sub]) return Response.json({ ...objetos.assinatura, id: sub, metadata: assinaturas[sub] });
    return Response.json({ error: { code: `rota_nao_declarada:${metodo} ${caminho}` } }, { status: 404 });
  };
  const adaptador = criarAdaptadorStripe({
    lerChave: async () => CHAVE_TESTE,
    fetch: fetchFalso,
    esperar: async () => undefined,
    agora: () => new Date("2026-10-01T12:00:00Z"),
    novaChaveDeIdempotencia: () => "idem-fixa",
    marca: "a1b2c3d4e5f60718",
    modoFiscal: async () => modo,
  });
  const checkout = () => Object.fromEntries(chamadas.find((c) => c.rota === "POST /checkout/sessions")?.corpo ?? []);
  return { adaptador, chamadas, produtos, checkout };
}

/**
 * Tudo que a Stripe recusa numa sessão de Managed Payments (assinatura e
 * pagamento avulso), mais os parâmetros de Connect. A lista é a da doc.
 */
const PROIBIDOS_EM_MANAGED_PAYMENTS = [
  /^automatic_tax/,
  /^tax_id_collection/,
  /^customer_update\[(name|address)\]/,
  /^adaptive_pricing/,
  /^payment_method_types/,
  /^payment_method_configuration/,
  /^excluded_payment_method_types/,
  /^subscription_data\[default_tax_rates\]/,
  /^subscription_data\[invoice_settings\]/,
  /^invoice_creation/,
  /^payment_intent_data\[(statement_descriptor|statement_descriptor_suffix|receipt_email|shipping)\]/,
  /^shipping_address_collection/,
  /^shipping_options/,
  /application_fee/,
  /on_behalf_of/,
  /transfer_data/,
  /transfer_group/,
];
const proibidosEm = (corpo: Record<string, string>) => Object.keys(corpo).filter((k) => PROIBIDOS_EM_MANAGED_PAYMENTS.some((r) => r.test(k)));

/** O que a sessão de assinatura sempre leva, em qualquer modo. */
const assinaturaComum = (plano: typeof PLANO, modo: ModoFiscal) => ({
  mode: "subscription",
  customer: "cus_QfixtureCliente",
  client_reference_id: ORG,
  "line_items[0][price_data][currency]": "eur",
  "line_items[0][price_data][unit_amount]": String(plano.precoCents),
  "line_items[0][price_data][recurring][interval]": "month",
  "line_items[0][price_data][product]": `dc_plano_${plano.id}`,
  "line_items[0][quantity]": "1",
  "subscription_data[metadata][organization_id]": ORG,
  "subscription_data[metadata][plano_id]": plano.id,
  "subscription_data[metadata][modo_fiscal]": modo,
  "metadata[organization_id]": ORG,
  "metadata[plano_id]": plano.id,
  success_url: "https://crm.example.com/app/settings/billing?voltou=1",
  cancel_url: "https://crm.example.com/app/settings/billing",
  locale: "pt-BR",
});
/** O que a sessão avulsa (ajuste proporcional) sempre leva. */
const avulsaComum = (plano: typeof PLANO) => ({
  mode: "payment",
  customer: "cus_QfixtureCliente",
  client_reference_id: ORG,
  "line_items[0][price_data][currency]": "eur",
  "line_items[0][price_data][unit_amount]": "3065",
  "line_items[0][price_data][product]": `dc_plano_${plano.id}`,
  "line_items[0][quantity]": "1",
  "metadata[organization_id]": ORG,
  "metadata[plano_id]": plano.id,
  "metadata[tipo]": "ajuste_proporcional",
  success_url: "https://crm.example.com/app/settings/billing?voltou=1",
  cancel_url: "https://crm.example.com/app/settings/billing",
  locale: "pt-BR",
});
/** O que o modo `stripe_tax` acrescenta à sessão (o Checkout "com IVA" de antes da 9807). */
const STRIPE_TAX = {
  "automatic_tax[enabled]": "true",
  billing_address_collection: "required",
  "customer_update[address]": "auto",
  "customer_update[name]": "auto",
  "tax_id_collection[enabled]": "true",
};

describe("o corpo da sessão de Checkout, por modo fiscal", () => {
  it("⭐ managed_payments, assinatura: managed_payments[enabled]=true, preço sem imposto, e NENHUM parâmetro proibido", async () => {
    const c = conta("managed_payments");
    await c.adaptador.iniciarAssinatura(base);
    expect(c.checkout()).toEqual({
      ...assinaturaComum(PLANO, "managed_payments"),
      "line_items[0][price_data][tax_behavior]": "exclusive",
      "managed_payments[enabled]": "true",
    });
    expect(proibidosEm(c.checkout())).toEqual([]);
  });

  it("⭐ managed_payments, pagamento avulso (ajuste proporcional): managed_payments[enabled]=true e NENHUM parâmetro proibido", async () => {
    const c = conta("managed_payments");
    await c.adaptador.iniciarAjusteProporcional({ ...base, valorCents: 3065 });
    expect(c.checkout()).toEqual({
      ...avulsaComum(PLANO),
      "line_items[0][price_data][tax_behavior]": "exclusive",
      "managed_payments[enabled]": "true",
    });
    expect(proibidosEm(c.checkout())).toEqual([]);
  });

  it("managed_payments com teste grátis: o trial_end segue indo (não é parâmetro proibido)", async () => {
    const c = conta("managed_payments");
    const fimDoTeste = new Date("2026-10-08T12:00:00Z");
    await c.adaptador.iniciarAssinatura({ ...base, trialAte: fimDoTeste });
    expect(c.checkout()["subscription_data[trial_end]"]).toBe(String(Math.floor(fimDoTeste.getTime() / 1000)));
    expect(proibidosEm(c.checkout())).toEqual([]);
  });

  it("⭐ stripe_tax, assinatura: igual a antes (imposto automático, endereço, número fiscal) + managed_payments[enabled]=false", async () => {
    const c = conta("stripe_tax");
    await c.adaptador.iniciarAssinatura(base);
    expect(c.checkout()).toEqual({
      ...assinaturaComum(PLANO, "stripe_tax"),
      "line_items[0][price_data][tax_behavior]": "exclusive",
      ...STRIPE_TAX,
      "managed_payments[enabled]": "false",
    });
  });

  it("stripe_tax, pagamento avulso: igual a antes + managed_payments[enabled]=false", async () => {
    const c = conta("stripe_tax");
    await c.adaptador.iniciarAjusteProporcional({ ...base, valorCents: 3065 });
    expect(c.checkout()).toEqual({
      ...avulsaComum(PLANO),
      "line_items[0][price_data][tax_behavior]": "exclusive",
      ...STRIPE_TAX,
      "managed_payments[enabled]": "false",
    });
  });

  it("⭐ desligado, assinatura: igual a antes (nada de imposto) + managed_payments[enabled]=false", async () => {
    const c = conta("desligado");
    await c.adaptador.iniciarAssinatura(base);
    expect(c.checkout()).toEqual({ ...assinaturaComum(PLANO, "desligado"), "managed_payments[enabled]": "false" });
  });

  it("desligado, pagamento avulso: igual a antes + managed_payments[enabled]=false", async () => {
    const c = conta("desligado");
    await c.adaptador.iniciarAjusteProporcional({ ...base, valorCents: 3065 });
    expect(c.checkout()).toEqual({ ...avulsaComum(PLANO), "managed_payments[enabled]": "false" });
  });

  it("sem `modoFiscal` injetado: vale desligado (o padrão das instalações novas)", async () => {
    const c = conta("desligado");
    const semModo = criarAdaptadorStripe({
      lerChave: async () => CHAVE_TESTE,
      fetch: async (entrada, init) => {
        const corpo = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
        c.chamadas.push({ rota: `${init?.method} ${new URL(String(entrada)).pathname.replace(/^\/v1/, "")}`, corpo });
        return Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1", expires_at: 1790086400 });
      },
      marca: "a1b2c3d4e5f60718",
    });
    await semModo.iniciarAssinatura(base);
    expect(c.checkout()["managed_payments[enabled]"]).toBe("false");
    expect(c.checkout()["subscription_data[metadata][modo_fiscal]"]).toBe("desligado");
  });
});

describe("plano fora do Managed Payments (Equipe Completa)", () => {
  it("⭐ com a instalação em managed_payments, o plano com a marca é vendido por stripe_tax (assinatura)", async () => {
    const c = conta("managed_payments");
    await c.adaptador.iniciarAssinatura({ ...base, plano: EQUIPE });
    expect(c.checkout()).toEqual({
      ...assinaturaComum(EQUIPE, "stripe_tax"),
      "line_items[0][price_data][tax_behavior]": "exclusive",
      ...STRIPE_TAX,
      "managed_payments[enabled]": "false",
    });
  });

  it("e o ajuste proporcional dele também sai por stripe_tax", async () => {
    const c = conta("managed_payments");
    await c.adaptador.iniciarAjusteProporcional({ ...base, plano: EQUIPE, valorCents: 3065 });
    expect(c.checkout()).toMatchObject({ ...STRIPE_TAX, "managed_payments[enabled]": "false" });
  });

  it("a marca só pesa em managed_payments: desligado segue desligado e stripe_tax segue stripe_tax", () => {
    expect(modoFiscalDoPlano("managed_payments", { foraDoManagedPayments: true })).toBe("stripe_tax");
    expect(modoFiscalDoPlano("managed_payments", { foraDoManagedPayments: false })).toBe("managed_payments");
    expect(modoFiscalDoPlano("managed_payments", {})).toBe("managed_payments");
    expect(modoFiscalDoPlano("desligado", { foraDoManagedPayments: true })).toBe("desligado");
    expect(modoFiscalDoPlano("stripe_tax", { foraDoManagedPayments: true })).toBe("stripe_tax");
  });
});

describe("o produto do plano leva o código fiscal", () => {
  const ID = `dc_plano_${PLANO.id}`;

  it("⭐ criação: id fixo do plano, nome, tax_code txcd_10103001 e o plano no metadata", async () => {
    const c = conta("desligado");
    await c.adaptador.iniciarAssinatura(base);
    expect(CODIGO_FISCAL_DO_PLANO).toBe("txcd_10103001");
    expect(idDoProdutoDoPlano(PLANO.id)).toBe(ID);
    expect(c.chamadas[0]?.rota).toBe("POST /products");
    expect(Object.fromEntries(c.chamadas[0]?.corpo ?? [])).toEqual({
      id: ID, name: "Premium", tax_code: "txcd_10103001", "metadata[plano_id]": PLANO.id,
    });
  });

  it("⭐ produto que já existe (criado antes do código): o update leva o tax_code, no MESMO id, sem criar outro", async () => {
    const c = conta("desligado");
    c.produtos.set(ID, { id: ID, name: "Nome antigo" });
    await c.adaptador.iniciarAssinatura(base);
    expect(c.chamadas.map((x) => x.rota)).toEqual(["POST /products", `POST /products/${ID}`, "POST /checkout/sessions"]);
    expect(Object.fromEntries(c.chamadas[1]?.corpo ?? [])).toEqual({ name: "Premium", active: "true", tax_code: "txcd_10103001" });
    expect([...c.produtos.keys()]).toEqual([ID]);
    expect(c.produtos.get(ID)).toMatchObject({ name: "Premium", tax_code: "txcd_10103001" });
    expect(c.checkout()["line_items[0][price_data][product]"]).toBe(ID);
  });

  it("⭐ sincronizarProduto é idempotente: a 1ª cria, as seguintes atualizam, e a conta segue com UM produto por plano", async () => {
    const c = conta("managed_payments");
    expect(await c.adaptador.sincronizarProduto!(PLANO)).toBe("criado");
    expect(await c.adaptador.sincronizarProduto!(PLANO)).toBe("atualizado");
    expect(await c.adaptador.sincronizarProduto!({ ...PLANO, nome: "Premium 2" })).toBe("atualizado");
    expect(await c.adaptador.sincronizarProduto!(EQUIPE)).toBe("criado");
    expect([...c.produtos.keys()]).toEqual([ID, `dc_plano_${EQUIPE.id}`]);
    expect(c.produtos.get(ID)).toMatchObject({ name: "Premium 2", tax_code: "txcd_10103001" });
    // O plano fora do Managed Payments também leva o código: a Stripe Tax o usa para a alíquota.
    expect(c.produtos.get(`dc_plano_${EQUIPE.id}`)).toMatchObject({ tax_code: "txcd_10103001" });
  });

  it("id de plano que não é uuid nunca vira id de produto", async () => {
    const c = conta("desligado");
    await expect(c.adaptador.sincronizarProduto!({ ...PLANO, id: "x/../y" })).rejects.toThrow();
    expect(c.chamadas).toHaveLength(0);
  });

  it("recusa da Stripe que não é 'já existe' sobe (ex.: chave restrita sem permissão de produto)", async () => {
    const adaptador = criarAdaptadorStripe({
      lerChave: async () => CHAVE_TESTE,
      fetch: async () => Response.json({ error: { code: "permission_error" } }, { status: 403 }),
      marca: "a1b2c3d4e5f60718",
    });
    await expect(adaptador.sincronizarProduto!(PLANO)).rejects.toMatchObject({ status: 403, codigo: "permission_error", credencialInvalida: true });
  });
});

describe("trocarPlano e o ajuste em assinatura de Managed Payments", () => {
  const SUB_MP = { sub_mp: { organization_id: ORG, plano_id: PLANO.id, modo_fiscal: "managed_payments" } };
  const SUB_TAX = { sub_tax: { organization_id: ORG, plano_id: PLANO.id, modo_fiscal: "stripe_tax" } };
  const SUB_ANTIGA = { sub_antiga: { organization_id: ORG, plano_id: PLANO.id } };
  const NOVO = { ...PLANO, id: "33333333-3333-4333-8333-333333333333", nome: "Max", precoCents: 29990 };
  const troca = (c: ReturnType<typeof conta>, sub: string) =>
    Object.fromEntries(c.chamadas.find((x) => x.rota === `POST /subscriptions/${sub}`)?.corpo ?? []);

  it("⭐ assinatura de Managed Payments: mesmo tax_behavior (exclusive), sem automatic_tax e sem default_payment_method", async () => {
    // A instalação voltou a stripe_tax depois: a assinatura segue no modo em que foi vendida.
    const c = conta("stripe_tax", SUB_MP);
    await c.adaptador.trocarPlano({ assinaturaRef: "sub_mp", plano: NOVO });
    expect(troca(c, "sub_mp")).toEqual({
      "items[0][id]": "si_QfixtureItem",
      "items[0][price_data][currency]": "eur",
      "items[0][price_data][unit_amount]": "29990",
      "items[0][price_data][recurring][interval]": "month",
      "items[0][price_data][product]": `dc_plano_${NOVO.id}`,
      "items[0][price_data][tax_behavior]": "exclusive",
      proration_behavior: "none",
      "metadata[plano_id]": NOVO.id,
    });
  });

  it("⭐ Managed Payments → plano fora dele: recusa troca_exige_novo_checkout, sem tocar em produto nem em preço", async () => {
    const c = conta("managed_payments", SUB_MP);
    await expect(c.adaptador.trocarPlano({ assinaturaRef: "sub_mp", plano: EQUIPE })).rejects.toMatchObject({
      status: 409, codigo: "troca_exige_novo_checkout", transitorio: false,
    });
    expect(c.chamadas.map((x) => x.rota)).toEqual(["GET /subscriptions/sub_mp"]);
  });

  it("assinatura de stripe_tax → plano dentro do Managed Payments: troca, e segue em stripe_tax (o modo da assinatura não muda)", async () => {
    const c = conta("managed_payments", SUB_TAX);
    await c.adaptador.trocarPlano({ assinaturaRef: "sub_tax", plano: NOVO });
    expect(troca(c, "sub_tax")).toMatchObject({ "items[0][price_data][tax_behavior]": "exclusive" });
    expect(Object.keys(troca(c, "sub_tax")).some((k) => /managed_payments|automatic_tax|default_payment_method/.test(k))).toBe(false);
  });

  it("assinatura anterior à 9807 (sem modo gravado): vale o modo de hoje — desligado não põe tax_behavior, com imposto põe", async () => {
    const sem = conta("desligado", SUB_ANTIGA);
    await sem.adaptador.trocarPlano({ assinaturaRef: "sub_antiga", plano: NOVO });
    expect(Object.keys(troca(sem, "sub_antiga")).some((k) => k.includes("tax_behavior"))).toBe(false);
    const com = conta("managed_payments", SUB_ANTIGA);
    await com.adaptador.trocarPlano({ assinaturaRef: "sub_antiga", plano: NOVO });
    expect(troca(com, "sub_antiga")).toMatchObject({ "items[0][price_data][tax_behavior]": "exclusive" });
    // E ela NÃO é de Managed Payments: ir para um plano fora dele é troca comum.
    const fora = conta("managed_payments", SUB_ANTIGA);
    await expect(fora.adaptador.trocarPlano({ assinaturaRef: "sub_antiga", plano: EQUIPE })).resolves.toBeUndefined();
  });

  it("⭐ trocaExigeNovoCheckout: só a assinatura de Managed Payments indo para plano fora dele; plano sem a marca nem consulta a Stripe", async () => {
    const mp = conta("managed_payments", SUB_MP);
    expect(await mp.adaptador.trocaExigeNovoCheckout!({ assinaturaRef: "sub_mp", plano: NOVO })).toBe(false);
    expect(mp.chamadas).toHaveLength(0);
    expect(await mp.adaptador.trocaExigeNovoCheckout!({ assinaturaRef: "sub_mp", plano: EQUIPE })).toBe(true);
    const tax = conta("managed_payments", SUB_TAX);
    expect(await tax.adaptador.trocaExigeNovoCheckout!({ assinaturaRef: "sub_tax", plano: EQUIPE })).toBe(false);
    const antiga = conta("managed_payments", SUB_ANTIGA);
    expect(await antiga.adaptador.trocaExigeNovoCheckout!({ assinaturaRef: "sub_antiga", plano: EQUIPE })).toBe(false);
  });

  it("⭐ o ajuste proporcional segue o modo da ASSINATURA, não o de hoje da instalação", async () => {
    const mp = conta("stripe_tax", SUB_MP);
    await mp.adaptador.iniciarAjusteProporcional({ ...base, plano: NOVO, valorCents: 3065, assinaturaRef: "sub_mp" });
    expect(mp.checkout()).toMatchObject({ "managed_payments[enabled]": "true" });
    expect(proibidosEm(mp.checkout())).toEqual([]);
    const tax = conta("managed_payments", SUB_TAX);
    await tax.adaptador.iniciarAjusteProporcional({ ...base, plano: NOVO, valorCents: 3065, assinaturaRef: "sub_tax" });
    expect(tax.checkout()).toMatchObject({ ...STRIPE_TAX, "managed_payments[enabled]": "false" });
  });

  it("⭐ ajuste para plano fora do Managed Payments numa assinatura dele: recusa ANTES de criar a cobrança", async () => {
    const c = conta("managed_payments", SUB_MP);
    await expect(
      c.adaptador.iniciarAjusteProporcional({ ...base, plano: EQUIPE, valorCents: 3065, assinaturaRef: "sub_mp" }),
    ).rejects.toMatchObject({ codigo: "troca_exige_novo_checkout" });
    expect(c.chamadas.some((x) => x.rota === "POST /checkout/sessions")).toBe(false);
  });

  it("o adaptador nunca manda default_payment_method (em Managed Payments a Stripe proíbe; o cartão troca pelo Portal)", () => {
    const fonte = readFileSync(join(__dirname, "stripe.ts"), "utf8");
    const semProsa = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(semProsa).not.toContain("default_payment_method");
    // E o Portal segue sendo o caminho da troca de cartão.
    expect(semProsa).toContain("payment_method_update: { enabled: true }");
  });
});
