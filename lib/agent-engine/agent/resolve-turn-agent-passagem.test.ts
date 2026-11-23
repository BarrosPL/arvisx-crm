/**
 * Regra 8 do roteador: depois de `passar_para_colega`, o colega fica fixado na
 * conversa ATÉ O ASSUNTO MUDAR.
 *
 * O caso que a regra existe para impedir tem controle próprio aqui: sem a
 * passagem gravada, a mesma mensagem devolve a conversa a quem a passou.
 */
import { describe, expect, it, vi } from 'vitest';

import type { JevNoRoteador } from '@/lib/ai/decisao/roteador';

import type { PublishedAgentConfig } from './agent-config';
import { CHAVE_DA_PASSAGEM, type PassagemGravada } from './passagem-entre-colegas';
import { destinoDoVeredito, resolveConversationTurn, resolveTurnAgent } from './resolve-turn-agent';
import type { LoadedRouter } from './router-config';

const membros = [
  { agentId: 'agente-entrada', intentName: 'entrada', intentDescription: 'recebe quem chega', examples: [] },
  { agentId: 'agente-horarios', intentName: 'horarios', intentDescription: 'marca horário', examples: [] },
  { agentId: 'agente-orcamento', intentName: 'orcamento', intentDescription: 'monta orçamento', examples: [] },
];

function roteador(overrides: Partial<LoadedRouter> = {}): LoadedRouter {
  return {
    id: 'roteador-1',
    name: 'R',
    classifierModel: null,
    classifierProvider: null,
    sticky: true,
    minConfidence: 0.6,
    fallbackAgentId: null,
    members: membros,
    ...overrides,
  };
}

/** A entrada passou a vez para o colega dos horários. */
const passagem: PassagemGravada = {
  para_agente: 'agente-horarios',
  para_intencao: 'horarios',
  de_agente: 'agente-entrada',
  de_intencao: 'entrada',
  motivo: 'quer marcar',
  em: '2026-11-20T12:00:00.000Z',
};

const entrada = {
  tenantId: 'org-1',
  leadId: 'contato-1',
  jobId: 'job-1',
  channelSessionId: 'canal-1',
  conversationId: 'conversa-1',
};

function portas(r: LoadedRouter, veredito: { intentName: string | null; confidence: number } | null) {
  const jev = {
    estado: Promise.resolve('desligada' as const),
    escolha: Promise.resolve(null),
    modo: Promise.resolve('comparacao' as const),
    observar: vi.fn<JevNoRoteador['observar']>(),
  };
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    loadActiveRouter: vi.fn().mockResolvedValue(r),
    loadPublishedAgentConfigById: vi.fn(async (_db: unknown, _org: unknown, id: string) => ({ agentId: id }) as PublishedAgentConfig),
    loadPublishedAgentConfig: vi.fn(),
    classifyIntent: vi.fn().mockResolvedValue(veredito),
    consultarJev: vi.fn(() => jev),
    temIaDeSempre: vi.fn().mockResolvedValue(true),
    agenteDaCampanha: vi.fn().mockResolvedValue(null),
    registrarDecisao: vi.fn(),
  } as never;
}

/** A conversa como fica depois da passagem: o colega fixado, com a intenção dele. */
const fixadoNoColega = { stickyAgentId: 'agente-horarios', stickyIntent: 'horarios' };

