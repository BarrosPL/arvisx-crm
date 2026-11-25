/**
 * O USO, O LIMITE E O CUSTO DO VIX — A ÚNICA COSTURA.
 *
 * Tudo que o resto do assistente sabe sobre limite e custo passa por aqui: ler
 * a configuração da organização, contar a mensagem (e recusar a que passa do
 * limite do mês) e registrar o que a resposta consumiu.
 *
 * ═══ QUEM TEM O VIX ═══
 *
 * Duas portas (`fn_assistente_acesso_da_org`, migration 9830): a organização
 * tem a marca `isenta`, que só a plataforma escreve, ou tem assinatura ativa,
 * em qualquer plano. Sem as duas, `configDoVix` devolve `null` e o assistente
 * não responde (falha fechada).
 *
 * ═══ NÃO HÁ LIMITE DE MENSAGENS POR PLANO ═══
 *
 * O que existe é um FREIO TÉCNICO contra abuso, da instalação e igual para os
 * dois pagadores: mensagens por minuto por pessoa e tamanho máximo da
 * mensagem (`freioDoVix`). Ele protege a conta compartilhada de laço ou
 * script; não é cota comercial.
 *
 * Cada mensagem que CHEGA ao modelo vira uma linha de `assistente_usos`
 * (contagem, tokens e data, nunca texto), gravada antes da chamada. É o que
 * a administração da plataforma olha para ver o uso por organização.
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

import { valorDaInstalacao } from "@/lib/instalacao/config";
import { logger } from "@/lib/logger";

import type { Pagador } from "./provedor/tipos";

type PagadorLigado = Exclude<Pagador, "desligado">;

/** A chave de troca do segundo destino. Ver o cabeçalho antes de mexer. */
export const REGISTRAR_EM_LLM_CALLS: boolean = false;

/** O nome PREVISTO da coluna de origem da chave em `llm_calls`. Confira antes de ligar. */
export const COLUNA_DA_ORIGEM_DA_CHAVE = "origem_da_chave";

/**
 * O VALOR DE ORIGEM QUE O VIX GRAVA, POR PAGADOR. O único mapa, e o único lugar
 * do produto onde estes valores são escritos (cerca:
 * `tests/unit/assistente-nao-se-mistura-com-o-plano.test.ts`).
 *
 * A coluna de origem é única para toda chamada de IA. O que impede o gasto de
 * um AGENTE de ser contado como Vix, e o contrário, é isto: o Vix escreve
 * sempre um valor PRÓPRIO, escolhido aqui pelo pagador, e nunca o valor dos
 * agentes (`plataforma`) nem o do cliente (`cliente`), nem quando a chave usada
 * é a mesma da plataforma. E nenhum caminho de agente passa por este arquivo.
 *
 * Se a decisão for um valor só para o Vix, troca-se aqui e em mais lugar nenhum.
 */
export const ORIGEM_DA_CHAVE_DO_VIX = {
  assinatura_plataforma: "assinatura_plataforma",
  chave_plataforma: "assistente_chave_plataforma",
} as const satisfies Record<PagadorLigado, string>;

/** Valores que pertencem a outros e que o Vix nunca grava. */
export const ORIGENS_QUE_NAO_SAO_DO_VIX = ["plataforma", "cliente", "assinatura"] as const;

/** Padrões do freio técnico. Valem quando a chave da instalação está vazia ou inválida. */
export const MENSAGENS_POR_MINUTO_PADRAO = 6;
export const TAMANHO_MAXIMO_DA_MENSAGEM_PADRAO = 2000;
/** O teto que nenhuma configuração ultrapassa (é também o do schema da rota). */
export const TAMANHO_MAXIMO_ABSOLUTO = 4000;
const MENSAGENS_POR_MINUTO_MAXIMO = 60;
/** Quantos registros um cartão pode alterar de uma vez. */
export const LIMITE_DE_LOTE = 5;
/** Quantas ferramentas o modelo pode chamar num turno. */
export const FERRAMENTAS_POR_TURNO = 8;

export interface FreioDoVix {
  mensagensPorMinuto: number;
  tamanhoMaximoDaMensagem: number;
}

