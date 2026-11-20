import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { criarPorta } from "@/lib/db";
import { linhaLegivelDaNota, MODULO_DAS_NOTAS, NOTA_MAX } from "@/lib/leads/notas-do-negocio";
import { insereAtividadeDoLead } from "@/lib/tarefas/atividade";
import { RESULTADO_DA_TAREFA_MAX, TIPO_DA_TAREFA_MAX } from "@/lib/tarefas/servico";

/**
 * SUPERFÍCIE DE AGENTE, PR 1 — o que só Postgres de verdade prova.
 *
 * As ferramentas (`crm_create_task`, `crm_add_lead_note`…) são testadas contra
 * um banco em memória em `tests/unit/mcp-*.test.ts`: lá se prova que o HANDLER
 * filtra por organização. Aqui se prova o que o banco em memória não tem como
 * afirmar:
 *
 *   1. a migration 9809 chegou ao `baseline.sql`: `crm_tasks.kind` e
 *      `crm_tasks.result` existem, nascem nulas, e os CHECKs têm os MESMOS tetos
 *      que o aplicativo valida (`TIPO_DA_TAREFA_MAX`, `RESULTADO_DA_TAREFA_MAX`)
 *      — dois números que precisam concordar e moram em arquivos diferentes;
 *   2. o texto longo entra INTEIRO, na tarefa e na nota;
 *   3. a linha da nota, como o emissor a monta para um TOKEN DE API, passa nas
 *      constraints de `crm_lead_activities` (ator sem lastro não pode ser `ai`);
 *   4. o filtro por destinatário (`payload @> …`) acha a nota, e só a da
 *      organização pedida;
 *   5. **isolamento por RLS**: quem é da organização A não lê nem altera a
 *      tarefa (com o resultado dela) nem a nota da organização B.
 */
if (!process.env.TEST_DB_PORT) throw new Error("TEST_DB_PORT ausente — execute pnpm test:db");

const pool = new Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT}/postgres`,
  max: 4,
});
const db = criarPorta(pool);

afterAll(async () => {
  await pool.end();
});

const ORG_A = "e9809000-0000-4000-8000-00000000000a";
const ORG_B = "e9809000-0000-4000-8000-00000000000b";
const USER_A = "e9809000-0000-4000-8000-000000000101";
const USER_B = "e9809000-0000-4000-8000-000000000201";
const FUNIL_A = "e9809000-0000-4000-8000-000000000301";
const ETAPA_A = "e9809000-0000-4000-8000-000000000302";
const FUNIL_B = "e9809000-0000-4000-8000-000000000311";
const ETAPA_B = "e9809000-0000-4000-8000-000000000312";
const CONTATO_A = "e9809000-0000-4000-8000-000000000401";
const CONTATO_B = "e9809000-0000-4000-8000-000000000402";
const LEAD_A = "e9809000-0000-4000-8000-000000000501";
const LEAD_B = "e9809000-0000-4000-8000-000000000502";
const TAREFA_A = "e9809000-0000-4000-8000-000000000601";
const TAREFA_B = "e9809000-0000-4000-8000-000000000602";
const TOKEN_A = "e9809000-0000-4000-8000-000000000701";

/** Roda um statement como um usuário logado — a RLS vale, como no PostgREST. */
async function como(usuario: string, sql: string, args: unknown[] = []) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: usuario, role: "authenticated", aal: "aal1" }),
    ]);
    const resultado = await client.query(sql, args);
    await client.query("commit");
    return resultado;
  } catch (erro) {
    await client.query("rollback");
    throw erro;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name) values
       ($1, 'superficie-9809-a', 'Org A da superfície', 'Org A'),
       ($2, 'superficie-9809-b', 'Org B da superfície', 'Org B')`,
    [ORG_A, ORG_B],
  );
  await pool.query(
    `insert into auth.users (id, email) values
       ($1, 'superficie-9809-a@invariant.test'),
       ($2, 'superficie-9809-b@invariant.test')`,
    [USER_A, USER_B],
  );
  await pool.query(
    `insert into user_organizations (user_id, organization_id, role, accepted_at) values
       ($1, $2, 'manager', now()),
       ($3, $4, 'manager', now())`,
    [USER_A, ORG_A, USER_B, ORG_B],
  );
  await pool.query(
    `insert into crm_pipelines (id, organization_id, name, slug) values
       ($1, $2, 'Funil A', 'superficie-9809-a'),
       ($3, $4, 'Funil B', 'superficie-9809-b')`,
    [FUNIL_A, ORG_A, FUNIL_B, ORG_B],
  );
  await pool.query(
    `insert into crm_stages (id, organization_id, pipeline_id, name, slug, position) values
       ($1, $2, $3, 'Entrada', 'entrada-9809-a', 1000),
       ($4, $5, $6, 'Entrada', 'entrada-9809-b', 1000)`,
    [ETAPA_A, ORG_A, FUNIL_A, ETAPA_B, ORG_B, FUNIL_B],
  );
  await pool.query(
    `insert into contacts (id, organization_id, name) values
       ($1, $2, 'Cliente A'),
       ($3, $4, 'Cliente B')`,
    [CONTATO_A, ORG_A, CONTATO_B, ORG_B],
  );
  await pool.query(
    `insert into crm_leads (id, organization_id, pipeline_id, stage_id, contact_id, title) values
       ($1, $2, $3, $4, $5, 'Negócio da A'),
       ($6, $7, $8, $9, $10, 'Negócio da B')`,
    [LEAD_A, ORG_A, FUNIL_A, ETAPA_A, CONTATO_A, LEAD_B, ORG_B, FUNIL_B, ETAPA_B, CONTATO_B],
  );
  await pool.query(
    `insert into crm_tasks (id, organization_id, title, lead_id, contact_id, kind, result, status) values
       ($1, $2, 'Tarefa da A', $3, $4, 'ligação', 'resultado da A', 'done'),
       ($5, $6, 'Tarefa da B', $7, $8, 'documento', 'resultado SECRETO da B', 'done')`,
    [TAREFA_A, ORG_A, LEAD_A, CONTATO_A, TAREFA_B, ORG_B, LEAD_B, CONTATO_B],
  );
});

