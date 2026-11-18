import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { McpContext } from "@/lib/mcp/types";
import type { ToolSet } from "@/lib/agent-engine/edge/llm/run-model-call";

/**
 * A RECUSA DE TIPO DE AGENDA ENSINA O QUE EXISTE — e o traço do turno a mostra.
 *
 * ─── O defeito, medido num ensaio real (17/11/2026) ────────────────────────
 *
 * O cliente escolheu "sábado às 9h30". O agente chamou
 * `crm_find_and_book_appointment` com um `event_type_slug` errado: o texto dele
 * citava o NOME do tipo, e a lista tinha tipos de fábrica sem horário nenhum. A
 * ferramenta recusou em 38 ms com `tipo_desconhecido`, o agente chamou humano —
 * e o traço do turno registrou a chamada como `estado: "ok"`, sem o retorno.
 * Não deu para provar a causa pelo CRM.
 *
 * Três consertos, e este arquivo prende os três:
 *
 *   1. a recusa `tipo_desconhecido` devolve `tipos_validos` (slug + nome dos
 *      tipos ATIVOS), nas três ferramentas que a produzem — o modelo corrige e
 *      repete a chamada em vez de chamar humano;
 *   2. `crm_list_event_types` diz `tem_horarios`, com DUAS consultas para a
 *      lista inteira (nunca uma coleta de horários por tipo);
 *   3. as ferramentas que OLHAM a agenda aceitam `event_type_id` no lugar do
 *      slug, e marcam no MESMO tipo que consultaram.
 *
 * ─── Por que a coleta NÃO está mockada aqui ────────────────────────────────
 *
 * `lib/agenda/consulta.ts` roda de verdade, contra um client de mentira que
 * responde por tabela. Mockar `horariosLivresDaOrg` provaria só que a ferramenta
 * repassa um campo — e o defeito do ensaio morava justamente na coleta, que
 * recusava sem dizer o que existe. A marcação segue mockada: é de outro dono.
 */
vi.mock("@/app/api/v1/agenda/agendamentos/_handler", () => ({
  marcarAgendamentoHandler: vi.fn(),
  alterarAgendamentoHandler: vi.fn(),
  cancelarAgendamentoHandler: vi.fn(),
}));

const { crmListEventTypes, crmFindFreeSlots, crmFindAndBookAppointment, crmBookAppointment } =
  await import("@/lib/mcp/tools/agendamento");
const handlers = await import("@/app/api/v1/agenda/agendamentos/_handler");
const { criarColetorDeFerramentas, envolverFerramentasComTraco } =
  await import("@/lib/agent-engine/agent/traco-do-turno");
const { reciboDoTraco } = await import("@/lib/agent-engine/agent/recibo-do-traco");

const ORG = "org-1";
const CONTATO = "11111111-1111-4111-8111-111111111111";
const DONO_COM_JORNADA = "22222222-2222-4222-8222-222222222222";
const DONO_SEM_JORNADA = "33333333-3333-4333-8333-333333333333";
const ID_AVALIACAO = "44444444-4444-4444-8444-444444444444";
const ID_FABRICA = "55555555-5555-4555-8555-555555555555";
const ID_SERVICO = "66666666-6666-4666-8666-666666666666";
const ID_INATIVO = "77777777-7777-4777-8777-777777777777";

type Linha = Record<string, unknown>;

/** Os tipos como a organização do ensaio os tinha: o de verdade e os de fábrica. */
function tiposDoEnsaio(): Linha[] {
  const comum = {
    organization_id: ORG,
    description: null,
    category: "geral",
    duration_minutes: 30,
    location_kind: "online",
    location_details: null,
    requires_confirmation: false,
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
    minimum_notice_minutes: 0,
    slot_interval_minutes: 30,
    booking_window_days: 30,
    reminder_channel_session_id: null,
    reminder_meta_template_id: null,
    reminder_enabled: false,
    reminder_minutes_before: 1440,
    reminder_extra_offsets_minutes: [],
    reminder_body: null,
    reminder_bodies: {},
    default_price_cents: null,
    service_enabled: false,
    booking_mode: "individual",
    service_capacity: null,
    service_revision: 1,
    service_publication_mode: "none",
  };
  return [
    {
      ...comum,
      id: ID_AVALIACAO,
      name: "Primeira conversa",
      slug: "primeira-conversa",
      is_active: true,
      default_owner_user_id: DONO_COM_JORNADA,
    },
    {
      ...comum,
      id: ID_FABRICA,
      name: "Reunião",
      slug: "reuniao",
      is_active: true,
      default_owner_user_id: DONO_SEM_JORNADA,
    },
    {
      ...comum,
      id: ID_SERVICO,
      name: "Turma aberta",
      slug: "turma-aberta",
      is_active: true,
      default_owner_user_id: null,
      service_enabled: true,
    },
    {
      ...comum,
      id: ID_INATIVO,
      name: "Tipo antigo",
      slug: "tipo-antigo",
      is_active: false,
      default_owner_user_id: DONO_COM_JORNADA,
    },
  ];
}

