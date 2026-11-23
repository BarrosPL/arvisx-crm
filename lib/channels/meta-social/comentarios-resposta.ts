/**
 * Comentários do Instagram — o TRANSPORTE das respostas.
 *
 * Três chamadas à Graph (responder em público, responder em privado, ocultar)
 * e a gravação da resposta privada na conversa do contato. A regra de negócio
 * — uma resposta por comentário, 7 dias, modo do canal, auditoria — mora em
 * `lib/comentarios/acoes.ts`, que é quem chama aqui. Este arquivo só sabe falar
 * com a rede e dizer, sem ambiguidade, o que aconteceu.
 *
 * ─── O que a Meta documenta (lido em 20/11/2026) ────────────────────────────
 *
 *   público   POST /{ig-comment-id}/replies  { message }              → { id }
 *   privado   POST /{ig-id}/messages  { recipient: { comment_id }, message: { text } }
 *                                                  → { recipient_id, message_id }
 *   ocultar   POST /{ig-comment-id}  { hide: true }                   → { success }
 *
 * As três com o token da página (login do Facebook). As fontes e o que NÃO foi
 * confirmado estão em `docs/integracao/comentarios-do-instagram.md`.
 *
 * ─── O desfecho tem três formas, e a terceira é a que importa ───────────────
 *
 *   recusada  a Meta respondeu "não" (recusa definitiva, 4xx): nada saiu, e
 *             repetir igual não adianta — quem chamou corrige a causa. Leva o
 *             código da Meta, para quem chama separar isto de indisponibilidade;
 *   sem_credencial  o token não existe mais aqui, OU a Meta disse que ele
 *             expirou ou foi revogado (190/102): só reconectar resolve;
 *   limite    a Meta limitou as chamadas: nada saiu. Aqui (e só aqui) há recuo
 *             e nova tentativa automática, porque repetir é seguro;
 *   incerta   a resposta não chegou, ou veio um erro de servidor: a publicação
 *             PODE ter saído. Nunca é repetida sozinha.
 *
 * ─── A identidade de quem comentou ──────────────────────────────────────────
 *
 * A resposta privada devolve `recipient_id`, que a Meta documenta como o id com
 * escopo do Instagram de quem recebeu — o MESMO que identifica a pessoa nas
 * mensagens diretas. É essa a prova que liga o comentário ao contato: a
 * identidade social é montada com ELE, nunca com o `from.id` do comentário.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { appDaMeta } from "../meta/app";
import { socialMessageId } from "../social/catalog";
import type { SocialMessage } from "../social/parser";
import { ingestZernioInbound } from "../zernio/ingest";
import { ErroDaGraph, chamarGraph } from "./graph";
import { identidadeSocial } from "./ingest";
import { tokenDaSessao, type SessaoDireta } from "./store";

export type FalhaDoEnvio =
  | {
      tipo: "recusada";
      frase: string;
      escopoAusente: boolean;
      /** O código (e o subcódigo) com que a Meta recusou. `null` quando a recusa é nossa (id inválido). */
      codigo: number | null;
      subcodigo: number | null;
    }
  | { tipo: "limite"; frase: string }
  | { tipo: "incerta"; frase: string }
  | { tipo: "sem_credencial"; frase: string };

export type Desfecho<T> = ({ ok: true } & T) | { ok: false; falha: FalhaDoEnvio };

/** Os ids da rede são números. Vão no CAMINHO da chamada, então são conferidos. */
const ID_DA_REDE = /^[0-9]{1,40}$/;

/** As esperas do recuo quando a Meta limita as chamadas. Duas tentativas a mais. */
export const ESPERAS_DO_RECUO_MS: readonly number[] = [1_500, 4_000];

