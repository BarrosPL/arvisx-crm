// Gera as telas da proposta "Folha" a partir das telas do protótipo atual.
// Uso: node docs/arvisx/prototipo/proposta-folha/montar.mjs
//
// Cada ../telas/X.html vira a/X.html (paleta A) e b/X.html (paleta B). O HTML da
// tela não é reescrito: o conteúdo, os textos, os dados e a posição de cada coisa
// são os mesmos, por construção. Só isto muda no arquivo copiado:
//   1. os caminhos relativos ganham um nível (../ -> ../../);
//   2. entram as fontes, folha.css e a paleta, DEPOIS do <style> da tela;
//   3. as medidas da tela (texto, peso, canto, caixa alta, faixa lateral, ouro fora
//      da IA) passam pela régua, e a folha base vira base.css (tokens.css na régua);
//   4. os ícones passam de Phosphor regular para light (class="ph" -> "ph-light").
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const origem = join(aqui, "..", "telas");

// Fora da proposta: a folha de ícones e as opções de login que foram descartadas
// (a aprovada é login-a-conversa). A landing não é tela do protótipo.
// Também ficam fora os passos do onboarding ANTIGO (wizard): desde 13/11/2026 o
// produto usa o guia dentro do CRM (onboarding-welcome + onboarding-guiado).
const FORA = /^(icones|login|login-a|login-b|login-c|login-a-animada|login-a-orbitas|onboarding-(done|equipe|funil|ia|nuvemshop|testar|whatsapp))\.html$/;
// Paleta escolhida pelo Lucas em 15/11/2026: B (Petróleo). A opção A fica só em paleta-a.css.
const PALETAS = ["b"];
// "s" = Folha suave (16/11/2026): a mesma B com cantos maiores, pedida pelo Lucas para comparar.
const VARIANTES = [{ pasta: "b", suave: false }, { pasta: "s", suave: true }];
const MACIO = { 4: 6, 6: 10, 8: 12, 12: 18 };
const amaciar = (css) => css.replace(/border-radius:\s*([^;}"]+)/g, (tudo, v) => (/^[\d.px\s]+$/.test(v) ? `border-radius: ${v.replace(/([\d.]+)px/g, (_, x) => `${MACIO[x] ?? x}px`)}` : tudo));
const amaciarNaTela = (html) => html
  .replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_, a, css, f) => a + amaciar(css) + f)
  .replace(/style="([^"]*)"/g, (_, css) => `style="${amaciar(css)}"`);
const ORDEM_DOS_GRUPOS = ["Entrada", "Atendimento", "CRM", "Agente de IA", "Canais", "Análise", "Organização", "Admin da plataforma"];
// As telas que abrem a lista do visor, na ordem em que o cliente as usa.
const PRINCIPAIS = [
  "inbox", "funil-quadro", "contatos", "contato-ficha", "agenda", "tarefas",
  "agentes", "agente-editor", "followups", "casos", "conexoes", "desempenho",
  "crm-hub", "configuracoes", "plano-e-cobranca",
];

const FONTES =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400..700&family=Newsreader:opsz,wght@6..72,400..600&display=swap">\n' +
  '<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/light/style.css">';

// ---- a régua: uma escala só de texto, peso e canto, aplicada às medidas de cada tela ----
const TAM = (x) => (x <= 10.5 ? 11 : x <= 12.5 ? 12 : x <= 13.5 ? 13 : x <= 14.5 ? 14 : x <= 17 ? 16 : x <= 20 ? 18 : x <= 26 ? 24 : x <= 30 ? 30 : x);
const PESO = (p) => (p >= 600 ? 600 : p);
const RAIO = (x) => (x === 0 ? 0 : x <= 5 ? 4 : x <= 7 ? 6 : x <= 10 ? 8 : x === 13 || x === 14 || x === 16 ? 12 : x);
const ESTADO = /aria-current|aria-selected|aria-pressed|aria-checked|\.sel\b|\.ativ[oa]\b|\.atual\b|:checked/;
const OURO_DA_BORDA = "color-mix(in srgb, var(--ouro) 38%, var(--painel))";

