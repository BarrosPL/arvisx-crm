/**
 * GATILHO: PROPOSTA APROVADA PELA EQUIPE → PROPOSTAS envia e move para proposta enviada.
 *
 * O botão "Aprovar e deixar o agente enviar" da tela da proposta chama
 * `POST /api/v1/proposals/[id]/approve`, que chama aqui. Duas coisas acontecem,
 * nesta ordem:
 *
 *   1. A APROVAÇÃO é gravada: `aprovada_em` e `aprovada_na_revisao` (migration
 *      9814), as duas colunas que `crm_send_proposal` lê no modo
 *      `apos_aprovacao`. Só o servidor as grava; quem confere o papel
 *      (`manager`, o mesmo de enviar pela tela) é a rota. A aprovação vale
 *      enquanto a revisão aprovada for a atual: editar o rascunho a invalida.
 *
 *   2. O GATILHO: o agente de Propostas da Equipe pronta envia a proposta na
 *      hora, sem esperar o cliente escrever, e o negócio vai para a etapa de
 *      proposta enviada. O envio é `enviarProposta`, a MESMA função da tela e
 *      de `crm_send_proposal`, com o agente como autor. Antes dele, as MESMAS
 *      travas da ferramenta (`travas.ts`): ensaio, pessoa que assumiu a
 *      conversa, opt-out, pausa e plano. A janela e o limite do canal são
 *      conferidos dentro de `enviarProposta`.
 *
 * ═══ Aprovar e não enviar não é erro ═══
 *
 * Quando uma trava segura o envio (ou não há agente de Propostas instalado), a
 * aprovação FICA gravada e a resposta diz por que nada saiu. A proposta
 * aprovada continua valendo: o agente a envia no próximo turno da conversa
 * (`crm_send_proposal` passa a responder), e a pessoa pode enviar pelo botão
 * "Enviar ao cliente". Aprovar de novo tenta o envio de novo.
 *
 * `orgId` vem de quem chama, de fonte confiável (a sessão), nunca do corpo. O
 * cliente é de serviço: toda consulta filtra a organização.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { moveLeadHandler } from "@/app/api/v1/leads/_handler";
import type { Actor } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import type { Idioma } from "@/lib/i18n/idiomas";
import { logger } from "@/lib/logger";
import { dataIsoNoFuso, fusoDaOrganizacao } from "@/lib/propostas/data-no-fuso";
import { enviarProposta } from "@/lib/propostas/enviar-proposta";
import { propostaEstaAprovada } from "@/lib/propostas/envio-pelo-agente";
import { lerEquipeInstalada, travasDeFalarComOCliente, type EquipeInstalada } from "./travas";

/** Por que o agente não enviou (a aprovação foi gravada do mesmo jeito). */
export type MotivoDeNaoEnviar =
  | "sem_agente"
  | "proposta_expirada"
  | "equipe_pausada"
  | "fora_do_plano"
  | "contato_pediu_para_parar"
  | "contato_pessoal"
  | "humano_assumiu"
  | "modo_ensaio"
  | "sem_canal"
  | "consulta_indisponivel"
  | "fora_da_janela"
  | "limite_diario"
  | "envio_falhou"
  /** A proposta em si não está pronta para sair (sem itens, sem preço, sem modelo, campo faltando). */
  | "proposta_incompleta";

export interface EnvioDepoisDeAprovar {
  /** O PDF saiu na conversa. */
  enviada: boolean;
  /** A mensagem está na fila do canal e sai quando ele conectar. */
  em_fila: boolean;
  motivo: MotivoDeNaoEnviar | null;
  /** A frase para a pessoa que aprovou, já no idioma dela. `null` quando enviou. */
  mensagem: string | null;
}

export type ResultadoDaAprovacao =
  | { tipo: "recusa"; codigo: "not_found" | "proposal_context_stale"; status: number; mensagem: string }
  | {
      tipo: "ok";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a linha de `crm_proposals`, como as outras rotas a devolvem
      proposta: any;
      envio: EnvioDepoisDeAprovar;
      negocio_movido: boolean;
    };

type Tradutor = (texto: string) => string;

