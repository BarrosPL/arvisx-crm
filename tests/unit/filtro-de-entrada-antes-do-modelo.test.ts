/**
 * O FILTRO DE ENTRADA BARRA ANTES DE QUALQUER MODELO, e não barra mensagem
 * legítima.
 *
 * Roda o handler REAL do `inbound_turn` (`createInboundTurnHandler`) com
 * espiões nas duas coisas que gastam modelo neste caminho: a escolha do agente
 * (o roteador e o classificador de intenção) e o redator (`generateReplyDraft`,
 * a chamada de modelo do agente assistido deste harness).
 *
 * O harness de mocks é o de `assistido-respeita-o-gate.test.ts`, de propósito:
 * muda só a variável em teste, que aqui é a configuração do filtro da empresa.
 * As listas são exemplos de teste; o produto não traz termo nenhum.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublishedAgentConfig } from '@/lib/agent-engine/agent/agent-config';

const mocks = vi.hoisted(() => ({
  router: vi.fn(), classify: vi.fn(), byId: vi.fn(), bySession: vi.fn(), conversationAgent: vi.fn(),
  draft: vi.fn(), operation: vi.fn(), handoff: vi.fn(), elegibilidade: vi.fn(), beforeSend: vi.fn(),
}));
vi.mock('@/lib/agent-engine/agent/router-config', () => ({ loadActiveRouter: mocks.router }));
vi.mock('@/lib/agent-engine/agent/intent-classifier', () => ({ classifyIntent: mocks.classify }));
vi.mock('@/lib/agent-engine/agent/agent-config', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  loadPublishedAgentConfigById: mocks.byId, loadPublishedAgentConfig: mocks.bySession,
  loadConversationAgentConfig: mocks.conversationAgent,
  escolherAgenteDoNumero: async (...a: unknown[]) => ({ config: await (mocks.bySession as (...x: unknown[]) => unknown)(...a), motivo: 'primeiro_da_fila' }),
}));
vi.mock('@/lib/agent-engine/agent/reply-drafts', () => ({ generateReplyDraft: mocks.draft }));
vi.mock('@/lib/atendimento/fronteira-server', () => ({
  currentExecutionBoundary: () => undefined, setExecutionAgentOperation: mocks.operation,
  guardServiceEffect: vi.fn(),
}));
vi.mock('@/lib/agent-engine/agent/human-handoff', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), isLeadInHandoff: mocks.handoff,
}));
vi.mock('@/lib/escalacao/assunto-comercial', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), comercialExigeHumano: vi.fn(async () => false),
}));
vi.mock('@/lib/agent-engine/guardrails/camadas-da-org', () => ({
  lerCamadasDaOrg: vi.fn(async () => ({})), camadaLigada: vi.fn(() => false),
}));
vi.mock('@/lib/agent-engine/agent/fuso-da-org', () => ({ fusoDaOrganizacao: vi.fn(async () => 'UTC') }));
vi.mock('@/lib/ai/elegibilidade/consulta-pg', () => ({ decidirElegibilidadeDaConversa: mocks.elegibilidade }));
vi.mock('@/lib/agent-engine/pacing/store', () => ({ loadChannelKnobs: vi.fn(async () => ({ knobs: {} })) }));
vi.mock('@/lib/agent-engine/pacing/engine', () => ({ janelaDeEnvioAberta: () => true, proximaAberturaDaJanela: vi.fn() }));
vi.mock('@/lib/agent-engine/pacing/aviso-de-janela', () => ({
  resolverAvisoDeJanela: vi.fn(async () => 0), avisarJanelaFechada: vi.fn(),
}));
// A cadeia de envio é dublada: o que se mede aqui é QUE o filtro envia por ela
// (e o que ele pede a ela), não os gates, que têm os testes deles.
vi.mock('@/lib/agent-engine/guardrails/before-send', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), runBeforeSend: mocks.beforeSend,
}));

import { createInboundTurnHandler, type InboundTurnDeps } from '@/lib/agent-engine/agent/inbound-turn';

const ids = {
  org: '12000000-0000-4000-8000-000000000001', contact: '12000000-0000-4000-8000-000000000002',
  conversation: '12000000-0000-4000-8000-000000000003', channel: '12000000-0000-4000-8000-000000000004',
  job: '12000000-0000-4000-8000-000000000005',
};
const job = {
  id: ids.job, organization_id: ids.org, contact_id: ids.contact, kind: 'inbound_turn',
  payload: { conversation_id: ids.conversation, contact_id: ids.contact, channel_session_id: ids.channel,
    inbound_message_id: '12000000-0000-4000-8000-000000000006', crm_event_id: '12000000-0000-4000-8000-000000000007' },
};
const channelSend = vi.fn(async () => ({ kind: 'sent' as const, idempotencyKey: 'k', messageId: 'm' }));
const deps = {
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  llmCfg: {}, crmCfg: {}, knobs: {},
  channel: () => ({ send: channelSend }),
} as unknown as InboundTurnDeps;
const assistido = {
  agentId: 'A', versionId: 'version-A', operationRevision: '7', operationMode: 'assisted', pausedAt: null,
  handoffKeywords: [] as string[],
} as PublishedAgentConfig;

/** As listas de EXEMPLO deste teste: a empresa fictícia escreveu estas. */
const FILTRO_DA_EMPRESA = {
  enabled: true,
  rules: {
    offense: { terms: ['xingo de teste'], action: 'reply', reply: 'Vamos manter o respeito, por favor.', tag: 'ofensa' },
    spam: { terms: ['clique no link de teste'], action: 'silence', tag: 'spam' },
  },
};

