import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { DESTINO_DA_EQUIPE_PRONTA } from "@/lib/ai/equipe-pronta/constantes";
import { traduzirLimiteDoPlano } from "@/lib/cobranca/limites";
import { leituraDaResposta, planoLibera } from "@/lib/cobranca/telas-do-plano";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";

import { sql } from "./gov-helpers";
import {
  assentosOcupados, assinar, canaisOcupados, chaveDeCobranca, comoServidor, criarOrg, criarPlano, criarUsuarios,
  erroDe, insercaoDeCanal, insercaoDeVinculo, numero, uuid, valor, vincular,
} from "./cobranca-helpers";

/**
 * OS TRÊS PLANOS NOVOS (Tarefa 8, parte 2) — o script que o Lucas roda à mão,
 * `docs/arvisx/ci/PLANOS-NOVOS-2026-11.sql`, medido num Postgres de verdade.
 *
 * O teste executa O ARQUIVO, e não uma cópia dos valores: se o script mudar um
 * limite, é este teste que diz. Prova quatro coisas:
 *   1. o script cria os três planos com preço, limites, teto e telas certos;
 *   2. rodar de novo não duplica nem sobrescreve, e não toca em plano antigo
 *      nem na assinatura de ninguém;
 *   3. a franquia de conversas entra (coluna da migration 9825), e o bloco
 *      dela não quebra num banco que ainda não tem a coluna;
 *   4. os gatilhos do banco recusam o 4º canal e o 6º usuário do plano 1, com
 *      a mensagem que `lib/cobranca/limites.ts` transforma na frase da tela.
 */

const SCRIPT = readFileSync(resolve(process.cwd(), "docs/arvisx/ci/PLANOS-NOVOS-2026-11.sql"), "utf8");

const PLANO_1 = "a7150008-0000-4000-8000-000000000001";
const PLANO_2 = "a7150008-0000-4000-8000-000000000002";
const PLANO_3 = "a7150008-0000-4000-8000-000000000003";
const NOVOS = `('${PLANO_1}','${PLANO_2}','${PLANO_3}')`;

const P = "a7150008-0000-4000-8000";
const ORG_ANTIGA = uuid(P, 501);
const ORG_NOVA = uuid(P, 502);
const PLANO_ANTIGO = uuid(P, 601);
const canal = (n: number) => uuid(P, 700 + n);
const pessoa = (n: number) => uuid(P, 800 + n);

/** A linha do plano, como texto estável para comparar antes e depois. */
const retrato = (id: string) => valor(`select row_to_json(p)::text from public.cobranca_planos p where p.id = '${id}';`);

let antigoAntes = "";
let assinaturaAntes = "";

beforeAll(() => {
  criarUsuarios(Array.from({ length: 8 }, (_, i) => [pessoa(i + 1), `pessoa-${i + 1}-planos-novos@invariant.test`] as const));
  criarOrg(ORG_ANTIGA, "planos-novos-antiga");
  criarOrg(ORG_NOVA, "planos-novos-nova");
  // Um plano "de hoje": sem teto de IA, com cliente assinando. O script não pode tocar nele.
  criarPlano({ id: PLANO_ANTIGO, nome: "Plano de hoje", maxAssentos: 2, maxCanais: 1, padrao: true, trialDias: 7 });
  assinar(ORG_ANTIGA, PLANO_ANTIGO);
  chaveDeCobranca("ligado");
  antigoAntes = retrato(PLANO_ANTIGO);
  assinaturaAntes = valor(`select row_to_json(a)::text from public.cobranca_assinaturas a where a.organization_id = '${ORG_ANTIGA}';`);
  sql(SCRIPT);
});

