/**
 * A COSTURA DO PROVEDOR DO VIX — tipos.
 *
 * Quem paga o modelo do assistente é UMA escolha da instalação (`VIX_PAGADOR`).
 * Cada pagador é um arquivo desta pasta que devolve um `ProvedorPronto` ou diz
 * por que não está disponível. O resto do assistente não sabe qual é.
 *
 * NÃO HÁ QUEDA de um pagador para o outro: se o pagador escolhido falha, o
 * assistente responde que está indisponível. Quem troca de pagador é quem
 * administra a instalação, pela chave.
 */
import type { LanguageModel } from "ai";

/** Os valores de `VIX_PAGADOR`. Ausente ou desconhecido vale `desligado`. */
export const PAGADORES = ["desligado", "assinatura_plataforma", "chave_plataforma"] as const;
export type Pagador = (typeof PAGADORES)[number];

/** Por que o assistente não pode responder agora. Vai para o log e a auditoria, nunca cru para o usuário. */
export type MotivoDeIndisponibilidade =
  | "desligado"
  | "sem_organizacao_designada"
  | "organizacao_designada_invalida"
  | "sem_conta"
  | "sem_modelo"
  | "sem_chave"
  | "limite_de_uso"
  | "token_expirado"
  | "sem_autorizacao"
  | "falha_do_provedor"
  | "erro_de_pedido"
  | "rede";

export interface UsoDeTokens {
  entrada: number;
  saida: number;
}

export interface ProvedorPronto {
  pagador: Exclude<Pagador, "desligado">;
  provedor: string;
  modelo: string;
  model: LanguageModel;
  /** O custo da chamada em centavos de dólar. Assinatura: zero (mensalidade fixa). */
  custoUsdCents: (uso: UsoDeTokens) => number;
  /** Classifica um erro da chamada. */
  classificarFalha: (erro: unknown) => MotivoDeIndisponibilidade;
  /**
   * Só a assinatura: o provedor respondeu 401. Renova UMA vez pelo caminho que
   * já existe e devolve o modelo com o token novo, ou `null` se não renovou.
   */
  renovarApos401?: () => Promise<LanguageModel | null>;
}

export type ProvedorDoVix =
  | ({ disponivel: true } & ProvedorPronto)
  | { disponivel: false; pagador: Pagador; motivo: MotivoDeIndisponibilidade };

/** Status HTTP e texto de um erro do SDK, sem depender da classe dele. */
export function statusEDetalheDoErro(erro: unknown): { status: number | null; detalhe: string } {
  const e = erro as { statusCode?: unknown; status?: unknown; message?: unknown; responseBody?: unknown } | null;
  const bruto = e?.statusCode ?? e?.status;
  const status = typeof bruto === "number" && Number.isFinite(bruto) ? bruto : null;
  const detalhe = [e?.message, e?.responseBody].filter((t): t is string => typeof t === "string").join(" ");
  return { status, detalhe };
}
