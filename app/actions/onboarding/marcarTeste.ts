"use server";

/**
 * Server Actions do passo "Ver ele atender".
 *
 * Ninguém é obrigado a testar — mas o wizard precisa saber que a tela foi
 * encarada, senão ela volta para sempre. `respondeu` guarda se o funcionário
 * chegou a responder alguma coisa: é a diferença entre "vi funcionando" e
 * "passei por aqui".
 */
import { seguirNoRoteiro } from "./_seguir";

import { audit } from "@/lib/audit";
import { requireOnboardingCtx, patchOnboardingState } from "./_shared";

export async function marcarTesteFeito(respondeu: boolean): Promise<void> {
  const ctx = await requireOnboardingCtx();
  await patchOnboardingState(ctx.orgId, { teste: { respondeu } });
  await audit({
    action: "onboarding.agente_testado",
    actorUserId: ctx.userId,
    organizationId: ctx.orgId,
    metadata: { respondeu },
  });
  return seguirNoRoteiro(ctx.orgId);
}

export async function pularTeste(): Promise<void> {
  const ctx = await requireOnboardingCtx();
  await patchOnboardingState(ctx.orgId, { teste: { skipped: true } });
  await audit({
    action: "onboarding.agente_teste_pulado",
    actorUserId: ctx.userId,
    organizationId: ctx.orgId,
  });
  return seguirNoRoteiro(ctx.orgId);
}
