// Renderiza cada tela em telas/*.html com o Chrome da máquina (headless) em
// 1440×900 e 390×844 e grava em _shots/ (fora do git).
// Uso: node docs/arvisx/prototipo/verificar.mjs [filtro-no-nome]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const candidatos = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
];
const chrome = candidatos.find((c) => existsSync(c));
if (!chrome) throw new Error("Chrome não encontrado");

const filtro = process.argv[2] || "";
const saida = join(aqui, "_shots");
mkdirSync(saida, { recursive: true });
const telas = readdirSync(join(aqui, "telas")).filter((f) => f.endsWith(".html") && !f.startsWith("_") && f.includes(filtro));
const tamanhos = [["desktop", "1440,900"], ["celular", "390,844"]];

// O Chrome headless no Windows não abre janela com menos de ~500px de largura, então o
// celular é renderizado dentro de um iframe de 390px (a captura fica com uma faixa vazia à direita).
for (const tela of telas) {
  for (const [nome, tamanho] of tamanhos) {
    const png = join(saida, `${tela.replace(/\.html$/, "")}.${nome}.png`);
    let alvo = pathToFileURL(join(aqui, "telas", tela)).href;
    let moldura = null;
    if (nome === "celular") {
      moldura = join(aqui, "telas", `_moldura-${tela}`);
      writeFileSync(moldura, `<!doctype html><body style="margin:0;background:#07090d"><iframe src="${tela}" style="width:390px;height:844px;border:0;display:block"></iframe></body>`);
      alvo = pathToFileURL(moldura).href;
    }
    execFileSync(chrome, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${tamanho}`,
      "--virtual-time-budget=6000", `--screenshot=${png}`, alvo,
    ], { stdio: "ignore" });
    if (moldura) unlinkSync(moldura);
    console.log(`${tela} → ${nome}`);
  }
}
console.log(`${telas.length} telas em ${saida}`);
