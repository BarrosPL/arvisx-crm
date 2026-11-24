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
import { traduzir } from "@/lib/i18n/dicionario";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
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
    "Conversas, funil, agenda, propostas e chamadas de voz e vídeo num só lugar. Três planos, do atendimento à operação inteira com IA, todos com 7 dias de teste grátis. Agentes de IA sob medida são um serviço à parte, os Agentes Arvisx.",
  alternates: { canonical: "https://crm.arvisx.com.br/" },
  openGraph: {
    type: "website",
    title: TITULO,
    description:
      "Conversas, funil, agenda, propostas e chamadas de voz e vídeo num só lugar. Três planos, do atendimento à operação inteira com IA.",
    url: "https://crm.arvisx.com.br/",
    images: ["https://crm.arvisx.com.br/og-arvisx.jpg"],
    locale: "pt_BR",
  },
  twitter: { card: "summary_large_image" },
};

/** Ícone Phosphor no lugar do `<i class="ph ...">` do protótipo: o tamanho vem do `font-size` de `.ico`. */
const ico = { className: "ico", size: "1em", "aria-hidden": true } as const;
const negrito = { ...ico, weight: "bold" } as const;

/** O tradutor do idioma de quem visita; em português devolve o próprio texto. */
type Tradutor = (texto: string) => string;

/** Troca cada `{nome}` da frase (já traduzida) pelo valor, que não se traduz: preço, contagem. */
function comValores(frase: string, valores: Record<string, string | number>): string {
  return Object.entries(valores).reduce(
    (texto, [nome, valor]) => texto.split(`{${nome}}`).join(String(valor)),
    frase,
  );
}

// Botão de cadastro: com CADASTRO_ABERTO desligado vira "Lançamento em breve", sem link.
// `plano`: o botão de um cartão de plano leva a escolha ao cadastro (`?plano=<id>`),
// que então pula o passo de escolher. Sem ele, quem clicava num plano aqui
// chegava ao cadastro com outro plano marcado.
function BotaoDeCadastro({
  className,
  comSeta,
  plano,
  t,
}: {
  className: string;
  comSeta: boolean;
  plano?: string;
  t: Tradutor;
}) {
  return CADASTRO_ABERTO ? (
    <a className={className} href={plano ? `${LINKS.cadastro}?plano=${encodeURIComponent(plano)}` : LINKS.cadastro}>
      <span>{t(OFERTA.cta)}</span>
      {comSeta ? <ArrowRight {...negrito} /> : null}
    </a>
  ) : (
    <span className={`${className} em-breve`} aria-disabled="true">
      <span>{t(OFERTA.ctaEmBreve)}</span>
    </span>
  );
}

const atraso = (d: string) => ({ "--d": d }) as CSSProperties;

