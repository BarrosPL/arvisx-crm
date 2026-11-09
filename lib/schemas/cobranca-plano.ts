import { z } from "zod";

import { INTERVALOS, MOEDAS, type Moeda } from "@/lib/cobranca/vocabulario";
import { formatCents } from "@/lib/money";

/**
 * O plano de cobrança da instalação (`cobranca_planos`, spec da cobrança §2.2).
 * São os mesmos limites dos CHECKs da tabela, para a recusa sair com nome antes
 * do banco. A régua é a mesma na rota e no formulário de /admin/cobranca.
 * `moeda` é BRL ou EUR (migration 9801); ausente na criação, o default (BRL).
 */
const INT4_MAX = 2_147_483_647;

/** O piso do CHECK `preco_cents >= 500`: R$ 5,00 ou € 5,00, a mesma régua nas duas moedas. */
export const PRECO_MINIMO_CENTS = 500;

/** A recusa do preço abaixo do piso, escrita na moeda do plano. Sem moeda (edição parcial), a frase neutra. */
export function mensagemDoPrecoMinimo(moeda?: Moeda): string {
  if (moeda === undefined) return "O preço mínimo é 5,00 na moeda do plano.";
  const minimo = formatCents(PRECO_MINIMO_CENTS, moeda);
  return moeda === "BRL" ? `O preço mínimo é ${minimo}: abaixo disso o boleto não sai.` : `O preço mínimo é ${minimo}.`;
}

function precoNoPiso(v: { preco_cents?: number; moeda?: Moeda }, ctx: z.RefinementCtx): void {
  if (v.preco_cents !== undefined && v.preco_cents < PRECO_MINIMO_CENTS) {
    ctx.addIssue({ code: "custom", path: ["preco_cents"], message: mensagemDoPrecoMinimo(v.moeda) });
  }
}

const campos = {
  nome: z.string().trim().min(1).max(60),
  // O piso (500) é conferido em `precoNoPiso`, que conhece a moeda do corpo.
  preco_cents: z.number().int(),
  moeda: z.enum(MOEDAS),
  intervalo: z.enum(INTERVALOS),
  trial_dias: z.number().int().min(0).max(90),
  max_assentos: z.number().int().min(1).max(INT4_MAX).nullable(),
  max_canais: z.number().int().min(1).max(INT4_MAX).nullable(),
  teto_ia_usd_cents: z.number().int().min(100).max(INT4_MAX).nullable(),
  padrao_no_cadastro: z.boolean(),
  oferecido_ao_cliente: z.boolean(),
};

export const novoPlanoSchema = z.strictObject({
  nome: campos.nome,
  preco_cents: campos.preco_cents,
  moeda: campos.moeda.optional(),
  intervalo: campos.intervalo,
  trial_dias: campos.trial_dias,
  max_assentos: campos.max_assentos.optional(),
  max_canais: campos.max_canais.optional(),
  teto_ia_usd_cents: campos.teto_ia_usd_cents.optional(),
  padrao_no_cadastro: campos.padrao_no_cadastro.optional(),
  oferecido_ao_cliente: campos.oferecido_ao_cliente.optional(),
  // Na criação, sem moeda vale o default da coluna (BRL): a frase já sai nela.
}).superRefine((v, ctx) => precoNoPiso({ ...v, moeda: v.moeda ?? "BRL" }, ctx));

export const edicaoDoPlanoSchema = z
  .strictObject({ ...campos, arquivado: z.boolean() })
  .partial()
  .superRefine(precoNoPiso)
  .refine((v) => Object.keys(v).length > 0, "Nada para mudar.");

export const COLUNAS_DO_PLANO =
  "id, nome, preco_cents, moeda, intervalo, trial_dias, max_assentos, max_canais, teto_ia_usd_cents, padrao_no_cadastro, oferecido_ao_cliente, arquivado_em, created_at, updated_at";
