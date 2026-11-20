/**
 * CONVIVÊNCIA ENTRE PESSOA E IA (superfície de agente, parte 3).
 *
 * O que este arquivo amarra, numa leitura só:
 *
 *  1. uma pessoa assumiu ou respondeu: a IA nativa não responde por cima
 *     (`decidirElegibilidade`, a regra que o drain e o turno leem);
 *  2. a IA só volta sozinha conforme a configuração da EMPRESA: o prazo do
 *     silêncio vence, ou o prazo de devolução da empresa passa. O padrão é não
 *     voltar sozinha depois que alguém assume;
 *  3. o agente EXTERNO fica sabendo: os dois eventos são gatilhos de automação,
 *     têm consumidor, saem pelo webhook com o estado atual da conversa, e a
 *     identidade de quem assumiu só sai com a opção da regra.
 *
 * O gatilho do banco que grava os eventos (migration 9811) é exercitado em
 * `tests/invariants/pausa-da-ia-vira-evento.test.ts`, que precisa de Postgres.
 * Aqui fica o que dá para provar sem banco, inclusive que o apêndice do
 * baseline é o espelho exato da migration.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}), isServiceRoleConfigured: () => false }));

import { decidirElegibilidade, montarEstadoDeElegibilidade } from "@/lib/ai/elegibilidade/gate";
import { detalheDoEvento } from "@/lib/automation/detalhe-do-evento";
import { buildContext } from "@/lib/automation/engine";
import { EVENTO_IA_PAUSADA, EVENTO_IA_RETOMADA } from "@/lib/automation/eventos-de-saida";
import { avaliarDevolucao, lerPrazoDeDevolucaoMinutos, type ConversaEmHandoff } from "@/lib/escalacao/devolucao-automatica";
import { getRegisteredHandlers } from "@/lib/event-log/dispatcher";
import { ensureHandlersRegistered } from "@/lib/event-log/register-handlers";
import {
  atendimentoConfigPatchSchema,
  lerPrazoDoSilencioDaTelaMinutos,
  mesclarSettingsDeAtendimento,
  PRAZO_PADRAO_DO_SILENCIO_DA_TELA_MINUTOS,
  routingConfigSchema,
} from "@/lib/schemas/routing";
import {
  acoesQueFechamLaco,
  createAutomationRuleSchema,
  ENTIDADE_ESPERADA_POR_GATILHO,
  TRIGGER_EVENTS,
} from "@/lib/schemas/webhooks";

const AGORA = new Date("2026-11-20T15:00:00.000Z");
const ORG = "13000000-0000-4000-8000-000000000001";
const CONVERSA = "13000000-0000-4000-8000-000000000002";
const CONTATO = "13000000-0000-4000-8000-000000000003";
const CANAL = "13000000-0000-4000-8000-000000000004";
const ATENDENTE = "13000000-0000-4000-8000-000000000005";

function decidir(conversa: { assigneeKind: string | null; botSilencedUntil: string | null }) {
  return decidirElegibilidade(
    montarEstadoDeElegibilidade({
      aiGate: "open",
      orgStatus: "active",
      forceHuman: false,
      aiOptOut: false,
      assigneeKind: conversa.assigneeKind,
      botSilencedUntil: conversa.botSilencedUntil,
      aiAuthorizedAt: null,
      agora: AGORA,
      ttlMs: 1000,
    }),
  );
}

describe("uma pessoa assumiu ou respondeu: a IA nativa não responde por cima", () => {
  it("assumiu (dono humano): a IA não responde", () => {
    expect(decidir({ assigneeKind: "user", botSilencedUntil: "infinity" })).toMatchObject({ permite: false });
    // Mesmo sem silêncio gravado (conversa distribuída a uma pessoa).
    expect(decidir({ assigneeKind: "user", botSilencedUntil: null })).toMatchObject({
      permite: false,
      motivo: "conversa_de_humano",
    });
  });

  it("pausou sem prazo: a IA não responde, e o passar do tempo não muda isso", () => {
    expect(decidir({ assigneeKind: null, botSilencedUntil: "infinity" })).toMatchObject({
      permite: false,
      motivo: "conversa_silenciada",
    });
  });

  it("respondeu sem assumir: a IA não responde enquanto o prazo da empresa não vence", () => {
    expect(decidir({ assigneeKind: "ai", botSilencedUntil: "2026-11-20T15:04:00.000Z" })).toMatchObject({
      permite: false,
      motivo: "conversa_silenciada",
    });
  });
});

describe("a IA só volta sozinha conforme a configuração da empresa", () => {
  it("o prazo do silêncio venceu: a IA volta a responder", () => {
    expect(decidir({ assigneeKind: "ai", botSilencedUntil: "2026-11-20T14:59:00.000Z" })).toMatchObject({ permite: true });
  });

  it("o prazo da resposta pela tela é da empresa, com o padrão de sempre", () => {
    expect(PRAZO_PADRAO_DO_SILENCIO_DA_TELA_MINUTOS).toBe(5);
    expect(lerPrazoDoSilencioDaTelaMinutos(null)).toBe(5);
    expect(lerPrazoDoSilencioDaTelaMinutos({ routing: {} })).toBe(5);
    expect(lerPrazoDoSilencioDaTelaMinutos({ routing: { screen_reply_silence_minutes: 45 } })).toBe(45);
    // Fora da faixa (5 min a 24 h) ou ilegível: o padrão, nunca um prazo quebrado.
    for (const ruim of [0, 4, 24 * 60 + 1, "45", Number.NaN, null]) {
      expect(lerPrazoDoSilencioDaTelaMinutos({ routing: { screen_reply_silence_minutes: ruim } })).toBe(5);
    }
  });

  const assumida: ConversaEmHandoff = {
    id: CONVERSA,
    organization_id: ORG,
    channel_session_id: CANAL,
    status: "claimed",
    assignee_kind: "user",
    assigned_to_user_id: ATENDENTE,
    assigned_at: "2026-11-20T13:00:00.000Z",
    bot_silenced_until: "infinity",
    last_handoff_at: null,
    last_outbound_at: "2026-11-20T13:30:00.000Z",
    status_changed_at: "2026-11-20T13:00:00.000Z",
  };
  const sessoesComAgente = new Map([[ORG, new Set([CANAL])]]);

  it("PADRÃO: sem prazo de devolução, a conversa assumida nunca volta sozinha", () => {
    expect(routingConfigSchema.parse({}).handoff_return_after_minutes).toBeNull();
    expect(lerPrazoDeDevolucaoMinutos({})).toBeNull();
    expect(
      avaliarDevolucao(assumida, { prazoPorOrg: new Map(), sessoesComAgente, agoraMs: AGORA.getTime() + 30 * 24 * 3_600_000 }),
    ).toEqual({ devolver: false, motivo: "sem_prazo" });
  });

  it("com o prazo da empresa: dentro dele fica com a pessoa; passado, volta para a IA", () => {
    const prazoPorOrg = new Map([[ORG, 120]]);
    // O relógio conta do último sinal da pessoa (a saída das 13h30).
    expect(avaliarDevolucao(assumida, { prazoPorOrg, sessoesComAgente, agoraMs: AGORA.getTime() })).toEqual({
      devolver: false,
      motivo: "dentro_do_prazo",
    });
    const depois = new Date("2026-11-20T15:30:00.000Z").getTime();
    expect(avaliarDevolucao(assumida, { prazoPorOrg, sessoesComAgente, agoraMs: depois })).toEqual({
      devolver: true,
      minutos: 120,
    });
  });

  it("o ajuste entra pela rota de atendimento, e omitido preserva o que valia", () => {
    const atual = { routing: { mode: "manual", screen_reply_silence_minutes: 45 }, ai_entry_filter: { enabled: true, rules: {} } };
    const semMexer = mesclarSettingsDeAtendimento(atual, atendimentoConfigPatchSchema.parse({ mode: "round_robin" }));
    expect(semMexer.routing.screen_reply_silence_minutes).toBe(45);
    expect(semMexer.settings.ai_entry_filter).toEqual({ enabled: true, rules: {} });

    const mexendo = mesclarSettingsDeAtendimento(
      atual,
      atendimentoConfigPatchSchema.parse({
        mode: "manual",
        screen_reply_silence_minutes: null,
        entry_filter: { enabled: true, rules: { spam: { terms: ["exemplo de teste"], tag: "spam" } } },
      }),
    );
    expect(mexendo.routing.screen_reply_silence_minutes).toBeNull();
    expect(mexendo.settings.ai_entry_filter).toEqual({
      enabled: true,
      rules: { spam: { terms: ["exemplo de teste"], match: "contains", action: "silence", reply: null, tag: "spam" } },
    });
    // O filtro mora ao lado de `routing`, não dentro dele.
    expect(mexendo.routing).not.toHaveProperty("entry_filter");
  });
});

/** Admin de mentira: responde por tabela, e guarda os filtros de cada consulta. */
function adminFalso(linhas: Record<string, unknown>) {
  const filtros: Array<{ tabela: string; coluna: string; valor: unknown }> = [];
  const from = (tabela: string) => {
    const cadeia = {
      select: () => cadeia,
      eq: (coluna: string, valor: unknown) => {
        filtros.push({ tabela, coluna, valor });
        return cadeia;
      },
      in: () => cadeia,
      maybeSingle: async () => ({ data: linhas[tabela] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: tabela === "user_organizations" ? [{ user_id: ATENDENTE }] : [], error: null }).then(res),
    };
    return cadeia;
  };
  const admin = {
    from,
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { user_metadata: { full_name: "Ana Atendente" } } }, error: null }),
      },
    },
  };
  return { admin: admin as never, filtros };
}

