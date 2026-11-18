/**
 * /api/v1/ai/equipe-pronta — o perfil do negócio e o estado da Equipe de IA pronta.
 *
 *   GET  → o questionário salvo, o estado (rascunho/instalado), o modo
 *          (ensaio/ativo), como está cada agente, a atualização de papel
 *          disponível e o checklist de prontidão.
 *   PUT  → salva o rascunho do questionário, bloco a bloco.
 *
 * Só no plano que libera a tela `/app/ai/equipe-pronta`: a recusa por plano
 * (403 `fora_do_plano:…`) acontece dentro de `requireRole`, pelo prefixo
 * declarado em `lib/cobranca/rotas-do-plano.ts`.
 *
 * A organização vem da sessão. O corpo do PUT não tem `organization_id`, e o
 * schema é estrito: campo a mais é recusado.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { lerEstadoDaEquipe } from "@/lib/ai/equipe-pronta/estado";
import { portasDoEstadoDeProducao } from "@/lib/ai/equipe-pronta/portas-do-estado";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { salvarPerfilSchema } from "@/lib/schemas/equipe-pronta";
import { createAdminClient } from "@/lib/supabase/admin";
import { respostaDeErro } from "./_erro";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "equipe_pronta" });
  if (!authz.ok) return authz.response;

  try {
    const estado = await lerEstadoDaEquipe(
      getRequestPool(),
      portasDoEstadoDeProducao(createAdminClient()),
      authz.org.orgId,
    );
    return ok(estado, { requestId, headers: { "Cache-Control": "no-store" } });
  } catch (erro) {
    return respostaDeErro(erro, requestId, "ler o estado");
  }
}

export async function PUT(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "equipe_pronta" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = salvarPerfilSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: parsed.error.issues,
    });
  }

  try {
    // Bloco a bloco: o que veio substitui o bloco de mesmo nome; os outros
    // ficam como estavam. A tela salva um passo de cada vez, e um passo não
    // pode apagar os anteriores. `||` do jsonb faz a junção no banco, atômica.
    const { rows } = await getRequestPool().query(
      `insert into equipe_pronta_perfis (organization_id, respostas, updated_by)
       values ($1, $2::jsonb, $3)
       on conflict (organization_id) do update
         set respostas = equipe_pronta_perfis.respostas || excluded.respostas,
             updated_by = excluded.updated_by
       returning respostas, estado, modo`,
      [authz.org.orgId, JSON.stringify(parsed.data.respostas), authz.user.id],
    );

    void audit({
      action: "ai.equipe_pronta_perfil_salvo",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "equipe_pronta_perfis",
      resourceId: authz.org.orgId,
      requestId,
      // Quais blocos mudaram, nunca o conteúdo: as respostas descrevem o
      // negócio do cliente e a trilha de auditoria é append-only.
      metadata: { blocos: Object.keys(parsed.data.respostas).sort() },
    });

    return ok(
      { respostas: rows[0]?.respostas ?? {}, estado: rows[0]?.estado, modo: rows[0]?.modo },
      { requestId },
    );
  } catch (erro) {
    return respostaDeErro(erro, requestId, "salvar o perfil");
  }
}
