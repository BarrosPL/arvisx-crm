import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";

import { columnExists, sql } from "./gov-helpers";
import { criarPlano, uuid, valor } from "./cobranca-helpers";

/**
 * MODO FISCAL EM TRÊS ESTADOS E PLANOS FORA DO MANAGED PAYMENTS (ArvisX, migration 9807).
 *
 * A migration é RODADA de verdade sobre o banco do baseline (banco novo por
 * arquivo), em cada ponto de partida que uma instalação pode ter:
 *
 * 1. O booleano `COBRANCA_IVA` vira `COBRANCA_MODO_FISCAL` sem perder nada:
 *    `ligado` → `stripe_tax`; `desligado` → `desligado`; sem linha → sem linha
 *    (o código lê `desligado`, o padrão das instalações novas).
 * 2. É idempotente: rodar duas vezes dá no mesmo, e NUNCA desfaz o que o dono
 *    escolheu depois pela tela (o modo e a marca do plano).
 * 3. `cobranca_planos.fora_do_managed_payments`: default false; true, na criação
 *    da coluna, nos planos com `inclui_agentes_arvisx` (o Equipe Completa).
 */
const MIGRATION = readFileSync("supabase/migrations/20261111180000_9807_modo_fiscal_e_managed_payments.sql", "utf8");
const P = "c0b09807-0000-4000-8000";
const EQUIPE = uuid(P, 101);
const PREMIUM = uuid(P, 102);

const rodar = () => sql(MIGRATION);
const config = (chave: string) =>
  valor(`select coalesce((select valor from public.platform_config where chave = '${chave}'), '<sem linha>');`);
const gravar = (chave: string, v: string) =>
  sql(`insert into public.platform_config (chave, valor, eh_segredo, semeado_do_env) values ('${chave}', '${v}', false, false)
         on conflict (chave) do update set valor = excluded.valor;`);
const marca = (plano: string) => valor(`select fora_do_managed_payments from public.cobranca_planos where id = '${plano}';`);
/** O banco como estava ANTES da 9807: sem a coluna e sem a linha nova. */
const voltarAoEstadoDeAntes = () =>
  sql(`alter table public.cobranca_planos drop column if exists fora_do_managed_payments;
       delete from public.platform_config where chave in ('COBRANCA_IVA', 'COBRANCA_MODO_FISCAL');`);

beforeEach(() => {
  voltarAoEstadoDeAntes();
  sql(`delete from public.cobranca_planos where id in ('${EQUIPE}', '${PREMIUM}');`);
  criarPlano({ id: EQUIPE, nome: "Equipe Completa" });
  criarPlano({ id: PREMIUM, nome: "Premium" });
  sql(`update public.cobranca_planos set inclui_agentes_arvisx = true where id = '${EQUIPE}';`);
});

describe("9807 — o booleano do IVA vira o modo fiscal", () => {
  it("o baseline já traz a coluna (a instalação nova nasce com ela), com default false e NOT NULL", () => {
    rodar();
    expect(columnExists("cobranca_planos", "fora_do_managed_payments")).toBe(true);
    expect(
      valor(`select is_nullable || '|' || column_default from information_schema.columns
              where table_schema = 'public' and table_name = 'cobranca_planos' and column_name = 'fora_do_managed_payments';`),
    ).toBe("NO|false");
  });

  it("⭐ IVA ligado (true) → stripe_tax, e a linha antiga FICA (nada do que estava salvo se perde)", () => {
    gravar("COBRANCA_IVA", "ligado");
    rodar();
    expect(config("COBRANCA_MODO_FISCAL")).toBe("stripe_tax");
    expect(config("COBRANCA_IVA")).toBe("ligado");
  });

  it("⭐ IVA desligado (false) → desligado", () => {
    gravar("COBRANCA_IVA", "desligado");
    rodar();
    expect(config("COBRANCA_MODO_FISCAL")).toBe("desligado");
    expect(config("COBRANCA_IVA")).toBe("desligado");
  });

  it("valor que não é 'ligado' (lixo antigo) cai em desligado — nunca liga imposto por engano", () => {
    gravar("COBRANCA_IVA", "sim");
    rodar();
    expect(config("COBRANCA_MODO_FISCAL")).toBe("desligado");
  });

  it("instalação que nunca gravou o IVA: nenhuma linha é criada (sem linha = desligado, o padrão)", () => {
    rodar();
    expect(config("COBRANCA_MODO_FISCAL")).toBe("<sem linha>");
    expect(config("COBRANCA_IVA")).toBe("<sem linha>");
  });

  it("a linha nova é de configuração comum: texto em claro, não segredo, escrita por pessoa (o .env não a sobrescreve)", () => {
    gravar("COBRANCA_IVA", "ligado");
    rodar();
    expect(
      valor(`select eh_segredo::text || '|' || semeado_do_env::text || '|' || (ciphertext is null)::text
               from public.platform_config where chave = 'COBRANCA_MODO_FISCAL';`),
    ).toBe("false|false|true");
  });

  it("⭐ idempotente: rodar duas vezes dá no mesmo, com uma linha só", () => {
    gravar("COBRANCA_IVA", "ligado");
    rodar();
    rodar();
    expect(config("COBRANCA_MODO_FISCAL")).toBe("stripe_tax");
    expect(valor(`select count(*) from public.platform_config where chave = 'COBRANCA_MODO_FISCAL';`)).toBe("1");
    expect(marca(EQUIPE)).toBe("t");
    expect(marca(PREMIUM)).toBe("f");
  });

  it("⭐ rodar de novo NÃO desfaz a escolha do dono: managed_payments gravado pela tela continua, mesmo com o booleano antigo dizendo outra coisa", () => {
    gravar("COBRANCA_IVA", "ligado");
    rodar();
    gravar("COBRANCA_MODO_FISCAL", "managed_payments");
    rodar();
    expect(config("COBRANCA_MODO_FISCAL")).toBe("managed_payments");
    gravar("COBRANCA_MODO_FISCAL", "desligado");
    rodar();
    expect(config("COBRANCA_MODO_FISCAL")).toBe("desligado");
  });
});

describe("9807 — a marca do plano fora do Managed Payments", () => {
  it("⭐ na criação da coluna, o plano com os agentes sob medida (Equipe Completa) nasce true; os outros, false", () => {
    rodar();
    expect(marca(EQUIPE)).toBe("t");
    expect(marca(PREMIUM)).toBe("f");
  });

  it("⭐ a marca é do dono depois disso: rodar de novo não remarca o que ele desmarcou nem desmarca o que ele marcou", () => {
    rodar();
    sql(`update public.cobranca_planos set fora_do_managed_payments = false where id = '${EQUIPE}';
         update public.cobranca_planos set fora_do_managed_payments = true where id = '${PREMIUM}';`);
    rodar();
    expect(marca(EQUIPE)).toBe("f");
    expect(marca(PREMIUM)).toBe("t");
  });

  it("plano criado depois nasce false, mesmo com os agentes sob medida (a marca é escolha, não derivação)", () => {
    rodar();
    const NOVO = uuid(P, 103);
    criarPlano({ id: NOVO, nome: "Equipe Completa 2" });
    sql(`update public.cobranca_planos set inclui_agentes_arvisx = true where id = '${NOVO}';`);
    expect(marca(NOVO)).toBe("f");
  });

  it("a coluna não aceita nulo", () => {
    rodar();
    expect(() => sql(`update public.cobranca_planos set fora_do_managed_payments = null where id = '${PREMIUM}';`)).toThrow();
  });
});
