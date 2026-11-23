import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { propostaEstaAprovada } from "@/lib/propostas/envio-pelo-agente";

import { GOV_AGENT_A, GOV_CONTACT_1, GOV_MANAGER, GOV_ORG, GOV_VIEWER, seedGov, sql } from "./gov-helpers";

/**
 * EDITAR O RASCUNHO INVALIDA A APROVAÇÃO — NO BANCO (migration 9815).
 *
 * Revisão de 20/11, item 1.3. A aprovação da proposta (9814) vale enquanto
 * `aprovada_na_revisao = revision`, e quem somava um em `revision` era só o
 * código de duas rotas (PATCH e assistente). A policy `crm_proposal_items_write`
 * (0464) deixa a sessão de um atendente (`agent`) inserir, alterar e apagar
 * item de rascunho direto pelo PostgREST, sem tocar em `crm_proposals`: a
 * equipe aprovava a revisão R, o atendente trocava o preço do item, e o agente
 * de IA enviava um conteúdo que ninguém aprovou. O mesmo valia para as colunas
 * de conteúdo de `crm_proposals` escritas sem somar a revisão.
 *
 * Cada caso marcado ⭐ passava (a aprovação sobrevivia) antes da 9815.
 *
 * O que a 9815 garante, e este arquivo mede:
 *   • item inserido, alterado ou apagado, por qualquer papel do banco, soma um
 *     em `revision` e limpa a aprovação;
 *   • coluna de conteúdo de `crm_proposals` alterada sem a revisão subir: o
 *     banco sobe;
 *   • uma edição = +1, nunca +2: quem já subiu a revisão na mesma transação
 *     (a função `fn_proposta_gravar_edicao`, que as rotas chamam) não paga de
 *     novo pelos itens;
 *   • a revisão nunca volta atrás;
 *   • o ENVIO (numerar, `enviando`, voltar a rascunho na falha) não invalida a
 *     aprovação.
 */
const P = "cccccccc-9815-4000-8000-000000000001";
const ENVIADA = "cccccccc-9815-4000-8000-000000000002";
const ITEM_1 = "cccccccc-9815-4000-8000-000000000011";
const ITEM_2 = "cccccccc-9815-4000-8000-000000000012";
const ITEM_ENVIADA = "cccccccc-9815-4000-8000-000000000013";
const OUTRA_ORG = "cccccccc-9815-4000-8000-0000000000f1";

/** Linhas afetadas pela sessão do usuário, ou "negado" quando RLS/gatilho recusam. */
function como(userId: string, dml: string): number | "negado" {
  try {
    const out = sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
      with w as (${dml} returning 1) select count(*) from w;
    `);
    return Number(out.split("\n").pop());
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (/row-level security|proposta_transicao_negada|proposta_envio_e_do_servidor/.test(stderr)) return "negado";
    throw err;
  }
}

/** Um `select` escalar feito pela sessão do usuário (a última linha da saída). */
function selectComo(userId: string, consulta: string): string {
  const out = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${consulta}
  `);
  return out.split("\n").pop() ?? "";
}

interface Estado {
  revision: number;
  aprovada_em: string | null;
  aprovada_na_revisao: number | null;
  status: string;
}

function estado(id: string = P): Estado {
  return JSON.parse(
    sql(`select row_to_json(x) from (
           select revision, aprovada_em, aprovada_na_revisao, status from public.crm_proposals where id = '${id}'
         ) x;`),
  ) as Estado;
}

/** A pergunta que a ferramenta `crm_send_proposal` faz, com a linha do banco. */
function aprovada(id: string = P): boolean {
  const e = estado(id);
  return propostaEstaAprovada({ ...e, moeda: "BRL", condicoes: null });
}

/** O servidor aprova a revisão ATUAL (é o que a rota de aprovação grava). */
function aprovarPeloServidor(id: string = P): number {
  sql(`update public.crm_proposals set aprovada_em = now(), aprovada_na_revisao = revision where id = '${id}';`);
  const e = estado(id);
  expect(propostaEstaAprovada({ ...e, moeda: "BRL", condicoes: null })).toBe(true);
  return e.revision;
}

beforeAll(() => {
  seedGov();
});

/**
 * Cada caso parte do mesmo rascunho recriado, com dois itens e sem aprovação.
 * Os casos medem a revisão em relação à de partida (o insert dos itens já soma
 * um, e a revisão não volta atrás: não há como "zerar").
 */
