/**
 * COMENTÁRIOS DO INSTAGRAM — PROVA PELA TELA, COM A GRAPH SIMULADA.
 *
 * Os testes de unidade provam a regra (`lib/channels/meta-social/comentarios-acoes.test.ts`)
 * e o que cada componente desenha. Isto prova o caminho de quem usa: o
 * administrador vê o estado dos comentários no cartão do Instagram em Conexões,
 * e a equipe lê e responde na tela de Comentários — `next start` real contra o
 * Postgres real.
 *
 * ─── Onde está a "Graph simulada" ───────────────────────────────────────────
 *
 * Nenhum caso desta spec fala com a Meta de verdade. São duas simulações:
 *
 *   1. MODO DE REGISTRO (casos 1 e 2). A conexão em `registrar` confere tudo e
 *      grava a resposta como simulada SEM chamar a Graph — é a simulação que o
 *      próprio produto oferece, e é a que a tela precisa mostrar com clareza.
 *   2. GRAPH QUE NÃO RESPONDE (caso 3). Na parte do CI em que esta spec roda, o
 *      host da Graph do canal (`META_GRAPH_BASE_URL`) aponta para uma porta
 *      local que recusa a conexão (passo "Isolar Graph e assinatura WAHA da
 *      parte causal" de `.github/workflows/e2e.yml`). Em modo real, a chamada
 *      sai, não tem resposta, e o comentário fica com a resposta INCERTA — o
 *      estado em que a tela não pode repetir sozinha. O caso RECUSA rodar se o
 *      host não for esse: sem a guarda, o modo real falaria com a Meta.
 *
 * O que esta spec NÃO prova: a resposta aceita pela Meta (200 com id). O host
 * da Graph é variável do processo do servidor, decidida pelo workflow, e não
 * há dublê HTTP da Graph do canal nesta parte; esse desfecho é medido com
 * espião em `lib/channels/meta-social/comentarios-resposta.test.ts`.
 *
 * A conexão e os comentários são semeados direto no banco (o login da Meta não
 * existe num ambiente de teste) e apagados no fim.
 *
 * Pré-requisito: `.e2e-creds.json` (gerado por scripts/seed-e2e-credentials.ts).
 */
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { CHANNEL_PROVIDER_SOCIAL_DIRETO } from "@/lib/channels/capabilities";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

import { credenciaisSupabaseDeTeste, destinoEhLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin } from "./helpers/login-admin";
import { expect, test, type Page } from "./helpers/test";

/** A porta que recusa: o host da Graph do canal na parte do CI em que esta spec roda. */
const GRAPH_QUE_RECUSA = "http://127.0.0.1:9";

const { url, serviceRole } = credenciaisSupabaseDeTeste();
if (!destinoEhLocal(url)) throw new Error("E2E de comentários recusado: Supabase não é local");
const db = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });

let creds = lerCreds();
const ORG = (creds as unknown as { org_id?: string }).org_id;
if (!ORG) throw new Error("E2E de comentários: .e2e-creds.json sem org_id (rode o seed de credenciais)");

const EVIDENCE = path.join(process.cwd(), "evidence", "comentarios-do-instagram");
mkdirSync(EVIDENCE, { recursive: true });

/** Únicos por execução: reruns num banco compartilhado não colidem. */
const SUFIXO = Date.now().toString(36);
const numerico = () => `17${randomInt(10 ** 12, 10 ** 13)}`;
const CONTA = numerico();
const NOME = `instagram · @e2e-comentarios-${SUFIXO}`;
const TEXTO_1 = `Quanto custa? (${SUFIXO}-1)`;
const TEXTO_2 = `Amei! (${SUFIXO}-2)`;
const TEXTO_3 = `Tem na cor azul? (${SUFIXO}-3)`;
const ESCOPOS = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
  "instagram_basic",
  "instagram_manage_messages",
  "instagram_manage_comments",
  "pages_read_engagement",
];

let canal = "";
const comentarios: Record<string, string> = {};

async function definirCanal(metadata: Record<string, unknown>): Promise<void> {
  const { error } = await db.from("channel_sessions").update({ metadata }).eq("organization_id", ORG).eq("id", canal);
  if (error) throw new Error(`channel_sessions: ${error.message}`);
}
const metadataDoCanal = (modo: string, escopos: string[] = ESCOPOS) => ({
  social_platform: "instagram",
  meta_page_name: "Página E2E",
  comentarios_modo: modo,
  meta_escopos_concedidos: escopos,
});

async function linha(id: string) {
  const { data, error } = await db
    .from("social_comments")
    .select("estado, public_reply, private_reply, hidden, ignore_reason")
    .eq("organization_id", ORG)
    .eq("id", id)
    .single();
  if (error) throw new Error(`social_comments: ${error.message}`);
  return data as {
    estado: string;
    public_reply: { simulada: boolean; situacao: string; texto: string } | null;
    private_reply: { simulada: boolean; situacao: string } | null;
    hidden: { simulada: boolean } | null;
    ignore_reason: string | null;
  };
}

