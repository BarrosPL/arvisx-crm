import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DependenciasDoExecutor as Deps } from "@/lib/assistente/executor";
import type { ContextoDoAssistente as Ctx, PapelHumano as Papel } from "@/lib/assistente/tipos";

import { subirPostgrest, type PostgrestEfemero } from "../db/postgrest-efemero";
import { GOV_AGENT_A, GOV_MANAGER, GOV_ORG, GOV_SESSION, GOV_VIEWER, seedGov, sql } from "./gov-helpers";

/**
 * AS CAPACIDADES PRÓPRIAS DO VIX QUE LEEM O BANCO, UMA A UMA: não alcançam
 * outra empresa, respeitam o papel e não devolvem segredo.
 *
 * Mesmo instrumento de `assistente-leituras-isolamento.test.ts`: executor do
 * Vix, capacidade real, PostgREST real, RLS, JWT de uma pessoa. As três que
 * não tocam o banco com a sessão (ajuda, guia de telas, plano) são medidas em
 * `lib/assistente/capacidades/proprias.test.ts`.
 *
 * Abrir chamado é a única escrita daqui. Ela grava com a chave de serviço (a
 * tabela é do servidor); o teste troca `createAdminClient` pelo cliente de
 * serviço do PostgREST do teste e mede a linha gravada: organização e usuário
 * são os da SESSÃO, nunca um argumento.
 */

const servico = vi.hoisted(() => ({ cliente: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => servico.cliente,
  isServiceRoleConfigured: () => true,
}));

const { CAPACIDADES_PROPRIAS } = await import("@/lib/assistente/capacidades/proprias");
const { executarLeitura, proporEscrita } = await import("@/lib/assistente/executor");
const { executarConfirmada } = await import("@/lib/assistente/confirmar");

const ORG_B = "b2770000-0000-4000-8000-00000000000b";
const USER_B = "b2770000-1111-4000-8000-00000000000b";
const SESS_B = "b2770000-2222-4000-8000-00000000000b";
const CONV_A = "a2770000-4444-4000-8000-000000000001";
const CONV_B = "b2770000-4444-4000-8000-000000000001";
const CONTATO_A = "a2770000-3333-4000-8000-000000000001";
const CONTATO_B = "b2770000-3333-4000-8000-000000000001";
const AGENTE_B = "b2770000-9999-4000-8000-000000000001";
const CRED_B = "b2770000-aaaa-4000-8000-000000000001";
const CONVERSA_DO_VIX = "a2770000-bbbb-4000-8000-000000000001";

const MARCA_A = "PROPRIO-A";
const MARCA_B = "VITIMA-B";
const IDS_DA_VITIMA = [ORG_B, USER_B, SESS_B, CONV_B, CONTATO_B, AGENTE_B, CRED_B];

let rest: PostgrestEfemero;
const clientes = new Map<string, SupabaseClient>();
const cartoes: Array<Record<string, unknown>> = [];

const deps: Deps = {
  catalogo: CAPACIDADES_PROPRIAS,
  foraDoPlano: async () => false,
  modulosLigados: [],
  capacidadesDaEmpresa: [],
  escritasLigadas: false,
  limiteDeLote: 5,
  auditar: () => undefined,
  gravarCartao: async (c) => {
    cartoes.push(c as never);
    return "cartao";
  },
};

async function ctx(userId: string, papel: Papel, orgId = GOV_ORG): Promise<Ctx> {
  let db = clientes.get(userId);
  if (!db) {
    db = await rest.clienteDeSessao(userId);
    clientes.set(userId, db);
  }
  return { orgId, userId, papel, idioma: "pt-BR", requestId: "proprias", db };
}

async function ler(nome: string, args: Record<string, unknown>, quem: string, papel: Papel, orgId = GOV_ORG): Promise<string> {
  return JSON.stringify(await executarLeitura(nome, args, await ctx(quem, papel, orgId), deps));
}

