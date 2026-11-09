/**
 * A recusa do plano menor que o uso (ArvisX, etapa 3): diz o número, nunca
 * desconecta nada. "Você tem 5 números conectados, o plano permite 3: desconecte 2."
 */
import { describe, expect, it } from "vitest";

import { excessoDosDetalhes, itensDoExcesso, preencherFrase } from "./excesso";

describe("o excesso de uso, em frase", () => {
  it("⭐ 5 canais e 7 pessoas contra 3 e 5: lista os dois, canais primeiro, com uso, teto e quanto tirar", () => {
    const itens = itensDoExcesso({ canais: 2, assentos: 2 }, { canais: 5, assentos: 7 }, { canais: 3, assentos: 5 });
    expect(itens.map((i) => preencherFrase(i.frase, i))).toEqual([
      "Você tem 5 números conectados, o plano permite 3: desconecte 2 em Conexões.",
      "Você tem 7 pessoas na equipe, o plano permite 5: revogue o acesso de 2 em Equipe.",
    ]);
  });

  it("cabe (ou o plano não tem teto): nada a dizer", () => {
    expect(itensDoExcesso({}, { canais: 5, assentos: 7 }, { canais: 3, assentos: 5 })).toEqual([]);
    expect(itensDoExcesso({ canais: 2 }, { canais: 5, assentos: 1 }, { canais: null, assentos: null })).toEqual([]);
  });

  it("lê o details do 409 do Assinar; sem uso e teto (a troca antiga), null: a tela cai na frase antiga", () => {
    const itens = excessoDosDetalhes({ excedente: { canais: 2 }, uso: { canais: 5, assentos: 1 }, limites: { canais: 3, assentos: 5 } });
    expect(itens?.map((i) => preencherFrase(i.frase, i))).toEqual(["Você tem 5 números conectados, o plano permite 3: desconecte 2 em Conexões."]);
    expect(excessoDosDetalhes({ excedente: { canais: 2 } })).toBeNull();
    expect(excessoDosDetalhes(null)).toBeNull();
  });
});
