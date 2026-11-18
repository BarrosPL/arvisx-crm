import { describe, expect, it } from "vitest";

import { perfilSchema } from "@/lib/schemas/equipe-pronta";
import { memoriaComOBloco, resumoDoNegocio, textoDaBase } from "./instalar";

/**
 * AS PARTES PURAS DO INSTALADOR.
 *
 * A instalação inteira — as peças criadas, a idempotência, a recusa por edição
 * à mão — é provada contra um Postgres de verdade em
 * `tests/invariants/equipe-pronta-instalar.test.ts`. Aqui fica o que não
 * precisa de banco: o que vai para a memória e para a base de conhecimento.
 */
const perfil = (extra: Record<string, unknown> = {}) =>
  perfilSchema.parse({
    negocio: { nome: "Empresa", o_que_faz: "Presta um serviço.", cidade: "Curitiba, PR" },
    atendente: { nome: "Ana" },
    primeiro_passo: { tipo: "humano" },
    ...extra,
  });

describe("a memória da organização", () => {
  const resumo = resumoDoNegocio(perfil());

  it("o resumo tem o negócio, e nada de preço ou horário", () => {
    expect(resumo).toContain("Empresa: Empresa.");
    expect(resumo).toContain("O que faz: Presta um serviço.");
    expect(resumo).toContain("Onde: Curitiba, PR.");
    expect(resumo).not.toMatch(/R\$|€|\b\d{1,2}h\b/);
  });

  it("⭐ a memória que a empresa já tinha é PRESERVADA: o bloco entra no fim", () => {
    const daEmpresa = "Nunca atendemos aos domingos.\nNosso diferencial é o prazo.";
    const nova = memoriaComOBloco(daEmpresa, resumo);
    expect(nova.startsWith(daEmpresa)).toBe(true);
    expect(nova).toContain(resumo);
  });

  it("reinstalar TROCA o bloco, em vez de empilhar um segundo", () => {
    const primeira = memoriaComOBloco("Texto da empresa.", resumo);
    const outroResumo = resumoDoNegocio(perfil({ negocio: { nome: "Outro nome", o_que_faz: "Outra coisa." } }));
    const segunda = memoriaComOBloco(primeira, outroResumo);

    expect(segunda).toContain("Texto da empresa.");
    expect(segunda).toContain("Outro nome");
    expect(segunda).not.toContain("Empresa: Empresa.");
    expect(segunda.match(/equipe-pronta:inicio/g)).toHaveLength(1);
  });

  it("⭐ mesmo resumo = mesmo texto: é o que impede uma versão de memória por instalação", () => {
    const primeira = memoriaComOBloco("Texto da empresa.", resumo);
    expect(memoriaComOBloco(primeira, resumo)).toBe(primeira);
  });

  it("o que a empresa escreveu DEPOIS do bloco também fica", () => {
    const primeira = memoriaComOBloco("Antes.", resumo);
    const editada = `${primeira}\n\nEscrito depois, pela empresa.`;
    const segunda = memoriaComOBloco(editada, resumo);
    expect(segunda).toContain("Antes.");
    expect(segunda).toContain("Escrito depois, pela empresa.");
  });

  it("empresa sem memória: fica só o bloco", () => {
    expect(memoriaComOBloco("", resumo)).toContain(resumo);
    expect(memoriaComOBloco("   ", resumo).startsWith("<!-- equipe-pronta:inicio -->")).toBe(true);
  });
});

describe("o texto da base de conhecimento", () => {
  it("junta as formas de pagamento e as perguntas frequentes", () => {
    const texto = textoDaBase(
      perfil({ regras: { formas_de_pagamento: "Pix e cartão." }, faq: { texto: "Atendemos de segunda a sexta." } }),
    );
    expect(texto).toContain("## Formas de pagamento\n\nPix e cartão.");
    expect(texto).toContain("## Perguntas frequentes e políticas\n\nAtendemos de segunda a sexta.");
  });

  it("⭐ sem nada respondido, é vazio — o instalador não cria fonte vazia", () => {
    expect(textoDaBase(perfil())).toBe("");
    expect(textoDaBase(perfil({ faq: { texto: "   " } }))).toBe("");
  });

  it("com um só dos dois, traz só ele", () => {
    const texto = textoDaBase(perfil({ faq: { texto: "Só perguntas." } }));
    expect(texto).toBe("## Perguntas frequentes e políticas\n\nSó perguntas.");
  });
});
