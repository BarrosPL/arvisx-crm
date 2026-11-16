// Varredura de UI das telas da proposta, medida por ferramenta (nunca a olho).
// Abre cada tela no Chrome (Playwright) em 1440 e 390 e mede: estouro de largura,
// altura dos controles, controles desalinhados na mesma linha, contraste de texto,
// texto miúdo, rótulos em caixa alta, raios de canto, faixa colorida na lateral,
// texto cortado, alvo de toque pequeno e botão de ícone sem nome.
// Uso: node docs/arvisx/prototipo/servir.mjs  (em outro terminal)
//      node docs/arvisx/prototipo/proposta-folha/varrer.mjs [a|b] [pasta-das-capturas] [filtro]
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const paleta = process.argv[2] || "b";
const capturas = process.argv[3] || "";
const filtro = process.argv[4] || "";
const base = `http://localhost:8766/proposta-folha/${paleta}`;
const telas = JSON.parse(readFileSync(join(aqui, "telas.json"), "utf8")).filter((t) => t.id.includes(filtro));
if (capturas) mkdirSync(capturas, { recursive: true });

const sonda = () => {
  const visivel = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const nome = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).slice(0, 3).join(".") : "");
  const rgb = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[,\s/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const fundoDe = (e) => { let pilha = []; for (let a = e; a; a = a.parentElement) { const c = rgb(getComputedStyle(a).backgroundColor); if (c && c.a > 0) { pilha.push(c); if (c.a >= 1) break; } } let cor = { r: 255, g: 255, b: 255 }; for (const c of pilha.reverse()) cor = { r: c.r * c.a + cor.r * (1 - c.a), g: c.g * c.a + cor.g * (1 - c.a), b: c.b * c.a + cor.b * (1 - c.a) }; return cor; };
  const vw = innerWidth;
  const s = { estouro: document.documentElement.scrollWidth > vw + 1 ? document.documentElement.scrollWidth : 0, controles: [], desalinhados: [], contraste: [], miudo: [], caixaAlta: [], raios: {}, faixa: [], cortado: [], toque: [], semNome: [], pesos: {}, tamanhos: {} };

  const ehControle = (e) => e.matches("button, a.btn, .btn, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, .filtro, .chip, .busca-linha, .entrada");
  const controles = [...document.querySelectorAll("button, a.btn, .btn, input, select, .filtro, .chip, .busca-linha, .entrada")].filter((e) => ehControle(e) && visivel(e) && !e.closest(".lateral, .topo, .barra-inferior"));
  for (const e of controles) {
    const r = e.getBoundingClientRect();
    s.controles.push([nome(e), Math.round(r.height)]);
    if (vw < 500 && (r.height < 36 || r.width < 36) && !e.closest(".segmento, .abas")) s.toque.push(`${nome(e)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    if (e.matches("button, a") && !e.textContent.trim() && !e.getAttribute("aria-label") && !e.title) s.semNome.push(nome(e));
  }
  // controles irmãos, lado a lado na mesma linha, com alturas diferentes
  const pais = new Set(controles.map((e) => e.parentElement));
  for (const p of pais) {
    const filhos = [...p.children].filter((c) => ehControle(c) && visivel(c) && !c.matches("textarea"));
    if (filhos.length < 2) continue;
    const linhas = {};
    for (const c of filhos) { const r = c.getBoundingClientRect(); if (r.height > 60) continue; const k = Math.round((r.top + r.height / 2) / 6); (linhas[k] ||= []).push(Math.round(r.height)); }
    for (const hs of Object.values(linhas)) { const u = [...new Set(hs)]; if (u.length > 1 && Math.max(...u) - Math.min(...u) >= 2) s.desalinhados.push(`${nome(p)}: ${u.sort((a, b) => a - b).join("/")}`); }
  }
  // texto
  const andar = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const vistos = new Set();
  for (let n = andar.nextNode(); n; n = andar.nextNode()) {
    const txt = n.textContent.trim(); const e = n.parentElement;
    if (!txt || !e || vistos.has(e) || !visivel(e) || e.closest("script, style")) continue;
    vistos.add(e);
    const cs = getComputedStyle(e); const fs = parseFloat(cs.fontSize);
    s.tamanhos[fs] = (s.tamanhos[fs] || 0) + 1; s.pesos[cs.fontWeight] = (s.pesos[cs.fontWeight] || 0) + 1;
    const amostra = `${nome(e)} "${txt.slice(0, 28)}"`;
    if (fs < 11.5) s.miudo.push(`${fs}px ${amostra}`);
    if (cs.textTransform === "uppercase" && txt.length > 2) s.caixaAlta.push(amostra);
    const cor = rgb(cs.color); if (!cor) continue;
    const bg = fundoDe(e); const fg = { r: cor.r * cor.a + bg.r * (1 - cor.a), g: cor.g * cor.a + bg.g * (1 - cor.a), b: cor.b * cor.a + bg.b * (1 - cor.a) };
    const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a); const taxa = (l1 + .05) / (l2 + .05);
    const grande = fs >= 24 || (fs >= 18.66 && Number(cs.fontWeight) >= 700);
    if (taxa < (grande ? 3 : 4.5) && !e.closest("[disabled], .desabilitado")) s.contraste.push(`${taxa.toFixed(2)} ${cs.color} ${amostra}`);
    if (e.scrollWidth > e.clientWidth + 1 && cs.textOverflow === "ellipsis" && cs.overflow !== "visible") s.cortado.push(amostra);
  }
  for (const e of document.querySelectorAll(".conteudo *")) {
    if (!visivel(e)) continue; const cs = getComputedStyle(e);
    const temCaixa = parseFloat(cs.borderTopWidth) > 0 || (rgb(cs.backgroundColor)?.a ?? 0) > 0;
    if (temCaixa && cs.borderTopLeftRadius !== "0px") s.raios[cs.borderTopLeftRadius] = (s.raios[cs.borderTopLeftRadius] || 0) + 1;
    const bl = parseFloat(cs.borderLeftWidth), bt = parseFloat(cs.borderTopWidth);
    if (bl >= 3 && bl > bt) s.faixa.push(nome(e));
    if (/inset 3px 0px|inset 2px 0px/.test(cs.boxShadow)) s.faixa.push(nome(e) + " (sombra)");
  }
  return s;
};

const navegador = await chromium.launch({ channel: "chrome" });
const resultado = {};
for (const largura of [1440, 390]) {
  const ctx = await navegador.newContext({ viewport: { width: largura, height: largura === 1440 ? 900 : 844 }, deviceScaleFactor: 1 });
  const pagina = await ctx.newPage();
  for (const t of telas) {
    await pagina.goto(`${base}/${t.id}.html`, { waitUntil: "networkidle" });
    await pagina.evaluate(() => document.fonts.ready);
    (resultado[t.id] ||= {})[largura] = await pagina.evaluate(sonda);
    if (capturas) await pagina.screenshot({ path: join(capturas, `${t.id}.${largura}.png`), fullPage: false });
  }
  await ctx.close();
}
await navegador.close();

// resumo
const soma = (chave, largura) => { const m = {}; for (const [id, r] of Object.entries(resultado)) for (const x of r[largura][chave]) (m[x] ||= new Set()).add(id); return Object.entries(m).map(([k, v]) => [k, v.size]).sort((a, b) => b[1] - a[1]); };
const alturas = {}; for (const r of Object.values(resultado)) for (const [, h] of r[1440].controles) alturas[h] = (alturas[h] || 0) + 1;
const junta = (chave) => { const m = {}; for (const r of Object.values(resultado)) for (const [k, v] of Object.entries(r[1440][chave])) m[k] = (m[k] || 0) + v; return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])); };
const resumo = {
  telas: telas.length,
  estouro: Object.entries(resultado).flatMap(([id, r]) => [1440, 390].filter((l) => r[l].estouro).map((l) => `${id}@${l}=${r[l].estouro}`)),
  alturasDosControles: alturas,
  tamanhosDeTexto: junta("tamanhos"), pesosDeTexto: junta("pesos"), raios: junta("raios"),
  desalinhados: soma("desalinhados", 1440), desalinhadosCelular: soma("desalinhados", 390),
  contraste: soma("contraste", 1440).length, contrastePorCor: (() => { const m = {}; for (const r of Object.values(resultado)) for (const x of r[1440].contraste) { const c = x.split(" ").slice(1, 4).join(" ").replace(/\).*/, ")"); m[c] = (m[c] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 14); })(),
  miudo: soma("miudo", 1440).length, caixaAlta: soma("caixaAlta", 1440).length,
  faixa: soma("faixa", 1440), cortado: soma("cortado", 1440).length, cortadoCelular: soma("cortado", 390).length,
  toque: soma("toque", 390).length, semNome: soma("semNome", 1440),
};
writeFileSync(join(aqui, `varredura-${paleta}.json`), JSON.stringify({ resumo, telas: resultado }, null, 1));
console.log(JSON.stringify(resumo, null, 1));
