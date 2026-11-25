/**
 * PATCH /api/v1/assistente/configuracao — o administrador da EMPRESA liga ou
 * desliga o Vix para a empresa dele.
 *
 * Só o campo `ligado`. A marca `isenta` da mesma tabela é da PLATAFORMA e
 * não passa por aqui: o schema é estrito e a gravação nomeia as colunas.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { auditarVix } from "@/lib/assistente/servidor";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoDoPatch = z.object({ ligado: z.boolean() }).strict();

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "assistente" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const t = (texto: string) => traduzir(texto, user.idioma);

  const lido = corpoDoPatch.safeParse(await req.json().catch(() => null));
  if (!lido.success) return fail("validation_failed", t("Dados inválidos."), 422, { requestId });

  const admin = createAdminClient();
  // Atualiza se a linha existe (preserva a marca da plataforma); senão, cria só com `ligado`.
  const { data: atualizadas, error: erroAoAtualizar } = await admin
    .from("assistente_estado_da_empresa")
    .update({ ligado: lido.data.ligado, atualizado_por: user.id, updated_at: new Date().toISOString() })
    .eq("organization_id", org.orgId)
    .select("organization_id");
  if (erroAoAtualizar) return fail("internal_error", t("Não foi possível salvar."), 500, { requestId });
  if (!atualizadas || atualizadas.length === 0) {
    const { error } = await admin
      .from("assistente_estado_da_empresa")
      .insert({ organization_id: org.orgId, ligado: lido.data.ligado, atualizado_por: user.id });
    if (error) return fail("internal_error", t("Não foi possível salvar."), 500, { requestId });
  }

  auditarVix("assistente.configuracao_alterada", { orgId: org.orgId, userId: user.id, requestId }, {
    metadata: { ligado: lido.data.ligado },
  });
  return ok({ ligado: lido.data.ligado }, { requestId });
}
