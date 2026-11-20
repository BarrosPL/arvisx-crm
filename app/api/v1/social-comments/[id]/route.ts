/**
 * GET /api/v1/social-comments/:id — UM comentário, com as respostas e o estado.
 * Quem pode chamar está em `../_borda.ts`.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { lerComentario } from "@/lib/comentarios/acoes";

import { bordaDosComentarios, idDoCaminho, recusaDosComentarios } from "../_borda";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const borda = await bordaDosComentarios(req, "leitura");
  if (!borda.ok) return borda.response;
  const alvo = idDoCaminho((await ctx.params).id, borda);
  if ("response" in alvo) return alvo.response;
  try {
    return ok(await lerComentario(borda.db, borda.org, alvo.id, borda.quem), { requestId: borda.requestId });
  } catch (erro) {
    return recusaDosComentarios(erro, borda);
  }
}