/** A frase de cada motivo, para quem aprovou. Chamadas literais: o dicionário as traduz. */
export function fraseDeNaoEnviar(motivo: MotivoDeNaoEnviar, t: Tradutor): string {
  switch (motivo) {
    case "sem_agente":
      return t("Aprovada. Não há agente de propostas instalado para enviar: use o botão Enviar ao cliente.");
    case "proposta_expirada":
      return t("Aprovada, mas a validade desta proposta já terminou. Ajuste a validade e aprove de novo.");
    case "equipe_pausada":
      return t("Aprovada. O agente não enviou porque a equipe de IA está pausada.");
    case "fora_do_plano":
      return t("Aprovada. O agente não enviou porque o plano desta empresa não inclui a equipe de IA.");
    case "contato_pediu_para_parar":
      return t("Aprovada. O agente não enviou porque este contato pediu para não receber mensagens.");
    case "contato_pessoal":
      return t("Aprovada. O agente não enviou porque este contato é pessoal.");
    case "humano_assumiu":
      return t(
        "Aprovada. O agente não enviou porque uma pessoa da equipe assumiu esta conversa. Use o botão Enviar ao cliente.",
      );
    case "modo_ensaio":
      return t(
        "Aprovada. O agente não enviou porque o WhatsApp está em ensaio e este número não é um número de teste.",
      );
    case "sem_canal":
      return t("Aprovada. O agente não enviou porque não há conversa ou WhatsApp conectado por onde enviar.");
    case "fora_da_janela":
      return t("Aprovada. O agente não enviou agora porque está fora do horário de envio. Aprove de novo mais tarde.");
    case "limite_diario":
      return t("Aprovada. O agente não enviou porque o limite diário de mensagens desta conexão foi atingido.");
    case "consulta_indisponivel":
      return t("Aprovada. O agente não conseguiu enviar agora. Aprove de novo em instantes.");
    case "envio_falhou":
      return t("Aprovada, mas o envio falhou e a proposta continua em rascunho. Aprove de novo em instantes.");
    case "proposta_incompleta":
      return t("Aprovada, mas a proposta ainda não está pronta para sair.");
  }
}

const naoEnviou = (motivo: MotivoDeNaoEnviar, t: Tradutor, detalhe?: string): EnvioDepoisDeAprovar => ({
  enviada: false,
  em_fila: false,
  motivo,
  mensagem: detalhe ? `${fraseDeNaoEnviar(motivo, t)} ${detalhe}` : fraseDeNaoEnviar(motivo, t),
});

interface LinhaDaProposta {
  id: string;
  lead_id: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  status: string;
  valid_until: string | null;
  revision: number;
  aprovada_em: string | null;
  aprovada_na_revisao: number | null;
}

const COLUNAS =
  "id, lead_id, contact_id, conversation_id, status, valid_until, revision, aprovada_em, aprovada_na_revisao";

export async function aprovarPropostaParaOAgente(
  admin: SupabaseClient,
  entrada: {
    orgId: string;
    propostaId: string;
    /** A pessoa que aprovou (a rota já conferiu o papel). */
    userId: string;
    requestId: string;
    idioma?: Idioma;
    t: Tradutor;
  },
): Promise<ResultadoDaAprovacao> {
  const { orgId, propostaId, userId, requestId, t } = entrada;

  const { data, error } = await admin
    .from("crm_proposals")
    .select(COLUNAS)
    .eq("organization_id", orgId)
    .eq("id", propostaId)
    .maybeSingle();
  if (error) throw new Error(`proposta: ${error.message}`);
  const proposta = data as unknown as LinhaDaProposta | null;
  if (!proposta) return { tipo: "recusa", codigo: "not_found", status: 404, mensagem: t("Proposta não encontrada.") };
  if (proposta.status !== "rascunho") {
    return {
      tipo: "recusa",
      codigo: "proposal_context_stale",
      status: 409,
      mensagem: t("Só uma proposta em rascunho pode ser aprovada."),
    };
  }

  // ── 1. a aprovação ──────────────────────────────────────────────────────
  // Aprovar de novo a MESMA revisão não regrava a data: a aprovação é o fato
  // de alguém ter dito "pode enviar", e isso já aconteceu.
  if (!propostaEstaAprovada({ ...proposta, moeda: "", condicoes: null })) {
    const { data: gravadas, error: erroDaEscrita } = await admin
      .from("crm_proposals")
      .update({ aprovada_em: new Date().toISOString(), aprovada_na_revisao: proposta.revision })
      .eq("organization_id", orgId)
      .eq("id", propostaId)
      .eq("status", "rascunho")
      // A revisão que a pessoa viu: editada no meio, a aprovação não entra.
      .eq("revision", proposta.revision)
      .select("id");
    if (erroDaEscrita) throw new Error(`aprovacao: ${erroDaEscrita.message}`);
    if ((gravadas ?? []).length === 0) {
      return {
        tipo: "recusa",
        codigo: "proposal_context_stale",
        status: 409,
        mensagem: t("A proposta mudou desde que você abriu. Recarregue antes de aprovar."),
      };
    }
    void audit({
      action: "proposal.aprovada_para_o_agente",
      actorUserId: userId,
      organizationId: orgId,
      resourceType: "crm_proposals",
      resourceId: propostaId,
      requestId,
      metadata: { revision: proposta.revision },
    });
  }

  // ── 2. o gatilho: o agente de Propostas envia ───────────────────────────
  const { envio, agentId, equipe } = await enviarPeloAgente(admin, entrada, proposta);
  const movido =
    envio.enviada && agentId && equipe ? await moverParaPropostaEnviada(admin, entrada, proposta, agentId, equipe) : false;

  const { data: atual } = await admin
    .from("crm_proposals")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", propostaId)
    .maybeSingle();
  return { tipo: "ok", proposta: atual, envio, negocio_movido: movido };
}

