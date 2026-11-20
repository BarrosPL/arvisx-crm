/**
 * Passagem entre colegas — a ferramenta interna `passar_para_colega` do motor.
 *
 * Um agente de um número com roteador passa a vez a OUTRO agente do mesmo
 * roteador, com motivo e resumo. Não é ferramenta do catálogo MCP: só existe
 * dentro do turno de atendimento, e agente externo não tem colega no CRM (para
 * ele a passagem é `crm_request_human_handoff` mais uma nota com destinatário).
 *
 * O que a passagem faz, nesta ordem:
 *   1. atualiza a nota "Resumo do atendimento" da ficha do contato (substitui a
 *      anterior de mesmo título; nunca duplica);
 *   2. fixa o colega como o próximo agente da conversa (a mesma aderência que o
 *      roteador já usa, `conversations.active_ai_agent_id`/`active_intent`) e
 *      grava a origem em `conversations.metadata`, para o roteador saber de que
 *      assunto a conversa veio;
 *   3. devolve o registro que entra no traço do turno (o envoltório do traço
 *      guarda o resultado de toda ferramenta).
 *
 * Quem faz o colega responder na MESMA rodada é o handler do turno
 * (`createInboundTurnHandler`), que roda um segundo turno, do colega, no mesmo
 * job. Esta função só decide e grava.
 *
 * "Colega" e "papel" são do roteador: o papel é o nome da intenção do membro
 * (`ai_router_members.intent_name`). O motor não conhece nenhum papel pelo
 * nome; quem os define é quem monta o roteador.
 *
 * Ordem das escritas: a nota vem primeiro porque é a única que pode ser
 * recusada (orçamento do índice). Recusada, nada mudou e o agente segue dono
 * da conversa.
 */
import { z } from 'zod';

import type { Queryable } from '../queue/queue';
import type { PublishedAgentConfig } from './agent-config';
import { applySaveLeadNote, getLeadNotesIndex } from './lead-notes';
import { findForbiddenKey, zodIssuesSummary } from './lead-state';
import type { LoadedRouter, RouterMember } from './router-config';

/**
 * O nome da ferramenta no turno. Ela NÃO é ligada por `toolIds` (essa lista é
 * validada contra o catálogo MCP, e esta ferramenta não é do catálogo): quem a
 * liga é o ROTEADOR, com `config.passagem_entre_colegas: true`. É no roteador
 * que os colegas são definidos, então é ele que diz se podem passar a vez.
 */
export const FERRAMENTA_DE_PASSAGEM_ENTRE_COLEGAS = 'passar_para_colega';

/** Título fixo da nota que todos os colegas atualizam, na ficha do contato. */
export const TITULO_DO_RESUMO_DO_ATENDIMENTO = 'Resumo do atendimento';

/** Chave de `conversations.metadata` com a passagem em vigor. */
export const CHAVE_DA_PASSAGEM = 'passagem_entre_colegas';

/** Whitelist EXATA do que o modelo informa (mesmo padrão de `save_lead_note`). */
export const passarParaColegaInputSchema = z.strictObject({
  papel: z.string().trim().min(1).max(120),
  motivo: z.string().trim().min(1).max(300),
  resumo: z.string().trim().min(1).max(3_500),
});

/**
 * A passagem gravada na conversa. É o schema central da chave do jsonb: quem
 * lê (`lerPassagemEmVigor`) e quem escreve passam por ele.
 */
const passagemGravadaSchema = z.object({
  para_agente: z.string().min(1),
  para_intencao: z.string().min(1),
  de_agente: z.string().min(1),
  de_intencao: z.string().nullable(),
  motivo: z.string(),
  em: z.string(),
});
export type PassagemGravada = z.infer<typeof passagemGravadaSchema>;

/** Lê a chave do jsonb; qualquer forma torta vale como "sem passagem". */
export function lerPassagemEmVigor(metadata: unknown): PassagemGravada | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const lida = passagemGravadaSchema.safeParse((metadata as Record<string, unknown>)[CHAVE_DA_PASSAGEM]);
  return lida.success ? lida.data : null;
}

