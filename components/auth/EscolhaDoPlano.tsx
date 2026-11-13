"use client";

import Link from "next/link";
import { createContext, useContext, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import type { CartaoDePlano } from "@/lib/cobranca/cartoes-do-cadastro";
import { formatCents } from "@/lib/money";
import { Check, X } from "@/lib/ui/icons";

/**
 * O PLANO QUE A PESSOA ESCOLHEU NO PRIMEIRO PASSO DO CADASTRO.
 *
 * `null` fora do cadastro em dois passos (convite, instalação sem plano
 * oferecido, testes do formulário sozinho): aí o `SignupForm` segue como era.
 */
interface PlanoEscolhido {
  plano: CartaoDePlano;
  trocar: () => void;
}

const Contexto = createContext<PlanoEscolhido | null>(null);

export function usePlanoEscolhido(): PlanoEscolhido | null {
  return useContext(Contexto);
}

/** "/ mês" ou "/ ano", como o seletor antigo dizia. */
function periodo(plano: CartaoDePlano, t: (s: string) => string): string {
  return plano.intervalo === "ano" ? t("ano") : t("mês");
}

/**
 * O CADASTRO EM DOIS PASSOS: primeiro o plano, depois os dados.
 *
 * O plano era uma lista suspensa no meio do formulário, com o mais barato já
 * marcado, e quase todo cadastro saía nele (ver `lib/cobranca/cartoes-do-cadastro.ts`).
 * Aqui a escolha vem ANTES e é sempre da pessoa: nenhum cartão nasce marcado. O
 * formulário (os `children`) só é montado depois da escolha, e lê o plano por
 * `usePlanoEscolhido`.
 *
 * O texto convida a testar, e não a assinar (decisão do dono, 13/11/2026): a
 * pessoa escolhe o plano que se encaixa, testa, e só no fim do teste, se gostar,
 * faz a assinatura. Nada aqui diz "você só paga depois".
 *
 * O primeiro passo cobre a tela inteira, por cima da fachada dividida: três
 * cartões lado a lado não cabem na coluna do formulário. Ele continua DENTRO da
 * fachada no DOM, e por isso herda o tema claro dela.
 *
 * Sem plano para mostrar, o componente é transparente: desenha os `children`.
 */
export function EscolhaDoPlano({
  planos,
  planoInicial = null,
  cabecalho,
  children,
}: {
  planos: readonly CartaoDePlano[];
  /** O plano que a página inicial mandou na URL: pula o primeiro passo. */
  planoInicial?: string | null;
  /** A marca, já desenhada pelo servidor. */
  cabecalho?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const [escolhidoId, setEscolhidoId] = useState<string | null>(planoInicial);
  const [comparando, setComparando] = useState(false);

  if (planos.length === 0) return <>{children}</>;

  const escolhido = planos.find((p) => p.id === escolhidoId) ?? null;
  if (escolhido) {
    return (
      <Contexto.Provider value={{ plano: escolhido, trocar: () => setEscolhidoId(null) }}>
        {children}
      </Contexto.Provider>
    );
  }

  const algumComIa = planos.some((p) => p.temIa === true);
  const maiorTeste = Math.max(...planos.map((p) => p.trial_dias));
  const colunas = planos.length >= 3 ? "lg:grid-cols-3" : planos.length === 2 ? "lg:grid-cols-2" : "";
  const limite = (valor: number | null) => (valor === null ? t("Ilimitado") : String(valor));

  return (
    <div
      data-testid="escolha-do-plano"
      className="fixed inset-0 z-50 overflow-y-auto bg-background text-text"
    >
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        {cabecalho}
        <p className="mt-6 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <span className="text-foreground">1 · {t("Plano")}</span>
          <span aria-hidden className="mx-2 inline-block h-px w-7 bg-border align-middle" />
          2 · {t("Seus dados")}
        </p>
        <div className="mx-auto mt-5 max-w-2xl text-center">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("Qual plano se encaixa no seu caso?")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            {maiorTeste > 0
              ? t(
                  "Escolha o que melhor se encaixa no seu caso e teste por {n} dias. No fim do teste, se gostar, você faz a sua assinatura.",
                ).replace("{n}", String(maiorTeste))
              : t("Escolha o que melhor se encaixa no seu caso.")}
          </p>
        </div>

        <ul className={`mt-8 grid grid-cols-1 gap-4 ${colunas}`}>
          {planos.map((plano) => (
            <li
              key={plano.id}
              data-plano={plano.id}
              className={
                "relative flex flex-col gap-3 rounded-lg border-2 bg-surface p-5 " +
                (plano.recomendado ? "border-[var(--color-cta)] shadow-md" : "border-border")
              }
            >
              {plano.recomendado ? (
                <span className="absolute -top-3 left-4 rounded-full bg-[var(--color-cta)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-cta-fg)]">
                  {t("Recomendado")}
                </span>
              ) : null}
              {/* Nome e textos do plano são dado de quem opera a instalação: saem crus, sem `t()`. */}
              <div>
                <h2 className="text-xl font-semibold tracking-tight">{plano.nome}</h2>
                {plano.descricao_curta ? (
                  <p className="mt-1 text-sm font-semibold">{plano.descricao_curta}</p>
                ) : null}
                {plano.para_quem ? (
                  <p className="mt-1 text-sm text-muted-foreground">{plano.para_quem}</p>
                ) : null}
              </div>
              <p className="flex flex-wrap items-baseline gap-x-2 border-y py-3">
                <span className="text-2xl font-semibold tracking-tight">
                  {formatCents(plano.preco_cents, plano.moeda)}
                </span>
                <span className="text-sm text-muted-foreground">
                  / {periodo(plano, t)}
                  {plano.trial_dias > 0 ? ` · ${plano.trial_dias} ${t("dias de teste")}` : ""}
                </span>
              </p>
              <ul className="space-y-1.5 text-sm">
                {plano.destaques.map((destaque) => (
                  <li key={destaque} className="flex items-start gap-2">
                    <Check size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
                    <span>{destaque}</span>
                  </li>
                ))}
                {plano.temIa === false && algumComIa ? (
                  <li className="flex items-start gap-2 text-muted-foreground">
                    <X size={16} className="mt-0.5 shrink-0" aria-hidden />
                    <span>{t("Não tem agentes de IA")}</span>
                  </li>
                ) : null}
              </ul>
              <div className="mt-auto pt-2">
                <Button
                  type="button"
                  variant={plano.recomendado ? "default" : "outline"}
                  className="w-full"
                  onClick={() => setEscolhidoId(plano.id)}
                >
                  {plano.trial_dias > 0
                    ? t("Testar o {plano} por {n} dias")
                        .replace("{plano}", plano.nome)
                        .replace("{n}", String(plano.trial_dias))
                    : t("Escolher o {plano}").replace("{plano}", plano.nome)}
                </Button>
              </div>
            </li>
          ))}
        </ul>

        {planos.length > 1 ? (
          <div className="mt-4">
            <button
              type="button"
              aria-expanded={comparando}
              onClick={() => setComparando((v) => !v)}
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              {comparando ? t("Esconder a comparação") : t("Comparar os planos")}
            </button>
            {comparando ? (
              <div className="mt-3 overflow-x-auto rounded-md border bg-surface">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 font-medium" />
                      {planos.map((p) => (
                        <th key={p.id} className="px-3 py-2 font-medium">
                          {p.nome}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="px-3 py-2">{t("Preço")}</td>
                      {planos.map((p) => (
                        <td key={p.id} className="px-3 py-2">
                          {formatCents(p.preco_cents, p.moeda)} / {periodo(p, t)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b">
                      <td className="px-3 py-2">{t("Teste grátis")}</td>
                      {planos.map((p) => (
                        <td key={p.id} className="px-3 py-2">
                          {p.trial_dias > 0 ? `${p.trial_dias} ${t("dias")}` : t("sem período de teste")}
                        </td>
                      ))}
                    </tr>
                    {planos.every((p) => p.temIa !== null) ? (
                      <tr className="border-b">
                        <td className="px-3 py-2">{t("Agentes de IA")}</td>
                        {planos.map((p) => (
                          <td
                            key={p.id}
                            className={"px-3 py-2 " + (p.temIa ? "font-semibold text-emerald-700" : "text-muted-foreground")}
                          >
                            {p.temIa ? t("Sim") : t("Não")}
                          </td>
                        ))}
                      </tr>
                    ) : null}
                    <tr className="border-b">
                      <td className="px-3 py-2">{t("Números conectados")}</td>
                      {planos.map((p) => (
                        <td key={p.id} className="px-3 py-2">
                          {limite(p.max_canais)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="px-3 py-2">{t("Pessoas")}</td>
                      {planos.map((p) => (
                        <td key={p.id} className="px-3 py-2">
                          {limite(p.max_assentos)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}

        <p className="mt-8 text-center text-sm text-muted-foreground">
          {t("Já tem conta?")}{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
            {t("Entrar")}
          </Link>
        </p>
      </div>
    </div>
  );
}
