import { test, expect } from "./helpers/test";

test("home returns 200 and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  expect(errors).toEqual([]);
});

// Tarefa 8: a página inicial diz que a IA vem incluída nos planos. O que se mede
// é a página servida de verdade, nos dois idiomas que ela tem, e só nos três
// trechos que mudaram: o topo, a seção da IA e a pergunta "Como funciona a IA?".
// O aviso "Quem cuida dos agentes de IA", abaixo dos planos, fica de fora de
// propósito: ele descreve os planos vendidos hoje e segue como estava.
for (const [idioma, incluida, antiga] of [
  ["pt-BR", "IA incluída em todos os planos, com franquia mensal", /com as credenciais da sua empresa|a partir do (plano )?Standard|Do CRM, você paga só o plano/],
  ["es-ES", "IA incluida en todos los planes, con una franquicia mensual", /con las credenciales de tu empresa|desde el plan Standard|Del CRM solo pagas el plan/],
] as const) {
  test(`a página inicial (${idioma}) diz que a IA vem incluída, e não traz mais a frase das credenciais`, async ({ browser }) => {
    const contexto = await browser.newContext({ locale: idioma });
    try {
      const page = await contexto.newPage();
      const res = await page.goto("/");
      expect(res?.status()).toBe(200);
      await expect(page.locator(".hero").getByText(incluida, { exact: true })).toBeVisible();
      for (const seletor of [".hero", "#suas-chaves", "#faq"]) {
        const trecho = (await page.locator(seletor).first().textContent()) ?? "";
        expect(trecho.length, `${seletor} veio vazio: a asserção de ausência não mediria nada`).toBeGreaterThan(100);
        expect(trecho, `${seletor} ainda traz a frase antiga`).not.toMatch(antiga);
      }
    } finally {
      await contexto.close();
    }
  });
}
