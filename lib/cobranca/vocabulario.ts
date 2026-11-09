/**
 * O VOCABULÁRIO DA COBRANÇA DO REVENDEDOR: o lado TypeScript dos CHECKs de
 * `cobranca_planos` e `cobranca_assinaturas` (migration 0583; spec §2.2, §2.3,
 * §2.7). Cada tupla é par de uma coluna, vigiado por
 * tests/invariants/vocabulario-banco-x-typescript.test.ts: valor novo entra no
 * CHECK (migration + apêndice do baseline) e aqui, no MESMO commit.
 * `RECURSOS_DO_PLANO` não é coluna: é o que `public.fn_limite_do_plano` aceita,
 * vigiado por tests/invariants/cobranca-limite-do-plano.test.ts.
 */

export const ESTADOS_DA_ASSINATURA = ["trial", "ativa", "em_atraso", "cancelada"] as const;
export type EstadoDaAssinatura = (typeof ESTADOS_DA_ASSINATURA)[number];

export const PROVEDORES_DE_COBRANCA = ["stripe", "asaas"] as const;
export type ProvedorDeCobranca = (typeof PROVEDORES_DE_COBRANCA)[number];

export const MODOS = ["teste", "producao"] as const;
export type Modo = (typeof MODOS)[number];

export const INTERVALOS = ["mes", "ano"] as const;
export type Intervalo = (typeof INTERVALOS)[number];

/**
 * A moeda do plano (CHECK de `cobranca_planos.moeda`, migrations 0583 e 9801).
 * Alargar = alargar o CHECK. QUEM cobra em qual moeda é `MOEDAS_DO_PROVEDOR`.
 */
export const MOEDAS = ["BRL", "EUR"] as const;
export type Moeda = (typeof MOEDAS)[number];

/**
 * O que cada provedor sabe cobrar. O Asaas não tem moeda (cobra em real); a
 * Stripe cobra na moeda do plano — boleto só em BRL, e em EUR ela oferece o que
 * a conta tem ligado para euro (cartão). Plano numa moeda que o provedor não
 * cobra é recusado ANTES de criar qualquer coisa nele (`checkout.ts`, `troca.ts`)
 * e, por segunda linha, no próprio adaptador do Asaas.
 */
export const MOEDAS_DO_PROVEDOR: Readonly<Record<ProvedorDeCobranca, readonly Moeda[]>> = {
  stripe: ["BRL", "EUR"],
  asaas: ["BRL"],
};

export function provedorCobraEm(provedor: ProvedorDeCobranca, moeda: string): boolean {
  return (MOEDAS_DO_PROVEDOR[provedor] as readonly string[]).includes(moeda);
}

export const AVISOS_DA_REGUA = ["trial_acabando", "venceu", "suspende_em_breve", "suspensa"] as const;
export type AvisoDaRegua = (typeof AVISOS_DA_REGUA)[number];

export const ERROS_DE_LEITURA = [
  "credencial_invalida",
  "provedor_fora",
  "pagamento_de_assinatura_cancelada",
  "leitura_invalida",
] as const;
export type ErroDeLeitura = (typeof ERROS_DE_LEITURA)[number];

export const RECURSOS_DO_PLANO = ["assentos", "canais", "ia_usd_cents"] as const;
export type RecursoDoPlano = (typeof RECURSOS_DO_PLANO)[number];
