import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";

import type * as InboundTurn from "@/lib/agent-engine/agent/inbound-turn";
import type * as Providers from "@/lib/agent-engine/edge/llm/providers";
import type * as ObsLogger from "@/lib/agent-engine/obs/logger";
import type * as Queue from "@/lib/agent-engine/queue/queue";

/**
 * A PASSAGEM ENTRE COLEGAS PELO TURNO INTEIRO, CONTRA POSTGRES DE VERDADE
 * (revisão de 20/11, item 2.12).
 *
 * `passar_para_colega` estava coberta por partes: a decisão e as escritas
 * (`passagem-entre-colegas.test.ts`), o roteador
 * (`resolve-turn-agent-passagem.test.ts`) e a continuação com o colega
 * (`colega-responde-na-mesma-rodada.test.ts`, com o turno dublado). O que
 * nenhuma delas roda é a LIGAÇÃO dentro de `inbound-turn.ts`: a ferramenta
 * registrada no turno de quem passa, o modelo chamando-a, as duas escritas na
 * transação de verdade, o segundo turno no mesmo job e a conversa como fica no
 * banco.
 *
 * Harness de `parada-apos-envio-final.test.ts`: `createInboundTurnHandler` real,
 * canal que CAPTURA, modelo fake roteirizado, relógio fixo dentro da janela e
 * `sleep` no-op. O número tem um roteador com a passagem ligada: o agente de
 * ENTRADA é a reserva do roteador e o de HORÁRIOS é o membro `horarios`. O
 * classificador de intenção é dublado para "não sei" — sem aderência, o
 * roteador cai na reserva (a entrada); com a conversa fixada, fica no fixado.
 *
 * QUEM o modelo está servindo sai do que ele recebe, não de um contador:
 *   - tem a ferramenta `passar_para_colega`  → o turno normal da ENTRADA;
 *   - a abertura diz "Passagem recebida"     → o COLEGA, na mesma rodada;
 *   - a abertura diz "não aconteceu"         → a ENTRADA de volta (desfeita);
 *   - nenhum dos três                        → o colega num turno comum (a
 *     conversa já está fixada nele, e ele não tem colega a quem passar).
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://placeholder.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "placeholder-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "placeholder-service";

// O classificador de verdade sairia para a rede. "Não sei" manda o roteador
// para a reserva quando não há agente fixado, e mantém o fixado quando há.
vi.mock("@/lib/agent-engine/agent/intent-classifier", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  classifyIntent: vi.fn(async () => null),
}));

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 4,
});

const ORG = "c2120000-0000-4000-8000-000000000001";
const CONTACT = "c2120000-0000-4000-8000-000000000002";
const SESSION = "c2120000-0000-4000-8000-000000000003";
const CONV = "c2120000-0000-4000-8000-000000000004";
const ENTRADA = "c2120000-0000-4000-8000-000000000011";
const ENTRADA_V = "c2120000-0000-4000-8000-000000000012";
const HORARIOS = "c2120000-0000-4000-8000-000000000021";
const HORARIOS_V = "c2120000-0000-4000-8000-000000000022";
const ROTEADOR = "c2120000-0000-4000-8000-000000000031";

type Modules = {
  createInboundTurnHandler: typeof InboundTurn.createInboundTurnHandler;
  queue: typeof Queue;
  createLogger: typeof ObsLogger.createLogger;
  createFakeRegistry: typeof Providers.createFakeRegistry;
};
let m: Modules;

const USO = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const CHECKPOINT = JSON.stringify({
  commitments: [],
  objections: [],
  next_action: null,
  rolling_summary: "turno de teste",
});

const texto = (t: string) => ({
  content: [{ type: "text" as const, text: t }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage: USO,
  warnings: [],
});
const chamar = (toolName: string, input: Record<string, unknown>) => ({
  content: [
    { type: "tool-call" as const, toolCallId: `c-${crypto.randomUUID()}`, toolName, input: JSON.stringify(input) },
  ],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage: USO,
  warnings: [],
});
type Resposta = ReturnType<typeof texto> | ReturnType<typeof chamar>;

const PASSAR = chamar("passar_para_colega", {
  papel: "horarios",
  motivo: "a pessoa quer marcar um horário",
  resumo: "Quer um horário na semana que vem. Já disse o nome. Próximo passo: oferecer os horários livres.",
});
const RESPOSTA_DO_COLEGA = "Temos horário na terça às 10h ou na quinta às 15h. Qual prefere?";
const RESPOSTA_DA_ENTRADA = "Consigo ver isso com você por aqui. Qual dia fica melhor?";

type Quem = "entrada" | "colega_na_rodada" | "entrada_de_volta" | "colega_em_turno_comum";
type Roteiro = Partial<Record<Quem, Resposta[]>>;

let enviados: string[] = [];
let chamadas: Record<Quem, number>;
/** O que rodar logo depois de a vez ser passada (o colega "some" aqui). */
let aoPassarAVez: (() => Promise<void>) | null = null;
let depoisDePassar: Promise<void> | null = null;

