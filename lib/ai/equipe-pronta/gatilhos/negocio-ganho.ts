/**
 * GATILHO: NEGÓCIO GANHO → uma tarefa "dar seguimento" para uma pessoa da equipe.
 *
 * O negócio se ganha por vários caminhos (o agente de Propostas com
 * `crm_close_demand`, o arrasto no Kanban, o botão Ganhar, o aceite da proposta
 * pela tela), e todos passam pelo mesmo gatilho do banco, que grava `lead.won`
 * no `event_log`. Um consumidor do evento cobre todos com uma decisão só — o
 * mesmo desenho de `lib/financeiro/comanda-do-ganho.handler.ts`.
 *
 * A tarefa é criada pela MESMA função da tela e de `crm_create_task`
 * (`lib/tarefas/servico.ts`): mesma conferência de responsável, mesma
 * auditoria, mesma linha na timeline do negócio.
 *
 * ═══ Idempotência ═══
 *
 * Uma tarefa de seguimento por negócio. Antes de criar, procura uma tarefa do
 * negócio com o tipo `TIPO_DA_TAREFA_DE_SEGUIMENTO` (qualquer situação, mesmo
 * concluída): o dreno que reexecuta a linha, o ganho regravado e o negócio
 * reaberto e ganho de novo acham a que já existe e não criam outra.
 *
 * ═══ As travas ═══
 *
 * A tarefa é interna: ninguém fala com o cliente aqui. Por isso valem as
 * travas da EQUIPE (plano, pausa, e o ensaio, em que a equipe só age sobre os
 * números de teste), e não as de falar com o cliente (janela do canal, opt-out,
 * pessoa que assumiu): avisar a equipe de que há um negócio ganho para cuidar
 * não depende de o cliente poder receber mensagem.
 *
 * Só o funil da equipe: negócio ganho em outro funil da empresa não é dela.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/lib/api/handlers/types";
import { decidirPreGoLiveDoCanalViaSupabase } from "@/lib/ai/elegibilidade/consulta-pre-go-live";
import type { Db } from "@/lib/db";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { criarTarefa } from "@/lib/tarefas/servico";
import { lerEquipeInstalada, travaDaEquipe } from "./travas";

/** `crm_tasks.kind` da tarefa de seguimento. É a chave da idempotência. */
export const TIPO_DA_TAREFA_DE_SEGUIMENTO = "dar_seguimento";
export const TITULO_DA_TAREFA_DE_SEGUIMENTO = "Dar seguimento ao negócio ganho";
export const DESCRICAO_DA_TAREFA_DE_SEGUIMENTO =
  "Este negócio foi marcado como ganho. Confira o que foi combinado com o cliente e dê seguimento.";
/** O prazo da tarefa: um dia depois do ganho. */
const PRAZO_MS = 86_400_000;

export type DesfechoDoGanho =
  | { estado: "criada"; tarefaId: string }
  | { estado: "ja_existia"; tarefaId: string }
  | {
      estado: "pulado";
      motivo:
        | "sem_equipe"
        | "negocio_nao_encontrado"
        | "negocio_nao_ganho"
        | "outro_funil"
        | "equipe_pausada"
        | "fora_do_plano"
        | "modo_ensaio";
    }
  | { estado: "falha"; erro: string };

