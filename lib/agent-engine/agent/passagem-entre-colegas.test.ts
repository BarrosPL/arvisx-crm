/**
 * Passagem entre colegas: a decisão e as escritas de `passar_para_colega`.
 *
 * O banco é um dublê por consulta: o que se mede aqui é O QUE a ferramenta
 * grava (a nota de título fixo, o agente fixado, a origem da passagem) e, nas
 * recusas, que ela não grava NADA.
 */
import { describe, expect, it, vi } from 'vitest';

import type { PublishedAgentConfig } from './agent-config';
import {
  CHAVE_DA_PASSAGEM,
  RECUSA_DEPOIS_DA_PASSAGEM,
  TITULO_DO_RESUMO_DO_ATENDIMENTO,
  applyPassarParaColega,
  blocoDaPassagemDesfeita,
  blocoDaPassagemRecebida,
  colegasDoAgente,
  descricaoDaPassagemEntreColegas,
  desfazerPassagem,
  lerPassagemEmVigor,
  passagemValePara,
} from './passagem-entre-colegas';
import type { LoadedRouter, RouterMember } from './router-config';

const ORG = 'org-1';
const CONTATO = 'contato-1';
const CONVERSA = 'conversa-1';

const membros: RouterMember[] = [
  { agentId: 'agente-entrada', intentName: 'entrada', intentDescription: 'recebe quem chega', examples: [] },
  { agentId: 'agente-horarios', intentName: 'Marcação', intentDescription: 'marca horário', examples: [] },
  { agentId: 'agente-orcamento', intentName: 'orçamento', intentDescription: '', examples: [] },
];

function roteador(overrides: Partial<LoadedRouter> = {}): LoadedRouter {
  return {
    id: 'roteador-1',
    name: 'R',
    classifierModel: null,
    classifierProvider: null,
    sticky: true,
    passagemEntreColegas: true,
    minConfidence: 0.6,
    fallbackAgentId: null,
    members: membros,
    ...overrides,
  };
}

function colega(overrides: Partial<PublishedAgentConfig> = {}): PublishedAgentConfig {
  return { agentId: 'agente-horarios', versionId: 'v1', ...overrides } as PublishedAgentConfig;
}

interface Nota {
  id: string;
  headline: string;
}

/** Banco de mentira: guarda as notas do contato e toda escrita que recebeu. */
function bancoFalso(notas: Nota[] = []) {
  const escritas: Array<{ sql: string; valores: unknown[] }> = [];
  const query = vi.fn(async (sql: string, valores: unknown[] = []) => {
    if (sql.includes('select id, headline from lead_notes')) return { rows: notas };
    escritas.push({ sql, valores });
    if (sql.includes('insert into lead_notes')) return { rows: [{ id: 'nota-nova', superseded: String((valores[2] as string[]).length) }] };
    return { rows: [] };
  });
  return { db: { query } as never, escritas };
}

const ids = { tenantId: ORG, leadId: CONTATO, conversationId: CONVERSA, agentId: 'agente-entrada', intentName: 'entrada' };

function cfg(overrides: Partial<Parameters<typeof applyPassarParaColega>[2]> = {}) {
  return {
    budgetTokens: 2_000,
    colegas: colegasDoAgente(roteador(), 'agente-entrada'),
    carregarColega: vi.fn(async () => colega()),
    agora: () => new Date('2026-11-20T12:00:00.000Z'),
    ...overrides,
  };
}

const pedido = {
  papel: 'Marcação',
  motivo: 'a pessoa quer marcar um horário',
  resumo: 'Quer um horário na semana que vem. Já informou o nome completo. Próximo passo: oferecer os horários livres.',
};

describe('colegasDoAgente', () => {
  it('roteador sem a passagem ligada não tem colega para ninguém', () => {
    expect(colegasDoAgente(roteador({ passagemEntreColegas: false }), 'agente-entrada')).toEqual([]);
    expect(colegasDoAgente(roteador({ passagemEntreColegas: undefined }), 'agente-entrada')).toEqual([]);
    expect(colegasDoAgente(null, 'agente-entrada')).toEqual([]);
  });

  it('com a passagem ligada, os colegas são os membros atendidos por OUTRO agente', () => {
    expect(colegasDoAgente(roteador(), 'agente-entrada').map((c) => c.intentName)).toEqual(['Marcação', 'orçamento']);
  });

  it('quem não é do roteador não passa a vez; o agente de reserva é do roteador', () => {
    expect(colegasDoAgente(roteador(), 'agente-de-fora')).toEqual([]);
    expect(colegasDoAgente(roteador({ fallbackAgentId: 'agente-reserva' }), 'agente-reserva')).toHaveLength(3);
  });

  it('a descrição lista os papéis deste número, e nenhum outro', () => {
    const texto = descricaoDaPassagemEntreColegas(colegasDoAgente(roteador(), 'agente-entrada'));
    expect(texto).toContain('"Marcação" (marca horário)');
    expect(texto).toContain('"orçamento"');
    expect(texto).not.toContain('"entrada"');
  });
});

