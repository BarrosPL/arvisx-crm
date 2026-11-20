/**
 * A regra do filtro de entrada, pura: o que barra, o que passa, e o que ela
 * nunca decide. As listas destes testes são exemplos de teste; o módulo não
 * traz termo nenhum.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FILTRO_DESLIGADO,
  filtroDeEntradaSchema,
  julgarEntrada,
  lerFiltroDeEntrada,
  termoQueCasa,
  type FiltroDeEntrada,
} from './filtro-de-entrada';

function filtro(regras: Record<string, unknown>, enabled = true): FiltroDeEntrada {
  return filtroDeEntradaSchema.parse({ enabled, rules: regras });
}

const COM_AS_TRES = filtro({
  offense: { terms: ['palavra feia', 'xingo'], action: 'reply', reply: 'Vamos manter o respeito.', tag: 'ofensa' },
  spam: { terms: ['ganhe dinheiro rapido', 'clique no link'], action: 'silence', tag: 'spam' },
  out_of_scope: { terms: ['bom dia grupo'], match: 'whole_message', action: 'silence' },
});

describe('lerFiltroDeEntrada', () => {
  it('sem configuração, o filtro não existe', () => {
    expect(lerFiltroDeEntrada(null)).toEqual(FILTRO_DESLIGADO);
    expect(lerFiltroDeEntrada({})).toEqual(FILTRO_DESLIGADO);
    expect(lerFiltroDeEntrada({ ai_entry_filter: null })).toEqual(FILTRO_DESLIGADO);
  });

  it('configuração ilegível é desligado, nunca erro', () => {
    expect(lerFiltroDeEntrada({ ai_entry_filter: 'ligado' })).toEqual(FILTRO_DESLIGADO);
    expect(
      lerFiltroDeEntrada({ ai_entry_filter: { enabled: true, rules: { spam: { terms: 'não é lista' } } } }),
    ).toEqual(FILTRO_DESLIGADO);
  });

  it('lê a configuração válida e completa os padrões (silêncio, casar dentro da mensagem)', () => {
    const lido = lerFiltroDeEntrada({
      ai_entry_filter: { enabled: true, rules: { spam: { terms: ['clique no link'] } } },
    });
    expect(lido.enabled).toBe(true);
    expect(lido.rules.spam).toEqual({
      terms: ['clique no link'],
      match: 'contains',
      action: 'silence',
      reply: null,
      tag: null,
    });
  });
});

describe('termoQueCasa', () => {
  const regra = filtro({ spam: { terms: ['sala', 'Promoção Relâmpago'] } }).rules.spam!;

  it('casa palavra ou expressão inteira, sem acento e sem diferença de maiúsculas', () => {
    expect(termoQueCasa(regra, 'tem SALA livre?')).toBe('sala');
    expect(termoQueCasa(regra, 'olha a promocao   relampago!!!')).toBe('Promoção Relâmpago');
  });

  it('não casa pedaço de palavra', () => {
    expect(termoQueCasa(regra, 'quero uma salada')).toBeNull();
    expect(termoQueCasa(regra, 'assalariado')).toBeNull();
  });

  it('whole_message exige a mensagem inteira, tolerando pontuação nas pontas', () => {
    const inteira = filtro({ out_of_scope: { terms: ['bom dia grupo'], match: 'whole_message' } }).rules.out_of_scope!;
    expect(termoQueCasa(inteira, 'Bom dia grupo!')).toBe('bom dia grupo');
    expect(termoQueCasa(inteira, 'Bom dia, grupo')).toBeNull();
    expect(termoQueCasa(inteira, 'bom dia grupo, quero um orçamento')).toBeNull();
  });
});

describe('julgarEntrada', () => {
  it('desligado ou sem lista: não decide nada', () => {
    expect(julgarEntrada(FILTRO_DESLIGADO, ['xingo'])).toEqual({ barra: false, motivo: 'desligado' });
    expect(julgarEntrada(filtro({ offense: { terms: ['xingo'] } }, false), ['xingo'])).toEqual({
      barra: false,
      motivo: 'desligado',
    });
    expect(julgarEntrada(filtro({ offense: { terms: [] } }), ['xingo'])).toEqual({ barra: false, motivo: 'sem_regras' });
  });

  it('barra a ofensa com a resposta curta e o marcador da empresa', () => {
    expect(julgarEntrada(COM_AS_TRES, ['seu XINGO'])).toEqual({
      barra: true,
      categoria: 'offense',
      acao: 'reply',
      resposta: 'Vamos manter o respeito.',
      marcador: 'ofensa',
      termo: 'xingo',
      mensagens: 1,
    });
  });

  it('barra o spam em silêncio, com marcador', () => {
    expect(julgarEntrada(COM_AS_TRES, ['Ganhe dinheiro rápido hoje'])).toMatchObject({
      barra: true,
      categoria: 'spam',
      acao: 'silence',
      resposta: null,
      marcador: 'spam',
    });
  });

  it('regra que pede resposta mas não tem texto vira silêncio', () => {
    const semTexto = filtro({ offense: { terms: ['xingo'], action: 'reply', reply: '   ' } });
    expect(julgarEntrada(semTexto, ['xingo'])).toMatchObject({ barra: true, acao: 'silence', resposta: null });
  });

  it('mensagem legítima passa', () => {
    expect(julgarEntrada(COM_AS_TRES, ['Olá, quero saber o horário de vocês'])).toEqual({
      barra: false,
      motivo: 'mensagem_legitima',
    });
  });

  it('uma mensagem legítima no meio da rajada basta para o modelo entrar', () => {
    expect(julgarEntrada(COM_AS_TRES, ['xingo', 'mas preciso remarcar meu horário'])).toEqual({
      barra: false,
      motivo: 'mensagem_legitima',
    });
  });

  it('rajada inteira barrada: a categoria mais grave nomeia o bloqueio', () => {
    expect(julgarEntrada(COM_AS_TRES, ['clique no link', 'xingo'])).toMatchObject({
      barra: true,
      categoria: 'offense',
      mensagens: 2,
    });
  });

  it('mensagem sem texto (mídia) nunca é barrada', () => {
    expect(julgarEntrada(COM_AS_TRES, [''])).toEqual({ barra: false, motivo: 'mensagem_sem_texto' });
    expect(julgarEntrada(COM_AS_TRES, ['xingo', ''])).toEqual({ barra: false, motivo: 'mensagem_sem_texto' });
    expect(julgarEntrada(COM_AS_TRES, [])).toEqual({ barra: false, motivo: 'sem_mensagem' });
  });

  it('pedido de pessoa e opt-out são de outra porta: o filtro não decide', () => {
    const outraPorta = (m: string) => m.includes('atendente');
    expect(julgarEntrada(COM_AS_TRES, ['xingo, quero um atendente'], outraPorta)).toEqual({
      barra: false,
      motivo: 'outra_porta_decide',
    });
  });
});

describe('a configuração tem teto', () => {
  it('recusa termo curto demais, lista longa demais e resposta longa demais', () => {
    expect(filtroDeEntradaSchema.safeParse({ enabled: true, rules: { spam: { terms: ['a'] } } }).success).toBe(false);
    const longa = Array.from({ length: 201 }, (_, i) => `termo ${i}`);
    expect(filtroDeEntradaSchema.safeParse({ enabled: true, rules: { spam: { terms: longa } } }).success).toBe(false);
    expect(
      filtroDeEntradaSchema.safeParse({ enabled: true, rules: { spam: { terms: ['ok ok'], reply: 'x'.repeat(501) } } })
        .success,
    ).toBe(false);
  });
});

describe('nenhuma palavra no código', () => {
  it('o módulo da regra e o do turno não trazem lista de termos', () => {
    for (const arquivo of ['guardrails/filtro-de-entrada.ts', 'agent/filtro-de-entrada-no-turno.ts']) {
      const fonte = readFileSync(join(process.cwd(), 'lib/agent-engine', arquivo), 'utf8');
      // Uma lista de palavras no código teria a forma de um array de textos
      // atribuído a `terms` ou a uma constante de termos.
      expect(fonte, arquivo).not.toMatch(/terms\s*:\s*\[\s*['"]/);
      expect(fonte, arquivo).not.toMatch(/(?:TERMOS|PALAVRAS|OFENSAS|SPAM)[A-Z_]*\s*(?::[^=]+)?=\s*\[/);
    }
  });
});
