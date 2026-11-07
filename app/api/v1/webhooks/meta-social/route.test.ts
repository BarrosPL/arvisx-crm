/**
 * O webhook da conexão direta: nada é lido antes da assinatura `X-Hub-Signature-256`
 * conferir com o App Secret da instalação, e o handshake só responde ao verify
 * token certo.
 */
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  app: { appId: "555", appSecret: "0123456789abcdef0123456789abcdef", verifyToken: "token-de-verificacao-forte" } as {
    appId: string | null;
    appSecret: string | null;
    verifyToken: string | null;
  },
  processar: vi.fn(),
}));

vi.mock("@/lib/channels/meta-social/app", () => ({ appDaConexaoDireta: async () => h.app }));
vi.mock("@/lib/channels/meta-social/ingest", () => ({ processarEventosDiretos: h.processar }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { GET, POST } from "./route";

const CORPO = JSON.stringify({
  object: "page",
  entry: [{ id: "111", messaging: [{ sender: { id: "999" }, recipient: { id: "111" }, message: { mid: "m_1", text: "Oi" } }] }],
});

function assinar(corpo: string, segredo: string) {
  return `sha256=${createHmac("sha256", segredo).update(corpo).digest("hex")}`;
}

function post(corpo: string, assinatura: string | null) {
  return POST(
    new NextRequest("https://crm.test/api/v1/webhooks/meta-social", {
      method: "POST",
      body: corpo,
      headers: assinatura ? { "x-hub-signature-256": assinatura } : {},
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.app = { appId: "555", appSecret: "0123456789abcdef0123456789abcdef", verifyToken: "token-de-verificacao-forte" };
  h.processar.mockResolvedValue(["ingested"]);
});

describe("POST /api/v1/webhooks/meta-social", () => {
  it("assinatura certa: processa e responde 200 com o desfecho", async () => {
    const r = await post(CORPO, assinar(CORPO, h.app.appSecret!));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ received: 1, outcomes: ["ingested"] });
    expect(h.processar).toHaveBeenCalledOnce();
    expect(h.processar.mock.calls[0]![2]).toEqual({ appId: "555", appSecret: h.app.appSecret });
  });

  it("assinatura errada, ausente ou de outro segredo: 401 e nada processado", async () => {
    expect((await post(CORPO, null)).status).toBe(401);
    expect((await post(CORPO, assinar(CORPO, "outro-segredo-qualquer-123456"))).status).toBe(401);
    expect((await post(CORPO, "sha256=abc")).status).toBe(401);
    expect((await post(`${CORPO} `, assinar(CORPO, h.app.appSecret!))).status).toBe(401);
    expect(h.processar).not.toHaveBeenCalled();
  });

  it("instalação sem App Secret: recusa (falha fechada), nunca aceita sem conferir", async () => {
    h.app = { appId: null, appSecret: null, verifyToken: null };
    expect((await post(CORPO, assinar(CORPO, ""))).status).toBe(401);
    expect(h.processar).not.toHaveBeenCalled();
  });

  it("JSON inválido com assinatura válida: 400", async () => {
    const lixo = "{nao-e-json";
    expect((await post(lixo, assinar(lixo, h.app.appSecret!))).status).toBe(400);
  });
});

describe("GET /api/v1/webhooks/meta-social (handshake)", () => {
  const get = (q: string) => GET(new NextRequest(`https://crm.test/api/v1/webhooks/meta-social?${q}`));

  it("verify token certo devolve o challenge em texto puro", async () => {
    const r = await get("hub.mode=subscribe&hub.verify_token=token-de-verificacao-forte&hub.challenge=12345");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("12345");
  });

  it("verify token errado ou ausente: 403", async () => {
    expect((await get("hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1")).status).toBe(403);
    h.app = { appId: null, appSecret: null, verifyToken: null };
    expect((await get("hub.mode=subscribe&hub.verify_token=&hub.challenge=1")).status).toBe(403);
  });
});
