/**
 * O detalhe que a entrega do webhook lê da linha ATUAL, na hora de enviar.
 *
 * O `event_log` guarda IDs; o texto inteiro mora na tabela de negócio. É aqui
 * que a entrega busca a mensagem, a nota e a tarefa do evento, sempre com o
 * filtro de organização (a porta é a chave de serviço, que ignora RLS).
 *
 * ─── O CORTE DE 280 CARACTERES ─────────────────────────────────────────────
 * O payload de `message.received` nasce no banco (`fn_emit_message_event`) com
 * `body_preview`, os primeiros 280 caracteres da mensagem. A prévia continua
 * existindo e continua com esse nome: ela é o que o aviso de mensagem nova e o
 * follow-up leem, e é o que mantém o corpo da conversa fora do `event_log`.
 * O defeito era ela ser a ÚNICA coisa que a entrega levava. Agora toda entrega
 * de evento de mensagem leva `message.text`, o texto inteiro, lido daqui.
 * Vale para os eventos de mensagem que já existiam, sem mudar o banco.
 *
 * Nada aqui lança: detalhe que não pôde ser lido sai ausente, e a entrega
 * segue com o que o evento já trazia. Uma entrega a menos é pior que um campo
 * a menos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EVENTO_IA_PAUSADA,
  EVENTO_IA_RETOMADA,
  EVENTO_NOTA_ADICIONADA,
  EVENTO_TAREFA_CONCLUIDA,
  EVENTO_TAREFA_CRIADA,
} from "@/lib/automation/eventos-de-saida";
import { estadoDaIaNaConversa } from "@/lib/inbox/estado-da-ia";
import { lerNotaDoNegocio } from "@/lib/leads/notas-do-negocio";
import { logger } from "@/lib/logger";
import { nomesDosAtendentesCom } from "@/lib/users/nome-do-atendente";

const COLUNAS_DA_MENSAGEM =
  "id, conversation_id, channel_session_id, contact_id, direction, type, status, body, media_mime, sent_at, created_at";

const CAMPOS_PUBLICOS_DA_TAREFA = [
  "id",
  "title",
  "description",
  "due_date",
  "priority",
  "status",
  "kind",
  "result",
  "lead_id",
  "contact_id",
  "created_at",
  "updated_at",
] as const;

const COLUNAS_DA_TAREFA = [...CAMPOS_PUBLICOS_DA_TAREFA, "assigned_to"].join(", ");

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor !== "" ? valor : null;
}

/** A mensagem do evento, com o texto INTEIRO. */
async function mensagemDoEvento(
  admin: SupabaseClient,
  organizationId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const id = texto(payload.message_id);
  if (!id) return undefined;
  const { data } = await admin
    .from("messages")
    .select(COLUNAS_DA_MENSAGEM)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return undefined;
  const linha = data as Record<string, unknown>;
  return {
    message: {
      id: linha.id,
      conversation_id: linha.conversation_id ?? null,
      channel_session_id: linha.channel_session_id ?? null,
      direction: linha.direction ?? null,
      type: linha.type ?? null,
      status: linha.status ?? null,
      // O texto como está gravado AGORA: inteiro, ou `null` em mídia sem
      // legenda e em mensagem que a anonimização já limpou.
      text: typeof linha.body === "string" ? linha.body : null,
      media_mime: linha.media_mime ?? null,
      sent_at: linha.sent_at ?? linha.created_at ?? null,
    },
  };
}

/** A nota do evento, com o texto inteiro e a autoria. */
async function notaDoEvento(
  admin: SupabaseClient,
  organizationId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const id = texto(payload.note_id);
  const leadId = texto(payload.lead_id);
  if (!id || !leadId) return undefined;
  const nota = await lerNotaDoNegocio(admin, organizationId, leadId, id);
  return nota ? { note: nota } : undefined;
}

/**
 * A tarefa do evento. O responsável (`assigned_to`) é identidade da equipe:
 * só sai com o opt-in `include_owner` da regra, a mesma régua do responsável
 * do negócio e do compromisso.
 */
async function tarefaDoEvento(
  admin: SupabaseClient,
  organizationId: string,
  payload: Record<string, unknown>,
  incluirResponsavel: boolean,
): Promise<Record<string, unknown> | undefined> {
  const id = texto(payload.task_id);
  if (!id) return undefined;
  const { data } = await admin
    .from("crm_tasks")
    .select(COLUNAS_DA_TAREFA)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return undefined;
  // Projeção campo a campo, nunca a linha inteira: o que sai é o que está nesta
  // lista, mesmo que a consulta um dia traga mais colunas.
  const linha = data as unknown as Record<string, unknown>;
  const tarefa: Record<string, unknown> = {};
  for (const campo of CAMPOS_PUBLICOS_DA_TAREFA) tarefa[campo] = linha[campo] ?? null;
  const responsavelId = linha.assigned_to;
  if (!incluirResponsavel || typeof responsavelId !== "string") return { task: tarefa };
  const nome = (await nomesDosAtendentesCom(admin, organizationId, [responsavelId])).get(responsavelId);
  return {
    task: {
      ...tarefa,
      assigned_to: { id: responsavelId, ...(typeof nome === "string" && nome ? { name: nome } : {}) },
    },
  };
}

