/**
 * O FORMULÁRIO DE MODELO CABE NA TELA EM 375px — medido, não fotografado.
 *
 * ## O defeito que esta spec prende
 *
 * No celular (375px), abrir "Criar modelo" em Conexões fazia o `<main>` rolar de
 * lado e cortava os campos na direita (#3702). O `<main>` da casca tem
 * `overflow-auto`: o que passa da largura rola DENTRO dele, então o `body`
 * continua exatamente da largura da janela, e a régua do `body` sozinha não vê
 * nada. É por isso que a conta abaixo é o MAIOR entre as duas:
 * `body - janela` e `main.scrollWidth - main.clientWidth`.
 *
 * Também não vale medir `documentElement.scrollWidth`: `app/globals.css` põe
 * `overflow-x: hidden`/`clip` em `html` e `body`, e sob `hidden` o `scrollWidth`
 * do documentElement é grampeado no `clientWidth` — a conta daria ZERO com um
 * filho de 3000px (ver `celular-cabe-na-tela.spec.ts`).
 *
 * ## Por que a causa era o grid, e não "o texto é grande"
 *
 * O formulário nasce como `grid ... lg:grid-cols-[1fr_20rem]`. Abaixo de `lg` o
 * grid fica com UMA coluna implícita `auto`, que não encolhe abaixo do
 * `min-content` dos filhos; e os campos da coluna da esquerda eram `flex-1` com
 * `min-width: auto` (o `size` padrão de um `<input>`) ou largura fixa (`w-56` no
 * idioma). Somados, o `min-content` do formulário passava da largura útil — 343
 * px numa janela de 375 px, com o `p-4` da casca — e o `<main>` passava a rolar.
 *
 * ## Por onde o cliente chega ao formulário hoje
 *
 * O formulário é UM (`FormularioDaDefinicao`, `data-formulario-do-modelo`), e já
 * teve duas portas em Conexões: a aba do provedor parceiro
 * (`TemplatesParceiroClient`) e a do canal oficial (`TemplatesClient`). A aba do
 * parceiro saiu da tela em b22b7a0f2 (decisão do dono, 12/11/2026): `?aba=parceiro`
 * cai na aba padrão, e nenhum clique leva àquele formulário. A porta que o
 * cliente tem é **API Oficial (Meta) › Templates da Meta**, e é ela que esta spec
 * percorre em 375x812 com o formulário ABERTO — criar e editar.
 *
 * (O mesmo componente do parceiro ainda monta na aba opcional do canal parceiro
 * Graph, que nasce desligada na instalação; a largura dele sozinho é medida em
 * `components/connections/TemplatesParceiroClient.layout.test.tsx`.)
 *
 * ## A conexão oficial é semeada, e por quê
 *
 * Sem número oficial conectado a aba mostra "Canal oficial não conectado" e não
 * existe formulário para medir. Enquanto a aba do parceiro existia, era ela que
 * garantia a medida no CI, e a do canal oficial se declarava pulada. Com uma
 * porta só, pular seria a spec inteira ficar sem medir nada. Então o estado é
 * montado pelo banco, como em `aviso-pelo-numero-oficial.spec.ts`: uma sessão
 * oficial com conta (WABA) e um modelo espelhado de nome comprido, que é o que
 * mais empurra a largura no formulário de editar. A tela só LÊ esse estado
 * (`GET /api/v1/channels/templates` não fala com a Meta), e tudo morre no
 * `afterAll`.
 *
 * Cada caso imprime a medida, para que um vermelho diga QUANTO passou em vez de
 * só "não cabe".
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { carregarEnvLocal } from "../../scripts/lib/env-de-teste";
import { test, expect, type Page } from "./helpers/test";

import { lerCreds, loginComoAdmin, type CredsE2E } from "./helpers/login-admin";

type Creds = CredsE2E & { org_id: string };

const SUFIXO = String(Date.now()).slice(-6);
const SESSAO = randomUUID();
const MODELO = randomUUID();
const CONTA = `e2e-conta-375-${SUFIXO}`;
/** Comprido de propósito: é o nome que aparece na linha "Editando <nome>". */
const NOME_DO_MODELO = `modelo_e2e_375_com_nome_bem_comprido_para_empurrar_a_largura_${SUFIXO}`;

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Um login só para todos os casos: dois logins caem na mesma janela TOTP quase
 * sempre, e a espera pela próxima janela comeria o orçamento (ver
 * `tests/unit/e2e-dois-logins-nao-cabem-no-teto-padrao.test.ts`).
 */
