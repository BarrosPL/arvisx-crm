/**
 * FECHAR CONVERSA POR AGENTE — o que só o Postgres de verdade prova.
 *
 * `tests/unit/mcp-fechar-conversa.test.ts` roda `crm_close_conversation` contra
 * um banco em memória, com uma `fn_service_status` reescrita em TypeScript: lá
 * se prova o que o HANDLER faz. Três afirmações da ferramenta, porém, dependem
 * do que a função do `baseline.sql` faz, e o dublê só as repete:
 *
 *   1. fechar carimba UM atendimento: a revisão avança exatamente 1;
 *   2. fechar o que já está fechado NÃO ESCREVE — é disso que sai a
 *      idempotência (revisão e `service_closed_at` iguais depois do segundo
 *      pedido);
 *   3. a trava de revisão recusa (`PT409`) quando alguém mexeu no atendimento
 *      entre a leitura e o fechamento, e a ferramenta devolve `conversa_mudou`
 *      em vez de fechar por cima;
 *
 * e uma quarta é do conjunto: com o cliente de service role (sem RLS), o token
 * de OUTRA organização não fecha a conversa — quem segura é o filtro do
 * handler e o `p_org` da função.
 *
 * REGRA 2.31 NO BANCO (migration 9824, Tarefa 6.1). O agente não fecha conversa
 * que uma pessoa assumiu, e a conferência mora DENTRO da `fn_service_status`
 * (`p_ator = 'agente'`), com a linha travada. O bloco "conversa assumida por uma
 * pessoa" prova os seis casos do desenho (docs/arvisx/ci/REGRA-2.31-FECHAR-CONVERSA.md,
 * seção 4.3): a janela entre a leitura e o fechamento, as duas ordens da corrida
 * com duas conexões de verdade, a tela, a idempotência e a compatibilidade da
 * chamada posicional de 4 argumentos.
 *
 * O dublê aqui é só o TRANSPORTE (o client do Supabase vira SQL no pool do
 * harness, como em `fechar-devolve-sem-atendimento-fantasma.test.ts`). Nenhuma
 * regra é substituída.
 */
import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const auditoria = vi.hoisted(() => ({ audit: vi.fn(async (..._args: unknown[]) => undefined) }));
vi.mock("@/lib/audit", () => ({ audit: auditoria.audit }));

import { crmCloseConversation } from "@/lib/mcp/tools/fechar-conversa";
import type { McpContext } from "@/lib/mcp/types";