function naoVaza(json: string, contexto: string): void {
  expect(json, `${contexto}: traz a marca da outra empresa`).not.toContain(MARCA_B);
  for (const id of IDS_DA_VITIMA) expect(json, `${contexto}: traz id da outra empresa (${id})`).not.toContain(id);
}

beforeAll(async () => {
  seedGov();
  sql(`
    insert into auth.users (id, email) values ('${USER_B}', 'vix-proprias-b@invariant.test') on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'vix-proprias-b', 'Vix Proprias B', 'Vix B') on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USER_B}', '${ORG_B}', 'admin', now()) on conflict do nothing;
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted, display_name, status)
      values ('${SESS_B}', '${ORG_B}', 'vix-proprias-b', '\\x00'::bytea, '${MARCA_B} conexao', 'FAILED') on conflict (id) do nothing;
    update public.channel_sessions set display_name = '${MARCA_A} conexao', status = 'FAILED' where id = '${GOV_SESSION}';

    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_A}', '${GOV_ORG}', '${MARCA_A} contato'), ('${CONTATO_B}', '${ORG_B}', '${MARCA_B} contato')
      on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status) values
      ('${CONV_A}', '${GOV_ORG}', '${CONTATO_A}', '${GOV_SESSION}', 'open'),
      ('${CONV_B}', '${ORG_B}', '${CONTATO_B}', '${SESS_B}', 'open')
      on conflict do nothing;
    insert into public.agent_turn_traces
      (organization_id, preview_run_id, conversation_id, contact_id, is_dry_run, status, messages_sent, error_message) values
      ('${GOV_ORG}', 'vix-proprias-a', '${CONV_A}', '${CONTATO_A}', true, 'failed', 0, '${MARCA_A} motivo da falha'),
      ('${ORG_B}', 'vix-proprias-b', '${CONV_B}', '${CONTATO_B}', true, 'failed', 0, '${MARCA_B} motivo da falha');

    insert into public.ai_agents (organization_id, name, system_prompt) values ('${GOV_ORG}', '${MARCA_A} agente', 'p');
    insert into public.ai_agents (id, organization_id, name, system_prompt) values ('${AGENTE_B}', '${ORG_B}', '${MARCA_B} agente', 'p');

    insert into public.ai_provider_credentials
      (organization_id, provider, label, api_key_encrypted, api_key_iv, api_key_tag, api_key_last4, is_active, validated_at)
      values ('${GOV_ORG}', 'anthropic', '${MARCA_A} chave', '\\x5345475245444f'::bytea, '\\x02'::bytea, '\\x03'::bytea, '4242', true, now());
    insert into public.ai_provider_credentials
      (id, organization_id, provider, label, api_key_encrypted, api_key_iv, api_key_tag, api_key_last4, is_active, validated_at)
      values ('${CRED_B}', '${ORG_B}', 'openai', '${MARCA_B} chave', '\\x01'::bytea, '\\x02'::bytea, '\\x03'::bytea, '9191', true, now());

    insert into public.assistente_conversas (id, organization_id, user_id)
      values ('${CONVERSA_DO_VIX}', '${GOV_ORG}', '${GOV_AGENT_A}') on conflict do nothing;
  `);
  rest = await subirPostgrest();
  servico.cliente = await rest.clienteDeServico();
}, 240_000);

afterAll(() => rest?.derrubar());

describe("diagnostico_canais", () => {
  it("o leitor (viewer) lê as conexões da própria empresa, com a que está fora do ar", async () => {
    const json = await ler("diagnostico_canais", {}, GOV_VIEWER, "viewer");
    expect(json).toContain('"ok":true');
    expect(json).toContain(`${MARCA_A} conexao`);
    expect(JSON.parse(json).dados.fora_do_ar).toHaveLength(1);
    naoVaza(json, "diagnostico_canais");
  });

  it("com a organização B no contexto e a sessão de A, não devolve conexão de B", async () => {
    naoVaza(await ler("diagnostico_canais", {}, GOV_VIEWER, "viewer", ORG_B), "diagnostico_canais com org B");
  });
});