describe("o agente externo fica sabendo: os dois eventos", () => {
  it("são gatilhos de automação, com a CONVERSA como entidade, no fim da fonte única", () => {
    expect(ENTIDADE_ESPERADA_POR_GATILHO[EVENTO_IA_PAUSADA]).toBe("conversation");
    expect(ENTIDADE_ESPERADA_POR_GATILHO[EVENTO_IA_RETOMADA]).toBe("conversation");
    expect(TRIGGER_EVENTS.slice(-2)).toEqual(["conversation.ai_paused", "conversation.ai_resumed"]);
  });

  it("têm consumidor: o motor de automações assina os dois (evento sem consumidor ficaria pendente para sempre)", () => {
    ensureHandlersRegistered();
    const assinados = new Set(getRegisteredHandlers().flatMap((h) => h.events));
    expect(assinados.has("conversation.ai_paused")).toBe(true);
    expect(assinados.has("conversation.ai_resumed")).toBe(true);
  });

  it("a regra enxerga o contato da conversa, lido da linha com o filtro de organização", async () => {
    const { admin, filtros } = adminFalso({
      conversations: { id: CONVERSA, contact_id: CONTATO },
      contacts: { id: CONTATO, name: "Cliente fictício", tags: ["vip"] },
    });
    const contexto = await buildContext(admin, {
      id: "ev-1",
      organization_id: ORG,
      event_type: "conversation.ai_paused",
      entity_kind: "conversation",
      entity_id: CONVERSA,
      // O payload aponta outro contato de propósito: quem vale é a linha.
      payload: { conversation_id: CONVERSA, contact_id: "outro-contato" },
    } as never);
    expect(contexto.contact).toMatchObject({ id: CONTATO, tags: ["vip"] });
    for (const tabela of ["conversations", "contacts"]) {
      expect(filtros).toContainEqual({ tabela, coluna: "organization_id", valor: ORG });
    }
    expect(filtros).toContainEqual({ tabela: "contacts", coluna: "id", valor: CONTATO });
  });

  const linhaAssumida = {
    id: CONVERSA,
    contact_id: CONTATO,
    channel_session_id: CANAL,
    status: "claimed",
    assigned_to_user_id: ATENDENTE,
    assignee_kind: "user",
    assigned_at: "2026-11-20T14:30:00.000Z",
    bot_silenced_until: "infinity",
    last_handoff_at: null,
    last_handoff_reason: "Automático pausado pelo atendente",
    last_outbound_at: null,
    is_group: false,
    contacts: { force_human: false, ai_opt_out: false, is_blocked: false },
  };
  const evento = { event_type: "conversation.ai_paused", payload: { conversation_id: CONVERSA, contact_id: CONTATO } };

  it("a entrega leva o estado ATUAL da conversa: pausada, por quê e desde quando", async () => {
    const { admin, filtros } = adminFalso({ conversations: linhaAssumida });
    const detalhe = await detalheDoEvento(admin, ORG, evento, { incluirResponsavel: false });
    expect(detalhe).toEqual({
      conversation: {
        id: CONVERSA,
        contact_id: CONTATO,
        channel_session_id: CANAL,
        status: "claimed",
        ai: {
          paused: true,
          human_in_command: true,
          reason: "human_assigned",
          since: "2026-11-20T14:30:00.000Z",
          until: null,
          resumes_automatically: false,
          detail: "Automático pausado pelo atendente",
        },
      },
    });
    expect(filtros).toContainEqual({ tabela: "conversations", coluna: "organization_id", valor: ORG });
  });

  it("quem assumiu é identidade da equipe: só sai com a opção de incluir o responsável", async () => {
    const sem = await detalheDoEvento(adminFalso({ conversations: linhaAssumida }).admin, ORG, evento, { incluirResponsavel: false });
    expect(JSON.stringify(sem)).not.toContain(ATENDENTE);

    const com = await detalheDoEvento(adminFalso({ conversations: linhaAssumida }).admin, ORG, evento, { incluirResponsavel: true });
    expect((com.conversation as { ai: { by: unknown } }).ai.by).toEqual({ id: ATENDENTE, name: "Ana Atendente" });
  });

  it("no ai_resumed a entrega diz que a IA voltou", async () => {
    const devolvida = { ...linhaAssumida, status: "ai_handling", assigned_to_user_id: null, assignee_kind: "ai", bot_silenced_until: null, last_handoff_reason: null };
    const detalhe = await detalheDoEvento(adminFalso({ conversations: devolvida }).admin, ORG, { ...evento, event_type: "conversation.ai_resumed" }, { incluirResponsavel: true });
    expect((detalhe.conversation as { ai: Record<string, unknown> }).ai).toMatchObject({ paused: false, reason: null });
  });

  it("conversa de outra organização ou apagada: a entrega segue sem o detalhe", async () => {
    expect(await detalheDoEvento(adminFalso({}).admin, ORG, evento, { incluirResponsavel: true })).toEqual({});
  });

  it("regra destes gatilhos não pode trocar o dono da conversa (duas regras se realimentariam)", () => {
    for (const gatilho of ["conversation.ai_paused", "conversation.ai_resumed"]) {
      expect(acoesQueFechamLaco(gatilho, [{ type: "assign_owner" }])).toEqual(["assign_owner"]);
      expect(acoesQueFechamLaco(gatilho, [{ type: "define_sector" }])).toEqual(["define_sector"]);
      expect(
        acoesQueFechamLaco(gatilho, [{ type: "ai_decide", config: { opcoes: [{ acao: { type: "assign_owner" } }] } }]),
      ).toEqual(["assign_owner"]);
      expect(acoesQueFechamLaco(gatilho, [{ type: "call_webhook" }, { type: "create_task" }])).toEqual([]);
    }
    // Os gatilhos de negócio seguem com o veto deles, intacto.
    expect(acoesQueFechamLaco("lead.assigned", [{ type: "assign_owner" }])).toEqual(["assign_owner"]);
    expect(acoesQueFechamLaco("lead.assigned", [{ type: "define_sector" }])).toEqual([]);
    expect(acoesQueFechamLaco("message.received", [{ type: "assign_owner" }])).toEqual([]);
  });

  it("a porta da API aceita a regra de webhook e recusa a que trocaria o dono", () => {
    const base = { name: "Avisar o agente de fora", trigger_event: "conversation.ai_paused", conditions: [] };
    expect(
      createAutomationRuleSchema.safeParse({ ...base, actions: [{ type: "call_webhook", config: { url: "https://exemplo.test/hook" } }] }).success,
    ).toBe(true);
    expect(
      createAutomationRuleSchema.safeParse({ ...base, actions: [{ type: "assign_owner", config: { user_id: ATENDENTE } }] }).success,
    ).toBe(false);
  });
});

