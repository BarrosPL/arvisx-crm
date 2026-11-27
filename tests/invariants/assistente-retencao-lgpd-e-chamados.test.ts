import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_ADMIN,
  GOV_AGENT_A,
  GOV_AGENT_B,
  GOV_CONTACT_1,
  GOV_CONTACT_2,
  GOV_MANAGER,
  GOV_ORG,
  countAs,
  lastLine,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/**
 * VIX: O HISTÓRICO TEM PRAZO, A ANONIMIZAÇÃO O ALCANÇA, E O CHAMADO TEM LEITOR
 * (migration 9831).
 *
 * Três promessas, medidas no Postgres real:
 *
 *  1. PRAZO. `fn_expurgar_historico_do_assistente` apaga o que passou do prazo
 *     e SÓ isso: a conversa com mensagem recente fica, o chamado aberto fica,
 *     a conta do limite do mês (`assistente_usos`) fica. O piso de 7 dias está
 *     no corpo: pedir 1 dia não apaga o que tem 5. A sessão não chama a função.
 *
 *  2. LGPD. Anonimizar um contato apaga o TEXTO do assistente da organização
 *     dele, pelos dois caminhos (o pedido formal e a virada direta da coluna),
 *     e não toca a outra organização.
 *
 *  3. CHAMADO. A empresa só lê os próprios; o administrador de outra empresa
 *     lê zero; a sessão não escreve "visto" nem "resolvido". Quem lê todos é o
 *     servidor, com a chave de serviço, atrás da guarda de equipe da plataforma
 *     (a rota é medida em `tests/unit/assistente-chamados-da-plataforma.test.ts`).
 */

const ORG_B = "a7710000-0000-4000-8000-00000000000b";
const USER_B = "a7710000-1111-4000-8000-00000000000b";
const MARCADOR = "[texto removido: anonimização de contato]";

const n = (consulta: string) => Number(sql(consulta));
const comoServico = (consulta: string) => lastLine(sql(`set role service_role; ${consulta}`));

