/**
 * EQUIPE DE IA PRONTA, PELA TELA (ArvisX, migration 9808).
 *
 * Três jornadas, com a cobrança ligada e planos de verdade no banco:
 *
 *   1. [P0] Empresa Premium nova: responde o questionário mínimo, revisa o
 *      texto dos agentes, instala, e cai no painel — em ENSAIO, com o checklist
 *      e os quatro agentes publicados.
 *   2. Empresa Standard: a tela não abre (vai para "Isso não está no seu
 *      plano", que diz em que plano a equipe está) e a API responde 403.
 *   3. Rebaixar a Premium para Standard: a tela fecha, a API responde 403, a
 *      lista de agentes avisa que a equipe está pausada, e NADA foi apagado nem
 *      despublicado. Voltar ao Premium reabre tudo sem reinstalar.
 *
 * O que esta spec NÃO prova: que um agente responde a uma mensagem. Não há
 * provedor de IA no CI; a chave cadastrada é falsa e é marcada como validada à
 * mão (mesmo recurso de `jev-roteador.spec.ts`). A pausa do MOTOR fora do plano
 * é medida em `tests/unit/equipe-pronta-so-no-premium.test.ts`; aqui se mede o
 * que a pessoa vê.
 *
 * Empresas, pessoas e planos são sintéticos, inseridos pelo service role; tudo
 * morre no `finally`, e as chaves da instalação voltam ao que eram.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

import { test, expect, type BrowserContext, type Page } from "./helpers/test";
import {
  criarPessoa, db, entrar, fotografarChaves, inserir, restaurarChaves, type FotoDasChaves,
} from "./helpers/cobranca";
import { PLANOS } from "../helpers/distribuicao-dos-planos";

const sufixo = randomUUID().slice(0, 8);
const EVIDENCIA = "evidence/equipe-pronta";
const TELA = "/app/ai/equipe-pronta";
const EMPRESA = `Oficina Sintética ${sufixo}`;

async function empresaCom(
  rotulo: string,
  plano: string,
): Promise<{ org: string; admin: { id: string; email: string } }> {
  const admin = await criarPessoa(`ep-${rotulo}`, sufixo);
  const org = await inserir("organizations", {
    slug: `ep-${rotulo}-${sufixo}`,
    display_name: rotulo === "premium" ? EMPRESA : `Standard Sintética ${sufixo}`,
    legal_name: "Empresa sintética",
    onboarded_at: new Date().toISOString(),
  });
  const vinculo = await db
    .from("user_organizations")
    .insert({ organization_id: org, user_id: admin.id, role: "admin", accepted_at: new Date().toISOString() });
  if (vinculo.error) throw vinculo.error;
  const assina = await db.from("cobranca_assinaturas").insert({
    organization_id: org,
    plano_id: plano,
    estado: "trial",
    trial_ate: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  });
  if (assina.error) throw assina.error;
  return { org, admin };
}

async function agentesDaEquipe(org: string) {
  const r = await db
    .from("ai_agents")
    .select("id, config, published_version_id, archived_at")
    .eq("organization_id", org);
  if (r.error) throw r.error;
  return (r.data ?? []).filter((a) => (a.config as Record<string, unknown> | null)?.equipe_pronta !== undefined);
}

async function foto(page: Page, nome: string) {
  mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: `${EVIDENCIA}/${nome}.png`, fullPage: true });
}

test("[P0] Equipe de IA pronta: Premium instala pelo questionário; Standard não tem a tela; rebaixar pausa sem apagar", async ({
  page,
  browser,
}) => {
  test.setTimeout(420_000);
  page.setDefaultTimeout(30_000);
  const pessoas: string[] = [];
  const orgs: string[] = [];
  const planos: string[] = [];
  const contextos: BrowserContext[] = [];
  const chaves: FotoDasChaves = await fotografarChaves();

  try {
    // ── 0. Cobrança ligada e dois planos: Premium (tudo) e Standard (lista) ──
    const ligar = await db.from("platform_config").upsert(
      { chave: "MODULO_COBRANCA", valor: "ligado", eh_segredo: false, semeado_do_env: false },
      { onConflict: "chave" },
    );
    if (ligar.error) throw ligar.error;

    const dono = await criarPessoa("ep-dono", sufixo);
    pessoas.push(dono.id);
    const premium = await inserir("cobranca_planos", {
      nome: `Premium E2E ${sufixo}`,
      preco_cents: 49_900,
      intervalo: "mes",
      trial_dias: 7,
      interface_settings: { preset: "completa" },
      updated_by: dono.id,
    });
    const standard = await inserir("cobranca_planos", {
      nome: `Standard E2E ${sufixo}`,
      preco_cents: 19_900,
      intervalo: "mes",
      trial_dias: 7,
      interface_settings: { preset: "simplificada", destinos: [...PLANOS.Standard] },
      updated_by: dono.id,
    });
    planos.push(premium, standard);

    const a = await empresaCom("premium", premium);
    const b = await empresaCom("standard", standard);
    pessoas.push(a.admin.id, b.admin.id);
    orgs.push(a.org, b.org);

    // O WhatsApp da empresa Premium, já conectado: publicar agente exige canal de pé.
    const canal = await inserir("channel_sessions", {
      organization_id: a.org,
      waha_session_name: `ep-${sufixo}`,
      display_name: "WhatsApp sintético",
      status: "WORKING",
      webhook_secret_encrypted: "\\x00",
    });

    // ── 1. Premium: a chave de IA, e o questionário mínimo ──────────────────
    await entrar(page, a.admin.email);
    await test.step("a chave de IA da empresa, cadastrada pela rota e validada à mão", async () => {
      const criou = await page.request.post("/api/v1/ai/credentials", {
        data: { provider: "anthropic", label: `IA ${sufixo}`, api_key: "sk-ant-e2e-equipe-pronta-00000000000000000000" },
      });
      expect(criou.status(), await criou.text()).toBe(201);
      const id = ((await criou.json()) as { data: { id: string } }).data.id;
      // O teste de fundo recusa a chave falsa; só depois dele a marca fica.
      await expect(async () => {
        const { data } = await db
          .from("ai_provider_credentials")
          .select("validated_at, validation_error")
          .eq("id", id)
          .single();
        const linha = data as { validated_at: string | null; validation_error: string | null } | null;
        expect(linha?.validation_error ?? linha?.validated_at, "o teste de fundo da chave ainda não terminou").toBeTruthy();
      }).toPass({ timeout: 30_000, intervals: [1_000, 2_000] });
      const marca = await db
        .from("ai_provider_credentials")
        .update({ validated_at: new Date().toISOString(), validation_error: null } as never)
        .eq("id", id);
      if (marca.error) throw marca.error;
    });

    await test.step("o atalho em IA › Agentes leva à tela", async () => {
      await page.goto("/app/ai/agents");
      await page.getByTestId("atalho-equipe-pronta").getByRole("link", { name: "Abrir a equipe pronta" }).click();
      await page.waitForURL(`**${TELA}`);
      await expect(page.getByRole("heading", { name: "Equipe pronta", level: 1 })).toBeVisible();
    });

    await test.step("passo 1 — o negócio; sair e voltar não perde o que foi salvo", async () => {
      await expect(page.getByTestId("ep-passo-negocio")).toBeVisible();
      await page.getByLabel("Nome da empresa").fill(EMPRESA);
      await page.getByLabel("O que a empresa faz").fill("Conserto e manutenção de bicicletas.");

      // A pergunta "tipo de negócio" (Tarefa 8): começa no genérico, sem aviso de
      // ramo; escolher um ramo mostra que as sugestões são rascunho.
      const tipo = page.getByLabel("Tipo de negócio");
      await expect(tipo).toHaveValue("generico");
      await expect(page.getByTestId("ep-aviso-do-ramo")).toHaveCount(0);
      await tipo.selectOption({ label: "Advocacia" });
      await expect(page.getByTestId("ep-aviso-do-ramo")).toContainText("ainda não foram validadas com um cliente real");
      await foto(page, "00-questionario-tipo-de-negocio");

      await page.getByTestId("ep-salvar").click();
      await expect(page.getByTestId("ep-passo-atendente")).toBeVisible();

      // O rascunho está no servidor: recarregar abre no primeiro passo que falta.
      await page.reload();
      await expect(page.getByTestId("ep-passo-atendente")).toBeVisible();
      await page.getByTestId("ep-ir-negocio").click();
      await expect(page.getByLabel("Nome da empresa")).toHaveValue(EMPRESA);
      await expect(page.getByLabel("Tipo de negócio")).toHaveValue("advocacia");
      await page.getByTestId("ep-ir-atendente").click();
    });

    await test.step("passos 2 e 3 — o atendente e o primeiro passo da venda", async () => {
      await page.getByLabel("Nome do atendente").fill("Bia");
      await page.getByTestId("ep-salvar").click();
      await expect(page.getByTestId("ep-passo-venda")).toBeVisible();
      await page.getByTestId("ep-primeiro-passo-humano").check();
      await page.getByTestId("ep-salvar").click();
      await expect(page.getByTestId("ep-passo-regras")).toBeVisible();
      // Com os três obrigatórios respondidos, nenhum passo fica marcado como "falta".
      await expect(page.locator('[data-testid^="ep-pendente-"]')).toHaveCount(0);
      // O ramo escolhido no primeiro passo pré-preenche este: as perguntas de
      // qualificação e as situações de chamar uma pessoa já vêm sugeridas.
      await expect(page.locator("#ep-qualificacao-perguntas")).toHaveValue(/Sobre qual área do direito é o seu assunto/);
      await expect(page.locator("#ep-qualificacao-perguntas")).toHaveValue(/Você já tem advogado cuidando deste assunto\?/);
      await expect(page.locator("#ep-humano-situacoes")).toHaveValue(/A pessoa pede opinião sobre o caso ou orientação jurídica/);
    });

    await test.step("os passos opcionais passam com os padrões, e o último pede o telefone de teste", async () => {
      await page.getByTestId("ep-salvar").click();
      await expect(page.getByTestId("ep-passo-recuperacao")).toBeVisible();
      await page.getByTestId("ep-salvar").click();
      await expect(page.getByTestId("ep-passo-onde")).toBeVisible();
      await page.getByLabel("Telefones de teste").fill("+5511999990000");
      await foto(page, "01-questionario-onde-instalar");
      await page.getByTestId("ep-salvar").click();
    });

    await test.step("a revisão mostra o texto de cada agente, com o que a empresa respondeu", async () => {
      await expect(page.getByTestId("ep-revisao")).toBeVisible();
      for (const papel of ["sdr", "agendamento", "proposta", "recuperador"]) {
        await expect(page.getByTestId(`ep-texto-${papel}`)).toBeVisible();
      }
      await page.getByTestId("ep-texto-sdr").locator("summary").click();
      const texto = page.getByTestId("ep-texto-sdr").locator("pre");
      await expect(texto).toContainText(EMPRESA);
      await expect(texto).toContainText("Bia");
      // O pacote do ramo entra no fim do texto do agente, com as regras duras.
      await expect(texto).toContainText("### Regras do ramo desta empresa");
      await expect(texto).toContainText("Nunca prometa resultado, chance de ganhar nem prazo de decisão de um caso.");
      await expect(texto).toContainText("Sobre qual área do direito é o seu assunto");
      await foto(page, "02-revisao");
    });

    await test.step("instalar: painel em ensaio, checklist e quatro agentes publicados", async () => {
      await page.getByTestId("ep-instalar").click();
      await expect(page.getByTestId("ep-painel")).toBeVisible({ timeout: 90_000 });
      await expect(page.getByTestId("ep-modo")).toHaveAttribute("data-modo", "ensaio");
      await expect(page.getByTestId("ep-checklist").locator('[data-testid^="ep-item-"]').first()).toBeVisible();
      await expect(page.getByTestId("ep-item-whatsapp_conectado")).toHaveAttribute("data-ok", "sim");
      await expect(page.getByTestId("ep-item-credencial_de_ia")).toHaveAttribute("data-ok", "sim");
      await expect(page.getByTestId("ep-item-agentes_publicados")).toHaveAttribute("data-ok", "sim");
      for (const papel of ["sdr", "agendamento", "proposta", "recuperador"]) {
        await expect(page.getByTestId(`ep-agente-${papel}`)).toHaveAttribute("data-situacao", "em_dia");
      }
      await foto(page, "03-painel-em-ensaio");

      const noBanco = await agentesDaEquipe(a.org);
      expect(noBanco).toHaveLength(4);
      expect(noBanco.every((x) => x.published_version_id !== null), "há agente sem versão publicada").toBe(true);
      const perfil = await db.from("equipe_pronta_perfis").select("estado, modo").eq("organization_id", a.org).single();
      expect(perfil.data).toEqual({ estado: "instalado", modo: "ensaio" });
      // O ramo foi gravado, e a equipe do ramo nasce em ENSAIO como qualquer outra.
      const respostas = await db.from("equipe_pronta_perfis").select("respostas").eq("organization_id", a.org).single();
      expect((respostas.data?.respostas as { negocio?: { tipo_de_negocio?: string } }).negocio?.tipo_de_negocio).toBe("advocacia");
      // Ensaio é do canal: só o telefone de teste fala com a IA.
      const acesso = await db.from("channel_sessions").select("metadata").eq("id", canal).single();
      expect(JSON.stringify(acesso.data?.metadata ?? {})).toContain("5511999990000");
    });

    await test.step("instalar de novo não duplica nada", async () => {
      const r = await page.request.post("/api/v1/ai/equipe-pronta/instalar", { data: { forcar: false } });
      expect(r.status(), await r.text()).toBe(200);
      expect(await agentesDaEquipe(a.org)).toHaveLength(4);
    });

    // ── 2. Standard: sem a tela, e a API recusa ─────────────────────────────
    const ctxB = await browser.newContext();
    contextos.push(ctxB);
    const pB = await ctxB.newPage();
    pB.setDefaultTimeout(30_000);
    await test.step("Standard: a tela é a de fora do plano, e diz em que plano a equipe está", async () => {
      await entrar(pB, b.admin.email);
      await pB.goto(TELA);
      await expect(pB.getByTestId("fora-do-plano")).toBeVisible();
      await expect(pB.getByTestId("fora-do-plano-equipe-pronta")).toContainText("Premium");
      await expect(pB.getByTestId("ep-questionario")).toHaveCount(0);
      await foto(pB, "04-standard-fora-do-plano");

      const leu = await pB.request.get("/api/v1/ai/equipe-pronta");
      expect(leu.status()).toBe(403);
      expect(((await leu.json()) as { error: { code: string } }).error.code).toBe(`fora_do_plano:${TELA}`);
      const instalou = await pB.request.post("/api/v1/ai/equipe-pronta/instalar", { data: { forcar: false } });
      expect(instalou.status()).toBe(403);

      await pB.goto("/app/ai/agents");
      await expect(pB.getByRole("heading", { name: "Agentes de IA", level: 1 })).toBeVisible();
      await expect(pB.getByTestId("atalho-equipe-pronta")).toHaveCount(0);
    });

    // ── 3. Rebaixar a Premium: pausa, sem apagar ────────────────────────────
    await test.step("rebaixar para Standard: a tela fecha, os agentes ficam pausados e nada é apagado", async () => {
      const antes = await agentesDaEquipe(a.org);
      const rebaixa = await db.from("cobranca_assinaturas").update({ plano_id: standard }).eq("organization_id", a.org);
      if (rebaixa.error) throw rebaixa.error;

      await page.goto(TELA);
      await expect(page.getByTestId("fora-do-plano")).toBeVisible();
      expect((await page.request.get("/api/v1/ai/equipe-pronta")).status()).toBe(403);
      expect((await page.request.post("/api/v1/ai/equipe-pronta/ativar", { data: {} })).status()).toBe(403);

      await page.goto("/app/ai/agents");
      const aviso = page.getByTestId("equipe-pronta-pausada-pelo-plano");
      await expect(aviso).toBeVisible();
      await expect(aviso).toHaveAttribute("data-agentes", "4");
      await foto(page, "05-rebaixado-agentes-pausados");

      // Nada apagado, nada despublicado: os mesmos agentes, com as mesmas versões.
      expect(await agentesDaEquipe(a.org)).toEqual(antes);
      const perfil = await db.from("equipe_pronta_perfis").select("estado").eq("organization_id", a.org).single();
      expect(perfil.data?.estado).toBe("instalado");
    });

    await test.step("voltar ao Premium reabre a equipe como estava, sem reinstalar", async () => {
      const volta = await db.from("cobranca_assinaturas").update({ plano_id: premium }).eq("organization_id", a.org);
      if (volta.error) throw volta.error;
      await page.goto(TELA);
      await expect(page.getByTestId("ep-painel")).toBeVisible();
      await expect(page.getByTestId("ep-modo")).toHaveAttribute("data-modo", "ensaio");
      await page.goto("/app/ai/agents");
      await expect(page.getByTestId("equipe-pronta-pausada-pelo-plano")).toHaveCount(0);
    });
  } finally {
    const erros: unknown[] = [];
    const tentar = async (f: () => Promise<unknown>) => {
      try {
        await f();
      } catch (e) {
        erros.push(e);
      }
    };
    await tentar(() => restaurarChaves(chaves));
    await tentar(() => Promise.all(contextos.map((c) => c.close())));
    for (const org of orgs) {
      await tentar(async () => {
        const r = await db.from("organizations").delete().eq("id", org);
        if (r.error) throw r.error;
      });
    }
    for (const plano of planos) {
      await tentar(async () => {
        const r = await db.from("cobranca_planos").delete().eq("id", plano);
        if (r.error) throw r.error;
      });
    }
    for (const pessoa of pessoas) {
      await tentar(async () => {
        const r = await db.auth.admin.deleteUser(pessoa);
        if (r.error) throw r.error;
      });
    }
    if (erros.length > 0) throw new AggregateError(erros, "a limpeza da spec da equipe pronta falhou");
  }
});
