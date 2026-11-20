/**
 * Os eventos da "superfície de agente": o que um sistema de fora passa a poder
 * escutar sobre um negócio, além do que já existia (`lead.created`,
 * `lead.stage_changed`, `lead.won`, `lead.lost`, `lead.assigned`…).
 *
 * São eventos comuns do `event_log`: viram gatilho de automação pela fonte
 * única (`ENTIDADE_ESPERADA_POR_GATILHO`, em `lib/schemas/webhooks.ts`) e saem
 * pela ação `call_webhook`, com a mesma assinatura, a mesma retentativa e o
 * mesmo id de entrega de todos os outros. Não há um segundo mecanismo.
 *
 * ─── O QUE VAI NO `event_log` E O QUE NÃO VAI ──────────────────────────────
 * O payload gravado leva IDs e fatos curtos. Texto livre (o corpo de uma nota,
 * a descrição de uma tarefa, o corpo de uma mensagem) NÃO é copiado para cá:
 * a anonimização da LGPD reescreve as tabelas de negócio e não o `event_log`,
 * e o que fosse copiado ficaria fora do alcance dela. Quem entrega o texto
 * INTEIRO é a própria entrega, que o lê da linha atual na hora de enviar
 * (`lib/automation/detalhe-do-evento.ts`). É a mesma régua do endereço do
 * compromisso em `call-webhook.ts`.
 *
 * Pela mesma razão `lead.field_changed` só leva antes-e-depois dos campos
 * tipados sem dado de titular (`CAMPOS_TIPADOS_SEM_PII`): título, descrição e
 * campos do funil saem pelo NOME, e o valor atual vai no objeto `lead` da
 * entrega. O valor anterior deles não é guardado em lugar nenhum do produto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { CAMPOS_TIPADOS_SEM_PII } from "@/lib/leads/valores-audit";
import { logger } from "@/lib/logger";

export const EVENTO_TAG_REMOVIDA = "lead.tag_removed";
export const EVENTO_CAMPO_ALTERADO = "lead.field_changed";
export const EVENTO_NOTA_ADICIONADA = "lead.note_added";
export const EVENTO_TAREFA_CRIADA = "lead.task_created";
export const EVENTO_ANEXO_ADICIONADO = "lead.attachment_added";
export const EVENTO_TAREFA_CONCLUIDA = "task.completed";

/** A entidade que cada evento grava: a mesma que o motor espera na fonte única. */
const ENTIDADE_DO_EVENTO = {
  [EVENTO_TAG_REMOVIDA]: "crm_lead",
  [EVENTO_CAMPO_ALTERADO]: "crm_lead",
  [EVENTO_NOTA_ADICIONADA]: "crm_lead",
  [EVENTO_TAREFA_CRIADA]: "crm_lead",
  [EVENTO_ANEXO_ADICIONADO]: "crm_lead",
  [EVENTO_TAREFA_CONCLUIDA]: "crm_task",
} as const;

export type EventoDaSuperficie = keyof typeof ENTIDADE_DO_EVENTO;

export function entidadeDoEventoDaSuperficie(tipo: EventoDaSuperficie): "crm_lead" | "crm_task" {
  return ENTIDADE_DO_EVENTO[tipo];
}

/**
 * Grava o evento. Melhor esforço por contrato: NUNCA lança.
 *
 * O fato (a nota, a tarefa, o anexo) já está gravado quando isto roda; falhar
 * ao emitir não pode desfazer a escrita nem derrubar quem escreveu. A falha
 * vira log, como nos outros emissores (`crm_manage_tags`, o PATCH do negócio).
 *
 * `supabase` é o cliente de quem escreveu: sessão (a tela) ou serviço (o
 * agente por token). `emit_event` confere a organização nos dois casos.
 */
