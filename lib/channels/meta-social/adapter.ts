/**
 * O adapter da CONEXÃO DIRETA do Instagram e do Messenger (provider
 * `meta_social`) — a porta `direta` do modelo neutro (`../social/porta.ts`),
 * agora com transporte.
 *
 * Envio: `POST /{page-id}/messages` com o token da página, para as duas redes —
 * o Instagram profissional ligado à página responde pelo mesmo endpoint, com o
 * IGSID como destinatário. O destinatário é a THREAD gravada pela ingestão
 * (`providerConversationId` = PSID/IGSID), nunca um telefone.
 *
 * Janela de 24 h: quem barra antes é a capability (`freeformOutsideWindow:
 * false`), na tela e no guardrail do agente. Se a Meta recusar por janela
 * fechada mesmo assim, e a instalação tiver a permissão "Human Agent" aprovada
 * no App Review (`META_HUMAN_AGENT_TAG=on`), o envio é refeito UMA vez com a
 * etiqueta `HUMAN_AGENT` (resposta humana em até 7 dias). A primeira tentativa
 * foi recusada, então não há envio em dobro.
 *
 * Falha da Graph lança `ErroDaGraph` com a frase do operador: o handler grava
 * `failed` com ela, e a Central mostra — como nos outros canais.
 */
import { assertDestinoResolvidoSeguro } from "@/lib/automation/outbound-ip";
import { assertSafeOutboundUrl } from "@/lib/automation/outbound-url";
import { MAX_MEDIA_BYTES, MediaTooLargeError } from "@/lib/messaging/media/types";
import { createAdminClient } from "@/lib/supabase/admin";

import { DETALHE_CREDENCIAL_RECUSADA } from "../health";
import { appDaMeta } from "../meta/app";
import { socialMessageId } from "../social/catalog";
import type { ChannelAdapter, OutboundEnvelope } from "../types";
import { CHANNEL_PROVIDER_SOCIAL_DIRETO } from "../capabilities";
import { chamarGraph, ErroDaGraph } from "./graph";
import { perfilDoParticipante } from "./perfil";
import { tokenDaSessao } from "./store";

type TipoDeAnexo = "image" | "video" | "audio" | "file";

/** O tipo do envelope → o tipo de anexo da Messenger Platform. `null` = não suportado. */
export function anexoDoEnvio(kind: string, rede: "facebook" | "instagram"): TipoDeAnexo | null {
  switch (kind) {
    case "image":
    case "sticker":
      return "image";
    case "video":
      return "video";
    case "audio":
    case "voice":
    case "ptt":
      return "audio";
    // O Instagram não aceita arquivo genérico por mensagem direta.
    case "document":
      return rede === "facebook" ? "file" : null;
    default:
      return null;
  }
}

/** O corpo do `POST /{page-id}/messages`. Puro, para ser testado sem rede. */
export function corpoDoEnvio(entrada: {
  destinatario: string;
  texto?: string | null;
  anexo?: { tipo: TipoDeAnexo; url: string } | null;
  humanAgent?: boolean;
}): Record<string, unknown> {
  const mensagem = entrada.anexo
    ? { attachment: { type: entrada.anexo.tipo, payload: { url: entrada.anexo.url, is_reusable: false } } }
    : { text: entrada.texto ?? "" };
  return {
    recipient: { id: entrada.destinatario },
    ...(entrada.humanAgent
      ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" }
      : { messaging_type: "RESPONSE" }),
    message: mensagem,
  };
}

function humanAgentLigado(): boolean {
  return (process.env.META_HUMAN_AGENT_TAG ?? "").trim().toLowerCase() === "on";
}

async function enviarUma(
  pageId: string,
  token: string,
  appSecret: string | null,
  corpo: Record<string, unknown>,
): Promise<string> {
  const r = await chamarGraph<{ message_id?: string }>(`${pageId}/messages`, { token, appSecret, corpo });
  if (!r.message_id) {
    throw new Error("Envio sem confirmação da Meta. Confira a conversa antes de tentar de novo.");
  }
  return r.message_id;
}

/** Envia, e refaz UMA vez com HUMAN_AGENT quando a janela fechou e a etiqueta está liberada. */
async function enviarComEtiqueta(
  pageId: string,
  token: string,
  appSecret: string | null,
  base: Parameters<typeof corpoDoEnvio>[0],
): Promise<string> {
  try {
    return await enviarUma(pageId, token, appSecret, corpoDoEnvio(base));
  } catch (erro) {
    if (erro instanceof ErroDaGraph && erro.foraDaJanela && humanAgentLigado()) {
      return enviarUma(pageId, token, appSecret, corpoDoEnvio({ ...base, humanAgent: true }));
    }
    throw erro;
  }
}