interface Cenario {
  filtro: unknown;
  /** As falas pendentes do cliente, da mais nova para a mais antiga. */
  falas: string[];
  ultimaSaida?: string | null;
  filtroLanca?: boolean;
  /**
   * O número tem agente publicado em modo assistido? (a pergunta do dreno).
   * Padrão `false`: os casos de cima medem o número só com agente automático.
   */
  assistidoNoNumero?: boolean;
  /** A leitura do modo do número falha. */
  modoLanca?: boolean;
}

function pool(cenario: Cenario) {
  mocks.router.mockResolvedValue(null);
  mocks.byId.mockResolvedValue(assistido);
  mocks.bySession.mockResolvedValue(assistido);
  mocks.conversationAgent.mockResolvedValue(assistido);
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    consultas.push({ sql, params });
    if (sql.includes("settings -> 'ai_entry_filter'")) {
      if (cenario.filtroLanca) throw new Error('connection terminated');
      return { rows: [{ filtro: cenario.filtro }] };
    }
    if (sql.includes("a.operation_mode = 'assisted'")) {
      if (cenario.modoLanca) throw new Error('connection terminated');
      return { rows: [{ available: cenario.assistidoNoNumero === true }] };
    }
    if (sql.includes("m.direction = 'inbound'")) return { rows: cenario.falas.map((body) => ({ body })) };
    if (sql.includes("m.direction = 'outbound'")) {
      return { rows: cenario.ultimaSaida == null ? [] : [{ body: cenario.ultimaSaida }] };
    }
    if (sql.includes('from contacts where organization_id')) {
      return { rows: [{ is_blocked: false, is_anonymized: false, source: null, consent: null }] };
    }
    return { rows: [{ active_ai_agent_id: null, active_intent: null, body: cenario.falas[0] ?? 'oi' }] };
  });
  return { p: { query }, consultas };
}

const rodar = (p: unknown) => createInboundTurnHandler(deps)(job as never, p as never, { workerId: 'worker' });

/** Nenhuma das chamadas de modelo deste caminho aconteceu. */
function nenhumModeloFoiChamado() {
  expect(mocks.router, 'o roteador (escolha do agente) foi consultado').not.toHaveBeenCalled();
  expect(mocks.classify, 'o classificador de intenção foi chamado').not.toHaveBeenCalled();
  expect(mocks.bySession, 'o agente do número foi carregado').not.toHaveBeenCalled();
  expect(mocks.draft, 'o redator foi chamado').not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handoff.mockResolvedValue(false);
  mocks.elegibilidade.mockResolvedValue({ permite: true, motivo: 'gate_aberto' });
  mocks.beforeSend.mockImplementation(async (args: { body: string; send: (b: string) => Promise<unknown> }) => ({
    status: 'sent', outcome: await args.send(args.body), trace: [],
  }));
});

