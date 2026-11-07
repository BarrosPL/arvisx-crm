/**
 * As sessões da conexão DIRETA (Instagram e Messenger sem parceiro) — gravar,
 * ler e desfazer.
 *
 * Uma sessão por (rede, conta): a página do Facebook vira uma sessão
 * `facebook`, e a conta profissional do Instagram ligada a ela vira OUTRA
 * sessão `instagram`. É o mesmo desenho do canal por parceiro (uma linha por
 * conta, `metadata.social_platform` dizendo a rede), e é o que deixa todo o
 * resto do produto — Inbox, IA por canal, pausa, renomear, plano — funcionar
 * sem saber que a porta mudou.
 *
 * O token da página fica cifrado (`fn_encrypt_oauth`) em
 * `meta_social_token_encrypted`; nunca volta à tela. Desconectar desassina o
 * app na página (best-effort), APAGA o token e arquiva a linha — as conversas
 * ficam, como em todo canal.
 *
 * `organization_id` vem SEMPRE de quem chama, que o tirou da sessão
 * autenticada (rota) ou da própria linha achada pela conta (webhook).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

import { metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";
import { lerLimiteEstourado } from "@/lib/cobranca/limites";
import { fecharAvisoDePausaDoCanalArquivado } from "@/lib/channels/central-de-pausa";
import { resolverSaudeDaConexaoRemovida } from "@/lib/channels/health";
import { logger } from "@/lib/logger";
import { decryptWebhookSecret, encryptWebhookSecret } from "@/lib/webhooks/secrets";

import { CHANNEL_PROVIDER_SOCIAL_DIRETO } from "../capabilities";
import { ErroDaGraph } from "./graph";
import { assinarAppNaPagina, desassinarAppDaPagina, type PaginaAutorizada } from "./oauth";
import type { RedeDireta } from "./webhook";

export class ErroDaConexaoDireta extends Error {
  constructor(
    message: string,
    public status = 422,
    public code = "invalid_request",
  ) {
    super(message);
  }
}

export interface SessaoDireta {
  id: string;
  organizationId: string;
  rede: RedeDireta;
  conta: string;
  pageId: string;
  displayName: string | null;
  status: string;
  metadata: Record<string, unknown>;
}

const COLUNAS =
  "id, organization_id, meta_social_account_id, meta_social_page_id, display_name, status, metadata";

interface LinhaDaSessao {
  id: string;
  organization_id: string;
  meta_social_account_id: string;
  meta_social_page_id: string | null;
  display_name: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
}

function paraSessao(l: LinhaDaSessao): SessaoDireta | null {
  const rede = l.metadata?.social_platform;
  if (rede !== "facebook" && rede !== "instagram") return null;
  return {
    id: l.id,
    organizationId: l.organization_id,
    rede,
    conta: l.meta_social_account_id,
    pageId: l.meta_social_page_id ?? l.meta_social_account_id,
    displayName: l.display_name,
    status: l.status,
    metadata: l.metadata ?? {},
  };
}

/** As conexões diretas ATIVAS da organização. */
export async function conexoesDiretas(db: SupabaseClient, org: string): Promise<SessaoDireta[]> {
  const { data, error } = await db
    .from("channel_sessions")
    .select(COLUNAS)
    .eq("organization_id", org)
    .eq("provider", CHANNEL_PROVIDER_SOCIAL_DIRETO)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new ErroDaConexaoDireta("Não foi possível ler as conexões.", 500, "internal_error");
  return ((data ?? []) as LinhaDaSessao[]).map(paraSessao).filter((s): s is SessaoDireta => s !== null);
}

/**
 * A sessão ATIVA que responde por esta conta — de qualquer organização.
 *
 * É o roteamento do webhook: a conta (`entry.id`) só existe numa sessão ativa
 * (índice único entre ativas), e a organização sai DELA, não do corpo.
 */
