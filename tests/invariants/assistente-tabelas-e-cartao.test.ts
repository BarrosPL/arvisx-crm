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

  it("uso do Vix: a empresa lê o próprio e zero da outra", () => {
    expect(countAs(GOV_MANAGER, `select count(*) from public.assistente_usos where organization_id = '${GOV_ORG}';`)).toBe(3);
    expect(countAs(GOV_MANAGER, `select count(*) from public.assistente_usos where organization_id = '${ORG_B}';`)).toBe(0);
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

  it("a sessão não chama a reserva do cartão nem as funções de uso e de acesso", () => {
    const acao = novoCartao({ org: GOV_ORG, user: GOV_AGENT_A, conversa: CONVERSA_DE_A });
    for (const chamada of [
      `select count(*) from public.fn_assistente_reservar_acao('${GOV_ORG}', '${GOV_AGENT_A}', '${acao}');`,
      `select public.fn_assistente_mensagens_do_mes('${GOV_ORG}');`,
      `select public.fn_assistente_registrar_mensagem('${GOV_ORG}', '${GOV_AGENT_A}', null, 'forjado');`,
      `select public.fn_assistente_acesso_da_org('${GOV_ORG}');`,
      `select count(*) from public.fn_assistente_uso_do_mes();`,
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

describe("o uso é registrado sem limite, e é só contagem, tokens e data", () => {
  const usadasNoMes = (org: string) =>
    Number(lastLine(sql(`set role service_role; select public.fn_assistente_mensagens_do_mes('${org}');`)));
  /** Registra uma mensagem como o servidor; devolve o id da linha de uso. */
  const registrar = (org: string) =>
    lastLine(sql(`set role service_role; select public.fn_assistente_registrar_mensagem('${org}', null, null, 'teste')::text;`));

  it("a contagem do mês é só da própria empresa e não inclui o mês passado", () => {
    // GOV_ORG tem 3 linhas, uma delas do mês passado.
    expect(usadasNoMes(GOV_ORG)).toBe(2);
    expect(usadasNoMes(ORG_B)).toBe(1);
  });

  it("não há limite de mensagens: registrar muitas vezes seguidas sempre grava, e só na empresa certa", () => {
    const daA = usadasNoMes(GOV_ORG);
    const daB = usadasNoMes(ORG_B);
    for (let i = 0; i < 25; i += 1) expect(registrar(GOV_ORG)).toMatch(/^[0-9a-f-]{36}$/);
    expect(usadasNoMes(GOV_ORG)).toBe(daA + 25);
    expect(usadasNoMes(ORG_B)).toBe(daB);
  });

  it("não existe tabela de limite por plano nem coluna de limite em lugar nenhum do assistente", () => {
    expect(sql("select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'assistente_planos';")).toBe("0");
    expect(
      sql(`select count(*) from information_schema.columns
            where table_schema = 'public' and table_name like 'assistente\\_%' and column_name ~ '(limite|por_mes|sem_limite)';`),
    ).toBe("0");
    expect(
      sql(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'fn_assistente_registrar_mensagem' and p.pronargs <> 4;`),
    ).toBe("0");
  });

  it("⭐ assistente_usos guarda SÓ contagem, tokens e data: a lista de colunas é esta, e nenhuma é texto livre", () => {
    // A empresa lê a própria linha de uso. Isso só é aceitável enquanto a tabela
    // não guardar texto de mensagem. Coluna nova aqui tem de passar por este teste.
    expect(
      sql(`select string_agg(column_name || ':' || data_type, ',' order by column_name)
             from information_schema.columns where table_schema = 'public' and table_name = 'assistente_usos';`),
    ).toBe(
      [
        "conversa_id:uuid",
        "created_at:timestamp with time zone",
        "falhou:boolean",
        "id:uuid",
        "modelo:text",
        "organization_id:uuid",
        "pagador:text",
        "provedor:text",
        "tokens_de_entrada:integer",
        "tokens_de_saida:integer",
        "user_id:uuid",
      ].join(","),
    );
    // As três colunas de texto são rótulos curtos (quem pagou, provedor, modelo), nunca conteúdo.
    expect(sql("select count(*) from public.assistente_usos where length(coalesce(pagador, '') || coalesce(provedor, '') || coalesce(modelo, '')) > 120;")).toBe("0");
  });

  it("o uso do Vix não entra no orçamento de IA da empresa", () => {
    // A tabela é própria justamente para isto: nem `llm_calls` nem `ai_budgets`
    // recebem linha por causa de uma mensagem do assistente.
    expect(sql(`select count(*) from public.llm_calls where organization_id in ('${GOV_ORG}', '${ORG_B}');`)).toBe("0");
    expect(sql(`select count(*) from public.ai_budgets where organization_id in ('${GOV_ORG}', '${ORG_B}');`)).toBe("0");
  });

  it("o uso do mês por organização, para a plataforma: soma certa, por empresa, sem o mês passado", () => {
    const linhas = lastLine(
      sql(`
        set role service_role;
        select string_agg(organization_id::text || ':' || mensagens::text, ',' order by organization_id::text)
          from public.fn_assistente_uso_do_mes()
         where organization_id in ('${GOV_ORG}', '${ORG_B}');
      `),
    );
    expect(linhas).toBe([`${ORG_B}:${usadasNoMes(ORG_B)}`, `${GOV_ORG}:${usadasNoMes(GOV_ORG)}`].sort().join(","));
  });
});

describe("quem tem o Vix: a marca da plataforma ou a assinatura ativa, e mais ninguém", () => {
  /** Por qual porta a organização tem o assistente, como o servidor lê; "SEM_VIX" quando por nenhuma. */
  const acesso = (org: string) =>
    lastLine(sql(`set role service_role; select coalesce(public.fn_assistente_acesso_da_org('${org}'), 'SEM_VIX');`));
  const cobranca = (valor: "ligado" | "desligado") =>
    sql(`
      insert into public.platform_config (chave, valor, eh_segredo, semeado_do_env)
        values ('MODULO_COBRANCA', '${valor}', false, false)
      on conflict (chave) do update set valor = excluded.valor;
    `);
  const marca = (org: string, valor: boolean) =>
    sql(`
      insert into public.assistente_estado_da_empresa (organization_id, isenta) values ('${org}', ${valor})
      on conflict (organization_id) do update set isenta = excluded.isenta;
    `);
  const assinatura = (org: string, estado: string | null) =>
    sql(
      estado === null
        ? `delete from public.cobranca_assinaturas where organization_id = '${org}';`
        : `insert into public.cobranca_assinaturas (organization_id, plano_id, estado) values ('${org}', '${PLANO}', '${estado}')
           on conflict (organization_id) do update set estado = excluded.estado, plano_id = excluded.plano_id;`,
    );
  const statusDaOrg = (org: string, status: "active" | "suspended") =>
    sql(`update public.organizations set status = '${status}' where id = '${org}';`);

  beforeAll(() => {
    cobranca("ligado");
    sql(`
      insert into public.cobranca_planos (id, nome, preco_cents, intervalo) values
        ('${PLANO}', 'Plano antigo de teste', 1000, 'mes'),
        ('${PLANO_SEM_LINHA}', 'Outro plano antigo', 1000, 'mes') on conflict do nothing;
      delete from public.cobranca_assinaturas where organization_id in ('${GOV_ORG}', '${ORG_B}');
    `);
    marca(GOV_ORG, false);
    marca(ORG_B, false);
  });

  it("nenhuma organização nasce marcada", () => {
    expect(sql("select count(*) from public.assistente_estado_da_empresa where isenta;")).toBe("0");
  });

  it("sem assinatura e sem marca: SEM VIX", () => {
    expect(acesso(GOV_ORG)).toBe("SEM_VIX");
  });

  it("assinatura ativa num plano antigo, sem nenhuma configuração do assistente: responde", () => {
    assinatura(GOV_ORG, "ativa");
    expect(acesso(GOV_ORG)).toBe("assinatura_ativa");
    // E não depende de QUAL plano: qualquer um serve.
    sql(`update public.cobranca_assinaturas set plano_id = '${PLANO_SEM_LINHA}' where organization_id = '${GOV_ORG}';`);
    expect(acesso(GOV_ORG)).toBe("assinatura_ativa");
    // A outra empresa, sem assinatura, continua sem.
    expect(acesso(ORG_B)).toBe("SEM_VIX");
  });

  it("o plano não decide nada: plano sem teto de IA e sem franquia não tira o assistente", () => {
    // O teto e a franquia são dos AGENTES. Onde essas colunas existirem no plano
    // (elas vêm de outra entrega), zerá-las não muda o acesso ao assistente.
    sql(`
      do $$
      begin
        if exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'cobranca_planos' and column_name = 'teto_ia_usd_cents') then
          execute 'update public.cobranca_planos set teto_ia_usd_cents = null';
        end if;
        if exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'cobranca_planos' and column_name = 'franquia_conversas_ia') then
          execute 'update public.cobranca_planos set franquia_conversas_ia = null';
        end if;
      end
      $$;
    `);
    assinatura(GOV_ORG, "ativa");
    expect(acesso(GOV_ORG)).toBe("assinatura_ativa");
    // E a função de acesso não cita plano nenhum.
    expect(
      sql(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'fn\_assistente\_%'
              and pg_get_functiondef(p.oid) ~* '(cobranca_planos|teto_ia|franquia|plano_id)';`),
    ).toBe("0");
  });

  it("em período de teste (trial): responde", () => {
    assinatura(GOV_ORG, "trial");
    expect(acesso(GOV_ORG)).toBe("assinatura_ativa");
  });

  it.each(["em_atraso", "cancelada"])("assinatura devendo (%s): recusa", (estado) => {
    assinatura(GOV_ORG, estado);
    expect(acesso(GOV_ORG)).toBe("SEM_VIX");
  });

  it("assinatura ativa, mas a empresa está SUSPENSA: recusa; reativada, volta", () => {
    assinatura(GOV_ORG, "ativa");
    statusDaOrg(GOV_ORG, "suspended");
    try {
      expect(acesso(GOV_ORG)).toBe("SEM_VIX");
    } finally {
      statusDaOrg(GOV_ORG, "active");
    }
    expect(acesso(GOV_ORG)).toBe("assinatura_ativa");
  });

  it("com a cobrança desligada na instalação, a assinatura não dá Vix a ninguém", () => {
    assinatura(GOV_ORG, "ativa");
    cobranca("desligado");
    try {
      expect(acesso(GOV_ORG)).toBe("SEM_VIX");
    } finally {
      cobranca("ligado");
    }
  });

  it("com a marca: responde, tenha assinatura ou não, e mesmo com a cobrança desligada", () => {
    marca(ORG_B, true);
    expect(acesso(ORG_B)).toBe("marca");
    cobranca("desligado");
    try {
      expect(acesso(ORG_B)).toBe("marca");
    } finally {
      cobranca("ligado");
    }
    assinatura(ORG_B, "cancelada");
    expect(acesso(ORG_B)).toBe("marca");
    assinatura(ORG_B, null);
  });

  it("tirada a marca, a organização sem assinatura volta a não ter Vix", () => {
    marca(ORG_B, false);
    expect(acesso(ORG_B)).toBe("SEM_VIX");
  });

  it("a marca é da plataforma: a sessão lê a própria linha e não a escreve, nem o administrador da empresa", () => {
    marca(ORG_B, false);
    expect(countAs(USER_B, "select count(*) from public.assistente_estado_da_empresa where isenta = false;")).toBe(1);
    expect(() =>
      writeCountAs(USER_B, `update public.assistente_estado_da_empresa set isenta = true where organization_id = '${ORG_B}'`),
    ).toThrow(/permission denied/);
    expect(() =>
      writeCountAs(USER_B, `insert into public.assistente_estado_da_empresa (organization_id, isenta) values ('${ORG_B}', true)`),
    ).toThrow(/permission denied/);
    expect(acesso(ORG_B)).toBe("SEM_VIX");
  });
});
