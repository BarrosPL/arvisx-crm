import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { loadOnboardingState } from "@/app/actions/onboarding/_shared";
import { proximoPasso } from "@/lib/onboarding/passos";
import { contextoDoOnboarding } from "@/lib/onboarding/contexto";
import { destinoDoRoteador, onboardingGuiadoLigado } from "@/lib/onboarding/guia";

export const dynamic = "force-dynamic";

/**
 * O roteador do wizard. A ORDEM não mora mais aqui: mora em
 * `lib/onboarding/passos.ts`, junto com os rótulos e o resumo final — eram três
 * listas independentes que discordavam, e a divergência aparecia como um passo
 * "Loja" fantasma no indicador de toda instalação pelo kit.
 */
export default async function OnboardingIndex() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  // Sem organização o onboarding não tem o que mostrar — mas mandar para
  // `/login` fechava o círculo: quem entrasse de novo voltaria para cá. A saída
  // é a tela que CRIA a organização que falta.
  if (!activeOrg) redirect("/get-started");

  const { state, onboardedAt } = await loadOnboardingState(activeOrg.orgId);
  if (onboardedAt) redirect("/app/inbox");

  // O contexto inclui o PLANO: sem IA no plano, os passos de IA não existem.
  const contexto = await contextoDoOnboarding(activeOrg.orgId);
  // Roteiro guiado (`ONBOARDING_GUIADO=on`): depois das boas-vindas os passos são
  // feitos dentro do CRM, e o destino é a tela do passo que acabou de ser
  // resolvido. Ver `lib/onboarding/guia.ts`.
  if (onboardingGuiadoLigado()) redirect(destinoDoRoteador(state, contexto));
  const passo = proximoPasso(state, contexto);
  redirect(passo ? `/onboarding/${passo.segmento}` : "/onboarding/done");
}
