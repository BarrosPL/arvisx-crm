import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_CONTACT_1, GOV_MANAGER, GOV_ORG, GOV_VIEWER, seedGov, sql } from "./gov-helpers";

/**
 * A RLS DA PROPOSTA ESPELHA AS ROTAS, POR OPERAÇÃO (migration 0464).
 *
 * A policy nasceu `for all` com piso `agent`. Pelo PostgREST — que fala com o
 * JWT da sessão direto, sem passar por rota nenhuma (ver 0150) — um atendente
 * apagava uma proposta JÁ ENVIADA, trocava o status dela ou marcava um rascunho
 * como aceito, enquanto as rotas só descartam rascunho (e exigem `manager`) e
 * só decidem sobre proposta enviada. Cada caso abaixo marcado ⭐ passava antes
 * do conserto.
 */
const RASCUNHO = "cccccccc-9999-4000-8000-00000000c001";
const ENVIADA = "cccccccc-9999-4000-8000-00000000c002";
const DESCARTE = "cccccccc-9999-4000-8000-00000000c003";
const ITEM_RASCUNHO = "cccccccc-9999-4000-8000-00000000c011";
const ITEM_ENVIADA = "cccccccc-9999-4000-8000-00000000c012";
const CRIADA = "cccccccc-9999-4000-8000-00000000c021";

/** Linhas afetadas, ou "negado" quando a RLS ou o gatilho recusam. */
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

function status(id: string): string {
  return sql(`select coalesce((select status from public.crm_proposals where id = '${id}'), 'apagada');`);
}

beforeAll(() => {
  seedGov();
  sql(`
    delete from public.crm_proposals where id in ('${RASCUNHO}', '${ENVIADA}', '${DESCARTE}', '${CRIADA}');
    insert into public.crm_proposals (id, organization_id, contact_id, titulo, status, numero, ano, sent_at, pdf_path)
    values
      ('${RASCUNHO}', '${GOV_ORG}', '${GOV_CONTACT_1}', 'rascunho', 'rascunho', null, null, null, null),
      ('${ENVIADA}', '${GOV_ORG}', '${GOV_CONTACT_1}', 'enviada', 'enviada', 9001, 2026, now(), '${GOV_ORG}/${ENVIADA}.pdf'),
      ('${DESCARTE}', '${GOV_ORG}', '${GOV_CONTACT_1}', 'para descartar', 'rascunho', null, null, null, null);
    insert into public.crm_proposal_items (id, proposal_id, organization_id, descricao, quantidade, preco_unitario_cents, position)
    values
      ('${ITEM_RASCUNHO}', '${RASCUNHO}', '${GOV_ORG}', 'item', 1, 1000, 1000),
      ('${ITEM_ENVIADA}', '${ENVIADA}', '${GOV_ORG}', 'item', 1, 1000, 1000);
  `);
});

describe("proposta enviada: nenhuma sessão apaga nem reescreve", () => {
  it("⭐ agent não apaga a proposta enviada", () => {
    expect(como(GOV_AGENT_A, `delete from public.crm_proposals where id = '${ENVIADA}'`)).toBe(0);
    expect(status(ENVIADA)).toBe("enviada");
  });

  it("⭐ agent não devolve a enviada para rascunho nem mexe no valor dela", () => {
    expect(como(GOV_AGENT_A, `update public.crm_proposals set status = 'rascunho' where id = '${ENVIADA}'`)).toBe("negado");
    expect(como(GOV_AGENT_A, `update public.crm_proposals set total_cents = 1 where id = '${ENVIADA}'`)).toBe("negado");
  });

  it("⭐ agent não mexe no item de uma proposta enviada", () => {
    expect(como(GOV_AGENT_A, `update public.crm_proposal_items set preco_unitario_cents = 1 where id = '${ITEM_ENVIADA}'`)).toBe(0);
    expect(como(GOV_AGENT_A, `delete from public.crm_proposal_items where id = '${ITEM_ENVIADA}'`)).toBe(0);
  });

  it("agent DECIDE a enviada (a rota /decide é agent) — controle positivo", () => {
    expect(
      como(GOV_AGENT_A, `update public.crm_proposals set status = 'aceita', decided_at = now() where id = '${ENVIADA}'`),
    ).toBe(1);
    sql(`update public.crm_proposals set status = 'enviada', decided_at = null where id = '${ENVIADA}';`);
  });
});

describe("rascunho: agent edita, só o servidor envia, só manager descarta", () => {
  it("agent edita o rascunho e os itens dele — controle positivo", () => {
    expect(como(GOV_AGENT_A, `update public.crm_proposals set titulo = 'editado' where id = '${RASCUNHO}'`)).toBe(1);
    expect(como(GOV_AGENT_A, `update public.crm_proposal_items set quantidade = 2 where id = '${ITEM_RASCUNHO}'`)).toBe(1);
  });

  it("⭐ agent não marca o rascunho como aceito nem como enviado, nem numera", () => {
    expect(como(GOV_AGENT_A, `update public.crm_proposals set status = 'aceita' where id = '${RASCUNHO}'`)).toBe("negado");
    expect(como(GOV_AGENT_A, `update public.crm_proposals set status = 'enviada' where id = '${RASCUNHO}'`)).toBe("negado");
    expect(como(GOV_AGENT_A, `update public.crm_proposals set numero = 1, ano = 2026 where id = '${RASCUNHO}'`)).toBe("negado");
    expect(status(RASCUNHO)).toBe("rascunho");
  });

  it("⭐ descartar é de manager (a rota DELETE exige manager): agent não cancela nem apaga", () => {
    expect(como(GOV_AGENT_A, `update public.crm_proposals set status = 'cancelada' where id = '${DESCARTE}'`)).toBe("negado");
    expect(como(GOV_AGENT_A, `delete from public.crm_proposals where id = '${DESCARTE}'`)).toBe(0);
    expect(como(GOV_MANAGER, `update public.crm_proposals set status = 'cancelada' where id = '${DESCARTE}'`)).toBe(1);
  });

  it("viewer não escreve nada", () => {
    expect(como(GOV_VIEWER, `update public.crm_proposals set titulo = 'x' where id = '${RASCUNHO}'`)).toBe(0);
  });
});