export async function sessaoPelaConta(db: SupabaseClient, conta: string): Promise<SessaoDireta | null> {
  // Mesmo desenho de `entrada-da-instalacao.ts`: SEM organização de antemão
  // (é o webhook único da instalação que pergunta), então nada de
  // `maybeSingle()` — com duas linhas ele devolveria `null` + PGRST116 e a
  // mensagem sumiria calada. `limit(2)` e recusa explícita da ambiguidade, que
  // o índice único entre ativas (migration 9800) já impede no banco.
  const ativas = () =>
    db
      .from("channel_sessions")
      .select(COLUNAS)
      .eq("provider", CHANNEL_PROVIDER_SOCIAL_DIRETO)
      .is("archived_at", null);
  const { data, error } = await ativas().eq("meta_social_account_id", conta).limit(2);
  if (error) throw new Error(`meta_social_session_lookup_failed: ${error.message}`);
  const linhas = (data ?? []) as LinhaDaSessao[];
  if (linhas.length > 1) {
    logger.warn("[meta-social] conta em mais de uma sessão ativa; evento descartado", {
      sessoes: linhas.map((l) => l.id),
    });
    return null;
  }
  return linhas[0] ? paraSessao(linhas[0]) : null;
}

/** O token da página desta sessão, decifrado. `null` = desconectada ou cifra indisponível. */
export async function tokenDaSessao(
  db: SupabaseClient,
  org: string,
  conta: string,
): Promise<{ token: string; pageId: string; rede: RedeDireta } | null> {
  const { data, error } = await db
    .from("channel_sessions")
    .select("meta_social_token_encrypted, meta_social_page_id, meta_social_account_id, metadata")
    .eq("organization_id", org)
    .eq("provider", CHANNEL_PROVIDER_SOCIAL_DIRETO)
    .eq("meta_social_account_id", conta)
    .is("archived_at", null)
    .maybeSingle();
  if (error || !data) return null;
  const linha = data as {
    meta_social_token_encrypted: string | null;
    meta_social_page_id: string | null;
    meta_social_account_id: string;
    metadata: Record<string, unknown> | null;
  };
  if (!linha.meta_social_token_encrypted) return null;
  const token = await decryptWebhookSecret(db, linha.meta_social_token_encrypted);
  const rede = linha.metadata?.social_platform;
  if (!token || (rede !== "facebook" && rede !== "instagram")) return null;
  return { token, pageId: linha.meta_social_page_id ?? linha.meta_social_account_id, rede };
}

export interface PedidoDeConexao {
  organizationId: string;
  pagina: PaginaAutorizada;
  redes: readonly RedeDireta[];
  appSecret: string;
  /** O id da pessoa no app, para o pedido de exclusão de dados achar a sessão. */
  metaUserId: string | null;
  conectadoPor: string;
}

export interface ConexaoGravada {
  channelSessionId: string;
  rede: RedeDireta;
  conta: string;
  nome: string;
  jaExistia: boolean;
}

/**
 * Grava (ou reconecta) as sessões da página escolhida e assina o app nela.
 *
 * A ordem é a ordem em que dá errado:
 *   1. a conta já ativa em OUTRA organização recusa antes de qualquer efeito —
 *      o webhook é um só e roteia pela conta;
 *   2. as sessões são gravadas ANTES da assinatura: a primeira entrega procura a
 *      sessão pela conta, e uma entrega sem sessão é descartada;
 *   3. a assinatura falhando deixa as sessões `FAILED` e devolve a frase da
 *      Meta — reconectar refaz tudo, idempotente.
 */