export async function emitirEventoDaSuperficie(
  supabase: SupabaseClient,
  evento: {
    tipo: EventoDaSuperficie;
    organizationId: string;
    /** O negócio, ou a tarefa em `task.completed`. */
    entidadeId: string;
    payload: Record<string, unknown>;
    requestId?: string | null;
    /** Quem agiu, no formato que os outros emissores já gravam em `metadata`. */
    ator?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const { error } = await supabase.rpc("emit_event", {
      p_event_type: evento.tipo,
      p_entity_kind: ENTIDADE_DO_EVENTO[evento.tipo],
      p_entity_id: evento.entidadeId,
      p_payload: evento.payload,
      p_metadata: { ...(evento.requestId ? { request_id: evento.requestId } : {}), ...evento.ator },
      p_organization_id: evento.organizationId,
    });
    if (error) {
      logger.error("[eventos-de-saida] emit_event falhou", {
        organization_id: evento.organizationId,
        event_type: evento.tipo,
        error: error.message,
      });
    }
  } catch (err) {
    logger.error("[eventos-de-saida] emit_event lançou", {
      organization_id: evento.organizationId,
      event_type: evento.tipo,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** As tags que o negócio tinha e deixou de ter. Reordenar não é remover. */
export function tagsRemovidas(antes: readonly string[] | null | undefined, depois: readonly string[]): string[] {
  const ficaram = new Set(depois);
  return [...new Set(antes ?? [])].filter((t) => !ficaram.has(t));
}

/**
 * Identidade interna: quem é o dono muda por `lead.assigned`, que só mostra o
 * responsável sob o opt-in `include_owner` da regra. Não sai por aqui.
 */
const CAMPOS_DE_DONO = new Set(["owner_user_id", "owner_agent_id"]);

/** As tags têm os eventos delas (`lead.tag_added`, `lead.tag_removed`). */
const CAMPOS_COM_EVENTO_PROPRIO = new Set(["tags", ...CAMPOS_DE_DONO]);

export interface CampoAlterado {
  field: string;
  /** Presentes só nos campos tipados sem dado de titular. */
  old?: unknown;
  new?: unknown;
}

/**
 * O payload de `lead.field_changed`, ou `null` quando a edição não mudou campo
 * nenhum que este evento anuncie (só tags, só dono, ou nada).
 *
 * `fields` são os campos que REALMENTE mudaram (`camposAlterados`). Os campos
 * do funil saem um a um, pela chave (`custom_fields.<chave>`): "mudou
 * custom_fields" não diz a ninguém o que fazer a seguir.
 */
export function payloadDoCampoAlterado(entrada: {
  leadId: string;
  contactId: string | null;
  fields: readonly string[];
  anterior: Record<string, unknown>;
  enviados: Record<string, unknown>;
}): Record<string, unknown> | null {
  const mudancas: CampoAlterado[] = [];
  const tipados = new Set<string>(CAMPOS_TIPADOS_SEM_PII);
  for (const campo of entrada.fields) {
    if (CAMPOS_COM_EVENTO_PROPRIO.has(campo)) continue;
    if (campo === "custom_fields") {
      for (const chave of chavesAlteradas(entrada.anterior.custom_fields, entrada.enviados.custom_fields)) {
        mudancas.push({ field: `custom_fields.${chave}` });
      }
      continue;
    }
    mudancas.push(
      tipados.has(campo)
        ? { field: campo, old: entrada.anterior[campo] ?? null, new: entrada.enviados[campo] ?? null }
        : { field: campo },
    );
  }
  if (mudancas.length === 0) return null;
  return {
    lead_id: entrada.leadId,
    ...(entrada.contactId ? { contact_id: entrada.contactId } : {}),
    fields: mudancas.map((m) => m.field),
    changes: mudancas,
  };
}

function comoObjeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

/** As chaves de `custom_fields` cujo valor difere entre o antes e o depois. */
function chavesAlteradas(antes: unknown, depois: unknown): string[] {
  const a = comoObjeto(antes);
  const d = comoObjeto(depois);
  return [...new Set([...Object.keys(a), ...Object.keys(d)])]
    .filter((chave) => JSON.stringify(a[chave] ?? null) !== JSON.stringify(d[chave] ?? null))
    .sort();
}