describe("diagnostico_turno", () => {
  it("o gerente lê o traço da conversa da própria empresa", async () => {
    const json = await ler("diagnostico_turno", { conversation_id: CONV_A }, GOV_MANAGER, "manager");
    expect(json).toContain(`${MARCA_A} motivo da falha`);
    naoVaza(json, "diagnostico_turno");
  });

  it("com o id da conversa da outra empresa, não devolve o traço dela", async () => {
    const json = await ler("diagnostico_turno", { conversation_id: CONV_B }, GOV_MANAGER, "manager");
    expect(JSON.parse(json)).toEqual({ ok: true, dados: { turnos: [] } });
    naoVaza(await ler("diagnostico_turno", { conversation_id: CONV_B }, GOV_MANAGER, "manager", ORG_B), "org B no contexto");
  });

  it("atendente e leitor não leem o traço (a tela é de gerente para cima)", async () => {
    for (const [quem, papel] of [[GOV_AGENT_A, "agent"], [GOV_VIEWER, "viewer"]] as const) {
      expect(JSON.parse(await ler("diagnostico_turno", { conversation_id: CONV_A }, quem, papel))).toEqual({
        ok: false,
        motivo: "papel_insuficiente",
      });
    }
  });
});

describe("configuracao_credencial_de_ia", () => {
  it("o gerente lê o ESTADO da credencial da própria empresa, e nenhum pedaço do segredo", async () => {
    const json = await ler("configuracao_credencial_de_ia", {}, GOV_MANAGER, "manager");
    const dados = JSON.parse(json).dados;
    expect(dados.ia_configurada).toBe(true);
    expect(dados.provedores[0]).toMatchObject({ provedor: "anthropic", ativa: true, validada: true });
    // Nem o fim da chave, nem o envelope cifrado, nem o nome das colunas dele.
    for (const proibido of ["4242", "5345475245444f", "SEGREDO", "api_key", "encrypted", "last4"]) {
      expect(json, `a resposta traz "${proibido}"`).not.toContain(proibido);
    }
    naoVaza(json, "configuracao_credencial_de_ia");
  });

  it("não devolve a credencial da outra empresa, nem com a organização B no contexto", async () => {
    const json = await ler("configuracao_credencial_de_ia", {}, GOV_MANAGER, "manager", ORG_B);
    expect(JSON.parse(json).dados.ia_configurada).toBe(false);
    expect(json).not.toContain("9191");
    naoVaza(json, "configuracao_credencial_de_ia com org B");
  });

  it("atendente não lê", async () => {
    expect(JSON.parse(await ler("configuracao_credencial_de_ia", {}, GOV_AGENT_A, "agent")).motivo).toBe("papel_insuficiente");
  });
});

describe("configuracao_agentes", () => {
  it("o gerente lê os agentes da própria empresa e nenhum da outra", async () => {
    const json = await ler("configuracao_agentes", {}, GOV_MANAGER, "manager");
    expect(json).toContain(`${MARCA_A} agente`);
    naoVaza(json, "configuracao_agentes");
    naoVaza(await ler("configuracao_agentes", {}, GOV_MANAGER, "manager", ORG_B), "configuracao_agentes com org B");
  });

  it("atendente não lê", async () => {
    expect(JSON.parse(await ler("configuracao_agentes", {}, GOV_AGENT_A, "agent")).motivo).toBe("papel_insuficiente");
  });
});

