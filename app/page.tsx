import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";

import { AvisoDeCookies } from "@/components/landing/AvisoDeCookies";
import { LINK_CTA } from "@/lib/landing/links";
import { createClient } from "@/lib/supabase/server";

import "./landing.css";

/**
 * A página inicial pública: a vitrine do Arvisx CRM em crm.arvisx.com.br.
 *
 * Quem tem sessão segue direto para o painel, como sempre foi. Quem não tem vê
 * a landing aprovada no protótipo (docs/arvisx/prototipo/landing/): a promessa,
 * o CRM com capturas, os serviços do agente de IA, como funciona, para quem é e
 * as perguntas frequentes. O botão "Entrar" leva ao login; "Agendar
 * demonstração" aponta para `LINK_CTA`, ainda sem destino definido.
 *
 * A página é da Arvisx, não da marca da instalação: o texto e o logo são os do
 * produto de propósito, porque este endereço é o da Arvisx. Os documentos
 * legais próprios desta vitrine vivem em /termos-de-uso e
 * /privacidade-e-cookies; os do app (`/legal/terms` e `/legal/privacy`, com a
 * seção exigida pela verificação do Google) seguem onde estavam.
 *
 * `/` já é caminho público no `proxy` (`lib/auth/public-paths.ts`).
 * `getUser()` e nunca `getSession()`: o redirecionamento só vale para sessão
 * que o servidor de autenticação confirmou.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Arvisx CRM | O CRM com agentes de IA para quem vende pelo WhatsApp",
  description:
    "O WhatsApp chega. A IA atende e vende. Seu CRM organiza tudo. Um CRM configurado pela Arvisx para assessorias, escritórios e consultorias, com agentes de IA que atendem, qualificam e acompanham seus leads.",
  alternates: { canonical: "https://crm.arvisx.com.br/" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: "https://crm.arvisx.com.br/",
    title: "Arvisx CRM | O CRM com agentes de IA para quem vende pelo WhatsApp",
    description: "O WhatsApp chega. A IA atende e vende. Seu CRM organiza tudo.",
    images: [{ url: "https://crm.arvisx.com.br/og-arvisx.jpg", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
};

/** Atraso da animação de entrada, lido pelo CSS em `--d`. */
function atraso(segundos: string): CSSProperties {
  return { "--d": segundos } as CSSProperties;
}

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/app");

  return (
    <div className="lp">
      <header className="topo">
        <a className="marca" href="#inicio" aria-label="Arvisx CRM, início">
          <Image src="/marca/arvisx-crm-escuro.png" alt="Arvisx CRM" width={715} height={85} />
        </a>
        <nav aria-label="Principal">
          <a href="#crm">O CRM</a>
          <a href="#agentes">Agentes de IA</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#faq">Perguntas</a>
        </nav>
        <div className="acoes">
          <a className="btn secundario p" href="/login">
            Entrar
          </a>
          <a className="btn primario p demo" href={LINK_CTA}>
            Agendar demonstração
          </a>
        </div>
      </header>

      <main id="inicio">
        <section className="hero">
          <div className="miolo">
            <div>
              <p className="eyebrow entra">CRM com agentes de IA</p>
              <h1 className="entra" style={atraso(".08s")}>
                O WhatsApp chega. A IA atende e vende. <em>Seu CRM organiza tudo.</em>
              </h1>
              <p className="sub entra" style={atraso(".18s")}>
                Para assessorias, escritórios e consultorias que vendem pelo WhatsApp. A Arvisx
                configura o CRM para o seu negócio e cuida dos agentes de IA por você.
              </p>
              <div className="acoes entra" style={atraso(".28s")}>
                <a className="btn primario" href={LINK_CTA}>
                  Agendar demonstração
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </a>
                <a className="btn secundario" href="/login">
                  Já sou cliente
                </a>
              </div>
              <p className="nota entra" style={atraso(".38s")}>
                Mensalidade com a configuração inclusa. Sem taxa de setup.
              </p>
            </div>
            <div className="vitrine">
              <figure className="janela">
                <div className="barra" aria-hidden="true">
                  <i></i>
                  <i></i>
                  <i></i>
                  <span>crm.arvisx.com.br</span>
                </div>
                <Image
                  priority
                  src="/img/crm-funil.png"
                  alt="Funil do Arvisx CRM com as etapas de um serviço de cidadania: contrato assinado, documentação, tradução e apostila, protocolo"
                  width={1440}
                  height={900}
                />
              </figure>
              <div className="conversa" aria-hidden="true">
                <div className="msg lead">
                  <div className="miolo-msg">
                    Oi! Quero saber sobre cidadania italiana. Como funciona?
                  </div>
                </div>
                <div className="msg digitando">
                  <div className="miolo-msg">
                    <i></i>
                    <i></i>
                    <i></i>
                  </div>
                </div>
                <div className="msg ia">
                  <div className="miolo-msg">
                    <b>Agente de IA</b>Oi, Marina! Que bom. Me conta de quem é o sobrenome italiano
                    na família, para eu entender o seu caso?
                  </div>
                </div>
                <div className="msg toast">
                  <div className="miolo-msg">
                    <i>&#10003;</i>
                    <span>
                      Lead criado no funil <em>Cidadania Italiana &middot; Primeiro contato</em>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="faixa dor">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">A dor</p>
              <h2>Hoje a venda está espalhada em três lugares.</h2>
            </div>
            <div className="grade">
              <article className="cartao">
                <span className="ic">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 20l1.5-4.5A8 8 0 1 1 8.5 18.5z" />
                  </svg>
                </span>
                <h3>O WhatsApp</h3>
                <p>
                  As conversas chegam a qualquer hora. Quem respondeu, quem ficou sem resposta e
                  quem já fechou se misturam na mesma lista.
                </p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="M3 10h18M9 4v16" />
                  </svg>
                </span>
                <h3>A planilha</h3>
                <p>
                  O controle vive numa planilha que só uma pessoa entende. Quando ela sai de férias,
                  ninguém sabe em que pé está cada cliente.
                </p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                    <path d="M14 3v6h6M8 13h8M8 17h5" />
                  </svg>
                </span>
                <h3>A proposta</h3>
                <p>
                  Cada proposta é montada do zero, num arquivo solto. Enviar, lembrar o cliente e
                  saber se ele abriu vira trabalho manual.
                </p>
              </article>
            </div>
            <p className="virada">
              O Arvisx CRM junta os três num lugar só.{" "}
              <strong>E põe um agente de IA para atender, organizar e acompanhar cada lead</strong>,
              enquanto a sua equipe cuida do que só gente resolve.
            </p>
          </div>
        </section>

        <section className="faixa painel crm" id="crm">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">O CRM</p>
              <h2>A empresa inteira em uma tela, do primeiro contato ao faturamento.</h2>
              <p>
                Um produto só, com as mesmas telas para todos, configurado pela Arvisx para o jeito
                que a sua empresa trabalha.
              </p>
            </div>
            <ul className="modulos" aria-label="Módulos do CRM">
              <li>Inbox</li>
              <li>Agenda</li>
              <li>Funis</li>
              <li>Contatos</li>
              <li>Tarefas</li>
              <li>Produtos</li>
              <li>Propostas</li>
              <li>Importações</li>
              <li>Faturamento</li>
              <li>Honorários</li>
              <li>Comandas</li>
              <li>Desempenho</li>
              <li>Atividades</li>
              <li>Equipe</li>
            </ul>
            <div className="telas">
              <article className="tela">
                <div className="texto">
                  <h3>Funis feitos para serviço</h3>
                  <p>
                    Cada serviço tem o seu caminho. Um funil de cidadania italiana, por exemplo,
                    segue as etapas reais do processo.
                  </p>
                  <ul>
                    <li>Contrato assinado</li>
                    <li>Documentação</li>
                    <li>Tradução e apostila</li>
                    <li>Protocolo</li>
                  </ul>
                </div>
                <figure className="janela">
                  <div className="barra" aria-hidden="true">
                    <i></i>
                    <i></i>
                    <i></i>
                    <span>Funis</span>
                  </div>
                  <Image
                    src="/img/crm-funil.png"
                    alt="Quadro do funil com as etapas do serviço e os cartões de cada cliente"
                    width={1440}
                    height={900}
                  />
                </figure>
              </article>
              <article className="tela inv">
                <div className="texto">
                  <h3>O cartão do lead com o que importa para o seu serviço</h3>
                  <p>
                    Campos personalizados por funil, documentos anexados e os dados do contato no
                    mesmo cartão.
                  </p>
                  <ul>
                    <li>País, ancestral e data do contrato</li>
                    <li>Valor e status dos documentos</li>
                    <li>Upload de documentos do cliente</li>
                  </ul>
                </div>
                <figure className="janela">
                  <div className="barra" aria-hidden="true">
                    <i></i>
                    <i></i>
                    <i></i>
                    <span>Cartão do lead</span>
                  </div>
                  <Image
                    src="/img/crm-cartao-lead.png"
                    alt="Cartão do lead com campos personalizados, documentos e dados do contato"
                    width={1440}
                    height={900}
                  />
                </figure>
              </article>
            </div>
            <div className="menor">
              <figure>
                <div className="janela">
                  <div className="barra" aria-hidden="true">
                    <i></i>
                    <i></i>
                    <i></i>
                    <span>Contatos</span>
                  </div>
                  <Image
                    src="/img/crm-contatos.png"
                    alt="Lista de contatos com etiquetas e responsável"
                    width={1440}
                    height={900}
                  />
                </div>
                <figcaption>
                  <b>Contatos</b>
                  <span>
                    Todo mundo que já falou com você, com histórico, etiquetas e responsável.
                  </span>
                </figcaption>
              </figure>
              <figure>
                <div className="janela">
                  <div className="barra" aria-hidden="true">
                    <i></i>
                    <i></i>
                    <i></i>
                    <span>Agenda</span>
                  </div>
                  <Image
                    src="/img/crm-agenda.png"
                    alt="Agenda da equipe com as reuniões da semana"
                    width={1440}
                    height={900}
                  />
                </div>
                <figcaption>
                  <b>Agenda</b>
                  <span>As reuniões da equipe no mesmo lugar em que a conversa aconteceu.</span>
                </figcaption>
              </figure>
              <figure>
                <div className="janela">
                  <div className="barra" aria-hidden="true">
                    <i></i>
                    <i></i>
                    <i></i>
                    <span>Faturamento</span>
                  </div>
                  <Image
                    src="/img/crm-financeiro.png"
                    alt="Tela de faturamento com honorários e comandas"
                    width={1440}
                    height={900}
                  />
                </div>
                <figcaption>
                  <b>Faturamento, honorários e comandas</b>
                  <span>Acompanhe o que foi fechado e o que falta receber, sem sair do CRM.</span>
                </figcaption>
              </figure>
              <div className="cartao equipe">
                <span className="ic">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="9" cy="8" r="3.5" />
                    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4.5-6.2" />
                  </svg>
                </span>
                <h3>Equipe com acesso próprio</h3>
                <p>
                  Cada pessoa entra com o seu login e vê um menu enxuto, só com o que usa. Sem telas
                  técnicas, sem configuração para aprender.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="faixa cuidado">
          <div className="miolo">
            <div>
              <p className="eyebrow">A IA fica com a Arvisx</p>
              <h2>Você não precisa montar IA. A gente entrega pronta e cuida.</h2>
              <p>
                As telas de IA, automações e integrações não aparecem para a sua equipe. A Arvisx
                configura e opera os agentes por você, e ajusta quando o seu negócio muda.
              </p>
            </div>
            <ul>
              <li>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Agentes configurados para o seu serviço, o seu tom e as suas regras.
              </li>
              <li>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Acompanhamento contínuo: a gente lê as conversas e afina o agente.
              </li>
              <li>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Sua equipe só usa o CRM. Nada de prompt, webhook ou integração para mexer.
              </li>
            </ul>
          </div>
        </section>

        <section className="faixa agentes" id="agentes">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">Serviços do agente de IA</p>
              <h2>O que o agente faz pelo seu time, parametrizado para o seu negócio.</h2>
              <p>
                Cada serviço é ajustado ao que você vende, a quem você atende e ao jeito que a sua
                equipe trabalha.
              </p>
            </div>
            <div className="grade">
              <article className="cartao">
                <div className="topo-c">
                  <span className="ic">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M4 20l1.5-4.5A8 8 0 1 1 8.5 18.5z" />
                    </svg>
                  </span>
                  <span className="n">01</span>
                </div>
                <h3>Atendimento e qualificação no WhatsApp</h3>
                <p>
                  A qualquer hora, em português e com tom natural. O agente descobre o interesse do
                  lead e filtra spam e ofensa.
                </p>
              </article>
              <article className="cartao">
                <div className="topo-c">
                  <span className="ic">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 7h-9M14 17H5" />
                      <circle cx="17" cy="17" r="3" />
                      <circle cx="7" cy="7" r="3" />
                    </svg>
                  </span>
                  <span className="n">02</span>
                </div>
                <h3>Registro e organização no funil</h3>
                <p>
                  Grava o interesse, cria o lead na etapa certa e aplica etiquetas por serviço e
                  país.
                </p>
              </article>
              <article className="cartao">
                <div className="topo-c">
                  <span className="ic">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                      <path d="M14 3v6h6M8 13h8M8 17h5" />
                    </svg>
                  </span>
                  <span className="n">03</span>
                </div>
                <h3>Proposta comercial</h3>
                <p>
                  Monta a proposta, envia o link ao cliente, move o lead no funil e avisa a equipe.
                </p>
              </article>
              <article className="cartao">
                <div className="topo-c">
                  <span className="ic">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="5" width="18" height="16" rx="2" />
                      <path d="M3 10h18M8 3v4M16 3v4" />
                    </svg>
                  </span>
                  <span className="n">04</span>
                </div>
                <h3>Agendamento de reunião</h3>
                <p>
                  Marca no Google Agenda com link do Meet e usa a ata da reunião para montar a
                  proposta.
                </p>
              </article>
              <article className="cartao">
                <div className="topo-c">
                  <span className="ic">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M9 12l2 2 4-4" />
                      <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" />
                    </svg>
                  </span>
                  <span className="n">05</span>
                </div>
                <h3>Contrato com aprovação humana</h3>
                <p>
                  Prepara o contrato preenchido e mostra para a equipe. Só envia depois do "ok" de
                  uma pessoa.
                </p>
              </article>
              <article className="cartao">
                <div className="topo-c">
                  <span className="ic">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                  </span>
                  <span className="n">06</span>
                </div>
                <h3>Acompanhamento</h3>
                <p>
                  Follow-up, retomada, nutrição e reativação de quem sumiu, respeitando a janela de
                  24 h do WhatsApp.
                </p>
              </article>
              <article className="cartao">
                <div className="topo-c">
                  <span className="ic">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="9" cy="8" r="3.5" />
                      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4.5-6.2" />
                    </svg>
                  </span>
                  <span className="n">07</span>
                </div>
                <h3>Convivência com a equipe</h3>
                <p>
                  Quando alguém do time assume a conversa, o agente para. Dúvidas e ações sensíveis
                  passam pela equipe.
                </p>
              </article>
              <article className="cartao">
                <div className="topo-c">
                  <span className="ic">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
                    </svg>
                  </span>
                  <span className="n">08</span>
                </div>
                <h3>Gestão</h3>
                <p>
                  Resumo diário e relatório semanal para quem gerencia, e distribuição dos leads
                  entre os vendedores.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="faixa painel como" id="como-funciona">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">Como funciona</p>
              <h2>Três passos, e o seu time já está usando.</h2>
            </div>
            <div className="passos">
              <article className="cartao passo">
                <h3>Conversamos</h3>
                <p>
                  Você nos conta o que vende, como atende e o que trava hoje. A gente mostra o CRM
                  com o seu cenário.
                </p>
              </article>
              <article className="cartao passo">
                <h3>Configuramos para você</h3>
                <p>
                  Funis, campos, equipe, propostas e os agentes de IA, do jeito que o seu negócio
                  funciona.
                </p>
              </article>
              <article className="cartao passo">
                <h3>Você usa, nós operamos a IA</h3>
                <p>
                  Sua equipe entra e trabalha. A Arvisx acompanha os agentes e ajusta o que for
                  preciso.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="faixa quem" id="para-quem">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">Para quem é</p>
              <h2>Para quem vende serviço por conversa.</h2>
              <p>
                Negócios em que o cliente chega pelo WhatsApp, precisa de orientação e fecha depois
                de uma proposta.
              </p>
            </div>
            <div className="grade">
              <article className="cartao">
                <span className="ic">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                  </svg>
                </span>
                <h3>Assessorias</h3>
                <p>Cidadania, vistos, imigração e processos com etapas longas.</p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 3v18M5 7l7-4 7 4M3 13l2-6 2 6a2 2 0 0 1-4 0zM17 13l2-6 2 6a2 2 0 0 1-4 0zM8 21h8" />
                  </svg>
                </span>
                <h3>Escritórios</h3>
                <p>Advocacia e contabilidade que atendem e fecham pelo WhatsApp.</p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="7" width="18" height="13" rx="2" />
                    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" />
                  </svg>
                </span>
                <h3>Consultorias</h3>
                <p>Negócios que vendem diagnóstico, projeto e acompanhamento.</p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 2l2.4 5 5.6.8-4 3.9.9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-3.9 5.6-.8z" />
                  </svg>
                </span>
                <h3>Serviços sob medida</h3>
                <p>Agências, clínicas e intercâmbio, quando cada cliente é um projeto.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="faixa painel faq" id="faq">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">Perguntas frequentes</p>
              <h2>O que costumam perguntar antes de fechar.</h2>
            </div>
            <div className="lista">
              <details>
                <summary>Quanto custa?</summary>
                <p>
                  É uma mensalidade com a configuração inclusa, sem taxa de setup. O valor depende
                  do projeto: quantos funis, quantas pessoas e quais serviços do agente você vai
                  usar. A gente fecha o número na demonstração.
                </p>
              </details>
              <details>
                <summary>Onde ficam os meus dados?</summary>
                <p>
                  Em um ambiente controlado pela Arvisx. A sua equipe acessa com login próprio, e
                  cada pessoa vê só o que o papel dela permite.
                </p>
              </details>
              <details>
                <summary>Vocês configuram tudo?</summary>
                <p>
                  Sim. Funis, etapas, campos, equipe, propostas e os agentes de IA são configurados
                  pela Arvisx. Você usa o CRM; nós operamos a IA.
                </p>
              </details>
              <details>
                <summary>Preciso entender de IA?</summary>
                <p>
                  Não. As telas de IA, automações e integrações não aparecem para a sua equipe. Se o
                  negócio mudar, você avisa e a gente ajusta o agente.
                </p>
              </details>
              <details>
                <summary>O agente fala com os meus clientes sozinho?</summary>
                <p>
                  Dentro das regras combinadas com você, sim. Ações sensíveis, como enviar um
                  contrato, passam pela aprovação de alguém da equipe. Quando uma pessoa assume a
                  conversa, o agente para.
                </p>
              </details>
              <details>
                <summary>Funciona com o meu WhatsApp?</summary>
                <p>
                  O número de WhatsApp da sua empresa é conectado ao CRM, e as conversas passam a
                  chegar na Inbox. A gente faz essa conexão na implantação.
                </p>
              </details>
            </div>
          </div>
        </section>
      </main>

      <footer className="rodape" id="contato">
        <div className="miolo">
          <div className="colunas">
            <div className="marca-col">
              <Image src="/marca/arvisx-crm-escuro.png" alt="Arvisx CRM" width={715} height={85} />
              <p>
                O CRM com agentes de IA para quem vende serviço pelo WhatsApp. Configurado pela
                Arvisx, operado com você.
              </p>
            </div>
            <nav aria-label="Rodapé">
              <b>Navegue</b>
              <a href="#crm">O CRM</a>
              <a href="#agentes">Agentes de IA</a>
              <a href="#como-funciona">Como funciona</a>
              <a href="#para-quem">Para quem é</a>
              <a href="#faq">Perguntas frequentes</a>
            </nav>
            <nav className="legal" aria-label="Legal">
              <b>Legal</b>
              <a href="/termos-de-uso">Termos de uso</a>
              <a href="/privacidade-e-cookies">Política de privacidade e cookies</a>
              <a href="https://arvisx.com.br/">Arvisx AI</a>
            </nav>
          </div>
          <div className="base">
            <span>© 2026 Arvisx AI. Todos os direitos reservados.</span>
            <span>
              Arvisx CRM é um produto da <a href="https://arvisx.com.br/">Arvisx AI</a>. O elo
              inteligente do seu ecossistema.
            </span>
          </div>
        </div>
      </footer>

      <AvisoDeCookies />
    </div>
  );
}
