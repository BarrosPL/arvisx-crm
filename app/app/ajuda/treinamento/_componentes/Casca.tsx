"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";

import type { GrupoDoMenu } from "@/lib/ajuda/treinamento/menu";
import { menuVisivel } from "@/lib/ajuda/treinamento/menu";
import { RAIZ_DO_TREINAMENTO, hrefDoModulo, hrefDoNicho } from "@/lib/ajuda/treinamento/busca";
import { cn } from "@/lib/utils";

import { useTelasVisiveis } from "./visibilidade";

export interface NichoNoMenu {
  id: string;
  titulo: string;
  jornadas: number;
}

/**
 * A casca do treinamento: o menu de módulos (agrupado como o menu do app e
 * recortado pelo que a pessoa vê), a busca e as histórias por nicho. No
 * desktop o menu fica fixo ao lado; em tela estreita ele recolhe atrás de um
 * botão e fecha ao escolher um item.
 */
export function CascaDoTreinamento({
  menu,
  nichos,
  children,
}: {
  menu: GrupoDoMenu[];
  nichos: NichoNoMenu[];
  children: React.ReactNode;
}) {
  const visiveis = useTelasVisiveis();
  const grupos = menuVisivel(menu, visiveis);
  const caminho = usePathname();
  const [aberto, setAberto] = useState(false);

  const item = (href: string, rotulo: string, extra?: string) => {
    const ativo = caminho === href;
    return (
      <Link
        href={href as Route}
        aria-current={ativo ? "page" : undefined}
        onClick={() => setAberto(false)}
        className={cn(
          "flex min-h-9 items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-muted",
          ativo && "bg-[var(--color-cta-leve)] font-medium text-[var(--color-cta-forte)]",
        )}
      >
        <span className="min-w-0 truncate">{rotulo}</span>
        {extra && <span className="shrink-0 text-xs text-muted-foreground">{extra}</span>}
      </Link>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:gap-6">
      <aside className="md:sticky md:top-0 md:max-h-[calc(100dvh-6rem)] md:w-72 md:shrink-0 md:overflow-y-auto">
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-between rounded-lg border px-3 text-sm font-medium md:hidden"
          aria-expanded={aberto}
          aria-controls="menu-do-treinamento"
          onClick={() => setAberto((v) => !v)}
        >
          <span>Módulos e histórias</span>
          <span aria-hidden="true">{aberto ? "▲" : "▼"}</span>
        </button>
        <nav
          id="menu-do-treinamento"
          aria-label="Módulos do guia de uso"
          className={cn(
            "mt-2 flex-col gap-5 rounded-lg border p-3 md:mt-0 md:flex",
            aberto ? "flex" : "hidden",
          )}
        >
          <div className="flex flex-col gap-1">
            {item(RAIZ_DO_TREINAMENTO, "Início e busca")}
          </div>
          {grupos.map((g) => (
            <div key={g.grupo} className="flex flex-col gap-1">
              <h2 className="px-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.grupo}
              </h2>
              <ul className="flex flex-col">
                {g.modulos.map((m) => (
                  <li key={m.id}>
                    {item(hrefDoModulo(m.id), m.titulo, `${m.licoes} ${m.licoes === 1 ? "lição" : "lições"}`)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <h2 className="px-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Histórias por nicho
            </h2>
            <ul className="flex flex-col">
              {nichos.map((n) => (
                <li key={n.id}>
                  {item(hrefDoNicho(n.id), n.titulo, `${n.jornadas} ${n.jornadas === 1 ? "história" : "histórias"}`)}
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
