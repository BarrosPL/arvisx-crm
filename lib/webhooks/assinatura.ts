/**
 * O nome do cabeçalho que o webhook de ENTRADA exige de quem envia.
 *
 * Mora aqui, e não solto em cada arquivo, porque tem TRÊS leitores que precisam
 * concordar byte a byte: a rota que confere a assinatura, a tela que ensina o
 * integrador a montá-la, e quem integra do outro lado. Renomear invalida a
 * assinatura de todo integrador já configurado, e o sintoma para ele é um 401
 * sem explicação — por isso é contrato de fio, não detalhe interno.
 *
 * Por isso a troca de nome é com DUPLA LEITURA: a tela ensina o nome novo
 * (`x-arvisx-signature`) e a rota aceita os dois. O legado
 * (`x-deskcomm-signature`, herdado do upstream) segue aceito para quem já
 * integrou; quando os dois vêm, vale o novo.
 *
 * Módulo sem dependência de propósito: ele é importado por um client component,
 * e `lib/webhooks/inbound.ts` (que faz o HMAC) puxa `node:crypto`.
 */
export const HEADER_ASSINATURA_DE_ENTRADA = "x-arvisx-signature";

/** O nome antigo, aceito para não derrubar integrador já configurado. */
export const HEADER_ASSINATURA_DE_ENTRADA_LEGADO = "x-deskcomm-signature";

/**
 * A assinatura que a requisição trouxe: o cabeçalho novo, e só na ausência dele
 * o legado. `null` quando nenhum dos dois veio.
 */
export function assinaturaDaRequisicao(cabecalhos: { get(nome: string): string | null }): string | null {
  return cabecalhos.get(HEADER_ASSINATURA_DE_ENTRADA) ?? cabecalhos.get(HEADER_ASSINATURA_DE_ENTRADA_LEGADO);
}
