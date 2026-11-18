/**
 * POST /api/v1/ai/equipe-pronta/ativar — abre o canal para todos.
 *
 * Só com o checklist inteiro verde. A conferência é refeita aqui, no servidor,
 * na hora de ativar (`ativarEquipePronta`): com item pendente a resposta é 409
 * `equipe_pronta_checklist_pendente`, com a lista do que falta.
 */
import { randomUUID } from "node:crypto";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { ativarEquipePronta } from "@/lib/ai/equipe-pronta/modo";
import { portasDoEstadoDeProducao } from "@/lib/ai/equipe-pronta/portas-do-estado";
import { ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { respostaDeErro } from "../_erro";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "equipe_pronta" });
  if (!authz.ok) return authz.response;

  try {
    const admin = createAdminClient();
    const resultado = await ativarEquipePronta(
      getRequestPool(),
      admin,
      portasDoEstadoDeProducao(admin),
      { orgId: authz.org.orgId, userId: authz.user.id },
    );

    void audit({
      action: "ai.equipe_pronta_ativada",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "equipe_pronta_perfis",
      resourceId: authz.org.orgId,
      requestId,
      metadata: { channel_session_id: resultado.channel_session_id },
    });

    return ok(resultado, { requestId });
  } catch (erro) {
    return respostaDeErro(erro, requestId, "ativar");
  }
}
