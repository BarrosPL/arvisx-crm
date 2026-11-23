import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { criarPorta } from "@/lib/db";
import { linhaLegivelDaNota, MODULO_DAS_NOTAS } from "@/lib/leads/notas-do-negocio";
import { insereAtividadeDoLead } from "@/lib/tarefas/atividade";

/**
 * MIGRATION 9818 — a nota do negócio: UMA por chave de idempotência
 * (revisão de 20/11, item 2.13).
 *
 * O teste unitário (`tests/unit/mcp-notas-do-negocio.test.ts`) prova que o
 * aplicativo, ao receber `23505`, devolve a nota que a outra chamada gravou.
 * Aqui se prova o que só o Postgres afirma:
 *
 *   1. o índice chegou ao `baseline.sql`, é único e PARCIAL;
 *   2. a segunda nota com a mesma chave no mesmo negócio é recusada com `23505`
 *      — e é o que decide a corrida entre duas gravações simultâneas;
 *   3. o que NÃO pode ser barrado continua entrando: a mesma chave em outro
 *      negócio, em outra organização, nota sem chave repetida, e linha da
 *      timeline que não é nota do módulo de notas;
 *   4. a correção das notas que JÁ estavam em dobro (o que o `update.sh` de um
 *      banco com dados encontra) não apaga nenhuma, deixa a chave só na mais
 *      antiga, e pode rodar de novo.
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

const ORG_A = "e9818000-0000-4000-8000-00000000000a";
const ORG_B = "e9818000-0000-4000-8000-00000000000b";
const FUNIL_A = "e9818000-0000-4000-8000-000000000301";
const ETAPA_A = "e9818000-0000-4000-8000-000000000302";
const FUNIL_B = "e9818000-0000-4000-8000-000000000311";
const ETAPA_B = "e9818000-0000-4000-8000-000000000312";
const CONTATO_A = "e9818000-0000-4000-8000-000000000401";
const CONTATO_B = "e9818000-0000-4000-8000-000000000402";
const LEAD_A = "e9818000-0000-4000-8000-000000000501";
const LEAD_A2 = "e9818000-0000-4000-8000-000000000502";
const LEAD_B = "e9818000-0000-4000-8000-000000000503";
const TOKEN = "e9818000-0000-4000-8000-000000000701";

const INDICE = "uq_crm_lead_activities_nota_idempotencia";

/** A nota como `registrarNotaDoNegocio` a grava para um token de API. */
function nota(
  organizationId: string,
  leadId: string,
  contactId: string,
  texto: string,
  chave: string | null,
) {
  return insereAtividadeDoLead(db, {
    organizationId,
    leadId,
    contactId,
    type: "note",
    sourceModule: MODULO_DAS_NOTAS,
    actor: { type: "api_token", id: TOKEN, role: "agent" },
    reason: linhaLegivelDaNota("Agente externo", null, texto),
    payload: {
      texto,
      autor: { tipo: "token", id: TOKEN, nome: "Agente externo" },
      ...(chave ? { idempotency_key: chave } : {}),
    },
  });
}

