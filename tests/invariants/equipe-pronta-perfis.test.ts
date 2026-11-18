import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";
import {
  comoAnon, comoServidor, comoUsuario, criarOrg, criarUsuarios, erroDe, uuid, valor, vincular,
} from "./cobranca-helpers";

/**
 * O PERFIL DO NEGÓCIO DA EQUIPE DE IA PRONTA (ArvisX, migration 9808).
 *
 * `equipe_pronta_perfis` guarda as respostas do questionário de uma empresa: o
 * que ela faz, como atende, as regras comerciais dela. A LEITURA é de qualquer
 * membro da organização (medida também em `rls-isolation.test.ts`, com o agent
 * semeado). O que este arquivo mede é o segundo eixo, que aquele não alcança:
 *
 *   1. a ESCRITA exige `manager`: o agent lê e não grava;
 *   2. ninguém grava, nem lê, o perfil de OUTRA organização;
 *   3. a sessão não apaga a linha (não há policy de DELETE);
 *   4. `anon` não lê;
 *   5. uma linha por organização, e os dois CHECK seguram valor fora do
 *      vocabulário.
 */
const P = "e9019808-0000-4000-8000";
const ORG_A = uuid(P, 1);
const ORG_B = uuid(P, 2);
const GERENTE_A = uuid(P, 11);
const AGENTE_A = uuid(P, 12);
const GERENTE_B = uuid(P, 13);

const T = "public.equipe_pronta_perfis";
const nomeEm = (org: string) =>
  valor(`select respostas->'negocio'->>'nome' from ${T} where organization_id = '${org}';`);

beforeAll(() => {
  criarUsuarios([
    [GERENTE_A, "gerente-a-9808@invariant.test"],
    [AGENTE_A, "agente-a-9808@invariant.test"],
    [GERENTE_B, "gerente-b-9808@invariant.test"],
  ]);
  criarOrg(ORG_A, "equipe-pronta-a");
  criarOrg(ORG_B, "equipe-pronta-b");
  vincular(GERENTE_A, ORG_A, "manager");
  vincular(AGENTE_A, ORG_A, "agent");
  vincular(GERENTE_B, ORG_B, "manager");
  sql(
    `insert into ${T} (organization_id, respostas) values
       ('${ORG_A}', '{"negocio":{"nome":"Empresa A"}}'::jsonb),
       ('${ORG_B}', '{"negocio":{"nome":"Empresa B"}}'::jsonb)
     on conflict (organization_id) do update set respostas = excluded.respostas;`,
  );
});

describe("9808 — leitura do perfil da equipe pronta", () => {
  it("⭐ cada membro lê o perfil da própria organização e zero da outra", () => {
    for (const quem of [GERENTE_A, AGENTE_A]) {
      expect(countAs(quem, `select count(*) from ${T} where organization_id = '${ORG_A}';`)).toBe(1);
      expect(countAs(quem, `select count(*) from ${T} where organization_id = '${ORG_B}';`)).toBe(0);
    }
    expect(countAs(GERENTE_B, `select count(*) from ${T};`)).toBe(1);
  });

  it("anon não lê", () => {
    expect(erroDe(comoAnon(`select count(*) from ${T}`))).toContain(
      "permission denied for table equipe_pronta_perfis",
    );
  });
});

describe("9808 — escrita do perfil da equipe pronta", () => {
  it("⭐ manager grava o perfil da própria organização", () => {
    comoUsuario(
      GERENTE_A,
      `update ${T} set respostas = '{"negocio":{"nome":"Empresa A editada"}}'::jsonb where organization_id = '${ORG_A}'`,
    );
    expect(nomeEm(ORG_A)).toBe("Empresa A editada");
  });

  it("⭐ agent lê mas NÃO grava: o update não alcança linha nenhuma", () => {
    comoUsuario(
      AGENTE_A,
      `update ${T} set respostas = '{"negocio":{"nome":"pelo agent"}}'::jsonb where organization_id = '${ORG_A}'`,
    );
    expect(nomeEm(ORG_A)).toBe("Empresa A editada");
  });

  it("⭐ manager de A não grava o perfil de B, nem por update nem por insert", () => {
    comoUsuario(
      GERENTE_A,
      `update ${T} set respostas = '{"negocio":{"nome":"invadido"}}'::jsonb where organization_id = '${ORG_B}'`,
    );
    expect(nomeEm(ORG_B)).toBe("Empresa B");

    // Trocar a organização da própria linha para a do vizinho também é recusado.
    expect(
      erroDe(comoUsuario(GERENTE_A, `update ${T} set organization_id = '${ORG_B}' where organization_id = '${ORG_A}'`)),
    ).not.toBe("");
    expect(valor(`select count(*) from ${T} where organization_id = '${ORG_A}';`)).toBe("1");
  });

  it("agent não insere perfil (a policy de insert exige manager)", () => {
    const orgNova = uuid(P, 3);
    criarOrg(orgNova, "equipe-pronta-c");
    vincular(AGENTE_A, orgNova, "agent");
    expect(
      erroDe(comoUsuario(AGENTE_A, `insert into ${T} (organization_id) values ('${orgNova}')`)),
    ).toContain("row-level security");
    expect(valor(`select count(*) from ${T} where organization_id = '${orgNova}';`)).toBe("0");
  });

  it("a sessão não apaga o perfil: não há privilégio de delete", () => {
    expect(
      erroDe(comoUsuario(GERENTE_A, `delete from ${T} where organization_id = '${ORG_A}'`)),
    ).toContain("permission denied for table equipe_pronta_perfis");
  });
});

describe("9808 — forma da tabela", () => {
  it("uma linha por organização", () => {
    expect(erroDe(comoServidor(`insert into ${T} (organization_id) values ('${ORG_A}')`))).toContain(
      "duplicate key",
    );
  });

  it("estado e modo só aceitam o vocabulário", () => {
    expect(
      erroDe(comoServidor(`update ${T} set estado = 'publicado' where organization_id = '${ORG_A}'`)),
    ).toContain("violates check constraint");
    expect(
      erroDe(comoServidor(`update ${T} set modo = 'producao' where organization_id = '${ORG_A}'`)),
    ).toContain("violates check constraint");
  });

  it("nasce como rascunho, em ensaio, e updated_at anda sozinho", () => {
    expect(valor(`select estado || ',' || modo from ${T} where organization_id = '${ORG_B}';`)).toBe(
      "rascunho,ensaio",
    );
    sql(`update ${T} set updated_at = now() - interval '1 day' where organization_id = '${ORG_B}';`);
    sql(`update ${T} set modo = 'ensaio' where organization_id = '${ORG_B}';`);
    expect(valor(`select (updated_at > now() - interval '1 minute')::text from ${T} where organization_id = '${ORG_B}';`)).toBe(
      "true",
    );
  });

  it("controle: o servidor lê as duas organizações", () => {
    expect(
      valor(comoServidor(`select count(*) from ${T} where organization_id in ('${ORG_A}', '${ORG_B}')`)),
    ).toBe("2");
  });
});
