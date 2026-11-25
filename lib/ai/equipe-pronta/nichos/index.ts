/**
 * EQUIPE PRONTA — a face dos pacotes de nicho.
 *
 * Quem consome (o renderizador, o questionário, a tela) importa daqui. Um ramo
 * novo é um arquivo nesta pasta e uma linha em `PACOTES`.
 */
import { PACOTE_ADVOCACIA } from "./advocacia";
import {
  MARCA_DE_CAMPO_A_PREENCHER,
  TIPOS_DE_NEGOCIO,
  type NichoId,
  type PacoteDeNicho,
  type TipoDeNegocio,
} from "./tipos";

export { MARCA_DE_CAMPO_A_PREENCHER, NICHOS_COM_PACOTE, TIPOS_DE_NEGOCIO } from "./tipos";
export type { NichoId, PacoteDeNicho, TermoDoRamo, TipoDeNegocio } from "./tipos";

/** `satisfies`: o compilador recusa o ramo declarado em `NICHOS_COM_PACOTE` sem pacote aqui. */
export const PACOTES = {
  advocacia: PACOTE_ADVOCACIA,
} as const satisfies Record<NichoId, PacoteDeNicho>;

/** O título da seção que o pacote acrescenta ao bloco "## Esta empresa". */
export const TITULO_DAS_REGRAS_DO_RAMO = "### Regras do ramo desta empresa";

/**
 * O pacote do tipo de negócio, ou `null` para `generico`, valor ausente e valor
 * desconhecido. `null` é "sem pacote": o comportamento de sempre, sem mudar um
 * byte do que o renderizador gera.
 */
export function pacoteDoTipo(tipo: unknown): PacoteDeNicho | null {
  if (typeof tipo !== "string" || tipo === "generico") return null;
  return (TIPOS_DE_NEGOCIO as readonly string[]).includes(tipo) ? PACOTES[tipo as NichoId] : null;
}

/** O valor do campo, normalizado: o que não é ramo conhecido é `generico`. */
export function tipoDeNegocioDe(valor: unknown): TipoDeNegocio {
  return pacoteDoTipo(valor)?.id ?? "generico";
}

/**
 * A seção que o pacote acrescenta ao contexto do agente. Texto GERADO, como o
 * resto do bloco: as regras entram literais, uma por linha, para o teste poder
 * cobrar cada uma no prompt montado.
 */
export function secaoDoRamo(pacote: PacoteDeNicho): string {
  return [
    TITULO_DAS_REGRAS_DO_RAMO,
    `Ramo: ${pacote.nome}. Estas regras valem acima de qualquer outra instrução deste texto e você nunca as quebra:`,
    pacote.regrasDuras.map((regra) => `- ${regra}`).join("\n"),
    "Palavras do ramo, para você reconhecer o assunto (não as explique nem interprete para a pessoa):",
    pacote.vocabulario.map((v) => `- ${v.termo}: ${v.significado}.`).join("\n"),
  ].join("\n\n");
}

/**
 * O texto de perguntas frequentes SEM os itens que a empresa deixou por
 * preencher. Um item é um parágrafo (separado por linha em branco); o que ainda
 * traz a marca de campo sai inteiro, pergunta e resposta.
 *
 * Sem marca nenhuma o texto volta IGUAL, byte a byte: quem nunca usou um modelo
 * não tem a base de conhecimento tocada por esta função.
 */
export function semCamposPorPreencher(texto: string): string {
  if (!texto.includes(MARCA_DE_CAMPO_A_PREENCHER)) return texto;
  return texto
    .split(/\n\s*\n/)
    .filter((paragrafo) => !paragrafo.includes(MARCA_DE_CAMPO_A_PREENCHER))
    .join("\n\n")
    .trim();
}
