/**
 * O lado TS da regra do doc 146 (opção B) que as telas de cadastro usam: o
 * Google some (e o seletor é obrigatório) exatamente quando o gatilho da 0679
 * recusaria um cadastro sem escolha. O lado do banco é
 * `tests/invariants/cobranca-entrada-paga-na-criacao.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ ligado: vi.fn(async () => true) }));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: h.ligado }));

import { lerCadastroNaTela, planoInicialDoSeletor, planosDoSeletor, type PlanoDoCadastro } from "./cadastro";

const plano = (id: string): PlanoDoCadastro => ({ id, nome: id, preco_cents: 4990, moeda: "BRL", intervalo: "mes", trial_dias: 7 });

function banco(p: { oferecidos: PlanoDoCadastro[]; padrao: string | null; erro?: boolean; trialDoPadrao?: number }) {
  return {
    from: () => {
      const q = {
        select: () => q,
        is: () => q,
        eq: () => q,
        order: async () => (p.erro ? { data: null, error: { code: "57014" } } : { data: p.oferecidos, error: null }),
        maybeSingle: async () => ({ data: p.padrao ? { id: p.padrao, trial_dias: p.trialDoPadrao ?? 14 } : null, error: null }),
      };
      return q;
    },
  } as never;
}

beforeEach(() => h.ligado.mockResolvedValue(true));

describe("lerCadastroNaTela — quando o Google some", () => {
  it("⭐ sem plano nenhum (nem padrão, nem oferecido): nada a escolher e o Google fica — a empresa nasce isenta", async () => {
    expect(await lerCadastroNaTela(banco({ oferecidos: [], padrao: null }))).toEqual({
      oferecidos: [], padraoId: null, exigeEscolha: false, mostraSeletor: false, diasDeTesteSemEscolha: null,
    });
  });

  it("⭐ plano oferecido e sem padrão: o Google some e a escolha é obrigatória", async () => {
    expect((await lerCadastroNaTela(banco({ oferecidos: [plano("a")], padrao: null }))).exigeEscolha).toBe(true);
  });

  it("⭐ com padrão: o Google fica (a empresa dele nasce no padrão)", async () => {
    expect((await lerCadastroNaTela(banco({ oferecidos: [plano("a")], padrao: "p" }))).exigeEscolha).toBe(false);
  });

  it("cobrança desligada, ou leitura que falha: a tela não esconde nem exige nada (quem recusa é a action)", async () => {
    expect((await lerCadastroNaTela(banco({ oferecidos: [plano("a")], padrao: null, erro: true }))).exigeEscolha).toBe(false);
    h.ligado.mockResolvedValue(false);
    expect((await lerCadastroNaTela(banco({ oferecidos: [plano("a")], padrao: null }))).exigeEscolha).toBe(false);
  });
});

describe("⭐ plano de entrada (o \"Teste\", etapa 3): o cadastro não mostra seletor e a empresa cai no padrão", () => {
  const TRES = [plano("essencial"), plano("standard"), plano("premium")];

  it("⭐ Teste padrão e NÃO oferecido + três oferecidos: sem seletor, sem escolha exigida, o Google fica e a tela diz os 7 dias", async () => {
    const cadastro = await lerCadastroNaTela(banco({ oferecidos: TRES, padrao: "teste", trialDoPadrao: 7 }));
    expect(cadastro).toMatchObject({ mostraSeletor: false, exigeEscolha: false, padraoId: "teste", diasDeTesteSemEscolha: 7 });
    // A tela lista nada; o formulário não manda `cobranca_plan_id`, e o gatilho
    // (`fn_trial_na_criacao_da_org`, 0679) cai no padrão: "sem escolha, o padrão".
    expect(planosDoSeletor(cadastro)).toEqual([]);
    expect(planoInicialDoSeletor(planosDoSeletor(cadastro), cadastro.padraoId)).toBeUndefined();
  });

  it("padrão entre os oferecidos: o seletor continua (como antes), com o padrão marcado", async () => {
    const cadastro = await lerCadastroNaTela(banco({ oferecidos: TRES, padrao: "standard" }));
    expect(cadastro).toMatchObject({ mostraSeletor: true, diasDeTesteSemEscolha: null });
    expect(planoInicialDoSeletor(planosDoSeletor(cadastro), cadastro.padraoId)).toBe("standard");
  });

  it("sem padrão e com oferecidos: o seletor é obrigatório (como antes)", async () => {
    const cadastro = await lerCadastroNaTela(banco({ oferecidos: TRES, padrao: null }));
    expect(cadastro).toMatchObject({ mostraSeletor: true, exigeEscolha: true });
    expect(planosDoSeletor(cadastro)).toHaveLength(3);
  });

  it("só o Teste (nenhum oferecido): sem seletor, e a frase dos dias aparece", async () => {
    expect(await lerCadastroNaTela(banco({ oferecidos: [], padrao: "teste", trialDoPadrao: 7 }))).toMatchObject({
      mostraSeletor: false, diasDeTesteSemEscolha: 7,
    });
  });
});

describe("planoInicialDoSeletor", () => {
  it("vem marcado o PADRÃO quando ele é oferecido — não o mais barato", () => {
    expect(planoInicialDoSeletor([plano("barato"), plano("padrao")], "padrao")).toBe("padrao");
  });
  it("padrão fora dos oferecidos (ou sem padrão): o primeiro", () => {
    expect(planoInicialDoSeletor([plano("barato"), plano("outro")], "negociado")).toBe("barato");
    expect(planoInicialDoSeletor([], null)).toBeUndefined();
  });
});
