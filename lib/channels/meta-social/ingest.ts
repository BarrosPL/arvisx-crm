/**
 * Entrada da conexão direta: evento lido (`./webhook.ts`) → sessão → o MESMO
 * caminho de ingestão das redes sociais.
 *
 * Não existe uma segunda ingestão: o evento vira o `SocialMessage` que a porta
 * por parceiro já produz, e `ingestZernioInbound` faz o resto — contato pela
 * identidade social (`<rede>:<conta>:<participante>`), conversa com a thread
 * (o PSID/IGSID é o endereço da resposta), mensagem com idempotência
 * `(organization_id, external_id)` + 23505, carimbo da janela de 24 h, pedido de
 * persistência da mídia (`media.persist_requested` no `event_log`), opt-out,
 * nascimento do lead e despacho do agente. Foi a cópia privada de um ingest que
 * já deixou um canal sem esses efeitos; reusar é a regra.
 *
 * ─── De quem é o evento ─────────────────────────────────────────────────────
 *
 * A organização sai da SESSÃO achada pela conta (`entry.id`), nunca do corpo. A
 * conta só existe numa sessão ativa (índice único, migration 9800), então um
 * evento não tem como cair em duas organizações. Conta sem sessão é ignorada
 * (200 para a Meta não reentregar), com o motivo no desfecho.
 *
 * ─── O eco do próprio envio ─────────────────────────────────────────────────
 *
 * A Meta devolve como eco (`is_echo`) TUDO o que sai da conta — inclusive o que
 * o CRM acabou de mandar. Quando o eco diz que veio do NOSSO app (`app_id`), ele
 * é ignorado: a linha já existe, gravada pelo envio. Sem o `app_id` (o Instagram
 * nem sempre o manda), o eco entra e a chave `(organization_id, external_id)`
 * resolve — o id do eco é o mesmo `mid` que o envio gravou. Eco de OUTRO app ou
 * do celular entra como saída de humano e pausa a IA, como no canal por parceiro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { socialMessageId } from "../social/catalog";
import type { SocialMessage } from "../social/parser";
import { ingestZernioInbound } from "../zernio/ingest";
import { perfilDoParticipante } from "./perfil";
import { sessaoPelaConta, tokenDaSessao, type SessaoDireta } from "./store";
import type { EventoDireto } from "./webhook";

export interface ContextoDaEntrada {
  /** App ID da instalação — reconhece o eco do próprio envio. */
  appId: string | null;
  appSecret: string;
}

function identidadeSocial(rede: string, conta: string, participante: string): string {
  return `${rede}:${conta}:${participante}`;
}

async function contatoJaExiste(db: SupabaseClient, org: string, identidade: string): Promise<boolean> {
  const { data } = await db
    .from("contacts")
    .select("id")
    .eq("organization_id", org)
    .eq("social_identity", identidade)
    .is("is_merged_into", null)
    .maybeSingle();
  return Boolean(data);
}

/** O nome de quem escreve, só na PRIMEIRA mensagem (contato novo). Nunca lança. */
async function nomeDoContatoNovo(
  db: SupabaseClient,
  sessao: SessaoDireta,
  participante: string,
  appSecret: string,
): Promise<{ nome: string | null; usuario: string | null }> {
  try {
    if (await contatoJaExiste(db, sessao.organizationId, identidadeSocial(sessao.rede, sessao.conta, participante))) {
      return { nome: null, usuario: null };
    }
    const cred = await tokenDaSessao(db, sessao.organizationId, sessao.conta);
    if (!cred) return { nome: null, usuario: null };
    const perfil = await perfilDoParticipante({ rede: sessao.rede, participante, token: cred.token, appSecret });
    return { nome: perfil?.nome ?? null, usuario: perfil?.usuario ?? null };
  } catch {
    return { nome: null, usuario: null };
  }
}

/** Evento → o `SocialMessage` que a ingestão social já entende. Pura. */
export function paraMensagemSocial(
  evento: Extract<EventoDireto, { tipo: "mensagem" }>,
  perfil: { nome: string | null; usuario: string | null },
): SocialMessage {
  return {
    platform: evento.rede,
    participantId: evento.participante,
    accountId: evento.conta,
    conversationId: evento.participante,
    externalId: socialMessageId(evento.conta, evento.mid),
    direction: evento.eco ? "outbound" : "inbound",
    kind: "message",
    status: evento.eco ? "sent" : undefined,
    text: evento.texto,
    sentAt: evento.quando,
    attachments: evento.anexos.map((a) => ({ type: a.type === "file" ? "document" : a.type, url: a.url })),
    referral: null,
    identity: {
      phone: null,
      bsuid: null,
      anchor: null,
      username: perfil.usuario,
      displayName: perfil.nome,
    },
  } as SocialMessage;
}

