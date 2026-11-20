/**
 * POST /api/v1/social-comments/:id/reply { text } — responde EM PÚBLICO.
 *
 * Uma resposta por comentário: a segunda chamada recebe 409 `ja_respondido`
 * com a resposta existente em `details.resposta`. Com o canal em modo de
 * registro, nada é publicado e a resposta volta com `simulada: true`.
 *
 * Quem pode chamar está em `../../_borda.ts`; a regra, em
 * `lib/comentarios/acoes.ts`.
 */
import type { NextRequest } from "next/server";

import { respostaDeRecusa } from "@/lib/api/recusa";
import { ok } from "@/lib/api/wrappers";
import { responderEmPublico } from "@/lib/comentarios/acoes";
import { responderSchema } from "@/lib/comentarios/schemas";
import { requireSupportWrite } from "@/lib/impersonate/support";

import { bordaDosComentarios, corpo, idDoCaminho } from "../../_borda";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const borda = await bordaDosComentarios(req, "escrita");
  if (!borda.ok) return borda.response;
  const alvo = idDoCaminho((await ctx.params).id, borda.requestId);
  if ("response" in alvo) return alvo.response;
  const entrada = await corpo(req, responderSchema, borda.requestId);
  if ("response" in entrada) return entrada.response;
  try {
    const r = await responderEmPublico(borda.db, borda.org, alvo.id, entrada.dados, borda.quem);
    return ok(r, { requestId: borda.requestId });
  } catch (erro) {
    return respostaDeRecusa(erro, borda.requestId);
  }
}
