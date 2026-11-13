import type { ReactNode } from "react";

import { loadOnboardingState } from "@/app/actions/onboarding/_shared";
import { dadosDoPasso } from "@/app/actions/onboarding/montarQuadro";
import { ConnectWhatsappClient } from "@/app/onboarding/connect-whatsapp/_client";
import { QuadroClient } from "@/app/onboarding/funil/_client";
import { InviteTeamForm } from "@/app/onboarding/invite-team/_form";
import { SetupAiForm } from "@/app/onboarding/setup-ai/_form";
import { InteligenciaDele } from "@/app/onboarding/setup-ai/_inteligencia";
import { capacidadesPadraoDoOnboarding } from "@/lib/ai/agents/capacidades-padrao";
import { CONFERENCIAS_DE_SAIDA } from "@/lib/ai/guardrails/lista-de-conferencia";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { roleAtLeast } from "@/lib/auth/types";
import { fontesDoAppDaMeta } from "@/lib/channels/meta/app";
import { metaPodeReceber } from "@/lib/channels/meta/webhook";
import { nomeCurtoDaSessao } from "@/lib/channels/nome-da-sessao";
import { emailConfigurado } from "@/lib/email/roteador";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { lerRetratoDaInstalacao } from "@/lib/instalacao/retrato";
import { perfilDoPais } from "@/lib/legal/perfil-do-pais";
import { TOOL_CATALOG } from "@/lib/mcp/tools/catalog";
import { contextoDoOnboarding } from "@/lib/onboarding/contexto";
import { boasVindasFeitas, missaoAtual, onboardingGuiadoLigado } from "@/lib/onboarding/guia";
import { createClient } from "@/lib/supabase/server";
import { getWahaClient } from "@/lib/waha/client";

/** As missões que são feitas num quadro no topo de uma tela do CRM. */
export type SegmentoComBloco = "connect-whatsapp" | "setup-ai" | "funil" | "invite-team";

/**
 * O PASSO DO ROTEIRO, DENTRO DA TELA ONDE ELE MORA (roteiro guiado, ArvisX).
 *
 * Cada tela que hospeda um passo (Conexões, Agentes, Funis, Equipe) põe este
 * componente no topo e diz qual passo é o dela. Ele só desenha quando TUDO isto
 * é verdade: o roteiro guiado está ligado, a empresa ainda não terminou o
 * onboarding, quem olha administra a empresa, e o passo da vez é o desta tela.
 * Em qualquer outro caso devolve `null` e a tela fica exatamente como sempre foi.
 *
 * O formulário é o do wizard, importado — nenhuma cópia. A action dele grava o
 * passo e redireciona para `/onboarding`, e o roteador devolve a pessoa a esta
 * mesma tela, já sem o quadro e com o resultado na lista de baixo.
 *
 * Com o roteiro desligado, a primeira linha devolve `null` antes de qualquer
 * consulta: instalação que não usa o guia não paga nada por ele.
 */
