/**
 * A borda das rotas `/api/v1/social-comments/...` — quem pode chamar, e como.
 *
 * ─── Quem consegue chamar o quê ─────────────────────────────────────────────
 *
 *   sessão de navegador   gerente ou administrador da organização (a tela de
 *                         Comentários é de gerente para cima);
 *   token `dsk_…`         com o escopo `mcp:read` (leitura) ou `mcp:write`
 *                         (escrita) E tratado como gerente (`role:manager`) —
 *                         o MESMO papel que as ferramentas `crm_*_comment` do
 *                         MCP exigem. Com papel menor na rota, ela viraria o
 *                         atalho do token que a ferramenta recusa.
 *
 * A organização sai da sessão ou da LINHA do token, nunca do corpo nem do
 * caminho. A regra de cada ação mora em `lib/comentarios/acoes.ts`; aqui só há
 * autenticação, limite de chamadas do token e leitura da entrada.
 *
 * O banco é o cliente de serviço nos dois casos: `social_comments` não tem
 * policy de escrita (só o servidor grava), e toda consulta de `acoes.ts`
 * filtra pela organização resolvida aqui.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { fail } from "@/lib/api/wrappers";
import type { QuemAge } from "@/lib/comentarios/acoes";
import { createAdminClient } from "@/lib/supabase/admin";

/** O papel mínimo, na sessão e no token. Igual ao das ferramentas do MCP. */
export const PAPEL_DOS_COMENTARIOS = "manager" as const;

export type Borda =
  | { ok: true; db: SupabaseClient; org: string; quem: QuemAge; requestId: string }
  | { ok: false; response: Response };

export async function bordaDosComentarios(req: NextRequest, modo: "leitura" | "escrita"): Promise<Borda> {
  const requestId = randomUUID();
  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "social_comments",
    role: PAPEL_DOS_COMENTARIOS,
    tokenRole: PAPEL_DOS_COMENTARIOS,
    scope: modo === "leitura" ? "mcp:read" : "mcp:write",
  });
  if (!authz.ok) return authz;
  if (modo === "escrita") {
    const teto = await tetoDeEscritaDoToken(authz, "social-comments", requestId);
    if (teto) return { ok: false, response: teto };
  }
  return {
    ok: true,
    db: createAdminClient(),
    org: authz.organizationId,
    requestId,
    quem: { actor: authz.actor, apiTokenId: authz.apiTokenId ?? null, requestId, via: "api" },
  };
}

/** O id do caminho. Sem forma de UUID, a resposta é o mesmo 404 de "não existe". */
export function idDoCaminho(id: string, requestId: string): { id: string } | { response: Response } {
  if (!z.string().uuid().safeParse(id).success) {
    return { response: fail("not_found", "Comentário não encontrado.", 404, { requestId }) };
  }
  return { id };
}

/** Lê o corpo JSON. Corpo vazio vale `{}` (ações sem parâmetro obrigatório). */
export async function corpo<T>(
  req: NextRequest,
  schema: z.ZodType<T>,
  requestId: string,
): Promise<{ dados: T } | { response: Response }> {
  let cru: unknown = {};
  const texto = await req.text();
  if (texto.trim()) {
    try {
      cru = JSON.parse(texto);
    } catch {
      return { response: fail("body_malformed", "O corpo precisa ser JSON válido.", 400, { requestId }) };
    }
  }
  const r = schema.safeParse(cru);
  if (!r.success) {
    return {
      response: fail("validation_error", "Dados inválidos.", 422, {
        requestId,
        details: { fieldErrors: z.flattenError(r.error).fieldErrors },
      }),
    };
  }
  return { dados: r.data };
}
