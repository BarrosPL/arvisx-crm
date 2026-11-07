/**
 * Roteamento da conexão direta: o evento cai na organização da SESSÃO que
 * responde pela conta (`entry.id`) — nunca em outra —, o eco do próprio envio
 * não vira mensagem, e tudo o mais passa pelo MESMO caminho de ingestão social.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessaoDireta } from "./store";
import type { EventoDireto } from "./webhook";

const h = vi.hoisted(() => ({
  sessoes: new Map<string, unknown>(),
  ingest: vi.fn(),
  perfil: vi.fn(),
  contatoExiste: false,
}));

vi.mock("./store", () => ({
  sessaoPelaConta: async (_db: unknown, conta: string) => h.sessoes.get(conta) ?? null,
  tokenDaSessao: async () => ({ token: "page-token", pageId: "111", rede: "facebook" }),
}));
vi.mock("../zernio/ingest", () => ({ ingestZernioInbound: h.ingest }));
vi.mock("./perfil", () => ({ perfilDoParticipante: h.perfil }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { processarEventosDiretos } from "./ingest";

/** Banco dublado só para a pergunta "o contato já existe?". */
const db = {
  from: () => {
    const q = {
      select: () => q,
      eq: () => q,
      is: () => q,
      maybeSingle: async () => ({ data: h.contatoExiste ? { id: "c1" } : null, error: null }),
    };
    return q;
  },
} as never;

function sessao(org: string, id: string, conta: string, rede: "facebook" | "instagram"): SessaoDireta {
  return { id, organizationId: org, rede, conta, pageId: "111", displayName: null, status: "WORKING", metadata: {} };
}

function mensagem(conta: string, extra: Partial<Extract<EventoDireto, { tipo: "mensagem" }>> = {}): EventoDireto {
  return {
    tipo: "mensagem",
    rede: "facebook",
    conta,
    participante: "999",
    mid: "m_1",
    texto: "Oi",
    anexos: [],
    quando: "2026-11-07T12:00:00.000Z",
    eco: false,
    appId: null,
    ...extra,
  };
}

const CTX = { appId: "555", appSecret: "segredo" };

beforeEach(() => {
  vi.clearAllMocks();
  h.sessoes.clear();
  h.contatoExiste = false;
  h.sessoes.set("111", sessao("org-a", "sessao-a", "111", "facebook"));
  h.sessoes.set("222", sessao("org-b", "sessao-b", "222", "facebook"));
  h.sessoes.set("17840", sessao("org-b", "sessao-b-ig", "17840", "instagram"));
  h.ingest.mockResolvedValue({ status: "ingested" });
  h.perfil.mockResolvedValue({ nome: "Maria Souza", usuario: null, foto: null });
});

describe("processarEventosDiretos", () => {
  it("cada evento vai para a organização da sessão da SUA conta — sem vazar para a outra", async () => {
    const desfechos = await processarEventosDiretos(db, [mensagem("111"), mensagem("222", { mid: "m_2" })], CTX);
    expect(desfechos).toEqual(["ingested", "ingested"]);
    const chamadas = h.ingest.mock.calls.map((c) => c[1] as { organizationId: string; channelSessionId: string });
    expect(chamadas).toEqual([
      expect.objectContaining({ organizationId: "org-a", channelSessionId: "sessao-a" }),
      expect.objectContaining({ organizationId: "org-b", channelSessionId: "sessao-b" }),
    ]);
  });

  it("monta a mensagem social com a thread = participante e o id idempotente da conta", async () => {
    await processarEventosDiretos(db, [mensagem("111")], CTX);
    const { socialMessage } = h.ingest.mock.calls[0]![1] as { socialMessage: Record<string, unknown> };
    expect(socialMessage).toMatchObject({
      platform: "facebook",
      accountId: "111",
      participantId: "999",
      conversationId: "999",
      externalId: "social:111:m_1",
      direction: "inbound",
      kind: "message",
      text: "Oi",
      identity: expect.objectContaining({ displayName: "Maria Souza" }),
    });
  });

  it("conta sem sessão ativa é ignorada, sem chamar a ingestão", async () => {
    expect(await processarEventosDiretos(db, [mensagem("333")], CTX)).toEqual(["conta_desconhecida"]);
    expect(h.ingest).not.toHaveBeenCalled();
  });

  it("evento do Instagram não entra numa sessão do Messenger (e vice-versa)", async () => {
    expect(await processarEventosDiretos(db, [mensagem("17840")], CTX)).toEqual(["rede_diferente_da_sessao"]);
    expect(h.ingest).not.toHaveBeenCalled();
  });

  it("eco do PRÓPRIO app não vira mensagem; eco de outro app entra como saída", async () => {
    expect(await processarEventosDiretos(db, [mensagem("111", { eco: true, appId: "555" })], CTX)).toEqual([
      "eco_do_proprio_envio",
    ]);
    expect(h.ingest).not.toHaveBeenCalled();
    await processarEventosDiretos(db, [mensagem("111", { eco: true, appId: "777" })], CTX);
    const { socialMessage } = h.ingest.mock.calls[0]![1] as { socialMessage: Record<string, unknown> };
    expect(socialMessage).toMatchObject({ direction: "outbound", status: "sent" });
    // Eco não pergunta perfil: quem escreveu foi a própria empresa.
    expect(h.perfil).not.toHaveBeenCalled();
  });

  it("o nome só é buscado na Meta para contato NOVO", async () => {
    h.contatoExiste = true;
    await processarEventosDiretos(db, [mensagem("111")], CTX);
    expect(h.perfil).not.toHaveBeenCalled();
  });

  it("reentrega: o desfecho `duplicate` da ingestão sobe como está (idempotência do banco)", async () => {
    h.ingest.mockResolvedValue({ status: "duplicate" });
    expect(await processarEventosDiretos(db, [mensagem("111")], CTX)).toEqual(["duplicate"]);
  });

  it("entrega atualiza o status de cada mensagem, pelo mesmo id idempotente", async () => {
    await processarEventosDiretos(
      db,
      [{ tipo: "entrega", rede: "facebook", conta: "111", participante: "999", mids: ["m_a", "m_b"], quando: "2026-11-07T12:00:00.000Z" }],
      CTX,
    );
    const ids = h.ingest.mock.calls.map((c) => (c[1] as { socialMessage: { externalId: string; kind: string; status: string } }).socialMessage);
    expect(ids).toEqual([
      expect.objectContaining({ externalId: "social:111:m_a", kind: "status", status: "delivered" }),
      expect.objectContaining({ externalId: "social:111:m_b", kind: "status", status: "delivered" }),
    ]);
  });

  it("um evento que falha não derruba os outros do lote", async () => {
    h.ingest.mockRejectedValueOnce(new Error("banco caiu")).mockResolvedValueOnce({ status: "ingested" });
    expect(await processarEventosDiretos(db, [mensagem("111"), mensagem("111", { mid: "m_2" })], CTX)).toEqual([
      "falhou",
      "ingested",
    ]);
  });
});
