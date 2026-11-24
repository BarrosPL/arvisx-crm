import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { test, expect } from "./helpers/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

/**
 * VOLTAR DA AUTORIZAÇÃO DE REDE SOCIAL NÃO DESLOGA — e diz o desfecho (#1579).
 *
 * Mesmo mecanismo de `agenda-google-volta-nao-desloga.spec.ts`: o provedor
 * devolve o navegador numa navegação iniciada FORA do nosso site, e o cookie
 * de sessão `SameSite=Strict` não viaja nela. Se o destino for uma página
 * autenticada, o `proxy.ts` não vê usuário e manda para `/login`.
 *
 * A ponte `/auth/social-return` é pública e inerte: responde 200 e refaz a
 * navegação a partir do nosso próprio origin, e aí o cookie viaja. A spec segue
 * o DESFECHO — onde a pessoa parou e o que a tela disse —, não o header.
 *
 * ## As duas pontes, e o que cada uma mostra hoje
 *
 * `/auth/social-return` é a volta da conexão POR PARCEIRO. Desde b22b7a0f2
 * (decisão do dono, 12/11/2026) esse bloco fica escondido na aba "Facebook /
 * Instagram", e o aviso "Autorização concluída" mora dentro dele: a tela real
 * não o mostra mais. A ponte continua pública e respondendo (autorizações
 * antigas e a recuperação do `proxy.ts` ainda caem nela), então o que se mede
 * dela é o que ela ainda faz: devolve a pessoa LOGADA à aba certa, sem refletir
 * o `connect_token`. O aviso em si é medido com o bloco montado à vista em
 * `components/connections/RedesSociaisClient.test.tsx`.
 *
 * `/auth/meta-social-return` é a volta da conexão DIRETA pela Meta, a única
 * porta que o cliente vê. É nela que "mostra o desfecho" é medido: o cartão da
 * conexão direta conclui a volta com a sessão, limpa a URL e diz o que
 * aconteceu. O estado usado aqui tem o formato certo e assinatura de ninguém:
 * a tela tem de RECUSAR em palavras, nunca ficar muda.
 *
 * O site "de fora" sobe em `127.0.0.1` enquanto o app roda em `localhost`: para
 * o navegador são sites diferentes (porta não conta para SameSite; host conta).
 * Porta 0: o sistema escolhe uma livre, sem colidir com outra spec.
 */
function subirSiteDeFora(destino: string): Promise<http.Server> {
  return new Promise((resolve) => {
    const servidor = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><body>
        <a id="voltar" href="${destino}">voltar</a>
        <script>document.getElementById("voltar").click()</script>
      </body>`);
    });
    servidor.listen(0, "127.0.0.1", () => resolve(servidor));
  });
}

test("voltar da autorização de rede social não manda para o /login e mostra o desfecho", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await loginComoAdmin(page, lerCreds());

  // Controle positivo: logado ANTES do salto. Sem ele, um /login no fim poderia
  // significar "nunca esteve logado" em vez de "perdeu no salto".
  await page.goto("/app/connections?aba=sociais");
  await expect(page, "não cheguei logado em Conexões — o cenário não está montado").toHaveURL(
    /\/app\/connections/,
    { timeout: 20_000 },
  );

  const base = (baseURL ?? "http://localhost:3001").replace(/\/$/, "");
  const destino = `${base}/auth/social-return?connected=facebook&connect_token=SEGREDO`;
  const servidor = await subirSiteDeFora(destino);
  const porta = (servidor.address() as AddressInfo).port;

  try {
    await page.goto(`http://127.0.0.1:${porta}/`);
    await page.waitForURL(/\/(app\/connections|login)/, { timeout: 30_000 });

    const url = page.url();
    expect(
      url,
      `depois de voltar de um site externo, a pessoa parou em ${url}. Ela ESTAVA logada ` +
        "(o controle acima provou): o cookie SameSite=Strict não viajou no salto iniciado de fora.",
    ).not.toContain("/login");
    expect(url).toContain("/app/connections");
    expect(url).toContain("aba=sociais");
    expect(url, "a ponte refletiu o connect_token na URL").not.toContain("SEGREDO");

    // A aba que abriu é a das redes sociais, com a porta que o cliente vê.
    await expect(page.getByRole("heading", { name: "Facebook / Instagram", exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("conexao-direta-meta")).toBeVisible();
  } finally {
    await new Promise<void>((r) => servidor.close(() => r()));
  }

  // ── A volta da conexão DIRETA (Meta): a que o cliente percorre hoje ───────
  // O "Cancelar" da Meta devolve `error=access_denied` com o `state` da ida.
  const estado = `${"A".repeat(40)}.${"0".repeat(64)}`;
  const direta = await subirSiteDeFora(
    `${base}/auth/meta-social-return?state=${estado}&error=access_denied`,
  );
  const portaDaDireta = (direta.address() as AddressInfo).port;

  try {
    await page.goto(`http://127.0.0.1:${portaDaDireta}/`);
    await page.waitForURL(/\/(app\/connections|login)/, { timeout: 30_000 });
    expect(
      page.url(),
      `depois de voltar da Meta, a pessoa parou em ${page.url()}. Ela ESTAVA logada: ` +
        "o cookie SameSite=Strict não viajou no salto iniciado de fora.",
    ).not.toContain("/login");

    // O desfecho, dito pelo cartão da conexão direta. As duas frases são as
    // recusas que esta volta pode receber, conforme a instalação: sem o app da
    // Meta cadastrado (o estado do e2e) a rota recusa antes de olhar o estado;
    // com ele, recusa o estado que não é desta sessão.
    const desfecho = page.getByTestId("conexao-direta-meta").getByRole("alert");
    await expect(desfecho).toBeVisible({ timeout: 30_000 });
    await expect(desfecho).toHaveText(
      /^(O app da Meta desta instalação ainda não está configurado\. Quem administra a instalação precisa cadastrar o App ID e a chave secreta em Administração › API Oficial da Meta\.|A autorização expirou ou não é desta conta\. Clique em Conectar de novo\.)$/,
    );
    // A tela conclui UMA vez e limpa a barra: o estado não fica para um F5.
    await expect(page).toHaveURL(/\/app\/connections\?aba=sociais$/);
    expect(page.url()).not.toContain(estado);
  } finally {
    await new Promise<void>((r) => direta.close(() => r()));
  }
});
