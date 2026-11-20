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
      try {
        const r = await pool.query(
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
}

/** Organização nova por caso, com um contato e uma conversa aberta (revisão 7). */
async function fixture(): Promise<Fixture> {
  const org = randomUUID();
  const contato = randomUUID();
  const sessao = randomUUID();
  const conversa = randomUUID();

  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
      values ($1, $2, 'Fechar por agente', 'Fechar por agente')`,
    [org, `fechar-agente-${org.slice(0, 8)}`],
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
  return { org, contato, conversa };
}

async function estado(f: Fixture) {
  const { rows } = await pool.query(
    `select status, service_revision::int as service_revision, service_closed_at
       from conversations where id = $1 and organization_id = $2`,
    [f.conversa, f.org],
  );
  return rows[0] as { status: string; service_revision: number; service_closed_at: Date | null };
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
