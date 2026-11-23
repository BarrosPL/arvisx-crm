import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";
import {
  comoUsuario, criarOrg, criarUsuarios, erroDe, insercaoDeCanal, uuid, valor, vincular,
} from "./cobranca-helpers";

/**
 * OS COMENTÁRIOS DO INSTAGRAM PASSAM A SER RESPONDIDOS (ArvisX, migrations 9812 e 9816).
 *
 * A 9812 liga o comentário ao contato (`contact_id`) e guarda o motivo do
 * ignorar e a ocultação. A ligação põe a tabela no alcance da LGPD, e é isso
 * que este arquivo mede — pelo COMPORTAMENTO do banco, não pelo nome do gatilho:
 *
 *   1. anonimizar o contato redige os comentários ligados a ele: texto, autor,
 *      motivo e o texto das duas respostas;
 *   2. redige também os outros comentários do MESMO autor naquela organização,
 *      ainda que só um tenha virado contato — é a mesma pessoa;
 *   3. NÃO toca no comentário de outro autor, nem no do mesmo `author_id` em
 *      OUTRA organização (o controle que impede o verde por "apaga tudo");
 *   4. a linha fica: publicação, hora e estado são registro de operação;
 *   5. apagar o contato não apaga o comentário (`on delete set null`);
 *   6. as colunas novas continuam fechadas para a sessão: membro não escreve;
 *   7. (9816) quem já era contato por MENSAGEM DIRETA e comentou sem nunca ser
 *      ligado por `contact_id` também é alcançado, pela identidade social
 *      `instagram:<conta>:<author_id>`; o mesmo autor em OUTRA conta e a mesma
 *      identidade em OUTRA organização ficam intactos; `hidden` fica só com os
 *      campos conhecidos.
 */
const P = "e9019812-0000-4000-8000";
const ORG_A = uuid(P, 1);
const ORG_B = uuid(P, 2);
const GERENTE_A = uuid(P, 11);
const CANAL_A = uuid(P, 21);
const CANAL_B = uuid(P, 22);
const CONTATO = uuid(P, 31);
const CONTATO_APAGAVEL = uuid(P, 32);

// 9816: a pessoa que só existe como contato de mensagem direta.
const CONTATO_DE_DM = uuid(P, 33);
const CONTATO_DE_DM_NA_B = uuid(P, 34);
const CONTATO_UNIDO = uuid(P, 35);
const CANAL_IG_A = uuid(P, 23);
const CANAL_IG_A2 = uuid(P, 24);
const CANAL_IG_B = uuid(P, 25);
const CONTA_IG_A = "17849816000000001";
const CONTA_IG_A2 = "17849816000000002";
const CONTA_IG_B = "17849816000000003";
const AUTOR_DE_DM = "909098160";
const AUTOR_UNIDO = "909098161";

const canalDoInstagram = (id: string, org: string, conta: string) =>
  `insert into public.channel_sessions (id, organization_id, provider, meta_social_account_id, webhook_secret_encrypted, metadata)
     values ('${id}', '${org}', 'meta_social', '${conta}', '\\x00'::bytea, '{"social_platform":"instagram"}'::jsonb)
     on conflict (id) do nothing;`;

const T = "public.social_comments";
const AUTOR = "909090901";
const OUTRO_AUTOR = "909090902";

const resposta = (texto: string) =>
  `'{"id":"1","texto":"${texto}","quando":"2026-11-20T12:00:00.000Z","quem":{"tipo":"api_token","id":"t"},"simulada":false,"situacao":"concluida"}'::jsonb`;

function comentario(org: string, canal: string, id: string, autor: string, extra: Record<string, string> = {}): string {
  const colunas = ["organization_id", "channel_session_id", "comment_id", "author_id", "author_username", "text", "media_id", "commented_at", ...Object.keys(extra)];
  const valores = [`'${org}'`, `'${canal}'`, `'${id}'`, `'${autor}'`, `'usuario.${autor}'`, `'texto de ${id}'`, `'midia-1'`, "now()", ...Object.values(extra)];
  return `insert into ${T} (${colunas.join(", ")}) values (${valores.join(", ")});`;
}

const campo = (org: string, id: string, expressao: string) =>
  valor(`select ${expressao} from ${T} where organization_id = '${org}' and comment_id = '${id}';`);