/** Trocável no teste, para o recuo não custar segundos de relógio. */
export const relogio = {
  esperar: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

const FRASE_SEM_CREDENCIAL =
  "Esta conta está sem autorização da Meta. Reconecte em Conexões › Facebook / Instagram.";
const FRASE_INCERTA =
  "A Meta não confirmou a operação. Ela pode ter sido feita: confira na rede antes de tentar de novo.";

function falhaDe(erro: unknown): FalhaDoEnvio {
  if (!(erro instanceof ErroDaGraph)) throw erro;
  if (erro.limiteDeTaxa) return { tipo: "limite", frase: erro.message };
  if (erro.desfechoIncerto) return { tipo: "incerta", frase: FRASE_INCERTA };
  // Token expirado ou revogado NA META: é a mesma situação de não ter token
  // aqui — a conexão precisa ser refeita, e não é a rede que está fora.
  if (erro.tokenInvalido) return { tipo: "sem_credencial", frase: erro.message };
  return {
    tipo: "recusada",
    frase: erro.message,
    escopoAusente: erro.escopoDeComentariosAusente,
    codigo: erro.detalhe.code,
    subcodigo: erro.detalhe.subcode,
  };
}

/**
 * Chama a Graph e, quando ela limita as chamadas, espera e tenta de novo.
 *
 * Só o limite é repetido: é a única recusa em que a Meta garante que nada foi
 * feito E em que insistir resolve. Recusa definitiva volta na hora; desfecho
 * incerto volta na hora e NÃO é repetido.
 */
async function chamarComRecuo<T>(chamada: () => Promise<T>): Promise<Desfecho<{ corpo: T }>> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      return { ok: true, corpo: await chamada() };
    } catch (erro) {
      const falha = falhaDe(erro);
      const espera = ESPERAS_DO_RECUO_MS[tentativa];
      if (falha.tipo !== "limite" || espera === undefined) return { ok: false, falha };
      await relogio.esperar(espera);
    }
  }
}

async function credencial(db: SupabaseClient, sessao: SessaoDireta) {
  const cred = await tokenDaSessao(db, sessao.organizationId, sessao.conta);
  if (!cred) return null;
  const { appSecret } = await appDaMeta();
  return { token: cred.token, appSecret };
}

const SEM_CREDENCIAL = { ok: false, falha: { tipo: "sem_credencial", frase: FRASE_SEM_CREDENCIAL } } as const;
const ID_INVALIDO = {
  ok: false,
  falha: {
    tipo: "recusada",
    frase: "O identificador deste comentário não é válido na rede.",
    escopoAusente: false,
    codigo: null,
    subcodigo: null,
  },
} as const;

/** Publica a resposta PÚBLICA a um comentário. Devolve o id da resposta na rede. */
export async function publicarRespostaPublica(
  db: SupabaseClient,
  sessao: SessaoDireta,
  commentId: string,
  texto: string,
): Promise<Desfecho<{ id: string }>> {
  if (!ID_DA_REDE.test(commentId)) return ID_INVALIDO;
  const cred = await credencial(db, sessao);
  if (!cred) return SEM_CREDENCIAL;
  const r = await chamarComRecuo(() =>
    chamarGraph<{ id?: unknown }>(`${commentId}/replies`, { ...cred, corpo: { message: texto } }),
  );
  if (!r.ok) return r;
  // 200 sem id: a Meta aceitou e não disse o que criou. Não dá para afirmar
  // que não publicou — é o desfecho incerto, não uma recusa.
  if (typeof r.corpo.id !== "string" || !r.corpo.id) {
    return { ok: false, falha: { tipo: "incerta", frase: FRASE_INCERTA } };
  }
  return { ok: true, id: r.corpo.id };
}

/**
 * Envia a resposta PRIVADA a quem comentou. Devolve o id da mensagem e, quando
 * a Meta o informa, o id de quem recebeu (a prova da identidade nas mensagens).
 */
