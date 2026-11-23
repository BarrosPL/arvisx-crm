import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";
import {
  comoAnon, comoServidor, comoUsuario, criarOrg, criarUsuarios, erroDe, insercaoDeCanal, uuid, valor, vincular,
} from "./cobranca-helpers";

/**
 * OS COMENTÁRIOS DO INSTAGRAM (ArvisX, migrations 9810 e 9819).
 *
 * `social_comments` guarda o que gente de fora escreveu numa publicação: o
 * texto e o nome de usuário de quem comentou. Desde a 9819 a leitura pela
 * sessão é de GERENTE PARA CIMA (o mesmo papel das rotas e das ferramentas),
 * então a tabela não cabe em `rls-isolation.test.ts`, cujo usuário semeado é
 * `agent`: a prova de isolamento é este arquivo
 * (`PROVA_PROPRIA` em `rls-completude-varredura.test.ts`). O que se mede:
 *
 *   0. o PAPEL: gerente e admin leem; agent e viewer leem zero, na própria
 *      organização (revisão de 20/11, item 2.19);
 *   1. VAZAMENTO nos dois sentidos, com o MESMO id de comentário nas duas
 *      organizações — a chave única é por organização, e é o caso em que um
 *      filtro errado devolveria a linha do vizinho sem ninguém perceber;
 *   2. a sessão NÃO escreve: nem insert, nem update, nem delete. Quem grava é
 *      o servidor (webhook e API de resposta), com a organização tirada do
 *      canal — um membro que inserisse pelo banco forjaria comentário, e o
 *      agente de fora responderia em público a algo que ninguém escreveu;
 *   3. `anon` não lê;
 *   4. IDEMPOTÊNCIA no banco: o segundo INSERT do mesmo comentário na mesma
 *      organização estoura `23505` — é o que o servidor traduz em
 *      `comentario_repetido`;
 *   5. o CHECK do estado e os padrões com que a linha nasce.
 */
const P = "e9019810-0000-4000-8000";
const ORG_A = uuid(P, 1);
const ORG_B = uuid(P, 2);
const GERENTE_A = uuid(P, 11);
const AGENTE_A = uuid(P, 12);
const GERENTE_B = uuid(P, 13);
const ADMIN_A = uuid(P, 14);
const LEITOR_A = uuid(P, 15);
const CANAL_A = uuid(P, 21);
const CANAL_B = uuid(P, 22);

const T = "public.social_comments";
/** O MESMO id de comentário nas duas organizações, de propósito. */
const COMENTARIO = "17865799348089039";

const insercao = (org: string, canal: string, comentario: string, texto: string) =>
  `insert into ${T} (organization_id, channel_session_id, comment_id, author_id, author_username, text, commented_at)
     values ('${org}', '${canal}', '${comentario}', '232323232', 'cliente.exemplo', '${texto}', now())`;

const textoEm = (org: string) =>
  valor(`select text from ${T} where organization_id = '${org}' and comment_id = '${COMENTARIO}';`);

beforeAll(() => {
  criarUsuarios([
    [GERENTE_A, "gerente-a-9810@invariant.test"],
    [AGENTE_A, "agente-a-9810@invariant.test"],
    [GERENTE_B, "gerente-b-9810@invariant.test"],
    [ADMIN_A, "admin-a-9810@invariant.test"],
    [LEITOR_A, "leitor-a-9810@invariant.test"],
  ]);
  criarOrg(ORG_A, "comentarios-a");
  criarOrg(ORG_B, "comentarios-b");
  vincular(GERENTE_A, ORG_A, "manager");
  vincular(AGENTE_A, ORG_A, "agent");
  vincular(GERENTE_B, ORG_B, "manager");
  vincular(ADMIN_A, ORG_A, "admin");
  vincular(LEITOR_A, ORG_A, "viewer");
  sql(`${insercaoDeCanal(CANAL_A, ORG_A)} on conflict (id) do nothing;
       ${insercaoDeCanal(CANAL_B, ORG_B)} on conflict (id) do nothing;`);
  sql(`delete from ${T} where organization_id in ('${ORG_A}', '${ORG_B}');`);
  sql(comoServidor(insercao(ORG_A, CANAL_A, COMENTARIO, "comentario da empresa A")));
  sql(comoServidor(insercao(ORG_B, CANAL_B, COMENTARIO, "comentario da empresa B")));
});