function statusSocial(
  evento: EventoDireto,
  mid: string,
  status: "delivered" | "read",
): SocialMessage {
  return {
    platform: evento.rede,
    participantId: evento.participante,
    accountId: evento.conta,
    conversationId: evento.participante,
    externalId: socialMessageId(evento.conta, mid),
    direction: "outbound",
    kind: "status",
    status,
    statusAt: evento.quando,
    text: null,
    sentAt: null,
    attachments: [],
    referral: null,
    identity: { phone: null, bsuid: null, anchor: null, username: null, displayName: null },
  } as SocialMessage;
}

/**
 * Leitura do Messenger por `watermark`: "leu tudo até tal hora". Marca como lidas
 * as saídas desta conversa enviadas até lá. Best-effort — é tique, não dado.
 */
async function marcarLidasAte(db: SupabaseClient, sessao: SessaoDireta, participante: string, ate: string) {
  const { data: conversa } = await db
    .from("conversations")
    .select("id")
    .eq("organization_id", sessao.organizationId)
    .eq("channel_session_id", sessao.id)
    .eq("provider_conversation_id", participante)
    .maybeSingle();
  const conversationId = (conversa as { id?: string } | null)?.id;
  if (!conversationId) return "sem_conversa";
  const { error } = await db
    .from("messages")
    .update({ status: "read", read_at: ate })
    .eq("organization_id", sessao.organizationId)
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .in("status", ["sent", "delivered"])
    .lte("created_at", ate);
  return error ? "falhou" : "lidas";
}

/**
 * Processa os eventos de UMA entrega. Devolve um desfecho por evento — vai no
 * corpo da resposta, para quem depura ver o que aconteceu com cada um.
 */
export async function processarEventosDiretos(
  db: SupabaseClient,
  eventos: readonly EventoDireto[],
  ctx: ContextoDaEntrada,
): Promise<string[]> {
  const sessoes = new Map<string, SessaoDireta | null>();
  const desfechos: string[] = [];
  for (const evento of eventos) {
    if (!sessoes.has(evento.conta)) sessoes.set(evento.conta, await sessaoPelaConta(db, evento.conta));
    const sessao = sessoes.get(evento.conta) ?? null;
    if (!sessao) {
      desfechos.push("conta_desconhecida");
      continue;
    }
    // A rede do evento tem de ser a da sessão: o id de uma página e o de uma
    // conta do Instagram nunca colidem, mas conferir custa nada e fecha a porta.
    if (sessao.rede !== evento.rede) {
      desfechos.push("rede_diferente_da_sessao");
      continue;
    }
    try {
      if (evento.tipo === "mensagem") {
        if (evento.eco && ctx.appId && evento.appId === ctx.appId) {
          desfechos.push("eco_do_proprio_envio");
          continue;
        }
        const perfil = evento.eco
          ? { nome: null, usuario: null }
          : await nomeDoContatoNovo(db, sessao, evento.participante, ctx.appSecret);
        const r = await ingestZernioInbound(db, {
          organizationId: sessao.organizationId,
          channelSessionId: sessao.id,
          payload: evento,
          socialMessage: paraMensagemSocial(evento, perfil),
        });
        desfechos.push(r.status === "ignored" ? `ignorado:${r.reason ?? ""}` : r.status);
        continue;
      }
      if (evento.tipo === "entrega") {
        for (const mid of evento.mids) {
          await ingestZernioInbound(db, {
            organizationId: sessao.organizationId,
            channelSessionId: sessao.id,
            payload: evento,
            socialMessage: statusSocial(evento, mid, "delivered"),
          });
        }
        desfechos.push("entrega");
        continue;
      }
      if (evento.mid) {
        await ingestZernioInbound(db, {
          organizationId: sessao.organizationId,
          channelSessionId: sessao.id,
          payload: evento,
          socialMessage: statusSocial(evento, evento.mid, "read"),
        });
        desfechos.push("leitura");
      } else if (evento.ate) {
        desfechos.push(`leitura:${await marcarLidasAte(db, sessao, evento.participante, evento.ate)}`);
      } else {
        desfechos.push("leitura_sem_alvo");
      }
    } catch (erro) {
      // Um evento ruim não derruba os outros do lote. 500 faria a Meta
      // reentregar TODOS — inclusive os que já entraram.
      logger.error("[meta-social] evento não ingerido", {
        organization_id: sessao.organizationId,
        channel_session_id: sessao.id,
        tipo: evento.tipo,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      desfechos.push("falhou");
    }
  }
  return desfechos;
}
