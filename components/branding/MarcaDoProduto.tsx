import { cn } from "@/lib/utils";

/**
 * A marca do PRODUTO desenhada em SVG inline — o que a tela mostra quando
 * ninguém configurou marca própria (`marcaEhADoProduto`, em `lib/branding.ts`).
 *
 * Inline, e não `<img src="/algo.svg">`, por três motivos:
 *  - as cores seguem o TEMA: sálvia mais clara e nome em creme no escuro, como
 *    a régua do produto já define — um arquivo estático teria uma cor só;
 *  - nada em `public/`: um `.svg` fixo ali seria servido na instalação de um
 *    revendedor que configurou a marca dele (ver `lib/branding/desenho.ts`);
 *  - a barra lateral já usa `<img>` para o logo CONFIGURADO, e o e2e
 *    `marca-logo.spec.ts` mede "barra sem `<img>`" como "sem logo do
 *    revendedor". Um `<img>` do produto ali faria a spec medir a coisa errada.
 *
 * O texto alternativo é o `nome` que a tela já resolveu — nunca uma string
 * fixa, para que a catraca de marca (`tests/unit/branding.test.ts`) continue
 * contando ZERO ocorrências fora de `lib/branding.ts`.
 */

type Props = {
  readonly nome: string;
  readonly className?: string;
  /** `true` quando o texto ao lado já nomeia a marca — evita ler duas vezes. */
  readonly decorativo?: boolean;
  /** `true` sobre fundo sempre escuro (a barra lateral): usa as cores do tema escuro nos dois temas. */
  readonly sobreEscuro?: boolean;
  /**
   * `true` sobre fundo sempre claro (o chip da fachada de entrada, que fixa
   * `data-theme="light"` numa subárvore): usa a arte clara nos dois temas. As
   * variantes `dark:` seguem o `<html>`, não a subárvore, então sem isto o
   * símbolo branco apareceria sobre o chip branco quando o sistema é escuro.
   */
  readonly sobreClaro?: boolean;
};

const SIMBOLO_CLARO_ESCURO = "fill-[#d4af37] dark:fill-[#e0bc45]";
const NOME_CLARO_ESCURO = "fill-[#0f131a] dark:fill-[#eef0f3]";
const SUFIXO_CLARO_ESCURO = "fill-[#a8871f] dark:fill-[#e0bc45]";

// As classes acima repetem os hexes de `CORES_DA_MARCA` porque o Tailwind só
// gera utilitário para valor LITERAL no fonte. Quem impede os dois de divergirem
// é `tests/unit/marca-do-produto.test.tsx`, que compara as classes à paleta —
// e não uma asserção em runtime: um throw aqui derrubaria a casca inteira.
export const CLASSES_DE_COR = {
  simbolo: SIMBOLO_CLARO_ESCURO,
  nome: NOME_CLARO_ESCURO,
  sufixo: SUFIXO_CLARO_ESCURO,
} as const;

function acessibilidade(nome: string, decorativo: boolean) {
  return decorativo
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": nome } as const);
}

/** O símbolo sozinho — para a barra recolhida, avatar e cantos apertados. */
/**
 * A arte oficial da ArvisX (public/marca/*.png) dentro de um <svg> com <image>: não é
 * <img>, então a fachada e a barra continuam "sem logo de revendedor" para os
 * testes que medem isso; e o par claro/escuro segue o tema (ou o fundo navy da
 * barra lateral, com `sobreEscuro`). Os vetores `SIMBOLO`/`LOGOTIPO` de
 * `lib/branding/desenho.ts` continuam nos ícones gerados no servidor (favicon,
 * ícone do app), onde não há DOM para carregar arquivo.
 */
const ARTE = {
  lockup: {
    claro: "/marca/arvisx-crm.png",
    escuro: "/marca/arvisx-crm-escuro.png",
    viewBox: "0 0 715 85",
  },
  simbolo: {
    claro: "/marca/arvisx-simbolo.png",
    escuro: "/marca/arvisx-simbolo-escuro.png",
    viewBox: "0 0 130 85",
  },
} as const;

function Arte({
  arte,
  nome,
  className,
  decorativo,
  sobreEscuro,
  sobreClaro,
}: Props & {
  arte: (typeof ARTE)[keyof typeof ARTE];
  decorativo: boolean;
  sobreEscuro: boolean;
  sobreClaro: boolean;
}) {
  return (
    <svg
      viewBox={arte.viewBox}
      className={cn("shrink-0", className)}
      {...acessibilidade(nome, decorativo)}
    >
      {sobreEscuro ? (
        <image href={arte.escuro} width="100%" height="100%" />
      ) : sobreClaro ? (
        <image href={arte.claro} width="100%" height="100%" />
      ) : (
        <>
          <image href={arte.claro} width="100%" height="100%" className="dark:hidden" />
          <image href={arte.escuro} width="100%" height="100%" className="hidden dark:block" />
        </>
      )}
    </svg>
  );
}

/** O símbolo sozinho — para a barra recolhida, avatar e cantos apertados. */
export function SimboloDoProduto({
  nome,
  className,
  decorativo = false,
  sobreEscuro = false,
  sobreClaro = false,
}: Props) {
  return (
    <Arte
      arte={ARTE.simbolo}
      nome={nome}
      className={className}
      decorativo={decorativo}
      sobreEscuro={sobreEscuro}
      sobreClaro={sobreClaro}
    />
  );
}

/** Símbolo + nome — para a barra aberta e a fachada de entrada. */
export function LogotipoDoProduto({
  nome,
  className,
  decorativo = false,
  sobreEscuro = false,
  sobreClaro = false,
}: Props) {
  return (
    <Arte
      arte={ARTE.lockup}
      nome={nome}
      className={className}
      decorativo={decorativo}
      sobreEscuro={sobreEscuro}
      sobreClaro={sobreClaro}
    />
  );
}
