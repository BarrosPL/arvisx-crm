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
  PADRAO_DE_PALAVRAS_ALEM_DO_TERMO,
  avisosDoFiltro,
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
      max_extra_words: PADRAO_DE_PALAVRAS_ALEM_DO_TERMO,
      action: 'silence',
      reply: null,
      tag: null,
    });
  });
});

describe('termoQueCasa', () => {
  const regra = filtro({ spam: { terms: ['sala', 'Promoção Relâmpago'] } }).rules.spam!;

  it('casa palavra ou expressão inteira, sem diferença de maiúsculas e tolerando espaços a mais', () => {
    expect(termoQueCasa(regra, 'tem SALA livre?')).toBe('sala');
    expect(termoQueCasa(regra, 'olha a promoção   relâmpago!!!')).toBe('Promoção Relâmpago');
  });

  it('o acento distingue: o termo casa como a empresa o escreveu', () => {
    expect(termoQueCasa(regra, 'olha a promocao relampago!!!')).toBeNull();
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
    expect(julgarEntrada(COM_AS_TRES, ['Ganhe dinheiro rapido hoje'])).toMatchObject({
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

// ---------------------------------------------------------------------------
// Revisão de 20/11, item 2.29 — português de verdade. As listas abaixo são de
// uma empresa fictícia; o produto não traz termo nenhum.
// ---------------------------------------------------------------------------

describe('⭐ acento: palavras diferentes não colidem (revisão 20/11, 2.29)', () => {
  it('"para" e "Pará": o termo com acento não casa a palavra sem, e vice-versa', () => {
    const naoAtendeOPara = filtro({ out_of_scope: { terms: ['pará'] } }).rules.out_of_scope!;
    expect(termoQueCasa(naoAtendeOPara, 'pode enviar para mim?')).toBeNull();
    expect(termoQueCasa(naoAtendeOPara, 'entregam no pará?')).toBe('pará');

    const semAcento = filtro({ out_of_scope: { terms: ['para'] } }).rules.out_of_scope!;
    expect(termoQueCasa(semAcento, 'entregam no pará?')).toBeNull();
  });

  it('"coco" e "cocô"', () => {
    const regra = filtro({ offense: { terms: ['cocô'] } }).rules.offense!;
    expect(termoQueCasa(regra, 'quero água de coco')).toBeNull();
    expect(termoQueCasa(regra, 'isso é um cocô')).toBe('cocô');
  });

  it('quem quer barrar as duas grafias põe as duas na lista', () => {
    const regra = filtro({ offense: { terms: ['otário', 'otario'] } }).rules.offense!;
    expect(termoQueCasa(regra, 'seu otário')).toBe('otário');
    expect(termoQueCasa(regra, 'seu otario')).toBe('otario');
  });

  it('acento decomposto (NFD) e composto (NFC) são a mesma palavra', () => {
    const regra = filtro({ offense: { terms: ['cocô'] } }).rules.offense!;
    expect(termoQueCasa(regra, 'isso é um coco\u0302')).toBe('cocô');
  });

  it('whole_message também distingue o acento', () => {
    const regra = filtro({ out_of_scope: { terms: ['pará'], match: 'whole_message' } }).rules.out_of_scope!;
    expect(termoQueCasa(regra, 'Para')).toBeNull();
    expect(termoQueCasa(regra, 'Pará!')).toBe('pará');
  });
});

describe('⭐ nome próprio não casa (revisão 20/11, 2.29)', () => {
  const regra = filtro({ offense: { terms: ['pinto', 'besta', 'rola'] } }).rules.offense!;

  it('sobrenome e nome de gente, com inicial maiúscula no meio da frase', () => {
    expect(termoQueCasa(regra, 'sou o João Pinto')).toBeNull();
    expect(termoQueCasa(regra, 'falei com a Dra. Pinto ontem')).toBeNull();
    expect(termoQueCasa(regra, 'Sr. Pinto, bom dia')).toBeNull();
    expect(termoQueCasa(regra, 'meu nome é Ana Rola')).toBeNull();
    expect(termoQueCasa(regra, 'Olá, Pinto')).toBeNull();
  });

  it('a mesma palavra em minúsculas, no meio da frase, é o termo', () => {
    expect(termoQueCasa(regra, 'você é uma besta')).toBe('besta');
  });

  it('em começo de frase a maiúscula não diz nada: casa', () => {
    expect(termoQueCasa(regra, 'Besta!')).toBe('besta');
    expect(termoQueCasa(regra, 'Que absurdo. Besta')).toBe('besta');
    expect(termoQueCasa(regra, 'Sério? Besta')).toBe('besta');
  });

  it('em caixa alta é grito, não nome: casa', () => {
    expect(termoQueCasa(regra, 'seu BESTA')).toBe('besta');
    expect(termoQueCasa(regra, 'SUA BESTA')).toBe('besta');
  });

  it('expressão de duas palavras: vale a inicial da expressão', () => {
    const duas = filtro({ offense: { terms: ['santa besta'] } }).rules.offense!;
    expect(termoQueCasa(duas, 'moro em Santa Besta')).toBeNull();
    expect(termoQueCasa(duas, 'sua santa besta')).toBe('santa besta');
  });

  it('o limite conhecido: nome escrito em minúsculas não tem como ser reconhecido', () => {
    // É o risco que a rota de configuração avisa (`avisosDoFiltro`).
    expect(termoQueCasa(regra, 'sou o joão pinto')).toBe('pinto');
  });
});

describe('⭐ termo contido em outra palavra não casa (revisão 20/11, 2.29)', () => {
  const regra = filtro({ offense: { terms: ['pinto', 'besta', 'porcaria'] } }).rules.offense!;

  it.each([
    'quero um pintor',
    'vou pintar a casa',
    'que bestagem',
    'gosto de pintos',
    'porcarias à parte',
    'o pintor Pintoresco',
  ])('%s', (mensagem) => {
    expect(termoQueCasa(regra, mensagem)).toBeNull();
  });

  it('letra acentuada colada no termo também é outra palavra', () => {
    const curta = filtro({ offense: { terms: ['sab'] } }).rules.offense!;
    expect(termoQueCasa(curta, 'sabão')).toBeNull();
    expect(termoQueCasa(curta, 'é sábado')).toBeNull();
  });
});

describe('⭐ ofensa + pedido legítimo vai para o modelo (revisão 20/11, 2.29)', () => {
  const ofensa = (extra: Record<string, unknown> = {}) =>
    filtro({ offense: { terms: ['porcaria', 'lixo'], action: 'reply', reply: 'Vamos manter o respeito.', ...extra } });

  it('a reclamação legítima que usa a palavra da lista NÃO é barrada', () => {
    expect(julgarEntrada(ofensa(), ['o atendimento foi uma porcaria, preciso do pedido 123'])).toEqual({
      barra: false,
      motivo: 'mensagem_legitima',
    });
    expect(julgarEntrada(ofensa(), ['que porcaria de serviço, quero meu dinheiro de volta'])).toEqual({
      barra: false,
      motivo: 'mensagem_legitima',
    });
  });

  it('a mensagem que é pouco mais que o termo continua barrada', () => {
    expect(julgarEntrada(ofensa(), ['porcaria'])).toMatchObject({ barra: true, termo: 'porcaria' });
    expect(julgarEntrada(ofensa(), ['que porcaria!'])).toMatchObject({ barra: true });
    expect(julgarEntrada(ofensa(), ['vocês são uma porcaria'])).toMatchObject({ barra: true });
  });

  it('o teto é de palavras ALÉM dos termos: dois termos da lista não contam um contra o outro', () => {
    // Os dois termos saem da conta: sobram "seu" e "sua".
    expect(julgarEntrada(ofensa(), ['seu lixo, sua porcaria'])).toMatchObject({ barra: true });
    expect(julgarEntrada(ofensa(), ['vocês são mesmo uma porcaria'])).toEqual({
      barra: false,
      motivo: 'mensagem_legitima',
    });
  });

  it('emoji antes do termo não desalinha a conta', () => {
    expect(julgarEntrada(ofensa(), ['😡😡 que porcaria'])).toMatchObject({ barra: true, termo: 'porcaria' });
    expect(julgarEntrada(ofensa(), ['😡 a entrega foi uma porcaria e eu quero o reembolso'])).toEqual({
      barra: false,
      motivo: 'mensagem_legitima',
    });
  });

  it('número conta como palavra: "porcaria, pedido 123 atrasado de novo" tem um pedido dentro', () => {
    expect(julgarEntrada(ofensa(), ['porcaria, pedido 123 atrasado de novo'])).toEqual({
      barra: false,
      motivo: 'mensagem_legitima',
    });
  });

  it('a empresa pode alargar a regra — `max_extra_words: null` barra a mensagem de qualquer tamanho', () => {
    expect(
      julgarEntrada(ofensa({ max_extra_words: null }), ['o atendimento foi uma porcaria, preciso do pedido 123']),
    ).toMatchObject({ barra: true, categoria: 'offense' });
  });

  it('ou apertar — `max_extra_words: 0` só barra o termo sozinho', () => {
    expect(julgarEntrada(ofensa({ max_extra_words: 0 }), ['porcaria!!'])).toMatchObject({ barra: true });
    expect(julgarEntrada(ofensa({ max_extra_words: 0 }), ['que porcaria'])).toEqual({
      barra: false,
      motivo: 'mensagem_legitima',
    });
  });

  it('whole_message não usa o teto: a mensagem inteira já é o termo', () => {
    const inteira = filtro({ spam: { terms: ['bom dia grupo'], match: 'whole_message', max_extra_words: 0 } });
    expect(julgarEntrada(inteira, ['Bom dia grupo!'])).toMatchObject({ barra: true });
  });

  it('o teto tem forma: inteiro, de 0 a 200, ou nulo', () => {
    const com = (v: unknown) =>
      filtroDeEntradaSchema.safeParse({ enabled: true, rules: { spam: { terms: ['ok ok'], max_extra_words: v } } })
        .success;
    expect(com(0)).toBe(true);
    expect(com(null)).toBe(true);
    expect(com(200)).toBe(true);
    expect(com(-1)).toBe(false);
    expect(com(1.5)).toBe(false);
    expect(com(201)).toBe(false);
    expect(filtro({ spam: { terms: ['ok ok'] } }).rules.spam!.max_extra_words).toBe(PADRAO_DE_PALAVRAS_ALEM_DO_TERMO);
  });
});

describe('os avisos de falso positivo que a configuração devolve (revisão 20/11, 2.29)', () => {
  it('filtro desligado ou sem termo: nenhum aviso', () => {
    expect(avisosDoFiltro(FILTRO_DESLIGADO)).toEqual([]);
    expect(avisosDoFiltro(filtro({ offense: { terms: ['porcaria'] } }, false))).toEqual([]);
    expect(avisosDoFiltro(filtro({ offense: { terms: [] } }))).toEqual([]);
  });

  it('ligado e com termo: sempre o aviso geral de falso positivo', () => {
    expect(avisosDoFiltro(filtro({ spam: { terms: ['clique no link agora'] } }))).toEqual(['falso_positivo']);
  });

  it('termo de uma palavra só e curta, regra sem teto de palavras e regra que responde têm aviso próprio', () => {
    expect(avisosDoFiltro(filtro({ offense: { terms: ['lixo'] } }))).toEqual(['falso_positivo', 'termo_curto']);
    expect(avisosDoFiltro(filtro({ spam: { terms: ['clique no link agora'], max_extra_words: null } }))).toEqual([
      'falso_positivo',
      'sem_limite_de_palavras',
    ]);
    expect(
      avisosDoFiltro(filtro({ offense: { terms: ['palavra bem feia'], action: 'reply', reply: 'Respeito, por favor.' } })),
    ).toEqual(['falso_positivo', 'resposta_e_modo_assistido']);
  });

  it('regra que pede resposta mas não tem texto não responde: sem o aviso do modo assistido', () => {
    expect(avisosDoFiltro(filtro({ offense: { terms: ['palavra bem feia'], action: 'reply' } }))).toEqual([
      'falso_positivo',
    ]);
  });
});
