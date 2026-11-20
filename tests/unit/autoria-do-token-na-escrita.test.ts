/**
 * O QUE O AGENTE EXTERNO FAZ POR TOKEN FICA COM A AUTORIA DELE — o lado da
 * ESCRITA.
 *
 * Um agente de fora fala com o CRM por token de API. Sem o token gravado, a
 * mensagem dele saía igual à de qualquer outra integração, e a mudança de
 * etapa dele entrava na linha do tempo como "sistema". Aqui se mede o que cada
 * escrita passa a gravar:
 *
 *  - a mensagem leva `metadata.sent_by_token` (id e nome do token), pelo
 *    `sendMessageHandler` REAL;
 *  - a linha do tempo leva `payload.autor` (o id do token), por
 *    `buildLeadActivityRow`, o ponto único de quem grava atividade.
 *
 * O lado da leitura está em `mcp-historico-com-autoria.test.ts` (mensagens) e
 * em `mcp-eventos-do-negocio.test.ts` (linha do tempo).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import {
  CHAVE_DO_ENVIO_POR_TOKEN,
  autorExternoDoAtor,
  envioPorTokenDoAtor,
  tokenExternoDoAtor,
} from "@/lib/api/handlers/token-do-ator";
import type { Actor, HandlerCtx } from "@/lib/api/handlers/types";
import { buildLeadActivityRow } from "@/lib/leads/activity-emitter";
import { deriveActor } from "@/lib/mcp/auth";
import type { SendMessageInput } from "@/lib/schemas";
import { criarDubleDoHandler } from "@/tests/helpers/duble-do-handler";

vi.mock("@/lib/users/nome-do-atendente", () => ({
  nomesDosAtendentes: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}), isServiceRoleConfigured: () => false }));

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "99999999-9999-4999-8999-999999999999";
const CONV = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";
const TOKEN = "aaaaaaaa-0000-4000-8000-0000000000f1";
const TOKEN_EFEMERO = "aaaaaaaa-0000-4000-8000-0000000000f9";
const AGENTE = "aaaaaaaa-0000-4000-8000-0000000000a9";
const EXECUCAO = "aaaaaaaa-0000-4000-8000-0000000000e7";
const NEGOCIO = "aaaaaaaa-0000-4000-8000-0000000000d1";

const ATOR_TOKEN: Actor = { type: "api_token", id: TOKEN, role: "agent" };
/** O token com o escopo `actor:ai_agent`: o agente externo que se declara agente. */
const ATOR_TOKEN_DE_AGENTE: Actor = { type: "ai_agent", id: EXECUCAO, role: "agent", api_token_id: TOKEN };
/** O agente do CRM num turno: tem `agent_id`, e o token dele é o efêmero da rodada. */
const ATOR_NATIVO: Actor = { type: "ai_agent", id: EXECUCAO, role: "agent", api_token_id: TOKEN_EFEMERO, agent_id: AGENTE };
const ATOR_DO_MOTOR: Actor = { type: "ai_agent", id: "agent-engine", role: "agent" };
const ATOR_PESSOA: Actor = { type: "user", id: USER };
const ATOR_REGRA: Actor = { type: "webhook_source", id: "regra-1" };

describe("qual token agiu", () => {
  it("o token sem escopo de agente: é o id do ator", () => {
    expect(tokenExternoDoAtor(ATOR_TOKEN)).toBe(TOKEN);
  });

  it("o token com escopo de agente: é o `api_token_id`, não o id da execução", () => {
    expect(tokenExternoDoAtor(ATOR_TOKEN_DE_AGENTE)).toBe(TOKEN);
  });

  it("⭐ o agente do CRM não é um token: o efêmero da rodada não identifica ninguém", () => {
    expect(tokenExternoDoAtor(ATOR_NATIVO)).toBeNull();
    expect(tokenExternoDoAtor(ATOR_DO_MOTOR)).toBeNull();
  });

  it("pessoa e regra de automação não são token", () => {
    expect(tokenExternoDoAtor(ATOR_PESSOA)).toBeNull();
    expect(tokenExternoDoAtor(ATOR_REGRA)).toBeNull();
  });

  it("os dois atores que o MCP deriva de um token externo são reconhecidos", () => {
    expect(tokenExternoDoAtor(deriveActor(["mcp:write"], TOKEN))).toBe(TOKEN);
    expect(tokenExternoDoAtor(deriveActor(["mcp:write", "actor:ai_agent"], TOKEN))).toBe(TOKEN);
    expect(tokenExternoDoAtor(deriveActor(["mcp:write", "actor:ai_agent", `agent_run:${EXECUCAO}`], TOKEN))).toBe(TOKEN);
  });
});