describe("planos novos — o script de docs/arvisx/ci", () => {
  it("⭐ cria os três planos com preço em euro, canais, usuários e teto de IA da tabela", () => {
    const linhas = sql(
      `select nome || '|' || preco_cents || '|' || moeda || '|' || intervalo || '|' || max_canais || '|' ||
              max_assentos || '|' || teto_ia_usd_cents
         from public.cobranca_planos where id in ${NOVOS} order by preco_cents;`,
    ).split("\n");
    expect(linhas).toEqual([
      "Plano 1|12990|EUR|mes|3|5|1200",
      "Plano 2|19990|EUR|mes|6|10|3200",
      "Plano 3|24990|EUR|mes|12|25|6000",
    ]);
  });

  it("os planos nascem fora da vitrine, sem virar o padrão do cadastro, com os dias de teste do padrão atual", () => {
    expect(numero(`select count(*) from public.cobranca_planos where id in ${NOVOS} and oferecido_ao_cliente;`)).toBe(0);
    expect(numero(`select count(*) from public.cobranca_planos where id in ${NOVOS} and padrao_no_cadastro;`)).toBe(0);
    expect(numero(`select count(*) from public.cobranca_planos where id in ${NOVOS} and arquivado_em is not null;`)).toBe(0);
    // O plano padrão de hoje tem 7 dias: os novos copiam, em vez de inventar um número.
    expect(numero(`select count(*) from public.cobranca_planos where id in ${NOVOS} and trial_dias = 7;`)).toBe(3);
  });

  it("⭐ todas as telas: o plano novo libera o catálogo inteiro, a Equipe pronta inclusive", () => {
    expect(valor(`select interface_settings::text from public.cobranca_planos where id = '${PLANO_1}';`)).toBe(
      `{"preset": "completa"}`,
    );
    assinar(ORG_NOVA, PLANO_1);
    // A leitura que o app faz: a função do banco, pela régua de lib/cobranca/telas-do-plano.ts.
    const leitura = leituraDaResposta(
      JSON.parse(valor(comoServidor(`select public.fn_telas_do_plano('${ORG_NOVA}')`))),
      null,
    );
    expect(leitura.tipo).toBe("plano");
    expect(planoLibera(leitura, DESTINO_DA_EQUIPE_PRONTA)).toBe(true);
    const fechadas = NAV_CATALOG.map((d) => d.href).filter((href) => !planoLibera(leitura, href));
    expect(fechadas).toEqual([]);
  });

  it("⭐ não toca em plano antigo nem na assinatura de ninguém", () => {
    expect(retrato(PLANO_ANTIGO)).toBe(antigoAntes);
    expect(valor(`select row_to_json(a)::text from public.cobranca_assinaturas a where a.organization_id = '${ORG_ANTIGA}';`)).toBe(
      assinaturaAntes,
    );
    // O teto de IA do plano de hoje segue vazio: o script não decide por quem já assina.
    expect(valor(`select coalesce(teto_ia_usd_cents::text, 'vazio') from public.cobranca_planos where id = '${PLANO_ANTIGO}';`)).toBe("vazio");
  });

  it("⭐ idempotente: rodar de novo não duplica e não sobrescreve o que foi editado na tela", () => {
    sql(`update public.cobranca_planos set nome = 'Nome escolhido pelo Lucas', oferecido_ao_cliente = true where id = '${PLANO_2}';`);
    const total = numero(`select count(*) from public.cobranca_planos;`);
    const depoisDaEdicao = retrato(PLANO_2);
    sql(SCRIPT);
    expect(numero(`select count(*) from public.cobranca_planos;`)).toBe(total);
    expect(retrato(PLANO_2)).toBe(depoisDaEdicao);
  });

  // Este caso media "o bloco não quebra SEM a coluna", quando ela ainda era da
  // parte 1. A migration 9825 a criou, e o caso passou a medir as duas coisas: a
  // franquia gravada, e o mesmo arquivo num banco que ainda não tem a coluna.
  it("⭐ grava a franquia de conversas: 300, 800 e 1.500", () => {
    expect(
      sql(`select franquia_conversas_ia from public.cobranca_planos where id in ${NOVOS} order by preco_cents;`).split("\n"),
    ).toEqual(["300", "800", "1500"]);
  });

  it("⭐ a franquia que já foi posta à mão não é sobrescrita ao rodar de novo", () => {
    sql(`update public.cobranca_planos set franquia_conversas_ia = 350 where id = '${PLANO_1}';`);
    sql(SCRIPT);
    expect(valor(`select franquia_conversas_ia from public.cobranca_planos where id = '${PLANO_1}';`)).toBe("350");
    sql(`update public.cobranca_planos set franquia_conversas_ia = 300 where id = '${PLANO_1}';`);
  });

  it("num banco que ainda não tem a coluna (antes do deploy), o arquivo roda inteiro e avisa, sem falhar", () => {
    // A coluna sai e volta dentro de UMA transação: o que se mede é o script num
    // banco sem ela, e o `rollback` devolve o banco como estava.
    const saida = erroDe(`begin;
      alter table public.cobranca_planos drop column franquia_conversas_ia;
      ${SCRIPT}
      rollback;`);
    expect(saida).toBe("");
    // Controle: a coluna voltou, com os valores.
    expect(valor(`select franquia_conversas_ia from public.cobranca_planos where id = '${PLANO_3}';`)).toBe("1500");
  });
});

