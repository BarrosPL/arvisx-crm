/**
 * OS FLUXOS DOS GATILHOS — o que acorda a Recuperação sem o cliente escrever.
 *
 * Nenhum motor novo. Os dois gatilhos abaixo são CONFIGURAÇÃO que a instalação
 * grava, em cima do que o produto já roda:
 *
 *   • FALTOU AO COMPROMISSO (`appointment_no_show`)
 *     Um fluxo de follow-up com o gatilho `appointment_no_show`, armado pelo
 *     agente de Recuperação. Quem inscreve o contato é `fn_appointment_recover`
 *     (o consumidor de `appointment.outcome_confirmed` que já existia): a falta
 *     registrada pela tela ou por `crm_set_appointment_outcome` chega aqui.
 *
 *   • PROPOSTA PARADA (`lead.stage_stale` na etapa de proposta enviada)
 *     Uma regra de automação com o gatilho de tempo `lead.stage_stale` (a
 *     varredura `lead-time-triggers`, de hora em hora, uma vez por entrada na
 *     etapa) e a ação `start_message_flow`, que inscreve o contato num segundo
 *     fluxo de follow-up, de gatilho `manual`, também armado pela Recuperação.
 *
 * Os dois fluxos são a MESMA escada da régua de silêncio (`regua.ts`): no
 * máximo `toques_maximos` mensagens geradas, com `intervalo_dias` entre elas.
 * Só a dica ao modelo muda. O limite de toques entre fluxos diferentes é do
 * motor (`limite-de-toques.ts`).
 *
 * As travas de quem fala com o cliente são as do motor de follow-up, que estes
 * fluxos não contornam: ensaio (o canal em pré-lançamento só entrega a número
 * de teste), pessoa que assumiu a conversa (`handoff_policy: pause`), janela e
 * horário do canal (o passo é adiado), opt-out (a inscrição é cancelada) e
 * plano (a inscrição é adiada). A pausa da equipe adia a inscrição pelo mesmo
 * caminho do plano.
 *
 * PURO: sem banco, sem relógio. Sem nicho, preço nem horário nas dicas.
 */
import type { TriggerConfig } from "@/lib/followup/api-schemas";
import type { FlowGraph } from "@/lib/followup/graph-schema";
import { GATILHO_ETAPA_PARADA } from "@/lib/automation/gatilhos-de-tempo";
import type { PerfilDoNegocio } from "@/lib/schemas/equipe-pronta";
import { escadaDeRetomada } from "../regua";

/** `followup_flow_pointers` tem `unique (organization_id, name)`: é por ele que se reencontra. */
export const NOME_DO_FLUXO_DE_FALTA = "Equipe pronta · Faltou ao compromisso";
export const NOME_DO_FLUXO_DE_PROPOSTA_PARADA = "Equipe pronta · Proposta sem resposta";
/** O nome da regra de automação que arma o fluxo de proposta parada. */
export const NOME_DA_REGRA_DE_PROPOSTA_PARADA = "Equipe pronta · Proposta sem resposta";

const DICA_DA_FALTA_PRIMEIRO_TOQUE =
  "A pessoa tinha um compromisso marcado e não compareceu. Retome com uma mensagem curta e sem " +
  "cobrança: diga que sentiu a falta dela, sem perguntar o motivo, e ofereça marcar de novo. Se você " +
  "tiver a consulta de dias e horas livres, ofereça no máximo duas opções exatamente como a agenda " +
  "devolveu; sem ela, pergunte qual dia e período ficam melhores. Não invente dia nem hora, não " +
  "ofereça desconto e não escreva valor de memória.";

const DICA_DA_FALTA_TOQUES_SEGUINTES =
  "A pessoa faltou ao compromisso e não respondeu à mensagem anterior. Escreva uma última retomada, " +
  "ainda mais curta, sem repetir o texto de antes: diga que continua à disposição para marcar de novo " +
  "quando ela quiser, e que ela pode avisar se não tem mais interesse. Não pressione, não invente dia " +
  "nem hora e não ofereça desconto.";

