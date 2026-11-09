"use client";

import Link from "next/link";
import type { Route } from "next";

import { FotoAnotada } from "@/components/ajuda/FotoAnotada";
import { hrefDaLicao } from "@/lib/ajuda/treinamento/busca";
import type { NichoDoTreinamento } from "@/lib/ajuda/treinamento/conteudo";

import { useTelasVisiveis } from "./visibilidade";

export type IndiceDeLicoes = Record<
  string,
  { titulo: string; tela: string; licoes: Record<string, string> }
>;

/** Os quatro momentos de cada história, na ordem do pacote. */
const MOMENTO: Record<string, string> = {
  chegada: "Chegada",
  qualificacao: "Qualificação",
  acao: "Ação",
  continuidade: "Continuidade",
};

export function ConteudoDoNicho({
  nicho,
  licoes,
}: {
  nicho: NichoDoTreinamento;
  licoes: IndiceDeLicoes;
}) {
  const visiveis = useTelasVisiveis();

  return (
    <article className="flex flex-col gap-10">
      <header className="flex flex-col gap-2 border-b pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-cta-forte)]">
          Histórias por nicho
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{nicho.titulo}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{nicho.resumo}</p>
      </header>

      {nicho.jornadas.map((j) => (
        <section
          key={j.id}
          id={`historia-${j.id}`}
          aria-labelledby={`historia-${j.id}-titulo`}
          className="flex scroll-mt-4 flex-col gap-5"
        >
          <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5">
            <h2 id={`historia-${j.id}-titulo`} className="text-xl font-semibold tracking-tight">
              {j.titulo}
            </h2>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
              <dt className="font-medium">Empresa</dt>
              <dd className="text-muted-foreground">{j.empresa}</dd>
              <dt className="font-medium">Contexto</dt>
              <dd className="text-muted-foreground">{j.contexto}</dd>
              <dt className="font-medium">Resultado</dt>
              <dd className="text-muted-foreground">{j.resultado}</dd>
            </dl>
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{j.nota}</p>
          </div>

          <ol className="flex flex-col gap-6">
            {j.cenas.map((c, i) => (
              <li key={c.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5">
                <h3 className="flex items-baseline gap-2 text-base font-semibold">
                  <span className="shrink-0 text-sm font-semibold text-[var(--color-cta-forte)]">
                    {i + 1}. {MOMENTO[c.id] ?? c.id}
                  </span>
                  <span>{c.titulo}</span>
                </h3>
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
                  <dt className="font-medium">O cliente</dt>
                  <dd>{c.cliente}</dd>
                  <dt className="font-medium">A operação</dt>
                  <dd>{c.operacao}</dd>
                  <dt className="font-medium">O ganho</dt>
                  <dd>{c.valor}</dd>
                </dl>
                <FotoAnotada foto={c.foto} alt={c.titulo} />
              </li>
            ))}
          </ol>

          <div className="flex flex-col gap-2 rounded-xl border border-dashed p-4 sm:p-5">
            <h3 className="text-sm font-semibold">Para montar isso no seu CRM</h3>
            <ul className="flex flex-col gap-2 text-sm">
              {j.montagem.map((ref) => {
                const modulo = licoes[ref.modulo];
                const titulo = modulo?.licoes[ref.licao];
                const alcanca = !!modulo && !!titulo && visiveis.has(modulo.tela);
                const nome = `${modulo?.titulo ?? ref.modulo} › ${titulo ?? ref.licao}`;
                return (
                  <li key={`${ref.modulo}/${ref.licao}`} className="flex flex-col">
                    {alcanca ? (
                      <Link
                        href={hrefDaLicao(ref.modulo, ref.licao) as Route}
                        className="font-medium underline underline-offset-4"
                        data-testid="link-historia-licao"
                      >
                        {nome}
                      </Link>
                    ) : (
                      <span className="font-medium">
                        {nome}{" "}
                        <span className="font-normal text-muted-foreground">(fora do seu menu)</span>
                      </span>
                    )}
                    <span className="text-muted-foreground">{ref.porque}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ))}
    </article>
  );
}