describe('regra 8 — o colega fica até o assunto mudar', () => {
  it('o classificador volta a apontar o assunto de ORIGEM, com certeza: o colega continua', async () => {
    const out = await resolveTurnAgent({} as never, {} as never,
      { ...entrada, ...fixadoNoColega, signal: 'pode ser amanhã?', passagem },
      portas(roteador(), { intentName: 'entrada', confidence: 0.95 }));
    expect(out.outcome).toBe('sticky');
    expect(out.config?.agentId).toBe('agente-horarios');
    expect(out.intentName).toBe('horarios');
  });

  it('CONTROLE: sem a passagem gravada, a mesma mensagem devolve a conversa a quem a passou', async () => {
    const out = await resolveTurnAgent({} as never, {} as never,
      { ...entrada, ...fixadoNoColega, signal: 'pode ser amanhã?' },
      portas(roteador(), { intentName: 'entrada', confidence: 0.95 }));
    expect(out.outcome).toBe('reclassified');
    expect(out.config?.agentId).toBe('agente-entrada');
  });

  it('uma TERCEIRA intenção, com certeza, é assunto novo: o roteador troca o agente', async () => {
    const out = await resolveTurnAgent({} as never, {} as never,
      { ...entrada, ...fixadoNoColega, signal: 'quanto custa o pacote?', passagem },
      portas(roteador(), { intentName: 'orcamento', confidence: 0.9 }));
    expect(out.outcome).toBe('reclassified');
    expect(out.config?.agentId).toBe('agente-orcamento');
  });

  it('a terceira intenção sem certeza não troca ninguém', async () => {
    const out = await resolveTurnAgent({} as never, {} as never,
      { ...entrada, ...fixadoNoColega, signal: 'hmm', passagem },
      portas(roteador(), { intentName: 'orcamento', confidence: 0.4 }));
    expect(out.outcome).toBe('sticky');
    expect(out.config?.agentId).toBe('agente-horarios');
  });

  it('classificador que falhou não derruba o colega', async () => {
    const out = await resolveTurnAgent({} as never, {} as never,
      { ...entrada, ...fixadoNoColega, signal: 'oi', passagem },
      portas(roteador(), null));
    expect(out.outcome).toBe('sticky');
    expect(out.config?.agentId).toBe('agente-horarios');
  });

  it('a passagem fixa o colega mesmo com a aderência do roteador desligada', async () => {
    const r = roteador({ sticky: false });
    const comPassagem = await resolveTurnAgent({} as never, {} as never,
      { ...entrada, ...fixadoNoColega, signal: 'pode ser amanhã?', passagem },
      portas(r, { intentName: 'entrada', confidence: 0.95 }));
    expect(comPassagem.config?.agentId).toBe('agente-horarios');

    // CONTROLE: sem passagem, aderência desligada é reclassificar a cada mensagem.
    const semPassagem = await resolveTurnAgent({} as never, {} as never,
      { ...entrada, ...fixadoNoColega, signal: 'pode ser amanhã?' },
      portas(r, { intentName: 'entrada', confidence: 0.95 }));
    expect(semPassagem.outcome).toBe('classified');
    expect(semPassagem.config?.agentId).toBe('agente-entrada');
  });

  it('passagem velha (aponta para quem já não está fixado) não vale: regra 2 de sempre', async () => {
    const out = await resolveTurnAgent({} as never, {} as never,
      { ...entrada, stickyAgentId: 'agente-orcamento', stickyIntent: 'orcamento', signal: 'oi', passagem },
      portas(roteador(), { intentName: 'entrada', confidence: 0.95 }));
    expect(out.outcome).toBe('reclassified');
    expect(out.config?.agentId).toBe('agente-entrada');
  });

  it('turno sem mensagem do cliente (follow-up): o colega fixado segue', async () => {
    const out = await resolveTurnAgent({} as never, {} as never,
      { ...entrada, ...fixadoNoColega, signal: null, passagem },
      portas(roteador({ sticky: false }), null));
    expect(out.outcome).toBe('sticky');
    expect(out.config?.agentId).toBe('agente-horarios');
  });
});

describe('destinoDoVeredito com a intenção de origem', () => {
  const r = roteador();
  const colega = membros[1];

  it('a origem conta como o mesmo assunto; sem ela, a régua é a de sempre', () => {
    const veredito = { intentName: 'entrada', confidence: 0.9 };
    expect(destinoDoVeredito(r, colega, 'horarios', veredito, 'entrada').outcome).toBe('sticky');
    expect(destinoDoVeredito(r, colega, 'horarios', veredito).outcome).toBe('reclassified');
    expect(destinoDoVeredito(r, colega, 'horarios', veredito, null).outcome).toBe('reclassified');
  });

  it('sem aderência, a origem não inventa uma', () => {
    const d = destinoDoVeredito(r, undefined, null, { intentName: 'entrada', confidence: 0.9 }, 'entrada');
    expect(d.outcome).toBe('classified');
  });
});

describe('resolveConversationTurn lê a passagem gravada na conversa', () => {
  function banco(metadata: unknown) {
    return {
      query: vi.fn(async (sql: string, _valores: unknown[]) => {
        if (sql.includes('from conversations')) {
          return { rows: [{ active_ai_agent_id: 'agente-horarios', active_intent: 'horarios', metadata }] };
        }
        if (sql.includes('id<>$3')) return { rows: [] };
        return { rows: [{ id: 'm1', body: 'pode ser amanhã?', type: 'text', media_url: null, media_storage_path: null, media_derived_text: null }] };
      }),
    };
  }

  it('a consulta da conversa é escopada por organização e traz o metadata', async () => {
    const db = banco({ [CHAVE_DA_PASSAGEM]: passagem });
    const out = await resolveConversationTurn(db as never, {} as never, { ...entrada, inbound: true },
      portas(roteador(), { intentName: 'entrada', confidence: 0.95 }));
    expect(out.config?.agentId).toBe('agente-horarios');
    const daConversa = db.query.mock.calls.find(([sql]) => sql.includes('from conversations'))!;
    expect(daConversa[0]).toContain('metadata');
    expect(daConversa[0]).toContain('organization_id=$1 and id=$2');
    expect(daConversa[1]).toEqual(['org-1', 'conversa-1']);
  });

  it('metadata sem passagem (ou torto): o roteador segue a régua de sempre', async () => {
    for (const metadata of [{}, null, { [CHAVE_DA_PASSAGEM]: 'lixo' }]) {
      const out = await resolveConversationTurn(banco(metadata) as never, {} as never, { ...entrada, inbound: true },
        portas(roteador(), { intentName: 'entrada', confidence: 0.95 }));
      expect(out.config?.agentId).toBe('agente-entrada');
    }
  });
});