beforeEach(() => {
  sql(`
    delete from public.crm_proposals where id in ('${P}', '${ENVIADA}');
    insert into public.crm_proposals (id, organization_id, contact_id, titulo, condicoes, status, numero, ano, sent_at, pdf_path, total_cents)
    values
      ('${P}', '${GOV_ORG}', '${GOV_CONTACT_1}', 'rascunho da 9815', 'a vista', 'rascunho', null, null, null, null, 3000),
      ('${ENVIADA}', '${GOV_ORG}', '${GOV_CONTACT_1}', 'enviada da 9815', null, 'enviada', 9815, 2026, now(), '${GOV_ORG}/${ENVIADA}.pdf', 1000);
    insert into public.crm_proposal_items (id, proposal_id, organization_id, descricao, quantidade, preco_unitario_cents, position)
    values
      ('${ITEM_1}', '${P}', '${GOV_ORG}', 'item 1', 1, 1000, 1000),
      ('${ITEM_2}', '${P}', '${GOV_ORG}', 'item 2', 1, 2000, 2000),
      ('${ITEM_ENVIADA}', '${ENVIADA}', '${GOV_ORG}', 'item', 1, 1000, 1000);
  `);
});

describe("item editado pela sessão de um atendente, depois da aprovação", () => {
  it("⭐ alterar o preço de um item invalida a aprovação e soma um na revisão", () => {
    const r = aprovarPeloServidor();
    expect(como(GOV_AGENT_A, `update public.crm_proposal_items set preco_unitario_cents = 1 where id = '${ITEM_1}'`)).toBe(1);
    expect(aprovada()).toBe(false);
    const depois = estado();
    expect(depois.revision).toBe(r + 1);
    // A aprovação é LIMPA, e não só desencontrada: uma revisão que voltasse ao
    // número aprovado não a ressuscita.
    expect(depois.aprovada_em).toBeNull();
    expect(depois.aprovada_na_revisao).toBeNull();
  });

  it("⭐ inserir um item invalida a aprovação", () => {
    const r = aprovarPeloServidor();
    expect(
      como(
        GOV_AGENT_A,
        `insert into public.crm_proposal_items (proposal_id, organization_id, descricao, quantidade, preco_unitario_cents, position)
         values ('${P}', '${GOV_ORG}', 'item novo', 1, 999900, 3000)`,
      ),
    ).toBe(1);
    expect(aprovada()).toBe(false);
    expect(estado().revision).toBe(r + 1);
  });

  it("⭐ apagar um item invalida a aprovação", () => {
    const r = aprovarPeloServidor();
    expect(como(GOV_AGENT_A, `delete from public.crm_proposal_items where id = '${ITEM_2}'`)).toBe(1);
    expect(aprovada()).toBe(false);
    expect(estado().revision).toBe(r + 1);
  });

  it("um comando que mexe em vários itens soma UM, não um por linha", () => {
    const r = aprovarPeloServidor();
    expect(como(GOV_AGENT_A, `update public.crm_proposal_items set quantidade = 3 where proposal_id = '${P}'`)).toBe(2);
    expect(estado().revision).toBe(r + 1);
    expect(aprovada()).toBe(false);
  });

  it("update que não muda nada no item não gasta revisão nem derruba a aprovação", () => {
    const r = aprovarPeloServidor();
    expect(como(GOV_AGENT_A, `update public.crm_proposal_items set quantidade = quantidade where id = '${ITEM_1}'`)).toBe(1);
    expect(estado().revision).toBe(r);
    expect(aprovada()).toBe(true);
  });

  it("quem não escreve item (viewer) não mexe na revisão", () => {
    const r = aprovarPeloServidor();
    expect(como(GOV_VIEWER, `update public.crm_proposal_items set quantidade = 9 where id = '${ITEM_1}'`)).toBe(0);
    expect(estado().revision).toBe(r);
    expect(aprovada()).toBe(true);
  });

  it("o servidor também paga: item alterado pelo papel de serviço invalida a aprovação", () => {
    const r = aprovarPeloServidor();
    sql(`update public.crm_proposal_items set desconto_cents = 500 where id = '${ITEM_1}';`);
    expect(aprovada()).toBe(false);
    expect(estado().revision).toBe(r + 1);
  });

  it("item de proposta que não é rascunho não mexe na revisão dela", () => {
    const antes = estado(ENVIADA).revision;
    sql(`update public.crm_proposal_items set descricao = 'corrigido pelo servidor' where id = '${ITEM_ENVIADA}';`);
    expect(estado(ENVIADA).revision).toBe(antes);
  });
});

