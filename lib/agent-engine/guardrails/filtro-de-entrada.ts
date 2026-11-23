/**
 * O FILTRO DE ENTRADA: a mensagem que não precisa de modelo não chama modelo.
 *
 * Ofensa, spam e assunto claramente fora do que a empresa atende são tratados
 * por REGRA, antes do roteador e do redator, sem gastar token. A empresa
 * escolhe, por categoria, o que acontece: uma resposta curta, escrita por ela,
 * ou silêncio. Nos dois casos a conversa pode ganhar um marcador, para a
 * equipe achar depois.
 *
 * ## O que já existia, e o que este arquivo NÃO repete
 *
 * As outras portas do começo do turno continuam onde estão, e vêm ANTES:
 *
 *   - pedido de pessoa e opt-out (`human-handoff.ts`, `lib/opt-out/deteccao.ts`):
 *     regras fixas do produto, que passam a conversa para a equipe. O filtro
 *     nunca as atropela: mensagem que pede uma pessoa ou pede para parar segue
 *     para elas, mesmo que também case um termo da lista (`deixarPassar`);
 *   - valores e negociação só com a equipe (`lib/escalacao/assunto-comercial.ts`);
 *   - palavra-chave de ENTRADA da versão publicada (`palavra-chave-do-gatilho.ts`):
 *     é o contrário deste filtro (só entra se casar), é por agente e só vale
 *     até o agente falar a primeira vez;
 *   - o classificador de manipulação (`./jailbreak/classifier.ts`): consulta um
 *     modelo, é só aviso, e roda depois.
 *
 * ## Nenhuma palavra no código
 *
 * As listas são da empresa (`organizations.settings.ai_entry_filter`). Este
 * arquivo não traz termo nenhum, de nicho nenhum: sem lista configurada, o
 * filtro não existe e o turno segue exatamente como antes. As três categorias
 * são só rótulos para a empresa organizar as listas e para o traço dizer qual
 * regra barrou; o código não trata uma diferente da outra.
 *
 * ## Como casa
 *
 * Sem diferença de maiúsculas. `contains` casa o termo como palavra ou
 * expressão INTEIRA dentro da mensagem (o termo "sala" não casa "salada");
 * `whole_message` exige que a mensagem inteira seja o termo. Não há expressão
 * regular vinda da configuração: um padrão ruim travaria o worker.
 *
 * ## Onde uma lista de palavras erra, e o que a regra faz a respeito
 *
 * Uma lista não entende contexto. A revisão de 20/11 (item 2.29) apontou os
 * falsos positivos, e a regra passou a errar para o lado de RESPONDER em cada
 * um — a palavra inteira continua sendo o critério:
 *
 *   - **O ACENTO DISTINGUE.** "para" e "Pará", "coco" e "cocô", "sábia" e
 *     "sabia" são palavras diferentes; tirar o acento antes de comparar fazia
 *     um termo da lista barrar a palavra comum que só se parece com ele. O
 *     termo casa como a empresa o escreveu. Quem quer barrar as duas grafias
 *     (o cliente que digita sem acento) põe as duas na lista.
 *
 *   - **NOME PRÓPRIO NÃO CASA.** Palavra com inicial maiúscula no MEIO da
 *     frase ("falei com a Dra. Pinto", "moro em Rolândia") é nome de gente ou
 *     de lugar, e não o termo da lista. Em começo de frase, ou na mensagem toda
 *     em maiúsculas, a caixa não diz nada e o termo casa normalmente. Quem
 *     escreve tudo em minúsculas não tem essa proteção — é o risco que a tela
 *     de configuração avisa.
 *
 *   - **OFENSA + PEDIDO LEGÍTIMO PASSA.** Em `contains`, a regra só barra a
 *     mensagem que é pouco mais que o termo: no máximo `max_extra_words`
 *     palavras além dos termos da lista (padrão
 *     `PADRAO_DE_PALAVRAS_ALEM_DO_TERMO`). "seu xingo" é barrada; "o atendimento
 *     foi um xingo, preciso do pedido 123" tem um pedido dentro e vai para o
 *     modelo. A empresa pode alargar por regra (`max_extra_words: null` = sem
 *     limite, o comportamento de antes — útil para frase de spam, que costuma
 *     vir no meio de um texto longo), sabendo do risco.
 *
 * ## Falha para o lado de responder
 *
 * O filtro só barra quando TODAS as mensagens pendentes do cliente casam
 * alguma regra. Uma mensagem legítima no meio de uma rajada basta para o
 * modelo entrar. Mensagem sem texto (mídia), configuração ilegível ou lista
 * vazia: o turno segue. Barrar de menos custa uma chamada de modelo; barrar de
 * mais cala um cliente.
 */
