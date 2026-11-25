import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_AGENT_A,
  GOV_AGENT_B,
  GOV_MANAGER,
  GOV_ORG,
  countAs,
  lastLine,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/**
 * AS TABELAS DO VIX (migration 9830): QUEM LÊ O QUÊ, E O CARTÃO QUE VALE UMA VEZ.
 *
 * O Vix guarda conversa, mensagem e cartão de ação por USUÁRIO. Três coisas são
 * medidas aqui com dois tenants reais e o papel `authenticated` com o JWT de
 * cada pessoa, o mesmo caminho da produção:
 *
 *  1. a outra empresa lê ZERO, e o colega da MESMA empresa lê zero da conversa
 *     alheia (controle positivo: o dono lê a própria);
 *  2. a sessão não escreve em tabela nenhuma do Vix: quem grava é o servidor;
 *  3. o cartão de ação (`fn_assistente_reservar_acao`) é reservado uma vez só,
 *     e só pelo usuário e pela organização que o receberam, dentro do prazo.
 *
 * Também: a configuração por plano é só do servidor, o custo só o servidor
 * grava, e nenhuma linha de plano é semeada (plano sem linha = o Vix não responde).
 */

const ORG_B = "a7700000-0000-4000-8000-00000000000b";
const USER_B = "a7700000-1111-4000-8000-00000000000b";

const CONVERSA_DE_A = "a7700000-2222-4000-8000-000000000001";
const CONVERSA_DE_B = "a7700000-2222-4000-8000-000000000002";

const TABELAS_COM_DONO = ["assistente_conversas", "assistente_mensagens", "assistente_acoes"] as const;

function novoCartao(opts: { org: string; user: string; conversa: string; prazo?: string }): string {
  // `returning id` imprime o id e, depois, o rodapé `INSERT 0 1`: vale a primeira linha.
  return primeiraLinha(
    sql(`
      insert into public.assistente_acoes
        (organization_id, conversa_id, user_id, capacidade, nivel, resumo, expira_em)
      values ('${opts.org}', '${opts.conversa}', '${opts.user}', 'teste.escrever', 'escrever',
              'cartão de teste', ${opts.prazo ?? "now() + interval '10 minutes'"})
      returning id;
    `),
  );
}

function primeiraLinha(saida: string): string {
  const linha = saida.split(/\r?\n/)[0];
  if (!linha || !/^[0-9a-f-]{36}$/.test(linha)) throw new Error(`saída inesperada do psql: ${saida}`);
  return linha;
}

/** Quantas linhas a reserva devolveu, como o servidor a chama (service_role). */
function reservar(org: string, user: string, acao: string): number {
  return Number(
    lastLine(
      sql(`
        set role service_role;
        select count(*) from public.fn_assistente_reservar_acao('${org}', '${user}', '${acao}');
      `),
    ),
  );
}

