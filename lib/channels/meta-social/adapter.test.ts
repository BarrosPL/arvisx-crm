/**
 * O envio da conexão direta com a Graph DUBLADA: o corpo certo para cada tipo,
 * o erro da Meta virando frase do operador, e a janela de 24 h — com a etiqueta
 * HUMAN_AGENT só quando a instalação a liga, e nunca envio em dobro.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ cred: { token: "page-token", pageId: "111", rede: "facebook" } as unknown }));

vi.mock("./store", () => ({ tokenDaSessao: async () => h.cred }));
vi.mock("../meta/app", () => ({ appDaMeta: async () => ({ appSecret: "app-secret", verifyToken: "v" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { anexoDoEnvio, corpoDoEnvio, metaSocialAdapter } from "./adapter";
import { fraseDoErroDaGraph } from "./graph";

const fetchMock = vi.fn();

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

const ENVELOPE = {
  organizationId: "org-1",
  sessionRef: "111",
  to: "provider-thread",
  kind: "text" as const,
  body: "Olá!",
  providerConversationId: "999",
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  h.cred = { token: "page-token", pageId: "111", rede: "facebook" };
  delete process.env.META_HUMAN_AGENT_TAG;
});
afterEach(() => vi.unstubAllGlobals());

describe("corpo do envio", () => {
  it("texto vai como RESPONSE ao PSID; anexo vai por URL", () => {
    expect(corpoDoEnvio({ destinatario: "999", texto: "Oi" })).toEqual({
      recipient: { id: "999" },
      messaging_type: "RESPONSE",
      message: { text: "Oi" },
    });
    expect(corpoDoEnvio({ destinatario: "999", anexo: { tipo: "image", url: "https://x/y.jpg" }, humanAgent: true })).toEqual({
      recipient: { id: "999" },
      messaging_type: "MESSAGE_TAG",
      tag: "HUMAN_AGENT",
      message: { attachment: { type: "image", payload: { url: "https://x/y.jpg", is_reusable: false } } },
    });
  });

  it("documento só no Messenger; o Instagram não aceita arquivo genérico", () => {
    expect(anexoDoEnvio("document", "facebook")).toBe("file");
    expect(anexoDoEnvio("document", "instagram")).toBeNull();
    expect(anexoDoEnvio("voice", "instagram")).toBe("audio");
    expect(anexoDoEnvio("location", "facebook")).toBeNull();
  });
});

describe("metaSocialAdapter.send", () => {
  it("envia pela página com o token no cabeçalho (nunca na URL) e devolve o id idempotente", async () => {
    fetchMock.mockResolvedValueOnce(resposta(200, { recipient_id: "999", message_id: "m_123" }));
    const r = await metaSocialAdapter.send(ENVELOPE);
    expect(r).toEqual({ externalId: "social:111:m_123" });
    const [url, init] = fetchMock.mock.calls[0]! as [URL, RequestInit];
    expect(String(url)).toMatch(/\/111\/messages\?appsecret_proof=[0-9a-f]{64}$/);
    expect(String(url)).not.toContain("page-token");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer page-token");
    expect(JSON.parse(String(init.body))).toMatchObject({ recipient: { id: "999" }, message: { text: "Olá!" } });
  });

  it("sem thread (o cliente nunca escreveu) recusa sem chamar a Meta", async () => {
    await expect(metaSocialAdapter.send({ ...ENVELOPE, providerConversationId: null })).rejects.toThrow(/Aguarde uma mensagem/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sem token (desconectada) recusa dizendo para reconectar", async () => {
    h.cred = null;
    await expect(metaSocialAdapter.send(ENVELOPE)).rejects.toThrow(/Reconecte/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("janela fechada: frase clara e UMA chamada só quando a etiqueta não está ligada", async () => {
    fetchMock.mockResolvedValue(resposta(400, { error: { code: 10, error_subcode: 2018278, message: "outside window" } }));
    await expect(metaSocialAdapter.send(ENVELOPE)).rejects.toThrow(/janela de 24 horas/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("janela fechada com META_HUMAN_AGENT_TAG=on: refaz UMA vez com HUMAN_AGENT", async () => {
    process.env.META_HUMAN_AGENT_TAG = "on";
    fetchMock
      .mockResolvedValueOnce(resposta(400, { error: { code: 10, error_subcode: 2018278 } }))
      .mockResolvedValueOnce(resposta(200, { message_id: "m_tag" }));
    expect(await metaSocialAdapter.send(ENVELOPE)).toEqual({ externalId: "social:111:m_tag" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body))).toMatchObject({
      messaging_type: "MESSAGE_TAG",
      tag: "HUMAN_AGENT",
    });
  });

  it("outro erro não é refeito (sem envio em dobro), mesmo com a etiqueta ligada", async () => {
    process.env.META_HUMAN_AGENT_TAG = "on";
    fetchMock.mockResolvedValue(resposta(400, { error: { code: 190, message: "token expired" } }));
    await expect(metaSocialAdapter.send(ENVELOPE)).rejects.toThrow(/Reconecte a página/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("mídia com legenda: a mídia primeiro (o id que vale), a legenda como texto depois", async () => {
    fetchMock
      .mockResolvedValueOnce(resposta(200, { message_id: "m_img" }))
      .mockResolvedValueOnce(resposta(200, { message_id: "m_txt" }));
    const r = await metaSocialAdapter.send({
      ...ENVELOPE,
      kind: "image",
      body: undefined,
      media: { url: "https://storage.exemplo/assinada.jpg", mime: "image/jpeg", caption: "Nosso catálogo" },
    });
    expect(r).toEqual({ externalId: "social:111:m_img" });
    const corpos = fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(corpos[0].message.attachment.payload.url).toBe("https://storage.exemplo/assinada.jpg");
    expect(corpos[1].message).toEqual({ text: "Nosso catálogo" });
  });
});

describe("frase do erro da Graph", () => {
  it("cada família de erro vira uma frase que o operador entende", () => {
    const d = (code: number | null, subcode: number | null = null) => ({ status: 400, code, subcode, mensagem: null });
    expect(fraseDoErroDaGraph(d(10, 2534022))).toMatch(/24 horas/);
    expect(fraseDoErroDaGraph(d(190))).toMatch(/Reconecte/);
    expect(fraseDoErroDaGraph(d(200))).toMatch(/permissão/);
    expect(fraseDoErroDaGraph(d(613))).toMatch(/limitou/);
    expect(fraseDoErroDaGraph(d(551))).toMatch(/não está disponível/);
    expect(fraseDoErroDaGraph(d(1))).toMatch(/código 1/);
  });
});
