/**
 * A LINHA DO TEMPO POR MCP — `crm_list_lead_events`, contra o handler real e
 * `lib/leads/eventos-do-negocio.ts`.
 *
 * O banco é o de `tests/helpers/banco-em-memoria.ts`: duas organizações nas
 * mesmas tabelas, filtros aplicados de verdade. As duas fontes (a linha do
 * tempo do card e a fila de eventos) estão povoadas com instantes
 * intercalados, para a ordem e o cursor serem medidos na junção.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type BancoEmMemoria, type Linha } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  nomes: new Map<string, string | null>(),
  pedidos: [] as Array<{ org: string; ids: string[] }>,
}));
vi.mock("@/lib/users/nome-do-atendente", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  nomesDosAtendentesCom: vi.fn(async (_admin: unknown, org: string, ids: Array<string | null | undefined>) => {
    const limpos = ids.filter((id): id is string => Boolean(id));
    h.pedidos.push({ org, ids: limpos });
    return new Map(limpos.map((id) => [id, h.nomes.get(id) ?? null]));
  }),
}));

const { crmListLeadEvents } = await import("@/lib/mcp/tools/eventos-do-negocio");
const { AUTORES_DE_EVENTO, JANELA_MAXIMA_DO_FUNIL_DIAS, RODADAS_POR_CHAMADA, tiposDeAtividadeDasCategorias, TIPOS_DE_EVENTO } =
  await import("@/lib/leads/eventos-do-negocio");
const { ACTIVITY_LABELS } = await import("@/lib/leads/activity-vocabulary");
const { allTools, getToolByName } = await import("@/lib/mcp/tools");
const { catalogEntry, TOOL_CATALOG } = await import("@/lib/mcp/tools/catalog");
const { IDS_DO_HARNESS } = await import("@/lib/mcp/tools/ferramentas-do-harness");
const { PACOTES } = await import("@/lib/mcp/tools/pacotes");
const { TETO_TOOLS_POR_AGENTE, ligarPacote, vagasExigidasPeloPacote } = await import(
  "@/lib/mcp/tools/selecao-por-pacote"
);
const { PACOTE_PADRAO_DO_ONBOARDING } = await import("@/lib/ai/agents/capacidades-padrao");
import type { Actor } from "@/lib/api/handlers/types";
import { buildLeadActivityRow } from "@/lib/leads/activity-emitter";
import type { McpContext } from "@/lib/mcp/types";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const TOKEN = "aaaaaaaa-0000-4000-8000-0000000000f1";
const TOKEN_B = "bbbbbbbb-0000-4000-8000-0000000000f1";
const AGENTE = "aaaaaaaa-0000-4000-8000-0000000000a9";
const PESSOA = "aaaaaaaa-0000-4000-8000-0000000000b1";
const OUTRA_PESSOA = "aaaaaaaa-0000-4000-8000-0000000000b2";
const CONTATO_1 = "aaaaaaaa-0000-4000-8000-0000000000c1";
const CONTATO_2 = "aaaaaaaa-0000-4000-8000-0000000000c2";
const CONTATO_PESSOAL = "aaaaaaaa-0000-4000-8000-0000000000c3";
const CONTATO_B = "bbbbbbbb-0000-4000-8000-0000000000c1";
const FUNIL = "aaaaaaaa-0000-4000-8000-000000000011";
const OUTRO_FUNIL = "aaaaaaaa-0000-4000-8000-000000000012";
const FUNIL_B = "bbbbbbbb-0000-4000-8000-000000000011";
const NEGOCIO_1 = "aaaaaaaa-0000-4000-8000-0000000000d1";
const NEGOCIO_2 = "aaaaaaaa-0000-4000-8000-0000000000d2";
const NEGOCIO_DE_OUTRO_FUNIL = "aaaaaaaa-0000-4000-8000-0000000000d3";
const NEGOCIO_PESSOAL = "aaaaaaaa-0000-4000-8000-0000000000d4";
const NEGOCIO_B = "bbbbbbbb-0000-4000-8000-0000000000d1";
const TAREFA = "aaaaaaaa-0000-4000-8000-0000000000e9";

/** 17 mil caracteres: a nota tem de voltar inteira. */
const NOTA_LONGA = "Linha de contexto do atendimento. ".repeat(500).trim();

const dia = (hhmm: string) => `2026-11-10T${hhmm}:00.000Z`;