describe("suporte_abrir_chamado: escrita só no clique, na empresa e no usuário da sessão", () => {
  const chamadosDe = (org: string) => Number(sql(`select count(*) from public.assistente_chamados where organization_id = '${org}';`));

  it("propor NÃO abre chamado: só nasce o cartão", async () => {
    const antes = chamadosDe(GOV_ORG);
    const r = await proporEscrita(
      "suporte_abrir_chamado",
      { resumo: "O agente não responde desde ontem", diagnostico: ["conexão fora do ar"] },
      CONVERSA_DO_VIX,
      await ctx(GOV_AGENT_A, "agent"),
      deps,
    );
    expect(r.ok).toBe(true);
    expect(cartoes).toHaveLength(1);
    expect(chamadosDe(GOV_ORG)).toBe(antes);
  });

  it("argumento que nomeia empresa ou usuário é recusado", async () => {
    for (const extra of [{ organization_id: ORG_B }, { user_id: USER_B }, { empresa: "B" }]) {
      const r = await proporEscrita(
        "suporte_abrir_chamado",
        { resumo: "Chamado forjado para outra empresa", ...extra },
        CONVERSA_DO_VIX,
        await ctx(GOV_AGENT_A, "agent"),
        deps,
      );
      expect(r).toMatchObject({ ok: false, motivo: "entrada_invalida" });
    }
  });

  it("confirmado pelo dono, grava UM chamado na organização e no usuário da sessão, e nenhum na outra empresa", async () => {
    const acao = sql(`
      insert into public.assistente_acoes
        (organization_id, conversa_id, user_id, capacidade, nivel, entrada, resumo, expira_em)
      values ('${GOV_ORG}', '${CONVERSA_DO_VIX}', '${GOV_AGENT_A}', 'suporte_abrir_chamado', 'escrever',
              '{"resumo":"O agente não responde desde ontem"}'::jsonb, 'abrir chamado', now() + interval '10 minutes')
      returning id;
    `).split(/\r?\n/)[0]!;
    const antesA = chamadosDe(GOV_ORG);
    const antesB = chamadosDe(ORG_B);
    const admin = servico.cliente as SupabaseClient;

    const r = await executarConfirmada(admin, acao, undefined, await ctx(GOV_AGENT_A, "agent"), deps);
    expect(r).toMatchObject({ ok: true, capacidade: "suporte_abrir_chamado" });
    expect(chamadosDe(GOV_ORG)).toBe(antesA + 1);
    expect(chamadosDe(ORG_B)).toBe(antesB);
    expect(
      sql(`select user_id from public.assistente_chamados where organization_id = '${GOV_ORG}' order by created_at desc limit 1;`),
    ).toBe(GOV_AGENT_A);
    expect(sql(`select estado from public.assistente_acoes where id = '${acao}';`)).toBe("executada");

    // O mesmo cartão, de novo: o banco não reserva e nada mais é gravado.
    const repetido = await executarConfirmada(admin, acao, undefined, await ctx(GOV_AGENT_A, "agent"), deps);
    expect(repetido).toEqual({ ok: false, motivo: "cartao_indisponivel" });
    expect(chamadosDe(GOV_ORG)).toBe(antesA + 1);
  });

  it("o cartão de A, confirmado por outro usuário ou por uma pessoa de outra empresa, não abre chamado", async () => {
    const acao = sql(`
      insert into public.assistente_acoes
        (organization_id, conversa_id, user_id, capacidade, nivel, entrada, resumo, expira_em)
      values ('${GOV_ORG}', '${CONVERSA_DO_VIX}', '${GOV_AGENT_A}', 'suporte_abrir_chamado', 'escrever',
              '{"resumo":"Chamado que outra pessoa tenta confirmar"}'::jsonb, 'abrir chamado', now() + interval '10 minutes')
      returning id;
    `).split(/\r?\n/)[0]!;
    const antesA = chamadosDe(GOV_ORG);
    const antesB = chamadosDe(ORG_B);
    const admin = servico.cliente as SupabaseClient;

    expect(await executarConfirmada(admin, acao, undefined, await ctx(GOV_MANAGER, "manager"), deps)).toEqual({
      ok: false,
      motivo: "cartao_indisponivel",
    });
    expect(await executarConfirmada(admin, acao, undefined, await ctx(USER_B, "admin", ORG_B), deps)).toEqual({
      ok: false,
      motivo: "cartao_indisponivel",
    });
    expect(chamadosDe(GOV_ORG)).toBe(antesA);
    expect(chamadosDe(ORG_B)).toBe(antesB);
    expect(sql(`select estado from public.assistente_acoes where id = '${acao}';`)).toBe("proposta");
  });
});
