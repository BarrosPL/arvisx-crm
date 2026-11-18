/**
 * POST /api/v1/ai/equipe-pronta/pausar — para os quatro agentes da equipe.
 *
 * Só eles: o acesso da IA no canal não muda, e outros agentes do mesmo número
 * seguem atendendo. Nada é apagado: agentes, roteador, base e respostas ficam
 * como estão. Desfaz-se em `POST .../retomar`.
 */
import { randomUUID } from "node:crypto";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { pausarEquipePronta } from "@/lib/ai/equipe-pronta/modo";
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
    const resultado = await pausarEquipePronta(getRequestPool(), {
      orgId: authz.org.orgId,
      userId: authz.user.id,
    });

    void audit({
      action: "ai.equipe_pronta_pausada",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "equipe_pronta_perfis",
      resourceId: authz.org.orgId,
      requestId,
      metadata: { modo: resultado.modo, agentes_pausados: resultado.agentes_pausados },
    });

    return ok(resultado, { requestId });
  } catch (erro) {
    return respostaDeErro(erro, requestId, "pausar");
  }
}
