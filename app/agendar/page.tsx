import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { archivoDaVitrine } from "@/components/landing/fonte";
import { CartaoDaAgenda } from "@/components/landing/CartaoDaAgenda";
import { marcaDaSaida } from "@/lib/branding/saida";
import { LINKS } from "@/lib/landing/links";

import "./agendar.css";

/**
 * /agendar: reunião de 30 minutos com o time Arvisx para quem quer o plano
 * Equipe Completa, o único em que a Arvisx desenvolve agentes sob medida
 * (tarefa 4 dos planos). Na reunião a equipe entende a operação e orienta a
 * assinatura, que é feita no CRM. Página pública de marketing, aberta pela
 * landing (`app/page.tsx`): o botão "Agendar reunião" do card do Equipe Completa
 * e o "Agendar reunião com o time Arvisx" da seção `#agentes`. Os planos
 * Essencial, Standard e Premium não passam por aqui.
 * Visual do protótipo aprovado
 * (docs/arvisx/prototipo/landing/agendar.html); o portão e a agenda do Google
 * ficam em `CartaoDaAgenda`, o endereço da agenda em `lib/landing/links.ts`.
 *
 * Quem tem sessão também pode abrir: é página de venda, não do produto.
 */
export const metadata: Metadata = {
  title: "Arvisx CRM | Equipe Completa: reunião com o time Arvisx",
  description:
    "Reunião de 30 minutos com o time Arvisx para quem quer o plano Equipe Completa: entendemos a sua operação e orientamos a assinatura do plano com agentes de IA sob medida.",
  alternates: { canonical: "https://crm.arvisx.com.br/agendar" },
};

export default async function AgendarPage() {
  // Nome da marca vem do banco (catraca nome-da-marca-nas-telas-vem-do-banco).
  const marca = await marcaDaSaida(null);

  return (
    <div className={`ag ${archivoDaVitrine.variable}`}>
      <header className="topo">
        <Link className="marca" href="/" aria-label={`${marca.nome}, voltar ao início`}>
          <Image
            src="/marca/arvisx-crm-escuro.png"
            alt={marca.nome}
            width={715}
            height={85}
            priority
          />
        </Link>
        <Link className="btn" href="/">
          Voltar ao site
        </Link>
      </header>

      <main className="pagina">
        <div className="miolo">
          <section className="intro" aria-labelledby="titulo">
            <span className="eyebrow">Equipe Completa · Reunião com o time Arvisx</span>
            <h1 id="titulo">Quer agentes de IA feitos para a sua operação?</h1>
            <p className="lead">
              O Equipe Completa é o único plano em que a Arvisx desenvolve agentes de IA sob medida,
              e ele começa por esta conversa de 30 minutos: entendemos a sua operação e orientamos
              como assinar o plano. A assinatura é feita no CRM.
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
                  Esta reunião é para
                </h2>
                <ul>
                  <li>
                    <b>Quem quer o Equipe Completa:</b> o plano com 4 agentes de IA sob medida
                  </li>
                  <li>
                    <b>Entender a sua operação</b> antes de qualquer desenvolvimento
                  </li>
                  <li>
                    <b>Orientar a assinatura</b> do Equipe Completa, feita no CRM
                  </li>
                  <li>
                    <b>Combinar o escopo</b> dos agentes e das integrações do plano
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
                  Não é para
                </h2>
                <ul>
                  <li>
                    <b>Conhecer o CRM ou ver o preço:</b>{" "}
                    <Link href="/">comece o teste grátis de 7 dias</Link>, sem precisar de reunião.
                  </li>
                  <li>
                    <b>Essencial, Standard e Premium:</b> não precisam de reunião nem têm
                    desenvolvimento personalizado. Nesses planos, você configura os seus agentes.
                  </li>
                  <li>
                    <b>Suporte e dúvidas de uso:</b> escreva para{" "}
                    <a href={LINKS.suporte}>suporte@arvisx.com.br</a>.
                  </li>
                </ul>
              </div>
            </div>

            <div className="traga" aria-label="O que trazer para a reunião">
              <div>
                <b>O que resolver</b>O atendimento ou o processo em que os agentes vão atuar.
              </div>
              <div>
                <b>Seus sistemas</b>As ferramentas que a sua empresa já usa.
              </div>
              <div>
                <b>Exemplos reais</b>Uma conversa, uma planilha ou uma tela.
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
          <span>© 2026 Arvisx. Todos os direitos reservados.</span>
          <nav aria-label="Legal">
            <Link href={LINKS.termos}>Termos de Serviço</Link>
            <Link href={LINKS.privacidade}>Política de Privacidade</Link>
            <Link href={LINKS.exclusaoDeDados}>Exclusão de Dados</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
