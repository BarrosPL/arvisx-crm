/**
 * PATCH /api/v1/admin/cobranca/equipe-completa/[id] — a equipe marca que já
 * falou com a empresa que assinou (ou deixou) o Equipe Completa (ArvisX,
 * migration 9804). A linha sai da lista "aguardando contato" de
 * /admin/cobranca e a mensagem "nossa equipe entrará em contato" some da tela
 * de assinatura do cliente.
 *
 * Escrita de platform admin (scope full + MFA); 404 com a chave `cobranca`
 * desligada. Marcar de novo não muda a data do primeiro contato.
 */
import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  falhaDaEscritaDePlatformAdmin,
  requirePlatformAdminEscrita,
  type PlatformAdminContext,
} from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

const corpoSchema = z.strictObject({ contatado: z.literal(true) });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();

  let adminCtx: PlatformAdminContext;
  try {
    adminCtx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  const admin = createAdminClient();
  const { id } = await params;
  if (!(await moduloLigado(admin, "cobranca")) || !z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Aviso não encontrado", 404, { requestId });
  }
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) {
    return fail("validation_failed", "Corpo inválido", 400, { requestId, details: corpo.error.flatten() });
  }

  const agora = new Date().toISOString();
  const { data: marcada, error } = await admin
    .from("cobranca_equipe_completa")
    .update({ contatado_em: agora, contatado_por: adminCtx.user.id })
    .eq("id", id)
    .is("contatado_em", null)
    .select("id, organization_id, tipo, contatado_em")
    .maybeSingle();
  if (error) return fail("internal_error", "Não foi possível marcar o contato", 500, { requestId });
  if (!marcada) {
    const { data: existe, error: erroDeLeitura } = await admin
      .from("cobranca_equipe_completa")
      .select("id, organization_id, tipo, contatado_em")
      .eq("id", id)
      .maybeSingle();
    if (erroDeLeitura) return fail("internal_error", "Não foi possível ler o aviso", 500, { requestId });
    if (!existe) return fail("not_found", "Aviso não encontrado", 404, { requestId });
    return ok(existe, { requestId });
  }

  void audit({
    action: "cobranca.equipe_completa_contatada",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: marcada.organization_id,
    resourceType: "cobranca_equipe_completa",
    resourceId: marcada.id,
    requestId,
    metadata: { tipo: marcada.tipo },
  });
  return ok(marcada, { requestId });
}