const DICA_DA_PROPOSTA_PRIMEIRO_TOQUE =
  "A pessoa recebeu uma proposta e o negócio não andou desde então. Antes de escrever, consulte a " +
  "proposta dela. Retome com uma mensagem curta e pessoal: pergunte se ela conseguiu ver a proposta e " +
  "se ficou alguma dúvida, citando em uma frase do que a proposta trata. Não repita o valor, a menos " +
  "que a empresa informe preço por mensagem. Não pressione, não ofereça desconto nem condição nova.";

const DICA_DA_PROPOSTA_TOQUES_SEGUINTES =
  "A pessoa recebeu uma proposta e não respondeu à mensagem anterior. Escreva uma última retomada, " +
  "ainda mais curta, sem repetir o texto de antes: mostre que continua à disposição para tirar dúvidas " +
  "sobre a proposta e deixe claro que ela pode responder quando quiser ou avisar se não tem mais " +
  "interesse. Não pressione, não ofereça desconto e não escreva valor de memória.";

/** O gatilho do fluxo de falta: toda falta registrada, de qualquer tipo de agenda. */
export function gatilhoDoFluxoDeFalta(): TriggerConfig {
  // Respondeu, o fluxo para — e a resposta volta ao roteador da equipe.
  return { kind: "appointment_no_show", cancel_on_reply: true };
}

export function grafoDoFluxoDeFalta(perfil: PerfilDoNegocio): FlowGraph {
  return escadaDeRetomada(perfil, {
    primeiroToque: DICA_DA_FALTA_PRIMEIRO_TOQUE,
    toquesSeguintes: DICA_DA_FALTA_TOQUES_SEGUINTES,
  });
}

/** O gatilho do fluxo de proposta parada: quem inscreve é a regra de automação. */
export function gatilhoDoFluxoDePropostaParada(): TriggerConfig {
  return { kind: "manual", cancel_on_reply: true };
}

export function grafoDoFluxoDePropostaParada(perfil: PerfilDoNegocio): FlowGraph {
  return escadaDeRetomada(perfil, {
    primeiroToque: DICA_DA_PROPOSTA_PRIMEIRO_TOQUE,
    toquesSeguintes: DICA_DA_PROPOSTA_TOQUES_SEGUINTES,
  });
}

/** O que a regra de proposta parada grava em `automation_rules`. */
export interface RegraDePropostaParada {
  name: string;
  trigger_event: typeof GATILHO_ETAPA_PARADA;
  trigger_config: {
    dias: number;
    pipeline_id: string;
    stage_id: string;
    proteger_pela_agenda: boolean;
  };
  conditions: [];
  actions: [{ type: "start_message_flow"; config: { flow_pointer_id: string } }];
  is_active: true;
}

/**
 * A regra: N dias na etapa de proposta enviada (N vem do perfil) inscrevem o
 * contato no fluxo de proposta parada.
 *
 * `proteger_pela_agenda`: quem tem compromisso marcado à frente não é retomado
 * (a conversa já tem próximo passo). Sem `replace_live_flow`: se o contato já
 * está em outra sequência, a regra NÃO a derruba, e a ação termina como
 * "já existe inscrição viva".
 */
export function regraDePropostaParada(
  perfil: PerfilDoNegocio,
  alvo: { pipelineId: string; etapaDePropostaEnviadaId: string; fluxoId: string },
): RegraDePropostaParada {
  return {
    name: NOME_DA_REGRA_DE_PROPOSTA_PARADA,
    trigger_event: GATILHO_ETAPA_PARADA,
    trigger_config: {
      dias: perfil.recuperacao.dias_proposta_parada,
      pipeline_id: alvo.pipelineId,
      stage_id: alvo.etapaDePropostaEnviadaId,
      proteger_pela_agenda: true,
    },
    conditions: [],
    actions: [{ type: "start_message_flow", config: { flow_pointer_id: alvo.fluxoId } }],
    is_active: true,
  };
}