if (!process.env.TEST_DB_PORT) throw new Error("TEST_DB_PORT ausente — execute pnpm test:db");

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT}/postgres`,
  max: 4,
});
// O `pg` devolve `bigint` como STRING e o PostgREST como NÚMERO: a ferramenta
// manda a revisão lida de volta como trava, e precisa recebê-la como a produção.
pg.types.setTypeParser(20, (valor) => (valor === null ? null : Number(valor)));
afterAll(() => pool.end());

type Resposta = { data: unknown; error: { message: string; code?: string } | null };

function erroDoBanco(err: unknown): { message: string; code?: string } {
  const e = err as { message?: string; code?: string };
  return { message: e?.message ?? "erro no banco", ...(e?.code ? { code: e.code } : {}) };
}

/** Roda uma vez, logo antes da função do banco: quem mexeu no meio. */
let antesDaFuncao: (() => Promise<void>) | null = null;

/** Os argumentos de cada chamada à `fn_service_status` feita pela ferramenta. */
const chamadasDaFuncao: Array<Record<string, unknown>> = [];

/** O mínimo do client que a ferramenta usa: `select … eq … maybeSingle` e a RPC de estado. */
function clienteDoSgbd(): unknown {
  return {
    from: (tabela: string) => {
      let colunas = "*";
      const filtros: string[] = [];
      const params: unknown[] = [];
      const consulta = {
        select: (c: string) => {
          colunas = c;
          return consulta;
        },
        eq: (coluna: string, valor: unknown) => {
          params.push(valor);
          filtros.push(`${coluna} = $${params.length}`);
          return consulta;
        },
        maybeSingle: async (): Promise<Resposta> => {
          try {
            const r = await pool.query(
              `select ${colunas} from public.${tabela} where ${filtros.join(" and ")}`,
              params,
            );
            return { data: r.rows[0] ?? null, error: null };
          } catch (err) {
            return { data: null, error: erroDoBanco(err) };
          }
        },
      };
      return consulta;
    },
    rpc: async (nome: string, p: Record<string, unknown>): Promise<Resposta> => {
      if (nome !== "fn_service_status") {
        return { data: null, error: { message: `dublê: rpc não dublada ${nome}` } };
      }
      const mexer = antesDaFuncao;
      antesDaFuncao = null;
      await mexer?.();
      // O transporte repete o que o PostgREST faz com argumentos nomeados: só
      // viaja o que o código mandou. Sem `p_ator`, a chamada é a de 4 argumentos
      // (a da tela); com ele, a de 5.
      const comAtor = Object.prototype.hasOwnProperty.call(p, "p_ator");
      chamadasDaFuncao.push({ ...p });
      try {
        const r = comAtor
          ? await pool.query(
              "select * from public.fn_service_status($1::uuid, $2::uuid, $3::text, $4::bigint, $5::text)",
              [p.p_org, p.p_conversation, p.p_status, p.p_expected, p.p_ator],
            )
          : await pool.query(
              "select * from public.fn_service_status($1::uuid, $2::uuid, $3::text, $4::bigint)",
              [p.p_org, p.p_conversation, p.p_status, p.p_expected],
            );
        return { data: r.rows[0] ?? null, error: null };
      } catch (err) {
        return { data: null, error: erroDoBanco(err) };
      }
    },
  };
}

interface Fixture {
  org: string;
  contato: string;
  conversa: string;
  /** Uma pessoa da equipe (membro da organização), para assumir a conversa. */
  pessoa: string;
}

/** Organização nova por caso, com um contato e uma conversa aberta (revisão 7). */
async function fixture(): Promise<Fixture> {
  const org = randomUUID();
  const contato = randomUUID();
  const sessao = randomUUID();
  const conversa = randomUUID();
  const pessoa = randomUUID();

  await pool.query("insert into auth.users (id, email) values ($1, $2)", [
    pessoa,
    `fechar-agente-${pessoa.slice(0, 8)}@invariant.test`,
  ]);
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
      values ($1, $2, 'Fechar por agente', 'Fechar por agente')`,
    [org, `fechar-agente-${org.slice(0, 8)}`],
  );
  await pool.query(
    `insert into user_organizations (user_id, organization_id, role, accepted_at)
      values ($1, $2, 'agent', now())`,
    [pessoa, org],
  );
  await pool.query(
    `insert into contacts (id, organization_id, display_name, force_human, ai_opt_out)
      values ($1, $2, 'Cliente que sumiu', true, false)`,
    [contato, org],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ($1, $2, $3, '\\x00'::bytea)`,
    [sessao, org, `fechar-agente-${sessao.slice(0, 8)}`],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status)
      values ($1, $2, $3, $4, 'open')`,
    [conversa, org, contato, sessao],
  );
  await pool.query(
    "update conversations set service_revision = 7, service_closed_at = null where id = $1 and organization_id = $2",
    [conversa, org],
  );
  return { org, contato, conversa, pessoa };
}

async function estado(f: Fixture) {
  const { rows } = await pool.query(
    `select status, service_revision::int as service_revision, service_closed_at, assigned_to_user_id
       from conversations where id = $1 and organization_id = $2`,
    [f.conversa, f.org],
  );
  return rows[0] as {
    status: string;
    service_revision: number;
    service_closed_at: Date | null;
    assigned_to_user_id: string | null;
  };
}

function ctx(organizationId: string): McpContext {
  const token = randomUUID();
  return {
    organizationId,
    role: "agent",
    actor: { type: "api_token", id: token, role: "agent" },
    apiTokenId: token,
    requestId: "req-invariante",
    supabase: clienteDoSgbd() as never,
  };
}

const fechar = (conversa: string, organizationId: string) =>
  crmCloseConversation.handler({ conversation_id: conversa } as never, ctx(organizationId)) as Promise<
    Record<string, unknown>
  >;

beforeEach(() => {
  auditoria.audit.mockClear();
  antesDaFuncao = null;
  chamadasDaFuncao.length = 0;
});

