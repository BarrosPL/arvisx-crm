/**
 * O pedido de EXCLUSÃO DE DADOS que a Meta manda em nome de quem usou o login
 * do Facebook (Data Deletion Request Callback, exigência do App Review).
 *
 * ─── Quem é o titular aqui ──────────────────────────────────────────────────
 *
 * A Meta só manda este pedido para quem FEZ LOGIN no app — a pessoa da empresa
 * que conectou a página, identificada pelo id dela no app (`user_id`,
 * app-scoped). Os clientes finais que escrevem pelo Messenger ou pelo Instagram
 * nunca fizeram login no app e não geram este pedido: os dados deles são do
 * atendimento da empresa (controladora), e a exclusão deles segue pelo caminho
 * de LGPD do CRM (pedido do titular à empresa, anonimização do contato) — é o
 * que a página `/exclusao-de-dados` explica.
 *
 * O que o CRM guarda POR CAUSA desse login: os tokens de página obtidos com a
 * autorização da pessoa. Atender o pedido é desconectar as conexões que ela
 * autorizou (desassinar a página quando der, APAGAR o token, arquivar a
 * sessão). As conversas atendidas ficam com a empresa, como em toda conexão
 * desligada.
 *
 * ─── O código de confirmação ────────────────────────────────────────────────
 *
 * Sem tabela nova: o código carrega a hora e a contagem do que foi feito, e é
 * assinado com o `INTERNAL_SECRET`. A página de status confere a assinatura e
 * mostra o que o código diz — não há o que consultar, porque a exclusão é feita
 * na hora, dentro do próprio callback.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";

import { CHANNEL_PROVIDER_SOCIAL_DIRETO } from "../capabilities";
import { desconectarSessao } from "./store";

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/**
 * Lê e CONFERE o `signed_request` da Meta: `<assinatura>.<carga>`, ambas em
 * base64url, assinatura = HMAC-SHA256 da carga (o texto base64url) com o App
 * Secret. `null` para qualquer coisa que não confira. Nunca lança.
 */
export function lerSignedRequest(
  signed: string | null | undefined,
  appSecret: string | null | undefined,
): { userId: string; emitidoEm: number | null } | null {
  if (!signed || !appSecret || signed.length > 4000) return null;
  const partes = signed.split(".");
  if (partes.length !== 2) return null;
  const [assinatura = "", carga = ""] = partes;
  if (!/^[A-Za-z0-9_-]+$/.test(assinatura) || !/^[A-Za-z0-9_-]+$/.test(carga)) return null;
  const esperada = createHmac("sha256", appSecret).update(carga, "utf8").digest();
  const recebida = Buffer.from(assinatura, "base64url");
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
  try {
    const dados = JSON.parse(Buffer.from(carga, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof dados.algorithm === "string" && dados.algorithm.toUpperCase() !== "HMAC-SHA256") return null;
    const userId = typeof dados.user_id === "string" || typeof dados.user_id === "number" ? String(dados.user_id) : "";
    if (!/^[0-9]{1,40}$/.test(userId)) return null;
    return { userId, emitidoEm: typeof dados.issued_at === "number" ? dados.issued_at : null };
  } catch {
    return null;
  }
}

export interface StatusDoPedido {
  recebidoEm: Date;
  conexoes: number;
}

function assinarCodigo(carga: string, segredo: string): string {
  return b64url(createHmac("sha256", `meta-social/exclusao\u0000${segredo}`).update(carga).digest()).slice(0, 22);
}

export function codigoDeConfirmacao(status: StatusDoPedido, segredo: string): string {
  const carga = `${status.recebidoEm.getTime().toString(36)}-${status.conexoes.toString(36)}`;
  return `${carga}-${assinarCodigo(carga, segredo)}`;
}

/** `null` para código que não é nosso ou foi alterado. Nunca lança. */
export function lerCodigoDeConfirmacao(codigo: string | null | undefined, segredo: string): StatusDoPedido | null {
  if (!codigo || !/^[0-9a-z]{1,12}-[0-9a-z]{1,6}-[A-Za-z0-9_-]{22}$/.test(codigo)) return null;
  // A assinatura (base64url) pode conter "-": a carga são os DOIS primeiros campos.
  const i = codigo.indexOf("-");
  const j = codigo.indexOf("-", i + 1);
  const carga = codigo.slice(0, j);
  const recebida = Buffer.from(codigo.slice(j + 1));
  const esperada = Buffer.from(assinarCodigo(carga, segredo));
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
  const ms = parseInt(codigo.slice(0, i), 36);
  const conexoes = parseInt(codigo.slice(i + 1, j), 36);
  if (!Number.isFinite(ms) || !Number.isFinite(conexoes)) return null;
  return { recebidoEm: new Date(ms), conexoes };
}

/**
 * Desconecta TODAS as conexões diretas ativas que esta pessoa autorizou, em
 * qualquer organização. Devolve quantas e de quais organizações (para a
 * auditoria de cada uma).
 */
export async function apagarConexoesDoUsuarioMeta(
  db: SupabaseClient,
  metaUserId: string,
  appSecret: string | null,
): Promise<{ total: number; porOrganizacao: Map<string, string[]> }> {
  const { data, error } = await db
    .from("channel_sessions")
    .select("id, organization_id")
    .eq("provider", CHANNEL_PROVIDER_SOCIAL_DIRETO)
    .eq("metadata->>meta_user_id", metaUserId)
    .is("archived_at", null);
  if (error) throw new Error(`exclusao_meta_lookup_failed: ${error.message}`);
  const porOrganizacao = new Map<string, string[]>();
  let total = 0;
  for (const linha of (data ?? []) as { id: string; organization_id: string }[]) {
    await desconectarSessao(db, linha.organization_id, linha.id, appSecret);
    total++;
    porOrganizacao.set(linha.organization_id, [...(porOrganizacao.get(linha.organization_id) ?? []), linha.id]);
  }
  return { total, porOrganizacao };
}