async function enviarPeloAgente(
  admin: SupabaseClient,
  entrada: { orgId: string; propostaId: string; userId: string; requestId: string; idioma?: Idioma; t: Tradutor },
  proposta: LinhaDaProposta,
): Promise<{ envio: EnvioDepoisDeAprovar; agentId: string | null; equipe: EquipeInstalada | null }> {
  const { orgId, t } = entrada;

  let equipe: EquipeInstalada | null;
  try {
    equipe = await lerEquipeInstalada(admin, orgId);
  } catch {
    return { envio: naoEnviou("consulta_indisponivel", t), agentId: null, equipe: null };
  }
  const agentId = equipe?.instalacao.agentes.proposta?.agent_id ?? null;
  if (!equipe || !agentId) return { envio: naoEnviou("sem_agente", t), agentId: null, equipe };

  if (proposta.valid_until) {
    const hoje = dataIsoNoFuso(new Date(), await fusoDaOrganizacao(admin, orgId));
    if (proposta.valid_until < hoje) return { envio: naoEnviou("proposta_expirada", t), agentId, equipe };
  }

  // As MESMAS travas de `crm_send_proposal`, antes de alocar número e montar o PDF.
  const travas = await travasDeFalarComOCliente(admin, {
    organizationId: orgId,
    agentId,
    contactId: proposta.contact_id,
    conversationId: proposta.conversation_id,
  });
  if (travas.trava) return { envio: naoEnviou(travas.trava.codigo, t), agentId, equipe };

  const ator: Actor = { type: "ai_agent", id: agentId, role: "agent", agent_id: agentId };
  const resultado = await enviarProposta(admin, {
    orgId,
    propostaId: proposta.id,
    requestId: entrada.requestId,
    quem: {
      actor: ator,
      userId: null,
      ...(entrada.idioma ? { idioma: entrada.idioma } : {}),
      auditoria: {
        metadata: {
          via: "equipe_pronta",
          gatilho: "proposta_aprovada",
          actor_type: "ai_agent",
          agent_id: agentId,
          autorizada_por: "aprovacao",
          aprovada_por_user_id: entrada.userId,
        },
      },
    },
    t,
  });

  if (resultado.tipo === "recusa") {
    if (resultado.motivo === "sem_conversa") return { envio: naoEnviou("sem_canal", t), agentId, equipe };
    if (resultado.motivo === "fora_da_janela" || resultado.motivo === "limite_diario") {
      return { envio: naoEnviou(resultado.motivo, t), agentId, equipe };
    }
    if (resultado.motivo === "item_sem_preco") {
      return {
        envio: naoEnviou(
          "proposta_incompleta",
          t,
          t("Item sem preço definido: {itens}.").replace("{itens}", (resultado.itens ?? []).join(", ")),
        ),
        agentId,
        equipe,
      };
    }
    return { envio: naoEnviou("proposta_incompleta", t, resultado.mensagem), agentId, equipe };
  }
  if (resultado.desfecho === "revertida") return { envio: naoEnviou("envio_falhou", t), agentId, equipe };
  return {
    envio: {
      enviada: resultado.desfecho === "enviada",
      em_fila: resultado.desfecho === "em_fila",
      motivo: null,
      mensagem: null,
    },
    agentId,
    equipe,
  };
}

/**
 * Move o negócio para a etapa de proposta enviada, em nome do agente de
 * Propostas (o dono dessa etapa). Só o funil da equipe, só negócio aberto, e
 * nunca para trás: quem já está em proposta enviada ou em negociação fica onde
 * está. Falha aqui não desfaz o envio: a proposta já saiu.
 */
async function moverParaPropostaEnviada(
  admin: SupabaseClient,
  entrada: { orgId: string; requestId: string; idioma?: Idioma },
  proposta: LinhaDaProposta,
  agentId: string,
  equipe: EquipeInstalada,
): Promise<boolean> {
  const destino = equipe.instalacao.etapas.proposta_enviada;
  if (!proposta.lead_id || !destino || !equipe.instalacao.pipeline_id) return false;
  try {
    const { data: lead, error } = await admin
      .from("crm_leads")
      .select("status, pipeline_id, stage_id")
      .eq("organization_id", entrada.orgId)
      .eq("id", proposta.lead_id)
      .maybeSingle();
    if (error || !lead) return false;
    const negocio = lead as { status: string | null; pipeline_id: string | null; stage_id: string | null };
    if (negocio.status !== "open" || negocio.pipeline_id !== equipe.instalacao.pipeline_id) return false;
    const jaPassou = [destino, equipe.instalacao.etapas.em_negociacao].filter(Boolean);
    if (negocio.stage_id !== null && jaPassou.includes(negocio.stage_id)) return false;

    await moveLeadHandler(
      admin,
      {
        organization_id: entrada.orgId,
        actor: { type: "ai_agent", id: agentId, role: "agent", agent_id: agentId },
        requestId: entrada.requestId,
        ...(entrada.idioma ? { idioma: entrada.idioma } : {}),
      },
      proposta.lead_id,
      { to_stage_id: destino },
    );
    return true;
  } catch (erro) {
    logger.warn("equipe_pronta.proposta_aprovada: a proposta saiu e o negócio não foi movido", {
      organizationId: entrada.orgId,
      leadId: proposta.lead_id,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return false;
  }
}
