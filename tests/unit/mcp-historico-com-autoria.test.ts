/**
 * QUEM ESCREVEU cada mensagem de `crm_get_conversation_history` — cliente, IA
 * (qual agente), pessoa da equipe (com nome) ou sistema — e o canal.
 *
 * O agente que divide a conversa com a equipe precisa separar o que a equipe
 * disse ao cliente do que a IA disse. A autoria sai da própria linha de
 * `messages`, lida como o balão da caixa de entrada lê.
 *
 * `listMessagesHandler` e `getConversationHandler` são dublados (a paginação e
 * o filtro de organização deles têm os próprios testes); os nomes de agente e o
 * canal são lidos de um banco em memória com DUAS organizações.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type BancoEmMemoria } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  nomes: new Map<string, string | null>(),
  pedidos: [] as Array<{ org: string; ids: string[] }>,
  falhaNosNomes: false,
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ storage: { from: vi.fn() } })) }));
vi.mock("@/app/api/v1/messages/_handler", () => ({ listMessagesHandler: vi.fn() }));
vi.mock("@/app/api/v1/conversations/_handler", () => ({
  getConversationHandler: vi.fn(),
  listConversationsHandler: vi.fn(),
}));
vi.mock("@/lib/users/nome-do-atendente", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  nomesDosAtendentesCom: vi.fn(async (_admin: unknown, org: string, ids: Array<string | null | undefined>) => {
    if (h.falhaNosNomes) throw new Error("GoTrue fora do ar");
    const limpos = ids.filter((id): id is string => Boolean(id));
    h.pedidos.push({ org, ids: limpos });
    return new Map(limpos.map((id) => [id, h.nomes.get(id) ?? null]));
  }),
}));

import { getConversationHandler } from "@/app/api/v1/conversations/_handler";
import { listMessagesHandler } from "@/app/api/v1/messages/_handler";
import { autoresDoHistorico } from "@/lib/mcp/autoria-do-historico";
import { crmGetConversationHistory } from "@/lib/mcp/tools/conversations";
import type { McpContext } from "@/lib/mcp/types";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const CONVERSA = "aaaaaaaa-0000-4000-8000-0000000000e1";
const CONTATO = "aaaaaaaa-0000-4000-8000-0000000000c1";
const ANDREIA = "aaaaaaaa-0000-4000-8000-0000000000b1";
const BRUNO = "aaaaaaaa-0000-4000-8000-0000000000b2";
const AGENTE = "aaaaaaaa-0000-4000-8000-0000000000a9";
const AGENTE_SEM_NOME_NA_LINHA = "aaaaaaaa-0000-4000-8000-0000000000a8";
const AGENTE_DA_B = "bbbbbbbb-0000-4000-8000-0000000000a9";
const EXECUCAO = "aaaaaaaa-0000-4000-8000-0000000000f7";

let banco: BancoEmMemoria;
const mockedList = vi.mocked(listMessagesHandler);
const mockedConv = vi.mocked(getConversationHandler);

function ctx(extra: Partial<McpContext> = {}): McpContext {
  return {
    organizationId: ORG_A,
    role: "agent",
    actor: { type: "api_token", id: "tok", role: "agent" },
    apiTokenId: "tok",
    requestId: "req-1",
    supabase: banco.cliente as never,
    ...extra,
  };
}

const msg = (o: Record<string, unknown>) => ({
  id: "m",
  contact_id: CONTATO,
  direction: "outbound",
  type: "text",
  body: "texto",
  media_url: null,
  media_mime: null,
  media_size_bytes: null,
  media_storage_path: null,
  sent_via: "user",
  sent_by_user_id: null,
  sent_on_behalf_of_user_id: null,
  sent_at: "2026-11-10T12:00:00Z",
  status: "delivered",
  metadata: {},
  ...o,
});

/** Uma conversa com todas as origens que `messages` distingue. */
const CONVERSA_COMPLETA = [
  msg({ id: "do-cliente", direction: "inbound", sent_via: "crm", body: "Quanto custa?" }),
  msg({ id: "da-ia", sent_via: "ai", metadata: { ai_actor_id: AGENTE, ai_actor_name: "Clara" } }),
  msg({ id: "da-andreia", sent_via: "user", sent_by_user_id: ANDREIA }),
  msg({ id: "do-bruno", sent_via: "crm", sent_by_user_id: BRUNO }),
  msg({ id: "da-automacao", sent_via: "automation" }),
  msg({ id: "da-integracao", sent_via: "system" }),
  msg({ id: "do-celular", sent_via: "external_device" }),
  msg({
    id: "em-nome-de",
    sent_via: "system",
    sent_on_behalf_of_user_id: ANDREIA,
    metadata: { sent_on_behalf: { user_id: ANDREIA, user_name: "Andreia Lima", token_name: "ERP" } },
  }),
];

