/**
 * A TRAVA DE API das telas do plano (ArvisX, migration 9802).
 *
 * Chamada pelos portões que toda rota de `/api/v1` já atravessa — `requireRole`,
 * `orgAtivaDaApi` e o ramo de token de `resolveAuthDual` —, e não rota por rota.
 * O caminho e o método vêm do `x-pathname` e do `x-metodo` que o `proxy.ts`
 * grava SEMPRE (antes do `NextResponse.next`, sobrescrevendo o que o cliente
 * mandar). Sem caminho (fora de requisição, teste, script) não há o que recusar;
 * sem método, a chamada vale como escrita (as leituras abertas não abrem).
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
import { regraDaRotaDeApi } from "./rotas-do-plano";
import { planoLibera } from "./telas-do-plano";

export const MENSAGEM_FORA_DO_PLANO = "Esta função não está no plano da sua empresa.";

/** O cabeçalho em que o `proxy.ts` grava o método da requisição. */
export const CABECALHO_DO_METODO = "x-metodo";

async function cabecalhoDaRequisicao(nome: string): Promise<string | null> {
  try {
    return (await headers()).get(nome);
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
  opts: { requestId?: string; idioma?: Idioma; caminho?: string | null; metodo?: string | null } = {},
): Promise<NextResponse<ApiError> | null> {
  const caminho = opts.caminho !== undefined ? opts.caminho : await cabecalhoDaRequisicao("x-pathname");
  const metodo = opts.metodo !== undefined ? opts.metodo : await cabecalhoDaRequisicao(CABECALHO_DO_METODO);
  const regra = regraDaRotaDeApi(caminho, metodo);
  if (!regra) return null;
  const { destino } = regra;
  const leitura = await leituraDoPlanoDaOrg(orgId);
  if (regra.aceitos.some((tela) => planoLibera(leitura, tela))) return null;
  const grupo = NAV_CATALOG.find((d) => d.href === destino)?.group ?? null;
  return fail(codigoForaDoPlano(destino), traduzir(MENSAGEM_FORA_DO_PLANO, opts.idioma ?? "pt-BR"), 403, {
    requestId: opts.requestId,
    details: { destino, grupo },
  });
}

/**
 * A empresa NÃO tem esta tela no plano? Para a rota cuja leitura é aberta no
 * portão e que responde vazio, sem erro, a quem não tem a função (a lista de
 * propostas do dossiê do lead). Empresa isenta tem tudo.
 */
export async function telaForaDoPlano(orgId: string, destino: string): Promise<boolean> {
  return !planoLibera(await leituraDoPlanoDaOrg(orgId), destino);
}
