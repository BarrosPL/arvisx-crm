/**
 * PATCH /api/v1/admin/assistente/chamados/:id — a equipe da plataforma marca o
 * chamado como VISTO ou RESOLVIDO.
 *
 * Só equipe da plataforma com direito de escrita. O corpo é estrito e só aceita
 * a ação: nada de texto, empresa ou autor. Cada marcação é auditada na empresa
 * dona do chamado, como ato da plataforma.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita, type PlatformAdminContext } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoDoPatch = z.object({ acao: z.enum(["visto", "resolvido"]) }).strict();
const idDoChamado = z.string().uuid();

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  let ctx: PlatformAdminContext;
  try {
    ctx = await requirePlatformAdminEscrita();
  } catch (erro) {
    return falhaDaEscritaDePlatformAdmin(erro, requestId);
  }

  const { id } = await params;
  if (!idDoChamado.safeParse(id).success) return fail("not_found", "Chamado não encontrado.", 404, { requestId });
  const lido = corpoDoPatch.safeParse(await req.json().catch(() => null));
  if (!lido.success) return fail("validation_failed", "Dados inválidos.", 422, { requestId });

  const admin = createAdminClient();
  const { data: chamado, error } = await admin
    .from("assistente_chamados")
    .select("id, organization_id, estado, visto_em")
    .eq("id", id)
    .maybeSingle();
  if (error) return fail("internal_error", "Não foi possível ler o chamado.", 500, { requestId });
  if (!chamado) return fail("not_found", "Chamado não encontrado.", 404, { requestId });

  const agora = new Date().toISOString();
  const quem = ctx.user.id;
  let mudanca: Record<string, string>;
  if (lido.data.acao === "visto") {
    if (chamado.visto_em) return ok({ id, estado: chamado.estado, visto_em: chamado.visto_em }, { requestId });
    mudanca = {
      visto_em: agora,
      visto_por: quem,
      updated_at: agora,
      ...(chamado.estado === "aberto" ? { estado: "em_andamento" } : {}),
    };
  } else {
    if (chamado.estado === "resolvido") return fail("state_conflict", "Este chamado já foi resolvido.", 409, { requestId });
    mudanca = {
      estado: "resolvido",
      resolvido_em: agora,
      resolvido_por: quem,
      updated_at: agora,
      ...(chamado.visto_em ? {} : { visto_em: agora, visto_por: quem }),
    };
  }

  const { error: erroAoGravar } = await admin.from("assistente_chamados").update(mudanca).eq("id", id);
  if (erroAoGravar) return fail("internal_error", "Não foi possível salvar.", 500, { requestId });

  void audit({
    action: lido.data.acao === "visto" ? "assistente.chamado_visto" : "assistente.chamado_resolvido",
    actorUserId: quem,
    actingAsPlatformAdmin: true,
    organizationId: chamado.organization_id,
    resourceType: "assistente_chamado",
    resourceId: id,
    requestId,
    bypassedRls: true,
    metadata: { chamado_id: id, estado_anterior: chamado.estado },
  });

  return ok({ id, estado: mudanca.estado ?? chamado.estado, visto_em: mudanca.visto_em ?? chamado.visto_em }, { requestId });
}
