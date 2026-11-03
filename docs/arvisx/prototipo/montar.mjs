// Monta o index.html do protótipo a partir de telas/*.html.
// Cada tela declara <title>, <meta name="grupo" content="Atendimento"> e
// <meta name="ordem" content="10">. Uso: node docs/arvisx/prototipo/montar.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const pasta = join(aqui, "telas");
const ORDEM_GRUPOS = ["Entrada", "Atendimento", "CRM", "Agente de IA", "Canais", "Análise", "Organização"];

const telas = readdirSync(pasta)
  .filter((f) => f.endsWith(".html"))
  .map((arquivo) => {
    const html = readFileSync(join(pasta, arquivo), "utf8");
    const pega = (re, padrao) => (html.match(re) || [, padrao])[1];
    return {
      arquivo,
      titulo: pega(/<title>([^<]*)<\/title>/, arquivo),
      grupo: pega(/name="grupo" content="([^"]*)"/, "Outras"),
      ordem: Number(pega(/name="ordem" content="([^"]*)"/, "999")),
      rota: pega(/data-rota="([^"]*)"/, ""),
    };
  })
  .sort((a, b) => ORDEM_GRUPOS.indexOf(a.grupo) - ORDEM_GRUPOS.indexOf(b.grupo) || a.ordem - b.ordem || a.titulo.localeCompare(b.titulo));

const grupos = [...new Set(telas.map((t) => t.grupo))];
const lista = grupos.map((g) => `
  <h2>${g}</h2>
  <ul>${telas.filter((t) => t.grupo === g).map((t) => `
    <li><a href="#${t.arquivo.replace(/\.html$/, "")}" data-arquivo="${t.arquivo}">${t.titulo}<small>${t.rota}</small></a></li>`).join("")}
  </ul>`).join("");

const pagina = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ARVISX CRM — protótipo de redesign</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,500..800&family=JetBrains+Mono:wght@400;500;600&family=Manrope:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css">
<style>
  :root { --navy:#0f131a; --navy-2:#151b26; --linha:#2c3646; --ouro:#d4af37; --ouro-claro:#f1d47c; --texto:#eef0f3; --apoio:#a2abb9; --fraco:#6c7586; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Manrope", system-ui, sans-serif; background: #07090d; color: var(--texto); height: 100vh; display: grid; grid-template-columns: 300px 1fr; overflow: hidden; }
  aside { background: var(--navy); border-right: 1px solid var(--linha); display: flex; flex-direction: column; min-height: 0; }
  aside .cab { padding: 18px 18px 14px; border-bottom: 1px solid var(--linha); }
  aside .cab img { height: 24px; display: block; margin-bottom: 12px; }
  aside .cab strong { font-family: "Archivo"; font-stretch: 112%; font-weight: 650; letter-spacing: -.02em; font-size: 15px; display: block; }
  aside .cab span { color: var(--fraco); font: 500 11px/1.4 "JetBrains Mono", monospace; display: block; margin-top: 4px; }
  aside nav { overflow-y: auto; flex: 1; padding: 10px; scrollbar-width: thin; scrollbar-color: var(--linha) transparent; }
  aside h2 { font: 500 10.5px/1 "JetBrains Mono", monospace; letter-spacing: .14em; text-transform: uppercase; color: var(--fraco); padding: 12px 10px 6px; }
  aside ul { list-style: none; }
  aside a { display: block; padding: 7px 10px; border-radius: 6px; color: var(--apoio); text-decoration: none; font-weight: 600; font-size: 13px; }
  aside a small { display: block; color: var(--fraco); font: 500 10.5px/1.3 "JetBrains Mono", monospace; margin-top: 2px; }
  aside a:hover { background: var(--navy-2); color: var(--texto); }
  aside a.ativo { background: rgba(212,175,55,.12); color: var(--ouro-claro); box-shadow: inset 2px 0 0 var(--ouro); }
  main { display: flex; flex-direction: column; min-width: 0; }
  .barra { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--linha); background: var(--navy); }
  .barra .titulo { font-weight: 700; margin-right: auto; }
  .barra .titulo small { color: var(--fraco); font: 500 11px/1 "JetBrains Mono", monospace; margin-left: 10px; }
  .barra button, .barra a { font: 600 12px/1 "Manrope"; color: var(--apoio); background: var(--navy-2); border: 1px solid var(--linha); border-radius: 6px; padding: 7px 10px; cursor: pointer; text-decoration: none; }
  .barra button[aria-pressed="true"] { background: var(--ouro); border-color: var(--ouro); color: var(--navy); }
  .palco { flex: 1; display: grid; place-items: center; padding: 20px; overflow: auto; background: radial-gradient(circle at 50% 0, #121824, #07090d 70%); }
  .quadro { background: #fff; box-shadow: 0 30px 80px -30px rgba(0,0,0,.8); transition: width .2s, height .2s; border-radius: 4px; overflow: hidden; }
  .quadro.celular { width: 390px; height: 844px; border-radius: 28px; border: 8px solid #1d2531; }
  .quadro.desktop { width: 100%; height: 100%; max-width: 1440px; }
  iframe { width: 100%; height: 100%; border: 0; display: block; background: #f7f6f2; }
</style>
</head>
<body>
<aside>
  <div class="cab">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><img src="marca/arvisx-simbolo-branco.png" alt="" style="height:28px;margin:0"><b style="font-family:Archivo;font-stretch:118%;font-weight:700;letter-spacing:.14em;font-size:15px;color:#fff">ARVISX<em style="font-style:normal;color:#d4af37;font-weight:600;margin-left:4px">CRM</em></b></div>
    <strong>Protótipo de redesign do CRM</strong>
    <span>${telas.length} telas · só visual, conteúdo igual ao app</span>
  </div>
  <nav>${lista}</nav>
</aside>
<main>
  <div class="barra">
    <span class="titulo" id="titulo"></span>
    <button type="button" data-modo="desktop" aria-pressed="true">Desktop</button>
    <button type="button" data-modo="celular" aria-pressed="false">Celular 390</button>
    <a id="abrir" href="#" target="_blank" rel="noopener">Abrir em aba</a>
  </div>
  <div class="palco"><div class="quadro desktop" id="quadro"><iframe id="tela" title="Tela"></iframe></div></div>
</main>
<script>
  const links = [...document.querySelectorAll("aside a")];
  const iframe = document.getElementById("tela");
  const quadro = document.getElementById("quadro");
  const titulo = document.getElementById("titulo");
  const abrir = document.getElementById("abrir");
  function mostrar() {
    const alvo = location.hash.slice(1) || links[0].getAttribute("href").slice(1);
    const a = links.find((l) => l.getAttribute("href") === "#" + alvo) || links[0];
    links.forEach((l) => l.classList.toggle("ativo", l === a));
    const src = "telas/" + a.dataset.arquivo;
    if (iframe.getAttribute("src") !== src) iframe.src = src;
    abrir.href = src;
    titulo.innerHTML = a.firstChild.textContent + "<small>" + a.querySelector("small").textContent + "</small>";
  }
  window.addEventListener("hashchange", mostrar);
  mostrar();
  document.querySelectorAll("[data-modo]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-modo]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    quadro.className = "quadro " + b.dataset.modo;
  }));
</script>
</body>
</html>
`;
writeFileSync(join(aqui, "index.html"), pagina);
console.log(`index.html com ${telas.length} telas em ${grupos.length} grupos`);
