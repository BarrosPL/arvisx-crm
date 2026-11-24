/**
 * A PROPOSTA DE PRÓXIMA AÇÃO de um negócio — a leitura, fora da rota.
 *
 * A próxima ação é escrita pelo agente em `lead_state.next_action`, que é por
 * CONTATO; o card é um NEGÓCIO. Duas portas precisam atravessar essa mesma
 * ponte: a tela, quando alguém aprova ou descarta a proposta
 * (`app/api/v1/leads/[id]/next-action`), e o agente, quando a escreve
 * (`lib/mcp/tools/proxima-acao.ts` — o token de API não entra na rota REST).
 * Atravessada em dois lugares, a ponte diverge: uma das portas passaria a
 * achar proposta num negócio sem contato.
 *
 * Aqui mora só a leitura, com as recusas que as duas portas compartilham.
 * A escrita continua tendo UM caminho: `applyLeadStateUpdate`
 * (`lib/agent-engine/agent/lead-state.ts`), o único que move
 * `next_action_seq` — a identidade que a aprovação humana confere.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface NegocioDaProposta {
  id: string;
  organization_id: string;
  contact_id: string;
  status: string;
}

export type LeituraDaProposta =
  | {
      ok: true;
      lead: NegocioDaProposta;
      /** O texto proposto, já sem espaço nas pontas. `null` = nada pendente. */
      atual: string | null;
      /** Identidade da proposta (migration 0073). `0` quando nunca houve. */
      seq: number;
    }
  | { ok: false; recusa: "falha"; erro: string }
  | { ok: false; recusa: "negocio_nao_encontrado" }
  /** `lead_state` é por contato: negócio sem contato não tem onde guardar proposta. */
  | { ok: false; recusa: "negocio_sem_contato" };

/**
 * Lê o negócio e a proposta pendente do contato dele.
 *
 * `organizationId` é OBRIGATÓRIO para quem usa service role (o agente): sem
 * ele o filtro de organização seria só a RLS, que o admin client ignora. A rota
 * da tela o omite — lá o negócio vem pela RLS de quem está logado, e é ele que
 * prova a organização.
 */
export async function lerPropostaDoNegocio(
  supabase: SupabaseClient,
  leadId: string,
  organizationId?: string,
): Promise<LeituraDaProposta> {
  let consulta = supabase
    .from("crm_leads")
    .select("id, organization_id, contact_id, status")
    .eq("id", leadId);
  if (organizationId) consulta = consulta.eq("organization_id", organizationId);
  const { data: lead, error: leadErr } = await consulta.maybeSingle();
  if (leadErr) return { ok: false, recusa: "falha", erro: leadErr.message };
  if (!lead) return { ok: false, recusa: "negocio_nao_encontrado" };

  const row = lead as {
    id: string;
    organization_id: string;
    contact_id: string | null;
    status: string;
  };
  if (!row.contact_id) return { ok: false, recusa: "negocio_sem_contato" };

  const { data: estado, error: estadoErr } = await supabase
    .from("lead_state")
    .select("next_action, next_action_seq")
    .eq("organization_id", row.organization_id)
    .eq("contact_id", row.contact_id)
    .maybeSingle();
  if (estadoErr) return { ok: false, recusa: "falha", erro: estadoErr.message };

  const linha = estado as { next_action: string | null; next_action_seq: number } | null;
  return {
    ok: true,
    lead: { ...row, contact_id: row.contact_id },
    atual: linha?.next_action?.trim() || null,
    seq: linha?.next_action_seq ?? 0,
  };
}
