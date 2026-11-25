import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { LEITURAS_MCP } from "@/lib/assistente/capacidades/mcp";
import { executarLeitura, type DependenciasDoExecutor } from "@/lib/assistente/executor";
import type { ContextoDoAssistente, PapelHumano } from "@/lib/assistente/tipos";

import { subirPostgrest, type PostgrestEfemero } from "../db/postgrest-efemero";
import {
  GOV_AGENT_A,
  GOV_AGENT_B,
  GOV_CONV_AGENT_B,
  GOV_MANAGER,
  GOV_ORG,
  GOV_SESSION,
  GOV_VIEWER,
  seedGov,
  sql,
} from "./gov-helpers";

/**
 * CADA LEITURA DO VIX, UMA A UMA: NÃO ALCANÇA OUTRA EMPRESA.
 *
 * ═══ O que roda aqui ═══
 *
 * O caminho de produção inteiro, sem emulação: o executor do Vix
 * (`executarLeitura`), a capacidade do catálogo, o handler da ferramenta, o
 * construtor de consulta do supabase-js, um PostgREST de verdade
 * (`tests/db/postgrest-efemero.ts`) e a RLS, com o JWT de uma pessoa no papel
 * `authenticated`. É o cliente de SESSÃO, como na rota.
 *
 * ═══ O que se prova, por capacidade ═══
 *
 *  1. CONTROLE POSITIVO: a pessoa da empresa A lê o dado da empresa A (a marca
 *     `PROPRIO-A`). Sem isto, "não vazou" passaria por a leitura não ler nada.
 *  2. ATAQUE POR ID: com os ids da empresa B nos argumentos, a resposta não
 *     traz a marca `VITIMA-B` nem id nenhum da empresa B.
 *  3. ATAQUE POR LISTA E POR TEXTO: listando tudo, e buscando pela palavra da
 *     vítima, idem.
 *
 * A empresa B tem um registro em CADA tabela que estas leituras tocam; sem
 * alvo, o ataque não mediria nada (conferido no primeiro caso).
 *
 * ═══ Regra do catálogo ═══
 *
 * Toda leitura de `LEITURAS_MCP` precisa ter a sua linha em `PROVAS`. A última
 * suíte reprova quando uma entra no catálogo sem prova, ou sobra prova de
 * capacidade que saiu.
 *
 * `mcp-nao-alcanca-outro-tenant.test.ts`, que já existia, é uma AMOSTRA de
 * quatro funções de negócios chamadas sem RLS; este arquivo não a substitui,
 * mede outra coisa (o caminho do Vix, com sessão).
 */

const ORG_B = "b1770000-0000-4000-8000-00000000000b";
const USER_B = "b1770000-1111-4000-8000-00000000000b";
const SESS_B = "b1770000-2222-4000-8000-00000000000b";

/** Ids fixos dos registros das duas empresas, para os ataques por id. */
const A = {
  contato: "a1770000-3333-4000-8000-000000000001",
  conversa: "a1770000-4444-4000-8000-000000000001",
  funil: "a1770000-5555-4000-8000-000000000001",
  etapa: "a1770000-5555-4000-8000-000000000002",
  negocio: "a1770000-6666-4000-8000-000000000001",
  caso: "a1770000-7777-4000-8000-000000000001",
  proposta: "a1770000-8888-4000-8000-000000000001",
  contrato: "a1770000-9999-4000-8000-000000000001",
};
const B = {
  contato: "b1770000-3333-4000-8000-000000000001",
  conversa: "b1770000-4444-4000-8000-000000000001",
  funil: "b1770000-5555-4000-8000-000000000001",
  etapa: "b1770000-5555-4000-8000-000000000002",
  negocio: "b1770000-6666-4000-8000-000000000001",
  caso: "b1770000-7777-4000-8000-000000000001",
  proposta: "b1770000-8888-4000-8000-000000000001",
  contrato: "b1770000-9999-4000-8000-000000000001",
};

const MARCA_A = "PROPRIO-A";
const MARCA_B = "VITIMA-B";
// O contrato de honorários não tem campo de texto: a marca é o VALOR.
const VALOR = { a: 123454321, b: 987654321 } as const;
const PARCELA = { a: 23454321, b: 87654321 } as const;

