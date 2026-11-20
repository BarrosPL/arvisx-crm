/**
 * FECHAR UMA CONVERSA — a regra, num lugar só.
 *
 * Dois caminhos fecham conversa e os dois passam por aqui:
 *
 *  - a tela, por `POST /api/v1/conversations/[id]/close` (sessão de usuário);
 *  - o agente, pela ferramenta `crm_close_conversation` (token de API ou turno).
 *
 * O que é de cada porta fica na porta: quem pode fechar (papel e controle da
 * conversa, na rota; escopo do token e contato do turno, na ferramenta) e a
 * escolha de devolver o contato ao automático, que só a tela oferece. O que é
 * da REGRA mora aqui:
 *
 *  1. a conversa é lida com o filtro de organização, sempre — o cliente pode
 *     ser service role, e sem o filtro a RLS não segura;
 *  2. o estado de atendimento só muda pela `fn_service_status`, com a revisão
 *     lida como trava otimista. Revisão obsoleta é CONFLITO, nunca fechamento
 *     por cima de estado alheio;
 *  3. o fechamento entra na auditoria como `conversation.closed`, com quem
 *     fechou (pessoa ou token).
 *
 * Fechar NÃO envia nada ao cliente e não toca em trava de atendimento humano
 * (`contacts.force_human`): a função do banco só carimba o estado do
 * atendimento. A próxima mensagem do cliente reabre a conversa, como sempre.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import type { Conversation } from "@/lib/types/messaging";

/** Atendimento encerrado: fechado, resolvido ou arquivado (os terminais da `fn_service_status`). */
export const STATUS_DE_CONVERSA_ENCERRADA: ReadonlyArray<string> = ["closed", "resolved", "archived"];

export function conversaJaEncerrada(status: string | null | undefined): boolean {
  return typeof status === "string" && STATUS_DE_CONVERSA_ENCERRADA.includes(status);
}

/** O que se lê da conversa antes de fechar. */
export interface ConversaParaFechar {
  id: string;
  organization_id: string;
  contact_id: string | null;
  status: string;
  assigned_to_user_id: string | null;
  service_revision: number;
}

export type LeituraDaConversaParaFechar =
  | { ok: true; conversa: ConversaParaFechar | null }
  | { ok: false; detalhe: string };

/**
 * Lê a conversa DESTA organização. `conversa: null` = não existe aqui (inexiste
 * ou é de outra organização — a resposta é a mesma, o id não vira oráculo).
 */
export async function lerConversaParaFechar(
  supabase: SupabaseClient,
  organizationId: string,
  conversationId: string,
): Promise<LeituraDaConversaParaFechar> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, organization_id, contact_id, status, assigned_to_user_id, service_revision")
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) return { ok: false, detalhe: error.message };
  return { ok: true, conversa: (data as ConversaParaFechar | null) ?? null };
}

/** Quem fechou, para a auditoria. Token e pessoa nunca juntos na mesma coluna. */
export interface AtorDoFechamento {
  /** `auth.users.id` de quem fechou pela tela; `null` quando foi um agente. */
  actorUserId: string | null;
  /** `api_tokens.id` de quem fechou por MCP. */
  actorApiTokenId?: string | null;
  metadata?: Record<string, unknown>;
}

export type DesfechoDoFechamento =
  | {
      ok: true;
      /** A linha como a `fn_service_status` a devolveu. */
      conversa: Conversation;
      /** `false` = já estava fechada: nada mudou no banco. */
      mudou: boolean;
    }
  | { ok: false; erro: "conflito" | "falha"; detalhe: string };

/**
 * Fecha a conversa já lida e conferida por quem chama.
 *
 * `mudou` sai do estado lido: a função do banco recebe a revisão lida como
 * trava, então chegar ao fim sem conflito prova que ninguém mexeu no
 * atendimento desde a leitura — e fechar o que já estava `closed` é, lá
 * dentro, devolver a linha sem escrever (`if c.status=p_status then return c`).
 *
 * A auditoria segue a doutrina (audita quando houve efeito). A rota da tela
 * sempre auditou o gesto, mesmo sobre conversa já fechada, e mantém isso com
 * `auditarSemMudanca`.
 */
export async function fecharConversa(deps: {
  /** Service role: a `fn_service_status` só é executável por ele. */
  admin: Pick<SupabaseClient, "rpc">;
  conversa: Pick<ConversaParaFechar, "id" | "organization_id" | "status">;
  /** A revisão que quem pediu o fechamento viu. */
  revisaoEsperada: number;
  requestId: string;
  ator: AtorDoFechamento;
  auditarSemMudanca?: boolean;
}): Promise<DesfechoDoFechamento> {
  const { conversa } = deps;
  const { data, error } = await deps.admin.rpc("fn_service_status", {
    p_org: conversa.organization_id,
    p_conversation: conversa.id,
    p_status: "closed",
    p_expected: deps.revisaoEsperada,
  });
  if (error) {
    // PT409: revisão obsoleta (migration 0514). 40001: contato trocou no meio, ou banco anterior à 0514.
    const conflito = error.code === "PT409" || error.code === "40001";
    return { ok: false, erro: conflito ? "conflito" : "falha", detalhe: error.message };
  }

  const mudou = conversa.status !== "closed";
  if (mudou || deps.auditarSemMudanca) {
    await audit({
      action: "conversation.closed",
      actorUserId: deps.ator.actorUserId,
      ...(deps.ator.actorApiTokenId ? { actorApiTokenId: deps.ator.actorApiTokenId } : {}),
      organizationId: conversa.organization_id,
      resourceType: "conversation",
      resourceId: conversa.id,
      requestId: deps.requestId,
      ...(deps.ator.metadata ? { metadata: deps.ator.metadata } : {}),
    });
  }

  return { ok: true, conversa: data as unknown as Conversation, mudou };
}