describe('applyPassarParaColega', () => {
  it('passa a vez: grava o resumo de título fixo, fixa o colega na conversa e guarda a origem', async () => {
    const { db, escritas } = bancoFalso();
    const res = await applyPassarParaColega(db, ids, cfg(), pedido);

    expect(res).toMatchObject({
      ok: true,
      passagem: {
        paraAgente: 'agente-horarios',
        paraIntencao: 'Marcação',
        deAgente: 'agente-entrada',
        deIntencao: 'entrada',
        motivo: pedido.motivo,
        resumo: pedido.resumo,
      },
    });
    expect(escritas).toHaveLength(2);

    const [nota, conversa] = escritas;
    expect(nota!.sql).toContain('insert into lead_notes');
    expect(nota!.valores.slice(0, 2)).toEqual([ORG, CONTATO]);
    expect(nota!.valores[3]).toBe(TITULO_DO_RESUMO_DO_ATENDIMENTO);
    // O resumo vai inteiro para a ficha, com o motivo da passagem no fim.
    expect(nota!.valores[4]).toContain(pedido.resumo);
    expect(nota!.valores[4]).toContain(pedido.motivo);

    expect(conversa!.sql).toContain('update conversations');
    expect(conversa!.sql).toContain('where organization_id = $1 and id = $2');
    expect(conversa!.valores.slice(0, 5)).toEqual([ORG, CONVERSA, 'agente-horarios', 'Marcação', CHAVE_DA_PASSAGEM]);
    expect(JSON.parse(conversa!.valores[5] as string)).toEqual({
      para_agente: 'agente-horarios',
      para_intencao: 'Marcação',
      de_agente: 'agente-entrada',
      de_intencao: 'entrada',
      motivo: pedido.motivo,
      em: '2026-11-20T12:00:00.000Z',
    });
  });

  it('atualiza o resumo em vez de duplicar: a nota anterior de mesmo título sai na mesma escrita', async () => {
    const { db, escritas } = bancoFalso([
      { id: 'nota-antiga', headline: 'Resumo do atendimento' },
      { id: 'outra-nota', headline: 'Prefere contato à tarde' },
    ]);
    const res = await applyPassarParaColega(db, ids, cfg(), pedido);
    expect(res.ok).toBe(true);
    expect(escritas[0]!.valores[2]).toEqual(['nota-antiga']);
  });

  it('o papel casa sem depender de caixa, acento ou espaço', async () => {
    const { db } = bancoFalso();
    const res = await applyPassarParaColega(db, ids, cfg(), { ...pedido, papel: '  marcacao ' });
    expect(res).toMatchObject({ ok: true, passagem: { paraAgente: 'agente-horarios' } });
  });

  it('papel que não existe neste número: ensina os papéis e não grava nada', async () => {
    const { db, escritas } = bancoFalso();
    const res = await applyPassarParaColega(db, ids, cfg(), { ...pedido, papel: 'cobrança' });
    expect(res).toMatchObject({ ok: false, error: { code: 'papel_desconhecido' } });
    expect(res.ok === false && res.error.message).toContain('"Marcação"');
    expect(escritas).toEqual([]);
  });

  it('o próprio papel de quem passa não é colega', async () => {
    const { db, escritas } = bancoFalso();
    const res = await applyPassarParaColega(db, ids, cfg(), { ...pedido, papel: 'entrada' });
    expect(res).toMatchObject({ ok: false, error: { code: 'papel_desconhecido' } });
    expect(escritas).toEqual([]);
  });

  it.each([
    ['sem versão publicada', null],
    ['pausado', colega({ pausedAt: '2026-11-20T00:00:00Z' })],
    ['em modo assistido', colega({ operationMode: 'assisted' })],
  ])('colega %s: recusa e não grava nada', async (_caso, config) => {
    const { db, escritas } = bancoFalso();
    const res = await applyPassarParaColega(db, ids, cfg({ carregarColega: vi.fn(async () => config) }), pedido);
    expect(res).toMatchObject({ ok: false, error: { code: 'colega_indisponivel' } });
    expect(escritas).toEqual([]);
  });

  it('resumo que estoura o orçamento da ficha: a passagem NÃO acontece e a conversa não muda', async () => {
    const { db, escritas } = bancoFalso();
    const res = await applyPassarParaColega(db, ids, cfg({ budgetTokens: 1 }), pedido);
    expect(res).toMatchObject({ ok: false, error: { code: 'index_budget_exceeded' } });
    expect(escritas).toEqual([]);
  });

  it.each([
    ['campo a mais', { ...pedido, organization_id: 'outra-org' }],
    ['sem resumo', { papel: 'Marcação', motivo: 'x' }],
    ['resumo vazio', { ...pedido, resumo: '   ' }],
    ['não é objeto', 'Marcação'],
  ])('payload inválido (%s): ensino, sem escrita', async (_caso, bruto) => {
    const { db, escritas } = bancoFalso();
    const res = await applyPassarParaColega(db, ids, cfg(), bruto);
    expect(res).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
    expect(escritas).toEqual([]);
  });

  it('conversa, contato e organização vêm de quem chama, nunca do payload', async () => {
    const { db, escritas } = bancoFalso();
    await applyPassarParaColega(db, { ...ids, tenantId: 'org-do-turno', conversationId: 'conversa-do-turno' }, cfg(), pedido);
    expect(escritas[0]!.valores[0]).toBe('org-do-turno');
    expect(escritas[1]!.valores.slice(0, 2)).toEqual(['org-do-turno', 'conversa-do-turno']);
  });
});

