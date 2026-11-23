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
const TOKEN_SOPHIA = "aaaaaaaa-0000-4000-8000-0000000000f1";
const TOKEN_PEDRO = "aaaaaaaa-0000-4000-8000-0000000000f2";
const TOKEN_APAGADO = "aaaaaaaa-0000-4000-8000-0000000000f3";
const TOKEN_DA_B = "bbbbbbbb-0000-4000-8000-0000000000f1";

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
    api_tokens: [
      { id: TOKEN_SOPHIA, organization_id: ORG_A, name: "Sophia", token_hash: "hash-da-sophia" },
      { id: TOKEN_PEDRO, organization_id: ORG_A, name: "Pedro", token_hash: "hash-do-pedro" },
      { id: TOKEN_DA_B, organization_id: ORG_B, name: "Token da outra empresa", token_hash: "hash-da-b" },
    ],
  });
});

type Mensagem = {
  id: string;
  direction: string;
  channel: string | null;
  author: {
    kind: string;
    id: string | null;
    name: string | null;
    detail?: string;
    via_token?: string | null;
    is_self?: boolean;
  };
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

/** Como o envio grava: `sent_via` do ator e o token em `metadata.sent_by_token`. */
const porToken = (id: string, token: string, nome: string | null, extra: Record<string, unknown> = {}) =>
  msg({ id, sent_via: "system", metadata: { sent_by_token: { token_id: token, token_name: nome } }, ...extra });

const comoToken = (token: string) =>
  ctx({ apiTokenId: token, actor: { type: "api_token", id: token, role: "agent" } });
/** Token que o administrador marcou como "tratado como gerente": vê o id e o nome de todo token. */
const comoGerente = (token: string) =>
  ctx({ apiTokenId: token, role: "manager", actor: { type: "api_token", id: token, role: "manager" } });

describe("⭐ o agente externo separa a PRÓPRIA fala da de outra integração", () => {
  const CONVERSA_DE_DOIS_AGENTES = [
    ...CONVERSA_COMPLETA,
    porToken("da-sophia", TOKEN_SOPHIA, "Sophia"),
    porToken("do-pedro", TOKEN_PEDRO, "Pedro"),
  ];

  it("a mensagem enviada por token sai como `agente`; para gerente, com o id e o nome do token", async () => {
    const todas = await historico(CONVERSA_DE_DOIS_AGENTES, comoGerente(TOKEN_SOPHIA));
    expect(todas.get("da-sophia")!.author).toEqual({ kind: "agente", id: TOKEN_SOPHIA, name: "Sophia", is_self: true });
    expect(todas.get("do-pedro")!.author).toEqual({ kind: "agente", id: TOKEN_PEDRO, name: "Pedro", is_self: false });
  });

  it("⭐ a mesma conversa lida pelo token A e pelo token B: cada um sabe qual fala é a sua", async () => {
    const proprias = async (token: string) =>
      [...(await historico(CONVERSA_DE_DOIS_AGENTES, comoToken(token))).values()]
        .filter((m) => m.author.is_self === true)
        .map((m) => m.id);

    expect(await proprias(TOKEN_SOPHIA)).toEqual(["da-sophia"]);
    expect(await proprias(TOKEN_PEDRO)).toEqual(["do-pedro"]);
  });

  it("quem lê sem ser nenhum dos dois não é o autor de nenhuma", async () => {
    const todas = [...(await historico(CONVERSA_DE_DOIS_AGENTES)).values()];
    expect(todas.filter((m) => m.author.is_self === true)).toEqual([]);
    expect(todas.filter((m) => m.author.kind === "agente").map((m) => m.author.is_self)).toEqual([false, false]);
  });

  it("⭐ equipe, cliente, IA do CRM e sistema continuam exatamente como eram", async () => {
    const todas = await historico(CONVERSA_DE_DOIS_AGENTES, comoToken(TOKEN_SOPHIA));
    expect(todas.get("do-cliente")!.author).toEqual({ kind: "cliente", id: CONTATO, name: null });
    expect(todas.get("da-ia")!.author).toEqual({ kind: "ia", id: AGENTE, name: "Clara" });
    expect(todas.get("da-andreia")!.author).toEqual({ kind: "equipe", id: ANDREIA, name: "Andreia Lima" });
    expect(todas.get("do-celular")!.author).toEqual({ kind: "equipe", id: null, name: null, detail: "celular" });
    expect(todas.get("da-automacao")!.author).toEqual({ kind: "sistema", id: null, name: null, detail: "automacao" });
    const por = (kind: string) => [...todas.values()].filter((m) => m.author.kind === kind).map((m) => m.id);
    expect(por("agente")).toEqual(["da-sophia", "do-pedro"]);
    expect(por("equipe")).toEqual(["da-andreia", "do-bruno", "do-celular", "em-nome-de"]);
    // `is_self` só existe em `agente`
    expect([...todas.values()].filter((m) => m.author.kind !== "agente" && "is_self" in m.author)).toEqual([]);
  });

  it("⭐ mensagem ANTIGA por token, sem o token gravado: continua legível, como `sistema` / `integracao`", async () => {
    const todas = await historico(
      [msg({ id: "antiga", sent_via: "system" }), msg({ id: "antiga-sem-metadata", sent_via: "system", metadata: null })],
      comoToken(TOKEN_SOPHIA),
    );
    for (const id of ["antiga", "antiga-sem-metadata"]) {
      expect(todas.get(id)!.author, id).toEqual({ kind: "sistema", id: null, name: null, detail: "integracao" });
    }
  });

  it("token com escopo de agente (`sent_via: ai`): é o agente externo, não a IA do CRM", async () => {
    const todas = await historico(
      [
        porToken("x", TOKEN_SOPHIA, "Sophia", {
          sent_via: "ai",
          metadata: { ai_actor_id: EXECUCAO, ai_actor_name: null, sent_by_token: { token_id: TOKEN_SOPHIA, token_name: "Sophia" } },
        }),
      ],
      comoToken(TOKEN_SOPHIA),
    );
    expect(todas.get("x")!.author).toEqual({ kind: "agente", id: TOKEN_SOPHIA, name: "Sophia", is_self: true });
  });

  it("token renomeado sai com o nome de hoje; token apagado, com o nome gravado no envio", async () => {
    const todas = await historico(
      [
        porToken("renomeado", TOKEN_SOPHIA, "Nome antigo"),
        porToken("apagado", TOKEN_APAGADO, "Cobrança"),
        porToken("apagado-sem-nome", TOKEN_APAGADO, null),
      ],
      comoGerente("tok"),
    );
    expect(todas.get("renomeado")!.author).toMatchObject({ kind: "agente", id: TOKEN_SOPHIA, name: "Sophia" });
    expect(todas.get("apagado")!.author).toMatchObject({ kind: "agente", id: TOKEN_APAGADO, name: "Cobrança" });
    expect(todas.get("apagado-sem-nome")!.author).toMatchObject({ kind: "agente", id: TOKEN_APAGADO, name: null });
  });

  it("⭐ isolamento: o nome do token é lido com a organização de quem lê", async () => {
    const todas = await historico([porToken("x", TOKEN_DA_B, null)], comoGerente(TOKEN_SOPHIA));
    expect(todas.get("x")!.author).toEqual({ kind: "agente", id: TOKEN_DA_B, name: null, is_self: false });
    expect(JSON.stringify(todas.get("x"))).not.toContain("outra empresa");
  });

  it("nada do token além de id e nome sai na resposta", async () => {
    const todas = await historico(CONVERSA_DE_DOIS_AGENTES, comoToken(TOKEN_SOPHIA));
    const saida = JSON.stringify([...todas.values()]);
    expect(saida).not.toMatch(/hash-da-sophia|hash-do-pedro|token_hash|dsk_/);
    expect(Object.keys(todas.get("da-sophia")!.author).sort()).toEqual(["id", "is_self", "kind", "name"]);
  });

  it("a chave do token em linha que NÃO saiu por token não muda a autoria", async () => {
    const forjada = { sent_by_token: { token_id: TOKEN_SOPHIA, token_name: "Sophia" } };
    const todas = await historico(
      [
        msg({ id: "da-pessoa", sent_via: "user", sent_by_user_id: ANDREIA, metadata: forjada }),
        msg({ id: "do-cliente", direction: "inbound", metadata: forjada }),
        msg({ id: "da-regra", sent_via: "automation", metadata: forjada }),
      ],
      comoToken(TOKEN_SOPHIA),
    );
    expect(todas.get("da-pessoa")!.author).toEqual({ kind: "equipe", id: ANDREIA, name: "Andreia Lima" });
    expect(todas.get("do-cliente")!.author).toEqual({ kind: "cliente", id: CONTATO, name: null });
    expect(todas.get("da-regra")!.author).toEqual({ kind: "sistema", id: null, name: null, detail: "automacao" });
  });

  it("enviada por token EM NOME de uma pessoa: a autora continua sendo a pessoa", async () => {
    const todas = await historico(
      [
        msg({
          id: "em-nome-de",
          sent_via: "system",
          sent_on_behalf_of_user_id: ANDREIA,
          metadata: {
            sent_on_behalf: { user_id: ANDREIA, user_name: "Andreia Lima", token_name: "Sophia" },
            sent_by_token: { token_id: TOKEN_SOPHIA, token_name: "Sophia" },
          },
        }),
      ],
      comoGerente(TOKEN_SOPHIA),
    );
    expect(todas.get("em-nome-de")!.author).toEqual({
      kind: "equipe",
      id: ANDREIA,
      name: "Andreia Lima",
      detail: "em_nome_de",
      via_token: "Sophia",
    });
  });

  it("os nomes dos tokens são pedidos uma vez por página; página sem token não consulta o cadastro", async () => {
    await historico(CONVERSA_DE_DOIS_AGENTES, comoToken(TOKEN_SOPHIA));
    expect(banco.consultas.api_tokens).toBe(1);
    banco.consultas.api_tokens = 0;
    await historico(CONVERSA_COMPLETA, comoToken(TOKEN_SOPHIA));
    expect(banco.consultas.api_tokens ?? 0).toBe(0);
  });
});

describe("⭐ o id e o nome do token são dado de administração (revisão 20/11, item 2.32)", () => {
  const CONVERSA = [
    porToken("da-sophia", TOKEN_SOPHIA, "Sophia"),
    porToken("do-pedro", TOKEN_PEDRO, "Pedro"),
    msg({
      id: "em-nome-de",
      sent_via: "system",
      sent_on_behalf_of_user_id: ANDREIA,
      metadata: {
        sent_on_behalf: { user_id: ANDREIA, user_name: "Andreia Lima", token_name: "Pedro" },
        sent_by_token: { token_id: TOKEN_PEDRO, token_name: "Pedro" },
      },
    }),
  ];
  const semIdentidade = (m: { author: Record<string, unknown> }) =>
    expect(m.author).toMatchObject({ kind: "agente", id: null, name: null });

  it("token comum, fora do turno: vê o id e o nome só do PRÓPRIO token", async () => {
    const todas = await historico(CONVERSA, comoToken(TOKEN_SOPHIA));
    expect(todas.get("da-sophia")!.author).toEqual({ kind: "agente", id: TOKEN_SOPHIA, name: "Sophia", is_self: true });
    expect(todas.get("do-pedro")!.author).toEqual({ kind: "agente", id: null, name: null, is_self: false });
    expect(todas.get("em-nome-de")!.author).toEqual({
      kind: "equipe",
      id: ANDREIA,
      name: "Andreia Lima",
      detail: "em_nome_de",
      via_token: null,
    });
    const saida = JSON.stringify([...todas.values()]);
    expect(saida).not.toContain("Pedro");
    expect(saida).not.toContain(TOKEN_PEDRO);
  });

  it("gerente e admin, fora do turno: veem o id e o nome de todo token", async () => {
    for (const papel of ["manager", "admin"] as const) {
      const todas = await historico(
        CONVERSA,
        ctx({ apiTokenId: TOKEN_SOPHIA, role: papel, actor: { type: "api_token", id: TOKEN_SOPHIA, role: papel } }),
      );
      expect(todas.get("do-pedro")!.author, papel).toEqual({ kind: "agente", id: TOKEN_PEDRO, name: "Pedro", is_self: false });
      expect(todas.get("em-nome-de")!.author.via_token, papel).toBe("Pedro");
    }
  });

  it("⭐ num turno de atendimento ninguém recebe nome nem id de token, nem o do próprio", async () => {
    mockedConv.mockResolvedValue({ contact_id: CONTATO, channel: "whatsapp" } as never);
    const turnos = [
      // o agente do CRM, que roda como `ai_operator`
      ctx({
        contatoDoTurno: CONTATO,
        role: "ai_operator",
        apiTokenId: "tok-da-rodada",
        actor: { type: "ai_agent", id: EXECUCAO, role: "ai_operator", agent_id: AGENTE },
      }),
      // o token comum com o contato do turno posto
      ctx({ contatoDoTurno: CONTATO, apiTokenId: TOKEN_SOPHIA, actor: { type: "api_token", id: TOKEN_SOPHIA, role: "agent" } }),
      // nem com papel de gerente: no turno o modelo fala com o cliente
      ctx({
        contatoDoTurno: CONTATO,
        apiTokenId: TOKEN_SOPHIA,
        role: "manager",
        actor: { type: "api_token", id: TOKEN_SOPHIA, role: "manager" },
      }),
      // o agente do CRM sem contato do turno: continua sem ver
      ctx({ role: "ai_operator", actor: { type: "ai_agent", id: EXECUCAO, role: "ai_operator", agent_id: AGENTE } }),
    ];
    for (const turno of turnos) {
      const todas = await historico(CONVERSA, turno);
      semIdentidade(todas.get("da-sophia")!);
      semIdentidade(todas.get("do-pedro")!);
      expect(todas.get("em-nome-de")!.author).toMatchObject({ kind: "equipe", name: "Andreia Lima", via_token: null });
      const saida = JSON.stringify([...todas.values()].map((m) => m.author));
      for (const proibido of ["Sophia", "Pedro", TOKEN_SOPHIA, TOKEN_PEDRO]) expect(saida).not.toContain(proibido);
    }
  });

  it("no turno, `is_self` continua dizendo qual fala é a do leitor", async () => {
    mockedConv.mockResolvedValue({ contact_id: CONTATO, channel: "whatsapp" } as never);
    const todas = await historico(
      CONVERSA,
      ctx({ contatoDoTurno: CONTATO, apiTokenId: TOKEN_SOPHIA, actor: { type: "api_token", id: TOKEN_SOPHIA, role: "agent" } }),
    );
    expect(todas.get("da-sophia")!.author.is_self).toBe(true);
    expect(todas.get("do-pedro")!.author.is_self).toBe(false);
  });

  it("no turno o cadastro de tokens nem é consultado", async () => {
    mockedConv.mockResolvedValue({ contact_id: CONTATO, channel: "whatsapp" } as never);
    banco.consultas.api_tokens = 0;
    await historico(CONVERSA, ctx({ contatoDoTurno: CONTATO }));
    expect(banco.consultas.api_tokens ?? 0).toBe(0);
  });

  it("a descrição diz que o id e o nome de outro token são só para gerente", () => {
    expect(crmGetConversationHistory.description).toMatch(/só para gerente/);
  });
});

describe("os casos de borda de cada origem", () => {
  it("celular ligado ao número: é da equipe, mas a linha não diz quem digitou", async () => {
    const m = (await historico(CONVERSA_COMPLETA)).get("do-celular")!;
    expect(m.author).toEqual({ kind: "equipe", id: null, name: null, detail: "celular" });
  });

  it("enviada por um sistema EM NOME de uma pessoa: a autora é a pessoa, e para gerente diz por qual token", async () => {
    const m = (await historico(CONVERSA_COMPLETA, comoGerente("tok"))).get("em-nome-de")!;
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