describe('o filtro de entrada barra sem chamar o modelo', () => {
  it('ofensa da lista da empresa: nenhum modelo, a resposta curta sai pela cadeia de envio, a conversa é marcada', async () => {
    const { p, consultas } = pool({ filtro: FILTRO_DA_EMPRESA, falas: ['seu XINGO DE TESTE'] });
    await rodar(p);

    nenhumModeloFoiChamado();

    expect(mocks.beforeSend).toHaveBeenCalledOnce();
    expect(mocks.beforeSend.mock.calls[0]![0]).toMatchObject({
      tenantId: ids.org, leadId: ids.contact, jobId: ids.job, channelSessionId: ids.channel,
      body: 'Vamos manter o respeito, por favor.',
      // Texto fixo da empresa: não passa pelo gate de variação nem pelo comercial.
      enforceSpinning: false, enforceCommercialRestriction: false,
    });
    expect(channelSend).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: ids.org, conversationId: ids.conversation, seq: 1, body: 'Vamos manter o respeito, por favor.',
    }));

    const marcacao = consultas.find((c) => c.sql.includes('update conversations'));
    expect(marcacao?.params).toEqual([ids.org, ids.conversation, 'ofensa']);
  });

  it('spam da lista: silêncio (nada é enviado), com o marcador', async () => {
    const { p, consultas } = pool({ filtro: FILTRO_DA_EMPRESA, falas: ['Clique no link de teste agora'] });
    await rodar(p);

    nenhumModeloFoiChamado();
    expect(mocks.beforeSend).not.toHaveBeenCalled();
    expect(channelSend).not.toHaveBeenCalled();
    expect(consultas.find((c) => c.sql.includes('update conversations'))?.params).toEqual([ids.org, ids.conversation, 'spam']);
  });

  it('o bloqueio fica no traço do turno, com a categoria e o que foi feito, sem a fala do cliente', async () => {
    const { p, consultas } = pool({ filtro: FILTRO_DA_EMPRESA, falas: ['seu xingo de teste'] });
    await rodar(p);

    const traco = consultas.find((c) => c.sql.includes('insert into public.agent_turn_traces'));
    expect(traco, 'o turno barrado não deixou linha em agent_turn_traces').toBeDefined();
    const params = traco!.params;
    expect(params[0]).toBe(ids.org);
    expect(params[1]).toBe(ids.job);
    expect(params[4]).toBe(ids.conversation);
    expect(params[9]).toBe('completed');
    expect(params[10]).toBe('filtro_de_entrada');
    // Uma mensagem saiu: a resposta curta.
    expect(params[15]).toBe(1);
    const ferramentas = JSON.parse(params[17] as string) as Array<Record<string, unknown>>;
    expect(ferramentas).toHaveLength(1);
    expect(ferramentas[0]).toMatchObject({ nome: 'filtro_de_entrada', estado: 'recusado', erro: 'offense' });
    const resultado = JSON.parse(ferramentas[0]!.resultado as string) as Record<string, unknown>;
    expect(resultado).toMatchObject({
      acao: 'reply', resposta_enviada: true, marcador: 'ofensa', marcador_gravado: true, termo: 'xingo de teste', mensagens: 1,
    });
    expect(JSON.stringify(params), 'a fala do cliente foi parar no traço').not.toContain('seu xingo de teste');
  });

  it('não repete a resposta curta: se ela já é a última mensagem que saiu, fica em silêncio', async () => {
    const { p } = pool({
      filtro: FILTRO_DA_EMPRESA, falas: ['xingo de teste'], ultimaSaida: 'Vamos manter o respeito, por favor.',
    });
    await rodar(p);

    nenhumModeloFoiChamado();
    expect(mocks.beforeSend).not.toHaveBeenCalled();
    expect(channelSend).not.toHaveBeenCalled();
  });

  it('a cadeia de envio veta a resposta (opt-out, janela): o turno segue barrado e o traço diz por quê', async () => {
    mocks.beforeSend.mockResolvedValue({ status: 'vetoed', gate: 'stop', code: 'contato_bloqueado', message: '', trace: [] });
    const { p, consultas } = pool({ filtro: FILTRO_DA_EMPRESA, falas: ['xingo de teste'] });
    await rodar(p);

    nenhumModeloFoiChamado();
    expect(channelSend).not.toHaveBeenCalled();
    const params = consultas.find((c) => c.sql.includes('insert into public.agent_turn_traces'))!.params;
    expect(params[15]).toBe(0);
    expect(params[17] as string).toContain('contato_bloqueado');
  });
});

