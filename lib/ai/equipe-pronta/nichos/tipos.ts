/**
 * EQUIPE PRONTA — a camada de NICHO, separada dos papéis.
 *
 * Os quatro papéis (`../papeis/`) são universais e continuam proibidos de citar
 * ramo (`../papeis.test.ts`). O que é próprio de um ramo mora AQUI, num
 * `PacoteDeNicho`, e entra por duas portas só:
 *
 *   1. pré-preenche o questionário (`../questionario.ts`, `padroesDoPacote`):
 *      a empresa vê as perguntas e as situações sugeridas e edita o que quiser;
 *   2. complementa o bloco gerado "## Esta empresa" (`../renderizar.ts`) com as
 *      regras duras e o vocabulário do ramo.
 *
 * O pacote NÃO altera o texto de nenhum papel, não cria agente, não muda
 * ferramenta e não ativa nada: a equipe continua nascendo em ensaio.
 *
 * Para acrescentar um ramo: um arquivo novo nesta pasta, com um `PacoteDeNicho`,
 * e uma linha em `./index.ts`. Nenhum outro arquivo precisa mudar.
 */

/** Os ramos que têm pacote. `generico` não é pacote: é a ausência de um. */
export const NICHOS_COM_PACOTE = ["advocacia"] as const;
export type NichoId = (typeof NICHOS_COM_PACOTE)[number];

/** O valor do campo "tipo de negócio" do questionário. */
export const TIPOS_DE_NEGOCIO = ["generico", ...NICHOS_COM_PACOTE] as const;
export type TipoDeNegocio = (typeof TIPOS_DE_NEGOCIO)[number];

export interface TermoDoRamo {
  termo: string;
  /** O que o termo quer dizer NA CONVERSA: serve para reconhecer o assunto, não para explicar. */
  significado: string;
}

export interface PacoteDeNicho {
  id: NichoId;
  /** O rótulo da opção no questionário. */
  nome: string;
  /**
   * Sobe a cada mudança do conteúdo. O texto do pacote entra no bloco gerado,
   * então mudar o pacote muda o que o renderizador gera — e a atualização segue
   * a regra do instalador: reaplica no agente que está como foi instalado, e
   * para no que foi editado à mão.
   */
  versao: number;
  /**
   * `false` = rascunho, ainda não validado com um cliente real do ramo. A tela
   * mostra o aviso enquanto for `false`.
   */
  validadoComClienteReal: boolean;
  /** Quem precisa revisar o conteúdo antes de ele valer como validado. */
  revisaoPendente: string;

  // ── pré-preenchimento do questionário ────────────────────────────────────
  /** Até cinco (o teto do questionário), uma pergunta por item. */
  perguntasDeQualificacao: readonly string[];
  /** Somadas às situações padrão de "chamar uma pessoa". */
  situacoesDeHumano: readonly string[];
  /**
   * Modelo de perguntas frequentes, SÓ com campos a preencher. Cada item é um
   * parágrafo: a pergunta numa linha e, na seguinte, o campo marcado com
   * `MARCA_DE_CAMPO_A_PREENCHER`. Item que a empresa não preencher não chega à
   * base de conhecimento (`semCamposPorPreencher`).
   */
  faqModelo: string;
  /** Sugestão de nomes de etapa para o funil. Só orienta: nada é criado nem renomeado. */
  etapasSugeridas: readonly string[];

  // ── complemento do contexto do agente ────────────────────────────────────
  vocabulario: readonly TermoDoRamo[];
  /** As regras que o agente nunca quebra. Entram literais no prompt montado. */
  regrasDuras: readonly string[];
  /** As regras duras numa frase, para a tela dizer a quem escolhe o ramo o que os agentes não fazem. */
  resumoDasRegras: string;
}

/** O começo de todo campo que a empresa precisa preencher no modelo de perguntas. */
export const MARCA_DE_CAMPO_A_PREENCHER = "[PREENCHER";
