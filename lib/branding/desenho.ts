/**
 * O DESENHO da marca do produto — símbolo e logotipo — como geometria pura.
 *
 * Mora aqui, e não num `.svg` em `public/`, por duas razões que a doutrina de
 * marca própria já paga:
 *
 *  1. `public/` é servido a todo mundo, sempre. Um arquivo fixo ali seria a
 *     marca do PRODUTO na instalação de um revendedor que configurou a dele —
 *     é exatamente o vazamento que `tests/unit/branding.test.ts` vigia. Como
 *     geometria, o desenho só aparece onde um componente decide que a marca em
 *     vigor é a padrão (`marcaEhADoProduto`, em `lib/branding.ts`).
 *  2. O favicon (`app/icon.tsx`) é gerado em runtime pelo `ImageResponse`, que
 *     aceita SVG inline mas não lê arquivo do disco. Um único desenho alimenta
 *     a tela e o ícone — dois arquivos divergiriam na primeira revisão da marca.
 *
 * As cores NÃO estão aqui de propósito: quem desenha escolhe (a tela lê os
 * tokens do tema; o favicon lê a régua do produto). A fonte deste arquivo são
 * os SVGs em `docs/brand/`; ao trocar a arte, regenere os dois lados a partir
 * deles.
 */

/** Glifo com a transformação que o posiciona no `viewBox` do logotipo. */
export type Glifo = { readonly transform: string; readonly d: string };

/**
 * O "A" da ArvisX: um triângulo sem travessão, com os dois anéis dourados (o
 * "elo") cruzando a base. Desenhado em vetor simples para seguir o tema; a arte
 * original (PNG) fica em docs/arvisx/prototipo/marca/.
 */
const D_A = "M108 10L198 206H156L140 170H76L60 206H18Z M108 78L84 134H132Z";

/** Os dois anéis, como caminho único com furo (fill-rule: evenodd). */
const D_ANEIS =
  "M70 120c-38 0-68 13-68 30s30 30 68 30 68-13 68-30-30-30-68-30Zm0 13c30 0 53 8 53 17s-23 17-53 17-53-8-53-17 23-17 53-17Z" +
  "M146 130c-38 0-68 13-68 30s30 30 68 30 68-13 68-30-30-30-68-30Zm0 13c30 0 53 8 53 17s-23 17-53 17-53-8-53-17 23-17 53-17Z";

export const SIMBOLO = {
  viewBox: "0 0 216 216",
  transform: "translate(0 0)",
  d: D_A,
  aneis: D_ANEIS,
} as const;

/**
 * Símbolo + nome. O nome é texto (Archivo, a fonte dos títulos, via
 * `--font-archivo`) e não glifo convertido em caminho: assim ele acompanha a
 * fonte carregada pelo layout e o tema, sem arquivo em `public/`.
 */
export const LOGOTIPO = {
  viewBox: "0 0 1230 216",
  proporcao: 1230 / 216,
  simbolo: { transform: "translate(0 0)", d: D_A, aneis: D_ANEIS },
  nome: { texto: "ARVISX", x: 240, y: 152, tamanho: 118, espacamento: 8 },
  sufixo: { texto: "CRM", x: 240, y: 152, tamanho: 118, espacamento: 8 },
} as const;

export const CORES_DA_MARCA = {
  claro: { simbolo: "#d4af37", nome: "#0f131a", sufixo: "#a8871f" },
  escuro: { simbolo: "#e0bc45", nome: "#eef0f3", sufixo: "#e0bc45" },
} as const;