describe('o filtro de entrada não barra o que não é dele', () => {
  // Controle positivo: sem estes casos, um `return` cedo demais deixaria os de
  // cima verdes por AUSÊNCIA, com o atendimento inteiro mudo.
  it('mensagem legítima passa: o agente é escolhido e o redator roda', async () => {
    const { p, consultas } = pool({ filtro: FILTRO_DA_EMPRESA, falas: ['Olá, quero remarcar meu horário'] });
    await rodar(p);

    expect(mocks.bySession).toHaveBeenCalled();
    expect(mocks.draft).toHaveBeenCalledOnce();
    expect(mocks.beforeSend).not.toHaveBeenCalled();
    expect(consultas.some((c) => c.sql.includes('update conversations'))).toBe(false);
    expect(consultas.some((c) => c.sql.includes('insert into public.agent_turn_traces'))).toBe(false);
  });

  it('uma mensagem legítima na mesma rajada de uma barrada: o modelo entra', async () => {
    const { p } = pool({ filtro: FILTRO_DA_EMPRESA, falas: ['mas preciso do endereço de vocês', 'xingo de teste'] });
    await rodar(p);
    expect(mocks.draft).toHaveBeenCalledOnce();
  });

  it('filtro desligado ou ausente: o turno segue como antes, sem ler as mensagens para o filtro', async () => {
    for (const filtro of [null, undefined, { ...FILTRO_DA_EMPRESA, enabled: false }]) {
      vi.clearAllMocks();
      mocks.handoff.mockResolvedValue(false);
      mocks.elegibilidade.mockResolvedValue({ permite: true, motivo: 'gate_aberto' });
      const { p, consultas } = pool({ filtro, falas: ['xingo de teste'] });
      await rodar(p);
      expect(mocks.draft, 'filtro desligado calou o atendimento').toHaveBeenCalledOnce();
      expect(consultas.some((c) => c.sql.includes("m.direction = 'inbound'"))).toBe(false);
    }
  });

  it('pedido de pessoa junto de um termo da lista: o filtro não decide, a mensagem segue para o turno', async () => {
    const { p, consultas } = pool({ filtro: FILTRO_DA_EMPRESA, falas: ['xingo de teste, quero falar com um atendente'] });
    // Daqui em diante o turno entra na passagem para humano, que este dublê de
    // banco não sustenta: o que se mede é que o filtro NÃO o encerrou antes.
    await rodar(p).catch(() => undefined);
    expect(mocks.beforeSend, 'o filtro respondeu a quem pediu uma pessoa').not.toHaveBeenCalled();
    expect(consultas.some((c) => c.sql.includes('update conversations') && c.params[2] === 'ofensa')).toBe(false);
    expect(consultas.some((c) => c.sql.includes('insert into public.agent_turn_traces'))).toBe(false);
    expect(mocks.bySession, 'o turno não seguiu para as detecções de pedido de pessoa').toHaveBeenCalled();
  });

  it('mensagem sem texto (mídia) não é barrada', async () => {
    const { p } = pool({ filtro: FILTRO_DA_EMPRESA, falas: [''] });
    await rodar(p);
    expect(mocks.bySession).toHaveBeenCalled();
  });

  it('configuração ilegível ou leitura que falha degrada ABERTO: o atendimento não emudece', async () => {
    const quebrado = pool({ filtro: { enabled: true, rules: { spam: { terms: 'não é lista' } } }, falas: ['xingo de teste'] });
    await rodar(quebrado.p);
    expect(mocks.draft).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    mocks.handoff.mockResolvedValue(false);
    mocks.elegibilidade.mockResolvedValue({ permite: true, motivo: 'gate_aberto' });
    const fora = pool({ filtro: FILTRO_DA_EMPRESA, falas: ['xingo de teste'], filtroLanca: true });
    await rodar(fora.p);
    expect(mocks.draft).toHaveBeenCalledOnce();
  });

  it('as travas de pessoa vêm ANTES: conversa assumida nem chega ao filtro', async () => {
    mocks.elegibilidade.mockResolvedValue({ permite: false, motivo: 'conversa_de_humano' });
    const { p, consultas } = pool({ filtro: FILTRO_DA_EMPRESA, falas: ['xingo de teste'] });
    await rodar(p);
    expect(consultas.some((c) => c.sql.includes("settings -> 'ai_entry_filter'"))).toBe(false);
    expect(mocks.beforeSend).not.toHaveBeenCalled();
    nenhumModeloFoiChamado();
  });
});

