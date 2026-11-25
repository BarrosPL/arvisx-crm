import { beforeAll, describe, expect, it } from "vitest";

import { SQL_ORCAMENTO, SQL_TETO_DO_PLANO, AVISO_CORPO, AVISO_TITULO } from "@/lib/agent-engine/edge/llm/orcamento";
import { ORIGENS_DA_CHAVE } from "@/lib/ai/usage/origem-da-chave";

import { sql } from "./gov-helpers";
import { assinar, chaveDeCobranca, comoAnon, comoServidor, comoUsuario, criarOrg, criarUsuarios, erroDe, numero, uuid, valor } from "./cobranca-helpers";

/**
 * IA POR PLANO, NO POSTGRES DE VERDADE (Tarefa 8, parte 1; migration 9825).
 *
 * O dublê do pool devolve a linha que o teste quiser; só o banco real diz se as
 * somas contam o que dizem contar. O que este arquivo prova:
 *
 *   1. `llm_calls.origem_da_chave` aceita os três valores, e o padrão é
 *      `plataforma` (a origem desconhecida conta no teto do plano);
 *   2. ⭐ linha `assinatura_plataforma` NÃO mexe em nenhuma soma de limite: nem
 *      no gasto do mês, nem no contador de `ai_budgets`, nem no gasto e nas
 *      conversas do plano — com controle positivo para cada soma;
 *   3. o teto do plano soma SÓ `plataforma`; o orçamento da empresa soma
 *      `cliente` e `plataforma`, como sempre;
 *   4. a franquia conta contatos distintos atendidos por um agente, no ciclo;
 *   5. o ciclo é o período pago quando ele existe e o plano é mensal, e o
 *      mês-calendário nos demais casos;
 *   6. empresa isenta e cobrança desligada voltam "sem assinatura";
 *   7. o aviso de 80% sai uma vez por ciclo;
 *   8. as funções novas não são alcançáveis pela anon key nem pela sessão.
 */

const P = "1a900825-0000-4000-8000";
const org = (n: number) => uuid(P, n);
const contato = (n: number) => uuid(P, 100 + n);
const plano = (n: number) => uuid(P, 900 + n);
const USUARIO = uuid(P, 950);

const ORG = org(1); // assinatura mensal em período pago, teto 1200 e franquia 3
const ORG_ISENTA = org(2); // sem assinatura
const ORG_SEM_TETO = org(3); // assinatura em plano sem teto
const ORG_ANUAL = org(4);
const ORG_TESTE = org(5); // teste grátis: sem período pago
const ORG_VENCIDA = org(6); // período pago que já acabou
const ORG_AVISO = org(7);

function gravar(
  o: string,
  d: { cents?: number | null; origem?: string; contato?: string | null; purpose?: string; status?: string; em?: string },
): void {
  sql(`insert into public.llm_calls
         (organization_id, contact_id, purpose, provider, model, input_tokens, output_tokens, cost_cents, latency_ms,
          status${d.origem === undefined ? "" : ", origem_da_chave"}, created_at)
       values ('${o}', ${d.contato ? `'${d.contato}'` : "null"}, '${d.purpose ?? "agent_turn"}', 'anthropic',
               'claude-haiku-5-5', 10, 10, ${d.cents === null ? "null" : (d.cents ?? 0)}, 100,
               '${d.status ?? "ok"}'${d.origem === undefined ? "" : `, '${d.origem}'`}, ${d.em ?? "now()"});`);
}

interface IaDoPlano {
  com_assinatura: string;
  teto: string;
  franquia: string;
  gasto: string;
  conversas: string;
  pelo_periodo_pago: string;
}
function iaDoPlano(o: string): IaDoPlano {
  const [com_assinatura = "", teto = "", franquia = "", gasto = "", conversas = "", pelo_periodo_pago = ""] = valor(
    comoServidor(
      `select com_assinatura, coalesce(teto::text,''), coalesce(franquia::text,''), coalesce(gasto::text,''),
              coalesce(conversas::text,''), coalesce(pelo_periodo_pago::text,'')
         from public.fn_ia_do_plano('${o}')`,
    ),
  ).split("|");
  return { com_assinatura, teto, franquia, gasto, conversas, pelo_periodo_pago };
}
const gastoDoMes = (o: string) => numero(comoServidor(`select public.fn_gasto_de_ia_do_mes('${o}')`));
const contadorDoOrcamento = (o: string) =>
  numero(`select coalesce((select current_month_consumed_cents from public.ai_budgets where organization_id = '${o}'), 0);`);

