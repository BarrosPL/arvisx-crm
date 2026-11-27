import { describe, expect, it, vi } from "vitest";

import {
  CORPO_DO_BLOQUEIO_DO_PLANO,
  decidirTetoDoPlano,
  HANDOFF_REASON_IA_DO_PLANO,
  HANDOFF_REASON_ORCAMENTO,
  lerTetoDoPlano,
  RESUMO_DO_HANDOFF_PELO_PLANO,
  PURPOSES_ISENTOS,
  SQL_TETO_DO_PLANO,
} from "./orcamento";

/**
 * O TETO DE IA DO PLANO (spec da cobrança do revendedor §5, decisão D-9).
 *
 * É o bolso do DONO da instalação, e não a escolha da organização
 * (`ai_budgets`): por isso o `modo 'off'` da org não o desliga, e só a chave da
 * instalação o consulta — a chamada com chave própria é paga pela empresa.
 * As decisões do orçamento da org moram em `tests/unit/orcamento-decisao.test.ts`.
 */
const ESTOURADO = {
  comAssinatura: true,
  tetoUsdCents: 1000,
  gastoUsdCents: 1000,
  franquiaConversas: null,
  conversas: 0,
  contatoJaContado: null,
  origemDaChave: "chave_da_instalacao",
  purpose: "agent_turn",
  chave: "on",
} as const;

/** Dentro do teto em dólar, com a franquia de 300 conversas cheia. */
const FRANQUIA_CHEIA = { ...ESTOURADO, gastoUsdCents: 100, franquiaConversas: 300, conversas: 300 } as const;

describe("decidirTetoDoPlano", () => {
  it("⭐ gasto ≥ teto com a chave da instalação BLOQUEIA", () => {
    expect(decidirTetoDoPlano(ESTOURADO)).toEqual({ acao: "bloquear", porque: "teto_do_plano" });
  });

  it("BYOK nunca bloqueia — a chave própria é paga pela empresa", () => {
    expect(decidirTetoDoPlano({ ...ESTOURADO, origemDaChave: "credencial_da_organizacao" })).toEqual({
      acao: "seguir",
      porque: "chave_da_organizacao",
    });
  });

  it.each(PURPOSES_ISENTOS)("purpose isento %s segue — diagnóstico e guardrail não são cortados", (purpose) => {
    expect(decidirTetoDoPlano({ ...ESTOURADO, purpose }).acao).toBe("seguir");
  });

  it("a chave de emergência 'off' desliga o teto do plano (D-9)", () => {
    expect(decidirTetoDoPlano({ ...ESTOURADO, chave: "off" })).toEqual({
      acao: "seguir",
      porque: "chave_de_emergencia",
    });
  });

  it("a chave 'avisar' NÃO afrouxa o teto do plano — só o 'off' é o interruptor do dono (decisão do dono, 30/09)", () => {
    expect(decidirTetoDoPlano({ ...ESTOURADO, chave: "avisar" }).acao).toBe("bloquear");
  });

  // Tarefa 8, parte 1 (decisão do dono, 25/11/2026). Este caso dizia "sem teto
  // (cobrança desligada, org isenta, plano sem teto) segue", os três juntos. Os
  // dois primeiros continuam seguindo; o terceiro passou a BLOQUEAR.
  it("⭐ empresa sem assinatura (cobrança desligada ou isenta) segue, mesmo sem teto", () => {
    expect(decidirTetoDoPlano({ ...ESTOURADO, comAssinatura: false, tetoUsdCents: null })).toEqual({
      acao: "seguir",
      porque: "sem_assinatura",
    });
  });

  it("⭐ FALHA FECHADA: com assinatura e plano sem teto, a chave da instalação é bloqueada", () => {
    expect(decidirTetoDoPlano({ ...ESTOURADO, tetoUsdCents: null, gastoUsdCents: 0 })).toEqual({
      acao: "bloquear",
      porque: "plano_sem_teto",
    });
  });

  it("plano sem teto: a chave própria, a chave de emergência e o purpose isento seguem", () => {
    const semTeto = { ...ESTOURADO, tetoUsdCents: null } as const;
    expect(decidirTetoDoPlano({ ...semTeto, origemDaChave: "credencial_da_organizacao" }).acao).toBe("seguir");
    expect(decidirTetoDoPlano({ ...semTeto, chave: "off" }).acao).toBe("seguir");
    expect(decidirTetoDoPlano({ ...semTeto, purpose: "connection_test" }).acao).toBe("seguir");
  });

  it("um centavo abaixo do teto segue", () => {
    expect(decidirTetoDoPlano({ ...ESTOURADO, gastoUsdCents: 999 }).porque).toBe("dentro_do_plano");
  });

  it("⭐ franquia cheia e contato novo: bloqueia pela franquia", () => {
    expect(decidirTetoDoPlano({ ...FRANQUIA_CHEIA, contatoJaContado: false })).toEqual({
      acao: "bloquear",
      porque: "franquia_do_plano",
    });
  });

  it("⭐ franquia cheia e contato que já estava nela: segue", () => {
    expect(decidirTetoDoPlano({ ...FRANQUIA_CHEIA, contatoJaContado: true }).acao).toBe("seguir");
  });

  it("franquia cheia e chamada sem contato (ou sem saber): a franquia não barra, só o teto em dólar", () => {
    expect(decidirTetoDoPlano({ ...FRANQUIA_CHEIA, contatoJaContado: null }).acao).toBe("seguir");
    expect(decidirTetoDoPlano({ ...FRANQUIA_CHEIA, contatoJaContado: null, gastoUsdCents: 1000 }).porque).toBe("teto_do_plano");
  });

  it("uma conversa abaixo da franquia: contato novo entra", () => {
    expect(decidirTetoDoPlano({ ...FRANQUIA_CHEIA, conversas: 299, contatoJaContado: false }).acao).toBe("seguir");
  });

  it("o que vier primeiro: teto atingido bloqueia com a franquia com folga, e vice-versa", () => {
    expect(decidirTetoDoPlano({ ...FRANQUIA_CHEIA, conversas: 1, gastoUsdCents: 1000 }).porque).toBe("teto_do_plano");
    expect(decidirTetoDoPlano({ ...FRANQUIA_CHEIA, contatoJaContado: false }).porque).toBe("franquia_do_plano");
  });
});

