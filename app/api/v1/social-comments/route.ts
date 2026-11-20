/**
 * GET /api/v1/social-comments — os comentários recebidos, do mais recente.
 *
 * Filtros (query): `canal` (id da conexão), `estado`, `desde` (ISO-8601 com
 * fuso), `midia` (id da publicação), `limite` (até 100) e `cursor`. Quem pode
 * chamar está em `./_borda.ts`.
 */
import type { NextRequest } from "next/server";

import { respostaDeRecusa } from "@/lib/api/recusa";
import { fail, ok } from "@/lib/api/wrappers";
import { listarComentarios } from "@/lib/comentarios/acoes";
import { filtrosDaListaSchema } from "@/lib/comentarios/schemas";

import { bordaDosComentarios } from "./_borda";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const borda = await bordaDosComentarios(req, "leitura");
  if (!borda.ok) return borda.response;
  const { requestId } = borda;

  const filtros = filtrosDaListaSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!filtros.success) {
    return fail("validation_error", "Filtros inválidos.", 422, { requestId });
  }
  try {
    const pagina = await listarComentarios(borda.db, borda.org, filtros.data, borda.quem);
    return ok(pagina.comentarios, {
      requestId,
      meta: { cursor: pagina.cursor, has_more: pagina.tem_mais },
    });
  } catch (erro) {
    return respostaDeRecusa(erro, requestId);
  }
}