export async function BlocoDoGuia({ segmento }: { segmento: SegmentoComBloco }) {
  if (!onboardingGuiadoLigado()) return null;

  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || user.support || !roleAtLeast(activeOrg.role, "admin")) return null;

  const { state, onboardedAt } = await loadOnboardingState(activeOrg.orgId);
  if (onboardedAt || !boasVindasFeitas(state)) return null;

  const contexto = await contextoDoOnboarding(activeOrg.orgId);
  if (missaoAtual(state, contexto)?.segmento !== segmento) return null;

  const idioma = user.idioma;
  const iaNoPlano = contexto.iaNoPlano;

  if (segmento === "connect-whatsapp") {
    const oficialPodeReceber = metaPodeReceber(await fontesDoAppDaMeta());
    return (
      <Moldura
        idioma={idioma}
        titulo={traduzir(iaNoPlano ? "Dê um telefone a ele" : "Conecte o seu WhatsApp", idioma)}
        descricao={traduzir(
          iaNoPlano
            ? "É por este número que ele vai atender seus clientes. Se você conecta pelo celular, tenha ele por perto."
            : "É por este número que a sua equipe vai atender os clientes. Se você conecta pelo celular, tenha ele por perto.",
          idioma,
        )}
      >
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Novos canais começam em modo de teste. Após concluir a configuração, abra Conexões para autorizar seus números de teste ou liberar o público.",
            idioma,
          )}
        </p>
        <ConnectWhatsappClient
          wahaConfigured={getWahaClient() !== null}
          sessionName={nomeCurtoDaSessao(activeOrg.orgId)}
          oficialPodeReceber={oficialPodeReceber}
          telefoneExemplo={perfilDoPais(activeOrg.country).telefoneExemplo}
          iaNoPlano={iaNoPlano}
        />
      </Moldura>
    );
  }

  if (segmento === "setup-ai") {
    const supabase = await createClient();
    const retrato = await lerRetratoDaInstalacao({ supabase, orgId: activeOrg.orgId });
    // As duas listas saem das MESMAS fontes que o runtime usa — ver o cabeçalho
    // de `app/onboarding/setup-ai/page.tsx`.
    const porNome = new Map(TOOL_CATALOG.map((c) => [c.name, c]));
    const capacidades = capacidadesPadraoDoOnboarding()
      .map((id) => porNome.get(id)?.rotulo)
      .filter((r): r is string => Boolean(r))
      .map((r) => traduzir(r, idioma));
    const conferencias = CONFERENCIAS_DE_SAIDA.map((c) => traduzir(c.rotulo, idioma));
    return (
      <Moldura
        idioma={idioma}
        titulo={traduzir("Treine seu funcionário", idioma)}
        descricao={traduzir("Quem ele é, como fala e o que pode prometer. Dá para mudar tudo depois.", idioma)}
      >
        <InteligenciaDele
          inicial={{
            origem: retrato.inteligencia.origemDaChave,
            provedor: retrato.inteligencia.provedor,
            rotulo: retrato.inteligencia.rotulo,
            final: retrato.inteligencia.chaveDaOrg?.final ?? null,
          }}
        />
        <SetupAiForm capacidades={capacidades} conferencias={conferencias} />
      </Moldura>
    );
  }

  if (segmento === "funil") {
    // A sugestão é pedida no render, como no wizard: a pessoa chega com a
    // proposta já na tela. Só acontece enquanto o passo da vez é este.
    const { atual, sugestao } = await dadosDoPasso(activeOrg.orgId, activeOrg.name);
    return (
      <Moldura
        idioma={idioma}
        titulo={traduzir(iaNoPlano ? "Onde ele organiza seus clientes" : "Seu funil de clientes", idioma)}
        descricao={traduzir(
          iaNoPlano
            ? "Cada cliente vira um cartão que anda por essas colunas. Ele mesmo move o cartão conforme a conversa avança — por isso cada coluna diz também quando ele deve usá-la."
            : "Cada cliente vira um cartão que anda por essas colunas. Você e a equipe movem o cartão conforme a conversa avança.",
          idioma,
        )}
      >
        <QuadroClient atual={atual} sugestao={sugestao} iaNoPlano={iaNoPlano} />
      </Moldura>
    );
  }

  const emailReady = await emailConfigurado();
  return (
    <Moldura
      idioma={idioma}
      titulo={traduzir(iaNoPlano ? "Quem trabalha com ele" : "Sua equipe", idioma)}
      descricao={traduzir(
        iaNoPlano
          ? "Seu funcionário não trabalha sozinho: quando ele passar uma conversa adiante, é uma dessas pessoas que atende."
          : "Quem vai atender as conversas com você.",
        idioma,
      )}
    >
      {!emailReady ? (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="font-medium">{traduzir("Esta instalação ainda não envia e-mail.", idioma)}</p>
          <p className="mt-1">
            {traduzir(
              "Você recebe um link para cada pessoa e manda por onde quiser — WhatsApp, e-mail, o que preferir. O link é o convite: quem abrir entra na sua empresa.",
              idioma,
            )}
          </p>
        </div>
      ) : null}
      <InviteTeamForm iaNoPlano={iaNoPlano} />
    </Moldura>
  );
}

/**
 * O quadro do passo. O contorno na cor de ação é o que o guia chama de "o quadro
 * em destaque": é por ele que a pessoa reconhece, na tela cheia de coisas, onde
 * está o que ela veio fazer.
 */
function Moldura({
  idioma,
  titulo,
  descricao,
  children,
}: {
  idioma: Idioma;
  /** Já no idioma de quem lê: quem chama traduz, com o texto literal à vista. */
  titulo: string;
  descricao: string;
  children: ReactNode;
}) {
  return (
    <section
      data-bloco-do-guia
      aria-label={traduzir("Guia de montagem", idioma)}
      className="space-y-4 rounded-lg border-2 border-[var(--color-cta)] bg-surface p-4 shadow-sm sm:p-6"
    >
      <header>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {traduzir("Guia de montagem", idioma)}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{titulo}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
      </header>
      {children}
    </section>
  );
}