test.describe.configure({ timeout: 180_000 });

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

/**
 * Quanto a tela passa da própria largura, em px: o maior entre os dois lados da
 * casca. O `body` pega o que escapa dela; o `<main>` pega o conteúdo, que é onde
 * este formulário estoura.
 */
async function transbordo(page: Page): Promise<{ px: number; detalhe: string }> {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    const form = document.querySelector<HTMLElement>("[data-formulario-do-modelo]");
    const janela = document.documentElement.clientWidth;
    const doBody = document.body.scrollWidth - janela;
    const doMain = main ? main.scrollWidth - main.clientWidth : 0;
    return {
      px: Math.max(doBody, doMain),
      detalhe:
        `janela=${janela} body=${document.body.scrollWidth} ` +
        `main=${main?.scrollWidth ?? "?"}/${main?.clientWidth ?? "?"} ` +
        `form=${form ? `${form.scrollWidth}/${form.clientWidth}` : "ausente"}`,
    };
  });
}

/**
 * Mede depois que a largura PARA de mudar. Aberto há pouco, o painel ainda está
 * animando, e medir no meio disso dá "falso vermelho hoje, falso verde amanhã".
 */
async function medirEstavel(page: Page) {
  let anterior = Number.NaN;
  for (let i = 0; i < 20; i++) {
    const medida = await transbordo(page);
    if (medida.px === anterior) return medida;
    anterior = medida.px;
    await page.waitForTimeout(150);
  }
  return transbordo(page);
}

/**
 * Abre API Oficial (Meta) › Templates da Meta, pela URL que as abas escrevem.
 *
 * Com a conexão semeada, "Canal oficial não conectado" não é estado aceitável:
 * é o seed que não pegou (ou a tela que deixou de ler a sessão), e o caso
 * reprova dizendo isso em vez de medir uma tela sem formulário.
 */
async function abrirModelosDoCanalOficial(page: Page): Promise<void> {
  await page.goto("/app/connections?aba=oficial&sub=templates", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("tab", { name: "Templates da Meta", exact: true })
    .waitFor({ state: "visible", timeout: 60_000 });
  await expect(
    page.getByTestId("templates-root"),
    'a aba de modelos do canal oficial não montou com a conexão semeada (diz "Canal oficial não conectado"?)',
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Canal oficial não conectado/)).toHaveCount(0);
}