describe("migration 9809 — tipo e resultado da tarefa", () => {
  it("as duas colunas existem, são texto e aceitam nulo", async () => {
    const { rows } = await pool.query(
      `select column_name, data_type, is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'crm_tasks'
          and column_name in ('kind', 'result')
        order by column_name`,
    );
    expect(rows).toEqual([
      { column_name: "kind", data_type: "text", is_nullable: "YES" },
      { column_name: "result", data_type: "text", is_nullable: "YES" },
    ]);
  });

  it("tarefa criada sem tipo nem resultado nasce com os dois nulos — a tela não muda", async () => {
    const { rows } = await pool.query(
      `insert into crm_tasks (organization_id, title) values ($1, 'Tarefa da tela')
       returning kind, result`,
      [ORG_A],
    );
    expect(rows[0]).toEqual({ kind: null, result: null });
  });

  it("⭐ o resultado entra INTEIRO no teto que o aplicativo valida, e um caractere a mais é recusado", async () => {
    const noTeto = "r".repeat(RESULTADO_DA_TAREFA_MAX);
    const { rows } = await pool.query(
      "update crm_tasks set result = $1 where id = $2 returning length(result) as tamanho",
      [noTeto, TAREFA_A],
    );
    expect(rows[0].tamanho).toBe(RESULTADO_DA_TAREFA_MAX);

    await expect(
      pool.query("update crm_tasks set result = $1 where id = $2", [`${noTeto}r`, TAREFA_A]),
    ).rejects.toThrow(/crm_tasks_result_tamanho/);
  });

  it("⭐ o tipo tem o mesmo teto do aplicativo, e não aceita texto vazio", async () => {
    await pool.query("update crm_tasks set kind = $1 where id = $2", ["t".repeat(TIPO_DA_TAREFA_MAX), TAREFA_A]);

    await expect(
      pool.query("update crm_tasks set kind = $1 where id = $2", ["t".repeat(TIPO_DA_TAREFA_MAX + 1), TAREFA_A]),
    ).rejects.toThrow(/crm_tasks_kind_tamanho/);
    await expect(
      pool.query("update crm_tasks set kind = '   ' where id = $1", [TAREFA_A]),
    ).rejects.toThrow(/crm_tasks_kind_tamanho/);
  });

  it("⭐ RLS: quem é da A não lê a tarefa da B — nem o tipo, nem o resultado dela", async () => {
    const { rows } = await como(USER_A, "select id, kind, result from crm_tasks where id = any($1)", [
      [TAREFA_A, TAREFA_B],
    ]);
    expect(rows.map((r) => r.id)).toEqual([TAREFA_A]);
    expect(JSON.stringify(rows)).not.toContain("SECRETO");
  });

  it("⭐ RLS: quem é da A não altera o resultado da tarefa da B", async () => {
    const alteradas = await como(USER_A, "update crm_tasks set result = 'invadido' where id = $1", [TAREFA_B]);
    expect(alteradas.rowCount).toBe(0);

    const { rows } = await pool.query("select result from crm_tasks where id = $1", [TAREFA_B]);
    expect(rows[0].result).toBe("resultado SECRETO da B");
  });
});

