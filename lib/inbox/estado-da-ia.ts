/**
 * O ESTADO DA IA NUMA CONVERSA, para quem está de FORA: o agente que lê por MCP
 * (`crm_get_conversation`) e o sistema que recebe o webhook de saída
 * (`conversation.ai_paused` / `conversation.ai_resumed`).
 *
 * Responde quatro perguntas: a IA está pausada? por quê? desde quando? por
 * quem? E uma quinta, que decide o que o leitor faz: ela volta sozinha?
 *
 * ## Nada de estado novo
 *
 * É cálculo sobre colunas que já existem (doutrina DIRC: Calcular). Quem manda
 * e por que o automático está calado já tem regra única, `comandoDaConversa`
 * (`lib/inbox/comando-da-conversa.ts`), que a tela usa. Este arquivo só a
 * traduz para um formato estável, em inglês como o resto do contrato MCP, e
 * acrescenta as duas travas que o motor lê e a tela não desenha: o dono humano
 * sem silêncio (`assignee_kind = 'user'`) e a marca permanente do contato
 * (`contacts.ai_opt_out`).
 *
 * A régua é a do motor (`lib/ai/elegibilidade/gate.ts`): pausada aqui quer
 * dizer que o agente nativo não responderia a próxima mensagem por causa de
 * uma PESSOA ou de uma trava. Canal desligado, lista de teste e plano não
 * entram: não são convivência entre pessoa e IA.
 */
import { comandoDaConversa, type MotivoDoSilencio } from "@/lib/inbox/comando-da-conversa";

/** Os fatos lidos da conversa e do contato dela. */
export interface FatosDaIaNaConversa {
  status: string;
  assigned_to_user_id: string | null;
  assignee_kind?: string | null;
  assigned_at?: string | null;
  bot_silenced_until?: string | null;
  last_handoff_at?: string | null;
  last_handoff_reason?: string | null;
  last_outbound_at?: string | null;
  is_group?: boolean | null;
  /** `contacts.force_human`. */
  force_human?: boolean | null;
  /** `contacts.ai_opt_out`: sempre atendimento humano. */
  ai_opt_out?: boolean | null;
  /** `contacts.is_blocked`: pediu para não receber mensagens. */
  is_blocked?: boolean | null;
}

/**
 * Por que a IA está pausada. Vocabulário fechado, em inglês:
 *
 *  - `human_assigned`: uma pessoa assumiu a conversa;
 *  - `human_replied`: uma pessoa respondeu (pela tela ou pelo celular) sem
 *    assumir, e a pausa tem prazo;
 *  - `human_replied_outside_crm`: uma pessoa respondeu pelo celular e a pausa
 *    não tem prazo;
 *  - `handed_to_team`: pausada sem dono (o agente passou o caso para a equipe,
 *    ou alguém pausou e a conversa foi liberada depois);
 *  - `contact_always_human`: o contato é sempre de atendimento humano;
 *  - `contact_locked`: a passagem para humano travou o contato inteiro;
 *  - `contact_opted_out`: o contato pediu para não receber mensagens.
 */
export type MotivoDaPausaDaIa =
  | "human_assigned"
  | "human_replied"
  | "human_replied_outside_crm"
  | "handed_to_team"
  | "contact_always_human"
  | "contact_locked"
  | "contact_opted_out";

export interface EstadoDaIaNaConversa {
  /** A IA não responde esta conversa agora, por causa de uma pessoa ou de uma trava. */
  paused: boolean;
  /** Uma pessoa é a dona da conversa. */
  human_in_command: boolean;
  reason: MotivoDaPausaDaIa | null;
  /** Desde quando (ISO-8601). `null` quando não está pausada ou o banco não guardou a hora. */
  since: string | null;
  /** Quem assumiu: o id do atendente. Só existe em `human_assigned`. */
  by_user_id: string | null;
  /** Quando a pausa acaba sozinha (ISO-8601). `null` = não tem prazo. */
  until: string | null;
  /**
   * `true` = a pausa tem prazo e a IA volta sozinha em `until`. `false` = só
   * volta por comando (devolver ao automático) ou pelo prazo de devolução da
   * empresa, se ela tiver ligado um.
   */
  resumes_automatically: boolean;
  /** O motivo escrito na conversa (`last_handoff_reason`), quando há. */
  detail: string | null;
}

