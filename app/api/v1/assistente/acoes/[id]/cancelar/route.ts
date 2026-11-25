/**
 * POST /api/v1/assistente/acoes/:id/cancelar — o usuário descarta um cartão.
 *
 * Só o dono, na própria organização, e só enquanto o cartão está `proposta`.
 * Uma instrução condicional: cartão de outra pessoa, de outra empresa ou já
 * usado não muda, e a resposta é a mesma 409.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { FRASES_DA_CONFIRMACAO } from "@/lib/assistente/frases";
import { auditarVix } from "@/lib/assistente/servidor";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "assistente_acoes" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const t = (texto: string) => traduzir(texto, user.idioma);

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("validation_failed", t("Dados inválidos."), 422, { requestId });
  }

  const { data, error } = await createAdminClient()
    .from("assistente_acoes")
    .update({ estado: "cancelada" })
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .eq("user_id", user.id)
    .eq("estado", "proposta")
    .select("id");
  if (error) return fail("internal_error", t(FRASES_DA_CONFIRMACAO.falhou), 500, { requestId });
  if (!data || data.length === 0) {
    return fail("assistente_acao_indisponivel", t(FRASES_DA_CONFIRMACAO.indisponivel), 409, { requestId });
  }

  auditarVix("assistente.acao_cancelada", { orgId: org.orgId, userId: user.id, requestId }, {
    recursoTipo: "assistente_acao",
    recursoId: id,
  });
  return ok({ id, estado: "cancelada" }, { requestId });
}