function quemEstaSendoServido(opts: { tools?: Array<{ name?: string }>; prompt?: unknown }): Quem {
  if ((opts.tools ?? []).some((t) => t.name === "passar_para_colega")) return "entrada";
  const prompt = JSON.stringify(opts.prompt ?? "");
  if (prompt.includes("Passagem recebida de um colega")) return "colega_na_rodada";
  if (prompt.includes("A passagem para o colega não aconteceu")) return "entrada_de_volta";
  return "colega_em_turno_comum";
}

function modelo(roteiro: Roteiro) {
  return async (opts: { tools?: Array<{ name?: string }>; prompt?: unknown }) => {
    // O que foi disparado quando a vez passou termina ANTES de o turno seguir.
    if (depoisDePassar !== null) await depoisDePassar;
    if ((opts.tools ?? []).length === 0) return texto(CHECKPOINT);
    const quem = quemEstaSendoServido(opts);
    chamadas[quem] += 1;
    return roteiro[quem]?.[chamadas[quem] - 1] ?? texto("fim");
  };
}

function deps(roteiro: Roteiro): InboundTurn.InboundTurnDeps {
  const base = m.createLogger();
  return {
    crmCfg: { supabase: {} as never },
    llmCfg: { anthropicApiKey: "fake" } as never,
    knobs: {
      historyLimit: 10,
      maxContextTokens: 1000,
      notesIndexMaxTokens: 500,
      maxSteps: 12,
      queuedRetryDelayMs: 1000,
      breaker: {
        exactFailureWarn: 2,
        exactFailureBlock: 5,
        sameToolFailureWarn: 3,
        sameToolFailureHalt: 8,
        noProgressWarn: 3,
        noProgressBlock: 5,
      },
      followup: { minAheadMs: 60_000, maxAheadMs: 30 * 86_400_000, staggerWindowMs: 0 },
    },
    log: {
      ...base,
      info: (msg, campos) => {
        if (msg.includes("vez passada") && aoPassarAVez !== null && depoisDePassar === null) {
          depoisDePassar = aoPassarAVez();
        }
        base.info(msg, campos);
      },
    },
    registry: m.createFakeRegistry(modelo(roteiro) as never),
    channel: () =>
      ({
        channel: "captura",
        send: async (i: { body: string }) => {
          enviados.push(i.body);
          return { kind: "sent" as const, idempotencyKey: `k${enviados.length}`, messageId: `m${enviados.length}` };
        },
        sessionHealth: async () => ({ healthy: true, status: "WORKING" }),
        capabilities: () => ({ freeform: true, media: true, audio: true }),
        costPerMessage: () => ({ currency: "BRL", cents: 0 }),
      }) as never,
    // Terça, 15h BRT: dentro da janela anti-ban.
    clock: () => new Date("2026-07-28T18:00:00Z"),
    sleep: async () => {},
  };
}

async function mensagemDoCliente(corpo: string): Promise<string> {
  const id = crypto.randomUUID();
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
       type, direction, status, body, sent_via, sent_at)
     values ($1,$2,$3,$4,$5,'text','inbound','delivered',$6,'external_device', now())`,
    [id, ORG, CONV, SESSION, CONTACT, corpo],
  );
  return id;
}

/** Enfileira e reivindica o job de UMA mensagem do cliente. */
async function jobDe(mensagemId: string) {
  await pool.query("update job_queue set status = 'done' where status = 'pending'");
  const { job } = await m.queue.enqueueJob(pool, ORG, {
    kind: "inbound_turn",
    leadId: CONTACT,
    payload: {
      conversation_id: CONV,
      contact_id: CONTACT,
      channel_session_id: SESSION,
      inbound_message_id: mensagemId,
      crm_event_id: crypto.randomUUID(),
    },
    maxAttempts: 1,
  });
  const [claimed] = await m.queue.claimJobs(pool, { workerId: "passagem", maxConcurrency: 1 });
  expect(claimed?.id).toBe(job.id);
  return claimed!;
}

/** Roda UM turno completo para uma mensagem nova; devolve o job. */
async function turno(roteiro: Roteiro, corpo = "bom dia, quero marcar um horário") {
  const claimed = await jobDe(await mensagemDoCliente(corpo));
  await m.createInboundTurnHandler(deps(roteiro))(claimed, pool, { workerId: "passagem" });
  await m.queue.completeJob(pool, claimed.id, "passagem");
  return claimed;
}

async function conversa() {
  const { rows } = await pool.query<{ active_ai_agent_id: string | null; passagem: unknown }>(
    `select active_ai_agent_id, metadata -> 'passagem_entre_colegas' as passagem
       from conversations where organization_id = $1 and id = $2`,
    [ORG, CONV],
  );
  return rows[0]!;
}

async function resumosDoAtendimento(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from lead_notes
      where organization_id = $1 and contact_id = $2 and headline = 'Resumo do atendimento'`,
    [ORG, CONTACT],
  );
  return rows[0]!.n;
}

