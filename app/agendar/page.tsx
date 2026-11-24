import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { archivoDaVitrine } from "@/components/landing/fonte";
import { CartaoDaAgenda } from "@/components/landing/CartaoDaAgenda";
import { marcaDaSaida } from "@/lib/branding/saida";
import { traduzir } from "@/lib/i18n/dicionario";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { LINKS } from "@/lib/landing/links";
import { createClient } from "@/lib/supabase/server";

import "./agendar.css";

/**
 * /agendar: reunião de 30 minutos com o time Arvisx para quem quer os Agentes
 * Arvisx, o serviço à parte em que a Arvisx desenvolve agentes de IA sob medida
 * (decisão de 12/11/2026: o plano Equipe Completa saiu da oferta). Na reunião a
 * equipe entende a operação e prepara a proposta; o serviço não depende do
 * Arvisx CRM nem de plano (os agentes se conectam à operação do cliente, no CRM
 * ou em outros sistemas) e não tem preço público. Página pública de marketing, aberta pela
 * landing (`app/page.tsx`): o "Agendar reunião com o time Arvisx" da seção
 * `#agentes`. Assinar um plano (Essencial, Standard ou Premium) não passa por aqui.
 * Visual do protótipo aprovado
 * (docs/arvisx/prototipo/landing/agendar.html); o portão e a agenda do Google
 * ficam em `CartaoDaAgenda`, o endereço da agenda em `lib/landing/links.ts`.
 *
 * Quem tem sessão também pode abrir: é página de venda, não do produto.
 */
export const metadata: Metadata = {
  title: "Arvisx CRM | Agentes Arvisx: reunião com o time Arvisx",
  description:
    "Reunião de 30 minutos com o time Arvisx sobre os Agentes Arvisx: agentes de IA sob medida, contratados à parte do plano. Entendemos a sua operação e preparamos a proposta.",
  alternates: { canonical: "https://crm.arvisx.com.br/agendar" },
};

export default async function AgendarPage() {
  // Nome da marca vem do banco (catraca nome-da-marca-nas-telas-vem-do-banco).
  const marca = await marcaDaSaida(null);
  // Quem tem sessão também abre esta página: vale o idioma salvo no perfil; sem
  // sessão, o do navegador, pela mesma função das outras telas públicas. O
  // provider leva esse idioma ao cartão da agenda, que é componente de cliente.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const locale = await idiomaDoVisitante(
    (user?.user_metadata?.locale as string | undefined) ?? null,
  );
  const t = (texto: string) => traduzir(texto, locale);

  return (
    <IdiomaProvider locale={locale}>
    <div className={`ag ${archivoDaVitrine.variable}`}>
      <header className="topo">
        <Link className="marca" href="/" aria-label={`${marca.nome}, ${t("voltar ao início")}`}>
          <Image
            src="/marca/arvisx-crm-escuro.png"
            alt={marca.nome}
            width={715}
            height={85}
            priority
          />
        </Link>
        <Link className="btn" href="/">
          {t("Voltar ao site")}
        </Link>
      </header>

      <main className="pagina">
        <div className="miolo">
          <section className="intro" aria-labelledby="titulo">
            <span className="eyebrow">{t("Agentes Arvisx · Reunião com o time Arvisx")}</span>
            <h1 id="titulo">{t("Quer agentes de IA feitos para a sua operação?")}</h1>
            <p className="lead">
              {t("Os Agentes Arvisx são um serviço sob medida, contratado à parte do plano, e ele começa por esta conversa de 30 minutos: entendemos a sua operação e preparamos a proposta. Vale para quem já usa o Arvisx CRM, em qualquer plano, e para quem usa outras ferramentas.")}
            </p>
            <div className="fio" aria-hidden="true" />

            <div className="blocos">
              <div className="bloco sim">
                <h2>
                  <span className="sel">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  </span>
                  {t("Esta reunião é para")}
                </h2>
                <ul>
                  <li>
                    <b>{t("Quem quer os Agentes Arvisx (serviço sob medida):")}</b>{" "}{t("agentes de IA desenvolvidos pela nossa equipe")}
                  </li>
                  <li>
                    <b>{t("Entender a sua operação")}</b>{" "}{t("antes de qualquer desenvolvimento")}
                  </li>
                  <li>
                    <b>{t("Preparar a proposta:")}</b>{" "}{t("entender a sua operação e definir o que será desenvolvido")}
                  </li>
                  <li>
                    <b>{t("Combinar o escopo")}</b>{" "}{t("dos agentes e das integrações")}
                  </li>
                </ul>
              </div>
              <div className="bloco nao">
                <h2>
                  <span className="sel">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </span>
                  {t("Não é para")}
                </h2>
                <ul>
                  <li>
                    <b>{t("Conhecer o CRM ou ver o preço:")}</b>{" "}
                    <Link href="/">{t("comece o teste grátis de 7 dias")}</Link>{t(", sem precisar de reunião.")}
                  </li>
                  <li>
                    <b>{t("Assinar o Essencial, o Standard ou o Premium:")}</b>{" "}{t("não precisa de reunião. Nos planos, você configura os seus agentes.")}
                  </li>
                  <li>
                    <b>{t("Suporte e dúvidas de uso:")}</b>{" "}{t("escreva para")}{" "}
                    <a href={LINKS.suporte}>suporte@arvisx.com.br</a>.
                  </li>
                </ul>
              </div>
            </div>

            <div className="traga" aria-label={t("O que trazer para a reunião")}>
              <div>
                <b>{t("O que resolver")}</b>{t("O atendimento ou o processo em que os agentes vão atuar.")}
              </div>
              <div>
                <b>{t("Seus sistemas")}</b>{t("As ferramentas que a sua empresa já usa.")}
              </div>
              <div>
                <b>{t("Exemplos reais")}</b>{t("Uma conversa, uma planilha ou uma tela.")}
              </div>
            </div>
          </section>

          <section className="lado-agenda" aria-labelledby="titulo-agenda">
            <CartaoDaAgenda />
          </section>
        </div>
      </main>

      <footer className="rodape">
        <div className="linha">
          <span>{t("© 2026 Arvisx. Todos os direitos reservados.")}</span>
          <nav aria-label={t("Legal")}>
            <Link href={LINKS.termos}>{t("Termos de Serviço")}</Link>
            <Link href={LINKS.privacidade}>{t("Política de Privacidade")}</Link>
            <Link href={LINKS.exclusaoDeDados}>{t("Exclusão de Dados")}</Link>
          </nav>
        </div>
      </footer>
    </div>
    </IdiomaProvider>
  );
}