describe("⭐ a linha do tempo: toda atividade que nasce de um token leva o token", () => {
  const linha = (actor: Actor, payload?: Record<string, unknown>) =>
    buildLeadActivityRow({
      organizationId: ORG,
      leadId: NEGOCIO,
      type: "stage_changed",
      sourceModule: "crm",
      actor,
      reason: "Movido de Novo para Proposta",
      ...(payload ? { payload } : {}),
    });

  it("token: `payload.autor` com o id, e o resto do payload intacto", () => {
    const r = linha(ATOR_TOKEN, { from_stage_id: "s1", to_stage_id: "s2" });
    expect(r.payload).toEqual({ from_stage_id: "s1", to_stage_id: "s2", autor: { tipo: "token", id: TOKEN } });
  });

  it("token com escopo de agente: o mesmo", () => {
    expect(linha(ATOR_TOKEN_DE_AGENTE).payload).toEqual({ autor: { tipo: "token", id: TOKEN } });
  });

  it("as colunas de ator não mudam: a tela continua lendo `system`, sem pessoa e sem agente", () => {
    for (const ator of [ATOR_TOKEN, ATOR_TOKEN_DE_AGENTE]) {
      expect(linha(ator)).toMatchObject({ actor_kind: "system", actor_agent_id: null, performed_by_user_id: null });
    }
  });

  it("só o id: nada do token além dele vai para a linha", () => {
    expect(Object.keys(linha(ATOR_TOKEN).payload.autor as object).sort()).toEqual(["id", "tipo"]);
  });

  it("⭐ agente do CRM, pessoa e regra: a linha sai como antes, sem `autor`", () => {
    expect(linha(ATOR_NATIVO, { a: 1 }).payload).toEqual({ a: 1 });
    expect(linha(ATOR_NATIVO)).toMatchObject({ actor_agent_id: AGENTE });
    expect(linha(ATOR_DO_MOTOR).payload).toEqual({});
    expect(linha(ATOR_PESSOA).payload).toEqual({});
    expect(linha(ATOR_PESSOA)).toMatchObject({ actor_kind: "user", performed_by_user_id: USER });
    expect(linha(ATOR_REGRA).payload).toEqual({});
  });

  it("a nota, que já manda o autor com nome, não é sobrescrita", () => {
    const autor = { tipo: "token", id: TOKEN, nome: "Sophia" };
    expect(linha(ATOR_TOKEN, { texto: "oi", autor }).payload).toEqual({ texto: "oi", autor });
  });

  it("não altera o payload de quem chamou", () => {
    const payload = { a: 1 };
    linha(ATOR_TOKEN, payload);
    expect(payload).toEqual({ a: 1 });
    expect(autorExternoDoAtor(ATOR_TOKEN)).toEqual({ tipo: "token", id: TOKEN });
  });
});

const conversa = {
  id: CONV,
  organization_id: ORG,
  contact_id: CONTACT,
  channel_session_id: SESSION,
  is_group: false,
  group_chat_id: null,
  bot_silenced_until: null,
  provider_conversation_id: "6a76a2dc4b8fe115e5f6c300",
  last_inbound_at: new Date().toISOString(),
  contacts: { phone_number: "+595991733685", wa_identity: null, wa_lid: null, is_blocked: false, is_personal: false },
  channel_sessions: {
    provider: "zernio",
    waha_session_name: null,
    meta_phone_number_id: null,
    zernio_account_id: "6a3572a15f7d1751ab117832",
    status: "WORKING",
    archived_at: null,
  },
};

const TOKENS = [
  { id: TOKEN, organization_id: ORG, name: "  Sophia  ", token_hash: "hash-que-nunca-sai" },
  { id: TOKEN_EFEMERO, organization_id: ORG, name: "run efêmero" },
];