describe("crm_close_conversation contra a fn_service_status do baseline", () => {
  it("fecha: um atendimento carimbado (revisão +1), sem mensagem nova e sem soltar a trava do contato", async () => {
    const f = await fixture();

    const r = await fechar(f.conversa, f.org);

    expect(r).toMatchObject({ status: "closed", already_closed: false });
    const depois = await estado(f);
    expect(depois.status).toBe("closed");
    expect(depois.service_revision).toBe(8);
    expect(depois.service_closed_at).not.toBeNull();

    const mensagens = await pool.query(
      "select count(*)::int as n from messages where organization_id = $1 and conversation_id = $2",
      [f.org, f.conversa],
    );
    expect(mensagens.rows[0].n).toBe(0);
    const contato = await pool.query("select force_human from contacts where id = $1", [f.contato]);
    expect(contato.rows[0].force_human).toBe(true);
    expect(auditoria.audit).toHaveBeenCalledTimes(1);
  });

  it("⭐ repetir não escreve: revisão e `service_closed_at` iguais, e nenhuma auditoria nova", async () => {
    const f = await fixture();
    await fechar(f.conversa, f.org);
    const fechada = await estado(f);
    auditoria.audit.mockClear();

    const r = await fechar(f.conversa, f.org);

    expect(r).toMatchObject({ status: "closed", already_closed: true });
    const depois = await estado(f);
    expect(depois.service_revision).toBe(fechada.service_revision);
    expect(depois.service_closed_at?.toISOString()).toBe(fechada.service_closed_at?.toISOString());
    expect(auditoria.audit).not.toHaveBeenCalled();
  });

  it("a própria função não escreve ao fechar o que já está fechado (de onde sai a idempotência)", async () => {
    const f = await fixture();
    await fechar(f.conversa, f.org);
    const fechada = await estado(f);

    await pool.query("select * from public.fn_service_status($1::uuid, $2::uuid, 'closed', $3::bigint)", [
      f.org,
      f.conversa,
      fechada.service_revision,
    ]);

    const depois = await estado(f);
    expect(depois.service_revision).toBe(fechada.service_revision);
    expect(depois.service_closed_at?.toISOString()).toBe(fechada.service_closed_at?.toISOString());
  });

  it("⭐ token de OUTRA organização não fecha: recusa, e a conversa segue como estava", async () => {
    const f = await fixture();
    const outra = await fixture();

    const r = await fechar(f.conversa, outra.org);

    expect(r).toMatchObject({ permitido: false, motivo: "conversa_nao_encontrada" });
    expect(await estado(f)).toMatchObject({ status: "open", service_revision: 7 });
    expect(auditoria.audit).not.toHaveBeenCalled();
  });

  it("a função recusa a organização errada mesmo chamada direto (`service_not_found`)", async () => {
    const f = await fixture();
    const outra = await fixture();

    await expect(
      pool.query("select * from public.fn_service_status($1::uuid, $2::uuid, 'closed', null)", [
        outra.org,
        f.conversa,
      ]),
    ).rejects.toMatchObject({ code: "P0002" });
    expect((await estado(f)).status).toBe("open");
  });

  it("alguém mexeu no atendimento no meio: a trava recusa (PT409) e a ferramenta não fecha por cima", async () => {
    const f = await fixture();
    antesDaFuncao = async () => {
      await pool.query(
        "update conversations set service_revision = service_revision + 1 where id = $1 and organization_id = $2",
        [f.conversa, f.org],
      );
    };

    const r = await fechar(f.conversa, f.org);

    expect(r).toMatchObject({ permitido: false, motivo: "conversa_mudou" });
    expect(await estado(f)).toMatchObject({ status: "open", service_revision: 8 });
    expect(auditoria.audit).not.toHaveBeenCalled();
  });
});

/** Uma pessoa assume a conversa, pela mesma função que a tela chama. */
const ASSUMIR =
  "select count(*)::int as n from public.fn_conversation_assign($1::uuid, $2::uuid, $3::uuid, 'claim', null, false)";

async function assumir(f: Fixture, quem: Pick<pg.Pool, "query"> = pool): Promise<void> {
  const r = await quem.query(ASSUMIR, [f.org, f.conversa, f.pessoa]);
  expect(r.rows[0].n).toBe(1);
}

const FECHAR_COMO =
  "select * from public.fn_service_status($1::uuid, $2::uuid, $3::text, $4::bigint, $5::text)";