beforeAll(() => {
  criarUsuarios([[USUARIO, "pessoa-ia-por-plano@invariant.test"]]);
  for (let n = 1; n <= 7; n++) criarOrg(org(n), `ia-por-plano-${n}`);
  sql(`
    insert into public.cobranca_planos (id, nome, preco_cents, intervalo, teto_ia_usd_cents, franquia_conversas_ia) values
      ('${plano(1)}', 'Mensal com franquia', 12990, 'mes', 1200, 3),
      ('${plano(2)}', 'Mensal sem teto', 5990, 'mes', null, null),
      ('${plano(3)}', 'Anual', 99900, 'ano', 1200, 3);
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USUARIO}', '${ORG}', 'admin', now());
    insert into public.contacts (id, organization_id, name) values
      ${[1, 2, 3, 4, 5, 6].map((n) => `('${contato(n)}', '${ORG}', 'Contato ${n}')`).join(",")},
      ('${contato(7)}', '${ORG_ANUAL}', 'Contato do anual');
  `);
  assinar(ORG, plano(1));
  assinar(ORG_SEM_TETO, plano(2));
  assinar(ORG_ANUAL, plano(3));
  assinar(ORG_TESTE, plano(1));
  assinar(ORG_VENCIDA, plano(1));
  assinar(ORG_AVISO, plano(1));
  // ORG: período pago de 10 dias atrás até daqui a 20 dias.
  sql(`update public.cobranca_assinaturas
          set estado = 'ativa', periodo_pago_desde = now() - interval '10 days', proximo_vencimento = now() + interval '20 days'
        where organization_id in ('${ORG}', '${ORG_ANUAL}');
       update public.cobranca_assinaturas
          set estado = 'em_atraso', periodo_pago_desde = now() - interval '40 days', proximo_vencimento = now() - interval '10 days'
        where organization_id = '${ORG_VENCIDA}';`);
  chaveDeCobranca("ligado");
});

describe("llm_calls.origem_da_chave", () => {
  it("o CHECK aceita exatamente os três valores do par TypeScript", () => {
    expect([...ORIGENS_DA_CHAVE]).toEqual(["cliente", "plataforma", "assinatura_plataforma"]);
    for (const origem of ORIGENS_DA_CHAVE) expect(erroDe(`
      insert into public.llm_calls (organization_id, purpose, provider, model, input_tokens, output_tokens, cost_cents, origem_da_chave)
      values ('${ORG_ISENTA}', 'connection_test', 'anthropic', 'm', 0, 0, 0, '${origem}');`)).toBe("");
    const recusa = erroDe(`
      insert into public.llm_calls (organization_id, purpose, provider, model, input_tokens, output_tokens, cost_cents, origem_da_chave)
      values ('${ORG_ISENTA}', 'connection_test', 'anthropic', 'm', 0, 0, 0, 'assistente');`);
    expect(recusa).toContain("23514");
    expect(recusa).toContain("llm_calls_origem_da_chave_check");
  });

  it("⭐ o padrão é plataforma: a linha de quem não informa a origem conta no teto do plano", () => {
    expect(
      valor(`select column_default from information_schema.columns
              where table_schema = 'public' and table_name = 'llm_calls' and column_name = 'origem_da_chave';`),
    ).toBe("'plataforma'::text");
    const antes = Number(iaDoPlano(ORG).gasto);
    gravar(ORG, { cents: 7 }); // sem `origem`: vale o padrão da coluna
    expect(Number(iaDoPlano(ORG).gasto)).toBe(antes + 7);
  });
});

