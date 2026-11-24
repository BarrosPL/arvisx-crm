/**
 * A PODA DOS COMENTÁRIOS DE REDE SOCIAL (`social_comments`, migration 9810).
 *
 * ─── Por que existe desde o primeiro dia ────────────────────────────────────
 *
 * Comentário em publicação chega em volume e vem de gente que não é contato:
 * a tabela guarda o texto e o nome de usuário de quem comentou, sem ninguém
 * ter pedido para virar cliente. Guardar isso para sempre é o defeito que
 * `webhook_events_log` já pagou (`./retencao-do-arquivo.ts`: 86% de um banco
 * era arquivo que ninguém podava) com um agravante — aqui é texto de pessoa.
 *
 * ─── A mesma régua das podas irmãs ──────────────────────────────────────────
 *
 * As três lições de `./retencao-do-arquivo.ts` e de
 * `lib/webhooks/retencao-da-captacao.ts`, aplicadas de saída:
 *
 *   1. EM LOTES. Um DELETE sem teto segura a tabela em que o webhook escreve.
 *   2. `order("id")` ANTES do `limit`. O PostgREST 12.2 recusa DELETE com
 *      `limit` e sem `order` (400 PGRST109) — sem a ordem a poda não apaga
 *      nada em clone novo, em silêncio. E a ordem pela chave primária deixa a
 *      drenagem reproduzível.
 *   3. A FALHA SOBE, com o nome da tabela na frente. `apagadas: 0` por erro e
 *      `apagadas: 0` por não haver nada vencido não podem ser a mesma linha na
 *      resposta do cron.
 *
 * Sem filtro de organização de propósito, como as irmãs: a poda varre pela
 * ponta mais velha e não sabe escolher empresa — é o que a impede de virar
 * apagador dirigido.
 *
 * ─── O prazo ────────────────────────────────────────────────────────────────
 *
 * 365 dias, contados de `commented_at`, qualquer que seja o estado. É o mesmo
 * horizonte do histórico de captação (`RETENCAO_CAPTACAO_DIAS_PADRAO`), e pela
 * mesma razão: é registro de por onde a pessoa chegou, e a pergunta útil
 * ("de qual publicação veio quem fechou?") é de meses, não de anos. O que a
 * resposta ao comentário gerou de duradouro — o contato, a conversa — vive nas
 * tabelas delas e não é tocado aqui.
 *
 * É constante, e não variável de ambiente: uma chave nova no `.env` é coisa
 * para o operador errar, e ninguém pediu para regular este prazo. Se pedirem,
 * o lugar é `lib/retencao/politica.ts`, com piso.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Quantos dias um comentário fica guardado. */
export const DIAS_DE_GUARDA_DOS_COMENTARIOS = 365;

/** Lote por rodada. O mesmo das podas irmãs: nunca ser dono de uma trava longa. */
export const LOTE_PADRAO_DOS_COMENTARIOS = 500;

export interface ResultadoDaPodaDeComentarios {
  apagadas: number;
  /** `true` quando o lote encheu — ainda há fila para a próxima rodada. */
  temMais: boolean;
  /** O prazo aplicado, em dias. */
  diasAplicados: number;
}

export async function podarComentariosAntigos(
  admin: SupabaseClient,
  opcoes: { lote?: number; agora?: Date } = {},
): Promise<ResultadoDaPodaDeComentarios> {
  const lote = opcoes.lote ?? LOTE_PADRAO_DOS_COMENTARIOS;
  const agora = opcoes.agora ?? new Date();
  const limite = new Date(agora.getTime() - DIAS_DE_GUARDA_DOS_COMENTARIOS * 86_400_000).toISOString();

  const { data, error } = await admin
    .from("social_comments")
    .delete()
    .lt("commented_at", limite)
    .select("id")
    // `order` ANTES do `limit`, pela chave primária: ver o cabeçalho.
    .order("id")
    .limit(lote);

  if (error) throw new Error(`social_comments: ${error.message}`);

  const apagadas = (data ?? []).length;
  return { apagadas, temMais: apagadas >= lote, diasAplicados: DIAS_DE_GUARDA_DOS_COMENTARIOS };
}
