/**
 * POST /api/v1/ai/equipe-pronta/instalar — instala (ou reaplica) a equipe.
 *
 * Idempotente: rodar duas vezes não duplica nada (`lib/ai/equipe-pronta/instalar.ts`).
 *
 * Papel `admin`, como as rotas que criam e publicam agente: a instalação cria
 * agentes, roteador e muda o acesso da IA no canal.
 *
 * Agente que o cliente editou à mão não é sobrescrito: a rota responde 409
 * `equipe_pronta_agentes_editados_a_mao` com a lista, e NADA é gravado. A tela
 * pede confirmação e repete com `forcar: true`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { instalarEquipePronta } from "@/lib/ai/equipe-pronta/instalar";
import { portasDeProducao } from "@/lib/ai/equipe-pronta/portas";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { instalarSchema } from "@/lib/schemas/equipe-pronta";
import { createAdminClient } from "@/lib/supabase/admin";
import { respostaDeErro } from "../_erro";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "equipe_pronta" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  // Corpo vazio é aceito: instalar sem `forcar` é o caso comum.
  const parsed = instalarSchema.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: parsed.error.issues,
    });
  }

  try {
    const resultado = await instalarEquipePronta(
      getRequestPool(),
      portasDeProducao(createAdminClient()),
      { orgId: authz.org.orgId, userId: authz.user.id },
      { forcar: parsed.data.forcar },
    );

    void audit({
      action: "ai.equipe_pronta_instalada",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "equipe_pronta_perfis",
      resourceId: authz.org.orgId,
      requestId,
      metadata: {
        forcar: parsed.data.forcar,
        criados: resultado.criados,
        agentes: resultado.agentes.map((a) => ({
          papel: a.papel,
          agent_id: a.agent_id,
          acao: a.acao,
          publicado: a.publicado,
        })),
        router_id: resultado.instalacao.router_id,
        channel_session_id: resultado.instalacao.channel_session_id,
      },
    });

    return ok(resultado, { requestId, headers: { "Cache-Control": "no-store" } });
  } catch (erro) {
    return respostaDeErro(erro, requestId, "instalar");
  }
}