async function notasCom(leadId: string, chave: string): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as n from crm_lead_activities
      where lead_id = $1 and type = 'note' and source_module = 'notas'
        and payload->>'idempotency_key' = $2`,
    [leadId, chave],
  );
  return rows[0].n as number;
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name) values
       ($1, 'superficie-9818-a', 'Org A da 9818', 'Org A'),
       ($2, 'superficie-9818-b', 'Org B da 9818', 'Org B')`,
    [ORG_A, ORG_B],
  );
  await pool.query(
    `insert into crm_pipelines (id, organization_id, name, slug) values
       ($1, $2, 'Funil A', 'superficie-9818-a'),
       ($3, $4, 'Funil B', 'superficie-9818-b')`,
    [FUNIL_A, ORG_A, FUNIL_B, ORG_B],
  );
  await pool.query(
    `insert into crm_stages (id, organization_id, pipeline_id, name, slug, position) values
       ($1, $2, $3, 'Entrada', 'entrada-9818-a', 1000),
       ($4, $5, $6, 'Entrada', 'entrada-9818-b', 1000)`,
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
       ($6, $2, $3, $4, $5, 'Segundo negócio da A'),
       ($7, $8, $9, $10, $11, 'Negócio da B')`,
    [LEAD_A, ORG_A, FUNIL_A, ETAPA_A, CONTATO_A, LEAD_A2, LEAD_B, ORG_B, FUNIL_B, ETAPA_B, CONTATO_B],
  );
});

describe("migration 9818 — o índice único da nota do negócio", () => {
  it("existe, é único e é parcial: só nota do módulo de notas, com chave", async () => {
    const { rows } = await pool.query(
      `select i.indisunique as unico, pg_get_indexdef(i.indexrelid) as definicao,
              pg_get_expr(i.indpred, i.indrelid) as predicado
         from pg_index i
         join pg_class c on c.oid = i.indexrelid
        where c.relname = $1 and i.indrelid = 'public.crm_lead_activities'::regclass`,
      [INDICE],
    );
    expect(rows, "o índice da 9818 não chegou ao baseline").toHaveLength(1);
    expect(rows[0].unico).toBe(true);
    expect(rows[0].definicao).toContain("organization_id");
    expect(rows[0].definicao).toContain("lead_id");
    expect(rows[0].definicao).toContain("idempotency_key");
    expect(rows[0].predicado).toContain("note");
    expect(rows[0].predicado).toContain("notas");
    expect(rows[0].predicado).toContain("idempotency_key");
  });

  it("⭐ a segunda nota com a MESMA chave no MESMO negócio é recusada com 23505", async () => {
    const CHAVE = "11111111-1111-4111-8111-111111111111";
    expect(await nota(ORG_A, LEAD_A, CONTATO_A, "Uma vez só", CHAVE)).toEqual({ ok: true });

    const repetida = await nota(ORG_A, LEAD_A, CONTATO_A, "Uma vez só", CHAVE);
    expect(repetida.ok).toBe(false);
    expect(repetida.error).toContain(INDICE);
    expect(await notasCom(LEAD_A, CHAVE)).toBe(1);

    // O código que o aplicativo lê para devolver a nota já gravada.
    const erro = await pool
      .query(
        `insert into crm_lead_activities (organization_id, lead_id, contact_id, type, source_module, payload)
         select organization_id, lead_id, contact_id, type, source_module, payload
           from crm_lead_activities
          where lead_id = $1 and payload->>'idempotency_key' = $2`,
        [LEAD_A, CHAVE],
      )
      .then(
        () => null,
        (e: { code?: string }) => e.code,
      );
    expect(erro).toBe("23505");
  });

  it("⭐ duas gravações SIMULTÂNEAS com a mesma chave: entra uma só", async () => {
    const CHAVE = "22222222-2222-4222-8222-222222222222";
    const desfechos = await Promise.all(
      Array.from({ length: 6 }, () => nota(ORG_A, LEAD_A, CONTATO_A, "Em rajada", CHAVE)),
    );

    expect(desfechos.filter((d) => d.ok)).toHaveLength(1);
    expect(await notasCom(LEAD_A, CHAVE)).toBe(1);
  });

  it("a mesma chave em OUTRO negócio e em OUTRA organização entra: a chave é por negócio", async () => {
    const CHAVE = "33333333-3333-4333-8333-333333333333";
    expect(await nota(ORG_A, LEAD_A, CONTATO_A, "x", CHAVE)).toEqual({ ok: true });
    expect(await nota(ORG_A, LEAD_A2, CONTATO_A, "x", CHAVE)).toEqual({ ok: true });
    expect(await nota(ORG_B, LEAD_B, CONTATO_B, "x", CHAVE)).toEqual({ ok: true });
  });

  it("nota SEM chave pode se repetir — o índice não a alcança", async () => {
    expect(await nota(ORG_A, LEAD_A, CONTATO_A, "Sem chave", null)).toEqual({ ok: true });
    expect(await nota(ORG_A, LEAD_A, CONTATO_A, "Sem chave", null)).toEqual({ ok: true });
  });

  it("linha da timeline que não é nota do módulo de notas não entra no índice, mesmo com a chave no payload", async () => {
    const CHAVE = "44444444-4444-4444-8444-444444444444";
    for (let i = 0; i < 2; i += 1) {
      const r = await insereAtividadeDoLead(db, {
        organizationId: ORG_A,
        leadId: LEAD_A,
        contactId: CONTATO_A,
        type: "note",
        sourceModule: "outro-modulo",
        actor: { type: "api_token", id: TOKEN, role: "agent" },
        reason: "nota de outro módulo",
        payload: { texto: "nota de outro módulo", idempotency_key: CHAVE },
      });
      expect(r).toEqual({ ok: true });
    }
  });
});

describe("migration 9818 — banco que JÁ tem a nota em dobro (o que o update.sh encontra)", () => {
  const CHAVE = "55555555-5555-4555-8555-555555555555";
  const MIGRATION = readFileSync(
    join(process.cwd(), "supabase/migrations/20261123121800_9818_nota_do_negocio_uma_por_chave.sql"),
    "utf8",
  );

  it("⭐ a correção não apaga nota nenhuma, deixa a chave só na mais antiga, sobe o índice e pode rodar de novo", async () => {
    // O banco de antes da 9818: sem o índice, com a corrida já acontecida.
    await pool.query(`drop index public.${INDICE}`);
    for (const texto of ["primeira", "segunda (em dobro)", "terceira (em dobro)"]) {
      expect(await nota(ORG_A, LEAD_A2, CONTATO_A, texto, CHAVE)).toEqual({ ok: true });
      await pool.query("select pg_sleep(0.01)");
    }
    expect(await notasCom(LEAD_A2, CHAVE)).toBe(3);

    await pool.query(MIGRATION);
    await pool.query(MIGRATION); // idempotente

    const { rows } = await pool.query(
      `select payload->>'texto' as texto,
              payload->>'idempotency_key' as chave,
              payload->>'idempotency_key_repetida' as repetida
         from crm_lead_activities
        where lead_id = $1 and type = 'note' and source_module = 'notas'
          and (payload->>'idempotency_key' = $2 or payload->>'idempotency_key_repetida' = $2)
        order by performed_at, created_at, id`,
      [LEAD_A2, CHAVE],
    );
    expect(rows).toEqual([
      { texto: "primeira", chave: CHAVE, repetida: null },
      { texto: "segunda (em dobro)", chave: null, repetida: CHAVE },
      { texto: "terceira (em dobro)", chave: null, repetida: CHAVE },
    ]);

    const { rows: indice } = await pool.query(
      `select 1 from pg_indexes where schemaname = 'public' and indexname = $1`,
      [INDICE],
    );
    expect(indice).toHaveLength(1);
    expect((await nota(ORG_A, LEAD_A2, CONTATO_A, "depois da correção", CHAVE)).ok).toBe(false);
  });
});
