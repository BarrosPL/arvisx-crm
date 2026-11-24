/**
 * FECHAR UMA CONVERSA — a regra, num lugar só.
 *
 * Quatro caminhos fecham conversa e os quatro passam por aqui:
 *
 *  - a tela, por `POST /api/v1/conversations/[id]/close` (sessão de usuário);
 *  - o agente, pela ferramenta `crm_close_conversation` (token de API ou turno);
 *  - a API versionada, por `PATCH /api/v1/conversations/[id]` com
 *    `status: "closed"` (`patchConversationHandler`);
 *  - o marcar contato como pessoal (`POST /api/v1/contacts/[id]/personal`), que
 *    solta e fecha cada conversa aberta do contato.
 *
 * O que é de cada porta fica na porta: quem pode fechar (papel e controle da
 * conversa, nas rotas; escopo do token e contato do turno, na ferramenta), a
 * escolha de devolver o contato ao automático, que só a tela oferece, e a
 * leitura própria de cada rota (o `PATCH` lê a conversa inteira e responde 404
 * para contato pessoal; o marcar como pessoal lê de uma vez todas as conversas
 * abertas do contato). O que é da REGRA mora aqui:
 *
 *  1. a conversa é lida com o filtro de organização, sempre — o cliente pode
 *     ser service role, e sem o filtro a RLS não segura;
 *  2. o estado de atendimento só muda pela `fn_service_status`, com a revisão
 *     lida como trava otimista. Revisão obsoleta é CONFLITO, nunca fechamento
 *     por cima de estado alheio. A única exceção tem nome
 *     (`SEM_TRAVA_DE_REVISAO`) e um só caminho a escolhe: o marcar como pessoal;
 *  3. o fechamento entra na auditoria como `conversation.closed`, com quem
 *     fechou (pessoa ou token), escrita por `auditarFechamentoDeConversa`.
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
  | {
      ok: false;
      erro: "conflito" | "falha";
      detalhe: string;
      /**
       * O código que o banco devolveu (`P0002` = a conversa não existe nesta
       * organização). Quem responde por HTTP decide o status com ele; `null`
       * quando o erro veio sem código.
       */
      codigo: string | null;
    };

/**
 * FECHAR SEM TRAVA DE REVISÃO — a exceção à regra 2, com nome para aparecer em
 * qualquer busca.
 *
 * Só o marcar contato como pessoal a escolhe: ele fecha TODAS as conversas abertas
 * do contato por decisão de gerente, logo depois de soltar cada uma do
 * atendente (o que já mexe no atendimento), e nunca teve trava — quem marca
 * não está olhando a conversa, e uma revisão "vista" ali não existe. Quem fecha
 * a pedido de alguém que VIU a conversa (tela, API, agente) manda a revisão.
 * (O `PATCH` de status a cita como último termo de um `??`, só para o caso de
 * a leitura vir sem `service_revision` — que o `select` dele não deixa
 * acontecer; é o que a chamada direta fazia ali.)
 */
export const SEM_TRAVA_DE_REVISAO = "sem_trava_de_revisao" as const;

/**
 * A linha de auditoria do fechamento: `conversation.closed`, uma só forma para
 * todos os caminhos.
 *
 * Exportada para quem fecha com `auditoria: "adiada"` — rota que só pode
 * auditar depois de terminar o que ainda faz na mesma requisição.
 */
export async function auditarFechamentoDeConversa(entrada: {
  conversa: Pick<ConversaParaFechar, "id" | "organization_id">;
  requestId: string;
  ator: AtorDoFechamento;
}): Promise<void> {
  await audit({
    action: "conversation.closed",
    actorUserId: entrada.ator.actorUserId,
    ...(entrada.ator.actorApiTokenId ? { actorApiTokenId: entrada.ator.actorApiTokenId } : {}),
    organizationId: entrada.conversa.organization_id,
    resourceType: "conversation",
    resourceId: entrada.conversa.id,
    requestId: entrada.requestId,
    ...(entrada.ator.metadata ? { metadata: entrada.ator.metadata } : {}),
  });
}

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
 *
 * `auditoria: "adiada"` não escreve a linha aqui: quem chama a escreve com
 * `auditarFechamentoDeConversa`, no ponto em que sempre a escreveu. É o que
 * mantém o `PATCH` auditando só depois de reler a conversa (e gravar os
 * marcadores, quando vêm juntos) e o marcar como pessoal auditando o soltar
 * antes do fechar. Adiar NÃO é dispensar: os dois auditam todo fechamento.
 */
export async function fecharConversa(deps: {
  /** Service role: a `fn_service_status` só é executável por ele. */
  admin: Pick<SupabaseClient, "rpc">;
  conversa: Pick<ConversaParaFechar, "id" | "organization_id" | "status">;
  /** A revisão que quem pediu o fechamento viu, ou a exceção nomeada. */
  revisaoEsperada: number | typeof SEM_TRAVA_DE_REVISAO;
  requestId: string;
  ator: AtorDoFechamento;
  auditarSemMudanca?: boolean;
  /** `"adiada"`: quem chama audita depois, com `auditarFechamentoDeConversa`. */
  auditoria?: "na_hora" | "adiada";
}): Promise<DesfechoDoFechamento> {
  const { conversa } = deps;
  const { data, error } = await deps.admin.rpc("fn_service_status", {
    p_org: conversa.organization_id,
    p_conversation: conversa.id,
    p_status: "closed",
    // Sem trava, o parâmetro nem viaja: o default da função (`null`) é "não conferir".
    ...(deps.revisaoEsperada === SEM_TRAVA_DE_REVISAO ? {} : { p_expected: deps.revisaoEsperada }),
  });
  if (error) {
    // PT409: revisão obsoleta (migration 0514). 40001: contato trocou no meio, ou banco anterior à 0514.
    const conflito = error.code === "PT409" || error.code === "40001";
    return {
      ok: false,
      erro: conflito ? "conflito" : "falha",
      detalhe: error.message,
      codigo: error.code ?? null,
    };
  }

  const mudou = conversa.status !== "closed";
  if (deps.auditoria !== "adiada" && (mudou || deps.auditarSemMudanca)) {
    await auditarFechamentoDeConversa({ conversa, requestId: deps.requestId, ator: deps.ator });
  }

  return { ok: true, conversa: data as unknown as Conversation, mudou };
}
