// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { cabecalhosQueOProxyEntrega } from "./helpers/cabecalhos-do-proxy";

/**
 * O `proxy.ts` entrega aos Server Components o caminho atual em `x-pathname` —
 * é dele que `exigirProvaDeMfa` monta o `next` do desafio. O Next só repassa os
 * cabeçalhos que existiam quando `NextResponse.next({ request })` foi criado, e
 * eles saem na resposta como `x-middleware-request-*` (listados em
 * `x-middleware-override-headers`); o resto é apagado antes de chegar à página.
 * Por isso o `NextResponse` aqui é o REAL: gravar o cabeçalho depois do `next`
 * produz um proxy que "grava" e uma página que nunca recebe.
 */
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } }, error: null }) },
  }),
}));

describe("proxy: x-pathname chega aos Server Components", () => {
  it("rota autenticada: o caminho atual é encaminhado", async () => {
    const h = await cabecalhosQueOProxyEntrega("https://crm.exemplo/app/contacts?aba=2");
    expect(h.get("x-pathname")).toBe("/app/contacts");
  });

  it("rota pública: também", async () => {
    const h = await cabecalhosQueOProxyEntrega("https://crm.exemplo/login");
    expect(h.get("x-pathname")).toBe("/login");
  });

  it("o valor mandado pelo navegador não vale: o proxy sobrescreve", async () => {
    const h = await cabecalhosQueOProxyEntrega("https://crm.exemplo/app/inbox", {
      "x-pathname": "/outro-lugar",
    });
    expect(h.get("x-pathname")).toBe("/app/inbox");
  });
});

/**
 * A trava das telas do plano separa leitura de escrita pelo `x-metodo`
 * (lib/cobranca/trava-do-plano.ts, auditoria de 11/11/2026): a leitura mínima
 * que Funis, Conexões e Equipe usam é livre, criar/editar/apagar não. O método
 * tem de vir do proxy — se valesse o que o navegador manda, um POST se
 * declararia GET e passaria pela leitura aberta.
 */
describe("proxy: x-metodo chega às rotas de API", () => {
  it.each(["GET", "POST", "PATCH", "DELETE"])("%s: o método da requisição é encaminhado", async (metodo) => {
    const h = await cabecalhosQueOProxyEntrega("https://crm.exemplo/api/v1/ai/agents/assignable", undefined, metodo);
    expect(h.get("x-metodo")).toBe(metodo);
    expect(h.get("x-pathname")).toBe("/api/v1/ai/agents/assignable");
  });

  it("⭐ o valor mandado pelo navegador não vale: um POST não se declara GET", async () => {
    const h = await cabecalhosQueOProxyEntrega(
      "https://crm.exemplo/api/v1/ai/agents/assignable",
      { "x-metodo": "GET" },
      "POST",
    );
    expect(h.get("x-metodo")).toBe("POST");
  });
});