async function loginAdmin(page: Page): Promise<void> {
  creds = await loginComoAdmin(page, creds);
}

const cartao = (page: Page, texto: string) => page.getByTestId("comentario").filter({ hasText: texto });

// Cada caso faz login; o helper espera a janela do TOTP virar quando o código
// já foi usado, e essa espera sozinha come o teto padrão de 30 s.
test.describe.configure({ mode: "serial", timeout: 120_000 });

test.describe("comentários do Instagram", () => {
  test.beforeAll(async () => {
    const segredo = await encryptWebhookSecret(db, randomBytes(32).toString("hex"));
    const token = await encryptWebhookSecret(db, `token-sintetico-${randomUUID()}`);
    if (!segredo || !token) throw new Error("E2E de comentários: a cifra do banco local não respondeu");
    const { data, error } = await db
      .from("channel_sessions")
      .insert({
        organization_id: ORG,
        provider: CHANNEL_PROVIDER_SOCIAL_DIRETO,
        meta_social_account_id: CONTA,
        meta_social_page_id: numerico(),
        // Sintético: só existe para o modo real TENTAR a chamada (caso 3), que
        // vai para a porta que recusa. Não é credencial de conta nenhuma.
        meta_social_token_encrypted: token,
        webhook_path_token: randomBytes(24).toString("hex"),
        webhook_secret_encrypted: segredo,
        display_name: NOME,
        status: "WORKING",
        metadata: metadataDoCanal("registrar"),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`channel_sessions: ${error?.message ?? "a linha não voltou"}`);
    canal = (data as { id: string }).id;

    const agora = Date.now();
    const linhas = [TEXTO_1, TEXTO_2, TEXTO_3].map((text, i) => ({
      organization_id: ORG,
      channel_session_id: canal,
      comment_id: numerico(),
      media_id: numerico(),
      media_product_type: "REELS",
      author_id: numerico(),
      author_username: `cliente.e2e.${SUFIXO}.${i + 1}`,
      text,
      // Recentes: dentro dos 7 dias da resposta privada.
      commented_at: new Date(agora - (i + 1) * 60_000).toISOString(),
    }));
    const gravadas = await db.from("social_comments").insert(linhas).select("id, text");
    if (gravadas.error) throw new Error(`social_comments: ${gravadas.error.message}`);
    for (const l of (gravadas.data ?? []) as { id: string; text: string }[]) comentarios[l.text] = l.id;
  });

  test.afterAll(async () => {
    if (!canal) return;
    await db.from("social_comments").delete().eq("organization_id", ORG).eq("channel_session_id", canal);
    await db.from("channel_sessions").delete().eq("organization_id", ORG).eq("id", canal);
  });

  test("modo de registro: responder em público e em privado, ocultar e ignorar ficam como simulados", async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`/app/inbox/comentarios?canal=${canal}`);
    await expect(page.getByRole("heading", { level: 1, name: "Comentários" })).toBeVisible();

    const primeiro = cartao(page, TEXTO_1);
    await expect(primeiro).toBeVisible();
    await expect(primeiro.getByTestId("estado-do-comentario")).toHaveText("Novo");
    await expect(primeiro).toContainText(NOME);

    // Resposta pública: a tela diz que foi simulada, e o banco concorda.
    await primeiro.getByTestId("responder-em-publico").click();
    await page.getByLabel("Sua resposta").fill("Te respondo no privado!");
    await page.getByTestId("enviar-resposta").click();
    await expect(primeiro.getByTestId("selo-simulada")).toBeVisible();
    await expect(primeiro).toContainText("nada foi publicado");
    await expect(primeiro.getByTestId("estado-do-comentario")).toHaveText("Respondido");
    await expect
      .poll(async () => (await linha(comentarios[TEXTO_1]!)).public_reply)
      .toMatchObject({ simulada: true, situacao: "concluida", texto: "Te respondo no privado!" });

    // Resposta privada, no mesmo comentário: também simulada.
    await primeiro.getByTestId("responder-em-privado").click();
    await page.getByLabel("Sua resposta").fill("Oi! O valor é sob consulta.");
    await page.getByTestId("enviar-resposta").click();
    await expect(primeiro.getByTestId("selo-simulada")).toHaveCount(2);
    await expect
      .poll(async () => (await linha(comentarios[TEXTO_1]!)).private_reply)
      .toMatchObject({ simulada: true, situacao: "concluida" });
    // Uma resposta de cada tipo: a tela não oferece a segunda.
    await expect(primeiro.getByTestId("responder-em-publico")).toBeDisabled();
    await expect(primeiro.getByTestId("responder-em-privado")).toBeDisabled();

    // Ocultar, com confirmação: anotado como simulado.
    await primeiro.getByTestId("ocultar-comentario").click();
    await page.getByTestId("confirmar-ocultar").click();
    await expect(primeiro).toContainText("Oculto (simulado)");
    await expect.poll(async () => (await linha(comentarios[TEXTO_1]!)).hidden).toMatchObject({ simulada: true });

    // Ignorar o segundo, com o motivo.
    const segundo = cartao(page, TEXTO_2);
    await segundo.getByTestId("ignorar-comentario").click();
    await page.getByLabel("Motivo (opcional)").fill("elogio");
    await page.getByTestId("confirmar-ignorar").click();
    await expect(segundo.getByTestId("estado-do-comentario")).toHaveText("Sem ação");
    await expect
      .poll(async () => linha(comentarios[TEXTO_2]!))
      .toMatchObject({ estado: "sem_acao", ignore_reason: "elogio" });

    await page.screenshot({ path: path.join(EVIDENCE, "01-tela-em-modo-de-registro.png"), fullPage: true });
  });

  test("Conexões: o cartão do Instagram mostra o estado, avisa da permissão que falta e muda o modo", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/app/connections?aba=sociais");
    const conexao = page.getByTestId("conexao-direta").filter({ hasText: NOME });
    await expect(conexao.getByTestId("estado-dos-comentarios")).toHaveText("Registrando");
    await expect(conexao.getByTestId("falta-permissao-de-comentarios")).toHaveCount(0);
    await expect(conexao.getByTestId("reautorizar-para-comentarios")).toHaveCount(0);

    // Sem a permissão de comentários: o aviso e o botão de reautorizar aparecem.
    await definirCanal(metadataDoCanal("registrar", ESCOPOS.filter((e) => e !== "instagram_manage_comments")));
    await page.reload();
    await expect(conexao.getByTestId("falta-permissao-de-comentarios")).toBeVisible();
    await expect(conexao.getByTestId("reautorizar-para-comentarios")).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE, "02-cartao-sem-permissao.png"), fullPage: true });
    await definirCanal(metadataDoCanal("registrar"));
    await page.reload();

    // Desligar pela tela grava o modo na conexão.
    await conexao.getByTestId("modo-dos-comentarios").selectOption("off");
    await expect(conexao.getByTestId("estado-dos-comentarios")).toHaveText("Desligado");
    await expect
      .poll(async () => {
        const { data } = await db.from("channel_sessions").select("metadata").eq("id", canal).single();
        return (data as { metadata: Record<string, unknown> } | null)?.metadata.comentarios_modo;
      })
      .toBe("off");

    // Com os comentários desligados, a tela mostra a recusa do servidor.
    await conexao.getByRole("link", { name: "Ver comentários" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/inbox/comentarios\\?canal=${canal}`));
    const terceiro = cartao(page, TEXTO_3);
    await terceiro.getByTestId("responder-em-publico").click();
    await page.getByLabel("Sua resposta").fill("Temos sim!");
    await page.getByTestId("enviar-resposta").click();
    await expect(page.getByRole("alert")).toContainText("estão desligados");
    expect((await linha(comentarios[TEXTO_3]!)).public_reply).toBeNull();
  });

  test("modo real com a Graph que não responde: a resposta fica incerta e a tela não repete sozinha", async ({ page }) => {
    // A guarda: fora da parte isolada, o modo real falaria com a Meta de verdade.
    expect(
      process.env.META_GRAPH_BASE_URL,
      "este caso só roda com a Graph do canal apontada para a porta local que recusa",
    ).toBe(GRAPH_QUE_RECUSA);
    await definirCanal(metadataDoCanal("real"));

    await loginAdmin(page);
    await page.goto(`/app/inbox/comentarios?canal=${canal}`);
    const terceiro = cartao(page, TEXTO_3);
    await terceiro.getByTestId("responder-em-publico").click();
    await page.getByLabel("Sua resposta").fill("Temos sim!");
    await page.getByTestId("enviar-resposta").click();

    // A Graph não respondeu: o servidor diz que não sabe se saiu.
    await expect(page.getByRole("alert")).toContainText("não confirmou");
    await expect.poll(async () => (await linha(comentarios[TEXTO_3]!)).public_reply).toMatchObject({
      simulada: false,
      situacao: "incerta",
      texto: "Temos sim!",
    });
    // E o comentário NÃO fica como respondido.
    expect((await linha(comentarios[TEXTO_3]!)).estado).toBe("novo");

    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(terceiro.getByTestId("selo-incerta")).toBeVisible();
    await expect(terceiro).toContainText("pode ter sido publicada ou não");
    // O botão comum fica desligado; o único caminho é o reenvio confirmado.
    await expect(terceiro.getByTestId("responder-em-publico")).toBeDisabled();
    await expect(terceiro.getByTestId("reenviar-incerta")).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE, "03-resposta-incerta.png"), fullPage: true });

    // Volta ao modo de registro e reenvia com confirmação: agora fica simulada.
    await definirCanal(metadataDoCanal("registrar"));
    await terceiro.getByTestId("reenviar-incerta").click();
    await expect(page.getByLabel("Sua resposta")).toHaveValue("Temos sim!");
    await page.getByTestId("enviar-resposta").click();
    await expect(terceiro.getByTestId("selo-simulada")).toBeVisible();
    await expect.poll(async () => (await linha(comentarios[TEXTO_3]!)).public_reply).toMatchObject({
      simulada: true,
      situacao: "concluida",
    });
  });
});