describe("os textos do plano trazem as duas saídas", () => {
  it.each(["plano_sem_teto", "teto_do_plano", "franquia_do_plano"] as const)(
    "%s: aviso da Central e resumo ao atendente falam em pacote extra e em chave própria, e não em orçamento da empresa",
    (causa) => {
      for (const texto of [CORPO_DO_BLOQUEIO_DO_PLANO[causa], RESUMO_DO_HANDOFF_PELO_PLANO[causa]]) {
        expect(texto).toContain("fale com a ArvisX para contratar um pacote extra");
        expect(texto).toContain("cadastre uma chave de IA própria em IA › Credenciais");
        expect(texto).not.toMatch(/Uso de IA › Orçamento/);
      }
      expect(RESUMO_DO_HANDOFF_PELO_PLANO[causa]).toContain("o lead NÃO pediu atendimento humano");
    },
  );

  it("a razão do handoff do plano é própria, distinta da do orçamento da empresa", () => {
    expect(HANDOFF_REASON_IA_DO_PLANO).toBe("ia_do_plano");
    expect(HANDOFF_REASON_IA_DO_PLANO).not.toBe(HANDOFF_REASON_ORCAMENTO);
  });
});

describe("lerTetoDoPlano", () => {
  const ORG = "33333333-3333-4333-8333-333333333333";

  it("pergunta ao statement só com a organização e coage o numeric do node-pg", async () => {
    const inicio = new Date("2026-11-10T00:00:00Z");
    const fim = new Date("2026-12-10T00:00:00Z");
    const query = vi.fn(async () => ({
      rows: [{ teto: 1000, gasto: "1500.0000", com_assinatura: true, franquia: 300, conversas: 12, ciclo_inicio: inicio, ciclo_fim: fim, pelo_periodo_pago: true }],
    }));
    expect(await lerTetoDoPlano({ query } as never, ORG)).toEqual({
      comAssinatura: true,
      tetoUsdCents: 1000,
      gastoUsdCents: 1500,
      franquiaConversas: 300,
      conversas: 12,
      cicloInicio: inicio,
      cicloFim: fim,
      peloPeriodoPago: true,
    });
    expect(query).toHaveBeenCalledWith(SQL_TETO_DO_PLANO, [ORG]);
  });

  it("empresa sem assinatura: tudo nulo vira 'sem assinatura', teto null e gasto 0", async () => {
    const query = vi.fn(async () => ({ rows: [{ teto: null, gasto: null, com_assinatura: false }] }));
    expect(await lerTetoDoPlano({ query } as never, ORG)).toMatchObject({
      comAssinatura: false,
      tetoUsdCents: null,
      gastoUsdCents: 0,
      franquiaConversas: null,
      conversas: 0,
    });
  });

  it("⭐ erro de banco NUNCA lança: vira 'indisponível' com o SQLSTATE", async () => {
    const query = vi.fn(async () => {
      throw Object.assign(new Error("function public.fn_ia_do_plano(uuid) does not exist"), {
        code: "42883",
      });
    });
    const lido = await lerTetoDoPlano({ query } as never, ORG);
    expect(lido).toEqual({ indisponivel: expect.stringMatching(/^42883: function public\.fn_ia_do_plano/) });
  });

  // Decisão invertida em 25/11/2026: o statement somava `fn_gasto_de_ia_do_mes`
  // (todas as chaves, mês-calendário). Agora quem soma é `fn_ia_do_plano`, só a
  // chave da plataforma e no ciclo — e este caso cobra as duas coisas.
  it("⭐ o statement lê a IA do plano por fn_ia_do_plano, e não soma mais o gasto de todas as chaves", () => {
    expect(SQL_TETO_DO_PLANO).toMatch(/from public\.fn_ia_do_plano\(\$1\)/);
    expect(SQL_TETO_DO_PLANO).not.toMatch(/fn_gasto_de_ia_do_mes/);
    expect(SQL_TETO_DO_PLANO).not.toMatch(/\$2/);
  });

  it("as duas primeiras colunas seguem sendo teto e gasto, nesta ordem", () => {
    expect(SQL_TETO_DO_PLANO).toMatch(/select teto, gasto, com_assinatura,[^;]*from leitura;/);
  });

  it("o plano SEM teto com assinatura não é retratado: ali o bloqueio continua valendo", () => {
    expect(SQL_TETO_DO_PLANO).toMatch(/not \(select com_assinatura from leitura\)/);
    expect(SQL_TETO_DO_PLANO).toMatch(/\(select teto from leitura\) is not null/);
  });
});