function estadoDoCartao(acao: string): string {
  return sql(`select estado from public.assistente_acoes where id = '${acao}';`);
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into auth.users (id, email) values ('${USER_B}', 'vix-b@invariant.test') on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'vix-org-b', 'Vix Org B', 'Vix B') on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USER_B}', '${ORG_B}', 'admin', now()) on conflict do nothing;

    insert into public.assistente_conversas (id, organization_id, user_id, titulo) values
      ('${CONVERSA_DE_A}', '${GOV_ORG}', '${GOV_AGENT_A}', 'conversa do atendente A'),
      ('${CONVERSA_DE_B}', '${ORG_B}', '${USER_B}', 'conversa da outra empresa')
      on conflict do nothing;
    insert into public.assistente_mensagens (organization_id, conversa_id, user_id, turn_id, autor, corpo) values
      ('${GOV_ORG}', '${CONVERSA_DE_A}', '${GOV_AGENT_A}', gen_random_uuid(), 'usuario', 'pergunta de A'),
      ('${ORG_B}', '${CONVERSA_DE_B}', '${USER_B}', gen_random_uuid(), 'usuario', 'pergunta de B');
    insert into public.assistente_acoes (organization_id, conversa_id, user_id, capacidade, nivel, resumo, expira_em) values
      ('${GOV_ORG}', '${CONVERSA_DE_A}', '${GOV_AGENT_A}', 'teste.escrever', 'escrever', 'de A', now() + interval '10 minutes'),
      ('${ORG_B}', '${CONVERSA_DE_B}', '${USER_B}', 'teste.escrever', 'escrever', 'de B', now() + interval '10 minutes');
    insert into public.assistente_chamados (organization_id, user_id, resumo) values
      ('${GOV_ORG}', '${GOV_AGENT_A}', 'chamado de A'),
      ('${ORG_B}', '${USER_B}', 'chamado de B');
    insert into public.assistente_estado_da_empresa (organization_id, ligado) values
      ('${GOV_ORG}', true), ('${ORG_B}', false) on conflict do nothing;
    insert into public.assistente_custos (organization_id, provedor, modelo, custo_usd_cents) values
      ('${GOV_ORG}', 'anthropic', 'modelo-de-teste', 12.5),
      ('${GOV_ORG}', 'anthropic', 'modelo-de-teste', 7.5),
      ('${ORG_B}', 'anthropic', 'modelo-de-teste', 100);
  `);
});

describe("leitura das tabelas do Vix pela sessão", () => {
  for (const tabela of TABELAS_COM_DONO) {
    it(`${tabela}: o dono lê a própria linha (controle positivo)`, () => {
      expect(countAs(GOV_AGENT_A, `select count(*) from public.${tabela};`)).toBeGreaterThan(0);
      expect(countAs(USER_B, `select count(*) from public.${tabela};`)).toBeGreaterThan(0);
    });

    it(`${tabela}: a outra empresa lê zero`, () => {
      expect(
        countAs(USER_B, `select count(*) from public.${tabela} where organization_id = '${GOV_ORG}';`),
      ).toBe(0);
      expect(
        countAs(GOV_AGENT_A, `select count(*) from public.${tabela} where organization_id = '${ORG_B}';`),
      ).toBe(0);
    });

    it(`${tabela}: o colega da mesma empresa lê zero, nem o gerente`, () => {
      expect(countAs(GOV_AGENT_B, `select count(*) from public.${tabela};`)).toBe(0);
      expect(countAs(GOV_MANAGER, `select count(*) from public.${tabela};`)).toBe(0);
    });
  }

  it("chamado: o autor e o gerente da empresa leem; o colega atendente e a outra empresa, não", () => {
    const q = "select count(*) from public.assistente_chamados;";
    expect(countAs(GOV_AGENT_A, q)).toBe(1);
    expect(countAs(GOV_MANAGER, q)).toBe(1);
    expect(countAs(GOV_AGENT_B, q)).toBe(0);
    expect(countAs(USER_B, `select count(*) from public.assistente_chamados where organization_id = '${GOV_ORG}';`)).toBe(0);
  });

  it("estado da empresa: cada empresa lê só o dela", () => {
    expect(countAs(GOV_AGENT_A, "select count(*) from public.assistente_estado_da_empresa;")).toBe(1);
    expect(
      countAs(GOV_AGENT_A, `select count(*) from public.assistente_estado_da_empresa where organization_id = '${ORG_B}';`),
    ).toBe(0);
  });

  it("uso do Vix: a empresa lê o próprio e zero da outra; a configuração por plano não é legível", () => {
    expect(countAs(GOV_MANAGER, `select count(*) from public.assistente_custos where organization_id = '${GOV_ORG}';`)).toBe(2);
    expect(countAs(GOV_MANAGER, `select count(*) from public.assistente_custos where organization_id = '${ORG_B}';`)).toBe(0);
    expect(() => countAs(GOV_MANAGER, "select count(*) from public.assistente_planos;")).toThrow(/permission denied/);
  });

  it("anon não lê nada do Vix", () => {
    for (const tabela of [...TABELAS_COM_DONO, "assistente_chamados", "assistente_estado_da_empresa", "assistente_progresso"]) {
      expect(() => sql(`set role anon; select count(*) from public.${tabela};`)).toThrow(/permission denied/);
    }
  });
});

describe("a sessão não escreve nas tabelas do Vix", () => {
  it("inserir conversa, cartão ou custo pela sessão é recusado", () => {
    expect(() =>
      writeCountAs(
        GOV_MANAGER,
        `insert into public.assistente_custos (organization_id, provedor, modelo) values ('${GOV_ORG}', 'x', 'y')`,
      ),
    ).toThrow(/permission denied/);
    expect(() =>
      writeCountAs(
        GOV_AGENT_A,
        `insert into public.assistente_conversas (organization_id, user_id) values ('${GOV_ORG}', '${GOV_AGENT_A}')`,
      ),
    ).toThrow(/permission denied/);
    expect(() =>
      writeCountAs(
        GOV_AGENT_A,
        `insert into public.assistente_acoes (organization_id, conversa_id, user_id, capacidade, nivel, resumo, expira_em)
         values ('${GOV_ORG}', '${CONVERSA_DE_A}', '${GOV_AGENT_A}', 'x', 'escrever', 'forjado', now() + interval '1 hour')`,
      ),
    ).toThrow(/permission denied/);
  });

  it("o dono não muda o estado do próprio cartão pela sessão", () => {
    expect(() =>
      writeCountAs(GOV_AGENT_A, `update public.assistente_acoes set estado = 'executada' where organization_id = '${GOV_ORG}'`),
    ).toThrow(/permission denied/);
  });

  it("a sessão não chama a reserva do cartão nem as funções de custo e plano", () => {
    const acao = novoCartao({ org: GOV_ORG, user: GOV_AGENT_A, conversa: CONVERSA_DE_A });
    for (const chamada of [
      `select count(*) from public.fn_assistente_reservar_acao('${GOV_ORG}', '${GOV_AGENT_A}', '${acao}');`,
      `select public.fn_assistente_gasto_do_mes('${GOV_ORG}');`,
      `select count(*) from public.fn_assistente_plano_da_org('${GOV_ORG}');`,
    ]) {
      expect(() => countAs(GOV_AGENT_A, chamada)).toThrow(/permission denied/);
    }
    expect(estadoDoCartao(acao)).toBe("proposta");
  });
});

describe("o cartão de ação vale uma vez, para quem o recebeu, dentro do prazo", () => {
  it("o dono reserva (controle positivo) e o estado vira confirmada", () => {
    const acao = novoCartao({ org: GOV_ORG, user: GOV_AGENT_A, conversa: CONVERSA_DE_A });
    expect(reservar(GOV_ORG, GOV_AGENT_A, acao)).toBe(1);
    expect(estadoDoCartao(acao)).toBe("confirmada");
  });

  it("cartão repetido: a segunda reserva não devolve nada", () => {
    const acao = novoCartao({ org: GOV_ORG, user: GOV_AGENT_A, conversa: CONVERSA_DE_A });
    expect(reservar(GOV_ORG, GOV_AGENT_A, acao)).toBe(1);
    expect(reservar(GOV_ORG, GOV_AGENT_A, acao)).toBe(0);
  });

  it("cartão expirado: recusa e o estado não muda", () => {
    const acao = novoCartao({
      org: GOV_ORG,
      user: GOV_AGENT_A,
      conversa: CONVERSA_DE_A,
      prazo: "now() - interval '1 second'",
    });
    expect(reservar(GOV_ORG, GOV_AGENT_A, acao)).toBe(0);
    expect(estadoDoCartao(acao)).toBe("proposta");
  });

  it("cartão de outro usuário da mesma empresa: recusa", () => {
    const acao = novoCartao({ org: GOV_ORG, user: GOV_AGENT_A, conversa: CONVERSA_DE_A });
    expect(reservar(GOV_ORG, GOV_AGENT_B, acao)).toBe(0);
    expect(reservar(GOV_ORG, GOV_MANAGER, acao)).toBe(0);
    expect(estadoDoCartao(acao)).toBe("proposta");
  });

  it("cartão de outra empresa: recusa, com o usuário certo e a organização errada, e o contrário", () => {
    const acao = novoCartao({ org: GOV_ORG, user: GOV_AGENT_A, conversa: CONVERSA_DE_A });
    expect(reservar(ORG_B, GOV_AGENT_A, acao)).toBe(0);
    expect(reservar(ORG_B, USER_B, acao)).toBe(0);
    expect(reservar(GOV_ORG, USER_B, acao)).toBe(0);
    expect(estadoDoCartao(acao)).toBe("proposta");
  });

  it("cartão cancelado não é reservado", () => {
    const acao = novoCartao({ org: GOV_ORG, user: GOV_AGENT_A, conversa: CONVERSA_DE_A });
    sql(`update public.assistente_acoes set estado = 'cancelada' where id = '${acao}';`);
    expect(reservar(GOV_ORG, GOV_AGENT_A, acao)).toBe(0);
  });
});

describe("custo e plano", () => {
  it("o gasto do mês soma só a própria empresa", () => {
    const gasto = (org: string) =>
      Number(lastLine(sql(`set role service_role; select public.fn_assistente_gasto_do_mes('${org}');`)));
    expect(gasto(GOV_ORG)).toBe(20);
    expect(gasto(ORG_B)).toBe(100);
  });

  it("o custo do Vix não entra no orçamento de IA da empresa", () => {
    // A tabela é própria justamente para isto: nem `llm_calls` nem `ai_budgets`
    // recebem linha por causa de um custo do assistente.
    expect(sql(`select count(*) from public.llm_calls where organization_id in ('${GOV_ORG}', '${ORG_B}');`)).toBe("0");
    expect(sql(`select count(*) from public.ai_budgets where organization_id in ('${GOV_ORG}', '${ORG_B}');`)).toBe("0");
  });

  it("nenhuma configuração de plano é semeada: sem linha, a organização não tem plano do Vix", () => {
    expect(sql("select count(*) from public.assistente_planos;")).toBe("0");
    expect(
      lastLine(sql(`set role service_role; select count(*) from public.fn_assistente_plano_da_org('${GOV_ORG}');`)),
    ).toBe("0");
  });

  it("com a linha sem plano, a organização sem assinatura a recebe; apagada, volta a não ter", () => {
    sql(`insert into public.assistente_planos (plano_id, pagador, teto_mensal_usd_cents) values (null, 'plataforma', 500);`);
    try {
      expect(
        lastLine(
          sql(`set role service_role; select teto_mensal_usd_cents from public.fn_assistente_plano_da_org('${GOV_ORG}');`),
        ),
      ).toBe("500");
    } finally {
      sql("delete from public.assistente_planos;");
    }
    expect(
      lastLine(sql(`set role service_role; select count(*) from public.fn_assistente_plano_da_org('${GOV_ORG}');`)),
    ).toBe("0");
  });
});
