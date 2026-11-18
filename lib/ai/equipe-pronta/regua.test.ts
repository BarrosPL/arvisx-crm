import { describe, expect, it } from "vitest";

import { triggerConfigSchema } from "@/lib/followup/api-schemas";
import { flowGraphSchema } from "@/lib/followup/graph-schema";
import { toquesDoModelo } from "@/lib/followup/modelos";
import { validateFlowForPublish } from "@/lib/followup/validate-publish";
import { perfilSchema } from "@/lib/schemas/equipe-pronta";
import { gatilhoDaRegua, grafoDaRegua, hashDaRegua } from "./regua";

/**
 * A RÉGUA DO RECUPERADOR — o fluxo de follow-up que a equipe pronta instala.
 *
 * O que precisa valer para ela ser publicável e fiel ao questionário:
 *   1. o grafo passa nos MESMOS dois portões da rota de instalar modelo
 *      (`flowGraphSchema` e `validateFlowForPublish`), para todo valor que o
 *      questionário aceita;
 *   2. o número de mensagens é o `toques_maximos` da empresa — nunca mais;
 *   3. as mensagens são GERADAS (`ai_message`), sem texto fixo, e a dica ao
 *      modelo não tem ramo, preço nem hora;
 *   4. lead frio fica de fora pelo próprio gatilho (só silêncio recente).
 */
const perfil = (recuperacao: Record<string, number> = {}) =>
  perfilSchema.parse({
    negocio: { nome: "Empresa", o_que_faz: "Presta um serviço." },
    atendente: { nome: "Ana" },
    primeiro_passo: { tipo: "humano" },
    recuperacao,
  });

describe("o grafo da régua", () => {
  it.each([1, 2, 3, 4])("com %i toque(s): passa no schema e no portão de publicação", (toques) => {
    const grafo = grafoDaRegua(perfil({ toques_maximos: toques }));

    expect(flowGraphSchema.safeParse(grafo).success).toBe(true);
    // Canal sem a regra da janela de 24 h (o WhatsApp por QR): é o contexto que
    // a rota de publicar passa quando nenhuma conexão exige modelo aprovado.
    const validacao = validateFlowForPublish(grafo, { exigeModeloForaDaJanela: false });
    expect(validacao, JSON.stringify(validacao)).toMatchObject({ ok: true });
  });

  it("limite conhecido: em canal que exige modelo aprovado fora da janela, só a 1ª mensagem passa", () => {
    // A mensagem gerada depois de 24 h de espera precisa de um modelo aprovado
    // de reserva nesses canais, e a régua da equipe pronta não leva um. O único
    // erro é esse, e só da segunda mensagem em diante — nada mais no grafo.
    const validacao = validateFlowForPublish(grafoDaRegua(perfil({ toques_maximos: 3 })));
    expect(validacao.ok).toBe(false);
    if (validacao.ok) return;
    expect(validacao.errors.map((e) => [e.node_id, e.code])).toEqual([
      ["msg-2", "long_wait_needs_template"],
      ["msg-3", "long_wait_needs_template"],
    ]);
    expect(validateFlowForPublish(grafoDaRegua(perfil({ toques_maximos: 1 })))).toMatchObject({ ok: true });
  });

  it.each([1, 2, 4])("manda exatamente %i mensagem(ns) no pior caso — o limite da empresa", (toques) => {
    expect(toquesDoModelo(grafoDaRegua(perfil({ toques_maximos: toques })))).toBe(toques);
  });

  it("o padrão são 2 toques (decisão P-04)", () => {
    expect(toquesDoModelo(grafoDaRegua(perfil()))).toBe(2);
  });

  it("toda mensagem é gerada, nunca texto fixo", () => {
    const acoes = grafoDaRegua(perfil({ toques_maximos: 3 })).nodes.filter((n) => n.type === "action");
    expect(acoes).toHaveLength(3);
    for (const acao of acoes) {
      expect(acao.config).toMatchObject({ mode: "ai_message" });
      expect(acao.config).not.toHaveProperty("body");
    }
  });

  it("a dica ao modelo não tem ramo, preço nem hora — e proíbe desconto e valor de memória", () => {
    const dicas = grafoDaRegua(perfil({ toques_maximos: 2 }))
      .nodes.filter((n) => n.type === "action")
      .map((n) => (n.config as { prompt_hint: string }).prompt_hint);
    for (const dica of dicas) {
      expect(dica).not.toMatch(/R\$|€|\breais\b|\b\d{1,2}h\b|\b\d{1,2}:\d{2}\b/i);
      expect(dica.toLowerCase()).not.toMatch(/clínic|pacient|imóve|alun|advog|cidadania|consulta/);
      expect(dica).toContain("não ofereça desconto");
      expect(dica).toContain("não escreva valor nem data de memória");
    }
    // A segunda mensagem não repete a dica da primeira.
    expect(new Set(dicas).size).toBe(2);
  });

  it("o intervalo entre as mensagens é o da empresa", () => {
    const esperas = grafoDaRegua(perfil({ toques_maximos: 3, intervalo_dias: 5 })).nodes.filter(
      (n) => n.type === "wait",
    );
    expect(esperas).toHaveLength(2);
    for (const e of esperas) expect(e.config).toEqual({ mode: "fixed", duration_ms: 5 * 86_400_000 });
  });
});

describe("o gatilho da régua", () => {
  it("passa no schema de gatilho, para todo valor que o questionário aceita", () => {
    for (const dias of [1, 3, 6]) {
      expect(triggerConfigSchema.safeParse(gatilhoDaRegua(perfil({ dias_para_esfriar: dias }))).success).toBe(true);
    }
  });

  it("começa depois dos dias da empresa, só para quem a equipe já respondeu, e para na resposta", () => {
    expect(gatilhoDaRegua(perfil({ dias_para_esfriar: 3 }))).toEqual({
      kind: "silence",
      params: { threshold_minutes: 3 * 1440, max_silence_minutes: 10_080, exige_resposta_da_equipe: true },
      cancel_on_reply: true,
    });
  });

  it("⭐ lead frio fica de fora: o gatilho só alcança silêncio de até 7 dias", () => {
    const g = gatilhoDaRegua(perfil({ dias_para_esfriar: 6, limite_lead_frio_dias: 30 }));
    if (g.kind !== "silence") throw new Error("gatilho inesperado");
    expect(g.params.max_silence_minutes).toBe(7 * 1440);
    // O limiar fica abaixo do teto: sempre sobra janela para a régua começar.
    expect(g.params.threshold_minutes).toBeLessThan(g.params.max_silence_minutes!);
  });
});

describe("o hash da régua", () => {
  it("é estável para o mesmo perfil e muda com o que muda a régua", () => {
    expect(hashDaRegua(perfil())).toBe(hashDaRegua(perfil()));
    expect(hashDaRegua(perfil({ toques_maximos: 3 }))).not.toBe(hashDaRegua(perfil()));
    expect(hashDaRegua(perfil({ intervalo_dias: 4 }))).not.toBe(hashDaRegua(perfil()));
    expect(hashDaRegua(perfil({ dias_para_esfriar: 5 }))).not.toBe(hashDaRegua(perfil()));
  });

  it("não muda com o que não é da régua (o limite de lead frio é regra do agente)", () => {
    expect(hashDaRegua(perfil({ limite_lead_frio_dias: 90 }))).toBe(hashDaRegua(perfil()));
  });
});
