/**
 * QUEM, lendo por MCP, recebe o NOME e o ID de um token de API.
 *
 * `crm_get_conversation_history` e `crm_list_lead_events` dizem qual token
 * escreveu cada mensagem e cada linha do negócio (`author.kind: "agente"`). O
 * nome do token é texto livre que o administrador digitou na tela de tokens
 * ("Sophia produção", "integração do ERP do Fulano"), e o id é o identificador
 * de uma credencial. Os dois são dado de administração (revisão 20/11, item
 * 2.32):
 *
 *  - NUM TURNO DE ATENDIMENTO o modelo está falando com o cliente e poderia
 *    repetir o nome do token na resposta. Ali não sai nome nem id de token
 *    nenhum, nem o do próprio leitor: fica só `kind: "agente"` e `is_self`.
 *  - FORA DO TURNO, quem administra (papel `manager` ou acima) recebe o nome e
 *    o id de todo token.
 *  - FORA DO TURNO, o token comum (papel `agent`) recebe o nome e o id só do
 *    PRÓPRIO token (`is_self: true`), que ele já conhece. De outro token ele
 *    sabe que foi "outro agente externo" (`is_self: false`), sem nome e sem id.
 *
 * `is_self` sai sempre: é o que a tarefa AJ-4 pedia, o agente externo separar
 * a própria fala da de outra integração.
 */
import { ROLE_RANK } from "@/lib/auth/types";

import type { McpContext } from "./types";

export type AlcanceDaIdentidadeDoToken = "todos" | "so_o_proprio" | "nenhum";

export function alcanceDaIdentidadeDoToken(
  ctx: Partial<Pick<McpContext, "role" | "actor" | "contatoDoTurno">>,
): AlcanceDaIdentidadeDoToken {
  // Falha fechada: contexto que não diz quem lê não recebe identidade de token.
  if (!ctx.role || !ctx.actor) return "nenhum";
  // O turno de atendimento: o contato do turno está posto, ou quem lê é o
  // agente do CRM (que só existe para atender).
  if (ctx.contatoDoTurno || ctx.actor.type === "ai_agent") return "nenhum";
  return (ROLE_RANK[ctx.role] ?? 0) >= ROLE_RANK.manager ? "todos" : "so_o_proprio";
}

/** A identidade (id e nome) deste token pode sair para quem lê? */
export function identidadeDoTokenVisivel(alcance: AlcanceDaIdentidadeDoToken, ehOProprio: boolean): boolean {
  return alcance === "todos" || (alcance === "so_o_proprio" && ehOProprio);
}
