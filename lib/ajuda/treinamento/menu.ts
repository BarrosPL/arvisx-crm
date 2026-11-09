/**
 * O menu do treinamento é projetado do MESMO catálogo que desenha o menu
 * lateral do app (`lib/navigation/catalogo.ts`), como faz `curso/montar.ts`:
 * os módulos saem agrupados e ordenados como as telas que eles ensinam, e o
 * grupo do rodapé aparece pelo nome do hub ("Configurações").
 *
 * Quem decide se um módulo aparece para a pessoa é `visiveis` (as telas que o
 * menu dela mostra), nunca o `papel` da lição.
 */
import { GRUPO_NO_RODAPE, NAV_CATALOG, NAV_GROUPS } from "@/lib/navigation/catalogo";

export interface ModuloNoMenu {
  id: string;
  titulo: string;
  tela: string;
  licoes: number;
}

export interface GrupoDoMenu {
  grupo: string;
  modulos: ModuloNoMenu[];
}

export function menuDoTreinamento(
  modulos: readonly { id: string; titulo: string; tela: string; licoes: readonly unknown[] }[],
): GrupoDoMenu[] {
  const ordem = new Map<string, number>(NAV_CATALOG.map((d, i) => [d.href, i]));
  const grupoDaTela = new Map<string, string>(NAV_CATALOG.map((d) => [d.href, d.group]));
  return NAV_GROUPS.map((g) => ({
    grupo: g.id === GRUPO_NO_RODAPE && g.hub ? g.hub.label : g.label,
    modulos: modulos
      .filter((m) => grupoDaTela.get(m.tela) === g.id)
      .sort((a, b) => (ordem.get(a.tela) ?? 0) - (ordem.get(b.tela) ?? 0))
      .map((m) => ({ id: m.id, titulo: m.titulo, tela: m.tela, licoes: m.licoes.length })),
  })).filter((g) => g.modulos.length > 0);
}

/** Recorta o menu às telas que a pessoa vê; grupo vazio some. */
export function menuVisivel<M extends ModuloNoMenu>(
  menu: readonly { grupo: string; modulos: M[] }[],
  visiveis: ReadonlySet<string>,
): { grupo: string; modulos: M[] }[] {
  return menu
    .map((g) => ({ ...g, modulos: g.modulos.filter((m) => visiveis.has(m.tela)) }))
    .filter((g) => g.modulos.length > 0);
}