export async function enviarRespostaPrivada(
  db: SupabaseClient,
  sessao: SessaoDireta,
  commentId: string,
  texto: string,
): Promise<Desfecho<{ messageId: string; recipientId: string | null }>> {
  if (!ID_DA_REDE.test(commentId)) return ID_INVALIDO;
  const cred = await credencial(db, sessao);
  if (!cred) return SEM_CREDENCIAL;
  const r = await chamarComRecuo(() =>
    chamarGraph<{ message_id?: unknown; recipient_id?: unknown }>(`${sessao.conta}/messages`, {
      ...cred,
      corpo: { recipient: { comment_id: commentId }, message: { text: texto } },
    }),
  );
  if (!r.ok) return r;
  if (typeof r.corpo.message_id !== "string" || !r.corpo.message_id) {
    return { ok: false, falha: { tipo: "incerta", frase: FRASE_INCERTA } };
  }
  const recipientId =
    typeof r.corpo.recipient_id === "string" && ID_DA_REDE.test(r.corpo.recipient_id) ? r.corpo.recipient_id : null;
  return { ok: true, messageId: r.corpo.message_id, recipientId };
}

/** Oculta o comentário na rede. Ocultar o que já está oculto não é erro. */
export async function ocultarNaRede(
  db: SupabaseClient,
  sessao: SessaoDireta,
  commentId: string,
): Promise<Desfecho<object>> {
  if (!ID_DA_REDE.test(commentId)) return ID_INVALIDO;
  const cred = await credencial(db, sessao);
  if (!cred) return SEM_CREDENCIAL;
  const r = await chamarComRecuo(() =>
    chamarGraph<{ success?: unknown }>(commentId, { ...cred, corpo: { hide: true } }),
  );
  if (!r.ok) return r;
  // 200 sem `success`: a Meta não recusou e não confirmou. Não é recusa
  // definitiva — é não saber. Ocultar é idempotente, então repetir é seguro.
  if (r.corpo.success !== true) {
    return { ok: false, falha: { tipo: "incerta", frase: "A Meta não confirmou que o comentário foi ocultado." } };
  }
  return { ok: true };
}

/** A identidade social que o `from.id` do comentário TERIA, se for o mesmo id das mensagens. */
export function identidadeCandidataDoAutor(sessao: Pick<SessaoDireta, "rede" | "conta">, autorId: string): string {
  return identidadeSocial(sessao.rede, sessao.conta, autorId);
}

export interface RespostaPrivadaNaConversa {
  /** O id que a Meta devolveu em `recipient_id`. */
  recipientId: string;
  /** O id da mensagem na rede (`message_id`). */
  messageId: string;
  texto: string;
  quando: string;
  /** O nome de usuário de quem comentou, para o contato novo não nascer sem nome. */
  usuario: string | null;
  /** O contato já ligado ao comentário (criado a pedido), quando houver. */
  contatoDoComentario: string | null;
  /** Pode criar contato e conversa quando a pessoa ainda não tem? */
  criarContato: boolean;
  /** O que vai no metadata da mensagem, para a conversa dizer de onde ela veio. */
  origem: { social_comment_id: string; comment_id: string };
}

export interface ConversaDaResposta {
  contactId: string;
  conversationId: string;
  /** O id da linha em `messages`. `null` quando a mensagem já estava lá (o eco chegou antes). */
  messageId: string | null;
}

