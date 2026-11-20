/**
 * Comentários do Instagram — receber, guardar e avisar.
 *
 * O webhook da conexão direta (`./webhook.ts`) lê o comentário; aqui ele vira
 * linha em `social_comments` (migration 9810) e evento `comment.received` no
 * `event_log`. Quem decide o que responder é um agente EXTERNO, pela API: o CRM
 * não responde sozinho e não cria contato nem negócio a partir do comentário.
 *
 * ─── O modo do canal ────────────────────────────────────────────────────────
 *
 * Cada conexão do Instagram tem um modo, guardado em `metadata.comentarios_modo`
 * (mesmo desenho do acesso da IA por canal):
 *
 *   off        o padrão. O comentário é descartado: 200 para a Meta, nada gravado.
 *   registrar  grava e avisa. As chamadas de resposta validam tudo e gravam a
 *              resposta como simulada, sem publicar.
 *   real       grava, avisa e as respostas são publicadas de verdade.
 *
 * Canal novo nasce `off`, e reautorizar a conexão não muda o modo: quem muda é
 * uma pessoa, e a mudança é auditada (`definirModoDeComentarios`, em `./store.ts`).
 * Valor ausente ou desconhecido no metadata é `off` — na dúvida, não grava.
 *
 * ─── A ordem das recusas ────────────────────────────────────────────────────
 *
 *   1. modo `off`                   → `comentarios_desligados`
 *   2. escrito pela própria conta   → `comentario_proprio`. As respostas que o
 *      CRM publica voltam como comentário da conta; sem esta recusa o agente
 *      responderia a si mesmo, em laço.
 *   3. já recebido                  → `comentario_repetido`. A Meta reentrega o
 *      que não recebe 2xx e, em anúncio, pode notificar o mesmo comentário mais
 *      de uma vez. Quem decide é a chave única `(organization_id, comment_id)`
 *      do banco (23505), não uma consulta antes: consultar e depois gravar são
 *      dois passos, e entre eles cabe a segunda entrega.
 *
 * ─── De quem é o comentário ─────────────────────────────────────────────────
 *
 * A organização e o canal vêm da SESSÃO que quem chama achou pela conta do
 * evento (`entry.id`). Nada aqui lê organização do corpo.
 *
 * ─── O aviso ────────────────────────────────────────────────────────────────
 *
 * `comment.received` sai pelo mesmo caminho dos outros gatilhos: `emit_event`
 * grava no `event_log`, o motor de automações o consome e a ação "Avisar outro
 * sistema (webhook)" o entrega. O payload leva o texto INTEIRO.
 *
 * O aviso é melhor esforço e nunca lança: o comentário JÁ está gravado, e
 * devolver erro faria a Meta reentregar um comentário que a chave única
 * recusaria como repetido — sem avisar de novo. A falha vai para o log.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import type { SessaoDireta } from "./store";
import type { EventoDireto } from "./webhook";

/** Os modos do canal. O primeiro é o padrão. */
export const MODOS_DE_COMENTARIOS = ["off", "registrar", "real"] as const;
export type ModoDeComentarios = (typeof MODOS_DE_COMENTARIOS)[number];

/** A chave do modo em `channel_sessions.metadata`. */
export const CHAVE_DO_MODO_DE_COMENTARIOS = "comentarios_modo";

/** O mesmo vocabulário do CHECK de `social_comments.estado` (migration 9810). */
export const ESTADOS_DO_COMENTARIO = ["novo", "ignorado", "respondido", "sem_acao"] as const;
export type EstadoDoComentario = (typeof ESTADOS_DO_COMENTARIO)[number];

/**
 * A entidade que o evento `comment.received` carrega — a mesma que
 * `ENTIDADE_ESPERADA_POR_GATILHO` (`lib/schemas/webhooks.ts`) declara. Sem as
 * duas iguais, o motor descarta o evento como `entity_kind_mismatch`.
 */
export const ENTIDADE_DO_COMENTARIO = "social_comment";

export type ComentarioLido = Extract<EventoDireto, { tipo: "comentario" }>;

export type DesfechoDoComentario =
  | "comentarios_desligados"
  | "comentario_proprio"
  | "comentario_repetido"
  | "comentario_registrado";