test.describe("o formulário de modelo em 375px", () => {
  const creds = lerCreds() as Creds;

  test.beforeAll(async () => {
    const sessao = await admin.from("channel_sessions").insert({
      id: SESSAO,
      organization_id: creds.org_id,
      provider: "meta_cloud",
      meta_phone_number_id: `e2e-375-${SUFIXO}`,
      meta_waba_id: CONTA,
      display_name: `Número oficial 375 E2E ${SUFIXO}`,
      webhook_secret_encrypted: "\\x00",
      status: "WORKING",
    });
    if (sessao.error) throw sessao.error;
    // A tela lê a sessão oficial MAIS ANTIGA da organização (`metaSessionForOrg`).
    // Se outra spec deixou uma para trás, a conta em vigor é a dela, e o modelo
    // semeado tem de nascer nessa conta para a tela oferecer "Editar".
    const emVigor = await admin
      .from("channel_sessions")
      .select("meta_waba_id")
      .eq("organization_id", creds.org_id)
      .eq("provider", "meta_cloud")
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();
    if (emVigor.error) throw emVigor.error;
    const conta = (emVigor.data as { meta_waba_id: string | null }).meta_waba_id;
    if (!conta) throw new Error("a sessão oficial em vigor não tem conta (WABA): a aba diria 'não conectado'");
    const modelo = await admin.from("meta_templates").insert({
      id: MODELO,
      organization_id: creds.org_id,
      // Sem sessão e com a conta em vigor: é a régua de "modelo DESTA conexão"
      // (`daConexao`), a única que ganha o botão Editar na aba do canal oficial.
      channel_session_id: null,
      waba_id: conta,
      name: NOME_DO_MODELO,
      language: "pt_BR",
      status: "APPROVED",
      category: "UTILITY",
      components: [
        { type: "BODY", text: "Olá! Seu pedido saiu para entrega e chega ainda hoje. Qualquer dúvida, é só responder esta mensagem." },
      ],
      contract_hash: "",
    });
    if (modelo.error) throw modelo.error;
  });

  test.afterAll(async () => {
    await admin.from("meta_templates").delete().eq("id", MODELO);
    await admin.from("channel_sessions").delete().eq("id", SESSAO);
  });

  test("o formulário de modelo não estoura a tela em 375px, ao criar e ao editar", async ({ page }) => {
    await loginComoAdmin(page, creds);
    await abrirModelosDoCanalOficial(page);

    // ── Criar ──────────────────────────────────────────────────────────────
    await page.getByRole("button", { name: /^Criar modelo$/ }).click();
    // A espera é o FORMULÁRIO, não o botão: sem esta linha, um formulário que não
    // abre deixa o caso medindo a lista e chamando isso de verde.
    await expect(
      page.locator('[data-formulario-do-modelo="criar"]'),
      'a aba tem "Criar modelo" e o clique não abriu o formulário',
    ).toBeVisible();

    const { px, detalhe } = await medirEstavel(page);
    test.info().annotations.push({
      type: "medida",
      description: `canal oficial (criar): ${detalhe} → ${px}px`,
    });
    expect(
      px,
      `a aba do canal oficial passa da tela em 375px com o formulário aberto — ${detalhe}`,
    ).toBeLessThanOrEqual(1);

    const doFormulario = await page.evaluate(() => {
      const form = document.querySelector<HTMLElement>("[data-formulario-do-modelo]")!;
      return { scroll: form.scrollWidth, client: form.clientWidth };
    });
    expect(
      doFormulario.scroll,
      `o formulário da aba do canal oficial passa da própria caixa: ${doFormulario.scroll}/${doFormulario.client}`,
    ).toBeLessThanOrEqual(doFormulario.client + 1);

    // ── Editar ─────────────────────────────────────────────────────────────
    // O formulário de EDITAR tem um campo a mais (a linha "Editando <nome>") e
    // nasce preenchido com o texto aprovado — com nome longo, que é o caso que
    // mais empurra a largura. O modelo é o semeado: sem ele não há o que editar.
    const cartao = page.getByTestId("template-card").filter({ hasText: NOME_DO_MODELO });
    await expect(cartao, "o modelo semeado não apareceu na lista do canal oficial").toHaveCount(1);
    await cartao.getByRole("button", { name: /^Editar$/ }).click();
    const editar = page.locator('[data-formulario-do-modelo="editar"]');
    await expect(editar).toBeVisible();
    await expect(editar).toContainText(NOME_DO_MODELO);

    const doEditar = await medirEstavel(page);
    test.info().annotations.push({
      type: "medida",
      description: `editar: ${doEditar.detalhe} → ${doEditar.px}px`,
    });
    expect(
      doEditar.px,
      `o formulário de editar passa da tela — ${doEditar.detalhe}`,
    ).toBeLessThanOrEqual(1);

    const daCaixaDoEditar = await page.evaluate(() => {
      const form = document.querySelector<HTMLElement>('[data-formulario-do-modelo="editar"]')!;
      return { scroll: form.scrollWidth, client: form.clientWidth };
    });
    expect(
      daCaixaDoEditar.scroll,
      `o formulário de editar passa da própria caixa: ${daCaixaDoEditar.scroll}/${daCaixaDoEditar.client}`,
    ).toBeLessThanOrEqual(daCaixaDoEditar.client + 1);
  });
});
