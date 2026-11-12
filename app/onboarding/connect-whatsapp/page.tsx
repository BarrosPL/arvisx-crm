import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { fontesDoAppDaMeta } from "@/lib/channels/meta/app";
import { metaPodeReceber } from "@/lib/channels/meta/webhook";
import { nomeCurtoDaSessao } from "@/lib/channels/nome-da-sessao";
import { getWahaClient } from "@/lib/waha/client";
import { ConnectWhatsappClient } from "./_client";
import { traduzir } from "@/lib/i18n/dicionario";
import { perfilDoPais } from "@/lib/legal/perfil-do-pais";
import { iaNoPlanoDaOrg } from "@/lib/onboarding/contexto";

export const dynamic = "force-dynamic";

export default async function ConnectWhatsappPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/login");
  const idioma = user.idioma;

  const wahaConfigured = getWahaClient() !== null;
  // Sem IA no plano o número é da EQUIPE, não de um "funcionário".
  const iaNoPlano = await iaNoPlanoDaOrg(activeOrg.orgId);

  // Receber pelo canal oficial exige DOIS segredos, não um — a regra e o porquê
  // moram em `lib/channels/meta/webhook.ts`, ao lado de quem os consome. Agora os
  // dois podem vir do BANCO (`platform_meta_app`, migration 0257) e não só do
  // `.env`: `fontesDoAppDaMeta()` devolve a fonte VENCEDORA, sem misturar as duas
  // — App Secret de um lado com verify token do outro é um app que não existe, e
  // esta tela diria que está tudo pronto.
  const oficialPodeReceber = metaPodeReceber(await fontesDoAppDaMeta());
  // We don't try to start the session at SSR — client kicks off the call
  // (and shows graceful banner if WAHA is not reachable).

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">{traduzir(iaNoPlano ? "Dê um telefone a ele" : "Conecte o seu WhatsApp", idioma)}</h2>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            iaNoPlano
              ? "É por este número que ele vai atender seus clientes. Se você conecta pelo celular, tenha ele por perto."
              : "É por este número que a sua equipe vai atender os clientes. Se você conecta pelo celular, tenha ele por perto.",
            idioma,
          )}
        </p>
      </header>
      <p className="text-sm text-muted-foreground">
        {traduzir("Novos canais começam em modo de teste. Após concluir a configuração, abra Conexões para autorizar seus números de teste ou liberar o público.", idioma)}
      </p>
      <ConnectWhatsappClient
        wahaConfigured={wahaConfigured}
        sessionName={nomeCurtoDaSessao(activeOrg.orgId)}
        oficialPodeReceber={oficialPodeReceber}
        telefoneExemplo={perfilDoPais(activeOrg.country).telefoneExemplo}
        iaNoPlano={iaNoPlano}
      />
    </div>
  );
}