beforeAll(async () => {
  m = {
    createInboundTurnHandler: (await import("@/lib/agent-engine/agent/inbound-turn")).createInboundTurnHandler,
    queue: await import("@/lib/agent-engine/queue/queue"),
    createLogger: (await import("@/lib/agent-engine/obs/logger")).createLogger,
    createFakeRegistry: (await import("@/lib/agent-engine/edge/llm/providers")).createFakeRegistry,
  };
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1,'passagem-no-turno','Passagem no Turno','Passagem no Turno') on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1,$2,'passagem-no-turno-session','WORKING','\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION, ORG],
  );
  for (const [agente, versao, nome] of [
    [ENTRADA, ENTRADA_V, "Entrada"],
    [HORARIOS, HORARIOS_V, "Horários"],
  ] as const) {
    await pool.query(
      `insert into ai_agents (id, organization_id, name, system_prompt)
       values ($1, $2, $3, 'system') on conflict (id) do nothing`,
      [agente, ORG, nome],
    );
    await pool.query(
      `insert into ai_agent_versions
         (id, organization_id, agent_id, version_number, system_prompt, provider, model, channel_session_id, status)
       values ($1, $2, $3, 1, 'system', 'anthropic', 'claude-sonnet-4-6', $4, 'published')
       on conflict (id) do nothing`,
      [versao, ORG, agente, SESSION],
    );
    await pool.query(`update ai_agents set published_version_id = $1 where id = $2`, [versao, agente]);
  }
  // A entrada é a RESERVA do roteador; o colega é o membro `horarios`. A
  // passagem só existe porque o roteador a liga.
  await pool.query(
    `insert into ai_routers (id, organization_id, name, channel_session_id, is_active, fallback_agent_id, config)
     values ($1, $2, 'Roteador da passagem', $3, true, $4, '{"passagem_entre_colegas": true}')
     on conflict (id) do nothing`,
    [ROTEADOR, ORG, SESSION, ENTRADA],
  );
  await pool.query(
    `insert into ai_router_members (organization_id, router_id, agent_id, intent_name, intent_description, examples, position)
     select $1, $2, $3, 'horarios', 'Marca e remarca horário', '{}', 0
      where not exists (select 1 from ai_router_members where router_id = $2 and agent_id = $3)`,
    [ORG, ROTEADOR, HORARIOS],
  );
  await pool.query(
    `with v as (
       insert into playbook_versions (organization_id, layer, content)
       select null, 'platform', E'## Identidade\\nAssistente de teste.'
       where not exists (select 1 from playbook_pointers where organization_id is null and layer = 'platform')
       returning id)
     insert into playbook_pointers (organization_id, layer, version_id)
     select null, 'platform', id from v`,
  );
});

beforeEach(async () => {
  enviados = [];
  chamadas = { entrada: 0, colega_na_rodada: 0, entrada_de_volta: 0, colega_em_turno_comum: 0 };
  aoPassarAVez = null;
  depoisDePassar = null;
  for (const tabela of [
    "messages",
    "send_ledger",
    "outbound_copies",
    "agent_inbox_items",
    "cron_jobs",
    "job_queue",
    "lead_notes",
    "conversations",
    "contacts",
  ]) {
    await pool.query(`delete from ${tabela} where organization_id = $1`, [ORG]);
  }
  await pool.query(`update ai_agents set paused_at = null where organization_id = $1`, [ORG]);
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number, force_human)
     values ($1,$2,'Cliente da passagem','+5511900000212', false)`,
    [CONTACT, ORG],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1,$2,$3,$4,'ai_handling',false)`,
    [CONV, ORG, CONTACT, SESSION],
  );
});

afterAll(async () => {
  await pool.end();
});

const ROTEIRO_FELIZ: Roteiro = {
  entrada: [PASSAR, texto("fim")],
  colega_na_rodada: [chamar("send_message", { body: RESPOSTA_DO_COLEGA }), texto("fim")],
};

