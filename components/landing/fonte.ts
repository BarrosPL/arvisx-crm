import localFont from "next/font/local";

/**
 * A Archivo da vitrine, COM o eixo de largura declarado.
 *
 * O arquivo é o mesmo de `app/layout.tsx` (Archivo variável, eixos de peso e de
 * largura), mas ali o @font-face não declara `font-stretch`, então o navegador
 * trata a face como "normal" e o `font-stretch: 112%` dos títulos não alarga a
 * letra. O protótipo aprovado carrega a Archivo do Google com
 * `font-stretch: 100% 125%`, e os títulos da landing e de /agendar dependem
 * disso. Esta face só vale onde `--font-archivo-lp` é lido (`app/landing.css`
 * e `app/agendar/agendar.css`); o resto do app segue com a de sempre.
 */
export const archivoDaVitrine = localFont({
  // A ordem importa: as duas faces têm os mesmos descritores e nenhuma
  // `unicode-range`, então o navegador tenta a ÚLTIMA primeiro. Com a latin-ext
  // por último, o "0" (que só a latin tem) faltava na face principal e a
  // unidade `ch` caía no padrão de 0,5em: o `max-width: 18ch` do título de
  // /agendar encolhia e o título quebrava em três linhas, não duas.
  src: [
    { path: "../../app/fonts/archivo-variable-latin-ext.woff2", style: "normal" },
    { path: "../../app/fonts/archivo-variable-latin.woff2", style: "normal" },
  ],
  weight: "100 900",
  display: "swap",
  variable: "--font-archivo-lp",
  declarations: [{ prop: "font-stretch", value: "100% 125%" }],
});
