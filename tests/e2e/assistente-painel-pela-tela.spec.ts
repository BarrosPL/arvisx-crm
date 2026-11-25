/**
 * O ASSISTENTE (VIX) PELA TELA — o que dá para provar SEM modelo de IA.
 *
 * O ambiente do e2e é o de uma instalação fresca: nenhuma chave de IA no
 * servidor e o assistente desligado. É nesse estado que esta spec mede:
 *
 *  1. DESLIGADO (o padrão): o botão não existe em tela nenhuma e a rota recusa.
 *  2. LIGADO na instalação, com a empresa liberada: o botão aparece, o painel
 *     abre pelo botão e pelo Ctrl+J.
 *  3. Mensagem com padrão de CHAVE: recusada com a frase certa, e nada é
 *     guardado (conferido no banco). Este caminho não chega ao modelo.
 *  4. Pergunta comum com o servidor SEM chave de IA: a frase de indisponível,
 *     sem detalhe técnico, e o CRM segue de pé.
 *  5. A chave POR EMPRESA, em Configurações › Empresa: desligar faz o botão
 *     sumir e a rota recusar.
 *
 * ⚠️ O QUE ESTA SPEC NÃO PROVA: a RESPOSTA EM STREAM. Ela exige um modelo que
 * responda, e o harness do e2e não tem como injetar um: o pagador
 * `chave_plataforma` lê `ANTHROPIC_API_KEY` do AMBIENTE do `next start`, e o
 * `.env.e2e` não tem chave de IA nenhuma (de propósito: várias specs medem o
 * estado "instalação sem chave"). O stream é medido com modelo simulado em
 * `tests/unit/assistente-rota-de-mensagens.test.ts` e
 * `components/assistente/PainelDoVix.test.tsx`. O que falta para a prova pela
 * tela está em `docs/arvisx/ci/VIX-COMO-LIGAR-2026-11.md`, seção "Prova pela
 * tela do stream".
 *
 * Liga `VIX_PAGADOR` na instalação durante a spec e o remove no fim. O e2e roda
 * com UM worker, então nenhuma outra spec vê o assistente ligado; e ele só
 * aparece para a empresa desta spec, que é a única com a liberação.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { test, expect, type Page } from "./helpers/test";
import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";

const credenciais = credenciaisSupabaseDeTeste();
const db = createClient(credenciais.url, credenciais.serviceRole, { auth: { persistSession: false } });
const senha = `Local-${randomUUID()}!`;
const sufixo = randomUUID().slice(0, 8);
const EVIDENCIA = "evidence/vix-fase-1";
const CHAVE = "VIX_PAGADOR";
// Formato de chave de API, inventado: 48 caracteres depois do prefixo. Não é segredo de ninguém.
const TEXTO_COM_CHAVE = `minha chave é sk-${"e2eExemploNaoReal0".repeat(3).slice(0, 48)}`;

async function entrar(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/senha/i).fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
}

async function perguntar(page: Page, texto: string): Promise<void> {
  const painel = page.getByTestId("vix-painel");
  await painel.getByLabel("Mensagem para o assistente").fill(texto);
  await painel.getByRole("button", { name: "Enviar", exact: true }).click();
}

const mensagensGuardadas = async (orgId: string): Promise<number> => {
  const r = await db.from("assistente_mensagens").select("id", { count: "exact", head: true }).eq("organization_id", orgId);
  if (r.error) throw r.error;
  return r.count ?? 0;
};

test("assistente: desligado some, ligado abre, chave colada é recusada, e a empresa desliga pela tela", async ({ page }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  mkdirSync(EVIDENCIA, { recursive: true });
  let donoId: string | null = null;
  let orgId: string | null = null;
  let falhaDoCenario: unknown;

  try {
    const apaga = await db.from("platform_config").delete().eq("chave", CHAVE);
    if (apaga.error) throw apaga.error;

    const email = `vix-${sufixo}@invariant.test`;
    const criado = await db.auth.admin.createUser({ email, password: senha, email_confirm: true });
    if (criado.error || !criado.data.user) throw criado.error ?? new Error("não criou o dono");
    donoId = criado.data.user.id;
    const org = await db
      .from("organizations")
      .insert({
        slug: `vix-${sufixo}`,
        display_name: `Empresa do assistente ${sufixo}`,
        legal_name: "Empresa do assistente",
        onboarded_at: new Date().toISOString(),
        settings: { plan: "pro" },
      })
      .select("id")
      .single();
    if (org.error) throw org.error;
    orgId = org.data.id as string;
    const vinculo = await db.from("user_organizations").insert({
      organization_id: orgId,
      user_id: donoId,
      role: "admin",
      accepted_at: new Date().toISOString(),
    });
    if (vinculo.error) throw vinculo.error;

    await entrar(page, email);

    // ── 1. DESLIGADO (o padrão da instalação) ───────────────────────────────
    await page.goto("/app/settings/tenant");
    await expect(page.getByRole("heading", { name: "Organização" })).toBeVisible();
    await expect(page.getByTestId("vix-botao")).toHaveCount(0);
    // Com o assistente desligado na instalação, a empresa nem vê a chave dela.
    await expect(page.getByTestId("assistente-da-empresa")).toHaveCount(0);
    const recusaDesligado = await page.request.post("/api/v1/assistente/mensagens", {
      data: { turn_id: randomUUID(), texto: "oi" },
    });
    expect(recusaDesligado.status()).toBe(403);
    expect(((await recusaDesligado.json()) as { error: { code: string } }).error.code).toBe("assistente_desligado");
    await page.screenshot({ path: `${EVIDENCIA}/1-desligado-sem-botao.png`, fullPage: true });

    // ── 2. LIGADO na instalação + empresa liberada ──────────────────────────
    const ligar = await db
      .from("platform_config")
      .upsert({ chave: CHAVE, valor: "chave_plataforma", eh_segredo: false, semeado_do_env: false }, { onConflict: "chave" });
    if (ligar.error) throw ligar.error;

    // Ligado na instalação, mas a empresa ainda sem plano nem liberação: sem botão.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Organização" })).toBeVisible();
    await expect(page.getByTestId("vix-botao")).toHaveCount(0);
    await expect(page.getByTestId("assistente-sem-direito")).toBeVisible();

    const marca = await db
      .from("assistente_estado_da_empresa")
      .upsert({ organization_id: orgId, ligado: true, sem_limite: true }, { onConflict: "organization_id" });
    if (marca.error) throw marca.error;

    await expect(async () => {
      await page.reload();
      await expect(page.getByTestId("vix-botao")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    // Pelo botão.
    await expect(page.getByTestId("vix-painel")).toHaveCount(0);
    await page.getByTestId("vix-botao").click();
    await expect(page.getByTestId("vix-painel")).toBeVisible();
    await page.screenshot({ path: `${EVIDENCIA}/2-painel-aberto-pelo-botao.png`, fullPage: true });
    await page.getByTestId("vix-painel").getByRole("button", { name: "Fechar o assistente" }).click();
    await expect(page.getByTestId("vix-painel")).toHaveCount(0);

    // Pelo atalho.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+j");
    await expect(page.getByTestId("vix-painel")).toBeVisible();

    // ── 3. Mensagem com padrão de chave ─────────────────────────────────────
    await perguntar(page, TEXTO_COM_CHAVE);
    const resposta = page.getByTestId("vix-resposta").last();
    await expect(resposta).toContainText("não deve ser colado aqui");
    await expect(page.getByTestId("vix-abrir-tela").last()).toHaveAttribute("href", "/app/ai/credentials");
    // Nada do que foi colado ficou guardado.
    expect(await mensagensGuardadas(orgId)).toBe(0);
    await page.screenshot({ path: `${EVIDENCIA}/3-chave-colada-recusada.png`, fullPage: true });

    // ── 4. Pergunta comum, servidor sem chave de IA ─────────────────────────
    await perguntar(page, "quantos negócios eu tenho abertos?");
    await expect(page.getByTestId("vix-resposta").last()).toContainText("indisponível no momento");
    const conversa = (await page.getByTestId("vix-conversa").textContent()) ?? "";
    for (const tecnico of ["sem_chave", "ANTHROPIC", "undefined", "[object", "Error"]) {
      expect(conversa).not.toContain(tecnico);
    }
    await page.screenshot({ path: `${EVIDENCIA}/4-indisponivel-sem-chave.png`, fullPage: true });
    await page.getByTestId("vix-painel").getByRole("button", { name: "Fechar o assistente" }).click();

    // ── 5. A chave por empresa ──────────────────────────────────────────────
    const cartao = page.getByTestId("assistente-da-empresa");
    await expect(cartao.getByTestId("assistente-estado")).toHaveText("Ligado para a empresa");
    await cartao.getByTestId("assistente-trocar").click();
    await expect(cartao.getByTestId("assistente-estado")).toHaveText("Desligado para a empresa");
    await expect(page.getByTestId("vix-botao")).toHaveCount(0);
    const gravado = await db.from("assistente_estado_da_empresa").select("ligado, sem_limite").eq("organization_id", orgId).single();
    if (gravado.error) throw gravado.error;
    // A empresa desligou; a liberação da plataforma não foi tocada pela tela.
    expect(gravado.data).toEqual({ ligado: false, sem_limite: true });
    const recusaDaEmpresa = await page.request.post("/api/v1/assistente/mensagens", {
      data: { turn_id: randomUUID(), texto: "oi" },
    });
    expect(recusaDaEmpresa.status()).toBe(403);
    await page.reload();
    await expect(page.getByTestId("vix-botao")).toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCIA}/5-empresa-desligou.png`, fullPage: true });

    // E a mudança ficou na auditoria da empresa.
    await expect(async () => {
      const trilha = await db
        .from("api_audit_log")
        .select("action")
        .eq("organization_id", orgId as string)
        .eq("action", "assistente.configuracao_alterada");
      if (trilha.error) throw trilha.error;
      expect(trilha.data.length).toBeGreaterThan(0);
    }).toPass({ timeout: 20_000 });
  } catch (erro) {
    falhaDoCenario = erro;
    throw erro;
  } finally {
    try {
      const desliga = await db.from("platform_config").delete().eq("chave", CHAVE);
      if (desliga.error) throw desliga.error;
      if (orgId) {
        const r = await db.from("organizations").delete().eq("id", orgId);
        if (r.error) throw r.error;
      }
      if (donoId) {
        const r = await db.auth.admin.deleteUser(donoId);
        if (r.error) throw r.error;
      }
    } catch (erroDaLimpeza) {
      test.info().annotations.push({ type: "cleanup", description: `limpeza incompleta: org ${orgId ?? "-"}` });
      if (!falhaDoCenario) throw erroDaLimpeza;
    }
  }
});
