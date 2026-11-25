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
 * Também: o limite mensal de mensagens (conta e recusa no banco), a
 * configuração por plano só do servidor, e nenhuma linha de plano semeada
 * (plano sem linha = o Vix não responde).
 */

const ORG_B = "a7700000-0000-4000-8000-00000000000b";
const USER_B = "a7700000-1111-4000-8000-00000000000b";

const CONVERSA_DE_A = "a7700000-2222-4000-8000-000000000001";
const CONVERSA_DE_B = "a7700000-2222-4000-8000-000000000002";
const PLANO = "a7700000-3333-4000-8000-000000000001";
const PLANO_SEM_LINHA = "a7700000-3333-4000-8000-000000000002";

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
    insert into public.assistente_usos (organization_id, pagador) values
      ('${GOV_ORG}', 'teste'), ('${GOV_ORG}', 'teste'), ('${ORG_B}', 'teste');
    -- Uma mensagem do mês PASSADO: não pode entrar na conta deste mês.
    insert into public.assistente_usos (organization_id, pagador, created_at)
      values ('${GOV_ORG}', 'teste', date_trunc('month', now()) - interval '1 second');
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
    expect(countAs(GOV_MANAGER, `select count(*) from public.assistente_usos where organization_id = '${GOV_ORG}';`)).toBe(3);
    expect(countAs(GOV_MANAGER, `select count(*) from public.assistente_usos where organization_id = '${ORG_B}';`)).toBe(0);
    expect(() => countAs(GOV_MANAGER, "select count(*) from public.assistente_planos;")).toThrow(/permission denied/);
  });

  it("anon não lê nada do Vix", () => {
    for (const tabela of [...TABELAS_COM_DONO, "assistente_chamados", "assistente_estado_da_empresa", "assistente_progresso"]) {
      expect(() => sql(`set role anon; select count(*) from public.${tabela};`)).toThrow(/permission denied/);
    }
  });
});

