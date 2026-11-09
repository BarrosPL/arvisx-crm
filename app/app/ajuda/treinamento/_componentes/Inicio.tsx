"use client";

import Link from "next/link";
import type { Route } from "next";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  RAIZ_DO_TREINAMENTO,
  hrefDaJornada,
  hrefDoModulo,
  hrefDoNicho,
  type ResultadoDaBusca,
} from "@/lib/ajuda/treinamento/busca";
import { menuVisivel, type ModuloNoMenu } from "@/lib/ajuda/treinamento/menu";

import { useTelasVisiveis } from "./visibilidade";

type GrupoComResumo = { grupo: string; modulos: (ModuloNoMenu & { resumo: string })[] };

const TIPO: Record<ResultadoDaBusca["tipo"], string> = {
  licao: "Lição",
  passo: "Passo",
  historia: "História",
};

export function InicioDoTreinamento({
  consulta,
  resultados,
  menu,
  nichos,
}: {
  consulta: string;
  resultados: ResultadoDaBusca[] | null;
  menu: GrupoComResumo[];
  nichos: { id: string; titulo: string; resumo: string; jornadas: { id: string; titulo: string }[] }[];
}) {
  const visiveis = useTelasVisiveis();
  const grupos = menuVisivel(menu, visiveis);
  // A busca roda no servidor sobre tudo; aqui sai o que é de tela que a pessoa não vê.
  const achados = resultados?.filter((r) => !r.tela || visiveis.has(r.tela)) ?? null;

  return (
    <div className="flex flex-col gap-8">
      <header className="relative overflow-hidden rounded-xl bg-[var(--color-sidebar)] p-6 text-[var(--color-sidebar-fg)] sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 140% at 100% 0%, rgba(214, 120, 44, 0.35), transparent 55%), radial-gradient(90% 120% at 85% 110%, rgba(212, 175, 55, 0.28), transparent 60%)",
          }}
        />
        <div className="relative flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-brand)]">
              Ajuda
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Guia de uso</h1>
            <p className="max-w-2xl text-sm text-[var(--color-sidebar-fg)]">
              Lições passo a passo com a foto de cada tela e os pontos para clicar destacados. Escolha
              um módulo ao lado, procure uma dúvida ou veja como outras empresas usam o CRM.
            </p>
          </div>
          <form action={RAIZ_DO_TREINAMENTO} method="get" role="search" className="flex max-w-xl gap-2">
            <label htmlFor="busca-do-treinamento" className="sr-only">
              Buscar no guia de uso
            </label>
            <Input
              id="busca-do-treinamento"
              name="q"
              type="search"
              defaultValue={consulta}
              placeholder="Ex.: nota interna, agendamento, etiqueta"
              className="bg-white text-[var(--color-cta-fg)]"
            />
            <Button type="submit" className="shrink-0">
              Buscar
            </Button>
          </form>
        </div>
      </header>

      {achados && (
        <section aria-labelledby="titulo-resultados" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="titulo-resultados" className="text-lg font-semibold">
              {achados.length
                ? `${achados.length} ${achados.length === 1 ? "resultado" : "resultados"} para “${consulta}”`
                : `Nada encontrado para “${consulta}”`}
            </h2>
            <Link href={RAIZ_DO_TREINAMENTO as Route} className="text-sm underline underline-offset-4">
              Limpar busca
            </Link>
          </div>
          {achados.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Tente outra palavra, ou procure pelo nome da tela no menu ao lado.
            </p>
          )}
          <ul className="flex flex-col divide-y rounded-lg border">
            {achados.map((r) => (
              <li key={r.href}>
                <Link
                  href={r.href as Route}
                  className="flex flex-col gap-1 p-3 hover:bg-muted/50"
                  data-testid="resultado-da-busca"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-[var(--color-cta-leve)] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-cta-forte)]">
                      {TIPO[r.tipo]}
                    </span>
                    <span className="text-sm font-medium">{r.titulo}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{r.caminho}</span>
                  {r.trecho && <span className="text-sm text-muted-foreground">{r.trecho}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!achados && (
        <>
          {grupos.map((g) => (
            <section key={g.grupo} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {g.grupo}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {g.modulos.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={hrefDoModulo(m.id) as Route}
                      className="flex h-full flex-col gap-1.5 rounded-lg border bg-card p-4 transition-colors hover:border-[var(--color-brand)]"
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{m.titulo}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {m.licoes} {m.licoes === 1 ? "lição" : "lições"}
                        </span>
                      </span>
                      <span className="text-sm text-muted-foreground">{m.resumo}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section aria-labelledby="titulo-historias" className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 id="titulo-historias" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Histórias por nicho
              </h2>
              <p className="text-sm text-muted-foreground">
                Como uma empresa fictícia de cada ramo atende do primeiro contato ao acompanhamento.
              </p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {nichos.map((n) => (
                <li key={n.id} className="flex flex-col gap-2 rounded-lg border bg-card p-4">
                  <Link href={hrefDoNicho(n.id) as Route} className="font-medium hover:underline">
                    {n.titulo}
                  </Link>
                  <span className="text-sm text-muted-foreground">{n.resumo}</span>
                  <ul className="flex flex-col gap-1 text-sm">
                    {n.jornadas.map((j) => (
                      <li key={j.id}>
                        <Link
                          href={hrefDaJornada(n.id, j.id) as Route}
                          className="underline-offset-4 hover:underline"
                        >
                          {j.titulo}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