function semear(org: string, ids: typeof A, marca: string, sessao: string, slug: "a" | "b"): string {
  return `
    insert into public.contacts (id, organization_id, display_name)
      values ('${ids.contato}', '${org}', '${marca} contato') on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, tags)
      values ('${ids.conversa}', '${org}', '${ids.contato}', '${sessao}', 'open', array['${marca.toLowerCase()}-marcador'])
      on conflict do nothing;
    insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, body)
      values ('${org}', '${ids.conversa}', '${sessao}', '${ids.contato}', 'text', 'inbound', '${marca} mensagem do cliente');
    insert into public.crm_pipelines (id, organization_id, name, slug)
      values ('${ids.funil}', '${org}', '${marca} funil', 'vix-${slug}') on conflict do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
      values ('${ids.etapa}', '${org}', '${ids.funil}', '${marca} etapa', 'vix-${slug}', 1000) on conflict do nothing;
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, contact_id, title)
      values ('${ids.negocio}', '${org}', '${ids.funil}', '${ids.etapa}', '${ids.contato}', '${marca} negocio')
      on conflict do nothing;
    insert into public.crm_tasks (organization_id, title, lead_id)
      values ('${org}', '${marca} tarefa', '${ids.negocio}');
    insert into public.calendar_event_types (organization_id, name, slug, duration_minutes)
      values ('${org}', '${marca} servico', 'vix-${slug}', 30);
    insert into public.calendar_appointments (organization_id, contact_id, title, starts_at, ends_at)
      values ('${org}', '${ids.contato}', '${marca} compromisso', now() + interval '1 day', now() + interval '1 day 30 minutes');
    insert into public.agent_cases (id, organization_id, conversation_id, title, summary, blocker)
      values ('${ids.caso}', '${org}', '${ids.conversa}', '${marca} caso', '${marca} resumo', '${marca} bloqueio')
      on conflict do nothing;
    insert into public.crm_proposals (id, organization_id, lead_id, contact_id, titulo, total_cents)
      values ('${ids.proposta}', '${org}', '${ids.negocio}', '${ids.contato}', '${marca} proposta', 1000)
      on conflict do nothing;
    insert into public.catalog_products (organization_id, codigo, nome, preco_cents, quantidade)
      values ('${org}', 'VIX-${slug}', '${marca} produto', 100, 10);
    insert into public.message_templates (organization_id, title, body)
      values ('${org}', '${marca} resposta pronta', '${marca} corpo da resposta');
    -- Contrato de honorários do negócio, com uma parcela (módulo instalado no beforeAll).
    insert into public.honorarios_contratos (id, organization_id, lead_id, modelo, valor_fixo_cents)
      values ('${ids.contrato}', '${org}', '${ids.negocio}', 'fixo', ${VALOR[slug]}) on conflict do nothing;
    insert into public.honorarios_parcelas (organization_id, contrato_id, numero, vencimento, valor_cents)
      values ('${org}', '${ids.contrato}', 1, current_date + 30, ${PARCELA[slug]});
    -- Negócio parado há 60 dias: é o que o radar de risco lista.
    update public.crm_leads set last_activity_at = now() - interval '60 days' where id = '${ids.negocio}';
    -- Uma nota no negócio.
    insert into public.crm_lead_activities (organization_id, lead_id, contact_id, source_module, type, reason, payload)
      values ('${org}', '${ids.negocio}', '${ids.contato}', 'notas', 'note', '${marca} nota do negocio',
              '{"texto":"${marca} nota do negocio","autor":{"tipo":"humano","nome":"${marca} autor"}}'::jsonb);
    -- Um retorno agendado para o contato.
    insert into public.cron_jobs (organization_id, contact_id, kind, job_kind, next_run_at, payload)
      values ('${org}', '${ids.contato}', 'at', 'followup_turn', now() + interval '2 days',
              '{"reason":"${marca} retorno combinado","conversation_id":"${ids.conversa}"}'::jsonb);
  `;
}

let rest: PostgrestEfemero;
const clientes = new Map<string, SupabaseClient>();
let idsDaVitima: string[] = [];

async function ctx(userId: string, papel: PapelHumano): Promise<ContextoDoAssistente> {
  let db = clientes.get(userId);
  if (!db) {
    db = await rest.clienteDeSessao(userId);
    clientes.set(userId, db);
  }
  return { orgId: GOV_ORG, userId, papel, idioma: "pt-BR", requestId: "isolamento", db };
}