import { z } from "zod";

/** As categorias, na ordem em que nomeiam o bloqueio quando mais de uma casa. */
export const CATEGORIAS_DO_FILTRO = ["offense", "spam", "out_of_scope"] as const;
export type CategoriaDoFiltro = (typeof CATEGORIAS_DO_FILTRO)[number];

export const MODOS_DE_CASAMENTO = ["contains", "whole_message"] as const;
export const ACOES_DO_FILTRO = ["reply", "silence"] as const;
export type AcaoDoFiltro = (typeof ACOES_DO_FILTRO)[number];

/** Tetos da configuração: o que a porta da API recusa e o leitor corta. */
export const MAX_TERMOS_POR_CATEGORIA = 200;
export const MAX_TAMANHO_DO_TERMO = 80;
export const MAX_TAMANHO_DA_RESPOSTA = 500;
export const MAX_TAMANHO_DO_MARCADOR = 40;

/**
 * Em `contains`, quantas palavras a mensagem pode ter ALÉM dos termos da lista
 * e ainda ser barrada. Mais que isso, há conteúdo próprio na mensagem (um
 * pedido, uma reclamação) e ela vai para o modelo.
 */
export const PADRAO_DE_PALAVRAS_ALEM_DO_TERMO = 3;
export const MAX_PALAVRAS_ALEM_DO_TERMO = 200;

const termoSchema = z.string().trim().min(2).max(MAX_TAMANHO_DO_TERMO);

/**
 * Uma categoria. `reply` só é usada com `action: "reply"`; sem texto, a ação
 * vira silêncio (não há o que enviar). `tag` é o marcador gravado na conversa.
 */
export const regraDoFiltroSchema = z.object({
  terms: z.array(termoSchema).max(MAX_TERMOS_POR_CATEGORIA).default([]),
  match: z.enum(MODOS_DE_CASAMENTO).default("contains"),
  /**
   * Só para `contains`: o teto de palavras além dos termos. `null` = sem
   * limite (barra a mensagem de qualquer tamanho que contenha o termo).
   */
  max_extra_words: z
    .number()
    .int()
    .min(0)
    .max(MAX_PALAVRAS_ALEM_DO_TERMO)
    .nullable()
    .default(PADRAO_DE_PALAVRAS_ALEM_DO_TERMO),
  action: z.enum(ACOES_DO_FILTRO).default("silence"),
  reply: z.string().trim().max(MAX_TAMANHO_DA_RESPOSTA).nullable().default(null),
  tag: z.string().trim().min(1).max(MAX_TAMANHO_DO_MARCADOR).nullable().default(null),
});
export type RegraDoFiltro = z.infer<typeof regraDoFiltroSchema>;

/** `organizations.settings.ai_entry_filter`. Nasce desligado e sem lista. */
export const filtroDeEntradaSchema = z.object({
  enabled: z.boolean().default(false),
  rules: z
    .object({
      offense: regraDoFiltroSchema.optional(),
      spam: regraDoFiltroSchema.optional(),
      out_of_scope: regraDoFiltroSchema.optional(),
    })
    .default({}),
});
export type FiltroDeEntrada = z.infer<typeof filtroDeEntradaSchema>;

export const FILTRO_DESLIGADO: FiltroDeEntrada = { enabled: false, rules: {} };

/** A chave de `organizations.settings` onde o filtro mora. */
export const CHAVE_DO_FILTRO_DE_ENTRADA = "ai_entry_filter";

/**
 * Lê o filtro de `organizations.settings` sem nunca lançar. Ausente ou
 * ilegível é desligado: o turno segue como antes.
 */
