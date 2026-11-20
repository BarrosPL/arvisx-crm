/**
 * POST /api/v1/social-comments/:id/hide — oculta o comentário na rede.
 *
 * Ocultar de novo devolve o que já está gravado (`ja_estava_oculto: true`).
 * Em modo de registro, nada muda na rede e a resposta volta `simulada: true`.
 *
 * Quem pode chamar está em `../../_borda.ts`; a regra, em
 * `lib/comentarios/acoes.ts`.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { ocultarComentario } from "@/lib/comentarios/acoes";
import { requireSupportWrite } from "@/lib/impersonate/support";

import { bordaDosComentarios, idDoCaminho, recusaDosComentarios } from "../../_borda";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const borda = await bordaDosComentarios(req, "escrita");
  if (!borda.ok) return borda.response;
  const alvo = idDoCaminho((await ctx.params).id, borda);
  if ("response" in alvo) return alvo.response;
  try {
    const r = await ocultarComentario(borda.db, borda.org, alvo.id, borda.quem);
    return ok(r, { requestId: borda.requestId });
  } catch (erro) {
    return recusaDosComentarios(erro, borda);
  }
}