/**
 * A APROVAÇÃO PARA O AGENTE ENVIAR (migration 9814).
 *
 * `aprovada_em` e `aprovada_na_revisao` são o que a ferramenta `crm_send_proposal`
 * lê no modo `apos_aprovacao`. Enviar pela tela exige `manager`; se a sessão de
 * um atendente pudesse gravar as duas colunas pelo PostgREST, ele aprovaria o
 * próprio rascunho e o agente de IA enviaria por ele.
 */
describe("aprovação da proposta: só o servidor grava (9814)", () => {
  it("as duas colunas existem, nascem nulas e andam juntas", () => {
    expect(
      sql(`select count(*) from information_schema.columns
            where table_schema='public' and table_name='crm_proposals'
              and column_name in ('aprovada_em','aprovada_na_revisao') and is_nullable='YES';`),
    ).toBe("2");
    expect(sql(`select aprovada_em is null and aprovada_na_revisao is null from public.crm_proposals where id = '${RASCUNHO}';`)).toBe("t");
    // Meia aprovação não entra, nem pelo servidor.
    expect(() => sql(`update public.crm_proposals set aprovada_em = now() where id = '${RASCUNHO}';`)).toThrow();
  });

  it("⭐ nenhuma sessão aprova: nem agent, nem manager, nem ao criar", () => {
    const aprovar = `update public.crm_proposals set aprovada_em = now(), aprovada_na_revisao = revision where id = '${RASCUNHO}'`;
    expect(como(GOV_AGENT_A, aprovar)).toBe("negado");
    expect(como(GOV_MANAGER, aprovar)).toBe("negado");
    expect(
      como(
        GOV_AGENT_A,
        `insert into public.crm_proposals (organization_id, titulo, aprovada_em, aprovada_na_revisao) values ('${GOV_ORG}', 'x', now(), 1)`,
      ),
    ).toBe("negado");
    expect(sql(`select aprovada_em is null from public.crm_proposals where id = '${RASCUNHO}';`)).toBe("t");
  });

  it("o servidor aprova, e a sessão não desfaz nem troca a aprovação ao editar o rascunho", () => {
    sql(`update public.crm_proposals set aprovada_em = now(), aprovada_na_revisao = revision where id = '${RASCUNHO}';`);
    expect(como(GOV_AGENT_A, `update public.crm_proposals set aprovada_na_revisao = 99 where id = '${RASCUNHO}'`)).toBe("negado");
    expect(como(GOV_AGENT_A, `update public.crm_proposals set aprovada_em = null, aprovada_na_revisao = null where id = '${RASCUNHO}'`)).toBe("negado");
    // Editar o conteúdo continua permitido: quem invalida a aprovação é a revisão que sobe.
    // Desde a 9815 o banco LIMPA a aprovação quando a revisão muda (antes ela só
    // ficava desencontrada); a prova inteira está em proposta-edicao-invalida-aprovacao.test.ts.
    expect(como(GOV_AGENT_A, `update public.crm_proposals set titulo = 'editado de novo', revision = revision + 1 where id = '${RASCUNHO}'`)).toBe(1);
    expect(
      sql(`select coalesce(aprovada_na_revisao = revision, false) from public.crm_proposals where id = '${RASCUNHO}';`),
    ).toBe("f");
    sql(`update public.crm_proposals set aprovada_em = null, aprovada_na_revisao = null where id = '${RASCUNHO}';`);
  });
});

describe("criar: só rascunho, sem nada do envio", () => {
  it("⭐ agent não cria proposta já enviada nem com arquivo apontado", () => {
    expect(
      como(GOV_AGENT_A, `insert into public.crm_proposals (organization_id, titulo, status) values ('${GOV_ORG}', 'x', 'enviada')`),
    ).toBe("negado");
    // pdf_path é o que a anonimização põe na fila de expurgo: aceitar um
    // caminho da sessão seria deixá-la apontar o expurgo para o arquivo alheio.
    expect(
      como(GOV_AGENT_A, `insert into public.crm_proposals (organization_id, titulo, pdf_path) values ('${GOV_ORG}', 'x', 'outra-org/p.pdf')`),
    ).toBe("negado");
  });

  it("agent cria rascunho (a rota POST é agent) — controle positivo", () => {
    expect(
      como(GOV_AGENT_A, `insert into public.crm_proposals (id, organization_id, titulo) values ('${CRIADA}', '${GOV_ORG}', 'novo')`),
    ).toBe(1);
  });
});