export async function tarefaDeSeguimentoDoGanho(
  admin: SupabaseClient,
  db: Db,
  entrada: { organizationId: string; leadId: string; requestId: string; agora?: Date },
): Promise<DesfechoDoGanho> {
  const { organizationId, leadId } = entrada;

  let equipe: Awaited<ReturnType<typeof lerEquipeInstalada>>;
  try {
    equipe = await lerEquipeInstalada(admin, organizationId);
  } catch (e) {
    return { estado: "falha", erro: e instanceof Error ? e.message : String(e) };
  }
  if (!equipe) return { estado: "pulado", motivo: "sem_equipe" };

  const { data: lead, error: erroDoLead } = await admin
    .from("crm_leads")
    .select("status, pipeline_id, contact_id, owner_user_id")
    .eq("organization_id", organizationId)
    .eq("id", leadId)
    .maybeSingle();
  if (erroDoLead) return { estado: "falha", erro: `negocio: ${erroDoLead.message}` };
  const negocio = lead as {
    status: string | null;
    pipeline_id: string | null;
    contact_id: string | null;
    owner_user_id: string | null;
  } | null;
  if (!negocio) return { estado: "pulado", motivo: "negocio_nao_encontrado" };
  // O evento é pista, não fato: quem decide é a linha do negócio.
  if (negocio.status !== "won") return { estado: "pulado", motivo: "negocio_nao_ganho" };
  if (!equipe.instalacao.pipeline_id || negocio.pipeline_id !== equipe.instalacao.pipeline_id) {
    return { estado: "pulado", motivo: "outro_funil" };
  }

  // ── a tarefa que já existe vem ANTES das travas: repetir o evento com a
  //    equipe pausada devolve a mesma resposta de antes, não um motivo novo ──
  const { data: existente, error: erroDaBusca } = await admin
    .from("crm_tasks")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .eq("kind", TIPO_DA_TAREFA_DE_SEGUIMENTO)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (erroDaBusca) return { estado: "falha", erro: `tarefa: ${erroDaBusca.message}` };
  if (existente) return { estado: "ja_existia", tarefaId: String((existente as { id: string }).id) };

  let daEquipe: Awaited<ReturnType<typeof travaDaEquipe>>;
  try {
    daEquipe = await travaDaEquipe(admin, organizationId, equipe);
  } catch (e) {
    return { estado: "falha", erro: e instanceof Error ? e.message : String(e) };
  }
  if (daEquipe?.codigo === "equipe_pausada") return { estado: "pulado", motivo: "equipe_pausada" };
  if (daEquipe?.codigo === "fora_do_plano") return { estado: "pulado", motivo: "fora_do_plano" };

  // ── ensaio: a equipe só age sobre os números de teste ──
  const canalId = equipe.instalacao.channel_session_id;
  if (canalId) {
    let telefone = "";
    if (negocio.contact_id) {
      const { data: contato, error: erroDoContato } = await admin
        .from("contacts")
        .select("phone_number")
        .eq("organization_id", organizationId)
        .eq("id", negocio.contact_id)
        .maybeSingle();
      if (erroDoContato) return { estado: "falha", erro: `contato: ${erroDoContato.message}` };
      telefone = (contato as { phone_number?: string | null } | null)?.phone_number ?? "";
    }
    try {
      const acesso = await decidirPreGoLiveDoCanalViaSupabase(admin, {
        organizationId,
        channelSessionId: canalId,
        contactPhoneNumber: telefone,
      });
      if (!acesso.permite) return { estado: "pulado", motivo: "modo_ensaio" };
    } catch (e) {
      return { estado: "falha", erro: e instanceof Error ? e.message : String(e) };
    }
  }

  const respostas = equipe.respostas as { negocio?: { idioma?: unknown } } | null;
  const idioma = normalizarIdioma(typeof respostas?.negocio?.idioma === "string" ? respostas.negocio.idioma : null);
  const propostas = equipe.instalacao.agentes.proposta?.agent_id;
  // Quem assina a tarefa é o agente de Propostas, o dono da etapa de ganho.
  const ator: Actor = propostas
    ? { type: "ai_agent", id: propostas, role: "agent", agent_id: propostas }
    : { type: "webhook_source", id: leadId };
  const agora = entrada.agora ?? new Date();

  const criar = (responsavel: string | null) =>
    criarTarefa({
      supabase: admin,
      db,
      organizationId,
      ator,
      auditoria: {
        actorUserId: null,
        requestId: entrada.requestId,
        metadata: { via: "equipe_pronta", gatilho: "negocio_ganho", ...(propostas ? { agent_id: propostas } : {}) },
      },
      dados: {
        title: traduzir(TITULO_DA_TAREFA_DE_SEGUIMENTO, idioma),
        description: traduzir(DESCRICAO_DA_TAREFA_DE_SEGUIMENTO, idioma),
        due_date: new Date(agora.getTime() + PRAZO_MS).toISOString(),
        priority: "high",
        status: "pending",
        lead_id: leadId,
        contact_id: negocio.contact_id,
        assigned_to: responsavel,
        kind: TIPO_DA_TAREFA_DE_SEGUIMENTO,
      },
      criadaPor: null,
    });

  // O dono do negócio, quando há; "a equipe" (sem responsável) quando não há,
  // ou quando o dono saiu da equipe.
  let desfecho = await criar(negocio.owner_user_id);
  if (!desfecho.ok && desfecho.recusa === "responsavel_fora_da_equipe") desfecho = await criar(null);
  if (!desfecho.ok) return { estado: "falha", erro: `tarefa: ${desfecho.recusa}` };
  return { estado: "criada", tarefaId: desfecho.tarefa.id };
}
