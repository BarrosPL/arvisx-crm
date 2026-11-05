/**
 * A régua do design system, congelada em módulo — a fonte da derivação em RUNTIME.
 *
 * POR QUE ESTE ARQUIVO EXISTE, e não um `readFileSync("app/globals.css")`:
 *
 * A imagem de produção é `output: "standalone"` (next.config.ts) e o Dockerfile
 * copia para o runner apenas `.next/standalone`, `.next/static` e `public/`. O
 * `app/globals.css` NÃO existe no contêiner que o self-hoster roda. Um
 * `readFileSync` no caminho de render do `app/layout.tsx` daria ENOENT — 500 em
 * todas as telas, na VPS de quem a feature existe para servir, e verde em dev,
 * em teste e na Vercel. É o mesmo modo de falha que `lib/branding.ts` documenta
 * para o `NEXT_PUBLIC_*`.
 *
 * A separação também é a certa conceitualmente: a RÉGUA é do produto e nasce
 * congelada no build; a COR é da instalação e só existe em runtime. Só a segunda
 * precisa ser lida do ambiente.
 *
 * ESTE ARQUIVO É GERADO. Não edite à mão: ele é o `extrairRegua()` aplicado ao
 * `app/globals.css`. `tests/unit/branding-regua-do-produto.test.ts` compara os
 * dois a cada run e imprime o literal novo na mensagem de falha — mexeu na
 * paleta, o teste reprova e entrega o texto para colar aqui.
 */

import type { Regua } from "./contraste";

export const REGUA_DO_PRODUTO: Regua = {
  rampaDoProduto: [
    "#f2f5f9",
    "#dfe5ed",
    "#bbc6d6",
    "#8e9eb7",
    "#657999",
    "#455a7a",
    "#283a55",
    "#243247",
    "#222c3d",
    "#202835",
    "#171d25",
  ],
  claro: {
    nome: "claro",
    base: [
      { chave: "--color-bg", hex: "#f7f7f5" },
      { chave: "--color-surface", hex: "#ffffff" },
      { chave: "--color-surface-elevated", hex: "#f3f3f0" },
    ],
    tingidas: [{ chave: "--color-accent-soft", fonte: { tipo: "grau", indice: 1, alfa: 1 } }],
    papeis: [
      {
        token: "--color-accent",
        tipo: "componente",
        fonte: { tipo: "grau", indice: 6, alfa: 1 },
        contra: null,
      },
      {
        token: "--color-accent-fg",
        tipo: "texto",
        fonte: { tipo: "frenteCalculada", sobre: { tipo: "grau", indice: 6, alfa: 1 } },
        contra: [{ tipo: "grau", indice: 6, alfa: 1 }],
      },
      {
        token: "--color-accent-hover",
        tipo: "componente",
        fonte: { tipo: "grau", indice: 7, alfa: 1 },
        contra: null,
      },
      {
        token: "--ring",
        tipo: "componente",
        fonte: { tipo: "grau", indice: 5, alfa: 1 },
        contra: null,
      },
      {
        token: "::selection/color",
        tipo: "texto",
        fonte: { tipo: "grau", indice: 10, alfa: 1 },
        contra: [{ tipo: "grau", indice: 2, alfa: 1 }],
      },
      {
        token: ":focus-visible/outline",
        tipo: "componente",
        fonte: { tipo: "grau", indice: 5, alfa: 1 },
        contra: null,
      },
    ],
    semanticas: [
      { nome: "success", hex: "#2e8b57" },
      { nome: "warning", hex: "#c9811b" },
      { nome: "error", hex: "#c93c3c" },
      { nome: "info", hex: "#2f7fd6" },
    ],
    neutros: [
      "#f7f6f2",
      "#f1efe9",
      "#e4e1d8",
      "#cfcbbf",
      "#a8a69d",
      "#8a91a0",
      "#5b6372",
      "#3f4653",
      "#262c37",
      "#0f131a",
      "#07090d",
    ],
    indices: {
      accent: 6,
      hover: 7,
      soft: 1,
    },
    alfaDoSoft: 1,
  },
  escuro: {
    nome: "escuro",
    base: [
      { chave: "--color-bg", hex: "#0b0f15" },
      { chave: "--color-surface", hex: "#10151e" },
      { chave: "--color-surface-elevated", hex: "#151b26" },
    ],
    tingidas: [
      { chave: "--color-accent-soft", fonte: { tipo: "literal", hex: "#657999", alfa: 0.16 } },
    ],
    papeis: [
      {
        token: "--color-accent",
        tipo: "componente",
        fonte: { tipo: "grau", indice: 4, alfa: 1 },
        contra: null,
      },
      {
        token: "--color-accent-fg",
        tipo: "texto",
        fonte: { tipo: "frenteCalculada", sobre: { tipo: "grau", indice: 4, alfa: 1 } },
        contra: [{ tipo: "grau", indice: 4, alfa: 1 }],
      },
      {
        token: "--color-accent-hover",
        tipo: "componente",
        fonte: { tipo: "grau", indice: 3, alfa: 1 },
        contra: null,
      },
      {
        token: "--ring",
        tipo: "componente",
        fonte: { tipo: "grau", indice: 4, alfa: 1 },
        contra: null,
      },
      {
        token: '[data-theme="dark"] ::selection/color',
        tipo: "texto",
        fonte: { tipo: "grau", indice: 0, alfa: 1 },
        contra: [{ tipo: "grau", indice: 7, alfa: 1 }],
      },
      {
        token: '[data-theme="dark"] :focus-visible/outline-color',
        tipo: "componente",
        fonte: { tipo: "grau", indice: 4, alfa: 1 },
        contra: null,
      },
    ],
    semanticas: [
      { nome: "success", hex: "#4fa877" },
      { nome: "warning", hex: "#e0a14a" },
      { nome: "error", hex: "#e07070" },
      { nome: "info", hex: "#4ea8ff" },
    ],
    neutros: [
      "#eef0f3",
      "#d8dce3",
      "#a2abb9",
      "#6c7586",
      "#4a5261",
      "#283a55",
      "#1d2531",
      "#151b26",
      "#10151e",
      "#0b0f15",
      "#07090d",
    ],
    indices: {
      accent: 4,
      hover: 3,
      soft: null,
    },
    alfaDoSoft: 0.16,
  },
};