function regua(css) {
  return css
    .replace(/font-size:\s*([\d.]+)px/g, (_, x) => `font-size: ${TAM(Number(x))}px`)
    .replace(/font:\s*(\d{3})\s+([\d.]+)px/g, (_, p, x) => `font: ${PESO(Number(p))} ${TAM(Number(x))}px`)
    .replace(/font-weight:\s*(\d{3})/g, (_, p) => `font-weight: ${PESO(Number(p))}`)
    .replace(/border-radius:\s*([^;}"]+)/g, (tudo, v) => (/^[\d.px\s]+$/.test(v) ? `border-radius: ${v.replace(/([\d.]+)px/g, (_, x) => `${RAIO(Number(x))}px`)}` : tudo))
    // rótulo em caixa alta com letras afastadas vira texto comum
    .replace(/text-transform:\s*uppercase/g, "text-transform: none")
    .replace(/letter-spacing:\s*\.\d+em/g, "letter-spacing: 0")
    // faixa colorida na lateral de cartão sai (o texto e a etiqueta já dizem o estado)
    .replace(/box-shadow:\s*inset [234]px 0 0 var\(--(?:erro|aviso|ouro|ok|sinal)\)/g, "box-shadow: none")
    .replace(/border-left-width:\s*4px/g, "border-left-width: 1px")
    .replace(/\.no\.(?:ouro|sinal|ok|aviso|erro)\s*\{\s*border-left-color:[^}]*\}/g, "")
    // ouro só na IA: marcação e item escolhido passam para a tinta
    .replace(/accent-color:\s*var\(--ouro\)/g, "accent-color: var(--navy)")
    .replace(/#ecd9a0/gi, OURO_DA_BORDA)
    // fundo de ouro com texto escuro vira fundo de tinta com texto branco
    .replace(/([^{}]+)\{([^{}]*)\}/g, (tudo, sel, corpo) => (ESTADO.test(sel) && /background(?:-color)?:\s*var\(--ouro\)/.test(corpo)
      ? `${sel}{${corpo.replace(/(background(?:-color)?:\s*)var\(--ouro\)/g, "$1var(--navy)").replace(/(^|[;\s])color:\s*var\(--navy\)/g, "$1color: #fff")}}`
      : tudo))
    .replace(/([^{}]+)\{([^{}]*)\}/g, (tudo, sel, corpo) => (ESTADO.test(sel) && corpo.includes("--ouro")
      ? `${sel}{${(/background(?:-color)?:\s*var\(--navy\)/.test(corpo) ? corpo.replace(/(^|[;\s])color:\s*var\(--ouro(?:-claro)?\)/g, "$1color: #fff") : corpo).replace(/var\(--ouro-suave\)/g, "var(--tinta-suave)").replace(/var\(--ouro-escuro\)/g, "var(--texto)").replace(/var\(--ouro\)/g, "var(--navy)")}}`
      : tudo));
}
const reguaNaTela = (html) => html
  .replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_, a, css, f) => a + regua(css) + f)
  .replace(/style="([^"]*)"/g, (_, css) => `style="${regua(css)}"`);

const meta = (html, nome) => html.match(new RegExp(`<meta name="${nome}" content="([^"]*)"`))?.[1] ?? "";

await writeFile(join(aqui, "base.css"), "/* GERADO por montar.mjs a partir de ../tokens.css, com as medidas na régua. Não editar. */\n" + regua(await readFile(join(aqui, "..", "tokens.css"), "utf8")), "utf8");

await writeFile(join(aqui, "base-login.css"), "/* GERADO por montar.mjs a partir de ../login-opcoes.css, com as medidas na régua. Não editar. */\n" + regua(await readFile(join(aqui, "..", "login-opcoes.css"), "utf8")), "utf8");

for (const base of ["base", "base-login"]) await writeFile(join(aqui, `${base}-suave.css`), amaciar(await readFile(join(aqui, `${base}.css`), "utf8")), "utf8");

const arquivos = (await readdir(origem)).filter((f) => f.endsWith(".html") && !f.startsWith("_") && !FORA.test(f)).sort();
const telas = [];

for (const v of VARIANTES) await mkdir(join(aqui, v.pasta), { recursive: true });

for (const arquivo of arquivos) {
  const html = await readFile(join(origem, arquivo), "utf8");
  const id = arquivo.replace(/\.html$/, "");
  telas.push({
    id,
    titulo: id === "login-a-conversa" ? "Entrar" : html.match(/<title>([^<]*)<\/title>/)?.[1] ?? id,
    grupo: meta(html, "grupo") || "Organização",
    ordem: Number(meta(html, "ordem") || 999),
    rota: meta(html, "rota") || html.match(/<body[^>]*data-rota="([^"]*)"/)?.[1] || "",
    principal: PRINCIPAIS.indexOf(id),
  });

  for (const { pasta, suave } of VARIANTES) {
    const paleta = PALETAS[0];
    const saida = (suave ? amaciarNaTela(reguaNaTela(html)) : reguaNaTela(html))
      .replace(/(src|href)="\.\.\//g, '$1="../../')
      .replace('href="../../tokens.css"', `href="../base${suave ? "-suave" : ""}.css"`)
      .replace('href="../../login-opcoes.css"', `href="../base-login${suave ? "-suave" : ""}.css"`)
      .replace(/<body([^>]*)>/, (m, attrs) => (attrs.includes("data-raiz") ? m : `<body${attrs} data-raiz="../..">`))
      .replace(/class="ph ph-/g, 'class="ph-light ph-')
      .replace("</head>", `${FONTES}\n<link rel="stylesheet" href="../folha.css">\n<link rel="stylesheet" href="../paleta-${paleta}.css">${suave ? '\n<link rel="stylesheet" href="../suave.css">' : ""}\n</head>`)
      .replace("</body>", '<script src="../folha.js"></script>\n</body>');
    await writeFile(join(aqui, pasta, arquivo), saida, "utf8");
  }
}

const g = (t) => { const i = ORDEM_DOS_GRUPOS.indexOf(t.grupo); return i < 0 ? 99 : i; };
telas.sort((x, y) => g(x) - g(y) || x.ordem - y.ordem || x.titulo.localeCompare(y.titulo));
await writeFile(join(aqui, "telas.json"), JSON.stringify(telas, null, 2) + "\n", "utf8");
console.log(`${telas.length} telas em ${VARIANTES.map((v) => v.pasta).join(", ")}/ — ${ORDEM_DOS_GRUPOS.map((n) => `${n}: ${telas.filter((t) => t.grupo === n).length}`).join(" · ")}`);