beforeAll(() => {
  criarUsuarios([[GERENTE_A, "gerente-a-9812@invariant.test"]]);
  criarOrg(ORG_A, "comentarios-resposta-a");
  criarOrg(ORG_B, "comentarios-resposta-b");
  vincular(GERENTE_A, ORG_A, "manager");
  sql(`${insercaoDeCanal(CANAL_A, ORG_A)} on conflict (id) do nothing;
       ${insercaoDeCanal(CANAL_B, ORG_B)} on conflict (id) do nothing;`);
  sql(`delete from ${T} where organization_id in ('${ORG_A}', '${ORG_B}');
       delete from public.contacts where id in ('${CONTATO}', '${CONTATO_APAGAVEL}');`);
  sql(`
    insert into public.contacts (id, organization_id, name) values
      ('${CONTATO}', '${ORG_A}', 'Pessoa do comentário'),
      ('${CONTATO_APAGAVEL}', '${ORG_A}', 'Pessoa apagável');
    ${comentario(ORG_A, CANAL_A, "c-ligado", AUTOR, {
      contact_id: `'${CONTATO}'`,
      ignore_reason: `'falou do preço'`,
      public_reply: resposta("Olá, Maria!"),
      private_reply: resposta("Maria, segue o contato"),
    })}
    ${comentario(ORG_A, CANAL_A, "c-mesmo-autor", AUTOR)}
    ${comentario(ORG_A, CANAL_A, "c-outro-autor", OUTRO_AUTOR)}
    ${comentario(ORG_B, CANAL_B, "c-outra-org", AUTOR)}
    ${comentario(ORG_A, CANAL_A, "c-do-apagavel", "909090903", { contact_id: `'${CONTATO_APAGAVEL}'` })}
  `);
});

describe("9812 — a sessão não escreve nas colunas novas", () => {
  it("membro não liga contato, não grava motivo e não oculta pelo banco", () => {
    for (const set of [
      `contact_id = '${CONTATO}'`,
      `ignore_reason = 'forjado'`,
      `hidden = '{"simulada":false}'::jsonb`,
    ]) {
      const erro = erroDe(comoUsuario(GERENTE_A, `update ${T} set ${set} where organization_id = '${ORG_A}' and comment_id = 'c-outro-autor';`));
      // Sem grant de UPDATE: o banco recusa em vez de casar zero linhas.
      expect(erro).toContain("permission denied for table social_comments");
    }
    expect(campo(ORG_A, "c-outro-autor", "coalesce(ignore_reason, '∅')")).toBe("∅");
  });

  it("o membro LÊ as colunas novas do próprio comentário", () => {
    expect(countAs(GERENTE_A, `select count(*) from ${T} where organization_id = '${ORG_A}' and contact_id = '${CONTATO}';`)).toBe(1);
  });
});