const deps: DependenciasDoExecutor = {
  catalogo: LEITURAS_MCP,
  foraDoPlano: async () => false,
  modulosLigados: [],
  capacidadesDaEmpresa: [],
  escritasLigadas: false,
  limiteDeLote: 5,
  auditar: () => undefined,
  gravarCartao: async () => {
    throw new Error("leitura não grava cartão");
  },
};

/** Executa a leitura como uma pessoa da empresa A e devolve o JSON da resposta. */
async function ler(nome: string, args: Record<string, unknown>, quem = GOV_AGENT_A, papel: PapelHumano = "agent"): Promise<string> {
  const r = await executarLeitura(nome, args, await ctx(quem, papel), deps);
  // Recusa também é resposta: o que importa é o que ela carrega.
  return JSON.stringify(r);
}

function naoVaza(json: string, contexto: string): void {
  expect(json, `${contexto}: a resposta traz a marca da outra empresa`).not.toContain(MARCA_B);
  expect(json, `${contexto}: a resposta traz o valor do contrato da outra empresa`).not.toContain(String(VALOR.b));
  expect(json, `${contexto}: a resposta traz a parcela da outra empresa`).not.toContain(String(PARCELA.b));
  expect(json.toLowerCase(), `${contexto}: a resposta traz o marcador da outra empresa`).not.toContain(
    `${MARCA_B.toLowerCase()}-marcador`,
  );
  for (const id of idsDaVitima) {
    expect(json, `${contexto}: a resposta traz um id da outra empresa (${id})`).not.toContain(id);
  }
}

interface Prova {
  papel: PapelHumano;
  /** Argumentos com os quais a pessoa lê o dado da PRÓPRIA empresa. */
  proprio: Record<string, unknown>;
  /** O que a resposta do controle positivo precisa conter. */
  espera: string | ((json: string) => void);
  /** Argumentos de ataque: ids e palavras da empresa B. */
  ataques: Record<string, unknown>[];
}

const PROVAS: Record<string, Prova> = {
  crm_list_leads: {
    papel: "agent",
    proprio: {},
    espera: `${MARCA_A} negocio`,
    ataques: [{}, { pipeline_id: B.funil }, { stage_id: B.etapa }, { contact_id: B.contato }, { search: MARCA_B }],
  },
  crm_get_lead: {
    papel: "agent",
    proprio: { lead_id: A.negocio },
    espera: `${MARCA_A} negocio`,
    ataques: [{ lead_id: B.negocio }],
  },
  crm_list_at_risk_leads: {
    papel: "agent",
    proprio: {},
    espera: `${MARCA_A} negocio`,
    ataques: [{}, { pipeline_id: B.funil }],
  },
  crm_list_lead_notes: {
    papel: "agent",
    proprio: { lead_id: A.negocio },
    espera: `${MARCA_A} nota do negocio`,
    ataques: [{ lead_id: B.negocio }],
  },
  crm_list_pipelines: {
    papel: "manager",
    proprio: {},
    espera: `${MARCA_A} funil`,
    ataques: [{}],
  },
  crm_get_pipeline_forecast: {
    papel: "manager",
    proprio: { pipeline_id: A.funil },
    espera: (json) => expect(json).toContain(A.funil),
    ataques: [{ pipeline_id: B.funil }],
  },
  crm_list_stages: {
    papel: "manager",
    proprio: { pipeline_id: A.funil },
    espera: `${MARCA_A} etapa`,
    ataques: [{ pipeline_id: B.funil }],
  },
  crm_search_contacts: {
    papel: "agent",
    proprio: { query: MARCA_A },
    espera: `${MARCA_A} contato`,
    ataques: [{ query: MARCA_B }, { query: "contato" }],
  },
  crm_get_contact: {
    papel: "agent",
    proprio: { contact_id: A.contato },
    espera: `${MARCA_A} contato`,
    ataques: [{ contact_id: B.contato }],
  },
  crm_list_conversations: {
    papel: "agent",
    proprio: {},
    espera: (json) => expect(json).toContain(A.conversa),
    ataques: [{}, { contact_id: B.contato }],
  },
  crm_get_conversation: {
    papel: "agent",
    proprio: { conversation_id: A.conversa },
    espera: (json) => expect(json).toContain(A.contato),
    ataques: [{ conversation_id: B.conversa }],
  },
  crm_get_conversation_history: {
    papel: "agent",
    proprio: { conversation_id: A.conversa },
    espera: `${MARCA_A} mensagem do cliente`,
    ataques: [{ conversation_id: B.conversa }],
  },
  crm_get_queue_status: {
    papel: "agent",
    proprio: {},
    espera: (json) => expect(JSON.parse(json).dados.queue_size).toBeGreaterThanOrEqual(1),
    ataques: [{}],
  },
  crm_list_tasks: {
    papel: "agent",
    proprio: {},
    espera: `${MARCA_A} tarefa`,
    ataques: [{}, { lead_id: B.negocio }],
  },
  crm_list_appointments: {
    papel: "agent",
    proprio: { contact_id: A.contato },
    espera: `${MARCA_A} compromisso`,
    ataques: [{ contact_id: B.contato }],
  },
  crm_list_event_types: {
    papel: "agent",
    proprio: {},
    espera: `${MARCA_A} servico`,
    ataques: [{}],
  },
  crm_list_human_cases: {
    papel: "agent",
    proprio: {},
    espera: `${MARCA_A} caso`,
    ataques: [{}],
  },
  crm_get_human_case: {
    papel: "agent",
    proprio: { case_id: A.caso },
    espera: `${MARCA_A} caso`,
    ataques: [{ case_id: B.caso }],
  },
  crm_list_followups: {
    papel: "agent",
    proprio: { lead_id: A.negocio },
    espera: `${MARCA_A} retorno combinado`,
    ataques: [{ lead_id: B.negocio }, { contact_id: B.contato }],
  },
  crm_get_honorarios_contrato: {
    papel: "manager",
    proprio: { lead_id: A.negocio },
    espera: String(VALOR.a),
    ataques: [{ lead_id: B.negocio }],
  },
  crm_list_honorarios_parcelas: {
    papel: "manager",
    proprio: { contrato_id: A.contrato },
    espera: String(PARCELA.a),
    ataques: [{ contrato_id: B.contrato }],
  },
  crm_search_products: {
    papel: "agent",
    proprio: { termo: MARCA_A },
    espera: `${MARCA_A} produto`,
    ataques: [{ termo: MARCA_B }, { termo: "produto" }],
  },
  crm_list_tags: {
    papel: "agent",
    proprio: {},
    espera: `${MARCA_A.toLowerCase()}-marcador`,
    ataques: [{}],
  },
  crm_list_message_templates: {
    papel: "agent",
    proprio: {},
    espera: `${MARCA_A} resposta pronta`,
    ataques: [{}],
  },
  crm_list_team_members: {
    papel: "agent",
    proprio: {},
    espera: (json) => expect(json).toContain(GOV_AGENT_A),
    ataques: [{}],
  },
};

