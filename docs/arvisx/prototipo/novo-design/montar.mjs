// Gera as telas da proposta de design novo a partir das telas do protótipo atual.
// Uso: node docs/arvisx/prototipo/novo-design/montar.mjs
//
// Cada ../telas/X.html vira a/X.html (paleta A) e b/X.html (paleta B). O HTML da
// tela não é reescrito: o conteúdo, os textos, os dados e a posição de cada coisa
// são os mesmos, por construção. Só três coisas mudam no arquivo copiado:
//   1. os caminhos relativos ganham um nível (../ -> ../../);
//   2. entram as fontes, novo.css e a paleta, DEPOIS do <style> da tela;
//   3. os ícones passam de Phosphor regular para duotone (class="ph" -> "ph-duotone").
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const origem = join(aqui, "..", "telas");

// Fora da proposta: login, onboarding e a folha de ícones (não são o lado de dentro do CRM).
const FORA = /^(login|onboarding|icones)/;
// As telas que abrem a lista do visor, na ordem em que o cliente as usa.
const PRINCIPAIS = [
  "inbox", "funil-quadro", "contatos", "contato-ficha", "agenda", "tarefas",
  "agentes", "agente-editor", "followups", "casos", "conexoes", "desempenho",
  "crm-hub", "configuracoes", "plano-e-cobranca",
];

const FONTES =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Geist:wght@400;500;600;700&display=swap">\n' +
  '<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/duotone/style.css">';

const meta = (html, nome) => html.match(new RegExp(`<meta name="${nome}" content="([^"]*)"`))?.[1] ?? "";

const arquivos = (await readdir(origem)).filter((f) => f.endsWith(".html") && !FORA.test(f)).sort();
const telas = [];

for (const paleta of ["a", "b"]) await mkdir(join(aqui, paleta), { recursive: true });

for (const arquivo of arquivos) {
  const html = await readFile(join(origem, arquivo), "utf8");
  if (!html.includes('class="casca"')) continue; // só telas com a casca do app
  const id = arquivo.replace(/\.html$/, "");
  telas.push({
    id,
    titulo: html.match(/<title>([^<]*)<\/title>/)?.[1] ?? id,
    grupo: meta(html, "grupo"),
    ordem: Number(meta(html, "ordem") || 999),
    principal: PRINCIPAIS.indexOf(id),
  });

  for (const paleta of ["a", "b"]) {
    const saida = html
      .replace(/(src|href)="\.\.\//g, '$1="../../')
      .replace(/<body([^>]*)>/, (m, attrs) => (attrs.includes("data-raiz") ? m : `<body${attrs} data-raiz="../..">`))
      .replace(/class="ph ph-/g, 'class="ph-duotone ph-')
      .replace("</head>", `${FONTES}\n<link rel="stylesheet" href="../novo.css">\n<link rel="stylesheet" href="../paleta-${paleta}.css">\n</head>`)
      .replace('<script src="../../shell.js"></script>', '<script src="../../shell.js"></script>\n<script src="../novo.js"></script>');
    await writeFile(join(aqui, paleta, arquivo), saida, "utf8");
  }
}

telas.sort((x, y) => (x.principal < 0 ? 999 : x.principal) - (y.principal < 0 ? 999 : y.principal) || x.grupo.localeCompare(y.grupo) || x.ordem - y.ordem);
await writeFile(join(aqui, "telas.json"), JSON.stringify(telas, null, 2) + "\n", "utf8");
console.log(`${telas.length} telas em a/ e b/ (${telas.filter((t) => t.principal >= 0).length} principais)`);
