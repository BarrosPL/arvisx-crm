import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, lastLine, seedGov, sql } from "./gov-helpers";

/**
 * O SCRIPT QUE O DONO RODA À MÃO (`docs/arvisx/ci/VIX-LIMITES-E-MARCA-2026-11.sql`)
 * FUNCIONA, É IDEMPOTENTE E NÃO GRAVA NADA SEM VALOR INFORMADO.
 *
 * Script de produção que ninguém executou é promessa. Aqui ele roda de verdade,
 * pelo `psql` e com as variáveis, contra o banco do teste:
 *
 *  - sem valores, não grava nada (nenhum número vem sugerido no arquivo);
 *  - com limite, grava o plano; de novo, atualiza sem duplicar;
 *  - com o slug, marca a organização; e a configuração que a aplicação lê
 *    (`fn_assistente_config_da_org`) passa a dizer "marca, sem limite";
 *  - plano que não existe e slug que não existe param com erro, sem gravar.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) throw new Error("TEST_DB_CONTAINER ausente — rode por `pnpm test:db`.");

const SCRIPT = readFileSync(join(process.cwd(), "docs", "arvisx", "ci", "VIX-LIMITES-E-MARCA-2026-11.sql"), "utf8");

const PLANOS = [1, 2, 3].map((n) => `a7150008-0000-4000-8000-00000000000${n}`);

function rodar(vars: { l1?: string; l2?: string; l3?: string; slug?: string }): string {
  return execFileSync(
    "docker",
    [
      "exec", "-i", container as string, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1",
      "-v", `limite_plano_1=${vars.l1 ?? ""}`,
      "-v", `limite_plano_2=${vars.l2 ?? ""}`,
      "-v", `limite_plano_3=${vars.l3 ?? ""}`,
      "-v", `org_slug=${vars.slug ?? ""}`,
      "-tA", "-f", "-",
    ],
    { input: SCRIPT, encoding: "utf8" },
  );
}

const linhasDePlano = () => Number(sql("select count(*) from public.assistente_planos;"));
const marcadas = () => Number(sql("select count(*) from public.assistente_estado_da_empresa where sem_limite;"));
const config = (org: string) =>
  lastLine(
    sql(`
      set role service_role;
      select coalesce(
        (select origem || ':' || coalesce(mensagens_por_mes::text, 'sem_limite') from public.fn_assistente_config_da_org('${org}')),
        'SEM_VIX');
    `),
  );

beforeAll(() => {
  seedGov();
});

describe("o script de limites e de marca do Vix", () => {
  it("o arquivo não traz número de limite nem nome de organização", () => {
    const semComentarios = SCRIPT.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(semComentarios).not.toMatch(/voce-na-europa|perrotti/i);
    // Os únicos números do SQL são os ids fixos dos planos.
    expect(semComentarios.replace(/a7150008-0000-4000-8000-00000000000\d/g, "")).not.toMatch(/mensagens_por_mes\s*=\s*\d/);
  });

  it("sem nenhum valor: roda, e não grava nada", () => {
    rodar({});
    expect(linhasDePlano()).toBe(0);
    expect(marcadas()).toBe(0);
  });

  it("com limite para plano que ainda não existe: para com erro e não grava", () => {
    expect(() => rodar({ l1: "50" })).toThrow(/PLANOS-NOVOS-2026-11\.sql/);
    expect(linhasDePlano()).toBe(0);
  });

  it("com os planos criados: grava o limite; rodando de novo, atualiza sem duplicar", () => {
    sql(
      PLANOS.map(
        (id, i) =>
          `insert into public.cobranca_planos (id, nome, preco_cents, intervalo) values ('${id}', 'Plano ${i + 1}', 1000, 'mes') on conflict do nothing;`,
      ).join("\n"),
    );
    rodar({ l1: "50", l3: "200" });
    expect(sql("select string_agg(mensagens_por_mes::text, ',' order by mensagens_por_mes) from public.assistente_planos;")).toBe("50,200");
    rodar({ l1: "60", l3: "200" });
    expect(linhasDePlano()).toBe(2);
    expect(sql("select string_agg(mensagens_por_mes::text, ',' order by mensagens_por_mes) from public.assistente_planos;")).toBe("60,200");
  });

  it("limite que não é número inteiro: para com erro", () => {
    expect(() => rodar({ l2: "muitas" })).toThrow(/limite inválido/);
    expect(linhasDePlano()).toBe(2);
  });

  it("com o slug: marca a organização, e a aplicação passa a ler 'marca, sem limite'", () => {
    expect(config(GOV_ORG)).toBe("SEM_VIX");
    rodar({ slug: "gov-inv" });
    expect(marcadas()).toBe(1);
    expect(config(GOV_ORG)).toBe("marca:sem_limite");
    // De novo: continua uma marca só.
    rodar({ slug: "gov-inv" });
    expect(marcadas()).toBe(1);
  });

  it("a marca preserva o desligado que a empresa escolheu", () => {
    sql(`update public.assistente_estado_da_empresa set ligado = false, sem_limite = false where organization_id = '${GOV_ORG}';`);
    rodar({ slug: "gov-inv" });
    expect(sql(`select ligado::text || ':' || sem_limite::text from public.assistente_estado_da_empresa where organization_id = '${GOV_ORG}';`)).toBe(
      "false:true",
    );
  });

  it("slug que não existe: para com erro e não marca ninguém", () => {
    const antes = marcadas();
    expect(() => rodar({ slug: "organizacao-que-nao-existe" })).toThrow(/não existe organização/);
    expect(marcadas()).toBe(antes);
  });
});
