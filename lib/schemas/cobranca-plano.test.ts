import { describe, expect, it } from "vitest";

import { edicaoDoPlanoSchema, mensagemDoPrecoMinimo, novoPlanoSchema, PRECO_MINIMO_CENTS } from "./cobranca-plano";

const PLANO = { nome: "Essencial", preco_cents: 5990, intervalo: "mes", trial_dias: 7 } as const;
const recusaDoPreco = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  r.error?.issues.find((i) => i.path[0] === "preco_cents")?.message;

describe("plano de cobrança — moeda (migration 9801)", () => {
  it("aceita EUR e BRL; sem moeda, vale o default do banco (BRL)", () => {
    expect(novoPlanoSchema.safeParse({ ...PLANO, moeda: "EUR" }).success).toBe(true);
    expect(novoPlanoSchema.safeParse({ ...PLANO, moeda: "BRL" }).success).toBe(true);
    const semMoeda = novoPlanoSchema.safeParse(PLANO);
    expect(semMoeda.success && semMoeda.data.moeda).toBe(undefined);
  });

  it("recusa moeda fora do CHECK (USD)", () => {
    expect(novoPlanoSchema.safeParse({ ...PLANO, moeda: "USD" }).success).toBe(false);
    expect(edicaoDoPlanoSchema.safeParse({ moeda: "USD" }).success).toBe(false);
  });

  it("o piso é o mesmo nas duas moedas (500 = R$ 5,00 / € 5,00), e a recusa fala a moeda do plano", () => {
    expect(PRECO_MINIMO_CENTS).toBe(500);
    expect(novoPlanoSchema.safeParse({ ...PLANO, preco_cents: 500, moeda: "EUR" }).success).toBe(true);
    expect(recusaDoPreco(novoPlanoSchema.safeParse({ ...PLANO, preco_cents: 499, moeda: "EUR" }))).toMatch(/^O preço mínimo é 5,00\s€\.$/);
    expect(recusaDoPreco(novoPlanoSchema.safeParse({ ...PLANO, preco_cents: 499, moeda: "BRL" }))).toMatch(/^O preço mínimo é R\$\s5,00: abaixo disso o boleto não sai\.$/);
    expect(recusaDoPreco(novoPlanoSchema.safeParse({ ...PLANO, preco_cents: 499 }))).toMatch(/R\$\s5,00/);
  });

  it("edição parcial sem moeda: a frase neutra (a rota não sabe a moeda pelo corpo)", () => {
    expect(recusaDoPreco(edicaoDoPlanoSchema.safeParse({ preco_cents: 100 }))).toBe(mensagemDoPrecoMinimo());
    expect(edicaoDoPlanoSchema.safeParse({ moeda: "EUR" }).success).toBe(true);
  });
});

describe("plano de cobrança — textos (migration 9803)", () => {
  it("textos e listas vazios viram null; sem eles, nada é inventado", () => {
    const r = novoPlanoSchema.parse({ ...PLANO, descricao_curta: "  ", para_quem: "", destaques: [], limites: null });
    expect(r).toMatchObject({ descricao_curta: null, para_quem: null, destaques: null, limites: null });
    expect(novoPlanoSchema.parse(PLANO)).not.toHaveProperty("descricao_curta");
    expect(edicaoDoPlanoSchema.parse({ como_funciona: "" })).toEqual({ como_funciona: null });
  });

  it("os tetos são os dos CHECKs: 140, 200, 600, 8×120 e 5×200", () => {
    const ok = (corpo: Record<string, unknown>) => edicaoDoPlanoSchema.safeParse(corpo).success;
    expect(ok({ descricao_curta: "a".repeat(140) })).toBe(true);
    expect(ok({ descricao_curta: "a".repeat(141) })).toBe(false);
    expect(ok({ para_quem: "a".repeat(201) })).toBe(false);
    expect(ok({ como_funciona: "a".repeat(601) })).toBe(false);
    expect(ok({ destaques: Array(8).fill("a".repeat(120)) })).toBe(true);
    expect(ok({ destaques: Array(9).fill("a") })).toBe(false);
    expect(ok({ destaques: ["a".repeat(121)] })).toBe(false);
    expect(ok({ limites: Array(5).fill("a".repeat(200)) })).toBe(true);
    expect(ok({ limites: Array(6).fill("a") })).toBe(false);
    expect(ok({ limites: [""] })).toBe(false);
  });

  it("o marcador do Equipe Completa é booleano", () => {
    expect(edicaoDoPlanoSchema.safeParse({ inclui_agentes_arvisx: true }).success).toBe(true);
    expect(edicaoDoPlanoSchema.safeParse({ inclui_agentes_arvisx: "sim" }).success).toBe(false);
  });
});