export async function conectarPagina(db: SupabaseClient, pedido: PedidoDeConexao): Promise<ConexaoGravada[]> {
  const { pagina } = pedido;
  const alvos: { rede: RedeDireta; conta: string; nome: string }[] = [];
  if (pedido.redes.includes("facebook")) alvos.push({ rede: "facebook", conta: pagina.id, nome: pagina.nome });
  if (pedido.redes.includes("instagram")) {
    if (!pagina.instagram) {
      throw new ErroDaConexaoDireta(
        "Esta página não tem uma conta profissional do Instagram ligada. Ligue a conta à página no Instagram (Configurações › Conta › Página do Facebook) e conecte de novo.",
        422,
        "instagram_nao_vinculado",
      );
    }
    alvos.push({
      rede: "instagram",
      conta: pagina.instagram.id,
      nome: pagina.instagram.username ? `@${pagina.instagram.username}` : pagina.nome,
    });
  }
  if (alvos.length === 0) throw new ErroDaConexaoDireta("Escolha ao menos uma rede para conectar.", 400, "validation_failed");

  for (const alvo of alvos) {
    const dono = await sessaoPelaConta(db, alvo.conta);
    if (dono && dono.organizationId !== pedido.organizationId) {
      throw new ErroDaConexaoDireta(
        "Esta conta já está conectada em outra empresa deste sistema. Desconecte por lá antes de conectar aqui.",
        409,
        "state_conflict",
      );
    }
  }

  const tokenCifrado = await encryptWebhookSecret(db, pagina.token);
  if (!tokenCifrado) {
    throw new ErroDaConexaoDireta(
      "A cifra desta instalação não está disponível, então nada foi gravado. Avise quem administra a instalação.",
      503,
      "encryption_unavailable",
    );
  }

  // `webhook_secret_encrypted` é NOT NULL em toda sessão. A entrada desta
  // conexão é conferida pelo App Secret da instalação (X-Hub-Signature-256),
  // não por segredo por sessão — então o valor é aleatório e não é publicado
  // em lugar nenhum; existe porque a coluna o exige.
  const segredoCifrado = await encryptWebhookSecret(db, randomBytes(32).toString("hex"));
  if (!segredoCifrado) {
    throw new ErroDaConexaoDireta(
      "A cifra desta instalação não está disponível, então nada foi gravado. Avise quem administra a instalação.",
      503,
      "encryption_unavailable",
    );
  }

  const gravadas: ConexaoGravada[] = [];
  for (const alvo of alvos) {
    const existente = await sessaoPelaConta(db, alvo.conta);
    const metadata = {
      ...(existente?.metadata ?? metadataInicialDoCanal()),
      social_platform: alvo.rede,
      meta_page_name: pagina.nome,
      ...(pedido.metaUserId ? { meta_user_id: pedido.metaUserId } : {}),
      conectado_por: pedido.conectadoPor,
    };
    if (existente) {
      const { error } = await db
        .from("channel_sessions")
        .update({
          meta_social_page_id: pagina.id,
          meta_social_token_encrypted: tokenCifrado,
          status: "STARTING",
          last_status_change_at: new Date().toISOString(),
          metadata,
        })
        .eq("organization_id", pedido.organizationId)
        .eq("id", existente.id);
      if (error) throw new ErroDaConexaoDireta("Não foi possível atualizar a conexão. Tente de novo.", 500, "internal_error");
      gravadas.push({ channelSessionId: existente.id, rede: alvo.rede, conta: alvo.conta, nome: alvo.nome, jaExistia: true });
      continue;
    }
    const { data, error } = await db
      .from("channel_sessions")
      .insert({
        organization_id: pedido.organizationId,
        provider: CHANNEL_PROVIDER_SOCIAL_DIRETO,
        meta_social_account_id: alvo.conta,
        meta_social_page_id: pagina.id,
        meta_social_token_encrypted: tokenCifrado,
        // Token próprio de caminho, como toda sessão: a entrada desta conexão é
        // o webhook ÚNICO da instalação, e este valor não é publicado em lugar
        // nenhum — existe porque a coluna o exige.
        webhook_path_token: randomBytes(24).toString("hex"),
        webhook_secret_encrypted: segredoCifrado,
        display_name: `${alvo.rede} · ${alvo.nome}`,
        status: "STARTING",
        metadata,
      })
      .select("id")
      .single();
    // Limite de canais do plano: sobe CRU para a rota dizer o número.
    if (lerLimiteEstourado(error)) throw error;
    if (error?.code === "23505") {
      throw new ErroDaConexaoDireta(
        "Esta conta acabou de ser conectada por outra pessoa. Atualize a lista.",
        409,
        "state_conflict",
      );
    }
    if (error || !data) throw new ErroDaConexaoDireta("Não foi possível criar a conexão. Tente de novo.", 500, "internal_error");
    gravadas.push({ channelSessionId: (data as { id: string }).id, rede: alvo.rede, conta: alvo.conta, nome: alvo.nome, jaExistia: false });
  }

  try {
    await assinarAppNaPagina(pagina.id, pagina.token, pedido.appSecret);
  } catch (erro) {
    for (const g of gravadas) {
      await db
        .from("channel_sessions")
        .update({ status: "FAILED", status_reason: "assinatura_da_pagina_falhou" })
        .eq("organization_id", pedido.organizationId)
        .eq("id", g.channelSessionId);
    }
    throw new ErroDaConexaoDireta(
      erro instanceof ErroDaGraph
        ? erro.message
        : "A Meta não confirmou o recebimento das mensagens desta página. Tente conectar de novo.",
      502,
      "upstream_unavailable",
    );
  }

  const agora = new Date().toISOString();
  for (const g of gravadas) {
    await db
      .from("channel_sessions")
      .update({ status: "WORKING", status_reason: null, last_status_change_at: agora })
      .eq("organization_id", pedido.organizationId)
      .eq("id", g.channelSessionId);
  }
  return gravadas;
}

