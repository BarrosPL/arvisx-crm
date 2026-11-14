import { createRequire } from "node:module";
const require = createRequire("C:/Users/lcsin/Desktop/arvisx-crm-main/package.json");
const { chromium } = require("@playwright/test");
const BASE = "http://localhost:3100";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE + "/login");
await page.fill('input[type="email"]', "dono@treinamento.local");
await page.fill('input[type="password"]', "Treino!2026");
await page.click('button[type="submit"]');
await page.waitForURL(/\/app\//, { timeout: 120000 });
for (const c of ["/onboarding", "/onboarding/welcome", "/onboarding/connect-whatsapp", "/onboarding/setup-ai", "/onboarding/funil", "/onboarding/testar", "/onboarding/invite-team", "/onboarding/done"]) {
  await page.goto(BASE + c, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(800);
  const wizard = await page.evaluate(() => !!document.querySelector("main.max-w-3xl"));
  console.log(c.padEnd(32), "->", new URL(page.url()).pathname, wizard ? "[CASCA ANTIGA]" : "");
}
await page.screenshot({ path: process.argv[2] });
await browser.close();
