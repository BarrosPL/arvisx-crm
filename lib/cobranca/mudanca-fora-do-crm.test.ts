import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import objetos from "@/tests/fixtures/stripe/objetos.json";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { argumentos, bancoFalso, operacao, type BancoFalso, type Cadeia, type Resposta } from "@/tests/helpers/banco-falso-da-cobranca";

const h = vi.hoisted(() => ({ audit: vi.fn(), banco: undefined as unknown as BancoFalso, adaptador: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/auth/cache-curto", () => ({ invalidarOrg: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.banco.cliente }));
vi.mock("@/lib/cobranca/emails", () => ({ enviarAvisoAosAdmins: vi.fn() }));
vi.mock("@/lib/cobranca/configuracao", () => ({ toleranciaDias: async () => 7 }));
vi.mock("@/lib/cobranca/provedores", () => ({ adaptador: h.adaptador }));

import { criarAdaptadorStripe, verificarWebhookStripe } from "@/lib/cobranca/provedores/stripe";

import { cobrancaSinalHandler } from "./sinal.handler";

/**
 * MUDANÇA FEITA FORA DO CRM (ArvisX, Managed Payments).
 *
 * Com Managed Payments o cliente também gerencia a assinatura pelo site da Link
 * (cancela, altera), sem passar pelo CRM. A Stripe avisa por
 * `customer.subscription.updated` / `customer.subscription.deleted`; o aviso só
 * ACORDA a leitura, e quem decide é `lerSituacao`, relendo a API.
 *
 * O caminho inteiro, com as peças REAIS: evento assinado → `verificarWebhook` →
 * `cobranca.sinal` → `cobrancaSinalHandler` → `sincronizar` → adaptador da Stripe
 * (sobre uma Stripe de mentira) → a linha de `cobranca_assinaturas`.
 */
const ORG = "dddddddd-0000-4000-8000-000000000001";
const CLIENTE = "cus_QfixtureCliente";
const SEGREDO = ["whsec", "fixtureSegredoNovo0000000000"].join("_");
const CHAVE_TESTE = ["sk", "test", "51HfakeKeyForUnitTests00"].join("_");
const HA_UMA_HORA = () => new Date(Date.now() - 3_600_000).toISOString();

type Assinatura = Record<string, unknown>;
/** O que a Stripe responde AGORA para as assinaturas do cliente (o estado depois da mudança na Link). */
let naStripe: Assinatura[];
let linha: Record<string, unknown>;
let plano: { id: string; preco_cents: number };

const assinaturaDeMp = (o: Assinatura = {}): Assinatura => ({
  ...objetos.assinatura,
  metadata: { ...objetos.assinatura.metadata, modo_fiscal: "managed_payments" },
  ...o,
});

function responder(c: Cadeia): Resposta {
  if (c.tabela === "organizations") return { data: { status: "active", suspended_kind: null, locale: "pt-BR", timezone: "Europe/Lisbon" } };
  if (c.tabela === "agent_inbox_items") return { data: null };
  if (c.tabela === "cobranca_planos") return { data: plano };
  if (operacao(c) === "select") return { data: linha };
  linha = { ...linha, ...(argumentos(c, "update")?.[0] as Record<string, unknown>) };
  return { data: { organization_id: ORG } };
}

/** O evento como a Stripe o entrega: assinado no corpo cru. Devolve o sinal que a rota do webhook emitiria. */
function avisoDaStripe(tipo: string) {
  const corpo = JSON.stringify({
    id: `evt_${tipo.replace(/\W/g, "_")}`, object: "event", type: tipo,
    data: { object: { id: "sub_1QfixtureAtiva", object: "subscription", customer: CLIENTE } },
  });
  const agora = new Date();
  const t = Math.floor(agora.getTime() / 1000);
  const v1 = createHmac("sha256", SEGREDO).update(`${t}.${corpo}`, "utf8").digest("hex");
  return verificarWebhookStripe(corpo, new Headers({ "stripe-signature": `t=${t},v1=${v1}` }), SEGREDO, agora);
}

/** O `cobranca.sinal` que a rota do webhook emite para a empresa dona do cliente. */
const sinalNoEventLog = (eventoId: string, tipo: string): EventRow => ({
  id: "ev-1", organization_id: ORG, event_type: "cobranca.sinal", entity_kind: "organization", entity_id: ORG,
  payload: { provedor: "stripe", evento_id: eventoId, tipo }, metadata: { origem: "webhook_cobranca" }, consumed_by: [], attempts: 0,
});

async function chegou(tipo: string) {
  const sinal = avisoDaStripe(tipo);
  expect(sinal).toEqual({ eventoId: `evt_${tipo.replace(/\W/g, "_")}`, tipo, clienteRef: CLIENTE });
  return cobrancaSinalHandler.handle(sinalNoEventLog(sinal!.eventoId, sinal!.tipo));
}
const acoes = () => h.audit.mock.calls.map((c) => (c[0] as { action: string }).action);

beforeEach(() => {
  vi.clearAllMocks();
  naStripe = [assinaturaDeMp()];
  plano = { id: "plano-premium", preco_cents: 4990 };
  linha = {
    organization_id: ORG, plano_id: "plano-premium", plano_agendado_id: null, estado: "ativa", trial_ate: null,
    provedor: "stripe", provedor_cliente_id: CLIENTE, provedor_assinatura_id: "sub_1QfixtureAtiva", vencida_desde: null,
    proximo_vencimento: new Date(1792592000 * 1000).toISOString(), cancela_no_fim: false, prazo_extra_ate: null,
    ultimo_aviso: null, ultimo_aviso_em: null, relida_em: HA_UMA_HORA(), link_de_pagamento: null, assinaturas_vivas: 1,
    checkout_url: null, checkout_expira_em: null, checkout_sessao_id: null, periodo_pago_desde: null,
    plano_troca_pendente_id: null, troca_id: null, troca_status: null, troca_pagamento_ref: null, troca_reserva_ate: null,
    pagamento_inicial_pendente: false, updated_at: HA_UMA_HORA(),
  };
  h.banco = bancoFalso(responder, () => ({ data: { changed: true } }));
  h.adaptador.mockImplementation(() =>
    criarAdaptadorStripe({
      lerChave: async () => CHAVE_TESTE,
      esperar: async () => undefined,
      marca: "a1b2c3d4e5f60718",
      modoFiscal: async () => "managed_payments",
      fetch: async (entrada) => {
        const url = new URL(String(entrada));
        const caminho = url.pathname.replace(/^\/v1/, "");
        if (caminho === "/subscriptions") return Response.json({ object: "list", data: naStripe, has_more: false });
        if (caminho === "/invoices") {
          const pagas = url.searchParams.get("status") === "paid";
          return Response.json({ object: "list", data: pagas ? [objetos.fatura] : [], has_more: false });
        }
        return Response.json({ error: { code: `rota_nao_declarada:${caminho}` } }, { status: 404 });
      },
    }),
  );
});

describe("assinatura alterada ou cancelada fora do CRM (Link, Portal, painel da Stripe)", () => {
  it("⭐ customer.subscription.deleted (o cliente cancelou pela Link): a empresa fica cancelada, e a mudança é auditada", async () => {
    naStripe = [assinaturaDeMp({ status: "canceled", ended_at: Math.floor(Date.now() / 1000) })];
    expect(await chegou("customer.subscription.deleted")).toMatchObject({ status: "ok", detail: "aplicada" });
    expect(linha).toMatchObject({ estado: "cancelada", assinaturas_vivas: 0, plano_id: "plano-premium" });
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "cobranca.estado_mudou", organizationId: ORG,
      metadata: { de: "ativa", para: "cancelada", status_bruto: "canceled:encerrada" },
    }));
  });

  it("⭐ customer.subscription.updated com cancelamento no fim do período (Link ou Portal): segue ativa e marca cancela_no_fim", async () => {
    naStripe = [assinaturaDeMp({ cancel_at_period_end: true })];
    expect(await chegou("customer.subscription.updated")).toMatchObject({ status: "ok", detail: "aplicada" });
    expect(linha).toMatchObject({ estado: "ativa", cancela_no_fim: true, assinaturas_vivas: 1 });
  });

  it("customer.subscription.updated que desfaz o cancelamento: cancela_no_fim volta a false", async () => {
    linha = { ...linha, cancela_no_fim: true };
    expect(await chegou("customer.subscription.updated")).toMatchObject({ status: "ok" });
    expect(linha).toMatchObject({ estado: "ativa", cancela_no_fim: false });
  });

  it("customer.subscription.updated para em atraso (cartão recusado depois da troca na Link): a empresa fica em atraso", async () => {
    naStripe = [assinaturaDeMp({ status: "past_due" })];
    await chegou("customer.subscription.updated");
    expect(linha).toMatchObject({ estado: "em_atraso" });
    expect(linha.vencida_desde).not.toBeNull();
  });

  it("⭐ cancelou e reassinou por fora: a assinatura NOVA passa a ser a da linha, e a empresa segue ativa", async () => {
    naStripe = [
      assinaturaDeMp({ id: "sub_velha", status: "canceled", created: 1780000000, ended_at: 1785000000 }),
      assinaturaDeMp({ id: "sub_nova", created: 1790000500 }),
    ];
    await chegou("customer.subscription.updated");
    expect(linha).toMatchObject({ estado: "ativa", provedor_assinatura_id: "sub_nova", assinaturas_vivas: 1 });
  });

  it("⭐ o PREÇO da assinatura mudou por fora: o plano do CRM NÃO muda em silêncio — a divergência é auditada com os dois números", async () => {
    const item = objetos.assinatura.items.data[0]!;
    naStripe = [assinaturaDeMp({ items: { data: [{ ...item, price: { ...item.price, unit_amount: 19990 } }] } })];
    await chegou("customer.subscription.updated");
    expect(linha).toMatchObject({ estado: "ativa", plano_id: "plano-premium", plano_agendado_id: null });
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "cobranca.preco_divergente",
      metadata: expect.objectContaining({ plano_id: "plano-premium", preco_plano_cents: 4990, preco_provedor_cents: 19990, provedor: "stripe" }),
    }));
  });

  it("controle: aviso sem mudança nenhuma relê e não audita mudança de estado nem de preço", async () => {
    expect(await chegou("customer.subscription.updated")).toMatchObject({ status: "ok", detail: "aplicada" });
    expect(linha).toMatchObject({ estado: "ativa", cancela_no_fim: false });
    expect(acoes()).toEqual([]);
  });

  it("evento com assinatura adulterada não vira sinal (nada é relido)", () => {
    const corpo = JSON.stringify({ id: "evt_x", type: "customer.subscription.deleted", data: { object: { customer: CLIENTE } } });
    const t = Math.floor(Date.now() / 1000);
    const errada = createHmac("sha256", "outro-segredo").update(`${t}.${corpo}`, "utf8").digest("hex");
    expect(verificarWebhookStripe(corpo, new Headers({ "stripe-signature": `t=${t},v1=${errada}` }), SEGREDO, new Date())).toBeNull();
  });
});