describe("a nota do negócio na linha do tempo", () => {
  const TEXTO_LONGO = "Contexto do atendimento. ".repeat(800).slice(0, NOTA_MAX);

  beforeAll(async () => {
    // A linha como o emissor a monta para um TOKEN DE API: sem pessoa e sem
    // agente cadastrado. É a forma que `registrarNotaDoNegocio` grava.
    const daA = await insereAtividadeDoLead(db, {
      organizationId: ORG_A,
      leadId: LEAD_A,
      contactId: CONTATO_A,
      type: "note",
      sourceModule: MODULO_DAS_NOTAS,
      actor: { type: "api_token", id: TOKEN_A, role: "agent" },
      reason: linhaLegivelDaNota("Agente externo", "financeiro", TEXTO_LONGO),
      payload: {
        texto: TEXTO_LONGO,
        autor: { tipo: "token", id: TOKEN_A, nome: "Agente externo" },
        destinatario: "financeiro",
        destinatario_chave: "financeiro",
      },
    });
    expect(daA, "a nota de um token de API foi recusada pelas constraints da timeline").toEqual({ ok: true });

    const daB = await insereAtividadeDoLead(db, {
      organizationId: ORG_B,
      leadId: LEAD_B,
      contactId: CONTATO_B,
      type: "note",
      sourceModule: MODULO_DAS_NOTAS,
      actor: { type: "api_token", id: TOKEN_A, role: "agent" },
      reason: linhaLegivelDaNota("Agente da B", "financeiro", "recado SECRETO da B"),
      payload: {
        texto: "recado SECRETO da B",
        autor: { tipo: "token", id: TOKEN_A, nome: "Agente da B" },
        destinatario: "financeiro",
        destinatario_chave: "financeiro",
      },
    });
    expect(daB).toEqual({ ok: true });
  });

  it("⭐ texto longo fica INTEIRO, no payload e no que a pessoa lê", async () => {
    const { rows } = await pool.query(
      `select payload->>'texto' as texto, reason, actor_kind
         from crm_lead_activities
        where organization_id = $1 and lead_id = $2 and type = 'note' and source_module = $3`,
      [ORG_A, LEAD_A, MODULO_DAS_NOTAS],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].texto).toBe(TEXTO_LONGO);
    expect(rows[0].texto.length).toBe(NOTA_MAX);
    expect(rows[0].reason.endsWith(TEXTO_LONGO)).toBe(true);
    // token de API não é pessoa nem agente com lastro: a timeline não afirma autoria de IA
    expect(rows[0].actor_kind).toBe("system");
  });

  it("⭐ o filtro por destinatário (`payload @>`) acha a nota — e só a da organização pedida", async () => {
    const { rows } = await pool.query(
      `select organization_id from crm_lead_activities
        where organization_id = $1 and type = 'note'
          and payload @> '{"destinatario_chave":"financeiro"}'::jsonb`,
      [ORG_A],
    );
    expect(rows).toEqual([{ organization_id: ORG_A }]);

    const semRecado = await pool.query(
      `select 1 from crm_lead_activities
        where organization_id = $1 and type = 'note'
          and payload @> '{"destinatario_chave":"juridico"}'::jsonb`,
      [ORG_A],
    );
    expect(semRecado.rowCount).toBe(0);
  });

  it("⭐ RLS: quem é da A não lê a nota da B", async () => {
    const { rows } = await como(
      USER_A,
      "select organization_id, reason from crm_lead_activities where type = 'note' and source_module = $1 and lead_id = any($2)",
      [MODULO_DAS_NOTAS, [LEAD_A, LEAD_B]],
    );
    expect(rows.map((r) => r.organization_id)).toEqual([ORG_A]);
    expect(JSON.stringify(rows)).not.toContain("SECRETO");
  });
});
