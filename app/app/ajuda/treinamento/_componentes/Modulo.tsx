"use client";

import Link from "next/link";
import type { Route } from "next";

import { FotoAnotada } from "@/components/ajuda/FotoAnotada";
import { RAIZ_DO_TREINAMENTO, ancoraDaLicao, ancoraDoPasso } from "@/lib/ajuda/treinamento/busca";
import type { ModuloDoTreinamento } from "@/lib/ajuda/treinamento/conteudo";

import { useTelasVisiveis } from "./visibilidade";

export function SemAcesso() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-6">
      <h1 className="text-lg font-semibold">Este módulo não está no seu menu</h1>
      <p className="text-sm text-muted-foreground">
        O guia mostra as telas que o seu acesso alcança. Se precisar desta, fale com quem
        administra a sua empresa no CRM.
      </p>
      <Link href={RAIZ_DO_TREINAMENTO as Route} className="text-sm underline underline-offset-4">
        Voltar ao início do guia
      </Link>
    </div>
  );
}

export function ConteudoDoModulo({ modulo }: { modulo: ModuloDoTreinamento }) {
  const visiveis = useTelasVisiveis();
  if (!visiveis.has(modulo.tela)) return <SemAcesso />;

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-2 border-b pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-cta-forte)]">
          Guia de uso
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{modulo.titulo}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{modulo.resumo}</p>
        <nav aria-label="Lições deste módulo" className="mt-2">
          <ol className="flex flex-col gap-1 text-sm sm:columns-2 sm:block">
            {modulo.licoes.map((l, i) => (
              <li key={l.id} className="break-inside-avoid py-0.5">
                <a href={`#${ancoraDaLicao(l.id)}`} className="underline-offset-4 hover:underline">
                  {i + 1}. {l.titulo}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      {modulo.licoes.map((l, i) => (
        <section
          key={l.id}
          id={ancoraDaLicao(l.id)}
          aria-labelledby={`${ancoraDaLicao(l.id)}-titulo`}
          className="flex scroll-mt-4 flex-col gap-5"
        >
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Lição {i + 1} de {modulo.licoes.length}
            </p>
            <h2 id={`${ancoraDaLicao(l.id)}-titulo`} className="text-xl font-semibold tracking-tight">
              {l.titulo}
            </h2>
            <p className="max-w-3xl text-sm text-muted-foreground">{l.objetivo}</p>
          </div>

          <ol className="flex flex-col gap-6">
            {l.passos.map((p, n) => (
              <li
                key={p.id}
                id={ancoraDoPasso(l.id, p.id)}
                className="flex scroll-mt-4 flex-col gap-3 rounded-xl border bg-card p-4 target:border-[var(--color-brand)] target:ring-2 target:ring-[var(--color-brand)]/40 sm:p-5"
              >
                <h3 className="flex items-baseline gap-2 text-base font-semibold">
                  <span className="shrink-0 text-sm font-semibold text-[var(--color-cta-forte)]">
                    Passo {n + 1}
                  </span>
                  <span>{p.titulo}</span>
                </h3>
                <p className="max-w-3xl whitespace-pre-line text-sm leading-relaxed">{p.texto}</p>
                {p.dica && (
                  <p className="max-w-3xl rounded-md border-l-4 border-[var(--color-brand)] bg-[var(--color-cta-leve)] px-3 py-2 text-sm text-[var(--color-cta-fg)]">
                    <span className="font-semibold">Dica: </span>
                    {p.dica}
                  </p>
                )}
                {p.foto ? (
                  <FotoAnotada foto={p.foto} alt={p.titulo} />
                ) : (
                  <p
                    role="note"
                    data-testid="aviso-sem-foto"
                    className="rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
                  >
                    {p.aviso}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </article>
  );
}