describe("a sessão não escreve nas tabelas do Vix", () => {
  it("inserir conversa, cartão ou uso pela sessão é recusado", () => {
    expect(() =>
      writeCountAs(
        GOV_MANAGER,
        `insert into public.assistente_usos (organization_id, pagador) values ('${GOV_ORG}', 'forjado')`,
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

  it("a sessão não chama a reserva do cartão nem as funções de uso e plano", () => {
    const acao = novoCartao({ org: GOV_ORG, user: GOV_AGENT_A, conversa: CONVERSA_DE_A });
    for (const chamada of [
      `select count(*) from public.fn_assistente_reservar_acao('${GOV_ORG}', '${GOV_AGENT_A}', '${acao}');`,
      `select public.fn_assistente_mensagens_do_mes('${GOV_ORG}');`,
      `select public.fn_assistente_registrar_mensagem('${GOV_ORG}', '${GOV_AGENT_A}', null, 'forjado', null);`,
      `select count(*) from public.fn_assistente_config_da_org('${GOV_ORG}');`,
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

describe("limite de mensagens por mês e plano", () => {
  const usadasNoMes = (org: string) =>
    Number(lastLine(sql(`set role service_role; select public.fn_assistente_mensagens_do_mes('${org}');`)));
  /** Registra uma mensagem como o servidor; devolve o id da linha de uso, ou "BARRADA" quando o limite barrou. */
  const registrar = (org: string, limite: number | null) =>
    lastLine(
      sql(`
        set role service_role;
        select coalesce(public.fn_assistente_registrar_mensagem('${org}', null, null, 'teste', ${limite ?? "null"})::text, 'BARRADA');
      `),
    );

  it("a contagem do mês é só da própria empresa e não inclui o mês passado", () => {
    // GOV_ORG tem 3 linhas, uma delas do mês passado.
    expect(usadasNoMes(GOV_ORG)).toBe(2);
    expect(usadasNoMes(ORG_B)).toBe(1);
  });

  it("abaixo do limite a mensagem é registrada (controle positivo); no limite, recusa e NÃO grava", () => {
    const antes = usadasNoMes(GOV_ORG);
    expect(registrar(GOV_ORG, antes + 1)).toMatch(/^[0-9a-f-]{36}$/);
    expect(usadasNoMes(GOV_ORG)).toBe(antes + 1);
    // Agora a empresa está exatamente no limite: a próxima não passa.
    expect(registrar(GOV_ORG, antes + 1)).toBe("BARRADA");
    expect(registrar(GOV_ORG, antes + 1)).toBe("BARRADA");
    expect(usadasNoMes(GOV_ORG)).toBe(antes + 1);
  });

  it("limite zero barra tudo; limite nulo é sem limite", () => {
    const antes = usadasNoMes(ORG_B);
    expect(registrar(ORG_B, 0)).toBe("BARRADA");
    expect(usadasNoMes(ORG_B)).toBe(antes);
    expect(registrar(ORG_B, null)).toMatch(/^[0-9a-f-]{36}$/);
    expect(registrar(ORG_B, null)).toMatch(/^[0-9a-f-]{36}$/);
    expect(usadasNoMes(ORG_B)).toBe(antes + 2);
  });

  it("o limite estourado de uma empresa não barra a outra", () => {
    const daA = usadasNoMes(GOV_ORG);
    expect(registrar(GOV_ORG, daA)).toBe("BARRADA");
    expect(registrar(ORG_B, usadasNoMes(ORG_B) + 1)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("o uso do Vix não entra no orçamento de IA da empresa", () => {
    // A tabela é própria justamente para isto: nem `llm_calls` nem `ai_budgets`
    // recebem linha por causa de uma mensagem do assistente.
    expect(sql(`select count(*) from public.llm_calls where organization_id in ('${GOV_ORG}', '${ORG_B}');`)).toBe("0");
    expect(sql(`select count(*) from public.ai_budgets where organization_id in ('${GOV_ORG}', '${ORG_B}');`)).toBe("0");
  });

  it("limite negativo não entra na configuração", () => {
    sql(`insert into public.cobranca_planos (id, nome, preco_cents, intervalo) values ('${PLANO}', 'Plano de teste do Vix', 1000, 'mes') on conflict do nothing;`);
    expect(() =>
      sql(`insert into public.assistente_planos (plano_id, mensagens_por_mes) values ('${PLANO}', -1);`),
    ).toThrow(/assistente_planos_limites_check/);
  });
});

describe("quem tem o Vix: a marca da plataforma ou o plano com linha, e mais ninguém", () => {
  /** A configuração como o servidor a lê: "origem:limite", ou "SEM_VIX". */
  const config = (org: string) =>
    lastLine(
      sql(`
        set role service_role;
        select coalesce(
          (select origem || ':' || coalesce(mensagens_por_mes::text, 'sem_limite') || ':' || limite_de_lote
             from public.fn_assistente_config_da_org('${org}')),
          'SEM_VIX');
      `),
    );
  const cobranca = (valor: "ligado" | "desligado") =>
    sql(`
      insert into public.platform_config (chave, valor, eh_segredo, semeado_do_env)
        values ('MODULO_COBRANCA', '${valor}', false, false)
      on conflict (chave) do update set valor = excluded.valor;
    `);
  const marca = (org: string, valor: boolean) =>
    sql(`
      insert into public.assistente_estado_da_empresa (organization_id, sem_limite) values ('${org}', ${valor})
      on conflict (organization_id) do update set sem_limite = excluded.sem_limite;
    `);

  beforeAll(() => {
    cobranca("ligado");
    sql(`
      insert into public.cobranca_planos (id, nome, preco_cents, intervalo) values
        ('${PLANO}', 'Plano de teste do Vix', 1000, 'mes'),
        ('${PLANO_SEM_LINHA}', 'Plano sem Vix', 1000, 'mes') on conflict do nothing;
      delete from public.assistente_planos;
      delete from public.cobranca_assinaturas where organization_id in ('${GOV_ORG}', '${ORG_B}');
    `);
    marca(GOV_ORG, false);
    marca(ORG_B, false);
  });

  it("nenhuma configuração é semeada e nenhuma organização nasce marcada", () => {
    expect(sql("select count(*) from public.assistente_planos;")).toBe("0");
    expect(sql("select count(*) from public.assistente_estado_da_empresa where sem_limite;")).toBe("0");
  });

  it("sem marca e sem plano: SEM VIX (organização isenta não ganha o assistente sozinha)", () => {
    expect(config(GOV_ORG)).toBe("SEM_VIX");
  });

  it("com plano assinado mas SEM linha em assistente_planos: SEM VIX", () => {
    sql(`insert into public.cobranca_assinaturas (organization_id, plano_id) values ('${GOV_ORG}', '${PLANO_SEM_LINHA}');`);
    expect(config(GOV_ORG)).toBe("SEM_VIX");
    sql(`delete from public.cobranca_assinaturas where organization_id = '${GOV_ORG}';`);
  });

  it("com plano e linha: responde com o limite DO PLANO; a outra empresa, sem plano, continua sem", () => {
    sql(`
      insert into public.assistente_planos (plano_id, mensagens_por_mes, limite_de_lote) values ('${PLANO}', 40, 3);
      insert into public.cobranca_assinaturas (organization_id, plano_id) values ('${GOV_ORG}', '${PLANO}');
    `);
    expect(config(GOV_ORG)).toBe("plano:40:3");
    expect(config(ORG_B)).toBe("SEM_VIX");
  });

  it("com a cobrança desligada na instalação, o plano não dá Vix a ninguém", () => {
    cobranca("desligado");
    try {
      expect(config(GOV_ORG)).toBe("SEM_VIX");
    } finally {
      cobranca("ligado");
    }
  });

  it("com a marca: responde SEM limite, tenha plano (vale a marca) ou não tenha", () => {
    marca(ORG_B, true);
    expect(config(ORG_B)).toBe("marca:sem_limite:5");
    marca(GOV_ORG, true);
    // Com plano e marca, o limite de mensagens é o da marca; o de lote segue o do plano.
    expect(config(GOV_ORG)).toBe("marca:sem_limite:3");
    marca(GOV_ORG, false);
    expect(config(GOV_ORG)).toBe("plano:40:3");
  });

  it("tirada a marca, a organização sem plano volta a não ter Vix", () => {
    marca(ORG_B, false);
    expect(config(ORG_B)).toBe("SEM_VIX");
  });

  it("a marca é da plataforma: a sessão lê a própria linha e não a escreve, nem o administrador da empresa", () => {
    marca(ORG_B, false);
    expect(countAs(USER_B, "select count(*) from public.assistente_estado_da_empresa where sem_limite = false;")).toBe(1);
    expect(() =>
      writeCountAs(USER_B, `update public.assistente_estado_da_empresa set sem_limite = true where organization_id = '${ORG_B}'`),
    ).toThrow(/permission denied/);
    expect(() =>
      writeCountAs(USER_B, `insert into public.assistente_estado_da_empresa (organization_id, sem_limite) values ('${ORG_B}', true)`),
    ).toThrow(/permission denied/);
    expect(config(ORG_B)).toBe("SEM_VIX");
  });
});
