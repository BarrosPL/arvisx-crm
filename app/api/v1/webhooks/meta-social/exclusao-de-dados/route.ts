/**
 * POST /api/v1/webhooks/meta-social/exclusao-de-dados — o callback de exclusão
 * de dados da Meta (Data Deletion Request Callback) para quem usou o login do
 * Facebook da conexão direta do Instagram e do Messenger. Serve também como
 * callback de "desautorizar" (mesmo `signed_request`; a Meta ignora a resposta).
 *
 * Confere o `signed_request` com o App Secret da instalação ANTES de qualquer
 * efeito, desconecta as conexões que a pessoa autorizou (apaga os tokens) e
 * responde o que a Meta exige: `{ url, confirmation_code }`, com a URL da
 * página pública de status. O porquê do escopo está em
 * `lib/channels/meta-social/exclusao.ts`.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { appDaConexaoDireta } from "@/lib/channels/meta-social/app";
import {
  apagarConexoesDoUsuarioMeta,
  codigoDeConfirmacao,
  lerSignedRequest,
} from "@/lib/channels/meta-social/exclusao";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { basePublicaConfiguradaDaInstalacao } from "@/lib/webhooks/url-publica";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const texto = await req.text();
  if (texto.length > 8000) return fail("invalid_request", "payload_too_large", 413, { requestId });
  const signed = new URLSearchParams(texto).get("signed_request");
  const { appSecret } = await appDaConexaoDireta();
  const pedido = lerSignedRequest(signed, appSecret);
  if (!pedido) return fail("unauthorized", "invalid_signed_request", 400, { requestId });

  let total = 0;
  try {
    const r = await apagarConexoesDoUsuarioMeta(createAdminClient(), pedido.userId, appSecret);
    total = r.total;
    for (const [organizationId, sessoes] of r.porOrganizacao) {
      void audit({
        action: "lgpd.data_request_received",
        actorUserId: null,
        organizationId,
        resourceType: "channel_session",
        resourceId: null,
        requestId,
        metadata: { origem: "meta_exclusao_de_dados", conexoes_desconectadas: sessoes.length, sessoes },
      });
    }
  } catch (erro) {
    logger.error("[meta-social.exclusao] pedido não atendido", {
      request_id: requestId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return fail("internal_error", "exclusao_nao_concluida", 500, { requestId });
  }

  const codigo = codigoDeConfirmacao({ recebidoEm: new Date(), conexoes: total }, env.INTERNAL_SECRET);
  const base = basePublicaConfiguradaDaInstalacao({ aceitarMaquinaLocal: true }) ?? req.nextUrl.origin;
  return NextResponse.json(
    { url: `${base}/exclusao-de-dados?codigo=${encodeURIComponent(codigo)}`, confirmation_code: codigo },
    { status: 200 },
  );
}
