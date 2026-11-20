/**
 * A TRAVA DOS FLUXOS DA EQUIPE NO MOTOR DE FOLLOW-UP — pausa e limite de toques.
 *
 * O motor de follow-up já para nas travas de quem fala com o cliente (ensaio,
 * pessoa que assumiu, janela do canal, opt-out) e já adia a régua da equipe
 * quando o plano não a libera (`reguaDaEquipeForaDoPlano`). Faltavam duas
 * regras que são só da Equipe pronta, e elas valem para os TRÊS fluxos dela (a
 * régua de silêncio e os dois dos gatilhos, `fluxos.ts`):
 *
 *   1. PAUSA. Com a equipe pausada pela tela, ou com o agente de Recuperação
 *      pausado, a inscrição é ADIADA: não manda nada e não é cancelada. Retomar
 *      a equipe retoma de onde parou.
 *
 *   2. LIMITE DE TOQUES. O papel da Recuperação promete no máximo N tentativas
 *      de retomada (`recuperacao.toques_maximos`). Cada fluxo é uma escada de
 *      até N mensagens, e o motor só deixa UMA inscrição viva por contato; o
 *      que faltava era impedir duas escadas em sequência para quem continua
 *      sem responder (silêncio, depois proposta parada, depois falta). A regra:
 *      uma inscrição que acabou de nascer num fluxo da equipe é ENCERRADA, sem
 *      mandar nada, se a equipe já mandou alguma mensagem de retomada a este
 *      contato DEPOIS da última mensagem dele. Quando a pessoa responde, a
 *      conta zera. Assim, entre uma resposta e outra, o contato recebe no
 *      máximo N retomadas, somando os três fluxos.
 *
 * ═══ Falha de leitura = segue ═══
 *
 * A mesma régua da trava de plano: se o perfil ou a contagem não puderem ser
 * lidos, a inscrição segue. Estas duas regras rodam dentro do tique de TODA
 * empresa; um banco que soluça não pode parar o follow-up de quem nem tem
 * equipe pronta. As travas que protegem o cliente (opt-out, ensaio, pessoa no
 * comando) são do motor e não dependem desta leitura.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { instalacaoSchema, type InstalacaoDaEquipe } from "@/lib/schemas/equipe-pronta";
import { NO_DE_INICIO_DA_ESCADA } from "../constantes";

/** O motivo gravado quando a inscrição é adiada pela pausa. */
export const ERRO_DA_EQUIPE_PAUSADA = "equipe_pausada";
/** O motivo gravado quando a inscrição é encerrada pelo limite de toques. */
export const MOTIVO_DO_LIMITE_DE_TOQUES = "limite_de_toques_da_equipe";
/** O evento de `followup_enrollment_events` que marca uma mensagem que SAIU. */
const EVENTO_DE_MENSAGEM_ENVIADA = "action_sent";

export type TravaDoFluxoDaEquipe =
  | null
  | { acao: "adiar"; motivo: typeof ERRO_DA_EQUIPE_PAUSADA }
  | { acao: "encerrar"; motivo: typeof MOTIVO_DO_LIMITE_DE_TOQUES; toques: number };

/** Todos os fluxos de follow-up que são da equipe: a régua e os dois dos gatilhos. */
export function fluxosDaEquipe(
  instalacao: Pick<InstalacaoDaEquipe, "followup_flow_pointer_id" | "gatilhos"> | null | undefined,
): string[] {
  if (!instalacao) return [];
  return [
    instalacao.followup_flow_pointer_id,
    instalacao.gatilhos?.fluxo_de_falta_id ?? null,
    instalacao.gatilhos?.fluxo_de_proposta_parada_id ?? null,
  ].filter((id): id is string => typeof id === "string" && id !== "");
}

/**
 * A DECISÃO — pura, para ser medida sem banco.
 *
 * `toquesDesdeAUltimaResposta` só é contado (e só importa) quando a inscrição
 * acabou de nascer: no meio da escada, os toques contados seriam os dela mesma.
 */