const QUEM: Record<PapelHumano, string> = {
  viewer: GOV_VIEWER,
  agent: GOV_AGENT_A,
  manager: GOV_MANAGER,
  admin: GOV_MANAGER,
};

beforeAll(async () => {
  seedGov();
  // As tabelas de honorários são de módulo: nascem pela função provisionadora,
  // como numa instância que instalou o módulo. Antes de subir o PostgREST, para
  // entrarem no cache de schema dele.
  sql("select public.fn_honorarios_provisionar();");
  sql(`
    insert into auth.users (id, email) values ('${USER_B}', 'vix-vitima@invariant.test') on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'vix-vitima', 'Vix Vitima LTDA', 'Vix Vitima') on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USER_B}', '${ORG_B}', 'admin', now()) on conflict do nothing;
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${SESS_B}', '${ORG_B}', 'vix-vitima', '\\x00'::bytea) on conflict (id) do nothing;
    ${semear(GOV_ORG, A, MARCA_A, GOV_SESSION, "a")}
    ${semear(ORG_B, B, MARCA_B, SESS_B, "b")}
  `);
  idsDaVitima = [ORG_B, USER_B, SESS_B, ...Object.values(B)];
  rest = await subirPostgrest();
}, 240_000);

afterAll(() => rest?.derrubar());