beforeEach(() => {
  h.pedidos.length = 0;
  h.falhaNosNomes = false;
  h.nomes.clear();
  h.nomes.set(ANDREIA, "Andreia Lima");
  h.nomes.set(BRUNO, "Bruno Reis");
  mockedList.mockReset();
  mockedConv.mockReset();
  banco = bancoEmMemoria({
    conversations: [{ id: CONVERSA, organization_id: ORG_A, contact_id: CONTATO, channel: "whatsapp" }],
    ai_agents: [
      { id: AGENTE, organization_id: ORG_A, name: "Clara (cadastro)" },
      { id: AGENTE_SEM_NOME_NA_LINHA, organization_id: ORG_A, name: "Recuperador de vendas" },
      { id: AGENTE_DA_B, organization_id: ORG_B, name: "Agente da outra empresa" },
    ],
  });
});

type Mensagem = {
  id: string;
  direction: string;
  channel: string | null;
  author: { kind: string; id: string | null; name: string | null; detail?: string; via_token?: string | null };
};

async function historico(mensagens: unknown[], c = ctx()) {
  mockedList.mockResolvedValue({ messages: mensagens, cursor: null, has_more: false } as never);
  const r = (await crmGetConversationHistory.handler({ conversation_id: CONVERSA, limit: 20 }, c)) as {
    messages: Mensagem[];
  };
  return new Map(r.messages.map((m) => [m.id, m]));
}

describe("⭐ autoria das quatro origens", () => {
  it("cliente: a mensagem recebida", async () => {
    const m = (await historico(CONVERSA_COMPLETA)).get("do-cliente")!;
    expect(m.author).toEqual({ kind: "cliente", id: CONTATO, name: null });
    expect(m.direction).toBe("inbound");
  });

  it("IA: diz qual agente, com o nome gravado na linha", async () => {
    const m = (await historico(CONVERSA_COMPLETA)).get("da-ia")!;
    expect(m.author).toEqual({ kind: "ia", id: AGENTE, name: "Clara" });
  });

  it("pessoa da equipe: diz quem, com o NOME (e nada além do nome)", async () => {
    const todas = await historico(CONVERSA_COMPLETA);
    expect(todas.get("da-andreia")!.author).toEqual({ kind: "equipe", id: ANDREIA, name: "Andreia Lima" });
    expect(todas.get("do-bruno")!.author).toEqual({ kind: "equipe", id: BRUNO, name: "Bruno Reis" });
    expect(JSON.stringify([...todas.values()].map((m) => m.author))).not.toMatch(/@|email|phone|telefone/i);
  });

  it("sistema: automação e integração por token, sem fingir que alguém escreveu", async () => {
    const todas = await historico(CONVERSA_COMPLETA);
    expect(todas.get("da-automacao")!.author).toEqual({ kind: "sistema", id: null, name: null, detail: "automacao" });
    expect(todas.get("da-integracao")!.author).toEqual({ kind: "sistema", id: null, name: null, detail: "integracao" });
  });

  it("⭐ o agente separa o que a EQUIPE disse do que a IA e o sistema disseram", async () => {
    const todas = [...(await historico(CONVERSA_COMPLETA)).values()];
    const por = (kind: string) => todas.filter((m) => m.author.kind === kind).map((m) => m.id);

    expect(por("cliente")).toEqual(["do-cliente"]);
    expect(por("ia")).toEqual(["da-ia"]);
    expect(por("equipe")).toEqual(["da-andreia", "do-bruno", "do-celular", "em-nome-de"]);
    expect(por("sistema")).toEqual(["da-automacao", "da-integracao"]);
    // toda mensagem tem autor: nenhuma ficou sem origem
    expect(todas.every((m) => m.author !== null)).toBe(true);
  });
});

