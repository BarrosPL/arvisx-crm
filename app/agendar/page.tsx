import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { archivoDaVitrine } from "@/components/landing/fonte";
import { CartaoDaAgenda } from "@/components/landing/CartaoDaAgenda";
import { marcaDaSaida } from "@/lib/branding/saida";
import { LINKS } from "@/lib/landing/links";

import "./agendar.css";

/**
 * /agendar: reunião de 30 minutos com o time Arvisx para quem precisa de uma
 * solução sob medida (Agentes Arvisx). Página pública de marketing, aberta pelo
 * botão "Agendar reunião com o time Arvisx" da landing (`app/page.tsx`).
 * Conteúdo e visual do protótipo aprovado
 * (docs/arvisx/prototipo/landing/agendar.html); o portão e a agenda do Google
 * ficam em `CartaoDaAgenda`, o endereço da agenda em `lib/landing/links.ts`.
 *
 * Quem tem sessão também pode abrir: é página de venda, não do produto.
 */
export const metadata: Metadata = {
  title: "Arvisx CRM | Atendimento especializado",
  description:
    "Reunião com um especialista da Arvisx para empresas que precisam de uma solução sob medida além do que o Arvisx CRM já oferece: agentes de IA, automações e integrações.",
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
            <span className="eyebrow">Agentes Arvisx · Atendimento especializado</span>
            <h1 id="titulo">Precisa de algo que o CRM ainda não faz?</h1>
            <p className="lead">
              Nesta conversa de 30 minutos, um especialista da Arvisx entende o seu processo, onde a
              operação trava e o que falta para a sua empresa. A partir disso, desenhamos com você
              uma solução sob medida.
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
                    <b>Agentes de IA próprios</b> para uma área da sua empresa
                  </li>
                  <li>
                    <b>Automações</b> de um processo que hoje é manual
                  </li>
                  <li>
                    <b>Integrações</b> com os sistemas que você já usa
                  </li>
                  <li>
                    <b>Fluxos específicos</b> do seu negócio que o CRM não cobre
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
                    <b>Suporte e dúvidas de uso:</b> escreva para{" "}
                    <a href={LINKS.suporte}>suporte@arvisx.com.br</a>.
                  </li>
                </ul>
              </div>
            </div>

            <div className="traga" aria-label="O que trazer para a reunião">
              <div>
                <b>O que resolver</b>O processo que você quer automatizar ou melhorar.
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
