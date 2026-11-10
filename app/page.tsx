import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Briefcase,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  ChartBar,
  ChatsCircle,
  Check,
  CheckSquare,
  ClockCountdown,
  Code,
  FileText,
  Funnel,
  GlobeHemisphereWest,
  Key,
  MegaphoneSimple,
  Phone,
  PhoneCall,
  PhoneOutgoing,
  PuzzlePiece,
  Receipt,
  Scales,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
  Table,
  Tray,
  VideoCamera,
  Wallet,
  WhatsappLogo,
} from "@phosphor-icons/react/dist/ssr";

import { QuemCuidaDosAgentes } from "@/components/cobranca/QuemCuidaDosAgentes";
import { AvisoDeCookies } from "@/components/landing/AvisoDeCookies";
import { archivoDaVitrine } from "@/components/landing/fonte";
import { InteracoesDaLanding } from "@/components/landing/InteracoesDaLanding";
import { marcaDaSaida } from "@/lib/branding/saida";
import { maisCompleto } from "@/lib/cobranca/comparativo";
import { CADASTRO_ABERTO, LINKS, OFERTA } from "@/lib/landing/links";
import { planosDaVitrine, type VitrineDePlanos } from "@/lib/landing/planos";
import { formatCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

import "./landing.css";

/**
 * Página inicial pública de crm.arvisx.com.br: a landing v3 aprovada
 * (docs/arvisx/prototipo/landing/novo-modelo-v3-claro.html), com o mesmo
 * conteúdo, textos e visual. Oferta e destinos ficam em `lib/landing/links.ts`;
 * o comportamento (capturas que entram, carrossel, lista de chamadas) em
 * `InteracoesDaLanding`; o CSS do protótipo, escopado sob `.lp`, em
 * `app/landing.css`.
 *
 * Quem tem sessão segue direto para o painel, como sempre foi. `getUser()` e
 * nunca `getSession()`: o redirecionamento só vale para sessão que o servidor
 * de autenticação confirmou.
 */
export const dynamic = "force-dynamic";

const TITULO = "Arvisx CRM | Toda a sua operação de vendas e atendimento em um só CRM";

export const metadata: Metadata = {
  title: TITULO,
  description:
    "Conversas, funil, agenda, propostas e chamadas de voz e vídeo num só lugar. Quatro planos, do atendimento à operação inteira com IA, todos com 7 dias de teste grátis. No plano Equipe Completa, a equipe Arvisx desenvolve agentes de IA sob medida.",
  alternates: { canonical: "https://crm.arvisx.com.br/" },
  openGraph: {
    type: "website",
    title: TITULO,
    description:
      "Conversas, funil, agenda, propostas e chamadas de voz e vídeo num só lugar. Quatro planos, do atendimento à operação inteira com IA.",
    url: "https://crm.arvisx.com.br/",
    images: ["https://crm.arvisx.com.br/og-arvisx.jpg"],
    locale: "pt_BR",
  },
  twitter: { card: "summary_large_image" },
};

/** Ícone Phosphor no lugar do `<i class="ph ...">` do protótipo: o tamanho vem do `font-size` de `.ico`. */
const ico = { className: "ico", size: "1em", "aria-hidden": true } as const;
const negrito = { ...ico, weight: "bold" } as const;

// Botão de cadastro: com CADASTRO_ABERTO desligado vira "Lançamento em breve", sem link.
function BotaoDeCadastro({ className, comSeta }: { className: string; comSeta: boolean }) {
  return CADASTRO_ABERTO ? (
    <a className={className} href={LINKS.cadastro}>
      <span>{OFERTA.cta}</span>
      {comSeta ? <ArrowRight {...negrito} /> : null}
    </a>
  ) : (
    <span className={`${className} em-breve`} aria-disabled="true">
      <span>{OFERTA.ctaEmBreve}</span>
    </span>
  );
}

const atraso = (d: string) => ({ "--d": d }) as CSSProperties;

/** A resposta de "Quanto custa?", com os preços do cadastro (o mais barato e o mais caro). */
function textoDoQuantoCusta(v: VitrineDePlanos): string {
  if (v.planos.length === 0) return `Todos os planos começam com ${OFERTA.trial}.`;
  const precos = v.planos.map((p) => p.preco_cents);
  const moeda = v.planos[0]!.moeda;
  const iva = v.iva ? " + IVA" : "";
  return v.planos.length === 1
    ? `${formatCents(precos[0]!, moeda)}${iva} por mês, com ${OFERTA.trial}.`
    : `São ${v.planos.length} planos mensais, de ${formatCents(Math.min(...precos), moeda)} a ${formatCents(Math.max(...precos), moeda)}${iva}, todos com ${OFERTA.trial}.`;
}

const IMG = "/img/landing";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/app");

  // Nome da marca vem do banco (catraca nome-da-marca-nas-telas-vem-do-banco).
  const marca = await marcaDaSaida(null);
  // Os planos e o preço vêm do cadastro dos planos (/admin/cobranca), nunca do código.
  const vitrine = await planosDaVitrine();
  const maisCompletoDaVitrine = maisCompleto(vitrine.planos);
  const quantoCusta = textoDoQuantoCusta(vitrine);

  return (
    <div className={`lp ${archivoDaVitrine.variable}`}>
      <header className="topo">
        <a className="marca" href="#inicio" aria-label={`${marca.nome}, início`}>
          <Image
            src="/marca/arvisx-crm-escuro.png"
            alt={marca.nome}
            width={715}
            height={85}
            priority
          />
        </a>
        <nav aria-label="Principal">
          <a href="#crm">O CRM</a>
          <a href="#por-dentro">Telas</a>
          <a href="#chamadas">Chamadas</a>
          <a href="#ia">IA</a>
          <a href="#plano">Preço</a>
          <a href="#faq">Perguntas</a>
        </nav>
        <div className="acoes">
          <a className="btn secundario p" href={LINKS.entrar}>
            Entrar
          </a>
          <BotaoDeCadastro className="btn primario p demo" comSeta={false} />
        </div>
      </header>

      <main id="inicio">
        <section className="hero hero-b">
          <div className="miolo">
            <div className="texto">
              <p className="eyebrow entra">CRM de atendimento e vendas</p>
              <h1 className="entra" style={atraso(".08s")}>
                Toda a sua operação de vendas e atendimento <em>em um só CRM.</em>
              </h1>
              <p className="sub entra" style={atraso(".18s")}>
                Atendimento, funil, agenda e chamadas de voz e vídeo num só CRM. Quatro planos, do
                atendimento à operação inteira com IA.
              </p>
              <div className="cta-bloco entra" style={atraso(".28s")}>
                <BotaoDeCadastro className="btn primario grande" comSeta />
                <div className="cta-info">
                  <strong>{OFERTA.trial}</strong>
                  <span>Em todos os planos · IA com as credenciais da sua empresa</span>
                </div>
              </div>
            </div>
            <div className="colagem">
              <figure className="janela atras">
                <div className="barra" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element -- captura estática, mesma marcação do protótipo */}
                <img src={`${IMG}/crm-funil.webp`} alt="" width={1920} height={1200} />
              </figure>
              <figure className="janela frente">
                <div className="barra" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <span>crm.arvisx.com.br</span>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element -- captura estática, mesma marcação do protótipo */}
                <img
                  src={`${IMG}/inbox.webp`}
                  alt="Caixa de entrada do Arvisx CRM com as conversas da equipe e da IA"
                  width={1920}
                  height={1200}
                />
              </figure>
              <figure className="janela video">
                {/* eslint-disable-next-line @next/next/no-img-element -- captura estática, mesma marcação do protótipo */}
                <img src={`${IMG}/chamada-video.webp`} alt="" width={1440} height={900} />
                <figcaption>Videochamada por link</figcaption>
              </figure>
              <div className="conversa" aria-hidden="true">
                <div className="msg lead">
                  <div className="miolo-msg">
                    Oi! Vi o anúncio de vocês. Como funciona e quanto custa?
                  </div>
                </div>
                <div className="msg digitando">
                  <div className="miolo-msg">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
                <div className="msg ia">
                  <div className="miolo-msg">
                    <b>Ana · Atendimento</b>Oi, Marina! Que bom que chegou. Já te explico como
                    funciona e te passo os valores.
                  </div>
                </div>
                <div className="msg toast">
                  <div className="miolo-msg">
                    <i>✓</i>
                    <span>
                      Conversa na caixa de entrada <em>Vendas · Ana</em>
                    </span>
                  </div>
                </div>
              </div>
              <span className="orbita o1" aria-hidden="true" />
              <span className="orbita o2" aria-hidden="true" />
            </div>
          </div>
          <ul className="faixa-recursos" aria-label="O que tem no CRM">
            <li>
              <ChatsCircle {...ico} />
              Atendimento
            </li>
            <li>
              <Funnel {...ico} />
              Funil
            </li>
            <li>
              <CalendarBlank {...ico} />
              Agenda
            </li>
            <li>
              <Phone {...ico} />
              Chamadas de voz e vídeo
            </li>
          </ul>
        </section>

        <section className="faixa dor claro">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">A dor</p>
              <h2>Hoje a venda está espalhada em três lugares.</h2>
            </div>
            <div className="grade">
              <article className="cartao">
                <span className="ic">
                  <WhatsappLogo {...ico} />
                </span>
                <h3>O WhatsApp</h3>
                <p>
                  As conversas chegam a qualquer hora. Quem respondeu, quem ficou sem resposta e
                  quem já fechou se misturam na mesma lista.
                </p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <Table {...ico} />
                </span>
                <h3>A planilha</h3>
                <p>
                  O controle vive numa planilha que só uma pessoa entende. Quando ela sai de férias,
                  ninguém sabe em que pé está cada cliente.
                </p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <FileText {...ico} />
                </span>
                <h3>A proposta</h3>
                <p>
                  Cada proposta é montada do zero, num arquivo solto. Enviar, lembrar o cliente e
                  saber se ele abriu vira trabalho manual.
                </p>
              </article>
            </div>
            <p className="virada">
              <strong>Aqui, tudo fica na mesma tela.</strong> Conversa, funil, proposta, agenda e
              chamadas no mesmo lugar, com a equipe inteira dentro.
            </p>
          </div>
        </section>

        <section className="faixa painel crm claro alt" id="crm">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">O CRM</p>
              <h2>A empresa inteira em uma tela, do primeiro contato ao faturamento.</h2>
              <p>
                Um produto só, com todas as telas para toda a equipe. Você é o administrador da sua
                empresa e configura tudo do seu jeito.
              </p>
            </div>
            <ul className="modulos" aria-label="Módulos do CRM">
              <li>Caixa de entrada</li>
              <li>Funis</li>
              <li>Contatos</li>
              <li>Tarefas</li>
              <li>Agenda</li>
              <li>Chamadas de voz e vídeo</li>
              <li>Campanhas e prospecção</li>
              <li>Propostas e produtos</li>
              <li>Financeiro e faturamento</li>
              <li>Painel de desempenho</li>
              <li>Equipe e permissões</li>
            </ul>
            <div className="inbox-bloco">
              <article className="cartao">
                <span className="ic">
                  <Tray {...ico} />
                </span>
                <h3>Caixa de entrada compartilhada</h3>
                <p>
                  Todos os números de WhatsApp da empresa na mesma tela. Cada conversa tem um dono,
                  e a equipe vê quem respondeu e quem ainda está esperando.
                </p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <Receipt {...ico} />
                </span>
                <h3>Propostas e produtos</h3>
                <p>Monte a proposta a partir do cartão do lead e acompanhe o negócio no funil.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="faixa carrossel claro" id="por-dentro">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">Por dentro</p>
              <h2>Veja o seu novo CRM em ação.</h2>
              <p>Capturas reais do Arvisx CRM. Passe os cards ou escolha uma tela.</p>
            </div>
            <div className="car-tabs" role="tablist" aria-label="Telas do CRM">
              {SLIDES.map((s, i) => (
                <button
                  key={s.aba}
                  type="button"
                  role="tab"
                  data-i={i}
                  aria-selected={i === 0 ? "true" : "false"}
                >
                  {s.aba}
                </button>
              ))}
            </div>
            <div className="car-view">
              <div
                className="car-track"
                id="car-track"
                tabIndex={0}
                aria-label="Carrossel de telas do CRM"
              >
                {SLIDES.map((s, i) => (
                  <article
                    key={s.aba}
                    className={i === 0 ? "slide on" : "slide"}
                    role="tabpanel"
                    aria-label={s.aba}
                  >
                    <div className="slide-info">
                      <span className="slide-n">
                        {String(i + 1).padStart(2, "0")} / 06 · {s.aba}
                      </span>
                      <h3>{s.titulo}</h3>
                      <p>{s.texto}</p>
                      <ul>
                        {s.itens.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <figure className="janela">
                      <div className="barra" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                        <span>{s.aba}</span>
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element -- captura estática, mesma marcação do protótipo */}
                      <img
                        src={`${IMG}/${s.img}`}
                        alt={s.alt}
                        width={1920}
                        height={1200}
                        loading="lazy"
                      />
                    </figure>
                  </article>
                ))}
              </div>
            </div>
            <div className="car-ctl">
              <button type="button" className="car-btn" id="car-prev" aria-label="Tela anterior">
                <CaretLeft {...negrito} />
              </button>
              <div className="car-dots" aria-hidden="true">
                {SLIDES.map((s) => (
                  <i key={s.aba} />
                ))}
              </div>
              <button type="button" className="car-btn" id="car-next" aria-label="Próxima tela">
                <CaretRight {...negrito} />
              </button>
            </div>
          </div>
        </section>

        <section className="faixa painel crm" id="chamadas">
          <div className="miolo">
            <div className="cabeca">
              <p className="novo">
                <Sparkle {...ico} />
                Novidade
              </p>
              <h2>Ligue e faça vídeo sem sair da conversa.</h2>
              <p>
                O atendente fala com o cliente por voz ou vídeo, com o histórico do atendimento ao
                lado. Menos troca de aplicativo, mais fechamento.
              </p>
            </div>
            <div className="cs">
              <div className="cs-lista" role="group" aria-label="Recursos de chamada">
                <button
                  type="button"
                  className="cs-item on"
                  data-i="0"
                  data-rot="Conversa"
                  aria-pressed="true"
                >
                  <span className="cs-ic">
                    <PhoneCall {...ico} />
                  </span>
                  <span className="cs-tx">
                    <b>Chamada de voz pelo WhatsApp</b>
                    <small>Liga e atende sem sair do CRM</small>
                    <span className="det">
                      <span className="p">
                        O atendente liga e atende direto da conversa. O painel da chamada fica
                        visível enquanto ele navega pelo CRM.
                      </span>
                      <span className="ul">
                        <span className="li">Botão de ligar dentro da conversa</span>
                        <span className="li">Painel da chamada sempre à vista</span>
                        <span className="li">Continue navegando no CRM durante a ligação</span>
                      </span>
                    </span>
                  </span>
                  <span className="prog" aria-hidden="true">
                    <i />
                  </span>
                </button>
                <button
                  type="button"
                  className="cs-item"
                  data-i="1"
                  data-rot="Videochamada"
                  aria-pressed="false"
                >
                  <span className="cs-ic">
                    <VideoCamera {...ico} />
                  </span>
                  <span className="cs-tx">
                    <b>Videochamada por link</b>
                    <small>O cliente entra pelo navegador</small>
                    <span className="det">
                      <span className="p">
                        O atendente clica em “Vídeo” e a sala abre. O cliente entra pelo celular ou
                        pelo computador, sem baixar app e sem criar conta.
                      </span>
                      <span className="ul">
                        <span className="li">Link enviado na própria conversa</span>
                        <span className="li">Sem app e sem cadastro para o cliente</span>
                      </span>
                    </span>
                  </span>
                  <span className="prog" aria-hidden="true">
                    <i />
                  </span>
                </button>
                <button
                  type="button"
                  className="cs-item"
                  data-i="2"
                  data-rot="Cold Call"
                  aria-pressed="false"
                >
                  <span className="cs-ic">
                    <PhoneOutgoing {...ico} />
                  </span>
                  <span className="cs-tx">
                    <b>Cold Call</b>
                    <small>Fila de ligações ativas</small>
                    <span className="det">
                      <span className="p">
                        Uma fila de ligações ativas: um lead por vez, usando o discador do aparelho.
                      </span>
                      <span className="ul">
                        <span className="li">Um lead por vez, na ordem da fila</span>
                        <span className="li">Usa o discador do aparelho</span>
                      </span>
                    </span>
                  </span>
                  <span className="prog" aria-hidden="true">
                    <i />
                  </span>
                </button>
              </div>
              <figure className="cs-frame">
                <div className="barra" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <span id="cs-rot">Conversa</span>
                </div>
                <div className="cs-img">
                  <div className="cs-pane on" data-i="0">
                    {/* eslint-disable-next-line @next/next/no-img-element -- captura estática, mesma marcação do protótipo */}
                    <img
                      src={`${IMG}/chamada-conversa.webp`}
                      alt="Conversa com os botões de ligar e de vídeo"
                      width={1440}
                      height={900}
                      loading="lazy"
                    />
                  </div>
                  <div className="cs-pane" data-i="1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- captura estática, mesma marcação do protótipo */}
                    <img
                      src={`${IMG}/chamada-video.webp`}
                      alt="Sala de videochamada aberta a partir da conversa"
                      width={1440}
                      height={900}
                      loading="lazy"
                    />
                  </div>
                  <div className="cs-pane" data-i="2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- captura estática, mesma marcação do protótipo */}
                    <img
                      src={`${IMG}/cold-call.webp`}
                      alt="Fila de ligações do Cold Call"
                      width={1920}
                      height={1200}
                      loading="lazy"
                    />
                  </div>
                </div>
              </figure>
            </div>
          </div>
        </section>

        <section className="faixa crm claro" id="ia">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">IA integrada</p>
              <h2>A IA já mora dentro do CRM.</h2>
              <p>
                Ela trabalha nas mesmas conversas, no mesmo funil e na mesma agenda que a sua
                equipe.
              </p>
            </div>
            <div className="telas">
              <article className="tela">
                <div className="texto">
                  <h3>Agentes que atendem ao lado da equipe</h3>
                  <p>
                    Você configura agentes no próprio CRM, ensina o que eles precisam saber e define
                    quando passam a conversa para uma pessoa. A gestão e a configuração dos agentes
                    são suas.
                  </p>
                  <ul>
                    <li>Agentes de atendimento no WhatsApp</li>
                    <li>Base de conhecimento do seu negócio</li>
                    <li>Passagem para a equipe quando precisa de gente</li>
                  </ul>
                </div>
                <figure className="janela" data-chip="A IA atende e passa para a equipe">
                  <div className="barra" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <span>Agente de IA</span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element -- captura estática, mesma marcação do protótipo */}
                  <img
                    src={`${IMG}/ia-conversa.webp`}
                    alt="Agente de IA atendendo uma conversa no CRM"
                    width={1920}
                    height={1200}
                    loading="lazy"
                  />
                </figure>
              </article>
            </div>
          </div>
        </section>

        <section className="faixa chaves" id="suas-chaves">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">IA com as suas credenciais</p>
              <h2>Sua IA, suas chaves, seu controle.</h2>
              <p>
                A IA do Arvisx CRM funciona com as credenciais da sua empresa. Você conecta as
                chaves ou os planos de IA que já tem e usa como quiser.
              </p>
            </div>
            <div className="fluxo" aria-label="Como a IA se conecta">
              <div className="nodo">
                <b>Suas credenciais</b>
                <small>Chaves ou planos de IA</small>
              </div>
              <span className="seta" aria-hidden="true">
                <ArrowRight {...negrito} />
              </span>
              <div className="nodo destaque">
                <b>Arvisx CRM</b>
                <small>Liga a IA às conversas e ao funil</small>
              </div>
              <span className="seta" aria-hidden="true">
                <ArrowRight {...negrito} />
              </span>
              <div className="nodo">
                <b>Atendimento e agentes</b>
                <small>No WhatsApp, com a sua equipe</small>
              </div>
            </div>
            <div className="grade tres-c">
              <article className="cartao">
                <div className="topo-c">
                  <span className="ic">
                    <Key {...ico} />
                  </span>
                  <span className="n">01</span>
                </div>
                <h3>Você conecta</h3>
                <p>
                  Cadastre no CRM as chaves de API ou os planos de IA que a sua empresa já contrata.
                  Sem programar.
                </p>
              </article>
              <article className="cartao">
                <div className="topo-c">
                  <span className="ic">
                    <SlidersHorizontal {...ico} />
                  </span>
                  <span className="n">02</span>
                </div>
                <h3>Você usa como quiser</h3>
                <p>
                  Escolha onde a IA entra: no atendimento, nas respostas, nos agentes. A decisão é
                  da sua empresa.
                </p>
              </article>
              <article className="cartao">
                <div className="topo-c">
                  <span className="ic">
                    <Wallet {...ico} />
                  </span>
                  <span className="n">03</span>
                </div>
                <h3>O consumo é seu</h3>
                <p>
                  O uso da IA fica na sua conta, com o provedor que você escolheu. Do CRM, você paga
                  só o plano.
                </p>
              </article>
            </div>
            <p className="chaves-nota">
              Prefere que a Arvisx desenvolva os agentes para a sua operação? Esse serviço faz parte
              do plano Equipe Completa.
            </p>
            <p className="chaves-link">
              <a href="#agentes">Conheça o Equipe Completa</a>
            </p>
          </div>
        </section>

        <section className="faixa mais claro alt" id="recursos">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">Mais recursos</p>
              <h2>E o que ajuda a vender mais.</h2>
            </div>
            <div className="grade">
              <article className="cartao">
                <span className="ic">
                  <ClockCountdown {...ico} />
                </span>
                <h3>Clientes parados</h3>
                <p>Veja quem está sem resposta e o próximo passo de cada cliente.</p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <CheckSquare {...ico} />
                </span>
                <h3>Tarefas e follow-ups</h3>
                <p>Lembretes e tarefas ligados a cada cliente, com responsável e prazo.</p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <MegaphoneSimple {...ico} />
                </span>
                <h3>Campanhas e prospecção</h3>
                <p>
                  Encontre novos contatos, conduza as primeiras abordagens e acompanhe as campanhas.
                </p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <ChartBar {...ico} />
                </span>
                <h3>Painel de desempenho</h3>
                <p>Acompanhe atendimento, funil e resultados da equipe num só painel.</p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <Code {...ico} />
                </span>
                <h3>API, webhooks e MCP</h3>
                <p>Conecte o CRM às ferramentas que a sua empresa já usa.</p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <ShieldCheck {...ico} />
                </span>
                <h3>Equipe e permissões</h3>
                <p>Cada pessoa com o seu login e o seu papel, e as ações ficam registradas.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="faixa painel como" id="como-funciona">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">Como começa</p>
              <h2>Três passos, e o seu time já está usando.</h2>
            </div>
            <div className="passos">
              <article className="cartao passo">
                <h3>Crie a sua conta</h3>
                <p>
                  Comece o teste grátis e entre como administrador da sua empresa, com acesso
                  completo ao que o plano oferece.
                </p>
              </article>
              <article className="cartao passo">
                <h3>Conecte o WhatsApp</h3>
                <p>
                  Conecte o número da empresa e convide a equipe. Usuários e números de WhatsApp são
                  ilimitados.
                </p>
              </article>
              <article className="cartao passo">
                <h3>Comece a atender</h3>
                <p>
                  As conversas chegam na caixa de entrada, entram no funil e ficam com o histórico
                  completo.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="faixa plano claro alt" id="plano">
          <div className="miolo">
            <div className="cabeca centro">
              <p className="eyebrow">Planos</p>
              <h2>Do atendimento à operação inteira com IA.</h2>
              <p>
                Todos os planos começam com {OFERTA.trial}.
                {vitrine.iva ? " Preços mensais + IVA." : " Preços mensais."}
              </p>
            </div>
            {vitrine.planos.length > 0 ? (
              <ul className="planos-grade">
                {vitrine.planos.map((plano) => {
                  const destaque = plano.id === maisCompletoDaVitrine;
                  return (
                    <li
                      key={plano.id}
                      data-plano={plano.nome}
                      className={`plano-card${destaque ? " destaque" : ""}${plano.inclui_agentes_arvisx ? " agentes" : ""}`}
                    >
                      <div className="pl-selos">
                        {destaque ? <span className="pl-selo">Mais completo</span> : null}
                        {plano.inclui_agentes_arvisx ? (
                          <span className="pl-selo forte">
                            <Sparkle {...ico} weight="fill" /> 4 agentes de IA sob medida
                          </span>
                        ) : null}
                      </div>
                      <h3>{plano.nome}</h3>
                      <div className="pl-valor">
                        <strong>{formatCents(plano.preco_cents, plano.moeda)}</strong>
                        <span>
                          {vitrine.iva ? "+ IVA " : ""}
                          {plano.intervalo === "ano" ? "por ano" : "por mês"}
                        </span>
                      </div>
                      {plano.descricao_curta ? <p className="pl-promessa">{plano.descricao_curta}</p> : null}
                      {plano.para_quem ? <p className="pl-quem">{plano.para_quem}</p> : null}
                      <p className="pl-limites">
                        {plano.max_canais === null ? "Canais ilimitados" : `Até ${plano.max_canais} canais`} ·{" "}
                        {plano.max_assentos === null ? "pessoas ilimitadas" : `até ${plano.max_assentos} pessoas`}
                      </p>
                      {plano.como_funciona ? (
                        <div className="pl-como">
                          <b>Como funciona</b>
                          <p>{plano.como_funciona}</p>
                        </div>
                      ) : null}
                      {plano.destaques.length > 0 ? (
                        <ul className="pl-lista">
                          {plano.destaques.map((frase) => (
                            <li key={frase}>
                              <Check {...negrito} />
                              <span>{frase}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <BotaoDeCadastro className={`btn ${destaque || plano.inclui_agentes_arvisx ? "primario" : "secundario"}`} comSeta={false} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="planos-vazio">
                <BotaoDeCadastro className="btn primario grande" comSeta />
              </div>
            )}
            {/* O aviso fixo de quem configura os agentes: o mesmo texto do comparativo dos planos. */}
            <QuemCuidaDosAgentes variante="landing" />
            <p className="pc-link">
              <a href="#agentes">Como funciona o Equipe Completa</a>
            </p>
          </div>
        </section>

        <section className="faixa ag-arvisx" id="agentes">
          <div className="miolo">
            <div>
              <p className="eyebrow">Equipe Completa · Soluções sob medida</p>
              <h2>Quer agentes de IA feitos para a sua operação?</h2>
              <p className="lede" style={{ marginTop: 16 }}>
                No plano Equipe Completa,{" "}
                <strong>o time da Arvisx desenvolve com você</strong>: 4 agentes de IA sob medida,
                integrados ao CRM e às ferramentas que você já usa. É o único plano em que a Arvisx
                desenvolve soluções personalizadas.
              </p>
            </div>
            <div className="passos">
              <article className="passo">
                <h3>Você assina o Equipe Completa e a assinatura é confirmada</h3>
              </article>
              <article className="passo">
                <h3>Nossa equipe entra em contato e entende a sua operação</h3>
              </article>
              <article className="passo">
                <h3>Desenvolvemos os 4 agentes e integramos ao seu CRM</h3>
              </article>
            </div>
            <div className="rodape-bloco" data-equipe-completa>
              <BotaoDeCadastro className="btn primario" comSeta={false} />
              <p className="discreta">
                O contato da nossa equipe acontece depois que a assinatura é confirmada. O prazo e o
                escopo de cada agente são combinados nesse primeiro contato. O nome do assistente é
                o que você quiser. O agente se apresenta como assistente virtual.
              </p>
            </div>
          </div>
        </section>

        <section className="faixa quem claro" id="para-quem">
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
                  <GlobeHemisphereWest {...ico} />
                </span>
                <h3>Assessorias</h3>
                <p>Cidadania, vistos, imigração e processos com etapas longas.</p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <Scales {...ico} />
                </span>
                <h3>Escritórios</h3>
                <p>Advocacia e contabilidade que atendem e fecham pelo WhatsApp.</p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <Briefcase {...ico} />
                </span>
                <h3>Consultorias</h3>
                <p>Negócios que vendem diagnóstico, projeto e acompanhamento.</p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <PuzzlePiece {...ico} />
                </span>
                <h3>Serviços sob medida</h3>
                <p>Agências, clínicas e intercâmbio, quando cada cliente é um projeto.</p>
              </article>
            </div>
            <p style={{ marginTop: 24, color: "var(--apoio)", fontSize: 16, maxWidth: "60ch" }}>
              Seu nicho não está aqui? Funis, etapas e nomes se ajustam ao seu jeito de vender.
            </p>
          </div>
        </section>

        <section className="faixa painel faq claro alt" id="faq">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">Perguntas frequentes</p>
              <h2>O que costumam perguntar antes de fechar.</h2>
            </div>
            <div className="lista">
              <details>
                <summary>Quanto custa?</summary>
                <p>
                  <span>{quantoCusta}</span> O Equipe Completa inclui 4 agentes de IA desenvolvidos
                  pela nossa equipe; nos demais planos, a Arvisx não desenvolve soluções
                  personalizadas.
                </p>
              </details>
              <details>
                <summary>Como funciona o teste grátis?</summary>
                <p>
                  Você começa com <span>{OFERTA.trial}</span> para conhecer o CRM com a sua equipe.
                </p>
              </details>
              <details>
                <summary>Preciso saber programar?</summary>
                <p>
                  Não. Você cria a conta, conecta o WhatsApp e começa a usar o CRM. Não exige
                  programação.
                </p>
              </details>
              <details>
                <summary>Existe limite de usuários ou números?</summary>
                <p>
                  Não há cobrança por usuário nem por número de WhatsApp, dentro do uso justo de uma
                  empresa por conta.
                </p>
              </details>
              <details>
                <summary>Como funcionam as chamadas de voz e vídeo?</summary>
                <p>
                  A chamada de voz acontece pelo WhatsApp, direto do CRM. Ela usa um segundo
                  aparelho vinculado ao número, como o WhatsApp Web. A videochamada é por link: o
                  cliente entra pelo navegador, sem baixar app e sem criar conta.
                </p>
              </details>
              <details>
                <summary>Funciona com o WhatsApp comum?</summary>
                <p>
                  Sim, por QR code ou pela API oficial da Meta. O QR code é um canal não oficial,
                  com risco de bloqueio como qualquer ferramenta desse tipo. Na API oficial, os
                  custos são cobrados pela própria Meta.
                </p>
              </details>
              <details>
                <summary>Como funciona a IA?</summary>
                <p>
                  A IA é integrada ao CRM a partir do plano Standard. Você conecta as suas próprias
                  chaves ou planos de IA e é responsável por configurar e gerenciar os seus agentes.
                  O consumo é cobrado pelo seu provedor de IA, nunca pela Arvisx.
                </p>
              </details>
              <details>
                <summary>O que é o Equipe Completa?</summary>
                <p>
                  É o único plano em que a Arvisx desenvolve soluções personalizadas. Depois da
                  assinatura confirmada, nossa equipe entende a sua operação e cria 4 agentes de IA
                  sob medida, integrados ao seu CRM. Nos demais planos, você configura e gerencia os
                  seus agentes.
                </p>
              </details>
              <details>
                <summary>Onde ficam os meus dados?</summary>
                <p>Cada empresa fica isolada das outras, com registro de ações.</p>
              </details>
              <details>
                <summary>Posso cancelar quando quiser?</summary>
                <p>Sim. Você pode cancelar quando quiser.</p>
              </details>
            </div>
          </div>
        </section>
      </main>

      <footer className="rodape" id="contato">
        <div className="miolo">
          <div className="colunas">
            <div className="marca-col">
              <Image src="/marca/arvisx-crm-escuro.png" alt={marca.nome} width={715} height={85} />
              <p>Toda a sua operação de vendas e atendimento em um só CRM.</p>
            </div>
            <nav aria-label="Rodapé">
              <b>Navegue</b>
              <a href="#crm">O CRM</a>
              <a href="#chamadas">Chamadas de voz e vídeo</a>
              <a href="#plano">Preço</a>
              <a href="#agentes">Equipe Completa</a>
              <a href="#para-quem">Para quem é</a>
              <a href="#faq">Perguntas frequentes</a>
            </nav>
            <nav className="legal" aria-label="Legal">
              <b>Legal</b>
              <a href={LINKS.termos}>Termos de Serviço</a>
              <a href={LINKS.privacidade}>Política de Privacidade</a>
              <a href={LINKS.exclusaoDeDados}>Exclusão de Dados</a>
            </nav>
          </div>
          <div className="base">
            <span>
              Arvisx CRM — CRM de vendas e atendimento. © 2026 Arvisx AI. Todos os direitos
              reservados.
            </span>
            <span>
              Arvisx CRM é um produto da <a href={LINKS.site}>Arvisx AI</a>. O elo inteligente do
              seu ecossistema.
            </span>
          </div>
        </div>
      </footer>
      <AvisoDeCookies />
      <InteracoesDaLanding />
    </div>
  );
}

/** As seis telas do carrossel, na ordem do protótipo. */
const SLIDES = [
  {
    aba: "Caixa de entrada",
    titulo: "Uma caixa de entrada para a equipe toda",
    texto:
      "Todas as conversas de WhatsApp num só lugar, com a equipe e a IA atendendo lado a lado. Cada cliente com o seu histórico, sem pergunta repetida.",
    itens: [
      "Vários números de WhatsApp na mesma tela",
      "Dono da conversa e histórico do cliente",
      "Atendimento humano e IA no mesmo lugar",
    ],
    img: "inbox.webp",
    alt: "Caixa de entrada compartilhada do Arvisx CRM",
  },
  {
    aba: "Funis",
    titulo: "Funis com o vocabulário do seu negócio",
    texto:
      "Cada serviço tem o seu caminho. Você define as etapas, os nomes e o que cada cartão mostra.",
    itens: [
      "Etapas e nomes do seu jeito de vender",
      "Quadro kanban com valor e responsável em cada cartão",
      "Um funil para cada tipo de serviço",
    ],
    img: "crm-funil.webp",
    alt: "Quadro do funil com as etapas e os cartões de cada cliente",
  },
  {
    aba: "Cartão do lead",
    titulo: "O cartão do lead com o que importa para o seu serviço",
    texto:
      "Campos personalizados por funil, documentos anexados e os dados do contato no mesmo cartão.",
    itens: [
      "Campos que você cria, por funil",
      "Documentos do cliente anexados ao cartão",
      "Dados do contato e histórico no mesmo lugar",
    ],
    img: "crm-cartao-lead.webp",
    alt: "Cartão do lead com campos personalizados, documentos e dados do contato",
  },
  {
    aba: "Contatos",
    titulo: "Cada cliente, uma ficha",
    texto: "Todo mundo que já falou com você, com histórico, etiquetas e responsável.",
    itens: [
      "Histórico completo de cada pessoa",
      "Etiquetas para organizar a base",
      "Responsável pelo relacionamento",
    ],
    img: "crm-contatos.webp",
    alt: "Lista de contatos com etiquetas e responsável",
  },
  {
    aba: "Agenda",
    titulo: "A agenda da equipe no mesmo lugar da conversa",
    texto: "As reuniões e os retornos ficam marcados com o cliente, sem planilha paralela.",
    itens: [
      "Reuniões e retornos da equipe",
      "Ligados ao cliente e ao funil",
      "Todo mundo vê o que está marcado",
    ],
    img: "crm-agenda.webp",
    alt: "Agenda da equipe com as reuniões da semana",
  },
  {
    aba: "Financeiro",
    titulo: "Financeiro e faturamento sem sair do CRM",
    texto: "Acompanhe o que foi fechado e o que falta receber, com honorários e comandas.",
    itens: [
      "Faturamento ligado ao cliente",
      "Honorários e comandas",
      "O que foi fechado e o que falta receber",
    ],
    img: "crm-financeiro.webp",
    alt: "Tela de financeiro e faturamento",
  },
] as const;
