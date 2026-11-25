/**
 * GET /api/v1/assistente/conversas/:id — as mensagens e os cartões de uma
 * conversa do PRÓPRIO usuário.
 *
 * Cliente de sessão: a RLS só entrega a conversa ao dono. Conversa de outra
 * pessoa ou de outra empresa responde 404, igual à que não existe.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "assistente" });
  if (!authz.ok) return authz.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Conversa não encontrada.", 404, { requestId });
  }

  const supabase = await createClient();
  const { data: conversa, error } = await supabase
    .from("assistente_conversas")
    .select("id, titulo, modo, created_at")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", authz.user.id)
    .maybeSingle();
  if (error) return fail("internal_error", "Erro ao abrir a conversa.", 500, { requestId });
  if (!conversa) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  const [mensagens, acoes] = await Promise.all([
    supabase
      .from("assistente_mensagens")
      .select("id, turn_id, autor, corpo, created_at")
      .eq("organization_id", authz.org.orgId)
      .eq("conversa_id", id)
      .order("created_at", { ascending: true })
      .limit(200),
    supabase
      .from("assistente_acoes")
      .select("id, nivel, resumo, itens, estado, expira_em, created_at")
      .eq("organization_id", authz.org.orgId)
      .eq("conversa_id", id)
      .order("created_at", { ascending: true })
      .limit(100),
  ]);
  return ok({ conversa, mensagens: mensagens.data ?? [], cartoes: acoes.data ?? [] }, { requestId });
}
