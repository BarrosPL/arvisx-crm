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
 * ═══ O que a regra 2 mudou na régua de silêncio da v1 (e é de propósito) ═══
 *
 * A régua de silêncio existia antes dos gatilhos, sem este limite. Com ele:
 *
 *   • a régua NÃO recomeça para quem continua calado. Antes, com
 *     `dias_para_esfriar` curto, o mesmo contato recebia uma escada, depois
 *     outra, depois outra, enquanto não respondesse. Agora a segunda inscrição
 *     nasce e é encerrada sem mandar nada;
 *   • o contato que NUNCA respondeu (nenhuma mensagem dele em conversa nenhuma)
 *     recebe UMA escada na vida. Sem resposta não há "última mensagem dele"
 *     para zerar a conta: toda retomada já enviada conta, para sempre;
 *   • os toques de um fluxo contam para os outros dois. Quem já recebeu a
 *     régua de silêncio e depois falta a um compromisso, sem ter escrito nada
 *     no meio, NÃO recebe a sequência de falta; quem recebeu a de proposta
 *     parada não recebe a de falta nem a régua, e assim por diante.
 *
 * ═══ Falha de leitura = ADIA (revisão de 20/11, item 2.6) ═══
 *
 * A primeira versão seguia quando não conseguia ler: "um banco que soluça não
 * pode parar o follow-up de quem nem tem equipe pronta". Só que seguir, aqui,
 * é ENVIAR, e a leitura que falhou é justamente a que diria "a equipe está
 * pausada". A pergunta da revisão foi se o nó de envio confere a pausa de
 * novo. Conferido no código: não com garantia. A mensagem de um passo
 * `ai_message` sai por um turno `followup_turn`, e o turno para quando o
 * agente RESOLVIDO PARA A CONVERSA está pausado (`executarTurnoDoAgente`, em
 * `lib/agent-engine/agent/inbound-turn.ts`). Pausar a equipe pausa os quatro
 * agentes dela, então quase sempre o turno para. Mas o agente da conversa é o
 * que o roteador resolve (o follow-up não fixa o agente da inscrição): se a
 * conversa estiver com um agente que não é da equipe, a mensagem sairia com a
 * equipe pausada. Por isso, falha fechada.
 *
 * O custo é pequeno e só existe quando o banco falha: a inscrição é ADIADA por
 * poucos minutos (`ADIAMENTO_POR_LEITURA_MS`, no motor), nunca cancelada, e o
 * tique seguinte tenta de novo. Empresa sem equipe pronta (perfil que não
 * existe) e fluxo que não é da equipe continuam seguindo sem custo: só a
 * leitura que ERRA adia. Um banco que não responde também não entregaria a
 * mensagem.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { instalacaoSchema, type InstalacaoDaEquipe } from "@/lib/schemas/equipe-pronta";
import { NO_DE_INICIO_DA_ESCADA } from "../constantes";

/** O motivo gravado quando a inscrição é adiada pela pausa. */
export const ERRO_DA_EQUIPE_PAUSADA = "equipe_pausada";
/** O motivo gravado quando a inscrição é adiada porque a trava não pôde ser lida. */
export const ERRO_DA_LEITURA_DA_TRAVA = "equipe_pronta_leitura_indisponivel";
/** O motivo gravado quando a inscrição é encerrada pelo limite de toques. */
export const MOTIVO_DO_LIMITE_DE_TOQUES = "limite_de_toques_da_equipe";
/** O evento de `followup_enrollment_events` que marca uma mensagem que SAIU. */
const EVENTO_DE_MENSAGEM_ENVIADA = "action_sent";

export type TravaDoFluxoDaEquipe =
  | null
  | { acao: "adiar"; motivo: typeof ERRO_DA_EQUIPE_PAUSADA | typeof ERRO_DA_LEITURA_DA_TRAVA }
  | { acao: "encerrar"; motivo: typeof MOTIVO_DO_LIMITE_DE_TOQUES; toques: number };