function conversa(org: string, user: string, idade: string, titulo = "assunto"): string {
  return sql(`
    insert into public.assistente_conversas (organization_id, user_id, titulo, created_at, updated_at)
    values ('${org}', '${user}', '${titulo}', now() - interval '${idade}', now() - interval '${idade}')
    returning id;
  `).split("\n")[0]!;
}
function mensagem(org: string, user: string, conv: string, idade: string, corpo = "texto"): void {
  sql(`
    insert into public.assistente_mensagens (organization_id, conversa_id, user_id, turn_id, autor, corpo, created_at)
    values ('${org}', '${conv}', '${user}', gen_random_uuid(), 'assistente', '${corpo}', now() - interval '${idade}');
  `);
}
function cartao(org: string, user: string, conv: string, idade: string): void {
  sql(`
    insert into public.assistente_acoes (organization_id, conversa_id, user_id, capacidade, nivel, resumo, itens, expira_em, created_at)
    values ('${org}', '${conv}', '${user}', 'teste.escrever', 'escrever', 'etiquetar Maria da Silva',
            '[{"id":"x","rotulo":"Maria da Silva"}]'::jsonb, now() - interval '${idade}' + interval '10 minutes', now() - interval '${idade}');
  `);
}
function chamado(org: string, user: string, estado: string, idade: string, resumo = "não consigo conectar"): string {
  return sql(`
    insert into public.assistente_chamados (organization_id, user_id, resumo, diagnostico, estado, created_at, updated_at, resolvido_em)
    values ('${org}', '${user}', '${resumo}', '{"canais":[{"nome":"principal","estado":"caiu"}]}'::jsonb, '${estado}',
            now() - interval '${idade}', now() - interval '${idade}',
            ${estado === "resolvido" ? `now() - interval '${idade}'` : "null"})
    returning id;
  `).split("\n")[0]!;
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into auth.users (id, email) values ('${USER_B}', 'vix-ret-b@invariant.test') on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'vix-ret-b', 'Vix Ret B', 'Vix Ret B') on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USER_B}', '${ORG_B}', 'admin', now()) on conflict do nothing;
    delete from public.assistente_chamados;
    delete from public.assistente_conversas;
  `);
});

describe("prazo do histórico", () => {
  let velha: string;
  let viva: string;
  let abertoVelho: string;
  let resolvidoVelho: string;
  let resolvidoNovo: string;

  beforeAll(() => {
    velha = conversa(GOV_ORG, GOV_AGENT_A, "40 days");
    mensagem(GOV_ORG, GOV_AGENT_A, velha, "40 days");
    cartao(GOV_ORG, GOV_AGENT_A, velha, "40 days");
    viva = conversa(GOV_ORG, GOV_AGENT_A, "40 days");
    mensagem(GOV_ORG, GOV_AGENT_A, viva, "40 days", "antiga");
    mensagem(GOV_ORG, GOV_AGENT_A, viva, "2 days", "recente");
    abertoVelho = chamado(GOV_ORG, GOV_AGENT_A, "aberto", "90 days");
    resolvidoVelho = chamado(GOV_ORG, GOV_AGENT_A, "resolvido", "40 days");
    resolvidoNovo = chamado(GOV_ORG, GOV_AGENT_A, "resolvido", "3 days");
    sql(`insert into public.assistente_usos (organization_id, user_id, pagador, created_at)
         values ('${GOV_ORG}', '${GOV_AGENT_A}', 'hermes', now() - interval '40 days');`);
  });

  it("a sessão não chama o expurgo, nem o administrador da empresa", () => {
    expect(() => countAs(GOV_ADMIN, "select public.fn_expurgar_historico_do_assistente(30, 1000)")).toThrow(/permission denied/);
  });

  it("o piso está no corpo: pedir 1 dia não apaga o que tem 2 nem 3 dias", () => {
    sql(`insert into public.assistente_conversas (id, organization_id, user_id, created_at, updated_at)
         values ('a7710000-2222-4000-8000-000000000001', '${ORG_B}', '${USER_B}', now() - interval '5 days', now() - interval '5 days');`);
    mensagem(ORG_B, USER_B, "a7710000-2222-4000-8000-000000000001", "5 days");
    comoServico("select public.fn_expurgar_historico_do_assistente(1, 1000);");
    expect(n(`select count(*) from public.assistente_mensagens where organization_id = '${ORG_B}';`)).toBe(1);
    expect(n(`select count(*) from public.assistente_mensagens where conversa_id = '${viva}' and corpo = 'recente';`)).toBe(1);
    expect(n(`select count(*) from public.assistente_chamados where id = '${resolvidoNovo}';`)).toBe(1);
  });

  it("apaga mensagem, cartão e conversa vazia vencidos; a conversa com mensagem recente fica com o que sobrou", () => {
    // O piso da rodada anterior (7 dias) já alcançou os de 40. Controle: rodar de novo com o padrão devolve zero.
    expect(n(`select count(*) from public.assistente_conversas where id = '${velha}';`)).toBe(0);
    expect(n(`select count(*) from public.assistente_acoes where conversa_id = '${velha}';`)).toBe(0);
    expect(n(`select count(*) from public.assistente_conversas where id = '${viva}';`)).toBe(1);
    expect(sql(`select string_agg(corpo, ',') from public.assistente_mensagens where conversa_id = '${viva}';`)).toBe("recente");
    expect(Number(comoServico("select public.fn_expurgar_historico_do_assistente(null, null);"))).toBe(0);
  });

  it("chamado resolvido vencido sai; aberto NUNCA sai por idade; resolvido recente fica", () => {
    expect(n(`select count(*) from public.assistente_chamados where id = '${resolvidoVelho}';`)).toBe(0);
    expect(n(`select count(*) from public.assistente_chamados where id = '${abertoVelho}';`)).toBe(1);
    expect(n(`select count(*) from public.assistente_chamados where id = '${resolvidoNovo}';`)).toBe(1);
  });

  it("a conta do limite do mês não é tocada", () => {
    expect(n(`select count(*) from public.assistente_usos where organization_id = '${GOV_ORG}' and created_at < now() - interval '30 days';`)).toBe(1);
  });

  it("o limite do lote é respeitado e a função devolve quantas apagou", () => {
    const c = conversa(ORG_B, USER_B, "60 days");
    for (let i = 0; i < 5; i += 1) mensagem(ORG_B, USER_B, c, "60 days");
    expect(Number(comoServico("select public.fn_expurgar_historico_do_assistente(30, 2);"))).toBe(2);
    expect(n(`select count(*) from public.assistente_mensagens where conversa_id = '${c}';`)).toBe(3);
    comoServico("select public.fn_expurgar_historico_do_assistente(30, 1000);");
    expect(n(`select count(*) from public.assistente_conversas where id = '${c}';`)).toBe(0);
  });
});

describe("anonimização de contato alcança o texto do assistente", () => {
  let convA: string;
  let convB: string;

  function semear() {
    convA = conversa(GOV_ORG, GOV_AGENT_A, "1 day", "sobre a Maria da Silva");
    mensagem(GOV_ORG, GOV_AGENT_A, convA, "1 day", "A Maria da Silva pediu orçamento");
    cartao(GOV_ORG, GOV_AGENT_A, convA, "1 day");
    chamado(GOV_ORG, GOV_AGENT_A, "aberto", "1 day", "a Maria da Silva não recebe mensagem");
  }
  const textoDaOrg = (org: string) => ({
    mensagens: n(`select count(*) from public.assistente_mensagens where organization_id = '${org}';`),
    cartoes: n(`select count(*) from public.assistente_acoes where organization_id = '${org}';`),
    titulos: n(`select count(*) from public.assistente_conversas where organization_id = '${org}' and titulo is not null;`),
    chamadosComTexto: n(`select count(*) from public.assistente_chamados where organization_id = '${org}' and (resumo <> '${MARCADOR}' or diagnostico <> '{}'::jsonb);`),
  });

  beforeAll(() => {
    sql("delete from public.assistente_chamados; delete from public.assistente_conversas;");
    semear();
    convB = conversa(ORG_B, USER_B, "1 day", "da outra empresa");
    mensagem(ORG_B, USER_B, convB, "1 day", "texto da outra empresa");
    cartao(ORG_B, USER_B, convB, "1 day");
    chamado(ORG_B, USER_B, "aberto", "1 day", "chamado da outra empresa");
  });

  it("controle positivo: antes, o texto existe nas duas empresas", () => {
    expect(textoDaOrg(GOV_ORG)).toEqual({ mensagens: 1, cartoes: 1, titulos: 1, chamadosComTexto: 1 });
    expect(textoDaOrg(ORG_B)).toEqual({ mensagens: 1, cartoes: 1, titulos: 1, chamadosComTexto: 1 });
  });

  it("editar o contato sem anonimizar não apaga nada", () => {
    sql(`update public.contacts set updated_at = now() where id = '${GOV_CONTACT_1}';`);
    sql(`update public.contacts set is_anonymized = false where id = '${GOV_CONTACT_1}';`);
    expect(textoDaOrg(GOV_ORG).mensagens).toBe(1);
  });

  it("pelo pedido formal (fn_lgpd_cascade_redact_contact): o texto da organização some", () => {
    sql(`select public.fn_lgpd_cascade_redact_contact('${GOV_ORG}', '${GOV_CONTACT_1}', null);`);
    expect(sql(`select is_anonymized::text from public.contacts where id = '${GOV_CONTACT_1}';`)).toBe("true");
    expect(textoDaOrg(GOV_ORG)).toEqual({ mensagens: 0, cartoes: 0, titulos: 0, chamadosComTexto: 0 });
    // O chamado continua existindo, só sem o texto.
    expect(sql(`select resumo from public.assistente_chamados where organization_id = '${GOV_ORG}';`)).toBe(MARCADOR);
  });

  it("a outra organização não é tocada", () => {
    expect(textoDaOrg(ORG_B)).toEqual({ mensagens: 1, cartoes: 1, titulos: 1, chamadosComTexto: 1 });
    expect(sql(`select corpo from public.assistente_mensagens where organization_id = '${ORG_B}';`)).toBe("texto da outra empresa");
  });

  it("pela virada direta da coluna (o outro caminho): mesmo efeito", () => {
    semear();
    expect(textoDaOrg(GOV_ORG).mensagens).toBe(1);
    sql(`update public.contacts set is_anonymized = true, anonymized_at = now() where id = '${GOV_CONTACT_2}';`);
    expect(textoDaOrg(GOV_ORG)).toEqual({ mensagens: 0, cartoes: 0, titulos: 0, chamadosComTexto: 0 });
    expect(textoDaOrg(ORG_B).mensagens).toBe(1);
  });

  it("a função do gatilho não é chamável pela sessão", () => {
    expect(
      n(`select count(*) from information_schema.routine_privileges
          where routine_schema = 'public' and routine_name = 'fn_assistente_esquece_ao_anonimizar'
            and grantee in ('anon', 'authenticated', 'PUBLIC');`),
    ).toBe(0);
  });
});

describe("chamado: quem lê e quem escreve", () => {
  let deA: string;

  beforeAll(() => {
    sql("delete from public.assistente_chamados;");
    deA = chamado(GOV_ORG, GOV_AGENT_A, "aberto", "1 hour");
    chamado(ORG_B, USER_B, "aberto", "1 hour");
  });

  it("controle positivo: o autor e o gerente da empresa leem o chamado dela", () => {
    expect(countAs(GOV_AGENT_A, `select count(*) from public.assistente_chamados where id = '${deA}'`)).toBe(1);
    expect(countAs(GOV_MANAGER, `select count(*) from public.assistente_chamados where id = '${deA}'`)).toBe(1);
  });

  it("o colega atendente não lê; o ADMINISTRADOR de outra empresa lê zero da empresa A", () => {
    expect(countAs(GOV_AGENT_B, `select count(*) from public.assistente_chamados where id = '${deA}'`)).toBe(0);
    expect(countAs(USER_B, `select count(*) from public.assistente_chamados where id = '${deA}'`)).toBe(0);
    expect(countAs(USER_B, `select count(*) from public.assistente_chamados where organization_id = '${GOV_ORG}'`)).toBe(0);
    // E o próprio, ele lê (a recusa acima não é a tabela vazia).
    expect(countAs(USER_B, "select count(*) from public.assistente_chamados")).toBe(1);
  });

  it("nenhuma sessão lê os chamados de TODAS as empresas: isso é só do servidor", () => {
    for (const quem of [GOV_ADMIN, GOV_MANAGER, USER_B]) {
      expect(countAs(quem, "select count(*) from public.assistente_chamados")).toBeLessThan(2);
    }
    expect(Number(comoServico("select count(*) from public.assistente_chamados;"))).toBe(2);
  });

  it("a sessão não marca visto nem resolvido, nem o administrador da própria empresa", () => {
    expect(() =>
      writeCountAs(GOV_ADMIN, `update public.assistente_chamados set visto_em = now(), estado = 'resolvido' where id = '${deA}'`),
    ).toThrow(/permission denied/);
    expect(sql(`select estado || ':' || coalesce(visto_em::text, 'nulo') from public.assistente_chamados where id = '${deA}';`)).toBe("aberto:nulo");
  });
});