/** Baixa com até 3 saltos de redirect, cada um conferido contra SSRF. */
async function baixarComRedirecionamento(url: string): Promise<Response> {
  let atual = url;
  for (let salto = 0; salto < 4; salto++) {
    const alvo = new URL(atual);
    if (alvo.protocol !== "https:") throw new Error("A mídia não veio por https.");
    assertSafeOutboundUrl(alvo.toString());
    await assertDestinoResolvidoSeguro(alvo.hostname);
    const resposta = await fetch(alvo, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (resposta.status >= 300 && resposta.status < 400) {
      const proximo = resposta.headers.get("location");
      await resposta.body?.cancel();
      if (!proximo) throw new Error("Redirecionamento sem destino ao baixar a mídia.");
      atual = new URL(proximo, alvo).toString();
      continue;
    }
    return resposta;
  }
  throw new Error("Redirecionamentos demais ao baixar a mídia.");
}

/** O participante a partir do que o chamador tem: o PSID cru ou a identidade social. */
function participanteDe(recipient: string): string | null {
  const valor = recipient.includes(":") ? recipient.slice(recipient.lastIndexOf(":") + 1) : recipient;
  return /^[0-9]{1,40}$/.test(valor) ? valor : null;
}

export const metaSocialAdapter: ChannelAdapter = {
  provider: CHANNEL_PROVIDER_SOCIAL_DIRETO,
  codes: {
    notConfigured: "porta_sem_credencial",
    sendFailed: "porta_falhou",
    unknownError: "porta_desconhecida",
  },
  // O endereço é a thread gravada pela ingestão, nunca um telefone.
  resolveRecipient: (input) => (input.isGroup ? null : "provider-thread"),
  /**
   * SEMPRE `true` — a mesma decisão (e o mesmo defeito medido) da porta
   * intermediada: `false` deixaria a mensagem em `queued` para sempre, sem
   * erro. Quem desiste é `send`, com a frase.
   */
  isConfigured: () => true,
  templates: undefined,

  async send(envelope: OutboundEnvelope) {
    if (!envelope.providerConversationId) {
      throw new Error("Aguarde uma mensagem do cliente para responder nesta rede.");
    }
    const db = createAdminClient();
    const cred = await tokenDaSessao(db, envelope.organizationId, envelope.sessionRef);
    if (!cred) {
      throw new Error("Esta conta está sem autorização da Meta. Reconecte em Conexões › Facebook / Instagram.");
    }
    const { appSecret } = await appDaMeta();
    const destinatario = envelope.providerConversationId;
    const anexoTipo = envelope.media ? anexoDoEnvio(envelope.kind, cred.rede) : null;
    if (envelope.kind !== "text" && !anexoTipo) {
      throw new Error("Este tipo de mensagem ainda não é suportado nesta rede.");
    }
    if (envelope.kind === "text" && !(envelope.body ?? "").trim()) {
      throw new Error("A mensagem está vazia.");
    }
    await envelope.beforeSend?.();
    if (anexoTipo && envelope.media) {
      const mid = await enviarComEtiqueta(cred.pageId, cred.token, appSecret, {
        destinatario,
        anexo: { tipo: anexoTipo, url: envelope.media.url },
      });
      // A Messenger Platform não tem legenda em anexo: a legenda segue como
      // texto logo depois. Se ELA falhar, a mídia já saiu — e lançar faria a
      // mensagem inteira virar `failed`. O id que vale é o da mídia.
      const legenda = envelope.media.caption?.trim();
      if (legenda) {
        await enviarComEtiqueta(cred.pageId, cred.token, appSecret, { destinatario, texto: legenda }).catch(
          () => undefined,
        );
      }
      return { externalId: socialMessageId(envelope.sessionRef, mid) };
    }
    const mid = await enviarComEtiqueta(cred.pageId, cred.token, appSecret, {
      destinatario,
      texto: envelope.body ?? "",
    });
    return { externalId: socialMessageId(envelope.sessionRef, mid) };
  },

  async sendTemplate() {
    throw new Error("Esta rede não usa modelos de WhatsApp.");
  },

  async checkHealth(input) {
    const cred = await tokenDaSessao(createAdminClient(), input.organizationId, input.sessionRef);
    if (!cred) return { reachable: true, status: "FAILED", detail: DETALHE_CREDENCIAL_RECUSADA };
    const { appSecret } = await appDaMeta();
    try {
      await chamarGraph(cred.pageId, { token: cred.token, appSecret, query: { fields: "id" }, timeoutMs: 8_000 });
      return { reachable: true, status: "WORKING", detail: null };
    } catch (erro) {
      if (erro instanceof ErroDaGraph && erro.detalhe.status > 0) {
        return {
          reachable: true,
          status: "FAILED",
          detail: erro.tokenInvalido ? DETALHE_CREDENCIAL_RECUSADA : "conta_requer_atencao",
        };
      }
      return { reachable: false, status: null, detail: "provedor_indisponivel" };
    }
  },

  async fetchProfilePictureUrl(input) {
    const participante = participanteDe(input.recipient);
    if (!participante) return null;
    const cred = await tokenDaSessao(createAdminClient(), input.organizationId, input.sessionRef);
    if (!cred) return null;
    const { appSecret } = await appDaMeta();
    const perfil = await perfilDoParticipante({ rede: cred.rede, participante, token: cred.token, appSecret });
    return perfil?.foto ?? null;
  },

  /**
   * A URL do anexo é do CDN da Meta (assinada, expira em dias) — e não leva o
   * token: o CDN não o pede, e mandar credencial a um host de terceiro é o que
   * a guarda de SSRF existe para impedir.
   */
  async fetchInboundMedia(input) {
    const resposta = await baixarComRedirecionamento(input.url);
    if (!resposta.ok) throw new Error(`Falha ao baixar mídia (HTTP ${resposta.status}).`);
    if (Number(resposta.headers.get("content-length") ?? 0) > MAX_MEDIA_BYTES) {
      await resposta.body?.cancel();
      throw new MediaTooLargeError();
    }
    const leitor = resposta.body?.getReader();
    if (!leitor) throw new Error("A mídia retornou um corpo vazio.");
    const partes: Uint8Array[] = [];
    let tamanho = 0;
    try {
      while (true) {
        const { done, value } = await leitor.read();
        if (done) break;
        tamanho += value.byteLength;
        if (tamanho > MAX_MEDIA_BYTES) {
          await leitor.cancel();
          throw new MediaTooLargeError();
        }
        partes.push(value);
      }
    } finally {
      leitor.releaseLock();
    }
    return {
      buffer: Buffer.concat(partes),
      mime: resposta.headers.get("content-type")?.split(";")[0] ?? input.hintMime ?? "application/octet-stream",
    };
  },
};