describe("⭐ a assinatura da plataforma não entra em nenhuma soma de limite", () => {
  it("linha assinatura_plataforma não mexe no gasto do mês, no contador de ai_budgets, nem no gasto e nas conversas do plano", () => {
    // Estado de partida, com as três somas vivas (guarda de vacuidade).
    gravar(ORG, { cents: 50, origem: "plataforma", contato: contato(1) });
    const antes = {
      doMes: gastoDoMes(ORG),
      contador: contadorDoOrcamento(ORG),
      plano: iaDoPlano(ORG),
    };
    expect(antes.doMes).toBeGreaterThan(0);
    expect(antes.contador).toBeGreaterThan(0);
    expect(Number(antes.plano.gasto)).toBeGreaterThan(0);
    expect(Number(antes.plano.conversas)).toBe(1);

    // Uma chamada cara, de um contato NOVO, pela assinatura da plataforma.
    gravar(ORG, { cents: 100000, origem: "assinatura_plataforma", contato: contato(6) });

    expect(gastoDoMes(ORG), "o gasto do mês somou a assinatura da plataforma").toBe(antes.doMes);
    expect(contadorDoOrcamento(ORG), "o contador de ai_budgets somou a assinatura da plataforma").toBe(antes.contador);
    const depois = iaDoPlano(ORG);
    expect(depois.gasto, "o gasto do plano somou a assinatura da plataforma").toBe(antes.plano.gasto);
    expect(depois.conversas, "a franquia contou um contato atendido pela assinatura da plataforma").toBe(antes.plano.conversas);
  });

  it("o statement do orçamento da empresa (SQL_ORCAMENTO) lê o mesmo gasto, sem a assinatura da plataforma", () => {
    const lido = sql(
      SQL_ORCAMENTO.replace(/\$1/g, `'${ORG}'::uuid`).replace(/\$2/g, `'${AVISO_TITULO}'`).replace(/\$3/g, `'${AVISO_CORPO}'`),
    ).split("|");
    // A 5ª coluna do statement é o gasto.
    expect(Number(lido[4])).toBe(gastoDoMes(ORG));
  });

  it("controle: linha plataforma mexe nas três somas", () => {
    const antes = { doMes: gastoDoMes(ORG), contador: contadorDoOrcamento(ORG), plano: Number(iaDoPlano(ORG).gasto) };
    gravar(ORG, { cents: 11, origem: "plataforma" });
    expect(gastoDoMes(ORG)).toBe(antes.doMes + 11);
    expect(contadorDoOrcamento(ORG)).toBe(antes.contador + 11);
    expect(Number(iaDoPlano(ORG).gasto)).toBe(antes.plano + 11);
  });

  it("⭐ linha cliente soma no orçamento da EMPRESA (a regra de sempre) e NÃO soma no teto do plano", () => {
    const antes = { doMes: gastoDoMes(ORG), contador: contadorDoOrcamento(ORG), plano: iaDoPlano(ORG) };
    gravar(ORG, { cents: 900, origem: "cliente", contato: contato(5) });
    expect(gastoDoMes(ORG)).toBe(antes.doMes + 900);
    expect(contadorDoOrcamento(ORG)).toBe(antes.contador + 900);
    const depois = iaDoPlano(ORG);
    expect(depois.gasto, "o teto do plano somou a chave do cliente").toBe(antes.plano.gasto);
    expect(depois.conversas, "a franquia contou uma conversa paga pela chave do cliente").toBe(antes.plano.conversas);
  });
});