// ---------------------------------------------------------------------------
// Revisão de 20/11, item 2.29: a resposta do filtro respeita o modo assistido.
// ---------------------------------------------------------------------------

describe('⭐ a resposta do filtro respeita o modo assistido (revisão 20/11, 2.29)', () => {
  it('regra `reply` num número com agente assistido: NADA sai sozinho, e o turno segue para a pessoa aprovar', async () => {
    const { p, consultas } = pool({ filtro: FILTRO_DA_EMPRESA, falas: ['seu xingo de teste'], assistidoNoNumero: true });
    await rodar(p);

    expect(mocks.beforeSend, 'a resposta automática saiu num número assistido').not.toHaveBeenCalled();
    expect(channelSend).not.toHaveBeenCalled();
    // O filtro não decidiu: nem marcador, nem traço de turno barrado.
    expect(consultas.some((c) => c.sql.includes('update conversations') && c.params[2] === 'ofensa')).toBe(false);
    expect(consultas.some((c) => c.sql.includes('insert into public.agent_turn_traces'))).toBe(false);
    // O turno seguiu: o agente foi escolhido e o rascunho foi proposto.
    expect(mocks.bySession).toHaveBeenCalled();
    expect(mocks.draft).toHaveBeenCalledOnce();
  });

  it('a pergunta é feita para a organização e o número DO JOB', async () => {
    const { p, consultas } = pool({ filtro: FILTRO_DA_EMPRESA, falas: ['seu xingo de teste'], assistidoNoNumero: true });
    await rodar(p);
    const pergunta = consultas.find((c) => c.sql.includes("a.operation_mode = 'assisted'"));
    expect(pergunta?.params).toEqual([ids.org, ids.channel]);
    expect(pergunta?.sql).toContain('a.organization_id = $1');
  });

  it('regra `silence` num número com agente assistido: continua barrando — não há o que enviar', async () => {
    const { p, consultas } = pool({
      filtro: FILTRO_DA_EMPRESA, falas: ['Clique no link de teste agora'], assistidoNoNumero: true,
    });
    await rodar(p);

    nenhumModeloFoiChamado();
    expect(mocks.beforeSend).not.toHaveBeenCalled();
    expect(consultas.find((c) => c.sql.includes('update conversations'))?.params).toEqual([ids.org, ids.conversation, 'spam']);
    // Regra de silêncio nem pergunta o modo.
    expect(consultas.some((c) => c.sql.includes("a.operation_mode = 'assisted'"))).toBe(false);
  });

  it('sem conseguir ler o modo do número: a resposta automática NÃO sai, e o turno segue', async () => {
    const { p } = pool({ filtro: FILTRO_DA_EMPRESA, falas: ['seu xingo de teste'], modoLanca: true });
    await rodar(p);

    expect(mocks.beforeSend).not.toHaveBeenCalled();
    expect(channelSend).not.toHaveBeenCalled();
    expect(mocks.draft).toHaveBeenCalledOnce();
  });

  it('número só com agente automático: a resposta curta sai, como antes', async () => {
    const { p } = pool({ filtro: FILTRO_DA_EMPRESA, falas: ['seu xingo de teste'], assistidoNoNumero: false });
    await rodar(p);

    nenhumModeloFoiChamado();
    expect(mocks.beforeSend).toHaveBeenCalledOnce();
  });
});

describe('⭐ ofensa + pedido legítimo, pelo handler (revisão 20/11, 2.29)', () => {
  it('a reclamação que usa a palavra da lista e traz um pedido vai para o modelo', async () => {
    const { p, consultas } = pool({
      filtro: FILTRO_DA_EMPRESA,
      falas: ['isso foi um xingo de teste, mas eu preciso mesmo é do pedido 123 de volta'],
    });
    await rodar(p);

    expect(mocks.draft, 'a reclamação legítima ficou sem resposta').toHaveBeenCalledOnce();
    expect(mocks.beforeSend).not.toHaveBeenCalled();
    expect(consultas.some((c) => c.sql.includes('insert into public.agent_turn_traces'))).toBe(false);
  });
});