describe("passar_para_colega pelo turno inteiro", () => {
  it("⭐ a entrada passa a vez e o colega responde NO MESMO job: uma resposta, do colega, e a conversa fica com ele", async () => {
    await turno(ROTEIRO_FELIZ);

    expect(chamadas.entrada, "a entrada não chegou a ter a ferramenta de passagem no turno").toBeGreaterThanOrEqual(1);
    expect(chamadas.colega_na_rodada, "o colega não rodou na mesma rodada").toBeGreaterThanOrEqual(1);
    expect(enviados).toEqual([RESPOSTA_DO_COLEGA]);

    const c = await conversa();
    expect(c.active_ai_agent_id).toBe(HORARIOS);
    expect(c.passagem).toMatchObject({
      para_agente: HORARIOS,
      para_intencao: "horarios",
      de_agente: ENTRADA,
      motivo: "a pessoa quer marcar um horário",
    });
    expect(await resumosDoAtendimento()).toBe(1);
  });

  it("depois de passar a vez, a entrada não fala por cima do colega: o envio dela é recusado", async () => {
    await turno({
      entrada: [PASSAR, chamar("send_message", { body: "resposta que não pode sair" }), texto("fim")],
      colega_na_rodada: [chamar("send_message", { body: RESPOSTA_DO_COLEGA }), texto("fim")],
    });

    expect(enviados).toEqual([RESPOSTA_DO_COLEGA]);
  });
});

describe("o colega some entre a passagem e a resposta (revisão 20/11, 2.11)", () => {
  it("⭐ pausado logo depois da passagem: a conversa volta para a entrada, que responde na mesma rodada", async () => {
    aoPassarAVez = async () => {
      await pool.query(`update ai_agents set paused_at = now() where id = $1`, [HORARIOS]);
    };

    await turno({
      entrada: [PASSAR, texto("fim")],
      colega_na_rodada: [chamar("send_message", { body: RESPOSTA_DO_COLEGA }), texto("fim")],
      entrada_de_volta: [chamar("send_message", { body: RESPOSTA_DA_ENTRADA }), texto("fim")],
    });

    expect(chamadas.colega_na_rodada, "o colega pausado respondeu").toBe(0);
    expect(chamadas.entrada_de_volta, "quem passou não rodou de novo — o cliente ficou sem resposta").toBeGreaterThanOrEqual(1);
    expect(enviados).toEqual([RESPOSTA_DA_ENTRADA]);

    const c = await conversa();
    expect(c.active_ai_agent_id, "a conversa ficou presa no agente parado").toBe(ENTRADA);
    expect(c.passagem, "a chave da passagem desfeita ficou na conversa").toBeNull();
  });
});

describe("rajada e replay", () => {
  it("⭐ rajada: duas mensagens pendentes, UM job — uma passagem, um resumo, uma resposta do colega", async () => {
    await mensagemDoCliente("oi");
    await turno(ROTEIRO_FELIZ, "quero marcar um horário para a semana que vem");

    expect(enviados).toEqual([RESPOSTA_DO_COLEGA]);
    expect(await resumosDoAtendimento()).toBe(1);
    expect((await conversa()).active_ai_agent_id).toBe(HORARIOS);
  });

  it("⭐ a mensagem SEGUINTE vai direto para o colega: a entrada não roda de novo nem passa outra vez", async () => {
    await turno(ROTEIRO_FELIZ);
    const entradaAntes = chamadas.entrada;
    enviados = [];

    await turno(
      { colega_em_turno_comum: [chamar("send_message", { body: "Pode ser na quinta às 15h, então." }), texto("fim")] },
      "pode ser na quinta",
    );

    expect(chamadas.entrada, "a entrada rodou de novo numa conversa que já é do colega").toBe(entradaAntes);
    expect(chamadas.colega_em_turno_comum).toBeGreaterThanOrEqual(1);
    expect(enviados).toEqual(["Pode ser na quinta às 15h, então."]);
    expect((await conversa()).active_ai_agent_id).toBe(HORARIOS);
    expect(await resumosDoAtendimento()).toBe(1);
  });

  it("⭐ replay do MESMO job (o worker caiu antes de fechar): não passa a vez de novo e não duplica o resumo", async () => {
    const claimed = await jobDe(await mensagemDoCliente("bom dia, quero marcar um horário"));
    const handler = () =>
      m.createInboundTurnHandler(
        deps({
          ...ROTEIRO_FELIZ,
          // Outro texto: o gate de variação vetaria o mesmo corpo duas vezes.
          colega_em_turno_comum: [chamar("send_message", { body: "Então fica na terça às 10h." }), texto("fim")],
        }),
      )(claimed, pool, { workerId: "passagem" });

    await handler();
    const entradaDepoisDaPrimeira = chamadas.entrada;
    const conversaDepoisDaPrimeira = await conversa();

    // A segunda execução do mesmo job: a conversa já está fixada no colega.
    await handler();
    await m.queue.completeJob(pool, claimed.id, "passagem");

    expect(chamadas.entrada, "o replay rodou a entrada de novo").toBe(entradaDepoisDaPrimeira);
    expect(await resumosDoAtendimento()).toBe(1);
    const c = await conversa();
    expect(c.active_ai_agent_id).toBe(HORARIOS);
    expect(c.passagem).toEqual(conversaDepoisDaPrimeira.passagem);
  });
});
