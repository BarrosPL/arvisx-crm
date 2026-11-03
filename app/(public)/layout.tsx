import { LogotipoDoProduto } from "@/components/branding/MarcaDoProduto";
import { Inbox, Kanban, ShieldCheck } from "@/lib/ui/icons";
import { marcaEhADoProduto } from "@/lib/branding";
import { marcaDaSaida } from "@/lib/branding/saida";
import { createClient } from "@/lib/supabase/server";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { traduzir } from "@/lib/i18n/dicionario";

import "./fachada.css";

/**
 * A casca das telas de acesso — login, cadastro, recuperação, MFA, confirmar acesso.
 *
 * ── Por que o LOGO mora aqui, e não em `login/page.tsx` ───────────────────────
 *
 * São sete telas no grupo `(public)`, e todas são "antes de entrar": quem instala
 * o produto para clientes mostra a marca dele exatamente aí. Um `<img>` por
 * página seriam sete cópias que divergem na primeira vez que alguém mexer numa
 * só — e a que ficaria para trás é sempre a que ninguém abre (recuperação de
 * senha, cadastro de MFA), que é justamente onde o cliente do revendedor
 * aparece sozinho e sem contexto.
 *
 * ── Por que `marcaDaSaida(null)` ──────────────────────────────────────────────
 *
 * Aqui não existe organização resolvida: `null` é a declaração disso, e a pilha
 * resultante é a mesma do layout raiz (banco acima, `.env` embaixo). Montar a
 * pilha à mão nesta tela faria a fachada anunciar uma precedência que o resto do
 * produto não usa. E `marcaDaSaida` NUNCA lança (ver o cabeçalho dela): uma cor
 * ou um logo mal gravados não podem derrubar a única tela por onde se entra para
 * corrigi-los.
 *
 * Sem logo configurado E com o nome padrão, a fachada mostra o logotipo do
 * PRODUTO (`components/branding/MarcaDoProduto.tsx`) — inline, sem `<img>`,
 * para que `tests/e2e/marca-logo.spec.ts` continue medindo "a fachada está sem
 * `<img>`" como "sem logo do revendedor".
 *
 * O conteúdo de cada página resolve o próprio nome. A tela de login usa
 * `marcaDaSaida(null)`, como o título da aba, para que a marca alterada pela
 * instalação apareça também sob o botão "Entrar"; a casca usa a mesma resolução
 * para logo e tema.
 *
 * Com o login e a aba na MESMA pilha, `tests/e2e/icone-da-marca.spec.ts` deixou
 * de cruzar duas resoluções independentes: ele só prova que as duas concordam.
 * O que ancora o nome numa verdade de fora da pilha é o caso "o nome trocado em
 * /admin/marca…" de `tests/e2e/marca-logo.spec.ts`, que digita o nome na tela e
 * o confere no login de quem não entrou. Não apague um sem o outro.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const marca = await marcaDaSaida(null);
  // A maioria destas telas roda ANTES do login (não há usuário nenhum), mas
  // duas — `/login/mfa` e, em parte, `/login/recovery` — rodam com uma sessão
  // parcial já criada (primeiro fator verificado, segundo pendente). Onde há
  // sessão, o idioma salvo no perfil vale; sem ela, o do navegador (Accept-Language),
  // pela MESMA função das páginas (`idiomaDoVisitante`). Com o perfil só, quem chegava
  // sem sessão via o servidor no idioma do navegador e os formulários do cliente
  // (cadastro, login, senha) no padrão pt-BR do provider.
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
      {/*
        ArvisX: a fachada é dividida — um painel navy com a marca e a frase da
        casa, e o formulário no claro. No celular o painel vira uma faixa no
        topo. O bloco do logo (chip `dark:bg-white`, `data-testid`) e o
        `LogotipoDoProduto` continuam os mesmos: os testes de marca medem por eles.

        `data-theme="light"` AQUI, e não no `<html>`: a fachada é a vitrine da
        marca e tem uma aparência só — painel navy, formulário claro —, não
        segue o tema do sistema de quem chega (com o Windows escuro ela ficava
        inteira preta). Os tokens do tema claro são declarados por
        `[data-theme="light"]` em app/globals.css, então a subárvore os herda;
        o `color-scheme` acompanha para os controles nativos (campo, autofill,
        barra de rolagem). As variantes `dark:` do chip do logo seguem o
        `<html>`, como antes: o painel é escuro nos dois temas e o chip claro
        continua sendo medido por tests/e2e/logo-moldura-no-tema-escuro.spec.ts.
      */}
      <div
        data-theme="light"
        className="grid min-h-screen grid-cols-1 bg-background text-text [color-scheme:light] lg:grid-cols-[1.1fr_1fr]"
      >
        <section className="fachada-painel relative flex flex-col justify-between gap-6 overflow-hidden bg-sidebar px-6 py-7 text-white lg:px-14 lg:py-10">
          <div className="relative z-[1] flex justify-start [&_img]:max-h-12">
            {marca.logoUrl || marca.logoDarkUrl ? (
              <div className="flex justify-start">
                {/*
                <img> em vez de next/image pelo mesmo motivo da barra lateral: a URL
                é de quem hospeda e o `next/image` exige allowlist de domínios
                fechada em BUILD — a imagem pré-buildada do self-host recusaria o
                domínio do operador. Altura máxima de 80 px e largura máxima de 192 px, sem distorcer
                arte de proporção desconhecida nem ampliar arquivos pequenos.

                O `alt` é o nome DESTA resolução (`marca.nome`), e não o de
                `branding()`: é a legenda da imagem que está ali, e nomeá-la com a
                marca de outra fonte descreveria uma marca que não é a do logo.

                O `data-testid` é lido por `tests/e2e/marca-logo.spec.ts`, que prova
                que o logo da EMPRESA não vaza para cá. Sem ele a spec caía na
                "primeira <img> da página", e uma asserção de negação com seletor
                largo passa sozinha assim que outra imagem entra na tela.
              */}
                <div
                  className={
                    marca.logoDarkUrl
                      ? "rounded-md"
                      : "rounded-md dark:bg-white dark:px-3 dark:py-2 dark:shadow-sm"
                  }
                >
                  {marca.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      data-testid="logo-da-fachada"
                      src={marca.logoUrl}
                      alt={marca.nome}
                      className={
                        marca.logoDarkUrl
                          ? "h-auto max-h-20 w-auto max-w-[12rem] object-contain dark:hidden"
                          : "h-auto max-h-20 w-auto max-w-[12rem] object-contain"
                      }
                    />
                  ) : (
                    <span className="dark:hidden">{marca.nome}</span>
                  )}
                  {marca.logoDarkUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      data-testid="logo-escuro-da-fachada"
                      src={marca.logoDarkUrl}
                      alt={marca.nome}
                      className="hidden h-auto max-h-20 w-auto max-w-[12rem] object-contain dark:block"
                    />
                  ) : null}
                </div>
              </div>
            ) : marcaEhADoProduto({ name: marca.nome, logoUrl: null }) ? (
              <div className="flex justify-start">
                <LogotipoDoProduto nome={marca.nome} sobreEscuro className="h-10 w-auto" />
              </div>
            ) : null}
          </div>
          <div className="relative z-[1] hidden lg:block">
            <p className="mb-4 flex items-center gap-2 font-mono text-[10.5px] tracking-[0.18em] text-cta uppercase before:h-1.5 before:w-1.5 before:rounded-full before:bg-cta">
              {t("O CRM da ArvisX")}
            </p>
            <p className="max-w-[14ch] font-display text-4xl leading-[1.05] font-semibold tracking-[-0.03em] text-white">
              {t("O WhatsApp chega.")}
              <br />
              {t("A")}{" "}
              <span className="bg-[linear-gradient(100deg,#f1d47c,#d4af37_45%,#b87a2e)] bg-clip-text text-transparent">
                {t("IA")}
              </span>{" "}
              {t("atende e vende.")}
            </p>
            <p className="mt-4 max-w-[34ch] text-[15px] text-sidebar-foreground">
              {t(
                "Agentes de IA que atendem, qualificam e vendem no WhatsApp, dentro do CRM da sua empresa.",
              )}
            </p>
            <div className="relative mt-6 h-px w-28 bg-sidebar-border after:absolute after:top-[-3px] after:left-0 after:h-[7px] after:w-[7px] after:rounded-full after:bg-cta" />
          </div>
          <ul className="relative z-[1] hidden gap-2.5 text-sm text-sidebar-foreground lg:grid">
            <li className="flex items-center gap-2.5">
              <Inbox size={18} className="text-cta" aria-hidden />
              {t("Inbox com a IA e a equipe lado a lado")}
            </li>
            <li className="flex items-center gap-2.5">
              <Kanban size={18} className="text-cta" aria-hidden />
              {t("Funil, agenda e propostas no mesmo lugar")}
            </li>
            <li className="flex items-center gap-2.5">
              <ShieldCheck size={18} className="text-cta" aria-hidden />
              {t("Seus dados no seu servidor, com LGPD")}
            </li>
          </ul>
          {/*
            O serviço em si, no lugar de uma marca d'água: um cartão de WhatsApp
            em que o lead escreve, o agente responde e o CRM registra o lead no
            funil, em loop (app/(public)/fachada.css). Decorativo (`aria-hidden`)
            e sem <img>: a fachada "sem <img>" é como tests/e2e/marca-logo.spec.ts
            mede "sem logo de revendedor". Só no desktop; no celular o painel é
            uma faixa com o logo.
          */}
          <div aria-hidden className="fa-telefone hidden lg:block">
            <div className="fa-cabeca">
              <span className="fa-avatar">M</span>
              <div className="fa-quem">
                <b>Marina Costa</b>
                <span>{t("Agente de IA atendendo")}</span>
              </div>
              <svg
                className="fa-zap"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 20l1.5-4.5A8 8 0 1 1 8.5 18.5z" />
              </svg>
            </div>
            <div className="fa-conversa">
              <div className="fa-msg fa-lead">
                <div className="fa-miolo">
                  {t("Oi! Vi o anúncio de vocês. Como funciona e quanto custa?")}
                </div>
              </div>
              <div className="fa-msg fa-digitando">
                <div className="fa-miolo">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
              <div className="fa-msg fa-ia">
                <div className="fa-miolo">
                  <b>{t("Agente de IA")}</b>
                  {t(
                    "Oi, Marina! Que bom que chegou. Me conta o que você precisa, que eu já te explico como funciona e te passo os valores?",
                  )}
                </div>
              </div>
              <div className="fa-msg fa-toast">
                <div className="fa-miolo">
                  <i>&#10003;</i>
                  <span>
                    {t("Lead criado no funil")}{" "}
                    <em>
                      {t("Vendas")} &middot; {t("Primeiro contato")}
                    </em>
                  </span>
                </div>
              </div>
            </div>
          </div>
          <span
            aria-hidden
            className="fa-ponto absolute top-[22%] right-[18%] hidden h-2 w-2 rounded-full bg-cta shadow-[0_0_18px_4px_rgba(212,175,55,0.35)] lg:block"
          />
          <span
            aria-hidden
            className="fa-ponto absolute right-[36%] bottom-[30%] hidden h-[5px] w-[5px] rounded-full bg-cta shadow-[0_0_18px_4px_rgba(212,175,55,0.35)] lg:block"
          />
          <span
            aria-hidden
            className="fa-ponto absolute top-[36%] right-[52%] hidden h-1 w-1 rounded-full bg-cta opacity-70 shadow-[0_0_18px_4px_rgba(212,175,55,0.35)] lg:block"
          />
          <p className="hidden font-mono text-[11px] tracking-[0.08em] text-sidebar-muted uppercase lg:block">
            {marca.nome}
          </p>
        </section>
        <div className="flex items-center justify-center p-6 lg:p-10">
          <div className="w-full max-w-sm space-y-6">{children}</div>
        </div>
      </div>
    </IdiomaProvider>
  );
}