async function contatoVivoPelaIdentidade(db: SupabaseClient, org: string, identidade: string): Promise<string | null> {
  const { data, error } = await db
    .from("contacts")
    .select("id")
    .eq("organization_id", org)
    .eq("social_identity", identidade)
    .is("is_merged_into", null)
    .maybeSingle();
  if (error) throw new Error(`social_contact_lookup_failed: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Grava a resposta privada JÁ ENVIADA na conversa do contato, pelo MESMO
 * caminho de ingestão das mensagens diretas — então quando a pessoa responder,
 * a mensagem dela cai na mesma conversa, com janela de 24 h, pausa da IA e o
 * resto do fluxo normal.
 *
 * Quem é o contato:
 *   1. o que já tem esta identidade (a pessoa já escreveu por mensagem direta);
 *   2. senão, o contato criado a pedido a partir do comentário, que GANHA a
 *      identidade agora — a Meta acabou de prová-la;
 *   3. senão, um contato novo, só quando `criarContato`.
 * Sem contato e sem `criarContato`, devolve `null`: a resposta saiu e fica
 * registrada só no comentário.
 *
 * A mensagem entra como saída feita por fora da caixa de entrada: é o que faz
 * o eco que a Meta devolve ser reconhecido como repetido (mesmo `external_id`)
 * e o que pausa o atendimento automático na conversa — quem respondeu ao
 * comentário é quem está cuidando dela.
 */
export async function gravarRespostaPrivadaNaConversa(
  db: SupabaseClient,
  sessao: SessaoDireta,
  resposta: RespostaPrivadaNaConversa,
): Promise<ConversaDaResposta | null> {
  const org = sessao.organizationId;
  const identidade = identidadeSocial(sessao.rede, sessao.conta, resposta.recipientId);

  let contato = await contatoVivoPelaIdentidade(db, org, identidade);
  if (!contato && resposta.contatoDoComentario) {
    // O `is null` é a guarda: contato que já tem OUTRA identidade não é
    // reescrito. 23505 = outro contato ganhou esta identidade no intervalo.
    const { data, error } = await db
      .from("contacts")
      .update({ social_identity: identidade })
      .eq("organization_id", org)
      .eq("id", resposta.contatoDoComentario)
      .is("social_identity", null)
      .is("is_merged_into", null)
      .eq("is_anonymized", false)
      .select("id");
    if (error && error.code !== "23505") throw new Error(`social_contact_link_failed: ${error.message}`);
    if (((data as { id: string }[] | null) ?? []).length > 0) contato = resposta.contatoDoComentario;
    else contato = await contatoVivoPelaIdentidade(db, org, identidade);
  }
  if (!contato && !resposta.criarContato) return null;

  const mensagem = {
    platform: sessao.rede,
    participantId: resposta.recipientId,
    accountId: sessao.conta,
    conversationId: resposta.recipientId,
    externalId: socialMessageId(sessao.conta, resposta.messageId),
    direction: "outbound",
    kind: "message",
    status: "sent",
    text: resposta.texto,
    sentAt: resposta.quando,
    attachments: [],
    referral: null,
    identity: {
      phone: null,
      bsuid: null,
      anchor: null,
      username: resposta.usuario,
      displayName: resposta.usuario ? `@${resposta.usuario}` : null,
    },
  } as unknown as SocialMessage;

  const r = await ingestZernioInbound(db, {
    organizationId: org,
    channelSessionId: sessao.id,
    payload: { origem: "resposta_privada_de_comentario", ...resposta.origem },
    socialMessage: mensagem,
  });
  if (!r.conversationId) {
    logger.warn("[comentarios] a resposta privada saiu, mas a conversa não foi gravada", {
      organization_id: org,
      channel_session_id: sessao.id,
      motivo: r.reason ?? r.status,
    });
    return null;
  }

  const { data: conversa } = await db
    .from("conversations")
    .select("contact_id")
    .eq("organization_id", org)
    .eq("id", r.conversationId)
    .maybeSingle();
  const contactId = (conversa as { contact_id: string } | null)?.contact_id ?? contato;
  if (!contactId) return null;

  const messageId = r.status === "ingested" ? (r.messageId ?? null) : null;
  if (messageId) {
    // De onde veio a mensagem. Melhor esforço: é rótulo, a mensagem já está lá.
    const { error } = await db
      .from("messages")
      .update({ metadata: { origem: "resposta_privada_de_comentario", ...resposta.origem } })
      .eq("organization_id", org)
      .eq("id", messageId);
    if (error) {
      logger.warn("[comentarios] a origem da resposta privada não foi anotada na mensagem", {
        organization_id: org,
        erro: error.message,
      });
    }
  }
  return { contactId, conversationId: r.conversationId, messageId };
}