describe("os casos de borda de cada origem", () => {
  it("celular ligado ao número: é da equipe, mas a linha não diz quem digitou", async () => {
    const m = (await historico(CONVERSA_COMPLETA)).get("do-celular")!;
    expect(m.author).toEqual({ kind: "equipe", id: null, name: null, detail: "celular" });
  });

  it("enviada por um sistema EM NOME de uma pessoa: a autora é a pessoa, e diz por qual token", async () => {
    const m = (await historico(CONVERSA_COMPLETA)).get("em-nome-de")!;
    expect(m.author).toEqual({
      kind: "equipe",
      id: ANDREIA,
      name: "Andreia Lima",
      detail: "em_nome_de",
      via_token: "ERP",
    });
  });

  it("IA sem nome gravado (linha antiga): o nome vem do cadastro do agente", async () => {
    const todas = await historico([msg({ id: "antiga", sent_via: "ai", metadata: { ai_actor_id: AGENTE_SEM_NOME_NA_LINHA } })]);
    expect(todas.get("antiga")!.author).toEqual({ kind: "ia", id: AGENTE_SEM_NOME_NA_LINHA, name: "Recuperador de vendas" });
  });

  it("IA cujo id gravado é o da execução, e não o de um agente: é IA, sem id inventado", async () => {
    const todas = await historico([
      msg({ id: "por-token", sent_via: "ai", metadata: { ai_actor_id: EXECUCAO, ai_actor_name: null } }),
      msg({ id: "do-motor", sent_via: "ai", metadata: { ai_actor_id: "agent-engine" } }),
      msg({ id: "sem-metadata", sent_via: "ai", metadata: null }),
    ]);
    for (const id of ["por-token", "do-motor", "sem-metadata"]) {
      expect(todas.get(id)!.author, id).toEqual({ kind: "ia", id: null, name: null });
    }
  });

  it("⭐ agente de OUTRA organização gravado na linha não ganha id nem nome do cadastro", async () => {
    const todas = await historico([msg({ id: "x", sent_via: "ai", metadata: { ai_actor_id: AGENTE_DA_B } })]);
    expect(todas.get("x")!.author).toEqual({ kind: "ia", id: null, name: null });
    expect(JSON.stringify(todas.get("x"))).not.toContain("outra empresa");
  });

  it("pessoa sem id na linha, ou sem nome no cadastro: continua sendo da equipe", async () => {
    h.nomes.delete(BRUNO);
    const todas = await historico([
      msg({ id: "sem-id", sent_via: "user", sent_by_user_id: null }),
      msg({ id: "sem-nome", sent_via: "user", sent_by_user_id: BRUNO }),
    ]);
    expect(todas.get("sem-id")!.author).toEqual({ kind: "equipe", id: null, name: null });
    expect(todas.get("sem-nome")!.author).toEqual({ kind: "equipe", id: BRUNO, name: null });
  });

  it("em grupo, quem falou é o participante: sai o nome dele, nunca o telefone", async () => {
    const todas = await historico([
      msg({
        id: "do-grupo",
        direction: "inbound",
        metadata: { group_sender: { name: "Carla", phone: "+5511999990000", lid: null } },
      }),
    ]);
    expect(todas.get("do-grupo")!.author).toEqual({
      kind: "cliente",
      id: null,
      name: "Carla",
      detail: "participante_de_grupo",
    });
    expect(JSON.stringify(todas.get("do-grupo")!.author)).not.toContain("5511");
  });

  it("o nome na `metadata` que o cliente poderia forjar não é lido para pessoa", async () => {
    const todas = await historico([
      msg({ id: "x", sent_via: "user", sent_by_user_id: ANDREIA, metadata: { sent_by_user_name: "Forjado", ai_actor_name: "Forjado" } }),
    ]);
    expect(todas.get("x")!.author).toEqual({ kind: "equipe", id: ANDREIA, name: "Andreia Lima" });
  });

  it("o serviço de nomes caiu: a origem continua certa e o histórico não cai", async () => {
    h.falhaNosNomes = true;
    const todas = await historico(CONVERSA_COMPLETA);
    expect(todas.get("da-andreia")!.author).toEqual({ kind: "equipe", id: ANDREIA, name: null });
    expect(todas.get("da-ia")!.author).toEqual({ kind: "ia", id: AGENTE, name: "Clara" });
    expect(todas.size).toBe(CONVERSA_COMPLETA.length);
  });
});