let banco: BancoEmMemoria;
let n = 0;
const id = (prefixo: string) => `${prefixo}-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function atividade(extra: Linha): Linha {
  return {
    id: id("a1a1a1a1"),
    organization_id: ORG_A,
    lead_id: NEGOCIO_1,
    contact_id: CONTATO_1,
    source_module: "crm",
    source_id: null,
    actor_kind: "system",
    actor_agent_id: null,
    performed_by_user_id: null,
    reason: "",
    payload: {},
    ...extra,
  };
}

function evento(extra: Linha): Linha {
  return {
    id: id("e1e1e1e1"),
    organization_id: ORG_A,
    entity_kind: "crm_lead",
    entity_id: NEGOCIO_1,
    payload: {},
    metadata: {},
    ...extra,
  };
}

function ctx(extra: Partial<McpContext> = {}): McpContext {
  return {
    organizationId: ORG_A,
    role: "agent",
    actor: { type: "api_token", id: TOKEN, role: "agent" },
    apiTokenId: TOKEN,
    requestId: "req-1",
    supabase: banco.cliente as never,
    ...extra,
  };
}

beforeEach(() => {
  n = 0;
  h.pedidos.length = 0;
  h.nomes.clear();
  h.nomes.set(PESSOA, "Andreia Lima");
  h.nomes.set(OUTRA_PESSOA, "Bruno Reis");

  banco = bancoEmMemoria({
    api_tokens: [
      { id: TOKEN, organization_id: ORG_A, name: "Sophia" },
      { id: TOKEN_B, organization_id: ORG_B, name: "Agente da outra empresa" },
    ],
    ai_agents: [{ id: AGENTE, organization_id: ORG_A, name: "Recuperador de vendas" }],
    contacts: [
      { id: CONTATO_1, organization_id: ORG_A, is_personal: false },
      { id: CONTATO_2, organization_id: ORG_A, is_personal: false },
      { id: CONTATO_PESSOAL, organization_id: ORG_A, is_personal: true },
      { id: CONTATO_B, organization_id: ORG_B, is_personal: false },
    ],
    crm_pipelines: [
      { id: FUNIL, organization_id: ORG_A, name: "Comercial" },
      { id: OUTRO_FUNIL, organization_id: ORG_A, name: "Suporte" },
      { id: FUNIL_B, organization_id: ORG_B, name: "Da outra empresa" },
    ],
    crm_leads: [
      { id: NEGOCIO_1, organization_id: ORG_A, contact_id: CONTATO_1, pipeline_id: FUNIL, title: "Negócio 1" },
      { id: NEGOCIO_2, organization_id: ORG_A, contact_id: CONTATO_2, pipeline_id: FUNIL, title: "Negócio 2" },
      { id: NEGOCIO_DE_OUTRO_FUNIL, organization_id: ORG_A, contact_id: CONTATO_2, pipeline_id: OUTRO_FUNIL, title: "De outro funil" },
      { id: NEGOCIO_PESSOAL, organization_id: ORG_A, contact_id: CONTATO_PESSOAL, pipeline_id: FUNIL, title: "Pessoal" },
      // Estado impossível de propósito: o negócio da OUTRA empresa com o id do
      // funil desta. Só o filtro de organização o mantém fora.
      { id: NEGOCIO_B, organization_id: ORG_B, contact_id: CONTATO_B, pipeline_id: FUNIL, title: "Da empresa B" },
    ],
    crm_lead_activities: [
      atividade({
        type: "stage_changed",
        actor_kind: "user",
        performed_by_user_id: PESSOA,
        reason: "Movido de Novo para Proposta",
        payload: { from_stage_id: "s1", to_stage_id: "s2", pipeline_id: FUNIL },
        performed_at: dia("10:00"),
      }),
      atividade({
        type: "note",
        source_module: "notas",
        reason: `Sophia: ${NOTA_LONGA}`,
        payload: { texto: NOTA_LONGA, autor: { tipo: "token", id: TOKEN, nome: "Sophia" }, destinatario: "financeiro" },
        performed_at: dia("10:05"),
      }),
      atividade({
        type: "lead_edited",
        // Agente nativo sem lastro: a linha entra como sistema e guarda o agente.
        actor_agent_id: AGENTE,
        reason: "Alterou o valor e as tags",
        payload: { fields: ["value_cents", "tags"] },
        performed_at: dia("10:10"),
      }),
      atividade({
        type: "task_created",
        source_module: "tarefas",
        source_id: TAREFA,
        actor_kind: "user",
        performed_by_user_id: OUTRA_PESSOA,
        reason: "Ligar de volta na terça",
        payload: { due_date: "2026-11-17T12:00:00.000Z", priority: "high" },
        performed_at: dia("10:15"),
      }),
      atividade({
        type: "consent_declined",
        actor_kind: "contact",
        reason: "Recusou contato no formulário",
        performed_at: dia("10:20"),
      }),
      atividade({
        type: "appointment_scheduled",
        actor_kind: "rule",
        reason: "Agendamento marcado para 12/11",
        performed_at: dia("10:25"),
      }),
      atividade({
        lead_id: NEGOCIO_2,
        contact_id: CONTATO_2,
        type: "stage_changed",
        actor_kind: "user",
        performed_by_user_id: PESSOA,
        reason: "Movido de Proposta para Fechamento",
        performed_at: dia("10:30"),
      }),
      atividade({
        lead_id: NEGOCIO_DE_OUTRO_FUNIL,
        contact_id: CONTATO_2,
        type: "stage_changed",
        reason: "movimento de outro funil",
        performed_at: dia("10:35"),
      }),
      atividade({
        lead_id: NEGOCIO_PESSOAL,
        contact_id: CONTATO_PESSOAL,
        type: "note",
        reason: "nota de contato pessoal",
        payload: { texto: "nota de contato pessoal" },
        performed_at: dia("10:40"),
      }),
      atividade({
        organization_id: ORG_B,
        lead_id: NEGOCIO_B,
        contact_id: CONTATO_B,
        type: "note",
        reason: "segredo da empresa B",
        payload: { texto: "segredo da empresa B" },
        performed_at: dia("10:02"),
      }),
    ],
    event_log: [
      evento({
        event_type: "lead.tag_added",
        payload: { added_tags: ["vip"], tags: ["vip"] },
        metadata: { actor_type: "api_token", actor_id: TOKEN, via: "mcp" },
        created_at: dia("10:07"),
      }),
      evento({
        event_type: "lead.tag_removed",
        payload: { lead_id: NEGOCIO_1, removed_tags: ["frio"], tags: ["vip"] },
        metadata: { actor_type: "user" },
        created_at: dia("10:12"),
      }),
      // O gatilho do banco grava `lead` como entidade e não leva quem trocou.
      evento({
        entity_kind: "lead",
        event_type: "lead.assigned",
        payload: { lead_id: NEGOCIO_1, from_user_id: null, to_user_id: PESSOA, from_agent_id: AGENTE, to_agent_id: null },
        created_at: dia("10:17"),
      }),
      // Evento de outro tipo no mesmo negócio: não é da linha do tempo.
      evento({ event_type: "lead.stage_changed", payload: { lead_id: NEGOCIO_1 }, created_at: dia("10:01") }),
      evento({
        entity_id: NEGOCIO_2,
        event_type: "lead.tag_added",
        payload: { added_tags: ["quente"] },
        metadata: { actor_type: "webhook_source", actor_id: "regra-1" },
        created_at: dia("10:32"),
      }),
      evento({
        organization_id: ORG_B,
        entity_id: NEGOCIO_B,
        event_type: "lead.tag_added",
        payload: { added_tags: ["tag-da-empresa-b"] },
        metadata: { actor_type: "api_token", actor_id: TOKEN_B },
        created_at: dia("10:03"),
      }),
    ],
  });
});

type Resposta = Record<string, unknown>;
interface Evento {
  id: string;
  source: string;
  kind: string;
  type: string;
  label: string;
  happened_at: string;
  lead_id: string;
  lead_title?: string | null;
  text: string;
  author: { kind: string; id: string | null; name: string | null; is_self?: boolean };
  details?: Record<string, unknown>;
}

const listar = (args: Record<string, unknown>, c = ctx()) =>
  crmListLeadEvents.handler({ limit: 50, ...args } as never, c) as Promise<Resposta>;
const eventos = (r: Resposta) => r.events as Evento[];
const tipos = (r: Resposta) => eventos(r).map((e) => e.type);

/** Lê todas as páginas, conferindo que o cursor anda e nada se repete. */
async function todasAsPaginas(args: Record<string, unknown>, c = ctx()) {
  const todos: Evento[] = [];
  const paginas: number[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 40; i++) {
    const r = await listar({ ...args, ...(cursor ? { cursor } : {}) }, c);
    expect(r.permitido, JSON.stringify(r)).toBeUndefined();
    todos.push(...eventos(r));
    paginas.push(eventos(r).length);
    if (!r.has_more) {
      expect(r.cursor).toBeNull();
      return { todos, paginas };
    }
    expect(typeof r.cursor).toBe("string");
    expect(r.cursor).not.toBe(cursor);
    cursor = r.cursor as string;
  }
  throw new Error("a paginação não terminou");
}

const ORDEM_DO_NEGOCIO_1 = [
  "stage_changed",
  "note",
  "lead.tag_added",
  "lead_edited",
  "lead.tag_removed",
  "task_created",
  "lead.assigned",
  "consent_declined",
  "appointment_scheduled",
];

describe("um negócio: as duas fontes numa ordem só", () => {
  it("⭐ junta a linha do tempo e a fila de eventos em ordem cronológica", async () => {
    const r = await listar({ lead_id: NEGOCIO_1 });

    expect(r.lead_id).toBe(NEGOCIO_1);
    expect(tipos(r)).toEqual(ORDEM_DO_NEGOCIO_1);
    expect(eventos(r).map((e) => e.kind)).toEqual([
      "etapa",
      "nota",
      "tag",
      "campo",
      "tag",
      "tarefa",
      "responsavel",
      "outro",
      "outro",
    ]);
    expect(eventos(r).map((e) => e.source)).toEqual([
      "timeline",
      "timeline",
      "event_log",
      "timeline",
      "event_log",
      "timeline",
      "event_log",
      "timeline",
      "timeline",
    ]);
    expect(r.has_more).toBe(false);
    expect(r.cursor).toBeNull();
  });

  it("⭐ texto longo volta INTEIRO, sem corte, e sem o nome do autor na frente", async () => {
    const nota = eventos(await listar({ lead_id: NEGOCIO_1, type: ["nota"] }))[0]!;

    expect(nota.text).toBe(NOTA_LONGA);
    expect(nota.text.length).toBeGreaterThan(16_000);
    expect(nota.details).toEqual({ recipient: "financeiro" });
  });

  it("cada categoria leva o detalhe que a fonte guarda", async () => {
    const porTipo = new Map(eventos(await listar({ lead_id: NEGOCIO_1 })).map((e) => [e.type, e]));

    expect(porTipo.get("stage_changed")).toMatchObject({
      label: "Mudou de estágio",
      text: "Movido de Novo para Proposta",
      details: { from_stage_id: "s1", to_stage_id: "s2", pipeline_id: FUNIL },
    });
    // Campo: os NOMES, nunca o valor anterior.
    expect(porTipo.get("lead_edited")!.details).toEqual({ fields: ["value_cents", "tags"] });
    expect(porTipo.get("task_created")).toMatchObject({
      text: "Ligar de volta na terça",
      details: { task_id: TAREFA, due_date: "2026-11-17T12:00:00.000Z", priority: "high" },
    });
    expect(porTipo.get("lead.tag_added")).toMatchObject({ text: "Tag adicionada: vip", details: { added_tags: ["vip"] } });
    expect(porTipo.get("lead.tag_removed")).toMatchObject({
      text: "Tag removida: frio",
      details: { removed_tags: ["frio"] },
    });
  });

  it("evento de outro tipo no mesmo negócio não entra, nem mensagem", async () => {
    const r = await listar({ lead_id: NEGOCIO_1 });
    expect(tipos(r)).not.toContain("lead.stage_changed");
    expect(TIPOS_DE_EVENTO).not.toContain("mensagem");
  });
});

describe("⭐ quem fez: as origens que cada fonte guarda", () => {
  it("pessoa com nome, agente nativo, agente por token, cliente, sistema e o que a fonte não registra", async () => {
    const porTipo = new Map(eventos(await listar({ lead_id: NEGOCIO_1 })).map((e) => [e.type, e.author]));

    expect(porTipo.get("stage_changed")).toEqual({ kind: "pessoa", id: PESSOA, name: "Andreia Lima" });
    expect(porTipo.get("task_created")).toEqual({ kind: "pessoa", id: OUTRA_PESSOA, name: "Bruno Reis" });
    // nota assinada por token: o autor vem do payload da nota
    expect(porTipo.get("note")).toEqual({ kind: "agente", id: TOKEN, name: "Sophia", is_self: true });
    // agente nativo: o nome vem do cadastro do agente (e quem lê é o token, não ele)
    expect(porTipo.get("lead_edited")).toEqual({
      kind: "agente",
      id: AGENTE,
      name: "Recuperador de vendas",
      is_self: false,
    });
    // evento emitido por token: o nome vem do cadastro do token
    expect(porTipo.get("lead.tag_added")).toEqual({ kind: "agente", id: TOKEN, name: "Sophia", is_self: true });
    // a fila de eventos sabe que foi uma pessoa, mas não qual
    expect(porTipo.get("lead.tag_removed")).toEqual({ kind: "pessoa", id: null, name: null });
    expect(porTipo.get("consent_declined")).toEqual({ kind: "cliente", id: null, name: null });
    expect(porTipo.get("appointment_scheduled")).toEqual({ kind: "sistema", id: null, name: null });
    // troca de responsável nasce de gatilho do banco: sem autor
    expect(porTipo.get("lead.assigned")).toEqual({ kind: "nao_registrado", id: null, name: null });
  });

  it("a troca de responsável diz de quem para quem, só pelo NOME", async () => {
    const troca = eventos(await listar({ lead_id: NEGOCIO_1, type: ["responsavel"] }))[0]!;

    expect(troca.text).toBe("Responsável: Recuperador de vendas → Andreia Lima");
    expect(troca.details).toMatchObject({
      to_user_id: PESSOA,
      from_agent_id: AGENTE,
      from_name: "Recuperador de vendas",
      to_name: "Andreia Lima",
    });
    const cru = JSON.stringify(troca);
    expect(cru).not.toMatch(/@|phone|email/i);
  });

  it("o nome da pessoa é pedido com a organização do token", async () => {
    await listar({ lead_id: NEGOCIO_1 });
    expect(h.pedidos.length).toBeGreaterThan(0);
    for (const pedido of h.pedidos) expect(pedido.org).toBe(ORG_A);
  });

  it("nome que o cadastro não tem sai nulo, e a leitura não cai", async () => {
    h.nomes.clear();
    banco.tabelas.ai_agents = [];
    const porTipo = new Map(eventos(await listar({ lead_id: NEGOCIO_1 })).map((e) => [e.type, e]));

    expect(porTipo.get("stage_changed")!.author).toEqual({ kind: "pessoa", id: PESSOA, name: null });
    expect(porTipo.get("lead_edited")!.author).toEqual({ kind: "agente", id: AGENTE, name: null, is_self: false });
    expect(porTipo.get("lead.assigned")!.text).toBe("Responsável: sem nome → sem nome");
  });
});

describe("⭐ a ação feita por token sai com o agente externo como autor", () => {
  const OUTRO_TOKEN = "aaaaaaaa-0000-4000-8000-0000000000f2";
  const EXECUCAO = "aaaaaaaa-0000-4000-8000-0000000000e7";
  const ATOR_TOKEN = { type: "api_token", id: TOKEN, role: "agent" } as const;
  const comoToken = (token: string) =>
    ctx({ apiTokenId: token, actor: { type: "api_token", id: token, role: "agent" } });
  /** Token "tratado como gerente": vê o id e o nome de todo token (item 2.32). */
  const comoGerente = (token: string) =>
    ctx({ apiTokenId: token, role: "manager", actor: { type: "api_token", id: token, role: "manager" } });

  /** A linha exatamente como `buildLeadActivityRow` a grava para o ator dado. */
  function gravada(actor: Actor, type: "stage_changed" | "lead_edited" | "task_created", hhmm: string, payload = {}) {
    return atividade({
      ...buildLeadActivityRow({
        organizationId: ORG_A,
        leadId: NEGOCIO_1,
        contactId: CONTATO_1,
        type,
        sourceModule: "crm",
        actor,
        reason: "feito por quem chamou",
        payload,
      }),
      performed_at: dia(hhmm),
    });
  }

  beforeEach(() => {
    (banco.tabelas.api_tokens as Linha[]).push({ id: OUTRO_TOKEN, organization_id: ORG_A, name: "Pedro" });
    banco.tabelas.crm_lead_activities = [
      gravada(ATOR_TOKEN, "stage_changed", "11:00", { from_stage_id: "s2", to_stage_id: "s3", pipeline_id: FUNIL }),
      gravada(ATOR_TOKEN, "lead_edited", "11:05", { fields: ["owner_user_id", "value_cents"] }),
      // o token com escopo de agente: o `id` do ator é a execução, o token vai à parte
      gravada({ type: "ai_agent", id: EXECUCAO, role: "agent", api_token_id: OUTRO_TOKEN }, "task_created", "11:10"),
      // linha ANTIGA de uma escrita por token: não guarda o token
      atividade({ type: "stage_changed", reason: "movido antes de a linha guardar o token", performed_at: dia("09:00") }),
      // uma pessoa, para o filtro ter o que separar
      atividade({ type: "stage_changed", actor_kind: "user", performed_by_user_id: PESSOA, performed_at: dia("11:20") }),
    ];
    banco.tabelas.event_log = [
      // `crm_manage_tags` por token com escopo de agente: o evento leva o token
      evento({
        event_type: "lead.tag_added",
        payload: { added_tags: ["vip"] },
        metadata: { actor_type: "ai_agent", actor_id: EXECUCAO, actor_api_token_id: OUTRO_TOKEN, via: "mcp" },
        created_at: dia("11:12"),
      }),
      // o agente do CRM: o evento leva o agente, e o token efêmero não nomeia ninguém
      evento({
        event_type: "lead.tag_removed",
        payload: { removed_tags: ["frio"] },
        metadata: { actor_type: "ai_agent", actor_id: EXECUCAO, agent_id: AGENTE, via: "mcp" },
        created_at: dia("11:14"),
      }),
      // a troca de responsável nasce do gatilho do banco
      evento({
        entity_kind: "lead",
        event_type: "lead.assigned",
        payload: { lead_id: NEGOCIO_1, from_user_id: null, to_user_id: PESSOA },
        created_at: dia("11:06"),
      }),
    ];
  });

  const autores = async (c = comoToken(TOKEN)) =>
    eventos(await listar({ lead_id: NEGOCIO_1 }, c)).map((e) => [e.happened_at.slice(11, 16), e.type, e.author] as const);

  it("mover etapa, editar o negócio e criar tarefa por token: autor `agente`; para gerente, com id e nome do token", async () => {
    const porHora = new Map((await autores(comoGerente(TOKEN))).map(([hora, , autor]) => [hora, autor]));
    expect(porHora.get("11:00")).toEqual({ kind: "agente", id: TOKEN, name: "Sophia", is_self: true });
    expect(porHora.get("11:05")).toMatchObject({ kind: "agente", id: TOKEN, name: "Sophia" });
    expect(porHora.get("11:10")).toEqual({ kind: "agente", id: OUTRO_TOKEN, name: "Pedro", is_self: false });
  });

  it("⭐ o mesmo negócio lido pelo outro token: a autoria é a mesma, e `is_self` troca de lado", async () => {
    const porHora = new Map((await autores(comoGerente(OUTRO_TOKEN))).map(([hora, , autor]) => [hora, autor]));
    expect(porHora.get("11:00")).toEqual({ kind: "agente", id: TOKEN, name: "Sophia", is_self: false });
    expect(porHora.get("11:10")).toEqual({ kind: "agente", id: OUTRO_TOKEN, name: "Pedro", is_self: true });
  });

  it("⭐ o filtro `author: agente` encontra a ação feita por token, e `sistema` deixa de trazê-la", async () => {
    const horas = async (author: string[]) =>
      eventos(await listar({ lead_id: NEGOCIO_1, author }, comoToken(TOKEN))).map((e) => e.happened_at.slice(11, 16));
    expect(await horas(["agente"])).toEqual(["11:00", "11:05", "11:10", "11:12", "11:14"]);
    expect(await horas(["sistema"])).toEqual(["09:00"]);
    expect(await horas(["pessoa"])).toEqual(["11:20"]);
  });

  it("tag por token com escopo de agente: o evento sai com o token; pelo agente do CRM, com o agente", async () => {
    const porTipo = new Map((await autores(comoGerente(TOKEN))).map(([, tipo, autor]) => [tipo, autor]));
    expect(porTipo.get("lead.tag_added")).toEqual({ kind: "agente", id: OUTRO_TOKEN, name: "Pedro", is_self: false });
    expect(porTipo.get("lead.tag_removed")).toEqual({
      kind: "agente",
      id: AGENTE,
      name: "Recuperador de vendas",
      is_self: false,
    });
  });

  it("o agente do CRM lendo: a linha dele é dele, a do token não", async () => {
    const nativo = ctx({
      apiTokenId: "aaaaaaaa-0000-4000-8000-0000000000f9",
      actor: { type: "ai_agent", id: EXECUCAO, role: "agent", agent_id: AGENTE },
    });
    const porTipo = new Map((await autores(nativo)).map(([, tipo, autor]) => [tipo, autor]));
    expect(porTipo.get("lead.tag_removed")).toMatchObject({ id: AGENTE, is_self: true });
    // O agente do CRM só existe para atender: do token ele sabe que foi outro
    // agente, sem id e sem nome (item 2.32).
    expect(porTipo.get("lead.tag_added")).toEqual({ kind: "agente", id: null, name: null, is_self: false });
  });

  it("⭐ token comum, fora do turno: id e nome só do PRÓPRIO token (revisão 20/11, item 2.32)", async () => {
    const porHora = new Map((await autores(comoToken(TOKEN))).map(([hora, , autor]) => [hora, autor]));
    expect(porHora.get("11:00")).toEqual({ kind: "agente", id: TOKEN, name: "Sophia", is_self: true });
    expect(porHora.get("11:10")).toEqual({ kind: "agente", id: null, name: null, is_self: false });
    const saida = JSON.stringify((await autores(comoToken(TOKEN))).map(([, , autor]) => autor));
    expect(saida).not.toContain("Pedro");
    expect(saida).not.toContain(OUTRO_TOKEN);
    // o agente do CRM não é token: continua com o id e o nome dele
    expect(saida).toContain("Recuperador de vendas");
  });

  it("⭐ num turno de atendimento nenhum token sai com nome nem id, nem o do próprio, nem para gerente", async () => {
    const contatoDoNegocio = String(banco.tabelas.crm_leads!.find((l) => l.id === NEGOCIO_1)!.contact_id);
    const turnos = [
      ctx({ contatoDoTurno: contatoDoNegocio, apiTokenId: TOKEN, actor: { type: "api_token", id: TOKEN, role: "agent" } }),
      ctx({
        contatoDoTurno: contatoDoNegocio,
        apiTokenId: TOKEN,
        role: "manager",
        actor: { type: "api_token", id: TOKEN, role: "manager" },
      }),
      ctx({
        contatoDoTurno: contatoDoNegocio,
        role: "ai_operator",
        apiTokenId: "aaaaaaaa-0000-4000-8000-0000000000f9",
        actor: { type: "ai_agent", id: EXECUCAO, role: "ai_operator", agent_id: AGENTE },
      }),
    ];
    for (const turno of turnos) {
      const linhas = await autores(turno);
      expect(linhas.length).toBeGreaterThan(0);
      const porHora = new Map(linhas.map(([hora, , autor]) => [hora, autor]));
      expect(porHora.get("11:00")).toMatchObject({ kind: "agente", id: null, name: null });
      expect(porHora.get("11:10")).toMatchObject({ kind: "agente", id: null, name: null, is_self: false });
      const saida = JSON.stringify(linhas.map(([, , autor]) => autor));
      for (const proibido of ["Sophia", "Pedro", TOKEN, OUTRO_TOKEN]) expect(saida).not.toContain(proibido);
    }
    // `is_self` continua valendo no turno do token
    const proprio = new Map((await autores(turnos[0]!)).map(([hora, , autor]) => [hora, autor]));
    expect(proprio.get("11:00")!.is_self).toBe(true);
  });

  it("a descrição diz que o id e o nome de outro token são só para gerente", () => {
    expect(crmListLeadEvents.description).toMatch(/só para gerente/);
  });

  it("⭐ linha ANTIGA, sem o token: continua legível, como `sistema`", async () => {
    const antiga = (await autores()).find(([hora]) => hora === "09:00")!;
    expect(antiga[2]).toEqual({ kind: "sistema", id: null, name: null });
  });

  it("a troca de responsável continua sem autor na fila; a linha de campo vizinha diz que foi o token", async () => {
    const r = eventos(await listar({ lead_id: NEGOCIO_1, type: ["responsavel", "campo"] }, comoToken(TOKEN)));
    expect(r.map((e) => [e.type, e.author.kind, e.author.name])).toEqual([
      ["lead_edited", "agente", "Sophia"],
      ["lead.assigned", "nao_registrado", null],
    ]);
    expect(r[0]!.details).toEqual({ fields: ["owner_user_id", "value_cents"] });
  });

  it("⭐ isolamento: token de outra organização gravado na linha não ganha nome", async () => {
    banco.tabelas.crm_lead_activities = [gravada({ type: "api_token", id: TOKEN_B, role: "agent" }, "stage_changed", "11:00")];
    banco.tabelas.event_log = [];
    const [linha] = eventos(await listar({ lead_id: NEGOCIO_1 }, comoGerente(TOKEN)));
    expect(linha!.author).toEqual({ kind: "agente", id: TOKEN_B, name: null, is_self: false });
    expect(JSON.stringify(linha)).not.toContain("outra empresa");
  });

  it("token apagado do cadastro: a linha continua `agente`, com o id e sem nome", async () => {
    banco.tabelas.api_tokens = [];
    const porHora = new Map((await autores()).map(([hora, , autor]) => [hora, autor]));
    expect(porHora.get("11:00")).toEqual({ kind: "agente", id: TOKEN, name: null, is_self: true });
  });

  it("pelo funil vale igual", async () => {
    const r = await listar(
      { pipeline_id: FUNIL, since: "2026-11-10T00:00:00Z", until: "2026-11-11T00:00:00Z", author: ["agente"], type: ["etapa"] },
      comoToken(TOKEN),
    );
    expect(eventos(r).map((e) => [e.lead_title, e.author.name, e.author.is_self])).toEqual([["Negócio 1", "Sophia", true]]);
  });
});

describe("⭐ filtros combinados", () => {
  it("por categoria", async () => {
    expect(tipos(await listar({ lead_id: NEGOCIO_1, type: ["etapa"] }))).toEqual(["stage_changed"]);
    expect(tipos(await listar({ lead_id: NEGOCIO_1, type: ["tag"] }))).toEqual(["lead.tag_added", "lead.tag_removed"]);
    expect(tipos(await listar({ lead_id: NEGOCIO_1, type: ["tarefa", "responsavel"] }))).toEqual([
      "task_created",
      "lead.assigned",
    ]);
    expect(tipos(await listar({ lead_id: NEGOCIO_1, type: ["outro"] }))).toEqual([
      "consent_declined",
      "appointment_scheduled",
    ]);
  });

  it("por autor", async () => {
    expect(tipos(await listar({ lead_id: NEGOCIO_1, author: ["pessoa"] }))).toEqual([
      "stage_changed",
      "lead.tag_removed",
      "task_created",
    ]);
    expect(tipos(await listar({ lead_id: NEGOCIO_1, author: ["agente"] }))).toEqual([
      "note",
      "lead.tag_added",
      "lead_edited",
    ]);
    expect(tipos(await listar({ lead_id: NEGOCIO_1, author: ["sistema", "cliente"] }))).toEqual([
      "consent_declined",
      "appointment_scheduled",
    ]);
  });

  it("⭐ `nao_registrado` não é valor do filtro: a troca de responsável nunca casa `author` (revisão 20/11, item 2.28)", async () => {
    const semFiltro = tipos(await listar({ lead_id: NEGOCIO_1 }));
    expect(semFiltro).toContain("lead.assigned");

    for (const autor of AUTORES_DE_EVENTO) {
      expect(tipos(await listar({ lead_id: NEGOCIO_1, author: [autor] }))).not.toContain("lead.assigned");
    }
    expect(tipos(await listar({ lead_id: NEGOCIO_1, author: [...AUTORES_DE_EVENTO] }))).not.toContain("lead.assigned");
    // Pedir as trocas de responsável é por TIPO, sem `author`.
    expect(tipos(await listar({ lead_id: NEGOCIO_1, type: ["responsavel"] }))).toEqual(["lead.assigned"]);
    expect(tipos(await listar({ lead_id: NEGOCIO_1, type: ["responsavel"], author: [...AUTORES_DE_EVENTO] }))).toEqual([]);

    expect(crmListLeadEvents.inputSchema.author.safeParse(["nao_registrado"]).success).toBe(false);
    expect(crmListLeadEvents.description).toMatch(/nao_registrado/);
    expect(crmListLeadEvents.description).toMatch(/até vazia/);
  });

  it("por período: `since` inclui o instante, `until` exclui", async () => {
    const r = await listar({
      lead_id: NEGOCIO_1,
      since: "2026-11-10T10:07:00+00:00",
      until: "2026-11-10T10:15:00+00:00",
    });
    expect(tipos(r)).toEqual(["lead.tag_added", "lead_edited", "lead.tag_removed"]);
  });

  it("período com fuso é convertido: 07:10 em São Paulo é 10:10 UTC", async () => {
    const r = await listar({ lead_id: NEGOCIO_1, since: "2026-11-10T07:10:00-03:00", until: "2026-11-10T07:13:00-03:00" });
    expect(tipos(r)).toEqual(["lead_edited", "lead.tag_removed"]);
  });

  it("categoria + autor + período de uma vez", async () => {
    const r = await listar({
      lead_id: NEGOCIO_1,
      type: ["nota", "tag", "campo"],
      author: ["agente"],
      since: "2026-11-10T10:06:00+00:00",
    });
    expect(tipos(r)).toEqual(["lead.tag_added", "lead_edited"]);
  });

  it("só categorias da linha do tempo: a fila de eventos nem é consultada (e vice-versa)", async () => {
    await listar({ lead_id: NEGOCIO_1, type: ["nota", "etapa"] });
    expect(banco.consultas.event_log ?? 0).toBe(0);

    const antes = banco.consultas.crm_lead_activities ?? 0;
    await listar({ lead_id: NEGOCIO_1, type: ["tag"] });
    expect(banco.consultas.crm_lead_activities ?? 0).toBe(antes);
  });
});

describe("⭐ paginação por cursor", () => {
  it.each([1, 2, 3, 4, 9, 50])("limite %i: todas as páginas juntas dão a lista inteira, na ordem, sem repetir", async (limit) => {
    const { todos, paginas } = await todasAsPaginas({ lead_id: NEGOCIO_1, limit });

    expect(todos.map((e) => e.type)).toEqual(ORDEM_DO_NEGOCIO_1);
    expect(new Set(todos.map((e) => e.id)).size).toBe(todos.length);
    for (const tamanho of paginas) expect(tamanho).toBeLessThanOrEqual(limit);
  });

  it("com filtro que descarta linhas, o cursor continua de onde a varredura parou", async () => {
    const { todos } = await todasAsPaginas({ lead_id: NEGOCIO_1, limit: 1, author: ["pessoa"] });
    expect(todos.map((e) => e.type)).toEqual(["stage_changed", "lead.tag_removed", "task_created"]);
  });

  it("empate de instante entre as duas fontes: o id desempata e nada se perde", async () => {
    banco.tabelas.crm_lead_activities = [
      atividade({ id: "a0000000-0000-4000-8000-000000000002", type: "note", reason: "b", payload: { texto: "b" }, performed_at: dia("11:00") }),
      atividade({ id: "a0000000-0000-4000-8000-000000000004", type: "note", reason: "d", payload: { texto: "d" }, performed_at: dia("11:00") }),
    ];
    banco.tabelas.event_log = [
      evento({ id: "a0000000-0000-4000-8000-000000000001", event_type: "lead.tag_added", payload: { added_tags: ["a"] }, created_at: dia("11:00") }),
      evento({ id: "a0000000-0000-4000-8000-000000000003", event_type: "lead.tag_added", payload: { added_tags: ["c"] }, created_at: dia("11:00") }),
    ];

    const { todos } = await todasAsPaginas({ lead_id: NEGOCIO_1, limit: 1 });
    expect(todos.map((e) => e.id.slice(-1))).toEqual(["1", "2", "3", "4"]);
  });

  it("⭐ a fonte que acabou primeiro não perde a linha que ficou além do horizonte da outra", async () => {
    // Quatro linhas de sistema na linha do tempo e, DEPOIS delas, um evento de
    // pessoa. Com limite 3 a primeira rodada lê as quatro atividades (a fonte
    // segue aberta) e o único evento (a fonte acabou), mas só pode emitir até a
    // última atividade lida. O evento tem de voltar na rodada seguinte.
    banco.tabelas.crm_lead_activities = [0, 1, 2, 3].map((i) =>
      atividade({ type: "note", reason: `sistema ${i}`, payload: { texto: `sistema ${i}` }, performed_at: dia(`11:0${i}`) }),
    );
    banco.tabelas.event_log = [
      evento({ event_type: "lead.tag_added", payload: { added_tags: ["depois"] }, metadata: { actor_type: "user" }, created_at: dia("11:10") }),
    ];

    const r = await listar({ lead_id: NEGOCIO_1, limit: 3, author: ["pessoa"] });
    expect(eventos(r).map((e) => e.text)).toEqual(["Tag adicionada: depois"]);
    expect(r.has_more).toBe(false);

    // e o espelho: a linha do tempo acaba primeiro, com linha além do horizonte dos eventos
    banco.tabelas.event_log = [0, 1, 2, 3].map((i) =>
      evento({ event_type: "lead.tag_added", payload: { added_tags: [`t${i}`] }, metadata: { actor_type: "webhook_source" }, created_at: dia(`11:0${i}`) }),
    );
    banco.tabelas.crm_lead_activities = [
      atividade({ type: "note", actor_kind: "user", performed_by_user_id: PESSOA, reason: "depois", payload: { texto: "depois" }, performed_at: dia("11:10") }),
    ];
    const espelho = await listar({ lead_id: NEGOCIO_1, limit: 3, author: ["pessoa"] });
    expect(eventos(espelho).map((e) => e.text)).toEqual(["depois"]);
  });

  it("muitas linhas descartadas pelo filtro: cada chamada tem teto de idas ao banco e a leitura termina", async () => {
    banco.tabelas.event_log = [];
    banco.tabelas.crm_lead_activities = [
      ...Array.from({ length: 30 }, (_, i) =>
        atividade({ type: "note", reason: `sistema ${i}`, payload: { texto: `sistema ${i}` }, performed_at: dia(`12:${String(i).padStart(2, "0")}`) }),
      ),
      atividade({
        type: "note",
        actor_kind: "user",
        performed_by_user_id: PESSOA,
        reason: "a única de pessoa",
        payload: { texto: "a única de pessoa" },
        performed_at: dia("13:00"),
      }),
    ];

    const antes = banco.consultas.crm_lead_activities ?? 0;
    const primeira = await listar({ lead_id: NEGOCIO_1, limit: 2, type: ["nota"], author: ["pessoa"] });
    expect((banco.consultas.crm_lead_activities ?? 0) - antes).toBeLessThanOrEqual(RODADAS_POR_CHAMADA);
    // a página veio vazia, mas a ferramenta diz que há mais e onde continuar
    expect(eventos(primeira)).toEqual([]);
    expect(primeira.has_more).toBe(true);

    const { todos } = await todasAsPaginas({ lead_id: NEGOCIO_1, limit: 2, type: ["nota"], author: ["pessoa"] });
    expect(todos.map((e) => e.text)).toEqual(["a única de pessoa"]);
  });

  it("cursor que não é desta ferramenta é recusado", async () => {
    expect(await listar({ lead_id: NEGOCIO_1, cursor: "não-é-cursor" })).toMatchObject({
      permitido: false,
      motivo: "cursor_invalido",
    });
  });
});

describe("⭐ o funil inteiro", () => {
  const JANELA = { since: "2026-11-10T00:00:00+00:00", until: "2026-11-11T00:00:00+00:00" };

  it("traz os negócios do funil, com o título, e deixa de fora outro funil e contato pessoal", async () => {
    const r = await listar({ pipeline_id: FUNIL, ...JANELA });

    expect(r.pipeline_id).toBe(FUNIL);
    expect(new Set(eventos(r).map((e) => e.lead_id))).toEqual(new Set([NEGOCIO_1, NEGOCIO_2]));
    expect(eventos(r).filter((e) => e.lead_id === NEGOCIO_2).map((e) => [e.type, e.lead_title])).toEqual([
      ["stage_changed", "Negócio 2"],
      ["lead.tag_added", "Negócio 2"],
    ]);
    expect(tipos(r).slice(0, ORDEM_DO_NEGOCIO_1.length)).toEqual(ORDEM_DO_NEGOCIO_1);
    const cru = JSON.stringify(r);
    expect(cru).not.toContain("movimento de outro funil");
    expect(cru).not.toContain("nota de contato pessoal");
  });

  it("paginado, dá a mesma lista", async () => {
    const inteira = eventos(await listar({ pipeline_id: FUNIL, ...JANELA })).map((e) => e.id);
    const { todos } = await todasAsPaginas({ pipeline_id: FUNIL, ...JANELA, limit: 2 });
    expect(todos.map((e) => e.id)).toEqual(inteira);
  });

  it("filtros combinados também valem no funil", async () => {
    const r = await listar({ pipeline_id: FUNIL, ...JANELA, type: ["etapa", "tag"], author: ["pessoa", "sistema"] });
    expect(eventos(r).map((e) => [e.lead_id, e.type])).toEqual([
      [NEGOCIO_1, "stage_changed"],
      [NEGOCIO_1, "lead.tag_removed"],
      [NEGOCIO_2, "stage_changed"],
      [NEGOCIO_2, "lead.tag_added"],
    ]);
  });

  it("sem `since` é recusado, e a recusa diz que horas são", async () => {
    const r = await listar({ pipeline_id: FUNIL });
    expect(r).toMatchObject({ permitido: false, motivo: "periodo_obrigatorio" });
    expect(String(r.mensagem)).toMatch(/Agora é \d{4}-/);
    expect(banco.consultas.crm_lead_activities ?? 0).toBe(0);
  });

  it("janela maior que o teto é recusada antes de qualquer consulta", async () => {
    const r = await listar({ pipeline_id: FUNIL, since: "2026-09-01T00:00:00+00:00", until: "2026-11-11T00:00:00+00:00" });
    expect(r).toMatchObject({ permitido: false, motivo: "periodo_longo_demais" });
    expect(String(r.mensagem)).toContain(String(JANELA_MAXIMA_DO_FUNIL_DIAS));
    expect(banco.consultas.crm_lead_activities ?? 0).toBe(0);
    expect(banco.consultas.event_log ?? 0).toBe(0);
  });

  it("no funil a consulta SEMPRE filtra por tipo (é o que o índice atende)", () => {
    const todosOsTipos = tiposDeAtividadeDasCategorias(TIPOS_DE_EVENTO);
    expect(new Set(todosOsTipos)).toEqual(new Set(Object.keys(ACTIVITY_LABELS)));
    expect(tiposDeAtividadeDasCategorias(["tag", "responsavel"])).toEqual([]);
  });
});

describe("⭐ isolamento entre organizações", () => {
  it("negócio de outra organização: a mesma recusa de negócio inexistente, nada lido", async () => {
    const r = await listar({ lead_id: NEGOCIO_B });
    expect(r).toMatchObject({ permitido: false, motivo: "negocio_nao_encontrado" });
    expect(banco.consultas.crm_lead_activities ?? 0).toBe(0);
    expect(banco.consultas.event_log ?? 0).toBe(0);
  });

  it("funil de outra organização não existe para este token", async () => {
    expect(
      await listar({ pipeline_id: FUNIL_B, since: "2026-11-10T00:00:00+00:00", until: "2026-11-11T00:00:00+00:00" }),
    ).toMatchObject({
      permitido: false,
      motivo: "funil_nao_encontrado",
    });
  });

  it("nada da outra organização sai pelo funil, nem com o mesmo id de funil no negócio dela", async () => {
    const r = await listar({ pipeline_id: FUNIL, since: "2026-11-10T00:00:00+00:00", until: "2026-11-11T00:00:00+00:00" });
    const cru = JSON.stringify(r);
    expect(cru).not.toContain(NEGOCIO_B);
    expect(cru).not.toContain("segredo da empresa B");
    expect(cru).not.toContain("tag-da-empresa-b");
  });

  it("o token da outra organização só vê o que é dela", async () => {
    const daB = ctx({ organizationId: ORG_B, apiTokenId: TOKEN_B, actor: { type: "api_token", id: TOKEN_B, role: "agent" } });
    const r = await listar({ lead_id: NEGOCIO_B }, daB);
    expect(eventos(r).map((e) => e.text)).toEqual(["segredo da empresa B", "Tag adicionada: tag-da-empresa-b"]);
    expect(await listar({ lead_id: NEGOCIO_1 }, daB)).toMatchObject({ permitido: false, motivo: "negocio_nao_encontrado" });
  });

  it("não aceita a organização como argumento: ela vem do token", () => {
    expect(Object.keys(crmListLeadEvents.inputSchema).sort()).toEqual([
      "author",
      "cursor",
      "lead_id",
      "limit",
      "pipeline_id",
      "since",
      "type",
      "until",
    ]);
  });
});

describe("no turno de atendimento, só o que é do cliente da conversa", () => {
  it("negócio de outro cliente e negócio inexistente recebem a MESMA recusa", async () => {
    const turno = ctx({ contatoDoTurno: CONTATO_2 });
    const alheio = await listar({ lead_id: NEGOCIO_1 }, turno);
    const inexistente = await listar({ lead_id: "99999999-9999-4999-8999-999999999999" }, turno);

    expect(alheio).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
    expect(inexistente).toEqual(alheio);
  });

  it("pelo funil, só os negócios do cliente da conversa", async () => {
    const turno = ctx({ contatoDoTurno: CONTATO_2 });
    const r = await listar({ pipeline_id: FUNIL, since: "2026-11-10T00:00:00+00:00", until: "2026-11-11T00:00:00+00:00" }, turno);
    expect(new Set(eventos(r).map((e) => e.lead_id))).toEqual(new Set([NEGOCIO_2]));
  });

  it("negócio de contato pessoal fica fora da operação", async () => {
    expect(await listar({ lead_id: NEGOCIO_PESSOAL })).toMatchObject({ permitido: false, motivo: "contato_pessoal" });
  });
});

describe("argumentos", () => {
  it("exige exatamente um alvo", async () => {
    expect(await listar({})).toMatchObject({ permitido: false, motivo: "alvo_invalido" });
    expect(await listar({ lead_id: NEGOCIO_1, pipeline_id: FUNIL })).toMatchObject({
      permitido: false,
      motivo: "alvo_invalido",
    });
  });

  it("data sem fuso é recusada com o formato certo", async () => {
    expect(await listar({ lead_id: NEGOCIO_1, since: "2026-11-10" })).toMatchObject({
      permitido: false,
      motivo: "data_invalida",
    });
    expect(await listar({ lead_id: NEGOCIO_1, until: "ontem" })).toMatchObject({ permitido: false, motivo: "data_invalida" });
  });

  it("`until` antes de `since` é recusado", async () => {
    expect(
      await listar({ lead_id: NEGOCIO_1, since: "2026-11-10T10:00:00+00:00", until: "2026-11-10T09:00:00+00:00" }),
    ).toMatchObject({ permitido: false, motivo: "periodo_invalido" });
  });

  it("é leitura: nada é gravado em tabela nenhuma", async () => {
    const antes = JSON.stringify(banco.tabelas);
    await listar({ lead_id: NEGOCIO_1 });
    await listar({ pipeline_id: FUNIL, since: "2026-11-10T00:00:00+00:00", until: "2026-11-11T00:00:00+00:00" });
    expect(JSON.stringify(banco.tabelas)).toBe(antes);
  });
});

describe("⭐ no catálogo: quem alcança e por qual pacote aparece", () => {
  const NOME = "crm_list_lead_events";
  const CATALOGO = TOOL_CATALOG.map((t) => ({ name: t.name, risco: t.risco, pacotes: t.pacotes }));

  it("tem handler, entrada de catálogo, é leitura e não é do harness nem só de pessoa", () => {
    expect(getToolByName(NOME)).toMatchObject({ category: "read", requiresScope: "mcp:read", requiresRole: "agent" });
    expect(catalogEntry(NOME)).toMatchObject({ category: "read", risco: "seguro" });
    expect(catalogEntry(NOME)!.apenasHumano).toBeFalsy();
    expect(IDS_DO_HARNESS.has(NOME)).toBe(false);
    expect(allTools.map((t) => t.name)).toContain(NOME);
  });

  it("entra pelo pacote `reter`, e só por ele", () => {
    expect(catalogEntry(NOME)!.pacotes).toEqual(["reter"]);
    for (const p of PACOTES) {
      const ligadas = ligarPacote([], CATALOGO as never, p.id);
      expect(ligadas.includes(NOME), `com o pacote ${p.id} ligado`).toBe(p.id === "reter");
    }
  });

  it("o agente que nasce no onboarding não a ganha, e `reter` continua cabendo no teto", () => {
    expect(ligarPacote([], CATALOGO as never, PACOTE_PADRAO_DO_ONBOARDING as never)).not.toContain(NOME);
    expect(vagasExigidasPeloPacote([], CATALOGO as never, "reter")).toBeLessThanOrEqual(TETO_TOOLS_POR_AGENTE);
  });
});