describe("9810 — leitura dos comentários", () => {
  it("⭐ gerente e admin leem os comentários da própria organização e zero da outra", () => {
    for (const quem of [GERENTE_A, ADMIN_A]) {
      expect(countAs(quem, `select count(*) from ${T} where organization_id = '${ORG_A}';`)).toBe(1);
      expect(countAs(quem, `select count(*) from ${T} where organization_id = '${ORG_B}';`)).toBe(0);
    }
    expect(countAs(GERENTE_B, `select count(*) from ${T} where organization_id = '${ORG_B}';`)).toBe(1);
    expect(countAs(GERENTE_B, `select count(*) from ${T} where organization_id = '${ORG_A}';`)).toBe(0);
  });

  it("⭐ 9819 — agent e viewer NÃO leem comentário nenhum, nem da própria organização", () => {
    // As rotas e as ferramentas exigem gerente; a sessão não pode ler pelo
    // banco o que a aplicação recusa. O controle de que a linha existe é o
    // caso acima (o gerente da mesma organização a lê).
    for (const quem of [AGENTE_A, LEITOR_A]) {
      expect(countAs(quem, `select count(*) from ${T} where organization_id = '${ORG_A}';`)).toBe(0);
      expect(countAs(quem, `select count(*) from ${T};`)).toBe(0);
    }
  });

  it("9819 — a política de leitura cita o papel mínimo", () => {
    expect(
      valor(`select count(*)::text from pg_policies
              where schemaname = 'public' and tablename = 'social_comments'
                and policyname = 'tenant_isolation_social_comments_select'
                and cmd = 'SELECT' and qual like '%fn_role_at_least%manager%';`),
    ).toBe("1");
  });

  it("⭐ procurar pelo id do comentário SEM filtrar a organização não devolve a linha do vizinho", () => {
    // É o vazamento que a chave por organização tornaria possível: o mesmo
    // `comment_id` existe nas duas. A RLS é quem separa.
    expect(countAs(GERENTE_A, `select count(*) from ${T} where comment_id = '${COMENTARIO}';`)).toBe(1);
    expect(countAs(GERENTE_B, `select count(*) from ${T} where comment_id = '${COMENTARIO}';`)).toBe(1);
    expect(countAs(GERENTE_A, `select count(*) from ${T} where text = 'comentario da empresa B';`)).toBe(0);
  });

  it("anon não lê", () => {
    expect(erroDe(comoAnon(`select count(*) from ${T}`))).toContain(
      "permission denied for table social_comments",
    );
  });
});

describe("9810 — só o servidor escreve", () => {
  it("⭐ a sessão não insere comentário, nem na própria organização", () => {
    expect(
      erroDe(comoUsuario(GERENTE_A, insercao(ORG_A, CANAL_A, "17865799348089999", "forjado pela sessão"))),
    ).toContain("permission denied for table social_comments");
    expect(valor(`select count(*) from ${T} where comment_id = '17865799348089999';`)).toBe("0");
  });

  it("⭐ a sessão não altera nem apaga: o texto e o estado ficam como o servidor gravou", () => {
    expect(
      erroDe(comoUsuario(GERENTE_A, `update ${T} set text = 'reescrito', estado = 'respondido' where organization_id = '${ORG_A}'`)),
    ).toContain("permission denied for table social_comments");
    expect(
      erroDe(comoUsuario(GERENTE_A, `delete from ${T} where organization_id = '${ORG_A}'`)),
    ).toContain("permission denied for table social_comments");
    expect(textoEm(ORG_A)).toBe("comentario da empresa A");
    expect(textoEm(ORG_B)).toBe("comentario da empresa B");
  });

  it("o servidor grava e atualiza (é ele quem recebe o webhook e registra a resposta)", () => {
    sql(comoServidor(`update ${T} set estado = 'sem_acao' where organization_id = '${ORG_B}' and comment_id = '${COMENTARIO}'`));
    expect(valor(`select estado from ${T} where organization_id = '${ORG_B}' and comment_id = '${COMENTARIO}';`)).toBe("sem_acao");
    sql(comoServidor(`update ${T} set estado = 'novo' where organization_id = '${ORG_B}' and comment_id = '${COMENTARIO}'`));
  });
});

