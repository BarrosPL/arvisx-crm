import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GOV_LEAD, GOV_ORG, indexExists, seedGov, sql } from "./gov-helpers";

/**
 * UMA TAREFA DE SEGUIMENTO POR NEGÓCIO GANHO, GARANTIDA PELO BANCO (migration 9817).
 *
 * Revisão de 20/11, item 2.8. O gatilho "negócio ganho" da Equipe pronta
 * (`lib/ai/equipe-pronta/gatilhos/negocio-ganho.ts`) evitava a tarefa repetida
 * com um SELECT antes do INSERT. O evento `lead.won` é entregue ao menos uma
 * vez: duas entregas simultâneas liam "não existe" e criavam duas. O índice
 * único parcial faz a segunda inserção falhar com 23505, e o gatilho devolve a
 * tarefa que já existe.
 */
const TIPO = "dar_seguimento";
const INDICE = "crm_tasks_seguimento_do_ganho_uidx";
const MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20261123100017_9817_tarefa_de_seguimento_do_ganho_unica.sql",
);

const inserir = (kind: string | null, lead: string | null = GOV_LEAD, titulo = "tarefa 9817"): void => {
  sql(`insert into public.crm_tasks (organization_id, title, lead_id, kind)
       values ('${GOV_ORG}', '${titulo}', ${lead ? `'${lead}'` : "null"}, ${kind ? `'${kind}'` : "null"});`);
};

const contar = (kind: string): string =>
  sql(`select count(*) from public.crm_tasks where organization_id = '${GOV_ORG}' and title like 'tarefa 9817%' and kind = '${kind}';`);

beforeAll(() => {
  seedGov();
});

beforeEach(() => {
  sql(`delete from public.crm_tasks where organization_id = '${GOV_ORG}' and title like 'tarefa 9817%';`);
});

describe("crm_tasks_seguimento_do_ganho_uidx", () => {
  it("o índice existe, é único e é parcial no tipo reservado", () => {
    expect(indexExists(INDICE)).toBe(true);
    const def = sql(`select indexdef from pg_indexes where schemaname = 'public' and indexname = '${INDICE}';`);
    expect(def).toMatch(/CREATE UNIQUE INDEX/i);
    expect(def).toMatch(/organization_id, lead_id/);
    expect(def).toMatch(/dar_seguimento/);
    expect(def).toMatch(/lead_id IS NOT NULL/i);
  });

  it("⭐ a segunda tarefa de seguimento do MESMO negócio é recusada com 23505", () => {
    inserir(TIPO);
    let erro = "";
    try {
      inserir(TIPO);
    } catch (e) {
      erro = (e as { stderr?: string }).stderr ?? String(e);
    }
    expect(erro).toMatch(/duplicate key value violates unique constraint/);
    expect(erro).toContain(INDICE);
    expect(contar(TIPO)).toBe("1");
  });

  it("⭐ `on conflict do nothing` no índice: a entrega repetida do evento não cria a segunda nem dá erro", () => {
    const repetida = `
      insert into public.crm_tasks (organization_id, title, lead_id, kind)
      values ('${GOV_ORG}', 'tarefa 9817', '${GOV_LEAD}', '${TIPO}')
      on conflict (organization_id, lead_id) where kind = '${TIPO}' and lead_id is not null do nothing;`;
    sql(repetida);
    sql(repetida);
    expect(contar(TIPO)).toBe("1");
  });

  it("tarefa concluída ou cancelada continua contando: é uma por negócio, para sempre", () => {
    inserir(TIPO);
    sql(`update public.crm_tasks set status = 'done' where organization_id = '${GOV_ORG}' and title = 'tarefa 9817';`);
    expect(() => inserir(TIPO)).toThrow();
  });

  it("o resto de `kind` continua livre: outro tipo, sem tipo e tarefa sem negócio não entram no índice", () => {
    inserir("ligar");
    inserir("ligar");
    inserir(null);
    inserir(null);
    // Sem negócio, o tipo reservado não tem com o que colidir.
    inserir(TIPO, null);
    inserir(TIPO, null);
    expect(contar("ligar")).toBe("2");
    expect(contar(TIPO)).toBe("2");
  });
});

describe("a migration corrige o que já estava repetido antes de criar o índice", () => {
  it("⭐ reaplicada sobre um banco com repetição: a mais antiga fica, as outras perdem o tipo reservado, nada é apagado", () => {
    // O estado de um banco anterior à 9817: sem o índice, com três tarefas de
    // seguimento no mesmo negócio.
    sql(`drop index if exists public.${INDICE};`);
    sql(`
      insert into public.crm_tasks (organization_id, title, lead_id, kind, created_at) values
        ('${GOV_ORG}', 'tarefa 9817 primeira', '${GOV_LEAD}', '${TIPO}', '2026-11-01T10:00:00Z'),
        ('${GOV_ORG}', 'tarefa 9817 segunda',  '${GOV_LEAD}', '${TIPO}', '2026-11-02T10:00:00Z'),
        ('${GOV_ORG}', 'tarefa 9817 terceira', '${GOV_LEAD}', '${TIPO}', '2026-11-03T10:00:00Z');
    `);

    const migration = readFileSync(MIGRATION, "utf8");
    sql(migration);

    expect(indexExists(INDICE)).toBe(true);
    expect(
      sql(`select string_agg(title || '=' || kind, ',' order by created_at) from public.crm_tasks
            where organization_id = '${GOV_ORG}' and title like 'tarefa 9817%';`),
    ).toBe(
      "tarefa 9817 primeira=dar_seguimento,tarefa 9817 segunda=dar_seguimento_repetida,tarefa 9817 terceira=dar_seguimento_repetida",
    );

    // Idempotente: a segunda passada não mexe em mais nada.
    sql(migration);
    expect(contar(TIPO)).toBe("1");
    expect(contar("dar_seguimento_repetida")).toBe("2");
  });
});
