"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { concluirOnboarding } from "@/app/actions/onboarding/finishOnboarding";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { TELA_DE_ENTRADA, type MissaoDoGuia } from "@/lib/onboarding/guia";

/** A missão como o painel a desenha: com o rótulo e o nome do menu já no idioma. */
export interface MissaoNaTela extends MissaoDoGuia {
  /** O nome que a tela tem no menu — o que a pessoa procura para clicar. */
  menu: string;
}

/** O título e a explicação de cada missão — os mesmos textos das telas do wizard. */
const TEXTOS: Record<string, { titulo: [string, string]; descricao: [string, string] }> = {
  "connect-whatsapp": {
    titulo: ["Dê um telefone a ele", "Conecte o seu WhatsApp"],
    descricao: [
      "É por este número que ele vai atender seus clientes. Se você conecta pelo celular, tenha ele por perto.",
      "É por este número que a sua equipe vai atender os clientes. Se você conecta pelo celular, tenha ele por perto.",
    ],
  },
  "connect-nuvemshop": {
    titulo: ["Sua loja", "Sua loja"],
    descricao: [
      "Importe pedidos, clientes e produtos da sua loja Nuvemshop.",
      "Importe pedidos, clientes e produtos da sua loja Nuvemshop.",
    ],
  },
  "setup-ai": {
    titulo: ["Treine seu funcionário", "Treine seu funcionário"],
    descricao: [
      "Quem ele é, como fala e o que pode prometer. Dá para mudar tudo depois.",
      "Quem ele é, como fala e o que pode prometer. Dá para mudar tudo depois.",
    ],
  },
  funil: {
    titulo: ["Onde ele organiza seus clientes", "Seu funil de clientes"],
    descricao: [
      "Cada cliente vira um cartão que anda por essas colunas. Ele mesmo move o cartão conforme a conversa avança — por isso cada coluna diz também quando ele deve usá-la.",
      "Cada cliente vira um cartão que anda por essas colunas. Você e a equipe movem o cartão conforme a conversa avança.",
    ],
  },
  testar: {
    titulo: ["Veja ele atender", "Veja ele atender"],
    descricao: [
      "Escreva como se fosse um cliente. Nada é enviado pelo WhatsApp — é só um ensaio, entre você e ele.",
      "Escreva como se fosse um cliente. Nada é enviado pelo WhatsApp — é só um ensaio, entre você e ele.",
    ],
  },
  "invite-team": {
    titulo: ["Quem trabalha com ele", "Sua equipe"],
    descricao: [
      "Seu funcionário não trabalha sozinho: quando ele passar uma conversa adiante, é uma dessas pessoas que atende.",
      "Quem vai atender as conversas com você.",
    ],
  },
};

/** Classe posta no item do menu que o guia manda clicar. */
const CLASSE_DO_ALVO = "guia-alvo";

/** A partir desta largura o painel tem lugar próprio ao lado do conteúdo. */
const TELA_LARGA = "(min-width: 1024px)";

function assinarLargura(avisar: () => void): () => void {
  const consulta = window.matchMedia(TELA_LARGA);
  consulta.addEventListener("change", avisar);
  return () => consulta.removeEventListener("change", avisar);
}

/** A tela é larga? No servidor responde que sim: é o caso que não esconde nada. */
function useTelaLarga(): boolean {
  return useSyncExternalStore(
    assinarLargura,
    () => window.matchMedia(TELA_LARGA).matches,
    () => true,
  );
}

/**
 * O PAINEL DO GUIA — fixo no canto, por cima de qualquer tela do CRM.
 *
 * Ele faz três coisas, e só três: mostra em que pé está cada missão, diz o
 * próximo clique, e acende no menu o item que a pessoa procura. O passo em si é
 * feito no quadro que a tela da missão mostra no topo (`BlocoDoGuia`) — a
 * exceção é o ensaio, que não tem tela própria e roda aqui dentro.
 *
 * Não decide ordem nem conclusão: recebe as missões prontas do servidor. Quando
 * uma action do wizard grava um passo, o redirecionamento refaz o layout e o
 * painel chega com a lista nova.
 *
 * ⚠️ O PAINEL NUNCA COBRE O QUE A PESSOA PRECISA CLICAR. Medido na primeira
 * passada pela tela: flutuando sobre o conteúdo, ele ficava em cima do botão
 * "Usar este quadro" e o clique não chegava. Por isso, em tela larga o `<main>`
 * cede uma faixa à direita enquanto o painel está aberto; e em tela estreita,
 * onde não há faixa para ceder, ele nasce recolhido quando a pessoa já está na
 * tela do passo — ali quem importa é o quadro, não o painel.
 */
