/**
 * GET /api/v1/assistente/conversas — as conversas do PRÓPRIO usuário com o Vix.
 *
 * Lidas com o cliente de sessão: a RLS de `assistente_conversas` só entrega a
 * quem é o dono, na própria organização. O filtro explícito repete a regra.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "assistente" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assistente_conversas")
    .select("id, titulo, modo, updated_at, created_at")
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", authz.user.id)
    .is("arquivada_em", null)
    .order("updated_at", { ascending: false })
    .limit(30);
  if (error) return fail("internal_error", "Erro ao listar as conversas.", 500, { requestId });
  return ok({ conversas: data ?? [] }, { requestId });
}
