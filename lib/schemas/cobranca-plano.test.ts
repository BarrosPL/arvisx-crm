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