/** O modo gravado no canal. Ausente ou desconhecido é `off`. */
export function lerModoDeComentarios(metadata: Record<string, unknown> | null | undefined): ModoDeComentarios {
  const valor = metadata?.[CHAVE_DO_MODO_DE_COMENTARIOS];
  return (MODOS_DE_COMENTARIOS as readonly unknown[]).includes(valor) ? (valor as ModoDeComentarios) : "off";
}

/** O que os sistemas de fora recebem em `comment.received`. */
export interface AvisoDeComentario {
  /** O id do comentário na rede — é com ele que se responde. */
  comment_id: string;
  /** O id da linha em `social_comments`. */
  social_comment_id: string;
  parent_comment_id: string | null;
  media_id: string | null;
  media_product_type: string | null;
  ad_id: string | null;
  ad_title: string | null;
  ao_vivo: boolean;
  author: { id: string | null; username: string | null };
  /** O texto inteiro, sem corte. */
  text: string | null;
  commented_at: string;
  channel_session_id: string;
  canal: { id: string; rede: string; conta: string; nome: string | null };
  modo: ModoDeComentarios;
}

/** Monta o aviso. Pura, para o teste conferir o payload sem banco. */
export function avisoDoComentario(
  sessao: Pick<SessaoDireta, "id" | "rede" | "conta" | "displayName">,
  evento: ComentarioLido,
  linhaId: string,
  modo: ModoDeComentarios,
): AvisoDeComentario {
  return {
    comment_id: evento.commentId,
    social_comment_id: linhaId,
    parent_comment_id: evento.parentId,
    media_id: evento.mediaId,
    media_product_type: evento.mediaProductType,
    ad_id: evento.adId,
    ad_title: evento.adTitle,
    ao_vivo: evento.aoVivo,
    author: { id: evento.autorId, username: evento.autorUsuario },
    text: evento.texto,
    commented_at: evento.quando,
    channel_session_id: sessao.id,
    canal: { id: sessao.id, rede: sessao.rede, conta: sessao.conta, nome: sessao.displayName },
    modo,
  };
}

async function avisar(db: SupabaseClient, organizationId: string, aviso: AvisoDeComentario): Promise<void> {
  try {
    const { error } = await db.rpc("emit_event", {
      p_event_type: "comment.received",
      p_entity_kind: ENTIDADE_DO_COMENTARIO,
      p_entity_id: aviso.social_comment_id,
      p_payload: { ...aviso },
      p_metadata: { source: "webhook_da_conexao_direta" },
      p_organization_id: organizationId,
    });
    if (error) {
      logger.warn("[comentarios] o comentário foi gravado, mas o aviso não saiu", {
        organization_id: organizationId,
        social_comment_id: aviso.social_comment_id,
        erro: error.message,
      });
    }
  } catch (erro) {
    logger.warn("[comentarios] o comentário foi gravado, mas o aviso não saiu", {
      organization_id: organizationId,
      social_comment_id: aviso.social_comment_id,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
  }
}

/**
 * Recebe UM comentário da sessão dada. Lança só quando o banco recusa a
 * gravação por motivo que não seja a chave única — quem chama registra o
 * evento como falho, sem derrubar os outros do lote.
 */
export async function registrarComentario(
  db: SupabaseClient,
  sessao: SessaoDireta,
  evento: ComentarioLido,
): Promise<DesfechoDoComentario> {
  const modo = lerModoDeComentarios(sessao.metadata);
  if (modo === "off") return "comentarios_desligados";
  if (evento.proprio) return "comentario_proprio";

  const { data, error } = await db
    .from("social_comments")
    .insert({
      organization_id: sessao.organizationId,
      channel_session_id: sessao.id,
      comment_id: evento.commentId,
      parent_comment_id: evento.parentId,
      media_id: evento.mediaId,
      media_product_type: evento.mediaProductType,
      ad_id: evento.adId,
      ad_title: evento.adTitle,
      ao_vivo: evento.aoVivo,
      author_id: evento.autorId,
      author_username: evento.autorUsuario,
      text: evento.texto,
      commented_at: evento.quando,
      estado: "novo" satisfies EstadoDoComentario,
    })
    .select("id")
    .single();
  if (error?.code === "23505") return "comentario_repetido";
  if (error || !data) throw new Error(`social_comments: ${error?.message ?? "a linha não voltou"}`);

  await avisar(db, sessao.organizationId, avisoDoComentario(sessao, evento, (data as { id: string }).id, modo));
  return "comentario_registrado";
}
