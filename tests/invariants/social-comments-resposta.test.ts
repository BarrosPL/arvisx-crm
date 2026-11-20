import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";
import {
  comoUsuario, criarOrg, criarUsuarios, erroDe, insercaoDeCanal, uuid, valor, vincular,
} from "./cobranca-helpers";

/**
 * OS COMENTÁRIOS DO INSTAGRAM PASSAM A SER RESPONDIDOS (ArvisX, migration 9812).
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
 *   6. as colunas novas continuam fechadas para a sessão: membro não escreve.
 */
const P = "e9019812-0000-4000-8000";
const ORG_A = uuid(P, 1);
const ORG_B = uuid(P, 2);
const GERENTE_A = uuid(P, 11);
const CANAL_A = uuid(P, 21);
const CANAL_B = uuid(P, 22);
const CONTATO = uuid(P, 31);
const CONTATO_APAGAVEL = uuid(P, 32);

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

describe("9812 — apagar o contato não apaga o comentário", () => {
  it("`on delete set null`: o comentário sobrevive, sem a ligação", () => {
    sql(`delete from public.contacts where id = '${CONTATO_APAGAVEL}';`);
    expect(campo(ORG_A, "c-do-apagavel", "coalesce(contact_id::text, '∅')")).toBe("∅");
    expect(campo(ORG_A, "c-do-apagavel", "text")).toBe("texto de c-do-apagavel");
  });
});
