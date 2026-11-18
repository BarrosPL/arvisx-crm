/**
 * POST /api/v1/ai/equipe-pronta/retomar — desfaz a pausa da equipe.
 *
 * Religa só os agentes que a pausa parou. O modo (ensaio ou ativo) e o acesso
 * da IA no canal ficam como estavam.
 */
import { randomUUID } from "node:crypto";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { retomarEquipePronta } from "@/lib/ai/equipe-pronta/modo";
import { ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { respostaDeErro } from "../_erro";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "equipe_pronta" });
  if (!authz.ok) return authz.response;

  try {
    const resultado = await retomarEquipePronta(getRequestPool(), {
      orgId: authz.org.orgId,
      userId: authz.user.id,
    });

    void audit({
      action: "ai.equipe_pronta_retomada",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "equipe_pronta_perfis",
      resourceId: authz.org.orgId,
      requestId,
      metadata: { modo: resultado.modo, agentes_religados: resultado.agentes_religados },
    });

    return ok(resultado, { requestId });
  } catch (erro) {
    return respostaDeErro(erro, requestId, "retomar");
  }
}
