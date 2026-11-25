/**
 * O USO, O LIMITE E O CUSTO DO VIX — A ÚNICA COSTURA.
 *
 * Tudo que o resto do assistente sabe sobre limite e custo passa por aqui: ler
 * a configuração da organização, contar a mensagem (e recusar a que passa do
 * limite do mês) e registrar o que a resposta consumiu.
 *
 * ═══ QUEM TEM O VIX ═══
 *
 * Duas portas (`fn_assistente_config_da_org`, migration 9830): a organização
 * tem a marca `sem_limite`, que só a plataforma escreve, ou assina um plano
 * com linha em `assistente_planos`. Sem as duas, `configDoVix` devolve `null` e
 * o assistente não responde (falha fechada).
 *
 * ═══ O LIMITE É DE MENSAGENS ═══
 *
 * Mensagens por mês de calendário (UTC). Conta a mensagem que CHEGOU ao
 * modelo, com ou sem sucesso; a contagem acontece antes da chamada, no banco,
 * serializada por organização (`fn_assistente_registrar_mensagem`).
 *
 * ═══ DOIS DESTINOS DO CUSTO, UMA CHAVE DE TROCA ═══
 *
 *   1. `assistente_usos`: SEMPRE gravada. É nela que o limite é medido.
 *   2. `llm_calls`: SÓ com `REGISTRAR_EM_LLM_CALLS` ligado. Está DESLIGADO.
 *
 * A tarefa pede que cada resposta registre o custo em `llm_calls`. Hoje toda
 * linha de `llm_calls` soma no orçamento de IA DA EMPRESA (gatilho
 * `trg_llm_calls_budget`) e na régua `fn_gasto_de_ia_do_mes`, que pausam os
 * agentes de WhatsApp: o uso do assistente pararia o atendimento do cliente.
 * A decisão do dono é gravar a linha com a coluna de origem da chave dizendo
 * que ela é do assistente, e as somas ignorarem esses valores. A coluna e a
 * mudança das somas são de OUTRA entrega e ainda não estão na `main`.
 *
 * ⚠️ Enquanto a chave estiver desligada, "cada resposta registra o custo em
 * `llm_calls`" NÃO está cumprido. Para ligar, depois que a coluna existir na
 * `main` e as somas a ignorarem: conferir o nome da coluna contra
 * `COLUNA_DA_ORIGEM_DA_CHAVE` e os valores de origem de cada pagador, trocar
 * `REGISTRAR_EM_LLM_CALLS` para `true`, mudar o `registraEm` do ponto
 * `assistente_vix` em `lib/ai/pontos/registro.ts` para `"llm_calls"` e provar
 * no banco que a linha do assistente não altera `ai_budgets` nem o gasto do
 * mês. Este arquivo não toca `ai_budgets` nem a régua de gasto.
 *
 * O cliente é o de serviço (as tabelas são do servidor), sempre filtrado pela
 * organização que a ROTA resolveu da sessão.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

/** A chave de troca do segundo destino. Ver o cabeçalho antes de mexer. */
export const REGISTRAR_EM_LLM_CALLS: boolean = false;

/** O nome PREVISTO da coluna de origem da chave em `llm_calls`. Confira antes de ligar. */
export const COLUNA_DA_ORIGEM_DA_CHAVE = "origem_da_chave";

export interface ConfigDoVix {
  /** Por qual porta a organização tem o assistente. */
  origem: "marca" | "plano";
  /** `null` = sem limite de mensagens. */
  mensagensPorMes: number | null;
  limiteDeLote: number;
  mensagensPorMinuto: number;
  ferramentasPorTurno: number;
}

/**
 * A configuração do Vix para a organização, ou `null` quando ela não tem o
 * assistente (sem marca e sem plano com linha) ou a leitura falhou.
 */
export async function configDoVix(admin: SupabaseClient, orgId: string): Promise<ConfigDoVix | null> {
  const { data, error } = await admin.rpc("fn_assistente_config_da_org", { p_org: orgId });
  if (error) {
    logger.warn("vix: configuração da organização ilegível — o assistente não responde", {
      organization_id: orgId,
      erro: error.message,
    });
    return null;
  }
  const linha = (Array.isArray(data) ? data[0] : data) as
    | {
        origem?: string;
        mensagens_por_mes?: number | null;
        limite_de_lote?: number;
        mensagens_por_minuto?: number;
        ferramentas_por_turno?: number;
      }
    | null
    | undefined;
  if (!linha || (linha.origem !== "marca" && linha.origem !== "plano")) return null;
  return {
    origem: linha.origem,
    mensagensPorMes: typeof linha.mensagens_por_mes === "number" ? linha.mensagens_por_mes : null,
    limiteDeLote: linha.limite_de_lote ?? 5,
    mensagensPorMinuto: linha.mensagens_por_minuto ?? 6,
    ferramentasPorTurno: linha.ferramentas_por_turno ?? 8,
  };
}

