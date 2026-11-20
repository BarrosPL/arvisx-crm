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
 * Sem acento e sem diferença de maiúsculas. `contains` casa o termo como
 * palavra ou expressão INTEIRA dentro da mensagem (o termo "sala" não casa
 * "salada"); `whole_message` exige que a mensagem inteira seja o termo. Não há
 * expressão regular vinda da configuração: um padrão ruim travaria o worker.
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

const termoSchema = z.string().trim().min(2).max(MAX_TAMANHO_DO_TERMO);

/**
 * Uma categoria. `reply` só é usada com `action: "reply"`; sem texto, a ação
 * vira silêncio (não há o que enviar). `tag` é o marcador gravado na conversa.
 */
export const regraDoFiltroSchema = z.object({
  terms: z.array(termoSchema).max(MAX_TERMOS_POR_CATEGORIA).default([]),
  match: z.enum(MODOS_DE_CASAMENTO).default("contains"),
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

/** Minúsculas, sem acento, espaços em um só. */
export function normalizarParaOFiltro(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Para `whole_message`: a mensagem sem a pontuação das pontas. */
function semPontuacaoNasPontas(texto: string): string {
  return texto.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/**
 * O termo aparece como palavra ou expressão inteira? A fronteira é "não é
 * letra nem dígito", e não `\b`: `\b` não conhece letra acentuada, e o termo
 * pode começar ou terminar em símbolo.
 */
function contemExpressao(mensagem: string, termo: string): boolean {
  let de = 0;
  for (;;) {
    const i = mensagem.indexOf(termo, de);
    if (i === -1) return false;
    const antes = i === 0 ? "" : mensagem[i - 1]!;
    const depois = i + termo.length >= mensagem.length ? "" : mensagem[i + termo.length]!;
    const livre = (c: string) => c === "" || !/[\p{L}\p{N}]/u.test(c);
    if (livre(antes) && livre(depois)) return true;
    de = i + 1;
  }
}

/** O termo da regra que casa a mensagem, ou `null`. */
export function termoQueCasa(regra: RegraDoFiltro, mensagem: string): string | null {
  const texto = normalizarParaOFiltro(mensagem);
  if (texto === "") return null;
  const inteira = semPontuacaoNasPontas(texto);
  for (const cru of regra.terms) {
    const termo = normalizarParaOFiltro(cru);
    if (termo.length < 2) continue;
    if (regra.match === "whole_message" ? inteira === termo : contemExpressao(texto, termo)) return cru;
  }
  return null;
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