describe("custo e isolamento da resolução de nomes", () => {
  it("os nomes são pedidos uma vez por página, só dos ids que são de pessoa, com a organização do token", async () => {
    await historico(CONVERSA_COMPLETA);
    expect(h.pedidos).toHaveLength(1);
    expect(h.pedidos[0]!.org).toBe(ORG_A);
    expect(new Set(h.pedidos[0]!.ids)).toEqual(new Set([ANDREIA, BRUNO]));
  });

  it("página só com mensagens do cliente não consulta nome nenhum", async () => {
    await historico([msg({ id: "a", direction: "inbound" }), msg({ id: "b", direction: "inbound" })]);
    expect(h.pedidos).toHaveLength(0);
    expect(banco.consultas.ai_agents ?? 0).toBe(0);
  });

  it("a função pura não grava nada", async () => {
    const antes = JSON.stringify(banco.tabelas);
    await autoresDoHistorico(ctx(), CONVERSA_COMPLETA as never);
    expect(JSON.stringify(banco.tabelas)).toBe(antes);
  });
});

describe("o canal", () => {
  it("cada mensagem diz o canal da conversa", async () => {
    const todas = [...(await historico(CONVERSA_COMPLETA)).values()];
    expect(todas.map((m) => m.channel)).toEqual(todas.map(() => "whatsapp"));
  });

  it("o canal é lido com a organização do token: conversa de outra organização não entrega canal", async () => {
    banco.tabelas.conversations = [{ id: CONVERSA, organization_id: ORG_B, contact_id: CONTATO, channel: "instagram" }];
    const todas = [...(await historico(CONVERSA_COMPLETA)).values()];
    expect(todas.map((m) => m.channel)).toEqual(todas.map(() => null));
  });

  it("no turno de atendimento o canal vem da conferência da conversa, sem consulta a mais", async () => {
    mockedConv.mockResolvedValue({ contact_id: CONTATO, channel: "instagram" } as never);
    const todas = [...(await historico(CONVERSA_COMPLETA, ctx({ contatoDoTurno: CONTATO }))).values()];
    expect(todas.map((m) => m.channel)).toEqual(todas.map(() => "instagram"));
    expect(banco.consultas.conversations ?? 0).toBe(0);
  });

  it("no turno, conversa de outro cliente continua recusada antes de ler mensagem", async () => {
    mockedConv.mockResolvedValue({ contact_id: "outro-contato", channel: "whatsapp" } as never);
    mockedList.mockResolvedValue({ messages: CONVERSA_COMPLETA, cursor: null, has_more: false } as never);
    const r = await crmGetConversationHistory.handler(
      { conversation_id: CONVERSA, limit: 20 },
      ctx({ contatoDoTurno: CONTATO }),
    );
    expect(r).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
    expect(mockedList).not.toHaveBeenCalled();
  });
});

describe("o que já existia continua igual", () => {
  it("os campos de antes seguem na resposta, com `direction` e `sent_via`", async () => {
    const m = (await historico([msg({ id: "x", sent_via: "user", sent_by_user_id: ANDREIA })])).get("x")! as never as Record<
      string,
      unknown
    >;
    expect(m).toMatchObject({
      id: "x",
      direction: "outbound",
      type: "text",
      body: "texto",
      sent_via: "user",
      status: "delivered",
      media_status: "none",
      media_signed_url: null,
    });
  });
});
