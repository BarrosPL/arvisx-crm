/**
 * EQUIPE PRONTA — os tipos do catálogo de papéis.
 *
 * ═══ AS TRÊS CAMADAS, QUE NUNCA SE MISTURAM ══════════════════════════════════
 *
 *   1. PAPEL — como cada agente trabalha. Mora AQUI, no código, versionado, e é
 *      IGUAL para todas as empresas. Quem edita é a plataforma, subindo `versao`.
 *   2. CONFIGURAÇÃO DA EMPRESA — as respostas do questionário
 *      (`lib/schemas/equipe-pronta.ts`). Vira um bloco "## Esta empresa" GERADO
 *      no texto do agente (`renderizar.ts`).
 *   3. DADOS VIVOS — serviços e preços, horários, políticas, perguntas
 *      frequentes, etapas. Moram no catálogo, na agenda, na base de conhecimento,
 *      na memória da organização e no funil. O agente consulta por FERRAMENTA.
 *
 * ⚠️ O TEXTO DE UM PAPEL NUNCA CARREGA NICHO, PREÇO NEM HORÁRIO. Um ensaio de
 * 17/11/2026 mostrou o custo: os textos tinham o nome e o ramo de uma empresa
 * escritos dentro, e o agente escolheu um tipo de agenda pelo NOME citado no
 * texto. Quem vigia é `papeis.test.ts`, que reprova o papel que contiver termo
 * de nicho, valor em moeda ou hora.
 */
import type { LeadStage } from "@/lib/agent-engine/agent/lead-state";

export const PAPEIS_DA_EQUIPE = ["sdr", "agendamento", "proposta", "recuperador"] as const;
export type PapelId = (typeof PAPEIS_DA_EQUIPE)[number];

/** O que o roteador do canal usa para decidir qual agente atende a mensagem. */
export interface IntencaoDoPapel {
  /** Vira `ai_router_members.intent_name` — único dentro do roteador. */
  nome: string;
  descricao: string;
  /** Frases de quem escreve, sem nicho: o classificador as usa como exemplo. */
  exemplos: readonly string[];
}

export interface PapelDaEquipe {
  /** Id estável. Vai para `ai_agents.config.equipe_pronta.papel`; renomear órfã a instalação. */
  id: PapelId;
  /**
   * Sobe a cada mudança do papel. A instalação guarda a versão com que foi
   * feita; versão maior no código vira "atualização disponível" na tela, e
   * NUNCA é aplicada sozinha.
   */
  versao: number;
  /** O que mudou nesta versão, em linguagem de quem usa. Aparece na tela. */
  notasDaVersao: string;
  /** Nome do agente quando a empresa não escolhe outro. */
  nomePadrao: string;
  /** Uma frase, para o cartão do agente na tela. */
  descricao: string;
  /** O PAPEL — sem nicho, sem preço, sem horário. Em português do Brasil. */
  prompt: string;
  /**
   * Lista EXPLÍCITA, nunca um pacote: pacote muda com o catálogo, e um papel
   * que ganha ferramenta sem ninguém decidir é um papel que mudou sem versão.
   * Teto `TETO_TOOLS_POR_AGENTE`; todo nome precisa existir no catálogo MCP.
   */
  toolIds: readonly string[];
  /** `true` = o agente leva a régua de follow-up da equipe (só o Recuperador). */
  usaReguaDeFollowup: boolean;
  /** Palavras que passam a conversa para uma pessoa, somadas às da empresa. */
  handoffKeywordsPadrao: readonly string[];
  intencao: IntencaoDoPapel;
}

/**
 * Os PASSOS do funil que a equipe usa, e o `agent_stage_hint` de cada um.
 *
 * O mecanismo é o que o motor já lê (`crm_stages.agent_stage_hint`): nenhum
 * campo novo. Não existe hint para "agendado" — o vocabulário do motor é
 * `LEAD_STAGES` —, então o compromisso marcado não move etapa por hint: ele
 * fica registrado na agenda e na linha do tempo do negócio.
 */
export const PASSOS_DA_EQUIPE = {
  qualificado: "qualified",
  proposta: "negotiating",
  perdido: "lost",
} as const satisfies Record<string, LeadStage>;
export type PassoDaEquipe = keyof typeof PASSOS_DA_EQUIPE;

/** Uma etapa do funil, como o bloco "Esta empresa" a cita: id real e nome. */
export interface EtapaDoFunil {
  id: string;
  nome: string;
}

/**
 * O que o renderizador precisa saber do que JÁ EXISTE na organização. Tudo
 * resolvido pelo instalador a partir de ids reais; nada aqui é digitado.
 */
export interface ContextoDaInstalacao {
  /** O tipo de agenda principal. `null` = a empresa não agenda. */
  agenda: { id: string; slug: string; nome: string } | null;
  /** O funil da equipe e as etapas marcadas por passo. */
  funil: { id: string; nome: string; etapas: Partial<Record<PassoDaEquipe, EtapaDoFunil>> } | null;
  /** A fonte "Política comercial e perguntas frequentes". */
  knowledgeSourceIds: readonly string[];
  /** O ponteiro do fluxo de follow-up do Recuperador. */
  reguaDeFollowupId: string | null;
}

/** Os campos da versão do agente que a equipe pronta decide. */
export interface CamposDoAgente {
  system_prompt: string;
  tool_ids: string[];
  handoff_keywords: string[];
  followup: { enabled: boolean; flow_pointer_ids: string[] };
  pipeline_ids: string[];
  knowledge_source_ids: string[];
  proposal_ai_draft_enabled: boolean;
}
