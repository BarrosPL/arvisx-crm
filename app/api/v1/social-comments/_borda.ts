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
 * ─── O idioma das recusas ───────────────────────────────────────────────────
 *
 * A regra escreve as recusas em português, que é a chave do dicionário. Quem
 * chama pela SESSÃO recebe a frase no idioma da própria pessoa (a tela a mostra
 * como veio); quem chama por TOKEN recebe em português, como antes — um sistema
 * externo decide pelo `code`, e não há pessoa de quem tirar o idioma.
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
import { respostaDeRecusa } from "@/lib/api/recusa";
import { ApiError } from "@/lib/api/types";
import { fail } from "@/lib/api/wrappers";
import type { QuemAge } from "@/lib/comentarios/acoes";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { createAdminClient } from "@/lib/supabase/admin";

/** O papel mínimo, na sessão e no token. Igual ao das ferramentas do MCP. */
export const PAPEL_DOS_COMENTARIOS = "manager" as const;

export type Borda =
  | { ok: true; db: SupabaseClient; org: string; quem: QuemAge; requestId: string; idioma: Idioma }
  | { ok: false; response: Response };

/** Sem pessoa (token), a frase fica em português: é a chave, e é o que já saía. */
const IDIOMA_SEM_PESSOA: Idioma = "pt-BR";

/** Onde a frase de uma recusa precisa do pedido e do idioma de quem chamou. */
type Pedido = { requestId: string; idioma?: Idioma };

/**
 * A recusa da regra virando `Response`, com a frase no idioma de quem chamou.
 * O `code` e os `details` não mudam: é por eles que um sistema decide. Erro que
 * não é recusa sobe, como em `respostaDeRecusa`.
 */
export function recusaDosComentarios(erro: unknown, pedido: Pedido): Response {
  const idioma = pedido.idioma ?? IDIOMA_SEM_PESSOA;
  if (erro instanceof ApiError && idioma !== IDIOMA_SEM_PESSOA) {
    return fail(erro.code, traduzir(erro.message, idioma), erro.status, {
      requestId: pedido.requestId,
      details: erro.details,
    });
  }
  return respostaDeRecusa(erro, pedido.requestId);
}

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
    idioma: authz.idioma ?? IDIOMA_SEM_PESSOA,
    quem: { actor: authz.actor, apiTokenId: authz.apiTokenId ?? null, requestId, via: "api" },
  };
}

/** O id do caminho. Sem forma de UUID, a resposta é o mesmo 404 de "não existe". */
export function idDoCaminho(id: string, pedido: Pedido): { id: string } | { response: Response } {
  const { requestId } = pedido;
  const idioma = pedido.idioma ?? IDIOMA_SEM_PESSOA;
  if (!z.string().uuid().safeParse(id).success) {
    return { response: fail("not_found", traduzir("Comentário não encontrado.", idioma), 404, { requestId }) };
  }
  return { id };
}

/** Lê o corpo JSON. Corpo vazio vale `{}` (ações sem parâmetro obrigatório). */
export async function corpo<T>(
  req: NextRequest,
  schema: z.ZodType<T>,
  pedido: Pedido,
): Promise<{ dados: T } | { response: Response }> {
  const { requestId } = pedido;
  const idioma = pedido.idioma ?? IDIOMA_SEM_PESSOA;
  let cru: unknown = {};
  const texto = await req.text();
  if (texto.trim()) {
    try {
      cru = JSON.parse(texto);
    } catch {
      return { response: fail("body_malformed", traduzir("O corpo precisa ser JSON válido.", idioma), 400, { requestId }) };
    }
  }
  const r = schema.safeParse(cru);
  if (!r.success) {
    return {
      response: fail("validation_error", traduzir("Dados inválidos.", idioma), 422, {
        requestId,
        details: { fieldErrors: z.flattenError(r.error).fieldErrors },
      }),
    };
  }
  return { dados: r.data };
}
