// @vitest-environment node
/**
 * OS FLUXOS DOS GATILHOS: faltou ao compromisso e proposta parada.
 *
 * O que precisa valer:
 *   1. os dois grafos passam nos MESMOS portões da régua (`flowGraphSchema` e
 *      `validateFlowForPublish`) e os gatilhos, no schema do motor;
 *   2. nenhum manda mais mensagens que o `toques_maximos` da empresa;
 *   3. as mensagens são geradas, e a dica não tem ramo, preço nem hora;
 *   4. a regra de proposta parada é uma regra de automação VÁLIDA, com os dias
 *      vindos do perfil e a etapa de proposta enviada como recorte.
 *
 *     pnpm vitest run lib/ai/equipe-pronta/gatilhos/fluxos.test.ts
 */
import { describe, expect, it } from "vitest";

import { configDaEtapaParada, GATILHO_ETAPA_PARADA } from "@/lib/automation/gatilhos-de-tempo";
import { exigeAgente, fluxoPedeAgente } from "@/lib/followup/agent-followup-gate";
import { triggerConfigSchema } from "@/lib/followup/api-schemas";
import { flowGraphSchema } from "@/lib/followup/graph-schema";
import { toquesDoModelo } from "@/lib/followup/modelos";
import { validateFlowForPublish } from "@/lib/followup/validate-publish";
import { perfilSchema } from "@/lib/schemas/equipe-pronta";
import { createAutomationRuleSchema } from "@/lib/schemas/webhooks";

import { NO_DE_INICIO_DA_ESCADA } from "../constantes";
import { grafoDaRegua } from "../regua";
import {
  gatilhoDoFluxoDeFalta,
  gatilhoDoFluxoDePropostaParada,
  grafoDoFluxoDeFalta,
  grafoDoFluxoDePropostaParada,
  regraDePropostaParada,
} from "./fluxos";

const perfil = (recuperacao: Record<string, number> = {}) =>
  perfilSchema.parse({
    negocio: { nome: "Empresa", o_que_faz: "Presta um serviço." },
    atendente: { nome: "Ana" },
    primeiro_passo: { tipo: "humano" },
    recuperacao,
  });

const GRAFOS = [
  ["faltou ao compromisso", grafoDoFluxoDeFalta],
  ["proposta parada", grafoDoFluxoDePropostaParada],
] as const;

const MOEDA = /R\$|US\$|€|\$\s?\d|\b(?:BRL|EUR|USD)\b|\b\d+(?:[.,]\d+)?\s?(?:reais|real|euros?|d[oó]lar(?:es)?)\b/i;
const HORA = /\b\d{1,2}\s?h(?:\d{2})?\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s?horas?\b|(?:^|\s)às\s+\d{1,2}\b/i;
const TERMOS_DE_NICHO = ["clínic", "pacient", "consultório", "tratamento", "procedimento", "imóve", "alun", "curso", "advog"];