describe("conteúdo de crm_proposals editado sem subir a revisão", () => {
  const edicoes: ReadonlyArray<readonly [string, string]> = [
    ["titulo", `titulo = 'outro título'`],
    ["condicoes", `condicoes = 'em 12 vezes'`],
    ["valid_until", `valid_until = '2031-01-01'`],
    ["total_cents", `total_cents = 1`],
    ["prazo_dias_uteis", `prazo_dias_uteis = 90`],
    ["pagamento", `pagamento = 'boleto'`],
    ["briefing_json", `briefing_json = '{"escopo":"outro"}'::jsonb`],
    ["secoes_editadas", `secoes_editadas = '{"s1":"texto reescrito"}'::jsonb`],
    ["resumo_comercial", `resumo_comercial = 'outro resumo'`],
  ];

  for (const [coluna, atribuicao] of edicoes) {
    it(`⭐ ${coluna}: a sessão do atendente altera, o banco sobe a revisão e limpa a aprovação`, () => {
      const r = aprovarPeloServidor();
      expect(como(GOV_AGENT_A, `update public.crm_proposals set ${atribuicao} where id = '${P}'`)).toBe(1);
      expect(aprovada()).toBe(false);
      const depois = estado();
      expect(depois.revision).toBe(r + 1);
      expect(depois.aprovada_em).toBeNull();
    });
  }

  it("quem já sobe a revisão (as rotas) paga UM, não dois", () => {
    const r = aprovarPeloServidor();
    expect(
      como(GOV_AGENT_A, `update public.crm_proposals set titulo = 'pela rota', revision = revision + 1 where id = '${P}'`),
    ).toBe(1);
    expect(estado().revision).toBe(r + 1);
    expect(aprovada()).toBe(false);
  });

  it("⭐ a revisão não volta atrás: a sessão não devolve o rascunho à revisão que a equipe viu", () => {
    sql(`update public.crm_proposals set revision = 5 where id = '${P}';`);
    expect(como(GOV_AGENT_A, `update public.crm_proposals set titulo = 'trocado', revision = 4 where id = '${P}'`)).toBe(1);
    expect(estado().revision).toBe(6);
    expect(como(GOV_AGENT_A, `update public.crm_proposals set revision = 5 where id = '${P}'`)).toBe(1);
    expect(estado().revision).toBeGreaterThan(6);
  });

  it("a sessão continua sem poder aprovar, nem junto com a edição", () => {
    expect(
      como(
        GOV_AGENT_A,
        `update public.crm_proposals set titulo = 'x', revision = revision + 1, aprovada_em = now(), aprovada_na_revisao = revision + 1 where id = '${P}'`,
      ),
    ).toBe("negado");
    expect(como(GOV_MANAGER, `update public.crm_proposals set aprovada_em = now(), aprovada_na_revisao = revision where id = '${P}'`)).toBe("negado");
  });

  it("o que não é conteúdo não derruba a aprovação", () => {
    const r = aprovarPeloServidor();
    sql(`update public.crm_proposals set template_slug_sugerido = 'servico', ultima_falha_envio = 'canal caiu' where id = '${P}';`);
    expect(estado().revision).toBe(r);
    expect(aprovada()).toBe(true);
  });
});

describe("o envio não invalida a aprovação", () => {
  it("numerar, entrar em `enviando` e voltar a rascunho na falha mantêm a aprovação e a revisão", () => {
    const r = aprovarPeloServidor();
    // alocarNumero (lib/propostas/numeracao.ts): grava numero/ano ainda em rascunho.
    sql(`update public.crm_proposals set numero = 98150, ano = 2026 where id = '${P}';`);
    expect(aprovada()).toBe(true);
    // enviarProposta: entra em `enviando`.
    sql(`update public.crm_proposals set status = 'enviando', ultima_falha_envio = null where id = '${P}';`);
    expect(aprovada()).toBe(true);
    // falha em qualquer passo: volta a rascunho com o motivo, o arquivo e a mensagem.
    sql(`update public.crm_proposals
            set status = 'rascunho', ultima_falha_envio = 'Falha simulada', pdf_path = '${GOV_ORG}/${P}.pdf'
          where id = '${P}';`);
    expect(aprovada()).toBe(true);
    expect(estado().revision).toBe(r);
  });

  it("o desfecho `enviada` (com destinatário e snapshots) não mexe na revisão", () => {
    const r = aprovarPeloServidor();
    sql(`update public.crm_proposals set numero = 98151, ano = 2026 where id = '${P}';`);
    sql(`update public.crm_proposals set status = 'enviando' where id = '${P}';`);
    sql(`update public.crm_proposals
            set status = 'enviada', sent_at = now(), pdf_path = '${GOV_ORG}/${P}.pdf', destinatario_nome = 'Cliente',
                template_snapshot = '{}'::jsonb, rendered_snapshot = '{}'::jsonb
          where id = '${P}';`);
    const e = estado();
    expect(e.status).toBe("enviada");
    expect(e.revision).toBe(r);
    expect(e.aprovada_na_revisao).toBe(r);
  });
});