/** Compara papéis sem depender de caixa, acento ou espaço nas pontas. */
function chaveDoPapel(papel: string): string {
  return papel
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Os colegas a quem este agente pode passar a vez: os membros do roteador
 * atendidos por OUTRO agente. Um papel por membro, sem repetir nome.
 */
export function colegasDoAgente(router: LoadedRouter | null, agentId: string | null): RouterMember[] {
  if (router === null || agentId === null || router.passagemEntreColegas !== true) return [];
  // Só passa a vez quem É do roteador: um membro ou o agente de reserva dele. O
  // agente de uma campanha, por exemplo, não tem colega ali.
  if (router.fallbackAgentId !== agentId && !router.members.some((m) => m.agentId === agentId)) return [];
  const vistos = new Set<string>();
  const colegas: RouterMember[] = [];
  for (const membro of router.members) {
    if (membro.agentId === agentId) continue;
    const chave = chaveDoPapel(membro.intentName);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    colegas.push(membro);
  }
  return colegas;
}

/** A descrição que o modelo lê, com os papéis que existem NESTE número. */
export function descricaoDaPassagemEntreColegas(colegas: readonly RouterMember[]): string {
  const papeis = colegas
    .map((c) => `"${c.intentName}"${c.intentDescription ? ` (${c.intentDescription})` : ''}`)
    .join('; ');
  return (
    'Passa a vez para um COLEGA quando o que o cliente precisa agora é do papel dele, e não do seu. ' +
    'O colega responde ao cliente nesta mesma rodada, com o contexto, e segue na conversa até o assunto mudar. ' +
    'Chame ANTES de enviar qualquer mensagem neste turno e NÃO avise o cliente da troca: para ele é a mesma ' +
    'atendente. Depois de chamar, encerre o turno sem enviar nada. ' +
    'Em "resumo", escreva o que a pessoa quer, o que já foi feito e respondido e qual é o próximo passo: ' +
    'o colega lê isso para não repetir perguntas. Em "motivo", diga em uma frase por que está passando. ' +
    `Papéis disponíveis em "papel": ${papeis}. ` +
    'Para chamar uma PESSOA da equipe, a ferramenta é outra (request_human_handoff).'
  );
}

/** A definição que entra no turno (schema largo; a validação real é a whitelist). */
export function defDaPassagemEntreColegas(colegas: readonly RouterMember[]) {
  return {
    description: descricaoDaPassagemEntreColegas(colegas),
    inputSchema: z
      .object({
        papel: z.string().describe('O papel do colega, exatamente como listado na descrição.'),
        motivo: z.string().describe('Por que está passando a vez, em uma frase.'),
        resumo: z.string().describe('O que a pessoa quer, o que já foi feito e o próximo passo.'),
      })
      .passthrough(),
  };
}

/** A passagem aceita, como o handler do turno a recebe. */
export interface PassagemAceita {
  paraAgente: string;
  paraIntencao: string;
  deAgente: string;
  deIntencao: string | null;
  motivo: string;
  resumo: string;
}

export type ResultadoDaPassagem =
  | { ok: true; passagem: PassagemAceita; message: string }
  | {
      ok: false;
      error: {
        code:
          | 'invalid_payload'
          | 'papel_desconhecido'
          | 'colega_indisponivel'
          | 'index_budget_exceeded'
          | 'ja_passou_a_vez';
        message: string;
      };
    };

function ensinar(
  code: Extract<ResultadoDaPassagem, { ok: false }>['error']['code'],
  message: string,
): ResultadoDaPassagem {
  return { ok: false, error: { code, message } };
}

const ENSINO_DO_PAYLOAD =
  'Campos aceitos: papel (o papel do colega), motivo (uma frase) e resumo (o que a pessoa quer, ' +
  'o que já foi feito e o próximo passo), nada além. Conversa, contato e organização vêm do runtime.';

/**
 * Aplica um `passar_para_colega`. Devolve erro de ENSINO (nunca lança por
 * entrada ruim) e só escreve quando tudo foi conferido.
 */
export async function applyPassarParaColega(
  db: Queryable,
  ids: {
    tenantId: string;
    leadId: string;
    conversationId: string;
    /** O agente que está passando a vez. */
    agentId: string;
    /** A intenção com que este turno foi roteado (o assunto de origem). */
    intentName: string | null;
  },
  cfg: {
    budgetTokens: number;
    colegas: readonly RouterMember[];
    /** A versão publicada do colega; `null` = sem versão publicada. */
    carregarColega: (agentId: string) => Promise<PublishedAgentConfig | null>;
    agora?: () => Date;
  },
  rawInput: unknown,
): Promise<ResultadoDaPassagem> {
  const proibida = findForbiddenKey(rawInput);
  if (proibida !== null) {
    return ensinar('invalid_payload', `campos não reconhecidos: ${proibida}. ${ENSINO_DO_PAYLOAD}`);
  }
  const lido = passarParaColegaInputSchema.safeParse(rawInput);
  if (!lido.success) {
    return ensinar(
      'invalid_payload',
      `payload inválido em passar_para_colega (${zodIssuesSummary(lido.error)}). ${ENSINO_DO_PAYLOAD}`,
    );
  }
  const { papel, motivo, resumo } = lido.data;

  const colega = cfg.colegas.find((c) => chaveDoPapel(c.intentName) === chaveDoPapel(papel));
  if (colega === undefined) {
    const validos = cfg.colegas.map((c) => `"${c.intentName}"`).join(', ');
    return ensinar(
      'papel_desconhecido',
      `não existe colega com o papel "${papel}" neste número. Papéis disponíveis: ${validos}. ` +
        'Se nenhum deles serve, continue você o atendimento ou chame a equipe.',
    );
  }

  const config = await cfg.carregarColega(colega.agentId);
  if (config === null || config.pausedAt || config.operationMode === 'assisted') {
    return ensinar(
      'colega_indisponivel',
      `o colega do papel "${colega.intentName}" não está atendendo agora. Nada mudou: continue você o ` +
        'atendimento com o que souber, ou chame a equipe se não puder resolver.',
    );
  }

  // 1. O "Resumo do atendimento": uma nota só, de título fixo. A anterior de
  //    mesmo título sai na mesma escrita (`supersedes`).
  const indice = await getLeadNotesIndex(db, ids.tenantId, ids.leadId);
  const anteriores = indice
    .filter((n) => chaveDoPapel(n.headline) === chaveDoPapel(TITULO_DO_RESUMO_DO_ATENDIMENTO))
    .map((n) => n.id);
  const nota = await applySaveLeadNote(
    db,
    { tenantId: ids.tenantId, leadId: ids.leadId },
    { budgetTokens: cfg.budgetTokens },
    {
      headline: TITULO_DO_RESUMO_DO_ATENDIMENTO,
      body: `${resumo}\n\nPassagem para "${colega.intentName}": ${motivo}`,
      ...(anteriores.length > 0 ? { supersedes: anteriores } : {}),
    },
  );
  if (!nota.ok) {
    return ensinar(
      nota.error.code === 'index_budget_exceeded' ? 'index_budget_exceeded' : 'invalid_payload',
      `a passagem NÃO foi feita porque o resumo não pôde ser gravado: ${nota.error.message}`,
    );
  }

  // 2. O próximo agente da conversa. A aderência é a que o roteador já lê; a
  //    origem vai no jsonb para ele reconhecer "o assunto de antes da passagem".
  const gravada: PassagemGravada = {
    para_agente: colega.agentId,
    para_intencao: colega.intentName,
    de_agente: ids.agentId,
    de_intencao: ids.intentName,
    motivo,
    em: (cfg.agora?.() ?? new Date()).toISOString(),
  };
  await db.query(
    `update conversations
        set active_ai_agent_id = $3,
            active_intent = $4,
            active_agent_set_at = now(),
            metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object($5::text, $6::jsonb)
      where organization_id = $1 and id = $2`,
    [ids.tenantId, ids.conversationId, colega.agentId, colega.intentName, CHAVE_DA_PASSAGEM, JSON.stringify(gravada)],
  );

  return {
    ok: true,
    passagem: {
      paraAgente: colega.agentId,
      paraIntencao: colega.intentName,
      deAgente: ids.agentId,
      deIntencao: ids.intentName,
      motivo,
      resumo,
    },
    message:
      `vez passada para o colega do papel "${colega.intentName}". Ele responde ao cliente nesta rodada. ` +
      'Encerre o turno AGORA, sem enviar mensagem e sem chamar outra ferramenta.',
  };
}

/** A recusa de quem tenta falar com o cliente depois de passar a vez. */
export const RECUSA_DEPOIS_DA_PASSAGEM = {
  ok: false as const,
  error: {
    code: 'ja_passou_a_vez' as const,
    message:
      'você já passou a vez para um colega neste turno: ele é quem responde ao cliente. ' +
      'Não envie nada. Encerre o turno agora.',
  },
};

/**
 * O bloco que o colega lê na abertura do turno dele, na mesma rodada. Texto
 * para o MODELO, nunca para o cliente.
 */
export function blocoDaPassagemRecebida(passagem: Pick<PassagemAceita, 'motivo' | 'resumo'>): string {
  return [
    '## Passagem recebida de um colega',
    'Um colega da equipe passou esta conversa para você AGORA. O cliente não sabe da troca e não deve saber: ' +
      'para ele é a mesma atendente. Responda à última mensagem dele nesta rodada, continuando de onde o ' +
      'atendimento parou. Não se apresente de novo e não repita pergunta que já foi respondida.',
    `Motivo da passagem: ${passagem.motivo}`,
    `Resumo do atendimento até aqui: ${passagem.resumo}`,
  ].join('\n');
}

/**
 * A passagem gravada ainda vale para o agente que está fixado na conversa?
 * Quando o roteador troca de agente (o assunto mudou), a chave fica para trás e
 * deixa de valer por esta comparação: ninguém precisa apagá-la.
 */
export function passagemValePara(
  passagem: PassagemGravada | null,
  stickyAgentId: string | null,
): passagem is PassagemGravada {
  return passagem !== null && stickyAgentId !== null && passagem.para_agente === stickyAgentId;
}