describe.each(GRAFOS)("o fluxo de %s", (_nome, grafoDe) => {
  it.each([1, 2, 3, 4])("com %i toque(s): passa no schema e no portão de publicação", (toques) => {
    const grafo = grafoDe(perfil({ toques_maximos: toques }));
    expect(flowGraphSchema.safeParse(grafo).success).toBe(true);
    const validacao = validateFlowForPublish(grafo, { exigeModeloForaDaJanela: false });
    expect(validacao, JSON.stringify(validacao)).toMatchObject({ ok: true });
  });

  it.each([1, 2, 4])("⭐ manda no máximo %i mensagem(ns): o limite de toques da empresa", (toques) => {
    expect(toquesDoModelo(grafoDe(perfil({ toques_maximos: toques })))).toBe(toques);
  });

  it("é a MESMA escada da régua: só a dica ao modelo muda", () => {
    const semDica = (g: ReturnType<typeof grafoDe>) =>
      JSON.stringify(g, (chave, valor) => (chave === "prompt_hint" ? "" : valor));
    const p = perfil({ toques_maximos: 3, intervalo_dias: 4 });
    expect(semDica(grafoDe(p))).toBe(semDica(grafoDaRegua(p)));
    expect(JSON.stringify(grafoDe(p))).not.toBe(JSON.stringify(grafoDaRegua(p)));
  });

  it("nasce no nó que o motor reconhece como 'acabou de nascer' (é onde o limite de toques é conferido)", () => {
    const gatilho = grafoDe(perfil()).nodes.find((n) => n.type === "trigger");
    expect(gatilho?.id).toBe(NO_DE_INICIO_DA_ESCADA);
  });

  it("as mensagens são geradas, pedem agente, e a dica não tem ramo, preço nem hora", () => {
    const grafo = grafoDe(perfil({ toques_maximos: 2 }));
    expect(fluxoPedeAgente(grafo)).toBe(true);
    const dicas = grafo.nodes
      .filter((n) => n.type === "action")
      .map((n) => (n.config as { mode: string; prompt_hint: string }));
    expect(dicas).toHaveLength(2);
    for (const d of dicas) {
      expect(d.mode).toBe("ai_message");
      expect(d.prompt_hint).not.toMatch(MOEDA);
      expect(d.prompt_hint).not.toMatch(HORA);
      for (const termo of TERMOS_DE_NICHO) expect(d.prompt_hint.toLowerCase(), termo).not.toContain(termo);
      expect(d.prompt_hint).toMatch(/desconto/);
    }
  });
});

describe("os gatilhos dos fluxos", () => {
  it("faltou ao compromisso: gatilho `appointment_no_show`, de qualquer tipo de agenda, que exige agente e para na resposta", () => {
    const gatilho = gatilhoDoFluxoDeFalta();
    expect(triggerConfigSchema.safeParse(gatilho).success).toBe(true);
    expect(gatilho).toEqual({ kind: "appointment_no_show", cancel_on_reply: true });
    // Sem agente PUBLICADO que arme o fluxo (pausado pelo plano, por exemplo), ninguém é inscrito.
    expect(exigeAgente(gatilho.kind)).toBe(true);
  });

  it("proposta parada: gatilho `manual` (quem inscreve é a regra), que para na resposta", () => {
    const gatilho = gatilhoDoFluxoDePropostaParada();
    expect(triggerConfigSchema.safeParse(gatilho).success).toBe(true);
    expect(gatilho).toEqual({ kind: "manual", cancel_on_reply: true });
  });
});

describe("a regra de proposta parada", () => {
  const alvo = {
    pipelineId: "33333333-3333-4333-8333-333333333333",
    etapaDePropostaEnviadaId: "88888888-8888-4888-8888-888888888881",
    fluxoId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
  };

  it("⭐ é uma regra de automação válida: `lead.stage_stale` + `start_message_flow`", () => {
    const regra = regraDePropostaParada(perfil(), alvo);
    const lida = createAutomationRuleSchema.safeParse({
      name: regra.name,
      trigger_event: regra.trigger_event,
      trigger_config: regra.trigger_config,
      conditions: regra.conditions,
      actions: regra.actions,
      is_active: regra.is_active,
    });
    expect(lida.success, JSON.stringify(lida.error?.issues)).toBe(true);
    expect(regra.trigger_event).toBe(GATILHO_ETAPA_PARADA);
    expect(regra.actions).toEqual([{ type: "start_message_flow", config: { flow_pointer_id: alvo.fluxoId } }]);
  });

  it("os dias vêm do perfil, e o recorte é o funil e a etapa de proposta enviada da equipe", () => {
    expect(configDaEtapaParada(regraDePropostaParada(perfil(), alvo).trigger_config)).toEqual({
      dias: 5,
      pipeline_id: alvo.pipelineId,
      stage_id: alvo.etapaDePropostaEnviadaId,
      proteger_pela_agenda: true,
    });
    expect(regraDePropostaParada(perfil({ dias_proposta_parada: 9 }), alvo).trigger_config.dias).toBe(9);
  });

  it("não derruba outra sequência que já esteja andando para o contato", () => {
    const config = regraDePropostaParada(perfil(), alvo).actions[0].config as Record<string, unknown>;
    expect(config.replace_live_flow).toBeUndefined();
  });
});
