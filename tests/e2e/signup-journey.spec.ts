/**
 * E2E — jornada completa de criação de conta (usuário real, browser real):
 *
 * 1. abre /signup direto — o /login não oferece mais "Criar conta" (decisão do
 *    dono, c09d28e55: quem chega sem convite não é convidado a se cadastrar
 *    pela tela de entrar; a porta do cadastro é a página inicial e o convite)
 * 2. preenche o formulário de signup e envia (sem plano oferecido, o cadastro
 *    não tem o passo dos cartões de plano: `EscolhaDoPlano` é transparente)
 * 3. abre o e-mail de confirmação (Mailpit) e clica no link
 * 4. cai autenticado no onboarding (tenant provisionado)
 * 5. sai e entra de novo com as credenciais criadas
 *
 * Pré-requisitos: Supabase local com Mailpit + app `next start` (ver README
 * da suíte / playwright.config.ts).
 */
import { test, expect } from "./helpers/test";

import { DEFAULT_APP_NAME } from "@/lib/branding";

import { waitForEmail, extractAuthConfirmLink, seguirLinkDeAcesso, uniqueEmail } from "./helpers/auth";

test("criar conta: signup → e-mail de confirmação → onboarding → re-login", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("signup");
  const password = "SenhaForte!123";

  // 1. A tela de cadastro. O /login deixou de levar a ela (c09d28e55), então a
  //    jornada começa aqui; que o /login não oferece o link é medido em
  //    `tests/unit/convite-caminhos-de-acesso.test.tsx`.
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Criar conta", exact: true })).toBeVisible();
  // O cadastro tem dois passos quando a instalação oferece planos (fe9d5f1db),
  // e esse caminho é o da `cobranca-revendedor.spec.ts`. Aqui a instalação não
  // oferece nenhum: se os cartões aparecerem, outra spec deixou plano para trás.
  await expect(
    page.getByTestId("escolha-do-plano"),
    "o cadastro abriu no passo dos planos: há plano oferecido sobrando no banco do e2e",
  ).toHaveCount(0);

  // 2. Formulário de signup
  await page.getByLabel("Nome da empresa").fill("Loja E2E Signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await expect(page.getByText("Confirme seu e-mail")).toBeVisible();

  // 3. Abre o e-mail real no Mailpit e segue o link
  const html = await waitForEmail(email, "Confirme seu e-mail");
  const link = extractAuthConfirmLink(html, baseURL!);
  await seguirLinkDeAcesso(page, link);

  // 4. Autenticado no onboarding — tenant provisionado
  await expect(page).toHaveURL(/\/onboarding\/welcome/);
  // O nome é o da marca do produto (`DEFAULT_APP_NAME`, que virou "ArvisX CRM" em
  // dd2e7fe9d): o ambiente do e2e não define APP_NAME nem grava marca no banco.
  await expect(page.getByText(`Boas-vindas ao ${DEFAULT_APP_NAME}`)).toBeVisible();
  await expect(page.getByText("Loja E2E Signup")).toBeVisible();

  // 5. Sai (limpa sessão) e entra de novo com as credenciais criadas
  await context.clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/(app|onboarding)\//, { timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/login/);
});
