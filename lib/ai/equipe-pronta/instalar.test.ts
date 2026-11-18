import { describe, expect, it } from "vitest";

import { perfilSchema } from "@/lib/schemas/equipe-pronta";
import {
  canalEstaEmProducao,
  EquipeProntaError,
  memoriaComOBloco,
  recusaAntesDeInstalar,
  resumoDoNegocio,
  textoDaBase,
} from "./instalar";

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

/**
 * CANAL EM PRODUÇÃO (revisão do PR #8, rodada 3).
 *
 * O ensaio fecha o número inteiro. Um agente publicado direto no canal, sem
 * roteador, parava de atender clientes sem aviso nenhum. A leitura do canal é
 * provada no banco (`tests/invariants/equipe-pronta-instalar.test.ts`); aqui
 * fica a decisão.
 */
describe("a recusa de antes de instalar", () => {
  const nada = { forcar: false, editados: [], roteador: null, canal: null };
  const agenteProprio = { agentes: [{ agent_id: "a1", nome: "Agente do cliente" }], conversas_recentes: 0 };
  const roteador = {
    id: "r1",
    nome: "Roteador do cliente",
    de_fora: true,
    fallback_de_fora: { agent_id: "a1", nome: "Agente do cliente" },
    membros_de_fora: [],
  };

  it("⭐ canal aberto com agente próprio: 409 canal_em_producao, com os agentes e a contagem", () => {
    const recusa = recusaAntesDeInstalar({ ...nada, canal: agenteProprio });

    expect(recusa).toBeInstanceOf(EquipeProntaError);
    expect(recusa).toMatchObject({ codigo: "canal_em_producao", status: 409 });
    expect(recusa!.detalhes).toEqual({ canal: agenteProprio });
    // A frase é a que a tela mostra: diz o que acontece e o que fazer.
    expect(recusa!.message).toContain("Este WhatsApp já atende clientes.");
    expect(recusa!.message).toContain("a IA só responde os números de teste");
  });

  it("sem agente próprio, mas com conversa recente respondida pela IA: também recusa", () => {
    const canal = { agentes: [], conversas_recentes: 3 };

    expect(recusaAntesDeInstalar({ ...nada, canal })).toMatchObject({
      codigo: "canal_em_producao",
      detalhes: { canal },
    });
  });

  it("⭐ com `forcar`: instala — nenhuma das três recusas", () => {
    expect(
      recusaAntesDeInstalar({
        forcar: true,
        editados: [{ papel: "sdr", agent_id: "s1" }],
        roteador,
        canal: agenteProprio,
      }),
    ).toBeNull();
  });

  it("⭐ canal novo: instala sem perguntar", () => {
    expect(recusaAntesDeInstalar(nada)).toBeNull();
    // Canal aberto em que a IA não atende ninguém também é canal novo.
    expect(recusaAntesDeInstalar({ ...nada, canal: { agentes: [], conversas_recentes: 0 } })).toBeNull();
    expect(canalEstaEmProducao({ agentes: [], conversas_recentes: 0 })).toBe(false);
  });

  it("as três listas saem na MESMA recusa, e o código é o do primeiro motivo", () => {
    const editados = [{ papel: "sdr", agent_id: "s1" }];

    const tudo = recusaAntesDeInstalar({ forcar: false, editados, roteador, canal: agenteProprio });
    expect(tudo).toMatchObject({ codigo: "agentes_editados_a_mao", status: 409 });
    expect(Object.keys(tudo!.detalhes!).sort()).toEqual(["agentes", "canal", "roteador"]);
    expect(tudo!.detalhes).toMatchObject({ agentes: editados, roteador: { id: "r1" }, canal: agenteProprio });

    const semEditados = recusaAntesDeInstalar({ ...nada, roteador, canal: agenteProprio });
    expect(semEditados).toMatchObject({ codigo: "canal_com_roteador" });
    expect(Object.keys(semEditados!.detalhes!).sort()).toEqual(["canal", "roteador"]);
  });

  it("recusa que não tem a ver com o canal não leva a chave `canal`", () => {
    const recusa = recusaAntesDeInstalar({ ...nada, editados: [{ papel: "sdr", agent_id: "s1" }] });

    expect(recusa!.detalhes).toEqual({ agentes: [{ papel: "sdr", agent_id: "s1" }] });
  });
});