/** Não deu para ler: adia (falha fechada). Nunca cancela. */
export const TRAVA_SEM_LEITURA: TravaDoFluxoDaEquipe = { acao: "adiar", motivo: ERRO_DA_LEITURA_DA_TRAVA };

/**
 * Os status em que uma inscrição ainda pode mandar mensagem. `completed`,
 * `cancelled` e os demais terminais ficam de fora.
 */
const STATUS_DE_INSCRICAO_VIVA: readonly string[] = [
  "active",
  "waiting_reply",
  "dormente",
  "paused_handoff",
  "paused_manual",
];

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
 * Os mesmos fluxos, lidos do JSON cru da instalação: serve para saber se um
 * fluxo É da equipe mesmo quando a instalação não passa no schema. Nesse caso
 * não dá para confiar na pausa lida, e o fluxo da equipe é adiado.
 */
function fluxosDaEquipeNoBruto(bruta: unknown): string[] {
  if (bruta === null || typeof bruta !== "object") return [];
  const instalacao = bruta as Record<string, unknown>;
  const gatilhos =
    instalacao.gatilhos !== null && typeof instalacao.gatilhos === "object"
      ? (instalacao.gatilhos as Record<string, unknown>)
      : {};
  return [
    instalacao.followup_flow_pointer_id,
    gatilhos.fluxo_de_falta_id,
    gatilhos.fluxo_de_proposta_parada_id,
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
  /**
   * Há OUTRA inscrição de fluxo da equipe, deste contato, mais antiga e ainda
   * viva? Duas escadas nascidas quase juntas veem zero toques uma da outra
   * (nenhuma mandou nada ainda): a mais nova sai, a mais antiga fica.
   */
  outraEscadaVivaMaisAntiga?: boolean;
}): TravaDoFluxoDaEquipe {
  if (!c.fluxoDaEquipe) return null;
  if (c.pausada) return { acao: "adiar", motivo: ERRO_DA_EQUIPE_PAUSADA };
  if (c.acabouDeNascer && (c.toquesDesdeAUltimaResposta > 0 || c.outraEscadaVivaMaisAntiga === true)) {
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
  /** Quando a inscrição nasceu: desempata duas escadas nascidas juntas. */
  started_at?: string | null;
}

/**
 * A mesma decisão, lendo o perfil, a pausa e os toques. Nunca lança.
 *
 * Leitura que FALHA adia (`TRAVA_SEM_LEITURA`), em três pontos: o perfil (sem
 * ele não se sabe nem se o fluxo é da equipe), a pausa do agente de Recuperação
 * e a contagem dos toques. Perfil que não existe e fluxo que não é da equipe
 * seguem: não são falha.
 */
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
    if (error) return TRAVA_SEM_LEITURA;
    // A empresa não tem equipe pronta: o fluxo não é dela.
    if (!data) return null;
    const bruta = (data as { instalacao?: unknown }).instalacao;
    const lida = instalacaoSchema.safeParse(bruta ?? {});
    const fluxos = lida.success ? fluxosDaEquipe(lida.data) : fluxosDaEquipeNoBruto(bruta);
    if (!fluxos.includes(inscricao.pointer_id)) return null;
    // Daqui em diante o fluxo É da equipe. Instalação que não passa no schema
    // não diz, com confiança, se a equipe está pausada.
    if (!lida.success) return TRAVA_SEM_LEITURA;
    const instalacao = lida.data;

    let pausada = instalacao.pausa !== null;
    const recuperador = instalacao.agentes.recuperador?.agent_id;
    if (!pausada && recuperador) {
      const { data: agente, error: erroDoAgente } = await admin
        .from("ai_agents")
        .select("paused_at")
        .eq("organization_id", orgId)
        .eq("id", recuperador)
        .maybeSingle();
      if (erroDoAgente) return TRAVA_SEM_LEITURA;
      if ((agente as { paused_at?: string | null } | null)?.paused_at) pausada = true;
    }

    const acabouDeNascer = inscricao.current_node_id === NO_DE_INICIO_DA_ESCADA;
    let toques = 0;
    let outraEscadaVivaMaisAntiga = false;
    if (!pausada && acabouDeNascer) {
      const contagem = await toquesDesdeAUltimaResposta(admin, orgId, inscricao, fluxos);
      if (contagem === null) return TRAVA_SEM_LEITURA;
      toques = contagem.toques;
      outraEscadaVivaMaisAntiga = contagem.outraEscadaVivaMaisAntiga;
    }
    return decidirTravaDoFluxo({
      fluxoDaEquipe: true,
      pausada,
      acabouDeNascer,
      toquesDesdeAUltimaResposta: toques,
      outraEscadaVivaMaisAntiga,
    });
  } catch {
    return TRAVA_SEM_LEITURA;
  }
}

