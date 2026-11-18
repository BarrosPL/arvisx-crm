import { describe, expect, it } from "vitest";

import {
  BLOCOS_DO_QUESTIONARIO,
  BLOCOS_OBRIGATORIOS,
  oQueFaltaNoRascunho,
  rascunhoSchema,
  salvarPerfilSchema,
} from "@/lib/schemas/equipe-pronta";
import {
  PASSOS_DO_QUESTIONARIO,
  passosComPendencia,
  primeiroPassoPendente,
  respostasDoPasso,
  semVazios,
} from "./questionario";

/**
 * O QUESTIONÁRIO EM PASSOS — o que a tela manda ao salvar cada passo.
 *
 * O PUT junta por bloco: o que vai substitui o bloco inteiro. As duas formas de
 * errar aqui são silenciosas — um bloco que nenhum passo pergunta nunca é
 * salvo, e um passo que manda bloco de outro apaga respostas.
 */
describe("os passos cobrem o perfil", () => {
  it("⭐ todo bloco do questionário, e o `onde`, está em exatamente um passo", () => {
    const perguntados = PASSOS_DO_QUESTIONARIO.flatMap((p) => p.blocos);
    expect([...perguntados].sort()).toEqual([...BLOCOS_DO_QUESTIONARIO, "onde"].sort());
    expect(new Set(perguntados).size).toBe(perguntados.length);
  });

  it("os blocos sem padrão estão em passos marcados como obrigatórios", () => {
    for (const bloco of BLOCOS_OBRIGATORIOS) {
      const passo = PASSOS_DO_QUESTIONARIO.find((p) => p.blocos.includes(bloco));
      expect(passo?.obrigatorio, bloco).toBe(true);
    }
  });
});

describe("semVazios", () => {
  it("texto em branco, item em branco e null viram ausência; false e 0 ficam", () => {
    expect(
      semVazios({ a: "  ", b: " x ", c: ["", "y", "  "], d: false, e: 0, f: null, g: { h: "" } }),
    ).toEqual({ b: "x", c: ["y"], d: false, e: 0, g: {} });
  });
});

describe("respostasDoPasso", () => {
  const formulario = {
    negocio: { nome: "Clínica Sorriso", o_que_faz: "Odontologia", cidade: "" },
    atendente: { nome: "Bia" },
    primeiro_passo: { tipo: "agendar" as const },
    faq: { texto: "Atendemos de segunda a sexta." },
  };

  it("⭐ manda só os blocos do passo, e nenhum de outro", () => {
    expect(Object.keys(respostasDoPasso("negocio", formulario))).toEqual(["negocio"]);
    expect(Object.keys(respostasDoPasso("venda", formulario)).sort()).toEqual([
      "oferta",
      "primeiro_passo",
      "proposta",
    ]);
  });

  it("campo esvaziado some do bloco (e o bloco substituído deixa de tê-lo)", () => {
    expect(respostasDoPasso("negocio", formulario)).toEqual({
      negocio: { nome: "Clínica Sorriso", o_que_faz: "Odontologia" },
    });
  });

  it("⭐ o corpo de TODO passo passa no schema do PUT, até com o formulário vazio", () => {
    for (const passo of PASSOS_DO_QUESTIONARIO) {
      for (const f of [formulario, {}]) {
        const corpo = { respostas: respostasDoPasso(passo.id, f) };
        expect(salvarPerfilSchema.safeParse(corpo).success, passo.id).toBe(true);
      }
    }
  });

  it("união pela metade não vai: agenda a criar sem nome, desconto sem percentual", () => {
    const pelaMetade = {
      primeiro_passo: { tipo: "agendar" as const, agenda: { modo: "criar" as const, nome: "" } },
      regras: { desconto: { modo: "com_aprovacao" as const }, formas_de_pagamento: "Pix" },
    };
    expect(respostasDoPasso("venda", pelaMetade as never).primeiro_passo).toEqual({ tipo: "agendar" });
    expect(respostasDoPasso("regras", pelaMetade as never).regras).toEqual({ formas_de_pagamento: "Pix" });
    expect(rascunhoSchema.safeParse(respostasDoPasso("venda", pelaMetade as never)).success).toBe(true);
  });

  it("união inteira vai como está", () => {
    const inteiro = {
      primeiro_passo: {
        tipo: "agendar" as const,
        agenda: { modo: "criar" as const, nome: "Avaliação", duracao_minutos: 30, pago: false },
      },
      regras: { desconto: { modo: "com_aprovacao" as const, ate_percentual: 10 } },
    };
    expect(respostasDoPasso("venda", inteiro).primeiro_passo).toEqual(inteiro.primeiro_passo);
    expect(respostasDoPasso("regras", inteiro).regras).toEqual(inteiro.regras);
  });

  it("⭐ os três passos obrigatórios respondidos formam um perfil instalável", () => {
    const salvo = {
      ...respostasDoPasso("negocio", formulario),
      ...respostasDoPasso("atendente", formulario),
      ...respostasDoPasso("venda", formulario),
    };
    expect(oQueFaltaNoRascunho(salvo).ok).toBe(true);
  });
});

describe("pendências por passo", () => {
  it("o que falta aponta para o passo que pergunta", () => {
    const lido = oQueFaltaNoRascunho({ negocio: { nome: "Só o nome" } });
    expect(lido.ok).toBe(false);
    const faltam = lido.ok ? [] : lido.faltam;
    expect(passosComPendencia(faltam)).toEqual(["negocio", "atendente", "venda"]);
    expect(primeiroPassoPendente(faltam)).toBe("negocio");
  });

  it("sem pendência, não há passo a abrir", () => {
    expect(primeiroPassoPendente([])).toBeNull();
  });
});