describe('a passagem gravada na conversa', () => {
  const gravada = {
    para_agente: 'agente-horarios',
    para_intencao: 'Marcação',
    de_agente: 'agente-entrada',
    de_intencao: 'entrada',
    motivo: 'm',
    em: '2026-11-20T12:00:00.000Z',
  };

  it('lê a chave do jsonb e ignora forma torta', () => {
    expect(lerPassagemEmVigor({ [CHAVE_DA_PASSAGEM]: gravada })).toEqual(gravada);
    expect(lerPassagemEmVigor({ [CHAVE_DA_PASSAGEM]: { para_agente: 1 } })).toBeNull();
    expect(lerPassagemEmVigor({})).toBeNull();
    expect(lerPassagemEmVigor(null)).toBeNull();
  });

  it('só vale enquanto aponta para o agente fixado na conversa', () => {
    expect(passagemValePara(gravada, 'agente-horarios')).toBe(true);
    expect(passagemValePara(gravada, 'agente-orcamento')).toBe(false);
    expect(passagemValePara(gravada, null)).toBe(false);
    expect(passagemValePara(null, 'agente-horarios')).toBe(false);
  });
});

describe('o que cada lado lê', () => {
  it('o colega recebe o motivo e o resumo, e a ordem de não avisar o cliente', () => {
    const bloco = blocoDaPassagemRecebida({ motivo: pedido.motivo, resumo: pedido.resumo });
    expect(bloco).toContain(pedido.motivo);
    expect(bloco).toContain(pedido.resumo);
    expect(bloco).toContain('O cliente não sabe da troca');
    expect(bloco).toContain('não repita pergunta');
  });

  it('quem já passou a vez recebe recusa, não envio', () => {
    expect(RECUSA_DEPOIS_DA_PASSAGEM).toMatchObject({ ok: false, error: { code: 'ja_passou_a_vez' } });
  });
});

// ---------------------------------------------------------------------------
// Revisão de 20/11, item 2.11
// ---------------------------------------------------------------------------

