/**
 * O colega responde NA MESMA RODADA: depois de `passar_para_colega`, o handler
 * do turno roda o turno do colega no mesmo job.
 *
 * O turno em si é dublado (`rodar`): o que se mede aqui é a decisão de
 * continuar, com que agente, com que abertura e com que travas.
 */
import { describe, expect, it, vi } from 'vitest';

import type { PublishedAgentConfig } from './agent-config';
import { continuarComOColega, type AgentTurnInput } from './inbound-turn';
import type { PassagemAceita } from './passagem-entre-colegas';
import { criarColetorDeFerramentas } from './traco-do-turno';

const aceita: PassagemAceita = {
  paraAgente: 'agente-horarios',
  paraIntencao: 'horarios',
  deAgente: 'agente-entrada',
  deIntencao: 'entrada',
  motivo: 'a pessoa quer marcar um horário',
  resumo: 'Quer um horário na semana que vem. Já informou o nome.',
};

const job = { id: 'job-1', organization_id: 'org-1', contact_id: 'contato-1', kind: 'inbound_turn' } as never;
const deps = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as never;

function rodada(passagem: { aceita: PassagemAceita | null; mensagensEnviadas: number }) {
  return {
    passagem,
    resolvedAgent: { config: null, routerId: 'roteador-1', intentName: 'entrada', confidence: 0.9, outcome: 'classified' as const },
    coletorDaRodada: criarColetorDeFerramentas(),
    channelSessionId: 'canal-1',
    conversationId: 'conversa-1',
    inboundMessageId: 'mensagem-1',
    abertura: (() => 'ABERTURA DO TURNO') as AgentTurnInput['buildOpening'],
  };
}

function colega(overrides: Partial<PublishedAgentConfig> = {}): PublishedAgentConfig {
  return { agentId: 'agente-horarios', versionId: 'v1', ...overrides } as PublishedAgentConfig;
}

describe('continuarComOColega', () => {
  it('sem passagem no turno, nada roda', async () => {
    const rodar = vi.fn();
    const carregarColega = vi.fn();
    await continuarComOColega(deps, job, {} as never, { workerId: 'w' }, rodada({ aceita: null, mensagensEnviadas: 0 }), { rodar, carregarColega });
    expect(rodar).not.toHaveBeenCalled();
    expect(carregarColega).not.toHaveBeenCalled();
  });

  it('com passagem, o colega roda no MESMO job, já resolvido, com o contexto da passagem', async () => {
    const rodar = vi.fn();
    const carregarColega = vi.fn(async () => colega());
    const r = rodada({ aceita, mensagensEnviadas: 0 });
    const pool = {} as never;
    await continuarComOColega(deps, job, pool, { workerId: 'w' }, r, { rodar, carregarColega });

    // A versão publicada do colega é lida na organização do JOB.
    expect(carregarColega).toHaveBeenCalledWith(pool, 'org-1', 'agente-horarios');
    expect(rodar).toHaveBeenCalledTimes(1);
    const [, jobDoColega, , , entrada] = rodar.mock.calls[0]! as [unknown, unknown, unknown, unknown, AgentTurnInput];
    expect(jobDoColega).toBe(job);
    expect(entrada.resolvedAgent).toMatchObject({
      config: { agentId: 'agente-horarios' },
      routerId: 'roteador-1',
      intentName: 'horarios',
      outcome: 'sticky',
    });
    expect(entrada.conversationId).toBe('conversa-1');
    expect(entrada.channelSessionId).toBe('canal-1');
    expect(entrada.inboundMessageId).toBe('mensagem-1');
    // O traço da rodada é uma linha só: os dois turnos registram no mesmo coletor.
    expect(entrada.coletorHerdado).toBe(r.coletorDaRodada);

    const abertura = entrada.buildOpening({} as never);
    expect(abertura.startsWith('ABERTURA DO TURNO')).toBe(true);
    expect(abertura).toContain('Passagem recebida de um colega');
    expect(abertura).toContain(aceita.motivo);
    expect(abertura).toContain(aceita.resumo);
  });

  it('o colega roda SEM poder passar a vez de volta na mesma rodada', async () => {
    const rodar = vi.fn();
    await continuarComOColega(deps, job, {} as never, { workerId: 'w' }, rodada({ aceita, mensagensEnviadas: 0 }), {
      rodar,
      carregarColega: vi.fn(async () => colega()),
    });
    const entrada = rodar.mock.calls[0]![4] as AgentTurnInput;
    expect(entrada.passagemParaColega).toBeUndefined();
  });

  it('quem passou a vez já tinha falado com o cliente: o colega só assume na próxima mensagem', async () => {
    const rodar = vi.fn();
    const carregarColega = vi.fn();
    await continuarComOColega(deps, job, {} as never, { workerId: 'w' }, rodada({ aceita, mensagensEnviadas: 1 }), { rodar, carregarColega });
    expect(rodar).not.toHaveBeenCalled();
    expect(carregarColega).not.toHaveBeenCalled();
  });

  it.each([
    ['sem versão publicada', null],
    ['pausado', colega({ pausedAt: '2026-11-20T00:00:00Z' })],
    ['em modo assistido', colega({ operationMode: 'assisted' })],
  ])('colega %s entre a passagem e a resposta: não roda', async (_caso, config) => {
    const rodar = vi.fn();
    await continuarComOColega(deps, job, {} as never, { workerId: 'w' }, rodada({ aceita, mensagensEnviadas: 0 }), {
      rodar,
      carregarColega: vi.fn(async () => config),
    });
    expect(rodar).not.toHaveBeenCalled();
  });

  it('falha do turno do colega propaga: a fila re-tenta o job, e o colega já está fixado', async () => {
    const rodar = vi.fn().mockRejectedValue(new Error('modelo fora do ar'));
    await expect(
      continuarComOColega(deps, job, {} as never, { workerId: 'w' }, rodada({ aceita, mensagensEnviadas: 0 }), {
        rodar,
        carregarColega: vi.fn(async () => colega()),
      }),
    ).rejects.toThrow('modelo fora do ar');
  });
});