describe("fn_proposta_gravar_edicao: a edição das rotas, numa transação só", () => {
  const itens = `'[{"product_id":null,"descricao":"novo A","quantidade":2,"preco_unitario_cents":500,"desconto_cents":0,"position":1000},
                   {"product_id":null,"descricao":"novo B","quantidade":1,"preco_unitario_cents":null,"desconto_cents":0,"position":2000}]'::jsonb`;

  it("⭐ campos e itens trocados somam UM na revisão, e a aprovação cai", () => {
    const r = aprovarPeloServidor();
    const nova = selectComo(
      GOV_AGENT_A,
      `select public.fn_proposta_gravar_edicao('${GOV_ORG}', '${P}', ${r},
         '{"titulo":"editada pela rota","condicoes":null,"total_cents":1000,"pricing_status":"missing"}'::jsonb, ${itens});`,
    );
    expect(Number(nova)).toBe(r + 1);
    expect(estado().revision).toBe(r + 1);
    expect(aprovada()).toBe(false);
    expect(sql(`select titulo || '|' || coalesce(condicoes, 'nulo') || '|' || total_cents || '|' || pricing_status
                  from public.crm_proposals where id = '${P}';`)).toBe("editada pela rota|nulo|1000|missing");
    expect(sql(`select string_agg(descricao || ':' || quantidade || ':' || coalesce(preco_unitario_cents::text, 'sem'), ',' order by position)
                  from public.crm_proposal_items where proposal_id = '${P}';`)).toBe("novo A:2:500,novo B:1:sem");
  });

  it("campo ausente do pedido fica como está", () => {
    const r = estado().revision;
    selectComo(
      GOV_AGENT_A,
      `select public.fn_proposta_gravar_edicao('${GOV_ORG}', '${P}', ${r}, '{"total_cents":3000,"pricing_status":"manual"}'::jsonb, ${itens});`,
    );
    expect(sql(`select titulo || '|' || condicoes from public.crm_proposals where id = '${P}';`)).toBe("rascunho da 9815|a vista");
  });

  it("revisão velha devolve nulo e não grava nada (nem os itens)", () => {
    const r = estado().revision;
    const nova = selectComo(
      GOV_AGENT_A,
      `select coalesce(public.fn_proposta_gravar_edicao('${GOV_ORG}', '${P}', ${r + 7},
         '{"titulo":"não entra","total_cents":1,"pricing_status":"manual"}'::jsonb, '[]'::jsonb)::text, 'nulo');`,
    );
    expect(nova).toBe("nulo");
    expect(estado().revision).toBe(r);
    expect(sql(`select count(*) from public.crm_proposal_items where proposal_id = '${P}';`)).toBe("2");
  });

  it("organização que não é a da proposta, proposta enviada e viewer: nulo, sem efeito", () => {
    const r = estado().revision;
    const chamada = (org: string, id: string, rev: number) =>
      `select coalesce(public.fn_proposta_gravar_edicao('${org}', '${id}', ${rev},
         '{"titulo":"não entra","total_cents":1,"pricing_status":"manual"}'::jsonb, '[]'::jsonb)::text, 'nulo');`;
    expect(selectComo(GOV_AGENT_A, chamada(OUTRA_ORG, P, r))).toBe("nulo");
    expect(selectComo(GOV_AGENT_A, chamada(GOV_ORG, ENVIADA, estado(ENVIADA).revision))).toBe("nulo");
    expect(selectComo(GOV_VIEWER, chamada(GOV_ORG, P, r))).toBe("nulo");
    expect(estado().revision).toBe(r);
    expect(sql(`select titulo from public.crm_proposals where id = '${P}';`)).toBe("rascunho da 9815");
    expect(sql(`select count(*) from public.crm_proposal_items where proposal_id = '${P}';`)).toBe("2");
  });

  it("a função não é chamável pela chave anônima", () => {
    expect(
      sql(`select has_function_privilege('anon', 'public.fn_proposta_gravar_edicao(uuid, uuid, bigint, jsonb, jsonb)', 'execute');`),
    ).toBe("f");
  });

  it("⭐ aprovar no meio da transação não protege a edição de item que vem depois", () => {
    // A marca "já subiu nesta transação" não pode servir de salvo-conduto: quem
    // sobe a revisão, aprova e SÓ ENTÃO mexe no item paga de novo.
    sql(`
      begin;
      update public.crm_proposals set titulo = 'sobe', revision = revision + 1 where id = '${P}';
      update public.crm_proposals set aprovada_em = now(), aprovada_na_revisao = revision where id = '${P}';
      update public.crm_proposal_items set preco_unitario_cents = 7 where id = '${ITEM_1}';
      commit;
    `);
    expect(aprovada()).toBe(false);
  });
});