/**
 * Mensagens de retomada que os fluxos da equipe mandaram ao contato depois da
 * última mensagem dele, e se há outra escada da equipe, mais antiga, ainda
 * viva para ele. `null` = alguma leitura falhou.
 *
 * ═══ Duas inscrições nascidas juntas ═══
 *
 * Contar só o que já foi ENVIADO não vê a escada que nasceu no mesmo tique e
 * ainda não mandou nada: as duas leriam zero e as duas enviariam. Hoje o banco
 * não deixa isso acontecer: `idx_followup_enrollments_one_live` é único em
 * `(organization_id, contact_id)` para os status `active`, `waiting_reply`,
 * `paused_handoff` e `paused_manual`, então um contato tem no máximo uma
 * inscrição viva, de qualquer fluxo. A conferência abaixo não depende desse
 * índice (que não cobre `dormente`, e que pode mudar): a inscrição mais NOVA
 * sai quando há outra da equipe, mais antiga, ainda viva. O desempate é
 * `started_at` e depois `id`, igual para as duas, então exatamente uma fica.
 */
async function toquesDesdeAUltimaResposta(
  admin: SupabaseClient,
  orgId: string,
  inscricao: InscricaoParaATrava,
  fluxos: readonly string[],
): Promise<{ toques: number; outraEscadaVivaMaisAntiga: boolean } | null> {
  const { data: conversas, error: erroDasConversas } = await admin
    .from("conversations")
    .select("last_inbound_at")
    .eq("organization_id", orgId)
    .eq("contact_id", inscricao.contact_id);
  if (erroDasConversas) return null;
  let ultimaResposta: string | null = null;
  for (const c of (conversas ?? []) as Array<{ last_inbound_at: string | null }>) {
    if (c.last_inbound_at && (ultimaResposta === null || c.last_inbound_at > ultimaResposta)) {
      ultimaResposta = c.last_inbound_at;
    }
  }

  const { data: outras, error: erroDasOutras } = await admin
    .from("followup_enrollments")
    .select("id, status, started_at")
    .eq("organization_id", orgId)
    .eq("contact_id", inscricao.contact_id)
    .in("pointer_id", [...fluxos])
    .neq("id", inscricao.id);
  if (erroDasOutras) return null;
  const irmas = (outras ?? []) as Array<{ id: string; status?: string | null; started_at?: string | null }>;
  const minhaHora = inscricao.started_at ?? "";
  const outraEscadaVivaMaisAntiga = irmas.some((o) => {
    if (!STATUS_DE_INSCRICAO_VIVA.includes(o.status ?? "")) return false;
    const horaDela = o.started_at ?? "";
    return horaDela < minhaHora || (horaDela === minhaHora && o.id < inscricao.id);
  });
  const ids = irmas.map((o) => o.id);
  if (ids.length === 0) return { toques: 0, outraEscadaVivaMaisAntiga };

  let consulta = admin
    .from("followup_enrollment_events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("event_type", EVENTO_DE_MENSAGEM_ENVIADA)
    .in("enrollment_id", ids);
  if (ultimaResposta !== null) consulta = consulta.gt("created_at", ultimaResposta);
  const { count, error } = await consulta;
  if (error) return null;
  return { toques: count ?? 0, outraEscadaVivaMaisAntiga };
}
