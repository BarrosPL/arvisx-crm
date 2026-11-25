/**
 * A ÚNICA PORTA POR ONDE UMA ESCRITA DO VIX ACONTECE.
 *
 * Só `app/api/v1/assistente/acoes/[id]/confirmar/route.ts` importa este
 * arquivo (cerca: `tests/unit/assistente-catalogo-cerca.test.ts`). O laço do
 * modelo não o alcança: o modelo propõe, o usuário clica, e é o clique que
 * chega aqui.
 *
 * Ordem, e ela importa:
 *
 *   1. RESERVA no banco (`fn_assistente_reservar_acao`): uma instrução só, que
 *      exige o usuário e a organização da sessão, estado `proposta` e prazo
 *      vigente. Cartão repetido, expirado, de outra pessoa ou de outra empresa
 *      não devolve linha, e nada mais roda;
 *   2. revalida TUDO com o estado de AGORA (papel, plano, módulo, entrada,
 *      lote): quem perdeu o papel entre a proposta e o clique não executa;
 *   3. nível sensível exige a palavra digitada;
 *   4. executa pelo código da capacidade e grava o desfecho.
 *
 * Reserva antes da revalidação de propósito: um cartão recusado na
 * revalidação fica `falhou` e não pode ser tentado de novo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { conferirCapacidade, type DependenciasDoExecutor } from "./executor";
import { mascararResultado } from "./filtro-de-segredo";
import { PALAVRA_DE_CONFIRMACAO, type ContextoDoAssistente, type MotivoDeRecusa } from "./tipos";

export type MotivoDaConfirmacao =
  | MotivoDeRecusa
  | "cartao_indisponivel"
  | "confirmacao_ausente";

export type ResultadoDaConfirmacao =
  | { ok: true; capacidade: string; resultado: unknown }
  | { ok: false; motivo: MotivoDaConfirmacao; capacidade?: string };

interface LinhaDaAcao {
  id: string;
  capacidade: string;
  nivel: string;
  entrada: unknown;
  quantidade: number;
}

async function encerrar(
  admin: SupabaseClient,
  ctx: ContextoDoAssistente,
  acaoId: string,
  campos: Record<string, unknown>,
): Promise<void> {
  await admin
    .from("assistente_acoes")
    .update(campos)
    .eq("id", acaoId)
    .eq("organization_id", ctx.orgId)
    .eq("user_id", ctx.userId);
}

export async function executarConfirmada(
  admin: SupabaseClient,
  acaoId: string,
  confirmacao: string | undefined,
  ctx: ContextoDoAssistente,
  deps: DependenciasDoExecutor,
): Promise<ResultadoDaConfirmacao> {
  const { data, error } = await admin.rpc("fn_assistente_reservar_acao", {
    p_org: ctx.orgId,
    p_user: ctx.userId,
    p_acao: acaoId,
  });
  const acao = (Array.isArray(data) ? data[0] : data) as LinhaDaAcao | null | undefined;
  if (error || !acao) return { ok: false, motivo: "cartao_indisponivel" };

  const falhar = async (motivo: MotivoDaConfirmacao): Promise<ResultadoDaConfirmacao> => {
    await encerrar(admin, ctx, acao.id, { estado: "falhou", erro: motivo });
    return { ok: false, motivo, capacidade: acao.capacidade };
  };

  const c = await conferirCapacidade(acao.capacidade, acao.entrada, ctx, deps);
  if (!c.ok) return falhar(c.motivo);
  if (c.cap.nivel === "ler" || c.cap.nivel !== acao.nivel) return falhar("nivel_errado");
  if (!deps.escritasLigadas && c.cap.origem.tipo !== "propria") return falhar("escritas_desligadas");
  if (acao.quantidade > deps.limiteDeLote) return falhar("lote_acima_do_limite");
  // O lote é medido de novo a partir da ENTRADA, com o que o usuário enxerga
  // agora: a contagem gravada no cartão não é a autoridade.
  if (c.cap.preparar) {
    try {
      const rascunho = await c.cap.preparar(c.entrada as never, ctx);
      if (rascunho.itens.length > deps.limiteDeLote) return falhar("lote_acima_do_limite");
    } catch {
      return falhar("falha_ao_executar");
    }
  }
  if (c.cap.nivel === "sensivel" && (confirmacao ?? "").trim().toLowerCase() !== PALAVRA_DE_CONFIRMACAO) {
    return falhar("confirmacao_ausente");
  }

  try {
    const resultado = mascararResultado(await c.cap.executar(c.entrada as never, ctx));
    await encerrar(admin, ctx, acao.id, {
      estado: "executada",
      executada_em: new Date().toISOString(),
      resultado: resultado ?? null,
    });
    return { ok: true, capacidade: acao.capacidade, resultado };
  } catch {
    return falhar("falha_ao_executar");
  }
}