describe("o cenário está montado: sem alvo, nenhum ataque mede nada", () => {
  it("a empresa B tem um registro com a marca em cada tabela que as leituras tocam", () => {
    const contagens = sql(`
      select string_agg(n::text, ',' order by ord) from (
        select 1 ord, count(*) n from public.contacts where organization_id = '${ORG_B}' and display_name like '${MARCA_B}%'
        union all select 2, count(*) from public.conversations where organization_id = '${ORG_B}'
        union all select 3, count(*) from public.messages where organization_id = '${ORG_B}' and body like '${MARCA_B}%'
        union all select 4, count(*) from public.crm_pipelines where organization_id = '${ORG_B}' and name like '${MARCA_B}%'
        union all select 5, count(*) from public.crm_stages where organization_id = '${ORG_B}' and name like '${MARCA_B}%'
        union all select 6, count(*) from public.crm_leads where organization_id = '${ORG_B}' and title like '${MARCA_B}%'
        union all select 7, count(*) from public.crm_tasks where organization_id = '${ORG_B}'
        union all select 8, count(*) from public.calendar_event_types where organization_id = '${ORG_B}' and name like '${MARCA_B}%'
        union all select 9, count(*) from public.calendar_appointments where organization_id = '${ORG_B}'
        union all select 10, count(*) from public.agent_cases where organization_id = '${ORG_B}'
        union all select 11, count(*) from public.crm_proposals where organization_id = '${ORG_B}'
        union all select 12, count(*) from public.catalog_products where organization_id = '${ORG_B}' and nome like '${MARCA_B}%'
        union all select 13, count(*) from public.message_templates where organization_id = '${ORG_B}'
      ) t;
    `);
    expect(contagens.split(",").every((n) => Number(n) >= 1), `contagens da vítima: ${contagens}`).toBe(true);
  });

  it("o instrumento enxerga vazamento: com a chave de serviço, a marca da vítima APARECE", async () => {
    // Controle do próprio teste: se `naoVaza` não soubesse ver a marca, todo
    // caso abaixo passaria sem medir. Aqui a mesma pergunta é feita sem RLS.
    const servico = await rest.clienteDeServico();
    const { data } = await servico.from("crm_leads").select("id, title").eq("id", B.negocio);
    expect(() => naoVaza(JSON.stringify(data), "controle")).toThrow();
  });
});

describe("cada leitura do catálogo, com o cliente de sessão de uma pessoa da empresa A", () => {
  for (const cap of LEITURAS_MCP) {
    const prova = PROVAS[cap.nome];
    if (!prova) continue;
    const quem = QUEM[prova.papel];

    it(`${cap.nome}: lê o dado da própria empresa (controle positivo)`, async () => {
      const json = await ler(cap.nome, prova.proprio, quem, prova.papel);
      expect(json, `${cap.nome} recusou ou falhou no controle positivo: ${json.slice(0, 300)}`).toContain('"ok":true');
      if (typeof prova.espera === "string") expect(json).toContain(prova.espera);
      else prova.espera(json);
      naoVaza(json, `${cap.nome} (próprio)`);
    });

    it(`${cap.nome}: não alcança a outra empresa por id, por lista nem por texto`, async () => {
      for (const ataque of prova.ataques) {
        naoVaza(await ler(cap.nome, ataque, quem, prova.papel), `${cap.nome} ${JSON.stringify(ataque)}`);
      }
    });

    it(`${cap.nome}: todo campo de id da entrada, apontado para a outra empresa, não devolve nada dela`, async () => {
      const formato = (cap.entrada as unknown as { shape: Record<string, { safeParse: (v: unknown) => { success: boolean } }> }).shape;
      for (const [campo, tipo] of Object.entries(formato)) {
        if (!tipo.safeParse(B.negocio).success || tipo.safeParse("texto livre").success) continue;
        for (const id of Object.values(B)) {
          naoVaza(await ler(cap.nome, { ...prova.proprio, [campo]: id }, quem, prova.papel), `${cap.nome} ${campo}=${id}`);
        }
      }
    });
  }
});

describe("defesa em profundidade: a RLS segura mesmo se o contexto viesse com a empresa errada", () => {
  // O contexto do Vix nunca recebe a empresa de argumento. Este caso mede a
  // segunda trava: se, por defeito de código, a empresa B chegasse ao contexto
  // com a SESSÃO de uma pessoa da empresa A, a RLS ainda não entregaria nada.
  it("toda leitura, com a organização B no contexto e a sessão de A, não devolve dado de B", async () => {
    for (const cap of LEITURAS_MCP) {
      const prova = PROVAS[cap.nome];
      if (!prova) continue;
      const base = await ctx(QUEM[prova.papel], prova.papel);
      for (const args of [prova.proprio, ...prova.ataques]) {
        const r = await executarLeitura(cap.nome, args, { ...base, orgId: ORG_B }, deps);
        naoVaza(JSON.stringify(r), `${cap.nome} com a organização B no contexto ${JSON.stringify(args)}`);
      }
    }
  });

  it("controle: com a organização B no contexto e a CHAVE DE SERVIÇO, o dado de B aparece", async () => {
    // É o que a chave de serviço faria, e o motivo de o Vix não usá-la.
    const servico = await rest.clienteDeServico();
    const base = await ctx(GOV_AGENT_A, "agent");
    const r = await executarLeitura("crm_get_lead", { lead_id: B.negocio }, { ...base, orgId: ORG_B, db: servico }, deps);
    expect(JSON.stringify(r)).toContain(MARCA_B);
  });
});