/**
 * Desconecta UMA sessão: desassina a página (só quando nenhuma outra sessão
 * ativa da mesma página continua precisando dela), apaga o token e arquiva.
 *
 * A desassinatura é best-effort: token já revogado na Meta não pode impedir a
 * pessoa de tirar a conta do CRM. O que é obrigatório é apagar o token e
 * arquivar — isso é o que corta a entrada (o webhook só acha sessão ativa).
 */
export async function desconectarSessao(
  db: SupabaseClient,
  org: string,
  sessionId: string,
  appSecret: string | null,
): Promise<{ desassinada: "sim" | "outra_rede_ainda_usa" | "falhou" | "sem_token"; avisos: string }> {
  const { data, error } = await db
    .from("channel_sessions")
    .select("id, meta_social_page_id, meta_social_account_id, meta_social_token_encrypted")
    .eq("organization_id", org)
    .eq("id", sessionId)
    .eq("provider", CHANNEL_PROVIDER_SOCIAL_DIRETO)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new ErroDaConexaoDireta("Não foi possível ler a conexão.", 500, "internal_error");
  if (!data) throw new ErroDaConexaoDireta("Conexão não encontrada.", 404, "not_found");
  const linha = data as {
    meta_social_page_id: string | null;
    meta_social_account_id: string;
    meta_social_token_encrypted: string | null;
  };
  const pageId = linha.meta_social_page_id ?? linha.meta_social_account_id;

  const desassinada = await desfazerNaMeta(db, org, sessionId, pageId, linha.meta_social_token_encrypted, appSecret);

  const agora = new Date().toISOString();
  const { error: erroArquivo } = await db
    .from("channel_sessions")
    .update({
      archived_at: agora,
      status: "STOPPED",
      last_status_change_at: agora,
      meta_social_token_encrypted: null,
      webhook_path_token: randomBytes(24).toString("hex"),
    })
    .eq("organization_id", org)
    .eq("id", sessionId);
  if (erroArquivo) throw new ErroDaConexaoDireta("Não foi possível desconectar. Tente de novo.", 500, "internal_error");

  let avisos = "sem_mudanca";
  try {
    avisos = await resolverSaudeDaConexaoRemovida(db, { id: sessionId, organization_id: org, status: "STOPPED" });
  } catch (erro) {
    avisos = "falhou";
    logger.warn("[meta-social] avisos da conexão removida não fechados", {
      organization_id: org,
      channel_session_id: sessionId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
  }
  await fecharAvisoDePausaDoCanalArquivado(db, { id: sessionId, organization_id: org });
  return { desassinada, avisos };
}

/**
 * Desassina o app na página — só quando esta é a ÚLTIMA sessão ativa daquela
 * página nesta organização (Instagram e Messenger da mesma página dividem a
 * mesma assinatura). Nunca lança.
 */
export async function desfazerNaMeta(
  db: SupabaseClient,
  org: string,
  sessionId: string,
  pageId: string,
  tokenCifrado: string | null,
  appSecret: string | null,
): Promise<"sim" | "outra_rede_ainda_usa" | "falhou" | "sem_token"> {
  const { data: irmas } = await db
    .from("channel_sessions")
    .select("id")
    .eq("organization_id", org)
    .eq("provider", CHANNEL_PROVIDER_SOCIAL_DIRETO)
    .eq("meta_social_page_id", pageId)
    .is("archived_at", null)
    .neq("id", sessionId);
  if (((irmas as { id: string }[] | null) ?? []).length > 0) return "outra_rede_ainda_usa";
  if (!tokenCifrado || !appSecret) return "sem_token";
  const token = await decryptWebhookSecret(db, tokenCifrado);
  if (!token) return "sem_token";
  try {
    await desassinarAppDaPagina(pageId, token, appSecret);
    return "sim";
  } catch (erro) {
    logger.warn("[meta-social] desassinatura da página falhou; a conexão sai do CRM assim mesmo", {
      organization_id: org,
      channel_session_id: sessionId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return "falhou";
  }
}
