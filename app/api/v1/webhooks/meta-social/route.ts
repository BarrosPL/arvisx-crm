/**
 * GET|POST /api/v1/webhooks/meta-social — o webhook da CONEXÃO DIRETA do
 * Instagram e do Messenger (objetos `page` e `instagram` do app da Meta).
 *
 * Um endereço só para a instalação inteira, cadastrado UMA vez pelo dono no
 * painel do app (Webhooks › Page e Webhooks › Instagram). Diferente do canal
 * oficial do WhatsApp, não há token no caminho: a Meta assina tudo com o App
 * Secret, e a organização sai da SESSÃO achada pela conta do evento
 * (`entry.id`), que só existe numa sessão ativa — nunca do corpo.
 *
 * `GET` é o handshake (`hub.challenge` em texto puro, como a rota irmã do
 * WhatsApp explica). `POST` confere `X-Hub-Signature-256` (HMAC SHA-256 com o
 * App Secret, comparação em tempo constante) ANTES de ler qualquer coisa.
 *
 * 200 sempre que a assinatura confere, inclusive para evento que não nos
 * interessa: a Meta reentrega o que não recebe 2xx. O desfecho de cada evento
 * vai no corpo, e a falha vai ao log — nunca fica muda.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { appDaConexaoDireta } from "@/lib/channels/meta-social/app";
import { processarEventosDiretos } from "@/lib/channels/meta-social/ingest";
import { lerWebhookDireto } from "@/lib/channels/meta-social/webhook";
import { verificationChallenge, verifyMetaSignature } from "@/lib/channels/meta/webhook";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Corpo maior que isto não é entrega da Meta (lotes têm poucos KB). */
const TETO_DO_CORPO = 1_000_000;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { verifyToken } = await appDaConexaoDireta();
  const challenge = verificationChallenge(req.nextUrl.searchParams, verifyToken ?? "");
  if (challenge === null) return new NextResponse("forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const rawBody = await req.text();
  if (rawBody.length > TETO_DO_CORPO) return fail("invalid_request", "payload_too_large", 413, { requestId });

  const { appId, appSecret } = await appDaConexaoDireta();
  if (!appSecret || !verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"), appSecret)) {
    return fail("unauthorized", "invalid_signature", 401, { requestId });
  }

  let corpo: unknown;
  try {
    corpo = JSON.parse(rawBody);
  } catch {
    return fail("invalid_request", "invalid_json", 400, { requestId });
  }

  const eventos = lerWebhookDireto(corpo);
  const desfechos = await processarEventosDiretos(createAdminClient(), eventos, { appId, appSecret });
  if (desfechos.includes("falhou")) {
    logger.error("[meta-social.webhook] entrega com evento não ingerido", {
      request_id: requestId,
      desfechos,
    });
  }
  return NextResponse.json({ received: eventos.length, outcomes: desfechos }, { status: 200 });
}