/** A resposta de "Quanto custa?", com os preços do cadastro (o mais barato e o mais caro). */
function textoDoQuantoCusta(v: VitrineDePlanos, t: Tradutor): string {
  const trial = t(OFERTA.trial);
  if (v.planos.length === 0) return comValores(t("Todos os planos começam com {trial}."), { trial });
  const precos = v.planos.map((p) => p.preco_cents);
  const moeda = v.planos[0]!.moeda;
  const iva = v.iva ? " + IVA" : "";
  return v.planos.length === 1
    ? comValores(t("{preco}{iva} por mês, com {trial}."), {
        preco: formatCents(precos[0]!, moeda),
        iva,
        trial,
      })
    : comValores(t("São {n} planos mensais, de {min} a {max}{iva}, todos com {trial}."), {
        n: v.planos.length,
        min: formatCents(Math.min(...precos), moeda),
        max: formatCents(Math.max(...precos), moeda),
        iva,
        trial,
      });
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
  // Quem chega aqui não tem sessão (quem tem já foi para o painel): o idioma é o
  // do navegador, pela mesma função das outras telas públicas. O provider leva
  // esse idioma aos componentes de cliente da página (o aviso de cookies).
  const locale = await idiomaDoVisitante(null);
  const t: Tradutor = (texto) => traduzir(texto, locale);
  const quantoCusta = textoDoQuantoCusta(vitrine, t);

  return (
    <IdiomaProvider locale={locale}>
    <div className={`lp ${archivoDaVitrine.variable}`}>
      <header className="topo">
        <a className="marca" href="#inicio" aria-label={`${marca.nome}, ${t("início")}`}>
          <Image
            src="/marca/arvisx-crm-escuro.png"
            alt={marca.nome}
            width={715}
            height={85}
            priority
          />
        </a>
        <nav aria-label={t("Principal")}>
          <a href="#crm">{t("O CRM")}</a>
          <a href="#por-dentro">{t("Telas")}</a>
          <a href="#chamadas">{t("Chamadas")}</a>
          <a href="#ia">IA</a>
          <a href="#plano">{t("Preço")}</a>
          <a href="#faq">{t("Perguntas")}</a>
        </nav>
        <div className="acoes">
          <a className="btn secundario p" href={LINKS.entrar}>
            {t("Entrar")}
          </a>
          <BotaoDeCadastro className="btn primario p demo" comSeta={false} t={t} />
        </div>
      </header>

      <main id="inicio">
        <section className="hero hero-b">
          <div className="miolo">
            <div className="texto">
              <p className="eyebrow entra">{t("CRM de atendimento e vendas")}</p>
              <h1 className="entra" style={atraso(".08s")}>
                {t("Toda a sua operação de vendas e atendimento")}{" "}<em>{t("em um só CRM.")}</em>
              </h1>
              <p className="sub entra" style={atraso(".18s")}>
                {t("Atendimento, funil, agenda e chamadas de voz e vídeo num só CRM. Três planos, do atendimento à operação inteira com IA.")}
              </p>
              <div className="cta-bloco entra" style={atraso(".28s")}>
                <BotaoDeCadastro className="btn primario grande" comSeta t={t} />
                <div className="cta-info">
                  <strong>{t(OFERTA.trial)}</strong>
                  <span>{t("IA a partir do Standard, com as credenciais da sua empresa")}</span>
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
                  alt={t("Caixa de entrada do Arvisx CRM com as conversas da equipe e da IA")}
                  width={1920}
                  height={1200}
                />
              </figure>
              <figure className="janela video">
                {/* eslint-disable-next-line @next/next/no-img-element -- captura estática, mesma marcação do protótipo */}
                <img src={`${IMG}/chamada-video.webp`} alt="" width={1440} height={900} />
                <figcaption>{t("Videochamada por link")}</figcaption>
              </figure>
              <div className="conversa" aria-hidden="true">
                <div className="msg lead">
                  <div className="miolo-msg">
                    {t("Oi! Vi o anúncio de vocês. Como funciona e quanto custa?")}
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
                    <b>{t("Ana · Atendimento")}</b>{t("Oi, Marina! Que bom que chegou. Já te explico como funciona e te passo os valores.")}
                  </div>
                </div>
                <div className="msg toast">
                  <div className="miolo-msg">
                    <i>✓</i>
                    <span>
                      {t("Conversa na caixa de entrada")}{" "}<em>{t("Vendas · Ana")}</em>
                    </span>
                  </div>
                </div>
              </div>
              <span className="orbita o1" aria-hidden="true" />
              <span className="orbita o2" aria-hidden="true" />
            </div>
          </div>
          <ul className="faixa-recursos" aria-label={t("O que tem no CRM")}>
            <li>
              <ChatsCircle {...ico} />
              {t("Atendimento")}
            </li>
            <li>
              <Funnel {...ico} />
              {t("Funil")}
            </li>
            <li>
              <CalendarBlank {...ico} />
              {t("Agenda")}
            </li>
            <li>
              <Phone {...ico} />
              {t("Chamadas de voz e vídeo")}
            </li>
          </ul>
        </section>

        <section className="faixa dor claro">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">{t("A solução")}</p>
              <h2>{t("A venda que estava espalhada em três lugares agora fica em um só.")}</h2>
            </div>
            <div className="grade">
              <article className="cartao">
                <span className="ic">
                  <WhatsappLogo {...ico} />
                </span>
                <h3>{t("O WhatsApp")}</h3>
                <p>
                  {t("As conversas deixam de se misturar numa lista só. Cada uma tem um dono, e a equipe vê quem respondeu e quem ainda está esperando.")}
                </p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <Funnel {...ico} />
                </span>
                <h3>{t("O funil no lugar da planilha")}</h3>
                <p>
                  {t("O controle sai da planilha que só uma pessoa entende. Cada cliente tem um cartão no funil, e a equipe inteira sabe em que pé ele está.")}
                </p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <FileText {...ico} />
                </span>
                <h3>{t("A proposta")}</h3>
                <p>
                  {t("A proposta deixa de ser um arquivo solto, montado do zero. Ela sai do cartão do lead, e o negócio segue acompanhado no funil.")}
                </p>
              </article>
            </div>
            <p className="virada">
              <strong>{t("Tudo fica na mesma tela.")}</strong>{" "}{t("Conversa, funil, proposta, agenda e chamadas no mesmo lugar, com a equipe inteira dentro.")}
            </p>
          </div>
        </section>

        <section className="faixa painel crm claro alt" id="crm">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">{t("O CRM")}</p>
              <h2>{t("A empresa inteira em uma tela, do primeiro contato ao faturamento.")}</h2>
              <p>
                {t("Um produto só, com todas as telas para toda a equipe. Você é o administrador da sua empresa e configura tudo do seu jeito.")}
              </p>
            </div>
            <ul className="modulos" aria-label={t("Módulos do CRM")}>
              <li>{t("Caixa de entrada")}</li>
              <li>{t("Funis")}</li>
              <li>{t("Contatos")}</li>
              <li>{t("Tarefas")}</li>
              <li>{t("Agenda")}</li>
              <li>{t("Chamadas de voz e vídeo")}</li>
              <li>{t("Campanhas e prospecção")}</li>
              <li>{t("Propostas e produtos")}</li>
              <li>{t("Financeiro e faturamento")}</li>
              <li>{t("Painel de desempenho")}</li>
              <li>{t("Equipe e permissões")}</li>
            </ul>
            <div className="inbox-bloco">
              <article className="cartao">
                <span className="ic">
                  <Tray {...ico} />
                </span>
                <h3>{t("Caixa de entrada compartilhada")}</h3>
                <p>
                  {t("Todos os números de WhatsApp da empresa na mesma tela. Cada conversa tem um dono, e a equipe vê quem respondeu e quem ainda está esperando.")}
                </p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <Receipt {...ico} />
                </span>
                <h3>{t("Propostas e produtos")}</h3>
                <p>{t("Monte a proposta a partir do cartão do lead e acompanhe o negócio no funil.")}</p>
              </article>
            </div>
          </div>
        </section>

        <section className="faixa carrossel claro" id="por-dentro">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">{t("Por dentro")}</p>
              <h2>{t("Veja o seu novo CRM em ação.")}</h2>
              <p>{t("Capturas reais do Arvisx CRM. Passe os cards ou escolha uma tela.")}</p>
            </div>
            <div className="car-tabs" role="tablist" aria-label={t("Telas do CRM")}>
              {SLIDES.map((s, i) => (
                <button
                  key={s.aba}
                  type="button"
                  role="tab"
                  data-i={i}
                  aria-selected={i === 0 ? "true" : "false"}
                >
                  {t(s.aba)}
                </button>
              ))}
            </div>
            <div className="car-view">
              <div
                className="car-track"
                id="car-track"
                tabIndex={0}
                aria-label={t("Carrossel de telas do CRM")}
              >
                {SLIDES.map((s, i) => (
                  <article
                    key={s.aba}
                    className={i === 0 ? "slide on" : "slide"}
                    role="tabpanel"
                    aria-label={t(s.aba)}
                  >
                    <div className="slide-info">
                      <span className="slide-n">
                        {String(i + 1).padStart(2, "0")} / 06 · {t(s.aba)}
                      </span>
                      <h3>{t(s.titulo)}</h3>
                      <p>{t(s.texto)}</p>
                      <ul>
                        {s.itens.map((item, j) => (
                          <li key={item}>{t(s.itens[j]!)}</li>
                        ))}
                      </ul>
                    </div>
                    <figure className="janela">
                      <div className="barra" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                        <span>{t(s.aba)}</span>
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element -- captura estática, mesma marcação do protótipo */}
                      <img
                        src={`${IMG}/${s.img}`}
                        alt={t(s.alt)}
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
              <button type="button" className="car-btn" id="car-prev" aria-label={t("Tela anterior")}>
                <CaretLeft {...negrito} />
              </button>
              <div className="car-dots" aria-hidden="true">
                {SLIDES.map((s) => (
                  <i key={s.aba} />
                ))}
              </div>
              <button type="button" className="car-btn" id="car-next" aria-label={t("Próxima tela")}>
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
                {t("Novidade")}
              </p>
              <h2>{t("Ligue e faça vídeo sem sair da conversa.")}</h2>
              <p>
                {t("O atendente fala com o cliente por voz ou vídeo, com o histórico do atendimento ao lado. Menos troca de aplicativo, mais fechamento.")}
              </p>
            </div>
            <div className="cs">
              <div className="cs-lista" role="group" aria-label={t("Recursos de chamada")}>
                <button
                  type="button"
                  className="cs-item on"
                  data-i="0"
                  data-rot={t("Conversa")}
                  aria-pressed="true"
                >
                  <span className="cs-ic">
                    <PhoneCall {...ico} />
                  </span>
                  <span className="cs-tx">
                    <b>{t("Chamada de voz pelo WhatsApp")}</b>
                    <small>{t("Liga e atende sem sair do CRM")}</small>
                    <span className="det">
                      <span className="p">
                        {t("O atendente liga e atende direto da conversa. O painel da chamada fica visível enquanto ele navega pelo CRM.")}
                      </span>
                      <span className="ul">
                        <span className="li">{t("Botão de ligar dentro da conversa")}</span>
                        <span className="li">{t("Painel da chamada sempre à vista")}</span>
                        <span className="li">{t("Continue navegando no CRM durante a ligação")}</span>
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
                  data-rot={t("Videochamada")}
                  aria-pressed="false"
                >
                  <span className="cs-ic">
                    <VideoCamera {...ico} />
                  </span>
                  <span className="cs-tx">
                    <b>{t("Videochamada por link")}</b>
                    <small>{t("O cliente entra pelo navegador")}</small>
                    <span className="det">
                      <span className="p">
                        {t("O atendente clica em “Vídeo” e a sala abre. O cliente entra pelo celular ou pelo computador, sem baixar app e sem criar conta.")}
                      </span>
                      <span className="ul">
                        <span className="li">{t("Link enviado na própria conversa")}</span>
                        <span className="li">{t("Sem app e sem cadastro para o cliente")}</span>
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
                    <small>{t("Fila de ligações ativas")}</small>
                    <span className="det">
                      <span className="p">
                        {t("Uma fila de ligações ativas: um lead por vez, usando o discador do aparelho.")}
                      </span>
                      <span className="ul">
                        <span className="li">{t("Um lead por vez, na ordem da fila")}</span>
                        <span className="li">{t("Usa o discador do aparelho")}</span>
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
                  <span id="cs-rot">{t("Conversa")}</span>
                </div>
                <div className="cs-img">
                  <div className="cs-pane on" data-i="0">
                    {/* eslint-disable-next-line @next/next/no-img-element -- captura estática, mesma marcação do protótipo */}
                    <img
                      src={`${IMG}/chamada-conversa.webp`}
                      alt={t("Conversa com os botões de ligar e de vídeo")}
                      width={1440}
                      height={900}
                      loading="lazy"
                    />
                  </div>
                  <div className="cs-pane" data-i="1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- captura estática, mesma marcação do protótipo */}
                    <img
                      src={`${IMG}/chamada-video.webp`}
                      alt={t("Sala de videochamada aberta a partir da conversa")}
                      width={1440}
                      height={900}
                      loading="lazy"
                    />
                  </div>
                  <div className="cs-pane" data-i="2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- captura estática, mesma marcação do protótipo */}
                    <img
                      src={`${IMG}/cold-call.webp`}
                      alt={t("Fila de ligações do Cold Call")}
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
              <p className="eyebrow">{t("IA integrada")}</p>
              <h2>{t("A IA já mora dentro do CRM.")}</h2>
              <p>
                {t("Ela trabalha nas mesmas conversas, no mesmo funil e na mesma agenda que a sua equipe.")}
              </p>
            </div>
            <div className="telas">
              <article className="tela">
                <div className="texto">
                  <h3>{t("Agentes que atendem ao lado da equipe")}</h3>
                  <p>
                    {t("Você configura agentes no próprio CRM, ensina o que eles precisam saber e define quando passam a conversa para uma pessoa. A gestão e a configuração dos agentes são suas.")}
                  </p>
                  <ul>
                    <li>{t("Agentes de atendimento no WhatsApp")}</li>
                    <li>{t("Base de conhecimento do seu negócio")}</li>
                    <li>{t("Passagem para a equipe quando precisa de gente")}</li>
                  </ul>
                </div>
                <figure className="janela" data-chip={t("A IA atende e passa para a equipe")}>
                  <div className="barra" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <span>{t("Agente de IA")}</span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element -- captura estática, mesma marcação do protótipo */}
                  <img
                    src={`${IMG}/ia-conversa.webp`}
                    alt={t("Agente de IA atendendo uma conversa no CRM")}
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
              <p className="eyebrow">{t("IA com as suas credenciais")}</p>
              <h2>{t("Sua IA, suas chaves, seu controle.")}</h2>
              <p>
                {t("A IA do Arvisx CRM funciona com as credenciais da sua empresa. Você conecta as chaves ou os planos de IA que já tem e usa como quiser.")}
              </p>
            </div>
            <div className="fluxo" aria-label={t("Como a IA se conecta")}>
              <div className="nodo">
                <b>{t("Suas credenciais")}</b>
                <small>{t("Chaves ou planos de IA")}</small>
              </div>
              <span className="seta" aria-hidden="true">
                <ArrowRight {...negrito} />
              </span>
              <div className="nodo destaque">
                <b>Arvisx CRM</b>
                <small>{t("Liga a IA às conversas e ao funil")}</small>
              </div>
              <span className="seta" aria-hidden="true">
                <ArrowRight {...negrito} />
              </span>
              <div className="nodo">
                <b>{t("Atendimento e agentes")}</b>
                <small>{t("No WhatsApp, com a sua equipe")}</small>
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
                <h3>{t("Você conecta")}</h3>
                <p>
                  {t("Cadastre no CRM as chaves de API ou os planos de IA que a sua empresa já contrata. Sem programar.")}
                </p>
              </article>
              <article className="cartao">
                <div className="topo-c">
                  <span className="ic">
                    <SlidersHorizontal {...ico} />
                  </span>
                  <span className="n">02</span>
                </div>
                <h3>{t("Você usa como quiser")}</h3>
                <p>
                  {t("Escolha onde a IA entra: no atendimento, nas respostas, nos agentes. A decisão é da sua empresa.")}
                </p>
              </article>
              <article className="cartao">
                <div className="topo-c">
                  <span className="ic">
                    <Wallet {...ico} />
                  </span>
                  <span className="n">03</span>
                </div>
                <h3>{t("O consumo é seu")}</h3>
                <p>
                  {t("O uso da IA fica na sua conta, com o provedor que você escolheu. Do CRM, você paga só o plano.")}
                </p>
              </article>
            </div>
            <p className="chaves-nota">
              {t("Prefere que a Arvisx desenvolva os agentes para a sua operação? Esse é um serviço à parte, os Agentes Arvisx, contratado depois de uma reunião.")}
            </p>
            <p className="chaves-link">
              <a href="#agentes">{t("Conheça os Agentes Arvisx")}</a>
            </p>
          </div>
        </section>

        <section className="faixa mais claro alt" id="recursos">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">{t("Mais recursos")}</p>
              <h2>{t("E o que ajuda a vender mais.")}</h2>
            </div>
            <div className="grade">
              <article className="cartao">
                <span className="ic">
                  <ClockCountdown {...ico} />
                </span>
                <h3>{t("Clientes parados")}</h3>
                <p>{t("Veja quem está sem resposta e o próximo passo de cada cliente.")}</p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <CheckSquare {...ico} />
                </span>
                <h3>{t("Tarefas e follow-ups")}</h3>
                <p>{t("Lembretes e tarefas ligados a cada cliente, com responsável e prazo.")}</p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <MegaphoneSimple {...ico} />
                </span>
                <h3>{t("Campanhas e prospecção")}</h3>
                <p>
                  {t("Encontre novos contatos, conduza as primeiras abordagens e acompanhe as campanhas.")}
                </p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <ChartBar {...ico} />
                </span>
                <h3>{t("Painel de desempenho")}</h3>
                <p>{t("Acompanhe atendimento, funil e resultados da equipe num só painel.")}</p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <Code {...ico} />
                </span>
                <h3>{t("API, webhooks e MCP")}</h3>
                <p>{t("Conecte o CRM às ferramentas que a sua empresa já usa.")}</p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <ShieldCheck {...ico} />
                </span>
                <h3>{t("Equipe e permissões")}</h3>
                <p>{t("Cada pessoa com o seu login e o seu papel, e as ações ficam registradas.")}</p>
              </article>
            </div>
          </div>
        </section>

        <section className="faixa painel como" id="como-funciona">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">{t("Como começa")}</p>
              <h2>{t("Três passos, e o seu time já está usando.")}</h2>
            </div>
            <div className="passos">
              <article className="cartao passo">
                <h3>{t("Crie a sua conta")}</h3>
                <p>
                  {t("Comece o teste grátis e entre como administrador da sua empresa, com acesso completo ao que o plano oferece.")}
                </p>
              </article>
              <article className="cartao passo">
                <h3>{t("Conecte o WhatsApp")}</h3>
                <p>
                  {t("Conecte o número da empresa e convide a equipe. Usuários e números de WhatsApp são ilimitados.")}
                </p>
              </article>
              <article className="cartao passo">
                <h3>{t("Comece a atender")}</h3>
                <p>
                  {t("As conversas chegam na caixa de entrada, entram no funil e ficam com o histórico completo.")}
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="faixa plano claro alt" id="plano">
          <div className="miolo">
            <div className="cabeca centro">
              <p className="eyebrow">{t("Planos")}</p>
              <h2>{t("Do atendimento à operação inteira com IA.")}</h2>
              <p>
                {t("Todos os planos começam com")}{" "}{t(OFERTA.trial)}.{" "}
                {vitrine.iva ? t("Preços mensais + IVA.") : t("Preços mensais.")}
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
                        {destaque ? <span className="pl-selo">{t("Mais completo")}</span> : null}
                        {plano.inclui_agentes_arvisx ? (
                          <span className="pl-selo forte">
                            <Sparkle {...ico} weight="fill" />{" "}{t("Agentes de IA sob medida")}
                          </span>
                        ) : null}
                      </div>
                      <h3>{plano.nome}</h3>
                      <div className="pl-valor">
                        <strong>{formatCents(plano.preco_cents, plano.moeda)}</strong>
                        <span>
                          {vitrine.iva ? "+ IVA " : ""}
                          {plano.intervalo === "ano" ? t("por ano") : t("por mês")}
                        </span>
                      </div>
                      {plano.descricao_curta ? <p className="pl-promessa">{plano.descricao_curta}</p> : null}
                      {plano.para_quem ? <p className="pl-quem">{plano.para_quem}</p> : null}
                      <p className="pl-limites">
                        {plano.max_canais === null
                          ? t("Canais ilimitados")
                          : comValores(t("Até {n} canais"), { n: plano.max_canais })}{" "}
                        ·{" "}
                        {plano.max_assentos === null
                          ? t("pessoas ilimitadas")
                          : comValores(t("até {n} pessoas"), { n: plano.max_assentos })}
                      </p>
                      {plano.como_funciona ? (
                        <div className="pl-como">
                          <b>{t("Como funciona")}</b>
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
                      {/* Nenhum plano ofertado tem a flag hoje (o Equipe Completa foi arquivado em 12/11/2026;
                          os Agentes Arvisx são serviço à parte). O ramo fica para um plano que a tenha:
                          esse começa pela reunião; os demais, pelo cadastro. */}
                      {plano.inclui_agentes_arvisx ? (
                        <a className="btn primario" href={LINKS.agendar}>
                          {t("Agendar reunião")}
                        </a>
                      ) : (
                        <BotaoDeCadastro className={`btn ${destaque ? "primario" : "secundario"}`} comSeta={false} plano={plano.id} t={t} />
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="planos-vazio">
                <BotaoDeCadastro className="btn primario grande" comSeta t={t} />
              </div>
            )}
            {/* O aviso fixo de quem configura os agentes: o mesmo texto do comparativo dos planos. */}
            <QuemCuidaDosAgentes variante="landing" t={t} />
            <p className="pc-link">
              <a href="#agentes">{t("Agentes de IA sob medida")}</a>
            </p>
          </div>
        </section>

        <section className="faixa ag-arvisx" id="agentes">
          <div className="miolo">
            <div>
              <p className="eyebrow">{t("Agentes Arvisx · Soluções sob medida")}</p>
              <h2>{t("Quer ir além do CRM? Agentes de IA feitos para a sua operação.")}</h2>
              <p className="lede" style={{ marginTop: 16 }}>
                {t("A nossa equipe entende como o seu negócio funciona e")}{" "}
                <strong>{t("desenvolve agentes de IA sob medida")}</strong>{t(", conectados à sua operação: ao Arvisx CRM ou aos sistemas que você já usa. É um serviço contratado à parte, depois de uma conversa, e não depende de plano.")}
              </p>
            </div>
            <div className="passos">
              <article className="passo">
                <h3>{t("Você agenda uma reunião de 30 minutos com o time Arvisx")}</h3>
              </article>
              <article className="passo">
                <h3>{t("Entendemos a sua operação e desenhamos os agentes com você")}</h3>
              </article>
              <article className="passo">
                <h3>{t("Enviamos a proposta, desenvolvemos e conectamos à sua operação")}</h3>
              </article>
            </div>
            <div className="rodape-bloco" data-agentes-arvisx>
              <a className="btn primario" href={LINKS.agendar}>
                {t("Agendar reunião com o time Arvisx")}
              </a>
              <p className="discreta">
                {t("O escopo, o prazo e o valor são combinados na proposta. O nome do assistente é o que você quiser, e o agente se apresenta como assistente virtual.")}
              </p>
            </div>
          </div>
        </section>

        <section className="faixa quem claro" id="para-quem">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">{t("Para quem é")}</p>
              <h2>{t("Para quem vende serviço por conversa.")}</h2>
              <p>
                {t("Negócios em que o cliente chega pelo WhatsApp, precisa de orientação e fecha depois de uma proposta.")}
              </p>
            </div>
            <div className="grade">
              <article className="cartao">
                <span className="ic">
                  <GlobeHemisphereWest {...ico} />
                </span>
                <h3>{t("Assessorias")}</h3>
                <p>{t("Cidadania, vistos, imigração e processos com etapas longas.")}</p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <Scales {...ico} />
                </span>
                <h3>{t("Escritórios")}</h3>
                <p>{t("Advocacia e contabilidade que atendem e fecham pelo WhatsApp.")}</p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <Briefcase {...ico} />
                </span>
                <h3>{t("Consultorias")}</h3>
                <p>{t("Negócios que vendem diagnóstico, projeto e acompanhamento.")}</p>
              </article>
              <article className="cartao">
                <span className="ic">
                  <PuzzlePiece {...ico} />
                </span>
                <h3>{t("Serviços sob medida")}</h3>
                <p>{t("Agências, clínicas e intercâmbio, quando cada cliente é um projeto.")}</p>
              </article>
            </div>
            <p style={{ marginTop: 24, color: "var(--apoio)", fontSize: 16, maxWidth: "60ch" }}>
              {t("Seu nicho não está aqui? Funis, etapas e nomes se ajustam ao seu jeito de vender.")}
            </p>
          </div>
        </section>

        <section className="faixa painel faq claro alt" id="faq">
          <div className="miolo">
            <div className="cabeca">
              <p className="eyebrow">{t("Perguntas frequentes")}</p>
              <h2>{t("O que costumam perguntar antes de fechar.")}</h2>
            </div>
            <div className="lista">
              <details>
                <summary>{t("Quanto custa?")}</summary>
                <p>
                  <span>{quantoCusta}</span>{" "}{t("Os Agentes Arvisx são um serviço à parte, orçado na reunião; nos planos, você configura e gerencia os seus agentes.")}
                </p>
              </details>
              <details>
                <summary>{t("Como funciona o teste grátis?")}</summary>
                <p>
                  {t("Você começa com")}{" "}<span>{t(OFERTA.trial)}</span>{" "}{t("para conhecer o CRM com a sua equipe.")}
                </p>
              </details>
              <details>
                <summary>{t("Preciso saber programar?")}</summary>
                <p>
                  {t("Não. Você cria a conta, conecta o WhatsApp e começa a usar o CRM. Não exige programação.")}
                </p>
              </details>
              <details>
                <summary>{t("Existe limite de usuários ou números?")}</summary>
                <p>
                  {t("Não há cobrança por usuário nem por número de WhatsApp, dentro do uso justo de uma empresa por conta.")}
                </p>
              </details>
              <details>
                <summary>{t("Como funcionam as chamadas de voz e vídeo?")}</summary>
                <p>
                  {t("A chamada de voz acontece pelo WhatsApp, direto do CRM. Ela usa um segundo aparelho vinculado ao número, como o WhatsApp Web. A videochamada é por link: o cliente entra pelo navegador, sem baixar app e sem criar conta.")}
                </p>
              </details>
              <details>
                <summary>{t("Funciona com o WhatsApp comum?")}</summary>
                <p>
                  {t("Sim, por QR code ou pela API oficial da Meta. O QR code é um canal não oficial, com risco de bloqueio como qualquer ferramenta desse tipo. Na API oficial, os custos são cobrados pela própria Meta.")}
                </p>
              </details>
              <details>
                <summary>{t("Como funciona a IA?")}</summary>
                <p>
                  {t("A IA é integrada ao CRM a partir do plano Standard. Você conecta as suas próprias chaves ou planos de IA e é responsável por configurar e gerenciar os seus agentes. O consumo é cobrado pelo seu provedor de IA, nunca pela Arvisx.")}
                </p>
              </details>
              <details>
                <summary>{t("O que são os Agentes Arvisx?")}</summary>
                <p>
                  {t("São agentes de IA desenvolvidos pela nossa equipe depois de entender a sua operação, conectados à sua operação, no Arvisx CRM ou em outros sistemas. É um serviço contratado à parte, por reunião e proposta, e não depende de plano.")}
                </p>
              </details>
              <details>
                <summary>{t("Onde ficam os meus dados?")}</summary>
                <p>{t("Cada empresa fica isolada das outras, com registro de ações.")}</p>
              </details>
              <details>
                <summary>{t("Posso cancelar quando quiser?")}</summary>
                <p>{t("Sim. Você pode cancelar quando quiser.")}</p>
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
              <p>{t("Toda a sua operação de vendas e atendimento em um só CRM.")}</p>
            </div>
            <nav aria-label={t("Rodapé")}>
              <b>{t("Navegue")}</b>
              <a href="#crm">{t("O CRM")}</a>
              <a href="#chamadas">{t("Chamadas de voz e vídeo")}</a>
              <a href="#plano">{t("Preço")}</a>
              <a href="#agentes">Agentes Arvisx</a>
              <a href="#para-quem">{t("Para quem é")}</a>
              <a href="#faq">{t("Perguntas frequentes")}</a>
            </nav>
            <nav className="legal" aria-label={t("Legal")}>
              <b>{t("Legal")}</b>
              <a href={LINKS.termos}>{t("Termos de Serviço")}</a>
              <a href={LINKS.privacidade}>{t("Política de Privacidade")}</a>
              <a href={LINKS.exclusaoDeDados}>{t("Exclusão de Dados")}</a>
            </nav>
          </div>
          <div className="base">
            <span>
              {t("Arvisx CRM — CRM de vendas e atendimento. © 2026 Arvisx AI. Todos os direitos reservados.")}
            </span>
            <span>
              {t("Arvisx CRM é um produto da")}{" "}<a href={LINKS.site}>Arvisx AI</a>{t(". O elo inteligente do seu ecossistema.")}
            </span>
          </div>
        </div>
      </footer>
      <AvisoDeCookies />
      <InteracoesDaLanding />
    </div>
    </IdiomaProvider>
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
