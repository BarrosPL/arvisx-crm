/**
 * `crm_send_proposal` — o agente ENVIA a proposta, contra o handler real.
 *
 * O banco é o de `tests/helpers/banco-em-memoria.ts`. O envio em si
 * (`enviarProposta`, a mesma função da rota da tela) é trocado por um espião:
 * o que se mede aqui é QUANDO a ferramenta deixa o envio acontecer.
 *
 *  - a regra da empresa: `apos_aprovacao` (padrão) e `direto`, cada um;
 *  - as recusas `precisa_aprovacao`, `proposta_expirada` e `sem_canal`;
 *  - as travas de falar com o cliente: ensaio, humano que assumiu, opt-out,
 *    pausa da equipe e plano — todas ANTES de qualquer efeito;
 *  - a organização vem do token; num turno, só proposta do cliente da conversa;
 *  - é de risco crítico e não entra por pacote.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type BancoEmMemoria } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  capacidades: ["propostas"] as string[],
  planoLibera: true,
  enviar: vi.fn(),
}));
vi.mock("@/lib/organizacao/capacidades", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  capacidadesDaOrganizacao: vi.fn(async () => h.capacidades),
}));
vi.mock("@/lib/cobranca/equipe-pronta-no-plano", () => ({
  planoLiberaAEquipePronta: vi.fn(async () => h.planoLibera),
}));
vi.mock("@/lib/propostas/enviar-proposta", () => ({ enviarProposta: h.enviar }));
vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: vi.fn().mockResolvedValue(undefined) }));

const { crmSendProposal } = await import("@/lib/mcp/tools/envio-de-proposta");
const { escritaCabeNoTurno } = await import("@/lib/ai/runtime/escopo-das-escritas");
const { getToolByName } = await import("@/lib/mcp/tools");
const { catalogEntry, TOOL_CATALOG } = await import("@/lib/mcp/tools/catalog");
const { entraPorPacote, PACOTES } = await import("@/lib/mcp/tools/pacotes");
const { capacidadesAutomaticasDoPacote, capacidadesCriticasDoPacote } = await import(
  "@/lib/mcp/tools/selecao-por-pacote"
);
import type { McpContext } from "@/lib/mcp/types";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const TOKEN_A = "aaaaaaaa-0000-4000-8000-0000000000f1";
const AGENTE = "aaaaaaaa-0000-4000-8000-0000000000a1";
const AGENTE_COMUM = "aaaaaaaa-0000-4000-8000-0000000000a2";
const CONTATO_A = "aaaaaaaa-0000-4000-8000-0000000000c1";
const CONTATO_A2 = "aaaaaaaa-0000-4000-8000-0000000000c2";
const CONTATO_B = "bbbbbbbb-0000-4000-8000-0000000000c1";
const NEGOCIO_A = "aaaaaaaa-0000-4000-8000-0000000000d1";
const CONVERSA_A = "aaaaaaaa-0000-4000-8000-0000000000b1";
const CONVERSA_A2 = "aaaaaaaa-0000-4000-8000-0000000000b2";
const CANAL = "aaaaaaaa-0000-4000-8000-000000000031";
const PRODUTO = "aaaaaaaa-0000-4000-8000-000000000021";
const RASCUNHO = "aaaaaaaa-0000-4000-8000-0000000000e1";
const DO_OUTRO_CLIENTE = "aaaaaaaa-0000-4000-8000-0000000000e2";
const DA_B = "bbbbbbbb-0000-4000-8000-0000000000e1";
const INEXISTENTE = "aaaaaaaa-0000-4000-8000-0000000000ee";

let banco: BancoEmMemoria;

function ctx(extra: Partial<McpContext> = {}): McpContext {
  return {
    organizationId: ORG_A,
    role: "agent",
    actor: { type: "ai_agent", id: "run-1", role: "agent", agent_id: AGENTE },
    apiTokenId: TOKEN_A,
    requestId: "req-1",
    supabase: banco.cliente as never,
    ...extra,
  };
}

const proposta = (id: string, org: string, extra: Record<string, unknown> = {}) => ({
  id,
  organization_id: org,
  lead_id: NEGOCIO_A,
  contact_id: CONTATO_A,
  conversation_id: CONVERSA_A,
  status: "rascunho",
  valid_until: "2999-12-31",
  revision: 3,
  moeda: "BRL",
  condicoes: null,
  aprovada_em: null,
  aprovada_na_revisao: null,
  ...extra,
});

const aProposta = () => banco.tabelas.crm_proposals!.find((p) => p.id === RASCUNHO)!;
const aprovar = () => Object.assign(aProposta(), { aprovada_em: "2026-11-20T10:00:00Z", aprovada_na_revisao: 3 });
const modo = (m: "apos_aprovacao" | "direto") =>
  Object.assign(banco.tabelas.equipe_pronta_perfis![0]!, { respostas: { proposta: { envio_de_proposta: m } } });
const chamar = (id = RASCUNHO, c: McpContext = ctx()) =>
  crmSendProposal.handler({ proposal_id: id }, c) as Promise<Record<string, unknown>>;

beforeEach(() => {
  h.capacidades = ["propostas"];
  h.planoLibera = true;
  h.enviar.mockReset();
  h.enviar.mockResolvedValue({
    tipo: "ok",
    desfecho: "enviada",
    proposta: { status: "enviada", numero: 12, ano: 2026 },
  });
  banco = bancoEmMemoria({
    organizations: [
      { id: ORG_A, timezone: "America/Sao_Paulo", settings: {} },
      { id: ORG_B, timezone: "America/Sao_Paulo", settings: {} },
    ],
    equipe_pronta_perfis: [
      { organization_id: ORG_A, respostas: {}, instalacao: { pausa: null, pipeline_id: null, etapas: {} } },
    ],
    ai_agents: [
      { id: AGENTE, organization_id: ORG_A, paused_at: null, archived_at: null, config: { equipe_pronta: { papel: "proposta", versao: 2 } } },
      { id: AGENTE_COMUM, organization_id: ORG_A, paused_at: null, archived_at: null, config: {} },
    ],
    contacts: [
      { id: CONTATO_A, organization_id: ORG_A, is_blocked: false, is_personal: false, force_human: false, ai_opt_out: false, phone_number: "+5511999990001" },
      { id: CONTATO_A2, organization_id: ORG_A, is_blocked: false, is_personal: false, force_human: false, ai_opt_out: false, phone_number: "+5511999990002" },
      { id: CONTATO_B, organization_id: ORG_B, is_blocked: false, is_personal: false, force_human: false, ai_opt_out: false, phone_number: "+5511999990003" },
    ],
    conversations: [
      { id: CONVERSA_A, organization_id: ORG_A, contact_id: CONTATO_A, channel_session_id: CANAL, bot_silenced_until: null, created_at: "2026-11-01T10:00:00.000Z" },
      { id: CONVERSA_A2, organization_id: ORG_A, contact_id: CONTATO_A2, channel_session_id: CANAL, bot_silenced_until: null, created_at: "2026-11-01T10:00:00.000Z" },
    ],
    channel_sessions: [{ id: CANAL, organization_id: ORG_A, status: "WORKING", archived_at: null, metadata: {} }],
    catalog_products: [{ id: PRODUTO, organization_id: ORG_A, ativo: true, preco_cents: 10_000, moeda: "BRL" }],
    crm_proposals: [
      proposta(RASCUNHO, ORG_A),
      proposta(DO_OUTRO_CLIENTE, ORG_A, { contact_id: CONTATO_A2, conversation_id: CONVERSA_A2 }),
      proposta(DA_B, ORG_B, { contact_id: CONTATO_B }),
    ],
    crm_proposal_items: [
      { id: "i1", organization_id: ORG_A, proposal_id: RASCUNHO, descricao: "Plano anual", product_id: PRODUTO, preco_unitario_cents: 10_000, desconto_cents: 0 },
    ],
  });
});

describe("crm_send_proposal: a regra da empresa", () => {
  it("⭐ apos_aprovacao (padrão): sem aprovação, não envia — precisa_aprovacao", async () => {
    const r = await chamar();
    expect(r).toMatchObject({ permitido: false, motivo: "precisa_aprovacao", porque: "aguardando_aprovacao", modo: "apos_aprovacao" });
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it("⭐ apos_aprovacao: aprovada pela equipe, envia", async () => {
    aprovar();
    const r = await chamar();
    expect(r).toMatchObject({ enviada: true, proposal_id: RASCUNHO, status: "enviada", number: 12, autorizada_por: "aprovacao" });
    expect(h.enviar).toHaveBeenCalledTimes(1);
  });

  it("⭐ aprovada e depois editada: a aprovação não vale mais", async () => {
    aprovar();
    aProposta().revision = 4;
    expect(await chamar()).toMatchObject({ motivo: "precisa_aprovacao", porque: "editada_depois_de_aprovada" });
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it("⭐ direto: itens do catálogo, preço do catálogo, sem desconto — envia sozinho", async () => {
    modo("direto");
    expect(await chamar()).toMatchObject({ enviada: true, autorizada_por: "direto" });
    expect(h.enviar).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["tem_desconto", { desconto_cents: 500 }],
    ["preco_diferente_do_catalogo", { preco_unitario_cents: 8_000 }],
    ["item_fora_do_catalogo", { product_id: null }],
  ])("⭐ direto com %s: volta a pedir aprovação", async (porque, mudanca) => {
    modo("direto");
    Object.assign(banco.tabelas.crm_proposal_items![0]!, mudanca);
    expect(await chamar()).toMatchObject({ permitido: false, motivo: "precisa_aprovacao", porque, modo: "direto" });
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it("direto com desconto, mas aprovada pela equipe: envia", async () => {
    modo("direto");
    banco.tabelas.crm_proposal_items![0]!.desconto_cents = 500;
    aprovar();
    expect(await chamar()).toMatchObject({ enviada: true, autorizada_por: "aprovacao" });
  });

  it("empresa sem perfil de Equipe pronta (agente externo): vale o padrão, apos_aprovacao", async () => {
    banco.tabelas.equipe_pronta_perfis = [];
    const externo = ctx({ actor: { type: "api_token", id: TOKEN_A, role: "agent" } });
    expect(await chamar(RASCUNHO, externo)).toMatchObject({ motivo: "precisa_aprovacao", modo: "apos_aprovacao" });
    aprovar();
    expect(await chamar(RASCUNHO, externo)).toMatchObject({ enviada: true });
  });
});

describe("crm_send_proposal: quem envia e como fica registrado", () => {
  it("⭐ envia pela mesma função da tela, com o agente como ator e a organização do token", async () => {
    aprovar();
    await chamar();
    const [cliente, entrada] = h.enviar.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(cliente).toBe(banco.cliente);
    expect(entrada).toMatchObject({ orgId: ORG_A, propostaId: RASCUNHO, requestId: "req-1" });
    expect(entrada.quem).toMatchObject({
      actor: { type: "ai_agent", agent_id: AGENTE },
      // Nenhuma pessoa enviou: a coluna de autoria humana fica nula.
      userId: null,
      auditoria: {
        actorApiTokenId: TOKEN_A,
        metadata: { via: "mcp", actor_type: "ai_agent", agent_id: AGENTE, modo: "apos_aprovacao", autorizada_por: "aprovacao" },
      },
    });
  });

  it("mensagem na fila do canal não é 'enviada'", async () => {
    aprovar();
    h.enviar.mockResolvedValue({ tipo: "ok", desfecho: "em_fila", proposta: { status: "enviando" } });
    expect(await chamar()).toMatchObject({ enviada: false, em_fila: true });
  });

  it("envio que falhou e voltou a rascunho é recusa, com o motivo", async () => {
    aprovar();
    h.enviar.mockResolvedValue({ tipo: "ok", desfecho: "revertida", proposta: { status: "rascunho", ultima_falha_envio: "canal caiu" } });
    const r = await chamar();
    expect(r).toMatchObject({ permitido: false, motivo: "envio_falhou" });
    expect(String(r.mensagem)).toContain("canal caiu");
  });

  it("recusa do envio (item sem preço, sem conversa) chega com código legível", async () => {
    aprovar();
    h.enviar.mockResolvedValue({ tipo: "recusa", motivo: "item_sem_preco", codigo: "validation_failed", status: 422, mensagem: "", itens: ["Consultoria"] });
    expect(await chamar()).toMatchObject({ permitido: false, motivo: "item_sem_preco" });
    h.enviar.mockResolvedValue({ tipo: "recusa", motivo: "sem_conversa", codigo: "validation_failed", status: 422, mensagem: "x" });
    expect(await chamar()).toMatchObject({ permitido: false, motivo: "sem_canal" });
  });
});

describe("crm_send_proposal: o estado da proposta", () => {
  it("⭐ validade vencida: proposta_expirada, mesmo aprovada", async () => {
    aprovar();
    aProposta().valid_until = "2020-01-01";
    expect(await chamar()).toMatchObject({ permitido: false, motivo: "proposta_expirada" });
    aProposta().valid_until = "2999-12-31";
    aProposta().status = "vencida";
    expect(await chamar()).toMatchObject({ permitido: false, motivo: "proposta_expirada" });
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it.each([
    ["enviada", "proposta_ja_enviada"],
    ["enviando", "proposta_ja_enviada"],
    ["aceita", "estado_invalido"],
    ["cancelada", "estado_invalido"],
  ])("status %s: %s — a mesma proposta não sai duas vezes", async (status, motivo) => {
    aprovar();
    aProposta().status = status;
    expect(await chamar()).toMatchObject({ permitido: false, motivo });
    expect(h.enviar).not.toHaveBeenCalled();
  });
});

describe("crm_send_proposal: as travas de falar com o cliente", () => {
  const travado = async (motivo: string) => {
    aprovar();
    expect(await chamar()).toMatchObject({ permitido: false, motivo });
    expect(h.enviar).not.toHaveBeenCalled();
  };

  it("⭐ modo ensaio: número que não é de teste não recebe", async () => {
    banco.tabelas.channel_sessions![0]!.metadata = {
      ai_gate: "allowlist",
      ai_gate_mode: "pre_go_live",
      ai_test_phone_numbers: ["+5511988887777"],
    };
    await travado("modo_ensaio");
  });

  it("modo ensaio: o número de teste recebe", async () => {
    banco.tabelas.channel_sessions![0]!.metadata = {
      ai_gate: "allowlist",
      ai_gate_mode: "pre_go_live",
      ai_test_phone_numbers: ["+5511999990001"],
    };
    aprovar();
    expect(await chamar()).toMatchObject({ enviada: true });
  });

  it("⭐ humano assumiu a conversa: o agente não envia por cima", async () => {
    banco.tabelas.conversations![0]!.bot_silenced_until = "2999-01-01T00:00:00.000Z";
    await travado("humano_assumiu");
  });

  it("humano assumiu para sempre ('infinity'), ou contato de atendimento humano", async () => {
    banco.tabelas.conversations![0]!.bot_silenced_until = "infinity";
    await travado("humano_assumiu");
    banco.tabelas.conversations![0]!.bot_silenced_until = null;
    banco.tabelas.contacts![0]!.force_human = true;
    await travado("humano_assumiu");
  });

  it("silêncio que já passou não segura o envio", async () => {
    banco.tabelas.conversations![0]!.bot_silenced_until = "2020-01-01T00:00:00.000Z";
    aprovar();
    expect(await chamar()).toMatchObject({ enviada: true });
  });

  it("⭐ opt-out: quem pediu para parar não recebe", async () => {
    banco.tabelas.contacts![0]!.is_blocked = true;
    await travado("contato_pediu_para_parar");
  });

  it("⭐ equipe pausada pela tela: nada sai", async () => {
    (banco.tabelas.equipe_pronta_perfis![0]!.instalacao as Record<string, unknown>).pausa = {
      em: "2026-11-20T10:00:00Z",
      agentes: [AGENTE],
    };
    await travado("equipe_pausada");
  });

  it("⭐ agente pausado: nada sai", async () => {
    banco.tabelas.ai_agents![0]!.paused_at = "2026-11-20T10:00:00Z";
    await travado("equipe_pausada");
  });

  it("⭐ plano que não libera a equipe: o agente da equipe não envia", async () => {
    h.planoLibera = false;
    await travado("fora_do_plano");
  });

  it("a trava de plano e a pausa da equipe são só dos agentes DA EQUIPE", async () => {
    h.planoLibera = false;
    (banco.tabelas.equipe_pronta_perfis![0]!.instalacao as Record<string, unknown>).pausa = { em: "x", agentes: [] };
    aprovar();
    const comum = ctx({ actor: { type: "ai_agent", id: "run-2", role: "agent", agent_id: AGENTE_COMUM } });
    expect(await chamar(RASCUNHO, comum)).toMatchObject({ enviada: true });
  });

  it("⭐ sem canal: canal desconectado, canal arquivado ou contato sem conversa", async () => {
    banco.tabelas.channel_sessions![0]!.status = "STOPPED";
    await travado("sem_canal");
    banco.tabelas.channel_sessions![0]!.status = "WORKING";
    banco.tabelas.channel_sessions![0]!.archived_at = "2026-11-01T00:00:00Z";
    await travado("sem_canal");
    banco.tabelas.channel_sessions![0]!.archived_at = null;
    banco.tabelas.conversations = banco.tabelas.conversations!.filter((c) => c.id !== CONVERSA_A);
    await travado("sem_canal");
  });

  it("propostas desligadas na organização: a ferramenta recusa", async () => {
    h.capacidades = [];
    await travado("propostas_desligadas");
  });
});

describe("crm_send_proposal: isolamento", () => {
  it("⭐ proposta de outra organização é 'não existe', e nada é enviado", async () => {
    expect(await chamar(DA_B)).toMatchObject({ permitido: false, motivo: "proposta_nao_encontrada" });
    expect(await chamar(INEXISTENTE)).toMatchObject({ permitido: false, motivo: "proposta_nao_encontrada" });
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it("⭐ num turno, proposta de outro cliente e proposta inexistente recebem a MESMA recusa", async () => {
    const turno = ctx({ contatoDoTurno: CONTATO_A });
    const doOutro = await chamar(DO_OUTRO_CLIENTE, turno);
    expect(doOutro).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
    expect(await chamar(INEXISTENTE, turno)).toEqual(doOutro);
    expect(await chamar(DA_B, turno)).toEqual(doOutro);
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it("a ponte do turno confere de quem é a proposta", async () => {
    const supabase = banco.cliente as never;
    expect(
      await escritaCabeNoTurno(supabase, ORG_A, CONTATO_A, "crm_send_proposal", { proposal_id: RASCUNHO }),
    ).toEqual({ permitido: true });
    for (const alheia of [DO_OUTRO_CLIENTE, DA_B, INEXISTENTE]) {
      expect(
        await escritaCabeNoTurno(supabase, ORG_A, CONTATO_A, "crm_send_proposal", { proposal_id: alheia }),
      ).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
    }
  });
});

describe("crm_send_proposal: no catálogo", () => {
  it("⭐ fala com o cliente: risco crítico, e nenhum pacote a liga sozinho", () => {
    const entrada = catalogEntry("crm_send_proposal")!;
    expect(entrada.risco).toBe("critico");
    expect(entraPorPacote(entrada.risco)).toBe(false);
    expect(entrada.capacidade).toBe("propostas");
    const catalogo = TOOL_CATALOG.map((t) => ({ name: t.name, risco: t.risco, pacotes: t.pacotes }));
    for (const pacote of PACOTES) {
      expect(capacidadesAutomaticasDoPacote(catalogo as never, pacote.id), pacote.id).not.toContain(
        "crm_send_proposal",
      );
    }
    // Aparece no pacote dela para ser marcada à mão.
    expect(capacidadesCriticasDoPacote(catalogo as never, "reter")).toContain("crm_send_proposal");
  });

  it("é escrita com papel de agente, e nenhum argumento escolhe a organização", () => {
    const tool = getToolByName("crm_send_proposal")!;
    expect(tool).toMatchObject({ category: "write", requiresRole: "agent", requiresScope: "mcp:write" });
    expect(Object.keys(tool.inputSchema)).toEqual(["proposal_id"]);
  });
});
