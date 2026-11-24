/**
 * POST /api/v1/social-comments/:id/ignore { motivo? } — marca o comentário
 * como sem ação (`estado: "sem_acao"`) e grava o motivo. Não fala com a rede.
 *
 * Quem pode chamar está em `../../_borda.ts`; a regra, em
 * `lib/comentarios/acoes.ts`.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { ignorarComentario } from "@/lib/comentarios/acoes";
import { ignorarSchema } from "@/lib/comentarios/schemas";
import { requireSupportWrite } from "@/lib/impersonate/support";

import { bordaDosComentarios, corpo, idDoCaminho, recusaDosComentarios } from "../../_borda";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const borda = await bordaDosComentarios(req, "escrita");
  if (!borda.ok) return borda.response;
  const alvo = idDoCaminho((await ctx.params).id, borda);
  if ("response" in alvo) return alvo.response;
  const entrada = await corpo(req, ignorarSchema, borda);
  if ("response" in entrada) return entrada.response;
  try {
    const r = await ignorarComentario(borda.db, borda.org, alvo.id, entrada.dados, borda.quem);
    return ok(r, { requestId: borda.requestId });
  } catch (erro) {
    return recusaDosComentarios(erro, borda);
  }
}
