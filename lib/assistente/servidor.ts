/**
 * O LADO DE SERVIDOR DO VIX que as rotas compartilham: as dependências do
 * executor montadas com o estado real, a auditoria, e a gravação de conversa,
 * mensagem e cartão.
 *
 * As tabelas `assistente_*` são escritas só pelo servidor (a sessão tem apenas
 * leitura). Por isso este arquivo usa a chave de serviço, e TODA escrita leva a
 * organização e o usuário que a ROTA resolveu da sessão (`ctx`), nunca um valor
 * vindo do corpo da requisição ou do modelo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit/actions";
import { recusaForaDoPlano } from "@/lib/cobranca/trava-do-plano";
import { modulosLigados } from "@/lib/instalacao/modulos";
import { capacidadesDaOrganizacao } from "@/lib/organizacao/capacidades";

import { CATALOGO } from "./capacidades";
import type { CartaoAGravar, DependenciasDoExecutor, EventoDoExecutor } from "./executor";
import type { ContextoDoAssistente, Modo } from "./tipos";

/** Quantas mensagens anteriores acompanham a pergunta. Histórico CURTO, de propósito. */
export const MENSAGENS_DE_HISTORICO = 12;

const ACAO_DO_EVENTO: Record<EventoDoExecutor["tipo"], AuditAction> = {
  leitura: "assistente.leitura",
  recusa: "assistente.recusa",
  acao_proposta: "assistente.acao_proposta",
};

/**
 * Auditoria do assistente. O ator é a PESSOA logada; o metadata diz que foi o
 * assistente em nome dela. Nunca leva o texto da conversa nem argumentos.
 */
export function auditarVix(
  acao: AuditAction,
  ctx: Pick<ContextoDoAssistente, "orgId" | "userId" | "requestId">,
  extra: { recursoTipo?: string; recursoId?: string | null; metadata?: Record<string, unknown> } = {},
): void {
  void audit({
    action: acao,
    actorUserId: ctx.userId,
    organizationId: ctx.orgId,
    resourceType: extra.recursoTipo ?? "assistente",
    resourceId: extra.recursoId ?? null,
    requestId: ctx.requestId,
    metadata: { via: "assistente", ator: "assistente", em_nome_de: ctx.userId, ...(extra.metadata ?? {}) },
  });
}