const COLUNAS_DA_CONVERSA =
  "id, contact_id, channel_session_id, status, assigned_to_user_id, assignee_kind, assigned_at, bot_silenced_until, last_handoff_at, last_handoff_reason, last_outbound_at, is_group, contacts:contact_id(force_human, ai_opt_out, is_blocked)";

/**
 * A conversa de `conversation.ai_paused` / `conversation.ai_resumed`, com o
 * estado da IA como ele está AGORA (`estadoDaIaNaConversa`, a mesma regra de
 * `crm_get_conversation`). Lido da linha atual porque o motivo escrito
 * (`last_handoff_reason`) é texto livre e não mora no `event_log`.
 *
 * Quem assumiu é identidade da equipe: `ai.by` só sai com o opt-in
 * `include_owner` da regra, a mesma régua do responsável do negócio.
 */
async function conversaDoEvento(
  admin: SupabaseClient,
  organizationId: string,
  payload: Record<string, unknown>,
  incluirResponsavel: boolean,
): Promise<Record<string, unknown> | undefined> {
  const id = texto(payload.conversation_id);
  if (!id) return undefined;
  const { data } = await admin
    .from("conversations")
    .select(COLUNAS_DA_CONVERSA)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return undefined;
  const linha = data as unknown as Record<string, unknown> & {
    contacts?: { force_human?: boolean | null; ai_opt_out?: boolean | null; is_blocked?: boolean | null } | null;
  };
  const textoOuNulo = (v: unknown) => (typeof v === "string" ? v : null);
  const { by_user_id, ...estado } = estadoDaIaNaConversa({
    status: textoOuNulo(linha.status) ?? "",
    assigned_to_user_id: textoOuNulo(linha.assigned_to_user_id),
    assignee_kind: textoOuNulo(linha.assignee_kind),
    assigned_at: textoOuNulo(linha.assigned_at),
    bot_silenced_until: textoOuNulo(linha.bot_silenced_until),
    last_handoff_at: textoOuNulo(linha.last_handoff_at),
    last_handoff_reason: textoOuNulo(linha.last_handoff_reason),
    last_outbound_at: textoOuNulo(linha.last_outbound_at),
    is_group: linha.is_group === true,
    force_human: linha.contacts?.force_human ?? false,
    ai_opt_out: linha.contacts?.ai_opt_out ?? false,
    is_blocked: linha.contacts?.is_blocked ?? false,
  });
  let quem: Record<string, unknown> | undefined;
  if (incluirResponsavel && by_user_id) {
    const nome = (await nomesDosAtendentesCom(admin, organizationId, [by_user_id])).get(by_user_id);
    quem = { id: by_user_id, ...(typeof nome === "string" && nome ? { name: nome } : {}) };
  }
  return {
    conversation: {
      id: linha.id,
      contact_id: linha.contact_id ?? null,
      channel_session_id: linha.channel_session_id ?? null,
      status: linha.status ?? null,
      ai: { ...estado, ...(quem ? { by: quem } : {}) },
    },
  };
}

/**
 * As chaves a acrescentar em `data` na entrega: `message`, `note`, `task` ou
 * `conversation`, conforme o evento. Vazio para os eventos que não têm detalhe
 * a buscar.
 */
export async function detalheDoEvento(
  admin: SupabaseClient,
  organizationId: string,
  evento: { event_type: string; payload: Record<string, unknown> | null | undefined },
  opcoes: { incluirResponsavel: boolean },
): Promise<Record<string, unknown>> {
  const payload = evento.payload ?? {};
  try {
    if (evento.event_type.startsWith("message.")) {
      return (await mensagemDoEvento(admin, organizationId, payload)) ?? {};
    }
    if (evento.event_type === EVENTO_NOTA_ADICIONADA) {
      return (await notaDoEvento(admin, organizationId, payload)) ?? {};
    }
    if (evento.event_type === EVENTO_IA_PAUSADA || evento.event_type === EVENTO_IA_RETOMADA) {
      return (await conversaDoEvento(admin, organizationId, payload, opcoes.incluirResponsavel)) ?? {};
    }
    if (evento.event_type === EVENTO_TAREFA_CRIADA || evento.event_type === EVENTO_TAREFA_CONCLUIDA) {
      return (await tarefaDoEvento(admin, organizationId, payload, opcoes.incluirResponsavel)) ?? {};
    }
  } catch (err) {
    logger.warn("[automation.detalhe-do-evento] detalhe não lido — a entrega segue sem ele", {
      organization_id: organizationId,
      event_type: evento.event_type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return {};
}