/** Envia pelo handler real e devolve o `metadata` da linha que ele inseriu. */
async function metadataGravado(
  actor: Actor,
  metadata?: Record<string, unknown>,
  tokensDeApi: Array<Record<string, unknown>> = TOKENS,
): Promise<Record<string, unknown>> {
  vi.stubEnv("ZERNIO_ACCOUNT_ID", "6a3572a15f7d1751ab117832");
  vi.stubEnv("ZERNIO_API_KEY", "sk_env");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { messageId: "wamid.OK" } }) })),
  );
  const { supabase, capturas } = criarDubleDoHandler({
    conversation: conversa,
    organizacao: { settings: {}, status: "active" },
    tokensDeApi,
    agente: { id: AGENTE, name: "Clara" },
  });
  const ctx: HandlerCtx = { organization_id: ORG, actor, requestId: "req-1" };
  try {
    await sendMessageHandler(supabase, ctx, {
      conversation_id: CONV,
      type: "text",
      body: "oi",
      ...(metadata ? { metadata } : {}),
    } as SendMessageInput);
  } catch {
    // O que se mede é a linha inserida; a entrega ao canal tem os próprios testes.
  }
  const linha = capturas.inserts.messages!.at(-1);
  expect(linha, "o envio tem de chegar ao INSERT").toBeDefined();
  return linha!["metadata"] as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("⭐ a mensagem: o envio por token grava qual token enviou", () => {
  it("token: id e nome do cadastro, e nada além disso", async () => {
    const m = await metadataGravado(ATOR_TOKEN);
    expect(m[CHAVE_DO_ENVIO_POR_TOKEN]).toEqual({ token_id: TOKEN, token_name: "Sophia" });
    expect(JSON.stringify(m)).not.toContain("hash-que-nunca-sai");
  });

  it("token com escopo de agente: o token, não o id da execução", async () => {
    const m = await metadataGravado(ATOR_TOKEN_DE_AGENTE);
    expect(m[CHAVE_DO_ENVIO_POR_TOKEN]).toEqual({ token_id: TOKEN, token_name: "Sophia" });
  });

  it("⭐ agente do CRM: nada muda, e o token efêmero da rodada não vai para a linha", async () => {
    const m = await metadataGravado(ATOR_NATIVO);
    expect(m).not.toHaveProperty(CHAVE_DO_ENVIO_POR_TOKEN);
    expect(m).toMatchObject({ ai_actor_id: EXECUCAO, ai_actor_name: "Clara" });
    expect(JSON.stringify(m)).not.toContain(TOKEN_EFEMERO);
  });

  it("pessoa da equipe e regra de automação: sem token na linha", async () => {
    expect(await metadataGravado(ATOR_PESSOA)).not.toHaveProperty(CHAVE_DO_ENVIO_POR_TOKEN);
    expect(await metadataGravado(ATOR_REGRA)).not.toHaveProperty(CHAVE_DO_ENVIO_POR_TOKEN);
  });

  it("⭐ o chamador não forja o token pelo `metadata` da requisição", async () => {
    const forjado = { [CHAVE_DO_ENVIO_POR_TOKEN]: { token_id: "outro", token_name: "Forjado" }, campanha: "x" };
    const daPessoa = await metadataGravado(ATOR_PESSOA, forjado);
    expect(daPessoa).not.toHaveProperty(CHAVE_DO_ENVIO_POR_TOKEN);
    expect(daPessoa, "o metadata legítimo continua").toHaveProperty("campanha", "x");

    const doToken = await metadataGravado(ATOR_TOKEN, forjado);
    expect(doToken[CHAVE_DO_ENVIO_POR_TOKEN]).toEqual({ token_id: TOKEN, token_name: "Sophia" });
  });

  it("⭐ o nome é lido com a organização: token de outra organização não empresta o nome", async () => {
    const m = await metadataGravado(ATOR_TOKEN, undefined, [
      { id: TOKEN, organization_id: OUTRA_ORG, name: "Nome da outra empresa" },
    ]);
    expect(m[CHAVE_DO_ENVIO_POR_TOKEN]).toEqual({ token_id: TOKEN, token_name: null });
  });

  it("a leitura do nome falhou: o envio segue, com o id", async () => {
    const quebrado = {
      from: () => {
        throw new Error("banco fora do ar");
      },
    };
    expect(await envioPorTokenDoAtor(quebrado as never, ORG, ATOR_TOKEN)).toEqual({ token_id: TOKEN, token_name: null });
    expect(await envioPorTokenDoAtor(quebrado as never, ORG, ATOR_PESSOA)).toBeNull();
  });
});
