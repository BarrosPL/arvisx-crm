import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { countAs, GOV_AGENT_A, sql } from "./gov-helpers";

/**
 * A JUNÇÃO DE CONTATOS FEITA POR AGENTE GUARDA O QUE JUNTOU E PODE SER DESFEITA
 * (migration 9813, ajustes AJ-3).
 *
 * O que este arquivo executa é o SQL de verdade, contra o Postgres do
 * `scripts/test-db.sh` (baseline aplicado, como o kit self-host instala):
 * `fn_mesclar_contatos_com_registro` e `fn_desfazer_fusao_de_contatos`. A
 * ferramenta (`crm_merge_contacts`, `crm_undo_contact_merge`) é medida em
 * `tests/unit/mcp-contatos-duplicados.test.ts`, com as duas funções trocadas por
 * dublê: papel, recusas e auditoria. Aqui se mede o que o dublê não sabe:
 *
 *  1. o registro guarda as linhas que mudaram de ficha, e só ids;
 *  2. o desfazer devolve a ficha absorvida e as linhas dela, e a ficha que
 *     ficou perde o que herdou;
 *  3. o que nasceu depois da junção numa conversa devolvida acompanha a conversa;
 *  4. o que o desfazer NÃO devolve fica dito no resultado, e não fingido;
 *  5. conflito de unicidade: nada muda;
 *  6. outra organização não alcança nem o contato nem o registro;
 *  7. a tabela e as três funções são só do servidor.
 *
 * Comando:
 *     pnpm test:db tests/invariants/fusao-de-contatos-registro-e-desfazer.test.ts
 *
 * ─── SABOTAGEM ──────────────────────────────────────────────────────────────
 * - Trocar a chamada a `fn_mesclar_contatos` por nada: a ficha absorvida não
 *   vira lápide e o primeiro caso cai.
 * - Tirar o passo (c) do desfazer (a ficha volta a existir): `is_merged_into`
 *   continua preenchido e o caso da reversão cai.
 * - Tirar o filtro `organization_id` da leitura do registro no desfazer: o caso
 *   da outra organização passa a desfazer a junção do vizinho.
 * - Tirar o `exception when unique_violation`: o caso do conflito recebe o erro
 *   cru do índice, e não `conflito_ao_desfazer_fusao`.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 4,
});

const ORG = "98130000-0000-4000-8000-000000000001";
const OUTRA_ORG = "98130000-0000-4000-8000-000000000002";
const SESSAO = "98130000-0000-4000-8000-0000000000a1";

let seq = 0;
function uid(): string {
  seq += 1;
  return `9813c000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

let funil = "";
let etapa = "";

interface Ficha {
  id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
  source_metadata: Record<string, unknown>;
  is_merged_into: string | null;
  merged_at: string | null;
}

async function contato(args: {
  org?: string;
  nome?: string | null;
  telefone?: string | null;
  email?: string | null;
  tags?: string[];
  campos?: Record<string, unknown>;
  pessoal?: boolean;
}): Promise<string> {
  const id = uid();
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number, email, tags, custom_fields, is_personal)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      args.org ?? ORG,
      args.nome ?? null,
      args.telefone ?? null,
      args.email ?? null,
      args.tags ?? [],
      args.campos ?? {},
      args.pessoal ?? false,
    ],
  );
  return id;
}

async function ficha(id: string): Promise<Ficha> {
  const { rows } = await pool.query<Ficha>(
    `select id, name, email, phone_number, tags, custom_fields, source_metadata, is_merged_into,
            merged_at::text as merged_at
       from contacts where id = $1`,
    [id],
  );
  return rows[0]!;
}

async function conversa(contactId: string): Promise<string> {
  const id = uid();
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status)
     values ($1, $2, $3, $4, 'open')`,
    [id, ORG, contactId, SESSAO],
  );
  return id;
}

async function mensagem(conversationId: string, contactId: string, corpo: string): Promise<string> {
  const id = uid();
  await pool.query(
    `insert into messages
       (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, sent_via, body)
     values ($1, $2, $3, $4, $5, 'text', 'inbound', 'received', 'crm', $6)`,
    [id, ORG, conversationId, SESSAO, contactId, corpo],
  );
  return id;
}

async function negocio(contactId: string, titulo: string): Promise<string> {
  const id = uid();
  await pool.query(
    `insert into crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, ORG, funil, etapa, titulo, contactId],
  );
  return id;
}

async function tarefa(contactId: string, titulo: string): Promise<string> {
  const id = uid();
  await pool.query(
    `insert into crm_tasks (id, organization_id, contact_id, title) values ($1, $2, $3, $4)`,
    [id, ORG, contactId, titulo],
  );
  return id;
}

async function donoDe(tabela: string, id: string): Promise<string | null> {
  const { rows } = await pool.query<{ contact_id: string | null }>(
    `select contact_id from ${tabela} where id = $1`,
    [id],
  );
  return rows[0]?.contact_id ?? null;
}

type Json = Record<string, unknown>;

async function juntar(principal: string, absorvido: string, org = ORG): Promise<Json> {
  const { rows } = await pool.query<{ r: Json }>(
    "select public.fn_mesclar_contatos_com_registro($1, $2, $3, null) as r",
    [org, principal, absorvido],
  );
  return rows[0]!.r;
}

async function desfazer(registro: string, org = ORG): Promise<Json> {
  const { rows } = await pool.query<{ r: Json }>(
    "select public.fn_desfazer_fusao_de_contatos($1, $2, null) as r",
    [org, registro],
  );
  return rows[0]!.r;
}

/** O rótulo que a função levantou (`raise ... message = '<rótulo>'`). */
async function recusa(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (e) {
    return (e as { message?: string }).message ?? "sem_mensagem";
  }
  return "NAO_RECUSOU";
}