describe("papel: o Vix não dá ao atendente o que a tela não dá", () => {
  it("leituras de gerente recusam o atendente e o leitor, e nada é lido", async () => {
    for (const cap of LEITURAS_MCP.filter((c) => c.papelMinimo === "manager")) {
      const prova = PROVAS[cap.nome];
      if (!prova) continue;
      for (const [quem, papel] of [[GOV_AGENT_A, "agent"], [GOV_VIEWER, "viewer"]] as const) {
        expect(JSON.parse(await ler(cap.nome, prova.proprio, quem, papel))).toEqual({
          ok: false,
          motivo: "papel_insuficiente",
        });
      }
    }
  });

  it("nenhuma leitura do catálogo é oferecida ao leitor (viewer)", async () => {
    for (const cap of LEITURAS_MCP) {
      const prova = PROVAS[cap.nome];
      if (!prova) continue;
      expect(JSON.parse(await ler(cap.nome, prova.proprio, GOV_VIEWER, "viewer")).ok, cap.nome).toBe(false);
    }
  });
});

describe("visibilidade por atendente: vale pelo Vix como vale pela tela", () => {
  // `seedGov` deixa uma conversa atribuída ao atendente B. No modo padrão da
  // organização (`own_and_unassigned`, `fn_can_view_conversation`), o atendente
  // A não a vê pela tela: a RLS só mostra ao atendente as dele e as sem dono.
  // Pela chave de serviço ele a veria; pelo Vix, com o cliente de sessão, não.

  it("controle: o dono da conversa (atendente B) a lê pelo Vix", async () => {
    const json = await ler("crm_get_conversation", { conversation_id: GOV_CONV_AGENT_B }, GOV_AGENT_B, "agent");
    expect(json).toContain('"ok":true');
    expect(json).toContain(GOV_CONV_AGENT_B);
  });

  it("controle: a chave de serviço enxerga a conversa (é a RLS que decide, não a ausência do dado)", async () => {
    const servico = await rest.clienteDeServico();
    const { data } = await servico.from("conversations").select("id").eq("id", GOV_CONV_AGENT_B);
    expect(data).toHaveLength(1);
  });

  it("o atendente A não lê a conversa do colega: nem por id, nem na lista, nem o histórico", async () => {
    for (const [nome, args] of [
      ["crm_get_conversation", { conversation_id: GOV_CONV_AGENT_B }],
      ["crm_get_conversation_history", { conversation_id: GOV_CONV_AGENT_B }],
      ["crm_list_conversations", {}],
    ] as const) {
      const json = await ler(nome, args, GOV_AGENT_A, "agent");
      expect(json, `${nome} entregou ao atendente A a conversa do atendente B`).not.toContain(GOV_CONV_AGENT_B);
    }
  });

  it("o gerente, que a tela deixa ver tudo, lê a conversa pelo Vix", async () => {
    const json = await ler("crm_get_conversation", { conversation_id: GOV_CONV_AGENT_B }, GOV_MANAGER, "manager");
    expect(json).toContain(GOV_CONV_AGENT_B);
  });
});

describe("o catálogo e as provas são a mesma lista", () => {
  it("toda leitura do catálogo tem prova neste arquivo", () => {
    expect(LEITURAS_MCP.map((c) => c.nome).filter((n) => !PROVAS[n])).toEqual([]);
  });

  it("não sobra prova de capacidade que saiu do catálogo", () => {
    const nomes = new Set(LEITURAS_MCP.map((c) => c.nome));
    expect(Object.keys(PROVAS).filter((n) => !nomes.has(n))).toEqual([]);
  });

  it("o papel da prova é o papel mínimo declarado no catálogo", () => {
    for (const cap of LEITURAS_MCP) expect(PROVAS[cap.nome]?.papel, cap.nome).toBe(cap.papelMinimo);
  });
});