/** Espera a conexão `pid` parar num lock (é a prova de que as duas funções se serializam). */
async function esperarBloqueio(pid: number): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const { rows } = await pool.query(
      "select wait_event_type from pg_stat_activity where pid = $1 and state = 'active'",
      [pid],
    );
    if (rows[0]?.wait_event_type === "Lock") return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`a conexão ${pid} não ficou esperando lock em 5 s: as funções não se serializaram`);
}

async function pidDe(conexao: pg.PoolClient): Promise<number> {
  const { rows } = await conexao.query("select pg_backend_pid() as pid");
  return rows[0].pid as number;
}

describe("⭐ conversa assumida por uma pessoa: a regra 2.31 dentro da fn_service_status (migration 9824)", () => {
  it("caso 1, a janela: a pessoa assume ENTRE a leitura da ferramenta e a função, e o agente não fecha", async () => {
    const f = await fixture();
    antesDaFuncao = () => assumir(f);

    const r = await fechar(f.conversa, f.org);

    expect(r).toMatchObject({ permitido: false, motivo: "conversa_com_humano" });
    // A ferramenta leu a conversa SEM responsável (senão teria recusado na
    // leitura, sem chegar ao banco): quem recusou foi a função.
    expect(chamadasDaFuncao).toHaveLength(1);
    expect(chamadasDaFuncao[0]).toMatchObject({ p_status: "closed", p_expected: 7, p_ator: "agente" });
    expect(await estado(f)).toMatchObject({
      status: "claimed",
      service_revision: 7,
      service_closed_at: null,
      assigned_to_user_id: f.pessoa,
    });
    expect(auditoria.audit).not.toHaveBeenCalled();
  });

  it("caso 2, corrida em que ASSUMIR ganha: o fechamento do agente espera o lock e sai com PT403", async () => {
    const f = await fixture();
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("begin");
      await assumir(f, a); // sem commit: a linha está travada pela pessoa

      const pidB = await pidDe(b);
      const fechamento = b.query(FECHAR_COMO, [f.org, f.conversa, "closed", 7, "agente"]).then(
        (r) => ({ ok: true as const, linha: r.rows[0] }),
        (err: { code?: string; message?: string }) => ({ ok: false as const, code: err.code, message: err.message }),
      );
      await esperarBloqueio(pidB);
      await a.query("commit");

      const desfecho = await fechamento;
      expect(desfecho).toMatchObject({ ok: false, code: "PT403", message: "service_assigned_to_human" });
    } finally {
      await a.query("rollback").catch(() => undefined);
      a.release();
      b.release();
    }
    expect(await estado(f)).toMatchObject({
      status: "claimed",
      service_revision: 7,
      service_closed_at: null,
      assigned_to_user_id: f.pessoa,
    });
  });

  it("caso 3, corrida em que FECHAR ganha: o fechamento vale, sem responsável, e o assumir espera", async () => {
    const f = await fixture();
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await b.query("begin");
      const fechada = await b.query(FECHAR_COMO, [f.org, f.conversa, "closed", 7, "agente"]);
      // O agente fechou uma conversa que NÃO tinha responsável: um atendimento
      // carimbado, uma vez.
      expect(fechada.rows[0]).toMatchObject({ status: "closed", assigned_to_user_id: null, service_revision: 8 });

      const pidA = await pidDe(a);
      const assumindo = a.query(ASSUMIR, [f.org, f.conversa, f.pessoa]);
      await esperarBloqueio(pidA);
      await b.query("commit");
      await assumindo;
    } finally {
      await b.query("rollback").catch(() => undefined);
      a.release();
      b.release();
    }
    // Assumir uma conversa encerrada é o gesto de sempre da tela (reabre como
    // `claimed`, e a reabertura carimba outro atendimento): a pessoa fica com
    // ela, e o fechamento do agente NÃO foi por cima de responsável nenhum.
    expect(await estado(f)).toMatchObject({ status: "claimed", service_revision: 9, assigned_to_user_id: f.pessoa });
  });

  it.each([["closed"], ["resolved"], ["archived"]] as const)(
    "o agente não leva a conversa assumida a %s (os três estados terminais, não só `closed`)",
    async (status) => {
      const f = await fixture();
      await assumir(f);

      await expect(pool.query(FECHAR_COMO, [f.org, f.conversa, status, 7, "agente"])).rejects.toMatchObject({
        code: "PT403",
        message: "service_assigned_to_human",
      });
      expect(await estado(f)).toMatchObject({ status: "claimed", service_revision: 7, assigned_to_user_id: f.pessoa });
    },
  );

  it("o agente recebe 'está com uma pessoa' mesmo com a revisão obsoleta (a regra vem antes da trava)", async () => {
    const f = await fixture();
    await assumir(f);

    await expect(pool.query(FECHAR_COMO, [f.org, f.conversa, "closed", 3, "agente"])).rejects.toMatchObject({
      code: "PT403",
    });
  });

  it("caso 4, a tela: a MESMA conversa assumida fecha sem `p_ator` e com `p_ator = 'pessoa'`", async () => {
    const semAtor = await fixture();
    await assumir(semAtor);
    await pool.query("select * from public.fn_service_status($1::uuid, $2::uuid, 'closed', $3::bigint)", [
      semAtor.org,
      semAtor.conversa,
      7,
    ]);
    expect(await estado(semAtor)).toMatchObject({ status: "closed", service_revision: 8 });

    const comPessoa = await fixture();
    await assumir(comPessoa);
    await pool.query(FECHAR_COMO, [comPessoa.org, comPessoa.conversa, "closed", 7, "pessoa"]);
    expect(await estado(comPessoa)).toMatchObject({ status: "closed", service_revision: 8 });
  });

  it("controle: sem ninguém assumindo, `p_ator = 'agente'` fecha", async () => {
    const f = await fixture();

    await pool.query(FECHAR_COMO, [f.org, f.conversa, "closed", 7, "agente"]);

    expect(await estado(f)).toMatchObject({ status: "closed", service_revision: 8, assigned_to_user_id: null });
  });

  it("caso 5, idempotência: conversa JÁ fechada com responsável devolve a linha ao agente, sem erro e sem escrever", async () => {
    const f = await fixture();
    await assumir(f);
    await pool.query(FECHAR_COMO, [f.org, f.conversa, "closed", 7, "pessoa"]);
    const fechada = await estado(f);
    expect(fechada).toMatchObject({ status: "closed", assigned_to_user_id: f.pessoa });

    const r = await pool.query(FECHAR_COMO, [f.org, f.conversa, "closed", fechada.service_revision, "agente"]);

    expect(r.rows[0]).toMatchObject({ status: "closed" });
    const depois = await estado(f);
    expect(depois.service_revision).toBe(fechada.service_revision);
    expect(depois.service_closed_at?.toISOString()).toBe(fechada.service_closed_at?.toISOString());
  });

  it("caso 6, compatibilidade: a chamada posicional de 4 argumentos funciona e existe UMA função só", async () => {
    const f = await fixture();

    const r = await pool.query("select * from public.fn_service_status($1, $2, 'closed', 7)", [f.org, f.conversa]);
    expect(r.rows[0]).toMatchObject({ status: "closed" });

    const funcoes = await pool.query(
      `select pg_get_function_identity_arguments(p.oid) as argumentos
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'fn_service_status'`,
    );
    expect(funcoes.rows).toEqual([
      { argumentos: "p_org uuid, p_conversation uuid, p_status text, p_expected bigint, p_ator text" },
    ]);
  });

  it("ator desconhecido é recusado (`invalid_actor`), e nulo também", async () => {
    const f = await fixture();

    await expect(pool.query(FECHAR_COMO, [f.org, f.conversa, "closed", 7, "robo"])).rejects.toMatchObject({
      code: "22023",
      message: "invalid_actor",
    });
    await expect(pool.query(FECHAR_COMO, [f.org, f.conversa, "closed", 7, null])).rejects.toMatchObject({
      code: "22023",
      message: "invalid_actor",
    });
    expect((await estado(f)).status).toBe("open");
  });

  it("só `service_role` executa a função de 5 argumentos", async () => {
    const { rows } = await pool.query(
      `select r.rolname, has_function_privilege(r.rolname,
                'public.fn_service_status(uuid,uuid,text,bigint,text)', 'execute') as pode
         from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role') order by 1`,
    );
    expect(rows).toEqual([
      { rolname: "anon", pode: false },
      { rolname: "authenticated", pode: false },
      { rolname: "service_role", pode: true },
    ]);
  });
});