describe("a franquia: contatos distintos atendidos por um agente, com a chave da plataforma", () => {
  it("⭐ o mesmo contato conta uma vez; contato novo conta; erro, chamada sem contato e ponto que não é conversa não contam", () => {
    const antes = Number(iaDoPlano(ORG).conversas); // contato(1), do caso acima
    gravar(ORG, { origem: "plataforma", contato: contato(1) });
    gravar(ORG, { origem: "plataforma", contato: contato(1), purpose: "followup_turn" });
    expect(Number(iaDoPlano(ORG).conversas), "o mesmo contato contou duas vezes").toBe(antes);

    gravar(ORG, { origem: "plataforma", contato: contato(2), purpose: "bot_respond" });
    expect(Number(iaDoPlano(ORG).conversas)).toBe(antes + 1);

    gravar(ORG, { origem: "plataforma", contato: contato(3), status: "erro" });
    gravar(ORG, { origem: "plataforma", contato: null });
    gravar(ORG, { origem: "plataforma", contato: contato(3), purpose: "stage_classifier" });
    gravar(ORG, { origem: "plataforma", contato: contato(3), purpose: "jailbreak_detect" });
    expect(Number(iaDoPlano(ORG).conversas), "contou o que não é conversa atendida").toBe(antes + 1);
  });

  it("o contato já contado está na franquia; o novo, não; e a chave do cliente não põe ninguém nela", () => {
    const ja = (c: string) => valor(comoServidor(`select public.fn_contato_na_franquia('${ORG}', '${c}')`));
    expect(ja(contato(1))).toBe("t");
    expect(ja(contato(2))).toBe("t");
    expect(ja(contato(4))).toBe("f");
    expect(ja(contato(5)), "contato atendido só pela chave do cliente entrou na franquia").toBe("f");
    expect(valor(comoServidor(`select public.fn_contato_na_franquia('${ORG}', null)`))).toBe("f");
  });

  it("a função devolve o teto e a franquia do plano da empresa", () => {
    expect(iaDoPlano(ORG)).toMatchObject({ com_assinatura: "t", teto: "1200", franquia: "3" });
  });
});

describe("o ciclo", () => {
  it("⭐ assinatura mensal em período pago: o ciclo é o período, e o que veio antes dele não conta", () => {
    expect(iaDoPlano(ORG).pelo_periodo_pago).toBe("true");
    const antes = iaDoPlano(ORG);
    // 15 dias atrás: dentro do mês-calendário pode até estar, mas é ANTES do período pago.
    gravar(ORG, { cents: 400, origem: "plataforma", contato: contato(4), em: "now() - interval '15 days'" });
    const depois = iaDoPlano(ORG);
    expect(depois.gasto, "somou gasto de antes do período pago").toBe(antes.gasto);
    expect(depois.conversas, "contou conversa de antes do período pago").toBe(antes.conversas);
    expect(valor(comoServidor(`select (inicio = a.periodo_pago_desde and fim = a.proximo_vencimento)::text
                                  from public.fn_ciclo_de_ia('${ORG}') c, public.cobranca_assinaturas a
                                 where a.organization_id = '${ORG}'`))).toBe("true");
  });

  it.each([
    ["plano anual", ORG_ANUAL],
    ["teste grátis, sem período pago", ORG_TESTE],
    ["período pago já vencido", ORG_VENCIDA],
    ["empresa sem assinatura", ORG_ISENTA],
  ])("%s: o ciclo é o mês-calendário", (_caso, o) => {
    expect(
      valor(comoServidor(`select (inicio = date_trunc('month', now())
                                 and fim = date_trunc('month', now()) + interval '1 month'
                                 and not pelo_periodo_pago)::text
                            from public.fn_ciclo_de_ia('${o}')`)),
    ).toBe("true");
  });

  it("plano anual: a soma é a do mês, mesmo com o período pago de um ano inteiro gravado", () => {
    gravar(ORG_ANUAL, { cents: 30, origem: "plataforma", contato: contato(7) });
    const anual = iaDoPlano(ORG_ANUAL);
    expect(anual).toMatchObject({ com_assinatura: "t", pelo_periodo_pago: "false", conversas: "1" });
    expect(Number(anual.gasto)).toBe(30);
  });
});