describe("9812 — anonimizar o contato redige os comentários da pessoa", () => {
  beforeAll(() => {
    // A FUNÇÃO REAL da cascata, não um `update is_anonymized` à mão: é o
    // caminho por onde a anonimização passa, e o gatilho dispara dentro dela.
    sql(`select public.fn_lgpd_cascade_redact_contact('${ORG_A}', '${CONTATO}', gen_random_uuid());`);
  });

  it("⭐ o comentário ligado ao contato perde texto, autor e motivo", () => {
    expect(campo(ORG_A, "c-ligado", "text")).toBe("(anonimizado)");
    expect(campo(ORG_A, "c-ligado", "coalesce(author_id, '∅')")).toBe("∅");
    expect(campo(ORG_A, "c-ligado", "coalesce(author_username, '∅')")).toBe("∅");
    expect(campo(ORG_A, "c-ligado", "coalesce(ignore_reason, '∅')")).toBe("∅");
  });

  it("⭐ o texto das duas respostas é redigido, e o resto da resposta fica", () => {
    expect(campo(ORG_A, "c-ligado", "public_reply->>'texto'")).toBe("(anonimizado)");
    expect(campo(ORG_A, "c-ligado", "private_reply->>'texto'")).toBe("(anonimizado)");
    expect(campo(ORG_A, "c-ligado", "public_reply->>'situacao'")).toBe("concluida");
    expect(campo(ORG_A, "c-ligado", "public_reply->>'quando'")).toBe("2026-11-20T12:00:00.000Z");
  });

  it("⭐ o outro comentário do MESMO autor também é redigido, sem estar ligado ao contato", () => {
    expect(campo(ORG_A, "c-mesmo-autor", "text")).toBe("(anonimizado)");
    expect(campo(ORG_A, "c-mesmo-autor", "coalesce(author_username, '∅')")).toBe("∅");
  });

  it("CONTROLE: o comentário de OUTRO autor fica intacto", () => {
    expect(campo(ORG_A, "c-outro-autor", "text")).toBe("texto de c-outro-autor");
    expect(campo(ORG_A, "c-outro-autor", "author_id")).toBe(OUTRO_AUTOR);
  });

  it("CONTROLE: o mesmo `author_id` em OUTRA organização fica intacto", () => {
    expect(campo(ORG_B, "c-outra-org", "text")).toBe("texto de c-outra-org");
    expect(campo(ORG_B, "c-outra-org", "author_id")).toBe(AUTOR);
  });

  it("ANTES não é medido aqui de propósito: os dois controles acima são a prova de que havia texto", () => {
    // O seed grava `texto de <id>` em toda linha; as duas que ficaram intactas
    // mostram que o seed entrou e que a redação escolheu linha.
    expect(campo(ORG_A, "c-outro-autor", "author_username")).toBe(`usuario.${OUTRO_AUTOR}`);
  });

  it("a linha fica: publicação e estado são registro de operação", () => {
    expect(campo(ORG_A, "c-ligado", "media_id")).toBe("midia-1");
    expect(campo(ORG_A, "c-ligado", "estado")).toBe("novo");
    expect(campo(ORG_A, "c-ligado", "contact_id::text")).toBe(CONTATO);
  });
});