describe("o gatilho do banco (migration 9811)", () => {
  const raiz = process.cwd();
  const migration = readFileSync(
    join(raiz, "supabase/migrations/20261120150000_9811_ia_pausada_e_retomada_viram_evento.sql"),
    "utf8",
  ).replace(/\r\n/g, "\n");
  const baseline = readFileSync(join(raiz, "supabase/baseline.sql"), "utf8").replace(/\r\n/g, "\n");
  const corpo = migration.slice(migration.indexOf("create or replace function public.fn_anunciar_pausa_da_ia()"));

  it("o apêndice do baseline é o espelho exato da migration (é ele que o self-host aplica)", () => {
    expect(corpo.length).toBeGreaterThan(500);
    expect(baseline.includes(corpo.trimEnd())).toBe(true);
  });

  it("o apêndice cria função, então fica ANTES da varredura que fecha funções novas", () => {
    const funcao = baseline.indexOf("create or replace function public.fn_anunciar_pausa_da_ia()");
    const varredura = baseline.indexOf("-- ---- VARREDURA anon: função nova nasce exposta em quem ATUALIZA");
    expect(funcao).toBeGreaterThan(0);
    expect(funcao).toBeLessThan(varredura);
    // Uma definição só: quem vale no baseline é sempre a última.
    expect(baseline.split("create or replace function public.fn_anunciar_pausa_da_ia()").length - 1).toBe(1);
  });

  it("grava os dois eventos com a entidade que o motor espera", () => {
    expect(corpo).toMatch(/values \(new\.organization_id, 'conversation\.ai_paused', 'conversation', new\.id,/);
    expect(corpo).toMatch(/values \(new\.organization_id, 'conversation\.ai_resumed', 'conversation', new\.id,/);
  });

  it("o payload só leva ids e fatos: nem a identidade de quem atende, nem texto livre", () => {
    const chaves = [...corpo.matchAll(/^\s+'([a-z_]+)', /gm)].map((m) => m[1]);
    expect([...new Set(chaves)].sort()).toEqual(
      ["channel_session_id", "contact_id", "conversation_id", "durable", "human_assigned", "paused_until", "renewed"].sort(),
    );
  });

  it("nunca derruba a escrita da conversa, e não é função exposta", () => {
    expect(corpo).toMatch(/exception when others then/);
    expect(corpo).toMatch(/security definer\s+set search_path = public/);
    expect(corpo).toMatch(
      /revoke execute on function public\.fn_anunciar_pausa_da_ia\(\) from public, anon, authenticated, service_role;/,
    );
  });

  it("a migration está na lista do que o deploy aplica depois do baseline", () => {
    const lista = readFileSync(join(raiz, "deploy/arvisx/crm/migracoes-pos-baseline.txt"), "utf8");
    expect(lista).toContain("20261120150000_9811_ia_pausada_e_retomada_viram_evento.sql");
  });
});