describe("apagar não tropeça no gatilho", () => {
  it("manager descarta o rascunho (apaga) e os itens vão junto", () => {
    expect(como(GOV_MANAGER, `delete from public.crm_proposals where id = '${P}'`)).toBe(1);
    expect(sql(`select count(*) from public.crm_proposal_items where proposal_id = '${P}';`)).toBe("0");
  });
});

/**
 * CERCA DE DERIVA: toda coluna de `crm_proposals` está classificada.
 *
 * O gatilho da 9815 guarda uma LISTA das colunas de conteúdo. Coluna nova que
 * vai para o cliente e não entra na lista é um furo mudo (editar não invalida
 * a aprovação). Quem acrescentar coluna em `crm_proposals` cai aqui e decide:
 * conteúdo (entra em `v_conteudo` da função, por migration nova) ou não.
 */
describe("toda coluna de crm_proposals está classificada como conteúdo ou não", () => {
  const CONTEUDO = [
    "titulo",
    "condicoes",
    "valid_until",
    "total_cents",
    "moeda",
    "prazo_dias_uteis",
    "pagamento",
    "pricing_status",
    "briefing_json",
    "resumo_comercial",
    "secoes_editadas",
    "template_slug",
    "template_version",
    "destinatario_nome",
    "version_reason",
    "lead_id",
    "contact_id",
    "conversation_id",
  ];
  const NAO_E_CONTEUDO = [
    // identidade e relógio
    "id", "organization_id", "created_at", "updated_at",
    // o próprio controle
    "status", "revision", "aprovada_em", "aprovada_na_revisao",
    // o que só o envio escreve
    "numero", "ano", "versao", "substitui_id", "sent_at", "sent_by_user_id", "pdf_path", "message_id",
    "retorno_id", "template_snapshot", "rendered_snapshot", "ultima_falha_envio",
    // a decisão do cliente
    "decided_at", "decided_by_user_id", "decision_reason",
    // bastidor: quem rascunhou e a sugestão de modelo da IA (não vai no documento)
    "drafted_by_agent_id", "template_slug_sugerido",
  ];

  it("a união das duas listas é exatamente o conjunto de colunas da tabela", () => {
    const colunas = sql(
      `select string_agg(column_name, ',' order by column_name) from information_schema.columns
        where table_schema = 'public' and table_name = 'crm_proposals';`,
    ).split(",");
    expect([...CONTEUDO, ...NAO_E_CONTEUDO].sort()).toEqual(colunas);
  });

  it("a função do gatilho conhece cada coluna de conteúdo", () => {
    const corpo = sql(
      `select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'fn_crm_proposals_edicao_sobe_revisao';`,
    );
    for (const coluna of CONTEUDO) expect(corpo, coluna).toContain(`'${coluna}'`);
  });

  it("o gatilho da revisão roda DEPOIS do gatilho de transição da sessão (ordem alfabética)", () => {
    const nomes = sql(
      `select string_agg(tgname, ',' order by tgname) from pg_trigger
        where tgrelid = 'public.crm_proposals'::regclass and not tgisinternal and (tgtype & 2) = 2 and (tgtype & 16) = 16;`,
    ).split(",");
    expect(nomes.indexOf("trg_crm_proposals_zz_edicao_sobe_revisao")).toBeGreaterThan(
      nomes.indexOf("trg_crm_proposals_transicao_da_sessao"),
    );
  });
});
