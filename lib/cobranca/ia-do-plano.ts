/**
 * A IA INCLUÍDA NO PLANO, PARA A TELA (Tarefa 8, parte 1; migration 9825).
 *
 * A mesma leitura do motor — `public.fn_ia_do_plano`, que soma só o que a chave
 * da plataforma pagou, no ciclo — entregue às duas telas que a mostram: Uso de
 * IA e Plano e cobrança. Uma função do banco, uma régua: a tela não pode dizer
 * um número e o bloqueio agir sobre outro.
 *
 * O que o cliente vê é a FRANQUIA em conversas. O teto em dólar é a trava de
 * baixo e só aparece como "quanto do uso incluído já foi", em percentual.
 *
 * ═══ O ciclo ═══
 *
 * `peloPeriodoPago = true`: o ciclo é o período pago da assinatura
 * (`periodo_pago_desde` até `proximo_vencimento`), que vale quando os dois
 * existem, o plano é mensal e hoje está dentro dele. Nos demais casos — teste
 * grátis, plano anual, período vencido, dado faltando — o ciclo é o
 * mês-calendário. A diferença prática: no teste grátis e no plano anual a
 * franquia zera no dia 1º; numa assinatura mensal paga, zera no dia da cobrança.
 *
 * Nunca lança: falha de leitura devolve `null`, e a tela simplesmente não
 * mostra o bloco. A tela não afirma uso que não leu.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { usoDaLinha } from "@/lib/agent-engine/edge/llm/orcamento";
import { logger } from "@/lib/logger";

/** A partir de quanto do plano a tela avisa. O mesmo limiar do aviso da Central. */
export const LIMIAR_DO_AVISO_NA_TELA = 0.8;

export type SituacaoDaIaDoPlano =
  /** O plano não tem teto de IA: a IA incluída não está liberada (falha fechada). */
  | "sem_teto"
  /** Franquia cheia ou teto atingido. */
  | "esgotada"
  /** 80% ou mais de um dos dois limites. */
  | "perto_do_fim"
  | "normal";

export interface IaDoPlanoNaTela {
  conversas: number;
  /** `null` = o plano não tem franquia de conversas. */
  franquia: number | null;
  /** Percentual do uso incluído (teto em dólar) já consumido; `null` sem teto. */
  percentualDoUsoIncluido: number | null;
  /** ISO. `null` quando o banco não informou. */
  cicloFim: string | null;
  peloPeriodoPago: boolean;
  situacao: SituacaoDaIaDoPlano;
}

/** A linha de `fn_ia_do_plano` como a tela a mostra. `null` = empresa sem plano (isenta). */
export function iaDoPlanoNaTela(linha: Record<string, unknown> | null | undefined): IaDoPlanoNaTela | null {
  const uso = usoDaLinha(linha);
  if (!uso.comAssinatura) return null;
  const doTeto = uso.tetoUsdCents !== null && uso.tetoUsdCents > 0 ? uso.gastoUsdCents / uso.tetoUsdCents : null;
  const daFranquia =
    uso.franquiaConversas !== null && uso.franquiaConversas > 0 ? uso.conversas / uso.franquiaConversas : null;
  const maior = Math.max(doTeto ?? 0, daFranquia ?? 0);
  const situacao: SituacaoDaIaDoPlano =
    uso.tetoUsdCents === null
      ? "sem_teto"
      : maior >= 1
        ? "esgotada"
        : maior >= LIMIAR_DO_AVISO_NA_TELA
          ? "perto_do_fim"
          : "normal";
  return {
    conversas: uso.conversas,
    franquia: uso.franquiaConversas,
    percentualDoUsoIncluido: doTeto === null ? null : Math.min(100, Math.floor(doTeto * 100)),
    cicloFim: uso.cicloFim ? uso.cicloFim.toISOString() : null,
    peloPeriodoPago: uso.peloPeriodoPago,
    situacao,
  };
}

/** `db` é o cliente de serviço: a função só tem EXECUTE para `service_role`. `orgId` vem da sessão. */
export async function lerIaDoPlanoParaATela(db: SupabaseClient, orgId: string): Promise<IaDoPlanoNaTela | null> {
  try {
    const { data, error } = await db.rpc("fn_ia_do_plano", { p_org: orgId });
    if (error) {
      logger.warn("cobrança: a IA do plano não pôde ser lida para a tela", {
        organization_id: orgId,
        codigo: error.code ?? null,
      });
      return null;
    }
    return iaDoPlanoNaTela((Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined);
  } catch (err) {
    logger.warn("cobrança: a IA do plano não pôde ser lida para a tela", {
      organization_id: orgId,
      erro: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
