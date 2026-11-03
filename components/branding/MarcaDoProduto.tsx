import { LOGOTIPO, SIMBOLO } from "@/lib/branding/desenho";
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

/** Sobre a barra lateral (sempre navy) valem as cores do escuro, em qualquer tema. */
const CLASSES_SOBRE_ESCURO = {
  simbolo: "fill-[#e0bc45]",
  nome: "fill-[#eef0f3]",
  sufixo: "fill-[#e0bc45]",
} as const;

function cores(sobreEscuro: boolean) {
  return sobreEscuro ? CLASSES_SOBRE_ESCURO : CLASSES_DE_COR;
}

function acessibilidade(nome: string, decorativo: boolean) {
  return decorativo
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": nome } as const);
}

/** O símbolo sozinho — para a barra recolhida, avatar e cantos apertados. */
export function SimboloDoProduto({
  nome,
  className,
  decorativo = false,
  sobreEscuro = false,
}: Props) {
  const c = cores(sobreEscuro);
  return (
    <svg
      viewBox={SIMBOLO.viewBox}
      className={cn("shrink-0", className)}
      {...acessibilidade(nome, decorativo)}
    >
      <g transform={SIMBOLO.transform}>
        <path className={c.nome} d={SIMBOLO.d} fillRule="evenodd" />
        <path className={c.simbolo} d={SIMBOLO.aneis} fillRule="evenodd" />
      </g>
    </svg>
  );
}

/** Símbolo + nome — para a barra aberta e a fachada de entrada. */
export function LogotipoDoProduto({
  nome,
  className,
  decorativo = false,
  sobreEscuro = false,
}: Props) {
  const c = cores(sobreEscuro);
  return (
    <svg
      viewBox={LOGOTIPO.viewBox}
      className={cn("shrink-0", className)}
      {...acessibilidade(nome, decorativo)}
    >
      <g transform={LOGOTIPO.simbolo.transform}>
        <path className={c.nome} d={LOGOTIPO.simbolo.d} fillRule="evenodd" />
        <path className={c.simbolo} d={LOGOTIPO.simbolo.aneis} fillRule="evenodd" />
      </g>
      <text
        className={c.nome}
        x={LOGOTIPO.nome.x}
        y={LOGOTIPO.nome.y}
        fontSize={LOGOTIPO.nome.tamanho}
        letterSpacing={LOGOTIPO.nome.espacamento}
        fontWeight={700}
        style={{
          fontFamily: "var(--font-archivo), var(--font-manrope), sans-serif",
          fontStretch: "118%",
        }}
      >
        {LOGOTIPO.nome.texto}
        <tspan className={c.sufixo} dx={28} fontWeight={600}>
          {LOGOTIPO.sufixo.texto}
        </tspan>
      </text>
    </svg>
  );
}
