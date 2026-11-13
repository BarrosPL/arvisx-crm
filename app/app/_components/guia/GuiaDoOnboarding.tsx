import { TestarClient } from "@/app/onboarding/testar/_client";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { NAV_DESTINATIONS } from "@/lib/navigation/registry";
import { contextoDoOnboarding } from "@/lib/onboarding/contexto";
import { missoesDoGuia } from "@/lib/onboarding/guia";
import type { OnboardingState } from "@/lib/schemas/onboarding";
import { createAdminClient } from "@/lib/supabase/admin";
import { GuiaFlutuante, type MissaoNaTela } from "./GuiaFlutuante";

/**
 * O GUIA DE MONTAGEM — o painel que acompanha a pessoa pelo CRM enquanto a
 * empresa ainda não terminou o onboarding (roteiro guiado, ArvisX).
 *
 * Só é renderizado pelo layout de `/app` quando o roteiro guiado está ligado,
 * as boas-vindas já foram aceitas, `onboarded_at` é nulo e quem olha administra
 * a empresa. A regra do que falta é a do wizard (`lib/onboarding/passos.ts`),
 * lida por `missoesDoGuia`: aqui não há segunda definição de ordem nem de
 * "cumprido".
 *
 * A leitura dos agentes só acontece em dois momentos, que são os únicos em que
 * ela muda o que o guia mostra: no passo do ensaio (precisa do agente e da
 * versão publicada) e no fim (a frase final depende de haver alguém no ar).
 */
export async function GuiaDoOnboarding({
  orgId,
  estado,
  idioma,
}: {
  orgId: string;
  estado: OnboardingState;
  idioma: Idioma;
}) {
  const contexto = await contextoDoOnboarding(orgId);
  // O nome da tela é o do MENU, lido do registro de navegação: o guia manda a
  // pessoa clicar num item, e o nome dito tem de ser o que está escrito nele.
  const rotuloDoMenu = new Map(NAV_DESTINATIONS.map((d) => [d.href as string, d.label]));
  const missoes: MissaoNaTela[] = missoesDoGuia(estado, contexto).map((m) => ({
    ...m,
    rotulo: traduzir(m.rotulo, idioma),
    menu: traduzir(rotuloDoMenu.get(m.href) ?? m.rotulo, idioma),
  }));
  const atual = missoes.find((m) => m.estado === "atual") ?? null;

  let noAr = false;
  let ensaio: React.ReactNode = null;
  if (contexto.iaNoPlano && (!atual || atual.segmento === "testar")) {
    // Cliente de serviço: o filtro por organização é explícito, e o id vem do
    // layout, que o resolveu da sessão.
    const { data } = await createAdminClient()
      .from("ai_agents")
      .select("id, name, published_version_id, is_default")
      .eq("organization_id", orgId)
      .is("archived_at", null);
    const agentes = data ?? [];
    noAr = agentes.some((a) => a.published_version_id !== null);
    if (atual?.segmento === "testar") {
      const padrao = agentes.find((a) => a.is_default) ?? null;
      ensaio = (
        <TestarClient
          nome={(padrao?.name as string | undefined) ?? null}
          agenteId={(padrao?.id as string | undefined) ?? null}
          versaoId={(padrao?.published_version_id as string | null | undefined) ?? null}
        />
      );
    }
  }

  return (
    // A chave é o passo da vez: quando ele muda, o painel remonta e esquece que a
    // pessoa o recolheu — o passo novo tem instrução nova para mostrar.
    <GuiaFlutuante
      key={atual?.segmento ?? "fim"}
      missoes={missoes}
      iaNoPlano={contexto.iaNoPlano}
      noAr={noAr}
      ensaio={ensaio}
    />
  );
}