const NAO_PAUSADA: EstadoDaIaNaConversa = {
  paused: false,
  human_in_command: false,
  reason: null,
  since: null,
  by_user_id: null,
  until: null,
  resumes_automatically: false,
  detail: null,
};

const MOTIVO_DA_TELA: Record<Exclude<MotivoDoSilencio, "contato_descadastrado" | "contato_travado">, MotivoDaPausaDaIa> = {
  atendente_no_comando: "human_assigned",
  atendimento_pelo_celular: "human_replied_outside_crm",
  pausado: "handed_to_team",
  resposta_humana_recente: "human_replied",
};

function texto(valor: string | null | undefined): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

/**
 * O estado, calculado. `agora` é injetável para o teste.
 *
 * Conversa de grupo e conversa encerrada devolvem "não pausada": ali a IA não
 * atende por outra razão (nunca atende grupo; não há assunto), e dizer
 * "pausada" sugeriria que devolver ao automático muda alguma coisa.
 */
export function estadoDaIaNaConversa(fatos: FatosDaIaNaConversa, agora: Date = new Date()): EstadoDaIaNaConversa {
  const calculo = comandoDaConversa(
    {
      status: fatos.status,
      assigned_to_user_id: fatos.assigned_to_user_id,
      assignee_kind: fatos.assignee_kind ?? null,
      bot_silenced_until: fatos.bot_silenced_until ?? null,
      last_handoff_reason: fatos.last_handoff_reason ?? null,
      force_human: fatos.force_human ?? false,
      is_group: fatos.is_group ?? false,
      is_blocked: fatos.is_blocked ?? false,
    },
    agora,
  );
  if (fatos.is_group === true || calculo.comando.quem === "encerrada") return { ...NAO_PAUSADA };

  const humanoNoComando = fatos.assigned_to_user_id !== null || fatos.assignee_kind === "user";
  const detalhe = texto(fatos.last_handoff_reason);
  const desdeAPassagem = texto(fatos.last_handoff_at);

  // As duas travas permanentes do CONTATO vêm primeiro: valem para todas as
  // conversas dele, e devolver ESTA conversa ao automático não as desfaz.
  if (fatos.is_blocked === true) {
    return { ...NAO_PAUSADA, paused: true, human_in_command: humanoNoComando, reason: "contact_opted_out" };
  }
  if (fatos.ai_opt_out === true) {
    return { ...NAO_PAUSADA, paused: true, human_in_command: humanoNoComando, reason: "contact_always_human" };
  }
  // Uma pessoa é a dona: o motor não responde (`conversa_de_humano`), com ou
  // sem silêncio gravado, e o prazo de um silêncio não devolve nada sozinho.
  if (humanoNoComando) {
    return {
      ...NAO_PAUSADA,
      paused: true,
      human_in_command: true,
      reason: "human_assigned",
      since: texto(fatos.assigned_at) ?? desdeAPassagem,
      by_user_id: fatos.assigned_to_user_id,
      detail: detalhe,
    };
  }

  // A passagem para humano travou o contato e ninguém assumiu ainda.
  if (fatos.force_human === true) {
    return { ...NAO_PAUSADA, paused: true, reason: "contact_locked", since: desdeAPassagem, detail: detalhe };
  }

  // Sem dono e sem silêncio vigente: a IA atende. As travas do contato já
  // saíram acima, então os dois motivos de contato não chegam aqui.
  if (calculo.motivo === null || calculo.motivo === "contato_travado" || calculo.motivo === "contato_descadastrado") {
    return { ...NAO_PAUSADA };
  }

  const comPrazo = calculo.silencioAte !== null;
  return {
    paused: true,
    human_in_command: false,
    reason: MOTIVO_DA_TELA[calculo.motivo],
    // A resposta pela tela não carimba `last_handoff_at`: a hora da pausa é a
    // da própria resposta, que é a última saída da conversa.
    since: desdeAPassagem ?? (comPrazo ? texto(fatos.last_outbound_at) : null),
    by_user_id: null,
    until: calculo.silencioAte ? calculo.silencioAte.toISOString() : null,
    resumes_automatically: comPrazo,
    detail: detalhe,
  };
}