describe("9816 — a anonimização alcança quem já era contato por mensagem direta", () => {
  const ocultacao = `'{"quando":"2026-11-20T13:00:00.000Z","quem":{"tipo":"user","id":"u-1"},"simulada":false,"observacao":"falou com a Maria"}'::jsonb`;

  beforeAll(() => {
    sql(`delete from ${T} where organization_id in ('${ORG_A}', '${ORG_B}') and comment_id like 'i-%';
         delete from public.contacts where id in ('${CONTATO_DE_DM}', '${CONTATO_DE_DM_NA_B}', '${CONTATO_UNIDO}');`);
    sql(`${canalDoInstagram(CANAL_IG_A, ORG_A, CONTA_IG_A)}
         ${canalDoInstagram(CANAL_IG_A2, ORG_A, CONTA_IG_A2)}
         ${canalDoInstagram(CANAL_IG_B, ORG_B, CONTA_IG_B)}`);
    sql(`
      insert into public.contacts (id, organization_id, name, social_identity) values
        ('${CONTATO_DE_DM}', '${ORG_A}', 'Pessoa da mensagem direta', 'instagram:${CONTA_IG_A}:${AUTOR_DE_DM}'),
        ('${CONTATO_DE_DM_NA_B}', '${ORG_B}', 'Outra pessoa, outra empresa', 'instagram:${CONTA_IG_B}:${AUTOR_DE_DM}');
      insert into public.contacts (id, organization_id, name, social_identity, is_merged_into) values
        ('${CONTATO_UNIDO}', '${ORG_A}', 'Ficha antiga da mesma pessoa', 'instagram:${CONTA_IG_A}:${AUTOR_UNIDO}', '${CONTATO_DE_DM}');
      ${comentario(ORG_A, CANAL_IG_A, "i-nunca-ligado", AUTOR_DE_DM, {
        ignore_reason: `'pediu desconto'`,
        public_reply: resposta("Oi, Maria!"),
        hidden: ocultacao,
      })}
      ${comentario(ORG_A, CANAL_IG_A, "i-da-ficha-unida", AUTOR_UNIDO)}
      ${comentario(ORG_A, CANAL_IG_A, "i-outro-autor", OUTRO_AUTOR)}
      ${comentario(ORG_A, CANAL_IG_A2, "i-mesmo-id-outra-conta", AUTOR_DE_DM)}
      ${comentario(ORG_B, CANAL_IG_B, "i-outra-org", AUTOR_DE_DM)}
    `);
    sql(`select public.fn_lgpd_cascade_redact_contact('${ORG_A}', '${CONTATO_DE_DM}', gen_random_uuid());`);
  });

  it("CONTROLE: nenhum desses comentários está ligado a contato (a 9812 sozinha não os alcançaria)", () => {
    expect(
      valor(`select count(*)::text from ${T}
              where organization_id in ('${ORG_A}', '${ORG_B}') and comment_id like 'i-%' and contact_id is not null;`),
    ).toBe("0");
    expect(valor(`select is_anonymized::text from public.contacts where id = '${CONTATO_DE_DM}';`)).toBe("true");
  });

  it("⭐ o comentário de quem só era contato por mensagem direta perde texto, autor, motivo e o texto da resposta", () => {
    expect(campo(ORG_A, "i-nunca-ligado", "text")).toBe("(anonimizado)");
    expect(campo(ORG_A, "i-nunca-ligado", "coalesce(author_id, '∅')")).toBe("∅");
    expect(campo(ORG_A, "i-nunca-ligado", "coalesce(author_username, '∅')")).toBe("∅");
    expect(campo(ORG_A, "i-nunca-ligado", "coalesce(ignore_reason, '∅')")).toBe("∅");
    expect(campo(ORG_A, "i-nunca-ligado", "public_reply->>'texto'")).toBe("(anonimizado)");
  });

  it("⭐ `hidden` fica só com os campos conhecidos: a ocultação continua registrada, o resto sai", () => {
    expect(campo(ORG_A, "i-nunca-ligado", "hidden->>'quando'")).toBe("2026-11-20T13:00:00.000Z");
    expect(campo(ORG_A, "i-nunca-ligado", "hidden->>'simulada'")).toBe("false");
    expect(campo(ORG_A, "i-nunca-ligado", "hidden->'quem'->>'id'")).toBe("u-1");
    expect(campo(ORG_A, "i-nunca-ligado", "(hidden ? 'observacao')::text")).toBe("false");
  });

  it("⭐ a identidade de uma ficha UNIDA a este contato também é alcançada", () => {
    expect(campo(ORG_A, "i-da-ficha-unida", "text")).toBe("(anonimizado)");
    expect(campo(ORG_A, "i-da-ficha-unida", "coalesce(author_id, '∅')")).toBe("∅");
  });

  it("CONTROLE: outro autor, na mesma conta, fica intacto", () => {
    expect(campo(ORG_A, "i-outro-autor", "text")).toBe("texto de i-outro-autor");
    expect(campo(ORG_A, "i-outro-autor", "author_id")).toBe(OUTRO_AUTOR);
  });

  it("CONTROLE: o mesmo id de autor em OUTRA conta da mesma empresa não é a mesma identidade", () => {
    expect(campo(ORG_A, "i-mesmo-id-outra-conta", "text")).toBe("texto de i-mesmo-id-outra-conta");
    expect(campo(ORG_A, "i-mesmo-id-outra-conta", "author_id")).toBe(AUTOR_DE_DM);
  });

  it("CONTROLE: o mesmo id de autor em OUTRA organização fica intacto", () => {
    expect(campo(ORG_B, "i-outra-org", "text")).toBe("texto de i-outra-org");
    expect(campo(ORG_B, "i-outra-org", "author_id")).toBe(AUTOR_DE_DM);
    expect(valor(`select is_anonymized::text from public.contacts where id = '${CONTATO_DE_DM_NA_B}';`)).toBe("false");
  });

  it("a função continua fechada: só o servidor a executa", () => {
    expect(
      valor(`select count(*)::text from information_schema.routine_privileges
              where routine_schema = 'public' and routine_name = 'fn_redigir_comentarios_ao_anonimizar'
                and grantee in ('PUBLIC', 'anon', 'authenticated');`),
    ).toBe("0");
  });
});

describe("9812 — apagar o contato não apaga o comentário", () => {
  it("`on delete set null`: o comentário sobrevive, sem a ligação", () => {
    sql(`delete from public.contacts where id = '${CONTATO_APAGAVEL}';`);
    expect(campo(ORG_A, "c-do-apagavel", "coalesce(contact_id::text, '∅')")).toBe("∅");
    expect(campo(ORG_A, "c-do-apagavel", "text")).toBe("texto de c-do-apagavel");
  });
});
