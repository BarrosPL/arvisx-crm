/**
 * QUEM AGIU, para as escritas do agente que precisam de autoria.
 *
 * No MCP quem age nunca é uma linha de `auth.users`: é um token de API (o
 * agente externo, ou uma integração) ou um agente nativo num turno. As colunas
 * de autoria do CRM (`created_by`, `performed_by_user_id`) têm chave estrangeira
 * para pessoa e ficam nulas — então a autoria tem de ser dita de outro jeito:
 *
 *  - na auditoria, pelo token (`actor_api_token_id`) e pelo `metadata`;
 *  - na linha do tempo do negócio, pelo NOME de quem escreveu.
 *
 * O nome sai do cadastro, nunca dos argumentos da ferramenta: do agente
 * (`ai_agents.name`) quando o turno sabe qual agente é, senão do token
 * (`api_tokens.name`, o nome que o administrador deu ao criá-lo).
 */
import type { McpContext } from "./types";

export interface AutorDoContexto {
  /** `agente` = linha de `ai_agents`; `token` = linha de `api_tokens`. */
  tipo: "agente" | "token";
  id: string;
  nome: string;
}

/** O que vai em `audit()` quando a escrita veio por MCP. */
export function auditoriaDoContexto(
  ctx: McpContext,
  extra: Record<string, unknown> = {},
): {
  actorUserId: null;
  actorApiTokenId: string;
  requestId: string;
  metadata: Record<string, unknown>;
} {
  const agentId = ctx.actor.type === "ai_agent" ? ctx.actor.agent_id : undefined;
  return {
    // Nunca o id do ator como `actorUserId`: ele é token ou run, e a coluna tem
    // chave estrangeira para `auth.users` (ver `lib/mcp/audit.ts`).
    actorUserId: null,
    actorApiTokenId: ctx.apiTokenId,
    requestId: ctx.requestId,
    metadata: {
      via: "mcp",
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.id,
      ...(agentId ? { agent_id: agentId } : {}),
      ...extra,
    },
  };
}

/** O autor com nome. Nunca lança: sem nome no cadastro, devolve o rótulo genérico. */
export async function autorDoContexto(ctx: McpContext): Promise<AutorDoContexto> {
  const agentId = ctx.actor.type === "ai_agent" ? ctx.actor.agent_id : undefined;

  if (agentId) {
    const { data } = await ctx.supabase
      .from("ai_agents")
      .select("id, name")
      .eq("organization_id", ctx.organizationId)
      .eq("id", agentId)
      .maybeSingle();
    const nome = (data as { name?: string | null } | null)?.name?.trim();
    return { tipo: "agente", id: agentId, nome: nome || "Agente" };
  }

  const { data } = await ctx.supabase
    .from("api_tokens")
    .select("id, name")
    .eq("organization_id", ctx.organizationId)
    .eq("id", ctx.apiTokenId)
    .maybeSingle();
  const nome = (data as { name?: string | null } | null)?.name?.trim();
  return { tipo: "token", id: ctx.apiTokenId, nome: nome || "Integração" };
}