function inteiroEntre(bruto: string | null | undefined, minimo: number, maximo: number, padrao: number): number {
  const texto = (bruto ?? "").trim();
  if (!/^\d{1,6}$/.test(texto)) return padrao;
  const n = Number(texto);
  return n >= minimo && n <= maximo ? n : padrao;
}

/**
 * O freio técnico, lido da configuração da instalação. Valor ausente, que não é
 * número ou fora da faixa cai no padrão: uma chave mal escrita não desliga o
 * freio nem o afrouxa.
 */
export async function freioDoVix(): Promise<FreioDoVix> {
  const [porMinuto, tamanho] = await Promise.all([
    valorDaInstalacao("VIX_MENSAGENS_POR_MINUTO"),
    valorDaInstalacao("VIX_TAMANHO_MAXIMO_DA_MENSAGEM"),
  ]);
  return {
    mensagensPorMinuto: inteiroEntre(porMinuto.valor, 1, MENSAGENS_POR_MINUTO_MAXIMO, MENSAGENS_POR_MINUTO_PADRAO),
    tamanhoMaximoDaMensagem: inteiroEntre(tamanho.valor, 100, TAMANHO_MAXIMO_ABSOLUTO, TAMANHO_MAXIMO_DA_MENSAGEM_PADRAO),
  };
}

export interface ConfigDoVix extends FreioDoVix {
  /** Por qual porta a organização tem o assistente. */
  origem: "marca" | "assinatura_ativa";
  limiteDeLote: number;
  ferramentasPorTurno: number;
}

/**
 * A configuração do Vix para a organização, ou `null` quando ela não tem o
 * assistente (sem marca e sem assinatura ativa) ou a leitura falhou.
 */
export async function configDoVix(admin: SupabaseClient, orgId: string): Promise<ConfigDoVix | null> {
  const { data, error } = await admin.rpc("fn_assistente_acesso_da_org", { p_org: orgId });
  if (error) {
    logger.warn("vix: acesso da organização ilegível — o assistente não responde", {
      organization_id: orgId,
      erro: error.message,
    });
    return null;
  }
  if (data !== "marca" && data !== "assinatura_ativa") return null;
  return {
    origem: data,
    limiteDeLote: LIMITE_DE_LOTE,
    ferramentasPorTurno: FERRAMENTAS_POR_TURNO,
    ...(await freioDoVix()),
  };
}

/** Quantas mensagens a organização já usou neste mês, ou `null` se a leitura falhou. */
export async function mensagensUsadasNoMes(admin: SupabaseClient, orgId: string): Promise<number | null> {
  const { data, error } = await admin.rpc("fn_assistente_mensagens_do_mes", { p_org: orgId });
  if (error) return null;
  const n = Number(data ?? 0);
  return Number.isFinite(n) ? n : null;
}

export type RegistroDaMensagem = { ok: true; usoId: string } | { ok: false; motivo: "erro" };

/**
 * Registra a mensagem ANTES de chamar o modelo. Não há limite a conferir. Erro
 * de banco recusa: sem registrar, o assistente não chama o modelo (falha
 * fechada), e o uso da conta compartilhada nunca fica sem rastro.
 */
export async function registrarMensagem(
  admin: SupabaseClient,
  m: { orgId: string; userId: string; conversaId: string | null; pagador: string },
): Promise<RegistroDaMensagem> {
  const { data, error } = await admin.rpc("fn_assistente_registrar_mensagem", {
    p_org: m.orgId,
    p_user: m.userId,
    p_conversa: m.conversaId,
    p_pagador: m.pagador,
  });
  if (error || typeof data !== "string" || data === "") {
    logger.warn("vix: a mensagem não pôde ser registrada — o assistente não chama o modelo", {
      organization_id: m.orgId,
      erro: error?.message ?? "sem id",
    });
    return { ok: false, motivo: "erro" };
  }
  return { ok: true, usoId: data };
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
  /** Quem pagou. A origem gravada em `llm_calls` sai daqui, por `ORIGEM_DA_CHAVE_DO_VIX`. */
  pagador: PagadorLigado;
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
    [COLUNA_DA_ORIGEM_DA_CHAVE]: ORIGEM_DA_CHAVE_DO_VIX[u.pagador],
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
