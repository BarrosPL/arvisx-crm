import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, lastLine, seedGov, sql } from "./gov-helpers";

/**
 * O SCRIPT QUE O DONO RODA À MÃO (`docs/arvisx/ci/VIX-MARCA-DE-ISENTA-2026-11.sql`)
 * FUNCIONA, É IDEMPOTENTE E NÃO GRAVA NADA SEM VALOR INFORMADO.
 *
 * Script de produção que ninguém executou é promessa. Aqui ele roda de verdade,
 * pelo `psql` e com a variável, contra o banco do teste:
 *
 *  - sem o slug, não grava nada;
 *  - com o slug, marca a organização, e a aplicação passa a ler o acesso pela
 *    marca (`fn_assistente_acesso_da_org`);
 *  - de novo, continua uma marca só, e preserva o desligado da empresa;
 *  - slug que não existe para com erro, sem gravar.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) throw new Error("TEST_DB_CONTAINER ausente — rode por `pnpm test:db`.");

const SCRIPT = readFileSync(join(process.cwd(), "docs", "arvisx", "ci", "VIX-MARCA-DE-ISENTA-2026-11.sql"), "utf8");

function rodar(slug = ""): string {
  return execFileSync(
    "docker",
    ["exec", "-i", container as string, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-v", `org_slug=${slug}`, "-tA", "-f", "-"],
    { input: SCRIPT, encoding: "utf8" },
  );
}

const marcadas = () => Number(sql("select count(*) from public.assistente_estado_da_empresa where isenta;"));
const acesso = (org: string) =>
  lastLine(sql(`set role service_role; select coalesce(public.fn_assistente_acesso_da_org('${org}'), 'SEM_VIX');`));

beforeAll(() => {
  seedGov();
  sql(`delete from public.cobranca_assinaturas where organization_id = '${GOV_ORG}';
       delete from public.assistente_estado_da_empresa where organization_id = '${GOV_ORG}';`);
});

describe("o script da marca de isenta do Vix", () => {
  it("o arquivo não traz nome de organização nem número de limite", () => {
    const semComentarios = SCRIPT.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(semComentarios).not.toMatch(/voce-na-europa|perrotti/i);
    expect(semComentarios).not.toMatch(/mensagens_por_mes|assistente_planos|limite/i);
  });

  it("sem o slug: roda, e não marca ninguém", () => {
    rodar();
    expect(marcadas()).toBe(0);
    expect(acesso(GOV_ORG)).toBe("SEM_VIX");
  });

  it("com o slug: marca a organização, e a aplicação passa a ler o acesso pela marca", () => {
    rodar("gov-inv");
    expect(marcadas()).toBe(1);
    expect(acesso(GOV_ORG)).toBe("marca");
    // De novo: continua uma marca só.
    rodar("gov-inv");
    expect(marcadas()).toBe(1);
  });

  it("a marca preserva o desligado que a empresa escolheu", () => {
    sql(`update public.assistente_estado_da_empresa set ligado = false, isenta = false where organization_id = '${GOV_ORG}';`);
    rodar("gov-inv");
    expect(sql(`select ligado::text || ':' || isenta::text from public.assistente_estado_da_empresa where organization_id = '${GOV_ORG}';`)).toBe(
      "false:true",
    );
  });

  it("slug que não existe: para com erro e não marca ninguém", () => {
    const antes = marcadas();
    expect(() => rodar("organizacao-que-nao-existe")).toThrow(/não existe organização/);
    expect(marcadas()).toBe(antes);
  });
});