const TABELAS: Record<string, Linha[]> = {
  calendar_event_types: tiposDoEnsaio(),
  attendant_availability: [
    {
      organization_id: ORG,
      user_id: DONO_COM_JORNADA,
      schedule: { timezone: "America/Sao_Paulo", windows: [{ dow: 6, start: "09:00", end: "12:00" }] },
    },
    // Linha existe, janela nenhuma: é o tipo de fábrica do ensaio.
    {
      organization_id: ORG,
      user_id: DONO_SEM_JORNADA,
      schedule: { timezone: "America/Sao_Paulo", windows: [] },
    },
  ],
  calendar_service_schedule: [{ organization_id: ORG, event_type_id: ID_SERVICO }],
};

/**
 * Client de mentira que responde POR TABELA e aplica os filtros de verdade —
 * `eq`, `in`, `order` — sobre as linhas acima. Registra cada `from`, que é o
 * que deixa contar quantas idas ao banco uma ferramenta fez.
 */
function bancoDoEnsaio() {
  const consultas: { tabela: string; filtros: [string, string, unknown][] }[] = [];
  const cliente = {
    from(tabela: string) {
      const consulta = { tabela, filtros: [] as [string, string, unknown][] };
      consultas.push(consulta);
      const linhas = (): Linha[] =>
        (TABELAS[tabela] ?? []).filter((linha) =>
          consulta.filtros.every(([op, coluna, valor]) =>
            op === "eq"
              ? linha[coluna] === valor
              : (valor as unknown[]).includes(linha[coluna]),
          ),
        );
      const q: Record<string, unknown> = {
        select: () => q,
        order: () => q,
        eq: (coluna: string, valor: unknown) => {
          consulta.filtros.push(["eq", coluna, valor]);
          return q;
        },
        in: (coluna: string, valores: unknown[]) => {
          consulta.filtros.push(["in", coluna, valores]);
          return q;
        },
        maybeSingle: async () => ({ data: linhas()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: linhas(), error: null }).then(resolve),
      };
      return q;
    },
  };
  return { cliente: cliente as unknown as SupabaseClient, consultas };
}

function contexto(supabase: SupabaseClient): McpContext {
  return {
    organizationId: ORG,
    role: "agent",
    actor: { type: "ai_agent", id: "ag-1", role: "ai_operator" },
    apiTokenId: "tok-1",
    requestId: "req-1",
    supabase,
  };
}