describe("9810 — forma da tabela", () => {
  it("⭐ o mesmo comentário duas vezes na MESMA organização é recusado pela chave única (23505)", () => {
    const erro = erroDe(comoServidor(insercao(ORG_A, CANAL_A, COMENTARIO, "a segunda entrega")));
    expect(erro).toContain("23505");
    expect(erro).toContain("social_comments_org_comment_unique");
    expect(valor(`select count(*) from ${T} where organization_id = '${ORG_A}' and comment_id = '${COMENTARIO}';`)).toBe("1");
    expect(textoEm(ORG_A)).toBe("comentario da empresa A");
  });

  it("o mesmo id em organizações diferentes convive (a chave é por organização)", () => {
    expect(valor(`select count(*) from ${T} where comment_id = '${COMENTARIO}';`)).toBe("2");
  });

  it("o estado só aceita o vocabulário", () => {
    expect(
      erroDe(comoServidor(`update ${T} set estado = 'arquivado' where organization_id = '${ORG_A}'`)),
    ).toContain("violates check constraint");
  });

  it("nasce `novo`, sem resposta, fora de transmissão ao vivo, e updated_at anda sozinho", () => {
    expect(
      valor(`select estado || ',' || (public_reply is null)::text || ',' || (private_reply is null)::text || ',' || ao_vivo::text
               from ${T} where organization_id = '${ORG_A}' and comment_id = '${COMENTARIO}';`),
    ).toBe("novo,true,true,false");
    sql(`update ${T} set updated_at = now() - interval '1 day' where organization_id = '${ORG_A}';`);
    sql(`update ${T} set estado = 'novo' where organization_id = '${ORG_A}';`);
    expect(
      valor(`select (updated_at > now() - interval '1 minute')::text from ${T} where organization_id = '${ORG_A}' and comment_id = '${COMENTARIO}';`),
    ).toBe("true");
  });

  it("o texto não tem teto no banco: um comentário longo entra inteiro", () => {
    const longo = "a".repeat(2200);
    sql(comoServidor(insercao(ORG_A, CANAL_A, "17865799348089100", longo)));
    expect(valor(`select length(text)::text from ${T} where comment_id = '17865799348089100';`)).toBe("2200");
    sql(`delete from ${T} where comment_id = '17865799348089100';`);
  });

  it("o canal com comentário não é apagado: a chave estrangeira é restrict, como em conversas e mensagens", () => {
    expect(erroDe(`delete from public.channel_sessions where id = '${CANAL_A}';`)).toContain(
      "social_comments_channel_session_id_fkey",
    );
    expect(valor(`select count(*) from public.channel_sessions where id = '${CANAL_A}';`)).toBe("1");
  });

  it("os índices da fila e da poda existem", () => {
    const indices = valor(
      `select string_agg(indexname, ',' order by indexname) from pg_indexes
        where schemaname = 'public' and tablename = 'social_comments';`,
    );
    expect(indices).toContain("social_comments_org_estado_quando_idx");
    expect(indices).toContain("social_comments_poda_idx");
    expect(indices).toContain("social_comments_org_comment_unique");
  });
});
