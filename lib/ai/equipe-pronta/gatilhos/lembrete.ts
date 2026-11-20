/**
 * GATILHO: RESPOSTA AO LEMBRETE DA AGENDA → AGENDAMENTO confirma ou remarca.
 *
 * O lembrete é mandado pelo cron da agenda (`app/api/v1/cron/agenda-reminder`),
 * não por um agente. A resposta da pessoa ("confirmo", "não vou conseguir") é
 * uma mensagem comum, e o roteador da equipe a classificaria do zero: "sim"
 * solto não tem assunto, e cairia no Atendimento, que não tem as ferramentas da
 * agenda.
 *
 * O que este gatilho faz é só isto: logo depois de o lembrete sair, FIXA o
 * agente de Agendamento como o agente da conversa, pela mesma aderência que o
 * roteador já lê (`conversations.active_ai_agent_id` / `active_intent`, a que
 * `passar_para_colega` também grava). A resposta da pessoa chega a ele, que
 * confirma (`crm_confirm_appointment`) ou remarca. O roteador da equipe nasce
 * com a continuidade ligada; uma terceira intenção, com confiança, troca o
 * agente como sempre.
 *
 * Nada é enviado aqui. Quem fala com o cliente é o cron (o lembrete) e depois o
 * turno de resposta do agente, cada um com as próprias travas. Ainda assim o
 * gatilho confere as mesmas travas da equipe antes de fixar, para não deixar
 * marcada uma conversa em que a equipe não vai agir: plano, pausa da equipe,
 * agente pausado, ensaio (só número de teste), pessoa que assumiu a conversa e
 * opt-out. A janela de resposta do canal é conferida pelo turno de resposta.
 *
 * NUNCA lança: o lembrete já saiu, e uma falha aqui não pode virar "erro no
 * envio" na rodada do cron.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { PAPEL_AGENDAMENTO } from "../papeis/agendamento";
import { lerEquipeInstalada, travaDaEquipe, travasDeFalarComOCliente, type CodigoDaTrava } from "./travas";

export type MotivoDeNaoFixar =
  | "sem_equipe"
  | "sem_agente_de_agendamento"
  | "conversa_de_outro_canal"
  | "conversa_nao_encontrada"
  | "falha"
  | CodigoDaTrava;

export type ResultadoDoLembrete =
  | { fixado: true; agentId: string }
  | { fixado: false; motivo: MotivoDeNaoFixar };

export async function entregarRespostaDoLembreteAoAgendamento(
  admin: SupabaseClient,
  entrada: { organizationId: string; conversationId: string; contactId: string },
): Promise<ResultadoDoLembrete> {
  const { organizationId, conversationId, contactId } = entrada;
  try {
    const equipe = await lerEquipeInstalada(admin, organizationId);
    if (!equipe) return { fixado: false, motivo: "sem_equipe" };
    const agentId = equipe.instalacao.agentes.agendamento?.agent_id;
    // Empresa que não agenda não tem tipo de agenda da equipe: o lembrete é de
    // um compromisso que ela marcou por conta própria, e a equipe não o assume.
    if (!agentId || equipe.instalacao.event_type_id === null) {
      return { fixado: false, motivo: "sem_agente_de_agendamento" };
    }

    const daEquipe = await travaDaEquipe(admin, organizationId, equipe);
    if (daEquipe) return { fixado: false, motivo: daEquipe.codigo };

    const { data: conversa, error } = await admin
      .from("conversations")
      .select("id, channel_session_id")
      .eq("organization_id", organizationId)
      .eq("id", conversationId)
      .eq("contact_id", contactId)
      .maybeSingle();
    if (error) return { fixado: false, motivo: "falha" };
    const conv = conversa as { id: string; channel_session_id: string } | null;
    if (!conv) return { fixado: false, motivo: "conversa_nao_encontrada" };
    // Só o canal em que a equipe atende: noutro número quem responde é outro agente.
    if (conv.channel_session_id !== equipe.instalacao.channel_session_id) {
      return { fixado: false, motivo: "conversa_de_outro_canal" };
    }

    const travas = await travasDeFalarComOCliente(admin, {
      organizationId,
      agentId,
      contactId,
      conversationId,
    });
    if (travas.trava) return { fixado: false, motivo: travas.trava.codigo };

    const { error: erroDaEscrita } = await admin
      .from("conversations")
      .update({
        active_ai_agent_id: agentId,
        active_intent: PAPEL_AGENDAMENTO.intencao.nome,
        active_agent_set_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId)
      .eq("id", conversationId);
    if (erroDaEscrita) return { fixado: false, motivo: "falha" };
    return { fixado: true, agentId };
  } catch {
    return { fixado: false, motivo: "falha" };
  }
}