export function lerFiltroDeEntrada(settings: unknown): FiltroDeEntrada {
  if (!settings || typeof settings !== "object") return FILTRO_DESLIGADO;
  const cru = (settings as Record<string, unknown>)[CHAVE_DO_FILTRO_DE_ENTRADA];
  if (cru === undefined || cru === null) return FILTRO_DESLIGADO;
  const lido = filtroDeEntradaSchema.safeParse(cru);
  return lido.success ? lido.data : FILTRO_DESLIGADO;
}

/** Espaços em um só e forma canônica do acento (NFC). A caixa e o acento FICAM. */
function arrumar(texto: string): string {
  return texto.normalize("NFC").replace(/\s+/gu, " ").trim();
}

/**
 * Minúsculas e espaços em um só. O ACENTO FICA: "para" e "pará" são palavras
 * diferentes (ver o cabeçalho).
 */
export function normalizarParaOFiltro(texto: string): string {
  return arrumar(texto).toLowerCase();
}

/** Para `whole_message`: a mensagem sem a pontuação das pontas. */
function semPontuacaoNasPontas(texto: string): string {
  return texto.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

const LETRA_OU_DIGITO = /[\p{L}\p{N}]/u;
const LETRA = /\p{L}/u;

/**
 * As posições em que o termo aparece como palavra ou expressão inteira. A
 * fronteira é "não é letra nem dígito", e não `\b`: `\b` não conhece letra
 * acentuada, e o termo pode começar ou terminar em símbolo.
 */
function ocorrencias(mensagem: string, termo: string): number[] {
  const achadas: number[] = [];
  let de = 0;
  for (;;) {
    const i = mensagem.indexOf(termo, de);
    if (i === -1) return achadas;
    const antes = i === 0 ? "" : mensagem[i - 1]!;
    const depois = i + termo.length >= mensagem.length ? "" : mensagem[i + termo.length]!;
    const livre = (c: string) => c === "" || !LETRA_OU_DIGITO.test(c);
    if (livre(antes) && livre(depois)) achadas.push(i);
    de = i + 1;
  }
}

/**
 * O ponto antes desta posição ENCERRA uma frase, ou é o de uma abreviatura
 * ("Sr.", "Dra.", "Prof.", "Av.")? Abreviatura: até quatro letras, começando
 * em maiúscula, coladas no ponto. Errar para "abreviatura" só deixa de barrar.
 */
function pontoDeAbreviatura(original: string, posicaoDoPonto: number): boolean {
  let i = posicaoDoPonto - 1;
  let letras = 0;
  while (i >= 0 && LETRA.test(original[i]!)) {
    letras += 1;
    i -= 1;
  }
  if (letras === 0 || letras > 4) return false;
  const primeira = original[i + 1]!;
  return primeira !== primeira.toLowerCase();
}

/**
 * A ocorrência é um NOME PRÓPRIO? Inicial maiúscula, o trecho não está todo em
 * maiúsculas, e não é começo de frase (onde toda palavra leva maiúscula).
 *
 * `original` e `minusculas` têm o mesmo tamanho (quem chama confere): o índice
 * de um vale para o outro.
 */
function ehNomeProprio(original: string, minusculas: string, i: number, tamanho: number): boolean {
  const inicial = original[i]!;
  if (inicial === minusculas[i]) return false; // começa em minúscula (ou não é letra)
  const trecho = original.slice(i, i + tamanho);
  if (trecho === trecho.toUpperCase()) return false; // "XINGO": é grito, não nome
  // Começo de frase: início da mensagem, ou depois de ". ", "! ", "? ".
  let j = i - 1;
  while (j >= 0 && !LETRA_OU_DIGITO.test(original[j]!) && !/[.!?…]/u.test(original[j]!)) j -= 1;
  if (j < 0) return false;
  const anterior = original[j]!;
  if (anterior === "!" || anterior === "?" || anterior === "…") return false;
  if (anterior === ".") return pontoDeAbreviatura(original, j);
  return true; // veio depois de outra palavra, no meio da frase
}

interface MensagemArrumada {
  /** Com a caixa de quem escreveu. */
  original: string;
  minusculas: string;
  /** `false` quando passar para minúsculas mudou o tamanho: a caixa não é consultada. */
  alinhadas: boolean;
}

function arrumarMensagem(mensagem: string): MensagemArrumada {
  const original = arrumar(mensagem);
  const minusculas = original.toLowerCase();
  return { original, minusculas, alinhadas: original.length === minusculas.length };
}

/** As ocorrências do termo que VALEM: palavra inteira, e não nome próprio. */
function ocorrenciasQueValem(m: MensagemArrumada, termo: string): number[] {
  return ocorrencias(m.minusculas, termo).filter(
    (i) => !(m.alinhadas && ehNomeProprio(m.original, m.minusculas, i, termo.length)),
  );
}

/** Quantas palavras a mensagem tem além das ocorrências (que valem) dos termos da regra. */
function palavrasAlemDosTermos(m: MensagemArrumada, termos: readonly string[]): number {
  // Por unidade UTF-16, como os índices de `indexOf` — espalhar a string a
  // partiria por ponto de código e um emoji antes do termo desalinharia tudo.
  const resto = m.minusculas.split("");
  for (const termo of termos) {
    for (const i of ocorrenciasQueValem(m, termo)) {
      for (let k = i; k < i + termo.length; k += 1) resto[k] = " ";
    }
  }
  return resto.join("").split(/[^\p{L}\p{N}]+/u).filter((p) => p !== "").length;
}

/** O termo da regra que casa a mensagem, ou `null`. */
export function termoQueCasa(regra: RegraDoFiltro, mensagem: string): string | null {
  const m = arrumarMensagem(mensagem);
  if (m.minusculas === "") return null;
  const termos = regra.terms
    .map((cru) => ({ cru, termo: normalizarParaOFiltro(cru) }))
    .filter((t) => t.termo.length >= 2);

  if (regra.match === "whole_message") {
    const inteira = semPontuacaoNasPontas(m.minusculas);
    return termos.find((t) => t.termo === inteira)?.cru ?? null;
  }

  const casou = termos.find((t) => ocorrenciasQueValem(m, t.termo).length > 0);
  if (casou === undefined) return null;
  // A mensagem que é mais que o termo tem um pedido dentro: vai para o modelo.
  if (
    regra.max_extra_words !== null &&
    palavrasAlemDosTermos(m, termos.map((t) => t.termo)) > regra.max_extra_words
  ) {
    return null;
  }
  return casou.cru;
}

/**
 * Os avisos que a rota de configuração devolve junto do filtro: onde a lista
 * que a empresa gravou pode calar um cliente. Códigos, não frases — a rota
 * traduz para o idioma de quem configura.
 */
export const AVISOS_DO_FILTRO = [
  /** Sempre que o filtro está ligado e tem termo: uma lista não entende contexto. */
  "falso_positivo",
  /** Alguma regra `contains` sem teto de palavras além do termo. */
  "sem_limite_de_palavras",
  /** Alguma regra com termo de uma palavra só, curta — o caso que mais colide. */
  "termo_curto",
  /** Alguma regra responde sozinha: em número com agente assistido, não envia. */
  "resposta_e_modo_assistido",
] as const;
export type AvisoDoFiltro = (typeof AVISOS_DO_FILTRO)[number];

/** Uma palavra só, com até este tamanho, é "termo curto" para o aviso. */
const TAMANHO_DO_TERMO_CURTO = 5;

export function avisosDoFiltro(filtro: FiltroDeEntrada): AvisoDoFiltro[] {
  if (!filtro.enabled) return [];
  const regras = CATEGORIAS_DO_FILTRO.flatMap((categoria) => {
    const regra = filtro.rules[categoria];
    return regra && regra.terms.length > 0 ? [regra] : [];
  });
  if (regras.length === 0) return [];
  const avisos: AvisoDoFiltro[] = ["falso_positivo"];
  if (regras.some((r) => r.match === "contains" && r.max_extra_words === null)) {
    avisos.push("sem_limite_de_palavras");
  }
  if (
    regras.some((r) =>
      r.terms.some((t) => {
        const termo = normalizarParaOFiltro(t);
        return !termo.includes(" ") && termo.length <= TAMANHO_DO_TERMO_CURTO;
      }),
    )
  ) {
    avisos.push("termo_curto");
  }
  if (regras.some((r) => r.action === "reply" && r.reply !== null && r.reply !== "")) {
    avisos.push("resposta_e_modo_assistido");
  }
  return avisos;
}

export interface BloqueioDoFiltro {
  barra: true;
  categoria: CategoriaDoFiltro;
  /** O que fazer: `reply` só quando a regra tem texto para enviar. */
  acao: AcaoDoFiltro;
  resposta: string | null;
  marcador: string | null;
  /** O termo da lista da empresa que casou (configuração, não fala do cliente). */
  termo: string;
  /** Quantas mensagens pendentes foram julgadas. */
  mensagens: number;
}

export type DecisaoDoFiltro = { barra: false; motivo: MotivoDeNaoBarrar } | BloqueioDoFiltro;

export type MotivoDeNaoBarrar =
  | "desligado"
  | "sem_regras"
  | "sem_mensagem"
  | "mensagem_sem_texto"
  | "mensagem_legitima"
  | "outra_porta_decide";

interface Casamento {
  categoria: CategoriaDoFiltro;
  regra: RegraDoFiltro;
  termo: string;
}

/** A primeira regra, na ordem das categorias, que casa a mensagem. */
function regraQueCasa(
  regras: ReadonlyArray<{ categoria: CategoriaDoFiltro; regra: RegraDoFiltro }>,
  mensagem: string,
): Casamento | undefined {
  for (const { categoria, regra } of regras) {
    const termo = termoQueCasa(regra, mensagem);
    if (termo !== null) return { categoria, regra, termo };
  }
  return undefined;
}

/**
 * A decisão, pura.
 *
 * `mensagens` são as falas do cliente ainda sem resposta (a mesma lista que o
 * pedido de pessoa e o opt-out julgam). `deixarPassar` diz se uma mensagem é de
 * outra porta do começo do turno (pedido de pessoa, opt-out): se alguma for, o
 * filtro não decide nada.
 */
export function julgarEntrada(
  filtro: FiltroDeEntrada,
  mensagens: readonly string[],
  deixarPassar: (mensagem: string) => boolean = () => false,
): DecisaoDoFiltro {
  if (!filtro.enabled) return { barra: false, motivo: "desligado" };
  const regras = CATEGORIAS_DO_FILTRO.flatMap((categoria) => {
    const regra = filtro.rules[categoria];
    return regra && regra.terms.length > 0 ? [{ categoria, regra }] : [];
  });
  if (regras.length === 0) return { barra: false, motivo: "sem_regras" };
  if (mensagens.length === 0) return { barra: false, motivo: "sem_mensagem" };
  if (mensagens.some((m) => m.trim() === "")) return { barra: false, motivo: "mensagem_sem_texto" };
  if (mensagens.some(deixarPassar)) return { barra: false, motivo: "outra_porta_decide" };

  let primeiro: Casamento | undefined;
  for (const mensagem of mensagens) {
    const casou = regraQueCasa(regras, mensagem);
    if (casou === undefined) return { barra: false, motivo: "mensagem_legitima" };
    // A categoria que nomeia o bloqueio é a mais grave entre as que casaram
    // (a ordem de `CATEGORIAS_DO_FILTRO`).
    if (
      primeiro === undefined ||
      CATEGORIAS_DO_FILTRO.indexOf(casou.categoria) < CATEGORIAS_DO_FILTRO.indexOf(primeiro.categoria)
    ) {
      primeiro = casou;
    }
  }
  if (primeiro === undefined) return { barra: false, motivo: "sem_mensagem" };

  const resposta = primeiro.regra.reply !== null && primeiro.regra.reply !== "" ? primeiro.regra.reply : null;
  return {
    barra: true,
    categoria: primeiro.categoria,
    acao: primeiro.regra.action === "reply" && resposta !== null ? "reply" : "silence",
    resposta: primeiro.regra.action === "reply" ? resposta : null,
    marcador: primeiro.regra.tag,
    termo: primeiro.termo,
    mensagens: mensagens.length,
  };
}

/** O nome do filtro no traço do turno (`agent_turn_traces.ferramentas[].nome`). */
export const NOME_DO_FILTRO_NO_TRACO = "filtro_de_entrada";

/** O motivo gravado em `agent_turn_traces.abort_reason` quando o filtro barra. */
export const MOTIVO_DE_ABORTO_DO_FILTRO = "filtro_de_entrada";
