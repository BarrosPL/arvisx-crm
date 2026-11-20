/**
 * Adaptador fino: pluga `tarefaDeSeguimentoDoGanho` no dreno do `event_log`.
 *
 * `organization_id` vem DA LINHA DO EVENTO, nunca de parâmetro. Recusa vira
 * `skipped` (com o motivo no `detail`, que o dreno conserva) e falha de banco
 * vira `error` (conta tentativa e vai ao teto), como nos consumidores vizinhos.
 * Nunca lança: o ganho não pode ser derrubado pelo seguimento dele.
 */
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { portaDaAplicacao } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";

import { tarefaDeSeguimentoDoGanho } from "./negocio-ganho";

/** A chave do consumidor em `event_log.consumed_by`. */
export const SEGUIMENTO_DO_GANHO_KEY = "equipe-pronta.seguimento-do-ganho.v1";

const resultado = (status: HandlerResult["status"], detail?: string): HandlerResult => ({
  consumer_key: SEGUIMENTO_DO_GANHO_KEY,
  status,
  detail,
});

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor : null;
}

async function handle(row: EventRow): Promise<HandlerResult> {
  const leadId = texto(row.payload.lead_id) ?? texto(row.entity_id);
  if (!leadId) return resultado("skipped", "sem_negocio");
  try {
    const desfecho = await tarefaDeSeguimentoDoGanho(createAdminClient(), portaDaAplicacao(), {
      organizationId: row.organization_id,
      leadId,
      requestId: `event:${row.id}`,
    });
    if (desfecho.estado === "criada") return resultado("ok", `criada:${desfecho.tarefaId}`);
    if (desfecho.estado === "ja_existia") return resultado("ok", "ja_existia");
    if (desfecho.estado === "pulado") return resultado("skipped", desfecho.motivo);
    return resultado("error", desfecho.erro);
  } catch (e) {
    return resultado("error", e instanceof Error ? e.message : String(e));
  }
}

export const seguimentoDoGanhoHandler: EventHandler = {
  key: SEGUIMENTO_DO_GANHO_KEY,
  // Empresa parada não recebe tarefa nova: o evento é pulado, como nos vizinhos.
  naOrgParada: "pula",
  events: ["lead.won"],
  handle,
};