/** Grava o cartão. Organização e usuário são os do contexto. */
async function gravarCartao(admin: SupabaseClient, c: CartaoAGravar, ctx: ContextoDoAssistente): Promise<string> {
  const { data, error } = await admin
    .from("assistente_acoes")
    .insert({
      organization_id: ctx.orgId,
      conversa_id: c.conversaId,
      user_id: ctx.userId,
      capacidade: c.capacidade,
      nivel: c.nivel,
      entrada: c.entrada,
      resumo: c.resumo,
      itens: c.itens,
      quantidade: c.quantidade,
      expira_em: c.expiraEm.toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("cartao_nao_gravado");
  return (data as { id: string }).id;
}

/**
 * As dependências do executor com o estado real desta requisição. Montadas
 * uma vez por requisição, antes do turno: o modelo não participa de nada aqui.
 */
export async function dependenciasReais(
  admin: SupabaseClient,
  ctx: ContextoDoAssistente,
  opcoes: { escritasLigadas: boolean; limiteDeLote: number },
): Promise<DependenciasDoExecutor> {
  const [modulos, capacidades] = await Promise.all([modulosLigados(admin), capacidadesDaOrganizacao(admin, ctx.orgId)]);
  return {
    catalogo: CATALOGO,
    // A MESMA pergunta que a tela faz: a rota equivalente, classificada em
    // `lib/cobranca/rotas-do-plano.ts`. Sem segunda tabela de plano.
    foraDoPlano: async (orgId, rota) =>
      (await recusaForaDoPlano(orgId, { caminho: rota.caminho, metodo: rota.metodo, requestId: ctx.requestId })) !== null,
    modulosLigados: modulos,
    capacidadesDaEmpresa: capacidades,
    escritasLigadas: opcoes.escritasLigadas,
    limiteDeLote: opcoes.limiteDeLote,
    auditar: (evento, contexto) =>
      auditarVix(ACAO_DO_EVENTO[evento.tipo], contexto, {
        recursoTipo: evento.acaoId ? "assistente_acao" : "assistente",
        recursoId: evento.acaoId ?? null,
        metadata: {
          capacidade: evento.capacidade,
          ...(evento.motivo ? { motivo: evento.motivo } : {}),
          ...(evento.quantidade ? { quantidade: evento.quantidade } : {}),
        },
      }),
    gravarCartao: (cartao, contexto) => gravarCartao(admin, cartao, contexto),
  };
}

export type ConversaAberta = { ok: true; id: string; modo: Modo } | { ok: false; motivo: "nao_encontrada" | "erro" };

/**
 * A conversa em que a mensagem entra: a informada, se for DESTE usuário NESTA
 * organização, ou uma nova. Conversa de outra pessoa ou de outra empresa é
 * `nao_encontrada` (a rota responde 404, sem confirmar que existe).
 */
export async function abrirConversa(
  admin: SupabaseClient,
  ctx: ContextoDoAssistente,
  entrada: { conversaId?: string; modo?: Modo; telaDeOrigem?: string | null; titulo: string },
): Promise<ConversaAberta> {
  if (entrada.conversaId) {
    const { data, error } = await admin
      .from("assistente_conversas")
      .select("id, modo")
      .eq("id", entrada.conversaId)
      .eq("organization_id", ctx.orgId)
      .eq("user_id", ctx.userId)
      .is("arquivada_em", null)
      .maybeSingle();
    if (error) return { ok: false, motivo: "erro" };
    if (!data) return { ok: false, motivo: "nao_encontrada" };
    const linha = data as { id: string; modo: Modo };
    return { ok: true, id: linha.id, modo: entrada.modo ?? linha.modo };
  }
  const modo = entrada.modo ?? "suporte";
  const { data, error } = await admin
    .from("assistente_conversas")
    .insert({
      organization_id: ctx.orgId,
      user_id: ctx.userId,
      modo,
      titulo: entrada.titulo.slice(0, 80),
      tela_de_origem: entrada.telaDeOrigem ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, motivo: "erro" };
  return { ok: true, id: (data as { id: string }).id, modo };
}

/** As últimas mensagens da conversa, da mais antiga para a mais nova. */
export async function historicoCurto(
  admin: SupabaseClient,
  ctx: ContextoDoAssistente,
  conversaId: string,
): Promise<{ autor: "usuario" | "assistente"; corpo: string }[]> {
  const { data } = await admin
    .from("assistente_mensagens")
    .select("autor, corpo, created_at")
    .eq("organization_id", ctx.orgId)
    .eq("user_id", ctx.userId)
    .eq("conversa_id", conversaId)
    .not("corpo", "is", null)
    .order("created_at", { ascending: false })
    .limit(MENSAGENS_DE_HISTORICO);
  const linhas = (data ?? []) as { autor: "usuario" | "assistente"; corpo: string }[];
  return linhas.reverse().map((l) => ({ autor: l.autor, corpo: l.corpo }));
}

export type MensagemGravada = { ok: true } | { ok: false; motivo: "turno_repetido" | "erro" };

/**
 * Grava uma mensagem. A unique `(organização, conversa, turno, autor)` é a
 * idempotência do envio: o segundo POST do mesmo turno é `turno_repetido`.
 */
export async function gravarMensagem(
  admin: SupabaseClient,
  ctx: ContextoDoAssistente,
  m: {
    conversaId: string;
    turnId: string;
    autor: "usuario" | "assistente";
    corpo: string | null;
    origemDaEntrada?: "texto" | "voz_transcrita";
    erroCodigo?: string | null;
  },
): Promise<MensagemGravada> {
  const { error } = await admin.from("assistente_mensagens").insert({
    organization_id: ctx.orgId,
    conversa_id: m.conversaId,
    user_id: ctx.userId,
    turn_id: m.turnId,
    autor: m.autor,
    corpo: m.corpo,
    origem_da_entrada: m.origemDaEntrada ?? "texto",
    erro_codigo: m.erroCodigo ?? null,
  });
  if (!error) return { ok: true };
  return { ok: false, motivo: error.code === "23505" ? "turno_repetido" : "erro" };
}