export function GuiaFlutuante({
  missoes,
  iaNoPlano,
  noAr,
  ensaio,
}: {
  missoes: MissaoNaTela[];
  iaNoPlano: boolean;
  /** Existe agente publicado? Decide a frase do fim, como na tela final do wizard. */
  noAr: boolean;
  /** O ensaio do agente, já montado no servidor — só vem no passo dele. */
  ensaio: ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  // `null` = a pessoa não escolheu; vale o automático, calculado abaixo.
  const [escolha, setEscolha] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();
  // O painel some NO CLIQUE de "Começar a usar" e a página é recarregada quando
  // a conclusão responde. Um `redirect` da action para dentro do mesmo layout
  // não refaz o layout: medido pela tela, o painel continuava ali com a empresa
  // já pronta no banco. Por isso o fim usa `concluirOnboarding` (sem `redirect`)
  // e uma carga inteira. Se a conclusão recusar, o painel volta.
  const [encerrado, setEncerrado] = useState(false);
  const telaLarga = useTelaLarga();

  const atual = missoes.find((m) => m.estado === "atual") ?? null;
  const resolvidas = missoes.filter((m) => m.estado === "feita" || m.estado === "pulada").length;
  const naTela = atual ? pathname === atual.href || pathname.startsWith(`${atual.href}/`) : false;
  // O ensaio roda dentro do painel: não há tela para onde mandar a pessoa.
  const pedeTela = Boolean(atual) && !naTela && atual?.segmento !== "testar";
  const alvo = pedeTela ? (atual?.href ?? null) : null;
  const aberto = escolha ?? (telaLarga || !naTela || atual?.segmento === "testar");
  const setAberto = (valor: boolean) => setEscolha(valor);

  /**
   * Acende no menu o item da tela que o guia pede. Só os links VISÍVEIS: o menu
   * do computador e a barra do celular coexistem no DOM, e um deles está
   * escondido. Repete num intervalo curto porque o menu pode montar depois (o
   * grupo recolhido que abre, a gaveta do celular).
   */
  useEffect(() => {
    if (!alvo) return;
    let marcados: HTMLElement[] = [];
    const desmarcar = () => {
      for (const el of marcados) el.classList.remove(CLASSE_DO_ALVO);
      marcados = [];
    };
    const marcar = () => {
      desmarcar();
      marcados = Array.from(document.querySelectorAll<HTMLElement>(`a[href="${alvo}"]`)).filter(
        (el) => !el.closest("[data-guia-do-onboarding]") && el.offsetParent !== null,
      );
      for (const el of marcados) el.classList.add(CLASSE_DO_ALVO);
    };
    marcar();
    const intervalo = window.setInterval(marcar, 1500);
    return () => {
      window.clearInterval(intervalo);
      desmarcar();
    };
  }, [alvo]);

  /** Na tela da missão, traz o quadro do passo para a vista. */
  useEffect(() => {
    if (!naTela) return;
    document.querySelector("[data-bloco-do-guia]")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [naTela, pathname]);

  const variante = iaNoPlano ? 0 : 1;
  const textos = atual ? TEXTOS[atual.segmento] : undefined;

  // A frase do fim é a da tela final do wizard (`app/onboarding/done/_client.tsx`):
  // quem decide "está no ar" é o banco, não a contagem de pendências.
  const pendentes = missoes.filter((m) => m.estado !== "feita").length;
  const semIa = missoes.some((m) => m.segmento === "setup-ai" && m.estado !== "feita");
  const tituloDoFim = !iaNoPlano || noAr ? t("Tudo pronto!") : t("Quase lá!");
  const resumoDoFim = !iaNoPlano
    ? pendentes === 0
      ? t("Sua empresa está pronta: conecte, atenda e acompanhe tudo pelo Inbox.")
      : t("Sua empresa já pode começar. O que ficou para depois continua te esperando.")
    : !noAr
      ? semIa
        ? t("O passo da IA ficou para depois: ele ainda não foi treinado nem colocado no ar.")
        : t("Ele já foi treinado, mas o atendimento ainda não foi publicado — ele segue em rascunho.")
      : pendentes === 0
        ? t("Seu funcionário está montado. Daqui em diante é só acompanhar.")
        : t("Seu funcionário já está de pé. O que ficou para depois continua te esperando.");

  if (encerrado) return null;

  return (
    <aside
      data-guia-do-onboarding
      data-aberto={aberto ? "true" : "false"}
      aria-label={t("Guia de montagem")}
      className="fixed bottom-20 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] md:bottom-4"
    >
      {/*
        O destaque do menu. Mora aqui, e não em `globals.css`, porque só existe
        enquanto o guia existe. A cor é a de ação da marca: instalação de
        revendedor acende o menu na cor dela.
      */}
      <style>{`.${CLASSE_DO_ALVO}{outline:2px solid var(--color-cta);outline-offset:2px;border-radius:0.5rem;animation:guia-pulso 1.3s ease-out infinite}@keyframes guia-pulso{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--color-cta) 60%,transparent)}100%{box-shadow:0 0 0 10px transparent}}@media (prefers-reduced-motion:reduce){.${CLASSE_DO_ALVO}{animation:none}}@media ${TELA_LARGA}{main:has([data-guia-do-onboarding][data-aberto="true"]){padding-right:24.5rem}}`}</style>

      {!aberto ? (
        <div className="flex justify-end">
          <Button type="button" onClick={() => setAberto(true)} className="shadow-lg">
            {t("Abrir o guia")} · {resolvidas}/{missoes.length}
          </Button>
        </div>
      ) : (
        <div className="flex max-h-[min(40rem,calc(100dvh-8rem))] flex-col overflow-hidden rounded-lg border bg-surface shadow-lg">
          <header className="border-b p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("Guia de montagem")} · {resolvidas}/{missoes.length}
                </p>
                <h2 className="mt-1 text-base font-semibold tracking-tight">{t("Montando o seu CRM")}</h2>
              </div>
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="shrink-0 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                {t("Recolher o guia")}
              </button>
            </div>
            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={missoes.length}
              aria-valuenow={resolvidas}
            >
              <div
                className="h-full rounded-full bg-[var(--color-cta)] transition-[width] duration-500"
                style={{ width: `${missoes.length ? (resolvidas / missoes.length) * 100 : 100}%` }}
              />
            </div>
          </header>

          <div className="space-y-4 overflow-y-auto p-4">
            <ol className="space-y-1.5 text-sm">
              {missoes.map((m) => (
                <li key={m.segmento} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={
                      "inline-block h-2 w-2 shrink-0 rounded-full " +
                      (m.estado === "feita"
                        ? "bg-emerald-500"
                        : m.estado === "atual"
                          ? "bg-[var(--color-cta)]"
                          : "bg-muted-foreground/30")
                    }
                  />
                  <span className={m.estado === "atual" ? "font-medium" : "text-muted-foreground"}>
                    {m.rotulo}
                    {m.estado === "pulada" ? ` (${t("você pulou")})` : ""}
                  </span>
                </li>
              ))}
            </ol>

            {atual && textos ? (
              <section className="space-y-3 rounded-md border bg-background p-4">
                <div>
                  <h3 className="text-sm font-semibold">{t(textos.titulo[variante])}</h3>
                  {/* Na tela do passo a explicação já está no quadro: aqui ela só repetiria. */}
                  {naTela && atual.segmento !== "testar" ? null : (
                    <p className="mt-1 text-xs text-muted-foreground">{t(textos.descricao[variante])}</p>
                  )}
                </div>
                {atual.segmento === "testar" ? (
                  ensaio
                ) : naTela ? (
                  <p className="border-l-2 border-[var(--color-cta)] pl-3 text-sm">
                    {t("Faça este passo no quadro em destaque, no topo desta tela.")}
                  </p>
                ) : (
                  <>
                    <p className="border-l-2 border-[var(--color-cta)] pl-3 text-sm">
                      {t("Este passo é feito na tela {tela}. Clique nela no menu, ou no botão abaixo.").replace(
                        "{tela}",
                        atual.menu,
                      )}
                    </p>
                    <Button asChild className="w-full">
                      <Link href={atual.href}>{t("Ir para {tela}").replace("{tela}", atual.menu)}</Link>
                    </Button>
                  </>
                )}
              </section>
            ) : null}

            {!atual ? (
              <section className="space-y-3 rounded-md border bg-background p-4 text-center">
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">{tituloDoFim}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{resumoDoFim}</p>
                  {!iaNoPlano ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      <a href="/app/settings/billing" className="underline underline-offset-2">
                        {t("Agentes de IA estão nos planos Standard e Premium.")}
                      </a>
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  disabled={pending}
                  className="w-full"
                  onClick={() => {
                    setEncerrado(true);
                    startTransition(async () => {
                      const res = await concluirOnboarding();
                      if (!res.ok) {
                        setEncerrado(false);
                        toast.error(`${t("Falha:")} ${res.error}`);
                        return;
                      }
                      window.location.assign(TELA_DE_ENTRADA);
                    });
                  }}
                >
                  {pending ? t("Finalizando...") : t("Começar a usar")}
                </Button>
              </section>
            ) : null}
          </div>
        </div>
      )}
    </aside>
  );
}