export function decidirTravaDoFluxo(c: {
  /** O fluxo desta inscrição é um dos fluxos da equipe? */
  fluxoDaEquipe: boolean;
  /** A equipe está pausada pela tela, ou o agente de Recuperação está pausado? */
  pausada: boolean;
  /** A inscrição está no nó de gatilho (ainda não mandou nada)? */
  acabouDeNascer: boolean;
  /** Retomadas que a equipe já mandou a este contato depois da última mensagem dele. */
  toquesDesdeAUltimaResposta: number;
}): TravaDoFluxoDaEquipe {
  if (!c.fluxoDaEquipe) return null;
  if (c.pausada) return { acao: "adiar", motivo: ERRO_DA_EQUIPE_PAUSADA };
  if (c.acabouDeNascer && c.toquesDesdeAUltimaResposta > 0) {
    return { acao: "encerrar", motivo: MOTIVO_DO_LIMITE_DE_TOQUES, toques: c.toquesDesdeAUltimaResposta };
  }
  return null;
}

export interface InscricaoParaATrava {
  id: string;
  organization_id: string;
  pointer_id: string;
  contact_id: string;
  current_node_id: string;
}

/** A mesma decisão, lendo o perfil, a pausa e os toques. Nunca lança. */
export async function travaDoFluxoDaEquipe(
  admin: SupabaseClient,
  inscricao: InscricaoParaATrava,
): Promise<TravaDoFluxoDaEquipe> {
  try {
    const orgId = inscricao.organization_id;
    const { data, error } = await admin
      .from("equipe_pronta_perfis")
      .select("instalacao")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (error || !data) return null;
    const lida = instalacaoSchema.safeParse((data as { instalacao?: unknown }).instalacao ?? {});
    if (!lida.success) return null;
    const instalacao = lida.data;
    const fluxos = fluxosDaEquipe(instalacao);
    if (!fluxos.includes(inscricao.pointer_id)) return null;

    let pausada = instalacao.pausa !== null;
    const recuperador = instalacao.agentes.recuperador?.agent_id;
    if (!pausada && recuperador) {
      const { data: agente, error: erroDoAgente } = await admin
        .from("ai_agents")
        .select("paused_at")
        .eq("organization_id", orgId)
        .eq("id", recuperador)
        .maybeSingle();
      if (!erroDoAgente && (agente as { paused_at?: string | null } | null)?.paused_at) pausada = true;
    }

    const acabouDeNascer = inscricao.current_node_id === NO_DE_INICIO_DA_ESCADA;
    let toques = 0;
    if (!pausada && acabouDeNascer) {
      toques = await toquesDesdeAUltimaResposta(admin, orgId, inscricao, fluxos);
    }
    return decidirTravaDoFluxo({
      fluxoDaEquipe: true,
      pausada,
      acabouDeNascer,
      toquesDesdeAUltimaResposta: toques,
    });
  } catch {
    return null;
  }
}

/** Mensagens de retomada que os fluxos da equipe mandaram ao contato depois da última mensagem dele. */
async function toquesDesdeAUltimaResposta(
  admin: SupabaseClient,
  orgId: string,
  inscricao: InscricaoParaATrava,
  fluxos: readonly string[],
): Promise<number> {
  const { data: conversas, error: erroDasConversas } = await admin
    .from("conversations")
    .select("last_inbound_at")
    .eq("organization_id", orgId)
    .eq("contact_id", inscricao.contact_id);
  if (erroDasConversas) return 0;
  let ultimaResposta: string | null = null;
  for (const c of (conversas ?? []) as Array<{ last_inbound_at: string | null }>) {
    if (c.last_inbound_at && (ultimaResposta === null || c.last_inbound_at > ultimaResposta)) {
      ultimaResposta = c.last_inbound_at;
    }
  }

  const { data: outras, error: erroDasOutras } = await admin
    .from("followup_enrollments")
    .select("id")
    .eq("organization_id", orgId)
    .eq("contact_id", inscricao.contact_id)
    .in("pointer_id", [...fluxos])
    .neq("id", inscricao.id);
  if (erroDasOutras) return 0;
  const ids = ((outras ?? []) as Array<{ id: string }>).map((o) => o.id);
  if (ids.length === 0) return 0;

  let consulta = admin
    .from("followup_enrollment_events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("event_type", EVENTO_DE_MENSAGEM_ENVIADA)
    .in("enrollment_id", ids);
  if (ultimaResposta !== null) consulta = consulta.gt("created_at", ultimaResposta);
  const { count, error } = await consulta;
  if (error) return 0;
  return count ?? 0;
}