describe("quem a falha fechada alcança, e quem não", () => {
  it("⭐ empresa SEM assinatura: 'sem assinatura', tudo nulo, e nada é somado", () => {
    gravar(ORG_ISENTA, { cents: 999, origem: "plataforma" });
    expect(iaDoPlano(ORG_ISENTA)).toEqual({ com_assinatura: "f", teto: "", franquia: "", gasto: "", conversas: "", pelo_periodo_pago: "" });
  });

  it("⭐ assinatura em plano SEM teto: COM assinatura e teto vazio — é o caso que o motor bloqueia", () => {
    expect(iaDoPlano(ORG_SEM_TETO)).toMatchObject({ com_assinatura: "t", teto: "", franquia: "" });
  });

  it("⭐ cobrança DESLIGADA: toda empresa volta 'sem assinatura', a que tem plano inclusive", () => {
    chaveDeCobranca("desligado");
    try {
      expect(iaDoPlano(ORG).com_assinatura).toBe("f");
      expect(iaDoPlano(ORG_SEM_TETO).com_assinatura).toBe("f");
    } finally {
      chaveDeCobranca("ligado");
    }
    expect(iaDoPlano(ORG).com_assinatura).toBe("t");
  });

  it("o aviso aberto do plano SEM teto não é fechado pelo laço de retorno: ali o bloqueio continua", () => {
    const abertos = (o: string) =>
      numero(`select count(*) from public.agent_inbox_items
               where organization_id = '${o}' and kind = 'budget_exceeded' and ref_kind = 'plano' and status = 'open';`);
    const abrir = (o: string) =>
      sql(`insert into public.agent_inbox_items (organization_id, kind, severity, title, body, ref_kind, ref_id)
           values ('${o}', 'budget_exceeded', 'critical', 't', 'c', 'plano', '${o}');`);
    const rodar = (o: string) => sql(SQL_TETO_DO_PLANO.replace(/\$1/g, `'${o}'::uuid`));
    abrir(ORG_SEM_TETO);
    rodar(ORG_SEM_TETO);
    expect(abertos(ORG_SEM_TETO), "o aviso do plano sem teto foi fechado com a IA ainda bloqueada").toBe(1);
    // Controle: a empresa que ficou sem assinatura tem o aviso fechado.
    abrir(ORG_ISENTA);
    rodar(ORG_ISENTA);
    expect(abertos(ORG_ISENTA)).toBe(0);
  });
});

describe("o aviso de 80%", () => {
  const avisar = (desde: string) =>
    valor(comoServidor(`select public.fn_cobranca_avisar_uso_de_ia('${ORG_AVISO}', 'A 80%', 'corpo', ${desde})::text`));
  const avisos = () =>
    numero(`select count(*) from public.agent_inbox_items
             where organization_id = '${ORG_AVISO}' and kind = 'cobranca' and ref_kind = 'plano';`);

  it("⭐ um por ciclo: o segundo pedido no mesmo ciclo não abre outro, nem com o primeiro fechado à mão", () => {
    const inicioDoCiclo = "date_trunc('month', now())";
    expect(avisar(inicioDoCiclo)).toBe("true");
    expect(avisar(inicioDoCiclo)).toBe("false");
    sql(`update public.agent_inbox_items set status = 'resolved'
          where organization_id = '${ORG_AVISO}' and kind = 'cobranca' and ref_kind = 'plano';`);
    expect(avisar(inicioDoCiclo), "o uso oscilou e o aviso saiu de novo no mesmo ciclo").toBe("false");
    expect(avisos()).toBe(1);
  });

  it("ciclo novo: o aviso do ciclo anterior não cala o deste", () => {
    // O ciclo seguinte começa depois do aviso que já existe.
    expect(avisar("now() + interval '1 second'")).toBe("true");
    expect(avisos()).toBe(2);
  });
});

describe("as funções novas não são alcançáveis de fora", () => {
  const CHAMADAS = [
    `select * from public.fn_ia_do_plano('${ORG}')`,
    `select * from public.fn_ciclo_de_ia('${ORG}')`,
    `select public.fn_contato_na_franquia('${ORG}', '${contato(1)}')`,
    `select public.fn_cobranca_avisar_uso_de_ia('${ORG}', 't', 'c', now())`,
  ];

  it.each(CHAMADAS)("a anon key não executa: %s", (chamada) => {
    expect(erroDe(comoAnon(chamada))).toContain("42501");
  });

  it.each(CHAMADAS)("a sessão de um admin da própria empresa não executa: %s", (chamada) => {
    expect(erroDe(comoUsuario(USUARIO, chamada))).toContain("42501");
  });

  it("controle: o service_role executa", () => {
    expect(erroDe(comoServidor(CHAMADAS[0]!))).toBe("");
  });
});