async function registro(id: string): Promise<{
  contato_principal_id: string;
  contato_absorvido_id: string;
  vinculos: Record<string, string[]>;
  estado_anterior: Json;
  desfeito_em: string | null;
}> {
  const { rows } = await pool.query(
    `select contato_principal_id, contato_absorvido_id, vinculos, estado_anterior, desfeito_em::text as desfeito_em
       from fusoes_de_contatos where id = $1`,
    [id],
  );
  return rows[0];
}

beforeAll(async () => {
  for (const [id, slug] of [
    [ORG, "org-9813-fusao"],
    [OUTRA_ORG, "org-9813-vizinha"],
  ] as const) {
    await pool.query(
      `insert into organizations (id, slug, legal_name, display_name)
       values ($1, $2, 'Fusão LTDA', 'Fusão') on conflict (id) do nothing`,
      [id, slug],
    );
  }
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
     values ($1, $2, 'fusao-9813', '\\x00'::bytea) on conflict (id) do nothing`,
    [SESSAO, ORG],
  );
  const p = await pool.query<{ id: string }>(
    `insert into crm_pipelines (organization_id, name, slug) values ($1, 'Fusão 9813', 'fusao-9813') returning id`,
    [ORG],
  );
  funil = p.rows[0]!.id;
  const existente = await pool.query<{ id: string }>(
    "select id from crm_stages where organization_id = $1 and pipeline_id = $2 order by position limit 1",
    [ORG, funil],
  );
  if (existente.rows[0]) {
    etapa = existente.rows[0].id;
  } else {
    const e = await pool.query<{ id: string }>(
      `insert into crm_stages (organization_id, pipeline_id, name, slug, position)
       values ($1, $2, 'Novo', 'novo', 1000) returning id`,
      [ORG, funil],
    );
    etapa = e.rows[0]!.id;
  }

  // Controle de vacuidade: sem o apêndice da 9813 todo caso abaixo cairia por
  // "does not exist", e não pela regra.
  const { rows } = await pool.query<{ t: string | null; n: string }>(
    `select to_regclass('public.fusoes_de_contatos')::text as t,
            (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('fn_mesclar_contatos_com_registro', 'fn_desfazer_fusao_de_contatos',
                                  'fn_colunas_que_apontam_para_contato')) as n`,
  );
  if (rows[0]!.t === null || rows[0]!.n !== "3") {
    throw new Error("a migration 9813 não está no banco (tabela ou funções ausentes)");
  }
});

afterAll(async () => {
  // Limpeza de melhor esforço, na ordem das chaves: `messages` e `conversations`
  // seguram o contato com `on delete restrict`. O banco do gate é descartável;
  // uma limpeza que falha não pode virar vermelho de um caso que passou.
  try {
    await pool.query("delete from messages where organization_id = $1", [ORG]);
    await pool.query("delete from conversations where organization_id = $1", [ORG]);
    await pool.query("delete from organizations where id = any($1)", [[ORG, OUTRA_ORG]]);
  } catch {
    // fica para o descarte do banco
  }
  await pool.end();
});

describe("a lista de colunas que apontam para o contato sai do catálogo", () => {
  it("traz as tabelas centrais, o vínculo polimórfico e a própria tabela de registro", async () => {
    const { rows } = await pool.query<{ chave: string; tipo_do_id: string | null }>(
      `select tabela || '.' || coluna as chave, tipo_do_id from public.fn_colunas_que_apontam_para_contato()`,
    );
    const chaves = rows.map((r) => r.chave);
    for (const esperada of [
      "conversations.contact_id",
      "messages.contact_id",
      "crm_leads.contact_id",
      "crm_tasks.contact_id",
      "contact_phones.contact_id",
      "crm_lead_links.target_id",
      "fusoes_de_contatos.contato_principal_id",
      "fusoes_de_contatos.contato_absorvido_id",
    ]) {
      expect(chaves, esperada).toContain(esperada);
    }
    // `contacts.is_merged_into` não entra: a lápide é tratada à parte.
    expect(chaves.filter((c) => c.startsWith("contacts."))).toEqual([]);
    expect(rows.find((r) => r.chave === "conversations.contact_id")!.tipo_do_id).toBe("uuid");
  });
});

describe("⭐ juntar com registro", () => {
  it("junta como a `fn_mesclar_contatos` de sempre e guarda as linhas que mudaram de ficha", async () => {
    const fica = await contato({ nome: "Ana Souza", telefone: "+5531998130001" });
    const sai = await contato({ nome: "Ana S.", telefone: "+5531998130002", email: "ana@exemplo.test" });
    const c = await conversa(sai);
    const m = await mensagem(c, sai, "oi");
    const n = await negocio(sai, "Negócio da Ana");
    const t = await tarefa(sai, "Ligar");
    const tarefaDeQuemFica = await tarefa(fica, "Já era dela");

    const r = await juntar(fica, sai);
    expect(typeof r.registro_id).toBe("string");
    expect((await ficha(sai)).is_merged_into).toBe(fica);
    for (const [tabela, id] of [
      ["conversations", c],
      ["messages", m],
      ["crm_leads", n],
      ["crm_tasks", t],
    ] as const) {
      expect(await donoDe(tabela, id), tabela).toBe(fica);
    }

    const reg = await registro(r.registro_id as string);
    expect(reg.contato_principal_id).toBe(fica);
    expect(reg.contato_absorvido_id).toBe(sai);
    expect(reg.desfeito_em).toBeNull();
    expect(reg.vinculos["conversations.contact_id"]).toEqual([c]);
    expect(reg.vinculos["messages.contact_id"]).toEqual([m]);
    expect(reg.vinculos["crm_leads.contact_id"]).toEqual([n]);
    expect(reg.vinculos["crm_tasks.contact_id"]).toEqual([t]);
    // A tarefa que já era da ficha que fica NÃO entra no registro.
    expect(JSON.stringify(reg.vinculos)).not.toContain(tarefaDeQuemFica);
    expect(reg.estado_anterior.campos_herdados).toEqual(["email"]);
  });

  it("o registro não guarda dado da pessoa: nem telefone, nem e-mail, nem nome, nem etiqueta", async () => {
    const fica = await contato({ nome: "Bruno Lima" });
    const sai = await contato({
      nome: "Bruno L.",
      telefone: "+5531998130010",
      email: "bruno.segredo@exemplo.test",
      tags: ["etiqueta-secreta"],
      campos: { apelido: "valor-secreto" },
    });
    const r = await juntar(fica, sai);
    const { rows } = await pool.query<{ linha: string }>(
      "select to_jsonb(f)::text as linha from fusoes_de_contatos f where id = $1",
      [r.registro_id],
    );
    const linha = rows[0]!.linha;
    for (const segredo of ["998130010", "bruno.segredo", "Bruno", "etiqueta-secreta", "valor-secreto"]) {
      expect(linha, segredo).not.toContain(segredo);
    }
    // O NOME do campo personalizado herdado fica; o valor, não.
    expect(linha).toContain("apelido");
  });

  it("recusa contato pessoal, contato consigo mesmo e ficha que já é lápide, sem gravar registro", async () => {
    const a = await contato({ nome: "Carla" });
    const pessoal = await contato({ nome: "Mãe", pessoal: true });
    const antes = await pool.query("select count(*)::int as n from fusoes_de_contatos where organization_id = $1", [ORG]);

    expect(await recusa(juntar(a, pessoal))).toContain("fusao_de_contato_pessoal");
    expect(await recusa(juntar(pessoal, a))).toContain("fusao_de_contato_pessoal");
    expect(await recusa(juntar(a, a))).toContain("selecao_de_mesclagem_invalida");

    const b = await contato({ nome: "Carla 2" });
    await juntar(a, b);
    expect(await recusa(juntar(a, b))).toContain("contato_secundario_indisponivel");

    const depois = await pool.query("select count(*)::int as n from fusoes_de_contatos where organization_id = $1", [ORG]);
    expect(depois.rows[0].n).toBe(antes.rows[0].n + 1);
    expect((await ficha(pessoal)).is_merged_into).toBeNull();
  });
});

describe("⭐ desfazer", () => {
  it("a ficha absorvida volta a existir com as linhas dela, e a que ficou perde o que herdou", async () => {
    const fica = await contato({ nome: "Diana Prado", telefone: "+5531998130020" });
    const sai = await contato({ nome: "Diana P.", telefone: "+5531998130021", email: "diana@exemplo.test" });
    const c = await conversa(sai);
    const m = await mensagem(c, sai, "antes da junção");
    const n = await negocio(sai, "Negócio da Diana");
    const t = await tarefa(sai, "Retornar");
    const tarefaDeQuemFica = await tarefa(fica, "Dela mesma");

    const junto = await juntar(fica, sai);
    expect((await ficha(fica)).email).toBe("diana@exemplo.test");

    const r = await desfazer(junto.registro_id as string);
    expect(r.ja_desfeita).toBe(false);

    const absorvida = await ficha(sai);
    expect(absorvida.is_merged_into).toBeNull();
    expect(absorvida.merged_at).toBeNull();
    expect(absorvida.email).toBe("diana@exemplo.test");
    expect(absorvida.phone_number).toBe("+5531998130021");

    for (const [tabela, id] of [
      ["conversations", c],
      ["messages", m],
      ["crm_leads", n],
      ["crm_tasks", t],
    ] as const) {
      expect(await donoDe(tabela, id), tabela).toBe(sai);
    }
    expect(await donoDe("crm_tasks", tarefaDeQuemFica)).toBe(fica);

    const ficou = await ficha(fica);
    expect(ficou.email).toBeNull();
    expect(ficou.phone_number).toBe("+5531998130020");
    expect(ficou.source_metadata.mesclado_de).toBeUndefined();
    expect(ficou.source_metadata.nomes_absorvidos).toBeUndefined();
    // O número da absorvida deixa de ser telefone extra da que ficou.
    const extras = await pool.query("select 1 from contact_phones where contact_id = $1", [fica]);
    expect(extras.rowCount).toBe(0);

    expect(r.campos_devolvidos).toEqual(["email"]);
    expect((r.voltou as Record<string, number>)["conversations.contact_id"]).toBe(1);
    expect((r.voltou as Record<string, number>)["crm_leads.contact_id"]).toBe(1);
    expect((await registro(junto.registro_id as string)).desfeito_em).not.toBeNull();
  });

  it("repetir não desfaz de novo: devolve o resultado da primeira vez", async () => {
    const fica = await contato({ nome: "Elisa" });
    const sai = await contato({ nome: "Elisa 2", email: "elisa@exemplo.test" });
    const junto = await juntar(fica, sai);
    await desfazer(junto.registro_id as string);
    // Entre as duas chamadas, alguém põe um e-mail na ficha que ficou: a
    // repetição não pode apagá-lo.
    await pool.query("update contacts set email = 'novo@exemplo.test' where id = $1", [fica]);
    const repetido = await desfazer(junto.registro_id as string);
    expect(repetido.ja_desfeita).toBe(true);
    expect((await ficha(fica)).email).toBe("novo@exemplo.test");
  });

  it("a mensagem que chegou DEPOIS da junção, na conversa devolvida, acompanha a conversa", async () => {
    const fica = await contato({ nome: "Fábio" });
    const sai = await contato({ nome: "Fábio 2", telefone: "+5531998130030" });
    const c = await conversa(sai);
    const junto = await juntar(fica, sai);
    const depois = await mensagem(c, fica, "depois da junção");
    await desfazer(junto.registro_id as string);
    expect(await donoDe("messages", depois)).toBe(sai);
  });

  it("o que nasceu depois da junção na ficha que ficou continua nela", async () => {
    const fica = await contato({ nome: "Gabi" });
    const sai = await contato({ nome: "Gabi 2" });
    const junto = await juntar(fica, sai);
    const nova = await tarefa(fica, "Criada depois da junção");
    await desfazer(junto.registro_id as string);
    expect(await donoDe("crm_tasks", nova)).toBe(fica);
  });

  it("campo herdado que alguém alterou depois fica como está, e o resultado diz isso", async () => {
    const fica = await contato({ nome: "Hugo" });
    const sai = await contato({ nome: "Hugo 2", email: "hugo@exemplo.test" });
    const junto = await juntar(fica, sai);
    await pool.query("update contacts set email = 'hugo.novo@exemplo.test' where id = $1", [fica]);
    const r = await desfazer(junto.registro_id as string);
    expect(r.campos_devolvidos).toEqual([]);
    expect(r.campos_mantidos).toEqual(["email"]);
    expect((await ficha(fica)).email).toBe("hugo.novo@exemplo.test");
    expect((await ficha(sai)).is_merged_into).toBeNull();
  });

  it("as etiquetas NÃO voltam: a ficha que ficou continua com a união, e a absorvida com as dela", async () => {
    const fica = await contato({ nome: "Iara", tags: ["vip"] });
    const sai = await contato({ nome: "Iara 2", tags: ["indicacao"] });
    const junto = await juntar(fica, sai);
    await desfazer(junto.registro_id as string);
    expect((await ficha(fica)).tags.sort()).toEqual(["indicacao", "vip"]);
    expect((await ficha(sai)).tags).toEqual(["indicacao"]);
  });

  it("campo personalizado herdado sai da ficha que ficou; o que já era dela fica", async () => {
    const fica = await contato({ nome: "Júlia", campos: { cidade: "Belo Horizonte" } });
    const sai = await contato({ nome: "Júlia 2", campos: { cidade: "Contagem", profissao: "dentista" } });
    const junto = await juntar(fica, sai);
    expect((await ficha(fica)).custom_fields).toEqual({ cidade: "Belo Horizonte", profissao: "dentista" });
    await desfazer(junto.registro_id as string);
    expect((await ficha(fica)).custom_fields).toEqual({ cidade: "Belo Horizonte" });
    expect((await ficha(sai)).custom_fields).toEqual({ cidade: "Contagem", profissao: "dentista" });
  });

  it("quem já tinha sido absorvido pela ficha absorvida volta a apontar para ela", async () => {
    const fica = await contato({ nome: "Karen" });
    const meio = await contato({ nome: "Karen 2" });
    const antiga = await contato({ nome: "Karen 3" });
    await juntar(meio, antiga);
    const junto = await juntar(fica, meio);
    expect((await ficha(antiga)).is_merged_into).toBe(fica);
    await desfazer(junto.registro_id as string);
    expect((await ficha(antiga)).is_merged_into).toBe(meio);
    expect((await ficha(meio)).is_merged_into).toBeNull();
  });

  it("⭐ conflito de unicidade: recusa com rótulo próprio e NADA muda", async () => {
    const fica = await contato({ nome: "Lia" });
    const sai = await contato({ nome: "Lia 2", email: "lia@exemplo.test" });
    const t = await tarefa(sai, "Da Lia 2");
    const junto = await juntar(fica, sai);
    // A ficha que ficou troca de e-mail, e um terceiro contato passa a usar o
    // e-mail da absorvida: ela não pode mais voltar.
    await pool.query("update contacts set email = 'lia.outra@exemplo.test' where id = $1", [fica]);
    await contato({ nome: "Terceiro", email: "lia@exemplo.test" });

    expect(await recusa(desfazer(junto.registro_id as string))).toContain("conflito_ao_desfazer_fusao");
    expect((await ficha(sai)).is_merged_into).toBe(fica);
    expect(await donoDe("crm_tasks", t)).toBe(fica);
    expect((await registro(junto.registro_id as string)).desfeito_em).toBeNull();
  });

  it("ficha anonimizada depois da junção: não desfaz (anonimização não tem volta)", async () => {
    const fica = await contato({ nome: "Marta" });
    const sai = await contato({ nome: "Marta 2" });
    const junto = await juntar(fica, sai);
    await pool.query(
      "update contacts set is_anonymized = true, anonymized_at = now() where id = $1",
      [fica],
    );
    expect(await recusa(desfazer(junto.registro_id as string))).toContain("fusao_de_contato_anonimizado");
    expect((await ficha(sai)).is_merged_into).toBe(fica);
  });

  it("a ficha que ficou foi absorvida por outra depois: o registro acompanha, e cada junção se desfaz", async () => {
    const topo = await contato({ nome: "Nina" });
    const fica = await contato({ nome: "Nina 2" });
    const sai = await contato({ nome: "Nina 3" });
    const primeira = await juntar(fica, sai);
    const segunda = await juntar(topo, fica);

    // A segunda junção repontou o registro da primeira e a lápide de `sai` para
    // `topo`: o registro continua coerente, e desfazê-lo devolve `sai`.
    const reg = await registro(primeira.registro_id as string);
    expect(reg.contato_principal_id).toBe(topo);
    await desfazer(segunda.registro_id as string);
    expect((await registro(primeira.registro_id as string)).contato_principal_id).toBe(fica);
    expect((await ficha(sai)).is_merged_into).toBe(fica);
    await desfazer(primeira.registro_id as string);
    expect((await ficha(sai)).is_merged_into).toBeNull();
  });
});

describe("⭐ outra organização não alcança", () => {
  it("juntar com a organização errada não acha o contato, e nada muda", async () => {
    const fica = await contato({ nome: "Olga" });
    const sai = await contato({ nome: "Olga 2" });
    expect(await recusa(juntar(fica, sai, OUTRA_ORG))).toContain("contato_principal_indisponivel");
    expect((await ficha(sai)).is_merged_into).toBeNull();
  });

  it("contato de outra organização não é absorvido", async () => {
    const fica = await contato({ nome: "Paula" });
    const vizinho = await contato({ org: OUTRA_ORG, nome: "Paula" });
    expect(await recusa(juntar(fica, vizinho))).toContain("contato_secundario_indisponivel");
    expect((await ficha(vizinho)).is_merged_into).toBeNull();
  });

  it("desfazer com a organização errada não acha o registro, e a junção continua de pé", async () => {
    const fica = await contato({ nome: "Rita" });
    const sai = await contato({ nome: "Rita 2" });
    const junto = await juntar(fica, sai);
    expect(await recusa(desfazer(junto.registro_id as string, OUTRA_ORG))).toContain(
      "registro_de_fusao_nao_encontrado",
    );
    expect((await ficha(sai)).is_merged_into).toBe(fica);
  });
});

describe("a tabela e as funções são só do servidor", () => {
  const TABELA = "public.fusoes_de_contatos";

  it("RLS ligada e nenhuma policy", () => {
    expect(sql(`select relrowsecurity from pg_class where oid = '${TABELA}'::regclass`)).toBe("t");
    expect(
      sql(`select count(*) from pg_policies where schemaname = 'public' and tablename = 'fusoes_de_contatos'`),
    ).toBe("0");
  });

  it("anon e authenticated sem privilégio nenhum; service_role lê e grava", () => {
    expect(
      sql(
        `select bool_and(not has_table_privilege(r, '${TABELA}', p))
           from unnest(array['anon','authenticated']) r,
                unnest(array['select','insert','update','delete']) p`,
      ),
    ).toBe("t");
    expect(
      sql(
        `select bool_and(has_table_privilege('service_role', '${TABELA}', p))
           from unnest(array['select','insert','update']) p`,
      ),
    ).toBe("t");
  });

  it("membro com JWT da própria organização também é recusado", () => {
    expect(() =>
      countAs(GOV_AGENT_A, `select count(*) from ${TABELA} where organization_id = '${ORG}';`),
    ).toThrow();
  });

  it("as três funções: service_role executa; anon e authenticated, não", () => {
    for (const assinatura of [
      "public.fn_colunas_que_apontam_para_contato()",
      "public.fn_mesclar_contatos_com_registro(uuid, uuid, uuid, uuid)",
      "public.fn_desfazer_fusao_de_contatos(uuid, uuid, uuid)",
    ]) {
      expect(sql(`select has_function_privilege('service_role', '${assinatura}', 'execute')`), assinatura).toBe("t");
      expect(
        sql(
          `select bool_or(has_function_privilege(r, '${assinatura}', 'execute'))
             from unnest(array['anon','authenticated']) r`,
        ),
        assinatura,
      ).toBe("f");
    }
  });
});
