// Mede cada tela de telas/*.html sem olhar PNG: largura rolável a 390 e 1440 (estouro) e
// ícones Phosphor sem glifo. Usa o Chrome headless com --dump-dom e um script injetado
// numa cópia temporária da tela. Uso: node docs/arvisx/prototipo/medir.mjs [filtro]
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const chrome = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
].find((c) => existsSync(c));
if (!chrome) throw new Error("Chrome não encontrado");

const filtro = process.argv[2] || "";
const telas = readdirSync(join(aqui, "telas")).filter((f) => f.endsWith(".html") && !f.startsWith("_") && f.includes(filtro));

// O Chrome headless não abre janela com menos de ~500px; a largura de 390 é forçada no <html>.
const sonda = (largura) => `<script>setTimeout(()=>{
  const doc=document.documentElement; ${largura < 500 ? `doc.style.width='${largura}px';document.body.style.width='${largura}px';` : ""}
  const vw=${largura}; const sw=document.body.scrollWidth;
  const ignora=(e)=>{for(let a=e;a&&a!==document.body;a=a.parentElement){const cs=getComputedStyle(a);if(cs.position==='fixed'||cs.position==='sticky'&&a.classList.contains('lote'))return true;if(/(auto|scroll|hidden)/.test(cs.overflowX)&&a!==e)return true;}return false;};
  const fora=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.right>vw+1&&r.width>0&&!ignora(e)}).slice(0,6).map(e=>e.tagName.toLowerCase()+'.'+String(e.className).split(' ').slice(0,2).join('.')+'@'+Math.round(e.getBoundingClientRect().right));
  const semGlifo=[...document.querySelectorAll('i.ph, i.ph-fill')].filter(i=>{const c=getComputedStyle(i,'::before').content;return !c||c==='none'||c==='""'}).map(i=>i.className).filter((v,i,a)=>a.indexOf(v)===i).slice(0,6);
  document.title='SW='+sw+' VW='+vw+(fora.length?' FORA='+fora.join(','):'')+(semGlifo.length?' SEMGLIFO='+semGlifo.join(','):'');
},2500)</script></body>`;

let problemas = 0;
for (const tela of telas) {
  for (const largura of [1440, 390]) {
    const html = readFileSync(join(aqui, "telas", tela), "utf8").replace("</body>", sonda(largura));
    const tmp = join(aqui, "telas", `_medir-${tela}`);
    writeFileSync(tmp, html);
    let saida = "";
    try {
      saida = execFileSync(chrome, [
        "--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${Math.max(largura, 500)},900`,
        "--virtual-time-budget=8000", "--dump-dom", pathToFileURL(tmp).href,
      ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
    } finally { unlinkSync(tmp); }
    const titulo = (saida.match(/<title>([^<]*)<\/title>/) || [, "sem medida"])[1];
    const sw = Number((titulo.match(/SW=(\d+)/) || [])[1]);
    const ruim = !sw || sw > largura + 1 || titulo.includes("FORA=") || titulo.includes("SEMGLIFO");
    if (ruim) problemas++;
    console.log(`${ruim ? "✗" : "✓"} ${tela} @${largura}: ${titulo}`);
  }
}
console.log(`${telas.length} telas, ${problemas} medidas com problema`);
