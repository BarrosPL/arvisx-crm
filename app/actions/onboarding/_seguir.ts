/**
 * PARA ONDE A PESSOA VAI DEPOIS DE RESOLVER UM PASSO.
 *
 * No wizard, toda action termina em `/onboarding`, e o roteador de lá escolhe a
 * próxima página. No roteiro guiado (`ONBOARDING_GUIADO=on`) esse salto NÃO pode
 * existir: `/onboarding` mora sob a casca do wizard (cabeçalho e indicador de
 * passos), e a navegação pelo cliente desenhava essa casca antes de o roteador
 * responder. Medido pela tela em 14/11/2026: a cada passo concluído ou pulado a
 * pessoa via a tela antiga piscar, e no último passo ficava parada nela.
 *
 * Por isso, com o guia ligado, a action já responde com a tela do CRM
 * (`destinoDoRoteador`, a mesma conta do roteador) e manda refazer o layout de
 * `/app`: o painel do guia e o quadro do passo vivem nele, e um `redirect` para
 * dentro do mesmo layout, sozinho, não o refaz.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { contextoDoOnboarding } from "@/lib/onboarding/contexto";
import { destinoDoRoteador, onboardingGuiadoLigado } from "@/lib/onboarding/guia";
import { loadOnboardingState } from "./_shared";

/** Encerra a action: no guia, direto na tela do CRM; no wizard, no roteador. */
export async function seguirNoRoteiro(orgId: string): Promise<never> {
  if (!onboardingGuiadoLigado()) redirect("/onboarding");
  const [{ state }, contexto] = await Promise.all([
    loadOnboardingState(orgId),
    contextoDoOnboarding(orgId),
  ]);
  revalidatePath("/app", "layout");
  redirect(destinoDoRoteador(state, contexto));
}
