/**
 * A TRAVA DE API das telas do plano (ArvisX, migration 9802).
 *
 * Chamada pelos portões que toda rota de `/api/v1` já atravessa — `requireRole`,
 * `orgAtivaDaApi` e o ramo de token de `resolveAuthDual` —, e não rota por rota.
 * O caminho vem do `x-pathname` que o `proxy.ts` grava SEMPRE (antes do
 * `NextResponse.next`, sobrescrevendo o que o cliente mandar). Sem caminho (fora
 * de requisição, teste, script) não há o que recusar.
 *
 * Rota ligada a uma tela fora do plano → 403 `fora_do_plano:<destino>`. Rota
 * livre (Inbox, mensagens, conversas, webhooks de entrada, cron, conta) nunca
 * consulta o plano. Não apaga nada: ao assinar um plano maior, a rota volta.
 */
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { codigoForaDoPlano } from "@/lib/api/errors";
import { fail, type ApiError } from "@/lib/api/wrappers";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import { leituraDoPlanoDaOrg } from "./leitura-do-plano";
import { destinoDaRotaDeApi } from "./rotas-do-plano";
import { planoLibera } from "./telas-do-plano";

export const MENSAGEM_FORA_DO_PLANO = "Esta função não está no plano da sua empresa.";

async function caminhoDaRequisicao(): Promise<string | null> {
  try {
    return (await headers()).get("x-pathname");
  } catch {
    return null;
  }
}

/**
 * O 403 de tela fora do plano para esta requisição, ou `null` quando passa.
 * `caminho` explícito vence o header (teste, chamador que já o tem).
 */
export async function recusaForaDoPlano(
  orgId: string,
  opts: { requestId?: string; idioma?: Idioma; caminho?: string | null } = {},
): Promise<NextResponse<ApiError> | null> {
  const caminho = opts.caminho !== undefined ? opts.caminho : await caminhoDaRequisicao();
  const destino = destinoDaRotaDeApi(caminho);
  if (!destino) return null;
  const leitura = await leituraDoPlanoDaOrg(orgId);
  if (planoLibera(leitura, destino)) return null;
  const grupo = NAV_CATALOG.find((d) => d.href === destino)?.group ?? null;
  return fail(codigoForaDoPlano(destino), traduzir(MENSAGEM_FORA_DO_PLANO, opts.idioma ?? "pt-BR"), 403, {
    requestId: opts.requestId,
    details: { destino, grupo },
  });
}