describe("planos novos — os gatilhos do banco recusam o que passa do plano 1", () => {
  it("⭐ o 4º canal é recusado com a mensagem pronta para a tela", () => {
    assinar(ORG_NOVA, PLANO_1);
    for (let n = 1; n <= 3; n++) sql(`${insercaoDeCanal(canal(n), ORG_NOVA)};`);
    const e = erroDe(`${insercaoDeCanal(canal(4), ORG_NOVA)};`);
    expect(e).toContain("PT402");
    expect(e).toContain("limite_do_plano:canais:3");
    expect(canaisOcupados(ORG_NOVA)).toBe(3);
    // A frase que a pessoa lê sai da MENSAGEM do banco (lib/cobranca/limites.ts).
    expect(traduzirLimiteDoPlano(e, "pt-BR")).toEqual({
      code: "plan_limit_reached",
      message:
        "Seu plano permite 3 números conectados. Exclua um número em Conexões ou troque de plano em Configurações › Plano e cobrança.",
      details: { recurso: "canais", limite: 3 },
    });
  });

  it("⭐ o 6º usuário é recusado com a mensagem pronta para a tela", () => {
    assinar(ORG_NOVA, PLANO_1);
    vincular(pessoa(1), ORG_NOVA, "admin");
    for (let n = 2; n <= 5; n++) vincular(pessoa(n), ORG_NOVA);
    const e = erroDe(`${insercaoDeVinculo(pessoa(6), ORG_NOVA)};`);
    expect(e).toContain("PT402");
    expect(e).toContain("limite_do_plano:assentos:5");
    expect(assentosOcupados(ORG_NOVA)).toBe(5);
    expect(traduzirLimiteDoPlano(e, "pt-BR")).toEqual({
      code: "plan_limit_reached",
      message:
        "Seu plano permite 5 pessoas e todas as vagas estão ocupadas. Revogue o acesso de alguém em Equipe ou troque de plano em Configurações › Plano e cobrança.",
      details: { recurso: "assentos", limite: 5 },
    });
  });

  it("subir para o plano 2 abre a vaga: o mesmo canal e a mesma pessoa entram", () => {
    assinar(ORG_NOVA, PLANO_2);
    expect(erroDe(`${insercaoDeCanal(canal(4), ORG_NOVA)};`)).toBe("");
    expect(erroDe(`${insercaoDeVinculo(pessoa(6), ORG_NOVA)};`)).toBe("");
    expect(valor(`select count(*) from public.cobranca_planos where id = '${PLANO_3}' and max_canais = 12 and max_assentos = 25;`)).toBe("1");
  });
});
