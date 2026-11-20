/**
 * POST /api/v1/social-comments/:id/private-reply { text, criar_contato? } —
 * responde EM PRIVADO, por mensagem direta a quem comentou.
 *
 * Limites da rede: uma por comentário (409 `ja_respondido_em_privado`) e até 7
 * dias depois do comentário (422 `janela_de_7_dias`). A resposta enviada é
 * gravada na conversa do contato; sem contato, só com `criar_contato: true`.
 *
 * Quem pode chamar está em `../../_borda.ts`; a regra, em
 * `lib/comentarios/acoes.ts`.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { responderEmPrivado } from "@/lib/comentarios/acoes";
import { responderEmPrivadoSchema } from "@/lib/comentarios/schemas";
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
  const entrada = await corpo(req, responderEmPrivadoSchema, borda);
  if ("response" in entrada) return entrada.response;
  try {
    const r = await responderEmPrivado(borda.db, borda.org, alvo.id, entrada.dados, borda.quem);
    return ok(r, { requestId: borda.requestId });
  } catch (erro) {
    return recusaDosComentarios(erro, borda);
  }
}
