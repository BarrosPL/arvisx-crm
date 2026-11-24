/**
 * POST /api/v1/social-comments/:id/criar-contato { pipeline_id?, stage_id?, title? }
 * — cria o contato de quem comentou e, com `pipeline_id`, o negócio no funil.
 *
 * Chamar de novo devolve o mesmo contato. O negócio reaproveita o card aberto
 * do contato naquele funil, pela mesma regra da captação.
 *
 * Quem pode chamar está em `../../_borda.ts`; a regra, em
 * `lib/comentarios/acoes.ts`.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { criarContatoDoComentario } from "@/lib/comentarios/acoes";
import { criarContatoSchema } from "@/lib/comentarios/schemas";
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
  const entrada = await corpo(req, criarContatoSchema, borda);
  if ("response" in entrada) return entrada.response;
  try {
    const r = await criarContatoDoComentario(borda.db, borda.org, alvo.id, entrada.dados, borda.quem);
    return ok(r, { requestId: borda.requestId });
  } catch (erro) {
    return recusaDosComentarios(erro, borda);
  }
}