/** Quantas mensagens a organização já usou neste mês, ou `null` se a leitura falhou. */
export async function mensagensUsadasNoMes(admin: SupabaseClient, orgId: string): Promise<number | null> {
  const { data, error } = await admin.rpc("fn_assistente_mensagens_do_mes", { p_org: orgId });
  if (error) return null;
  const n = Number(data ?? 0);
  return Number.isFinite(n) ? n : null;
}

export type RegistroDaMensagem =
  | { ok: true; usoId: string }
  | { ok: false; motivo: "limite_atingido" | "erro" };

/**
 * Conta a mensagem ANTES de chamar o modelo. `limite_atingido` = o mês já está
 * no limite e nada foi gravado. Erro de banco também recusa: sem contar, o
 * assistente não chama o modelo (falha fechada).
 */
export async function registrarMensagem(
  admin: SupabaseClient,
  m: { orgId: string; userId: string; conversaId: string | null; pagador: string; limite: number | null },
): Promise<RegistroDaMensagem> {
  const { data, error } = await admin.rpc("fn_assistente_registrar_mensagem", {
    p_org: m.orgId,
    p_user: m.userId,
    p_conversa: m.conversaId,
    p_pagador: m.pagador,
    p_limite: m.limite,
  });
  if (error) {
    logger.warn("vix: a mensagem não pôde ser contada — o assistente não chama o modelo", {
      organization_id: m.orgId,
      erro: error.message,
    });
    return { ok: false, motivo: "erro" };
  }
  return typeof data === "string" && data !== "" ? { ok: true, usoId: data } : { ok: false, motivo: "limite_atingido" };
}

export interface UsoDeUmaResposta {
  orgId: string;
  usoId: string;
  provedor: string;
  modelo: string;
  tokensDeEntrada: number;
  tokensDeSaida: number;
  falhou: boolean;
  /** Centavos de dólar. Assinatura: zero (mensalidade fixa). */
  custoUsdCents: number;
  /** O valor deste pagador na coluna de origem da chave de `llm_calls`. */
  origemDaChave: string;
}

const inteiro = (n: number) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0));

/**
 * A linha de `llm_calls` do assistente, como será gravada quando o segundo
 * destino for ligado. Pura, para o teste conferir a forma sem banco.
 */
export function linhaDeLlmCallsDoVix(u: UsoDeUmaResposta): Record<string, unknown> {
  return {
    organization_id: u.orgId,
    purpose: "assistente_vix",
    provider: u.provedor,
    model: u.modelo,
    input_tokens: inteiro(u.tokensDeEntrada),
    output_tokens: inteiro(u.tokensDeSaida),
    cost_cents: u.custoUsdCents,
    status: u.falhou ? "erro" : "ok",
    [COLUNA_DA_ORIGEM_DA_CHAVE]: u.origemDaChave,
  };
}

/**
 * Registra o que a resposta consumiu na linha de uso já contada. Nunca lança:
 * falha de registro vai para o log e não derruba a conversa (a mensagem já
 * foi contada no limite).
 *
 * `emLlmCalls` existe para o teste exercitar o segundo destino sem mudar a
 * chave; em produção vale `REGISTRAR_EM_LLM_CALLS`.
 */
export async function concluirUso(
  admin: SupabaseClient,
  u: UsoDeUmaResposta,
  emLlmCalls: boolean = REGISTRAR_EM_LLM_CALLS,
): Promise<void> {
  try {
    const { error } = await admin
      .from("assistente_usos")
      .update({
        provedor: u.provedor,
        modelo: u.modelo,
        tokens_de_entrada: inteiro(u.tokensDeEntrada),
        tokens_de_saida: inteiro(u.tokensDeSaida),
        falhou: u.falhou,
      })
      .eq("id", u.usoId)
      .eq("organization_id", u.orgId);
    if (error) logger.warn("vix: registro de uso falhou", { organization_id: u.orgId, erro: error.message });
    if (emLlmCalls) {
      const r = await admin.from("llm_calls").insert(linhaDeLlmCallsDoVix(u));
      if (r.error) logger.warn("vix: linha de llm_calls falhou", { organization_id: u.orgId, erro: r.error.message });
    }
  } catch (erro) {
    logger.warn("vix: registro de uso lançou", {
      organization_id: u.orgId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
  }
}
