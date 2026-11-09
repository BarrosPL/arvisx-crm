/** O que uma troca proporcional ocupa na linha; tudo `null` = sem troca em curso. */
export const SEM_TROCA = {
  troca_id: null, plano_troca_pendente_id: null, troca_valor_cents: null, troca_status: null,
  troca_pagamento_ref: null, troca_pagamento_url: null, troca_reserva_ate: null,
} as const;

import type { Moeda } from "@/lib/cobranca/vocabulario";

/**
 * Abaixo disto o provedor recusa a cobrança avulsa, por moeda. BRL: Asaas
 * R$ 5,00, Stripe R$ 0,50 — vale o maior. EUR: só a Stripe cobra em euro, e o
 * mínimo dela é € 0,50. Fonte: a documentação dos dois, não medido aqui. Um
 * ajuste menor vira 0, e o upgrade cai no agendamento, como o de ajuste zero.
 */
export const AJUSTE_MINIMO_CENTS_POR_MOEDA: Readonly<Record<Moeda, number>> = { BRL: 500, EUR: 50 };
/** O mínimo em real, o de antes do euro (migration 9801). */
export const AJUSTE_MINIMO_CENTS = AJUSTE_MINIMO_CENTS_POR_MOEDA.BRL;

/**
 * Calcula o ajuste de um upgrade pelo tempo restante do período já pago.
 * O período vem do provedor (em instantes), e o valor fica em centavos da moeda
 * do plano (os dois planos da troca têm a mesma: `troca.ts` recusa trocar de moeda).
 * É a mesma conta na tela (estimativa) e em `troca.ts` (cobrança).
 */
export function calcularAjusteProporcional(input: {
  precoAtualCents: number;
  precoNovoCents: number;
  periodoPagoDesde: Date | null;
  proximoVencimento: Date | null;
  agora: Date;
  /** Moeda do plano novo; ausente = BRL. Decide só o mínimo. */
  moeda?: Moeda;
}): number | null {
  const { precoAtualCents, precoNovoCents, periodoPagoDesde, proximoVencimento, agora } = input;
  if (precoNovoCents <= precoAtualCents) return 0;
  if (!periodoPagoDesde || !proximoVencimento) return null;
  const inicio = periodoPagoDesde.getTime();
  const fim = proximoVencimento.getTime();
  const agoraMs = agora.getTime();
  if (![inicio, fim, agoraMs].every(Number.isFinite) || fim <= inicio || fim <= agoraMs) return 0;
  const restante = Math.min(1, Math.max(0, (fim - agoraMs) / (fim - inicio)));
  const valor = Math.round((precoNovoCents - precoAtualCents) * restante);
  return valor < AJUSTE_MINIMO_CENTS_POR_MOEDA[input.moeda ?? "BRL"] ? 0 : valor;
}