const TIPOS_VALIDOS = [
  { slug: "primeira-conversa", nome: "Primeira conversa" },
  { slug: "reuniao", nome: "Reunião" },
  { slug: "turma-aberta", nome: "Turma aberta" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("crm_list_event_types diz quais tipos têm horário", () => {
  it("só os ATIVOS voltam, cada um com `tem_horarios`", async () => {
    const { cliente } = bancoDoEnsaio();

    const r = (await crmListEventTypes.handler({}, contexto(cliente))) as {
      tipos: { slug: string; tem_horarios: boolean | null }[];
    };

    expect(r.tipos.map((t) => [t.slug, t.tem_horarios])).toEqual([
      // Jornada do responsável com janela.
      ["primeira-conversa", true],
      // O tipo de fábrica do ensaio: responsável sem janela nenhuma.
      ["reuniao", false],
      // Tipo de serviço: quem responde é a agenda do serviço.
      ["turma-aberta", true],
    ]);
    // O inativo não aparece — oferecê-lo é beco sem saída garantido.
    expect(JSON.stringify(r)).not.toContain("tipo-antigo");
  });

  it("custa TRÊS idas ao banco para a lista inteira, nunca uma por tipo", async () => {
    const { cliente, consultas } = bancoDoEnsaio();

    await crmListEventTypes.handler({}, contexto(cliente));

    expect(consultas.map((c) => c.tabela)).toEqual([
      "calendar_event_types",
      "attendant_availability",
      "calendar_service_schedule",
    ]);
    // E toda consulta filtra a organização: o client é service role.
    for (const c of consultas) {
      expect(c.filtros).toContainEqual(["eq", "organization_id", ORG]);
    }
  });

  it("o id interno continua fora da lista — o handle do modelo é o slug", async () => {
    const { cliente } = bancoDoEnsaio();

    const r = await crmListEventTypes.handler({}, contexto(cliente));

    expect(JSON.stringify(r)).not.toContain(ID_AVALIACAO);
  });
});

describe("a recusa `tipo_desconhecido` devolve `tipos_validos`", () => {
  it("crm_find_free_slots: slug errado volta com o que existe", async () => {
    const { cliente } = bancoDoEnsaio();

    const r = (await crmFindFreeSlots.handler(
      { event_type_slug: "avaliacao-inicial", dias_a_frente: 7 },
      contexto(cliente),
    )) as Record<string, unknown>;

    expect(r.motivo).toBe("tipo_desconhecido");
    expect(r.horarios).toEqual([]);
    expect(r.tipos_validos).toEqual(TIPOS_VALIDOS);
    // A mensagem nomeia o que foi pedido e manda REPETIR, não chamar a equipe.
    expect(String(r.mensagem)).toContain("avaliacao-inicial");
    expect(String(r.mensagem)).toContain("tipos_validos");
  });

  it("crm_find_and_book_appointment: o caso do ensaio — NADA é marcado e a lista vem junto", async () => {
    const { cliente } = bancoDoEnsaio();

    const r = (await crmFindAndBookAppointment.handler(
      {
        event_type_slug: "avaliacao-inicial",
        dia: "2026-11-21",
        horario: "09:30",
        contact_id: CONTATO,
      },
      contexto(cliente),
    )) as Record<string, unknown>;

    expect(r.marcado).toBe(false);
    expect(r.motivo).toBe("tipo_desconhecido");
    expect(r.tipos_validos).toEqual(TIPOS_VALIDOS);
    expect(handlers.marcarAgendamentoHandler).not.toHaveBeenCalled();
  });

  it("crm_book_appointment: a marcação avulsa recusa com a MESMA lista", async () => {
    const { cliente } = bancoDoEnsaio();

    const r = (await crmBookAppointment.handler(
      { event_type_slug: "avaliacao-inicial", starts_at: "2026-11-21T12:30:00Z", contact_id: CONTATO },
      contexto(cliente),
    )) as Record<string, unknown>;

    expect(r.marcado).toBe(false);
    expect(r.motivo).toBe("tipo_desconhecido");
    expect(r.tipos_validos).toEqual(TIPOS_VALIDOS);
    expect(handlers.marcarAgendamentoHandler).not.toHaveBeenCalled();
  });

  it("os tipos válidos são os da organização do TURNO, e só os ativos", async () => {
    const { cliente, consultas } = bancoDoEnsaio();

    await crmFindFreeSlots.handler({ event_type_slug: "nao-existe" }, contexto(cliente));

    const lista = consultas.at(-1)!;
    expect(lista.tabela).toBe("calendar_event_types");
    expect(lista.filtros).toContainEqual(["eq", "organization_id", ORG]);
    expect(lista.filtros).toContainEqual(["eq", "is_active", true]);
  });
});

describe("`event_type_id` como alternativa ao slug", () => {
  it("a consulta procura pelo ID, dentro da organização", async () => {
    const { cliente, consultas } = bancoDoEnsaio();

    // Um id bem formado que não existe: a consulta vai ao banco pelo id e recusa.
    const inexistente = "99999999-9999-4999-8999-999999999999";
    const r = (await crmFindFreeSlots.handler(
      { event_type_id: inexistente },
      contexto(cliente),
    )) as Record<string, unknown>;

    expect(consultas[0]!.filtros).toContainEqual(["eq", "id", inexistente]);
    expect(consultas[0]!.filtros).toContainEqual(["eq", "organization_id", ORG]);
    expect(r.motivo).toBe("tipo_desconhecido");
    expect(r.tipos_validos).toEqual(TIPOS_VALIDOS);
  });

  it("id que nem tem forma de id é recusado SEM virar filtro, e com a lista", async () => {
    const { cliente, consultas } = bancoDoEnsaio();

    const r = (await crmFindFreeSlots.handler(
      { event_type_id: "primeira-conversa" },
      contexto(cliente),
    )) as Record<string, unknown>;

    expect(r.motivo).toBe("tipo_desconhecido");
    expect(r.tipos_validos).toEqual(TIPOS_VALIDOS);
    // Um texto qualquer numa coluna uuid é erro do Postgres, não recusa: ele
    // não pode chegar lá.
    expect(consultas.some((c) => c.filtros.some(([, coluna]) => coluna === "id"))).toBe(false);
  });

  it("sem slug e sem id: recusa que diz o que falta, com a lista", async () => {
    const { cliente } = bancoDoEnsaio();

    const semTipo = (await crmFindFreeSlots.handler({ dias_a_frente: 7 }, contexto(cliente))) as Record<
      string,
      unknown
    >;
    const semTipoNaMarcacao = (await crmFindAndBookAppointment.handler(
      { dia: "2026-11-21", horario: "09:30", contact_id: CONTATO },
      contexto(cliente),
    )) as Record<string, unknown>;

    for (const r of [semTipo, semTipoNaMarcacao]) {
      expect(r.motivo).toBe("tipo_desconhecido");
      expect(r.tipos_validos).toEqual(TIPOS_VALIDOS);
    }
    expect(semTipoNaMarcacao.marcado).toBe(false);
    expect(handlers.marcarAgendamentoHandler).not.toHaveBeenCalled();
  });
});

describe("o traço do turno mostra a recusa e o que ela devolveu", () => {
  type Executavel = { execute: (input: unknown, options: unknown) => Promise<unknown> };

  it("⭐ o ensaio: slug errado → `recusado`, com `tipos_validos` legível no resultado", async () => {
    const { cliente } = bancoDoEnsaio();
    const ctx = contexto(cliente);
    const tools = {
      crm_find_and_book_appointment: {
        description: "teste",
        parameters: {},
        execute: (input: unknown) => crmFindAndBookAppointment.handler(input as never, ctx),
      },
    } as unknown as ToolSet;
    const coletor = criarColetorDeFerramentas();
    const envolvidas = envolverFerramentasComTraco(tools, coletor);

    const devolvido = (await (envolvidas.crm_find_and_book_appointment as Executavel).execute(
      { event_type_slug: "avaliacao-inicial", dia: "2026-11-21", horario: "09:30", contact_id: CONTATO },
      {},
    )) as Record<string, unknown>;

    // O traço observa, não decide: o modelo recebe a recusa inteira.
    expect(devolvido.tipos_validos).toEqual(TIPOS_VALIDOS);

    const [chamada] = coletor.listar();
    expect(chamada).toMatchObject({
      nome: "crm_find_and_book_appointment",
      // Antes: "ok". Era o que impedia provar a causa.
      estado: "recusado",
      erro: "tipo_desconhecido",
    });
    // E o retorno está lá, legível: o motivo e o slug que o modelo devia ter usado.
    expect(chamada!.resultado).toContain('"motivo":"tipo_desconhecido"');
    expect(chamada!.resultado).toContain("primeira-conversa");
    expect(chamada!.resultado!.length).toBeLessThanOrEqual(600);

    // O LEITOR entrega o mesmo — é ele que a equipe abre para investigar.
    const recibo = reciboDoTraco({
      ferramentas: coletor.listar() as never,
      skills: [],
      kb_sources: [],
    } as never);
    expect(recibo.ferramentas[0]).toMatchObject({
      nome: "crm_find_and_book_appointment",
      estado: "recusado",
      erro: "tipo_desconhecido",
    });
    expect(recibo.ferramentas[0]!.resultado).toContain("primeira-conversa");
  });
});
