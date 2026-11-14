import { createRequire } from "node:module";
const require = createRequire("C:/Users/lcsin/Desktop/arvisx-crm-main/package.json");
const { chromium } = require("@playwright/test");
const BASE = "http://localhost:3100";
const OUT = process.argv[2];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const visto = [];
page.on("framenavigated", (f) => { if (f === page.mainFrame()) visto.push("NAV " + new URL(f.url()).pathname); });
page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/onboarding")) visto.push(`REQ ${r.method()} ${u.pathname}${r.headers()["rsc"] ? " (rsc)" : ""}`); });
// amostra a tela: caminho + se a casca do wizard antigo está desenhada
await page.addInitScript(() => {
  let ultimo = "";
  setInterval(() => {
    const wizard = !!document.querySelector("main.max-w-3xl") && !document.querySelector("[data-guia-do-onboarding]");
    const s = location.pathname + (wizard ? " [CASCA DO WIZARD ANTIGO]" : "");
    if (s !== ultimo) { ultimo = s; console.log("TELA " + s); }
  }, 30);
});
page.on("console", (m) => { if (m.text().startsWith("TELA ")) visto.push(m.text()); });
let n = 0;
const foto = async (nome) => page.screenshot({ path: `${OUT}/${String(++n).padStart(2, "0")}-${nome}.png` });
const marca = (t) => visto.push("---- " + t);

await page.goto(BASE + "/login");
await page.fill('input[type="email"]', "dono@treinamento.local");
await page.fill('input[type="password"]', "Treino!2026");
await page.click('button[type="submit"]');
await page.waitForURL(/\/app\//, { timeout: 120000 });
await page.waitForSelector("[data-guia-do-onboarding]", { timeout: 120000 });
await foto("entrada");

for (let passo = 0; passo < 6; passo++) {
  const guia = page.locator("[data-guia-do-onboarding]");
  if (!(await guia.count())) break;
  const ir = guia.getByRole("link", { name: /^Ir para/ });
  if (await ir.count()) { marca("clique: " + (await ir.innerText())); await ir.click(); await page.waitForSelector("[data-bloco-do-guia]", { timeout: 120000 }); }
  const bloco = page.locator("[data-bloco-do-guia]");
  const alvo = (await bloco.count()) ? bloco : guia;
  const pular = alvo.getByRole("button", { name: /Pular|Fazer isso depois|Agora não|Depois/ }).first();
  if (!(await pular.count())) { marca("sem botão de pular; botões: " + (await alvo.getByRole("button").allInnerTexts()).join(" | ")); break; }
  const antes = await guia.locator("p").first().innerText().catch(() => "");
  marca(`clique: ${await pular.innerText()} em ${new URL(page.url()).pathname}`);
  await foto("antes-de-pular");
  await pular.click();
  await page.waitForFunction((a) => { const g = document.querySelector("[data-guia-do-onboarding] p"); return g && g.textContent !== a; }, antes, { timeout: 120000 }).catch(() => marca("o painel NÃO mudou em 120s"));
  await page.waitForTimeout(1500);
  await foto("depois-de-pular");
}
marca("fim em " + new URL(page.url()).pathname);
console.log(visto.join("\n"));
await browser.close();