describe('as duas escritas da passagem valem juntas (revisão 20/11, 2.11)', () => {
  /** Uma "transação" de teste: registra o que entrou, o que confirmou e o que desfez. */
  function transacao(db: { query: (...a: unknown[]) => Promise<unknown> }) {
    const eventos: string[] = [];
    const emTransacao = async <T,>(escrever: (tx: never) => Promise<T>): Promise<T> => {
      eventos.push('begin');
      try {
        const r = await escrever(db as never);
        eventos.push('commit');
        return r;
      } catch (err) {
        eventos.push('rollback');
        throw err;
      }
    };
    return { eventos, emTransacao };
  }

  it('a nota e o agente da conversa são gravados DENTRO da mesma transação', async () => {
    const { db, escritas } = bancoFalso();
    const t = transacao(db);
    const r = await applyPassarParaColega(db, ids, cfg({ emTransacao: t.emTransacao }), pedido);

    expect(r.ok).toBe(true);
    expect(t.eventos).toEqual(['begin', 'commit']);
    expect(escritas.some((e) => e.sql.includes('insert into lead_notes'))).toBe(true);
    expect(escritas.some((e) => e.sql.includes('update conversations'))).toBe(true);
  });

  it('⭐ a troca do agente falha depois de a nota entrar: a transação é desfeita e o erro propaga', async () => {
    const { db } = bancoFalso();
    const query = (db as unknown as { query: ReturnType<typeof vi.fn> }).query;
    const original = query.getMockImplementation() as (sql: string, valores?: unknown[]) => Promise<unknown>;
    query.mockImplementation(async (sql: string, valores: unknown[] = []) => {
      if (sql.includes('update conversations')) throw new Error('conexão caiu');
      return original(sql, valores);
    });
    const t = transacao(db);

    await expect(applyPassarParaColega(db, ids, cfg({ emTransacao: t.emTransacao }), pedido)).rejects.toThrow(
      'conexão caiu',
    );
    expect(t.eventos).toEqual(['begin', 'rollback']);
  });

  it('⭐ o colega é conferido ANTES de qualquer gravação: indisponível, a transação nem abre', async () => {
    for (const config of [null, colega({ pausedAt: '2026-11-20T00:00:00Z' }), colega({ operationMode: 'assisted' })]) {
      const { db, escritas } = bancoFalso();
      const t = transacao(db);
      const r = await applyPassarParaColega(
        db,
        ids,
        cfg({ carregarColega: vi.fn(async () => config), emTransacao: t.emTransacao }),
        pedido,
      );
      expect(r).toMatchObject({ ok: false, error: { code: 'colega_indisponivel' } });
      expect(t.eventos).toEqual([]);
      expect(escritas).toEqual([]);
    }
  });

  it('resumo recusado dentro da transação: nada mais é gravado e a recusa volta como ensino', async () => {
    const { db, escritas } = bancoFalso();
    const t = transacao(db);
    const r = await applyPassarParaColega(db, ids, cfg({ budgetTokens: 1, emTransacao: t.emTransacao }), pedido);

    expect(r.ok).toBe(false);
    expect(escritas.some((e) => e.sql.includes('update conversations'))).toBe(false);
  });
});

describe('desfazer a passagem (revisão 20/11, 2.11)', () => {
  const aceita = { paraAgente: 'agente-horarios', deAgente: 'agente-entrada', deIntencao: 'entrada' };

  it('⭐ devolve a conversa a quem passou, tira a chave da passagem, e SÓ se a conversa ainda estiver com o colega', async () => {
    const query = vi.fn(async (_sql: string, _valores: unknown[] = []) => ({ rows: [], rowCount: 1 }));
    const devolvida = await desfazerPassagem({ query } as never, { tenantId: ORG, conversationId: CONVERSA }, aceita);

    expect(devolvida).toBe(true);
    const [sql, valores] = query.mock.calls[0]!;
    expect(sql).toContain('update conversations');
    expect(sql).toContain('active_ai_agent_id = $6');
    expect(sql).toContain('organization_id = $1');
    expect(valores).toEqual([ORG, CONVERSA, 'agente-entrada', 'entrada', CHAVE_DA_PASSAGEM, 'agente-horarios']);
  });

  it('a conversa já mudou de agente (roteador, pessoa, outro turno): nada é devolvido', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    expect(await desfazerPassagem({ query } as never, { tenantId: ORG, conversationId: CONVERSA }, aceita)).toBe(false);
  });

  it('quem passou lê que a conversa voltou, que o cliente ainda não foi respondido e que pode chamar a equipe', () => {
    const texto = blocoDaPassagemDesfeita({ paraIntencao: 'Marcação', motivo: 'a pessoa quer marcar um horário' });
    expect(texto).toContain('A passagem para o colega não aconteceu');
    expect(texto).toContain('"Marcação"');
    expect(texto).toContain('ainda NÃO recebeu');
    expect(texto).toContain('request_human_handoff');
  });
});
