/**
 * O TOKEN DE API de quem agiu, quando quem agiu é um sistema de FORA.
 *
 * Um agente externo fala com o CRM por token (`api_tokens`). Ele chega como um
 * de dois atores (`deriveActor`, em `lib/mcp/auth.ts`):
 *
 *  - `api_token`: o token sem escopo de agente. `id` é o id do token;
 *  - `ai_agent` SEM `agent_id`: o token com o escopo `actor:ai_agent`. O token
 *    está em `api_token_id` (`id` pode ser o da execução).
 *
 * O agente NATIVO também carrega um `api_token_id`, mas é o token efêmero da
 * rodada (`lib/ai/runtime/mcp_token.ts`), que não identifica ninguém: quem o
 * identifica é `agent_id`. Por isso ele fica de fora daqui, e a autoria dele
 * continua saindo pelo agente.
 *
 * Só o ID. Nunca o valor do token: ele nem existe no banco (só o hash).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A chave de `messages.metadata` com quem enviou por token. Gravada só pelo servidor. */
export const CHAVE_DO_ENVIO_POR_TOKEN = "sent_by_token";

export function tokenExternoDoAtor(actor: Actor): string | null {
  if (actor.type === "api_token") return actor.id || null;
  if (actor.type === "ai_agent" && !actor.agent_id) return actor.api_token_id || null;
  return null;
}

/** `{ tipo: "token", id }`, o formato de autor que a nota do negócio já grava no `payload`. */
export function autorExternoDoAtor(actor: Actor): { tipo: "token"; id: string } | null {
  const id = tokenExternoDoAtor(actor);
  return id ? { tipo: "token", id } : null;
}

export interface EnvioPorToken {
  token_id: string;
  /** O nome que o administrador deu ao token. `null` quando não pôde ser lido. */
  token_name: string | null;
}

/**
 * Quem enviou, para gravar na mensagem. Nunca lança: sem o nome, o id basta
 * para a leitura separar um token do outro.
 */
export async function envioPorTokenDoAtor(
  supabase: SupabaseClient,
  organizationId: string,
  actor: Actor,
): Promise<EnvioPorToken | null> {
  const tokenId = tokenExternoDoAtor(actor);
  if (!tokenId) return null;
  if (!UUID.test(tokenId)) return { token_id: tokenId, token_name: null };
  try {
    const { data } = await supabase
      .from("api_tokens")
      .select("name")
      .eq("organization_id", organizationId)
      .eq("id", tokenId)
      .maybeSingle();
    const nome = (data as { name?: unknown } | null)?.name;
    return { token_id: tokenId, token_name: typeof nome === "string" && nome.trim() !== "" ? nome.trim() : null };
  } catch {
    return { token_id: tokenId, token_name: null };
  }
}
