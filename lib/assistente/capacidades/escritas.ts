/**
 * AS DUAS ESCRITAS DE EXEMPLO DA FASE 1 — atrás de chave DESLIGADA por padrão
 * (`MODULO_ASSISTENTE_ESCRITAS`, em Painel › Sistema).
 *
 * Elas existem para provar o mecanismo do cartão com efeito de verdade no CRM.
 * Nenhuma fala com cliente final. As duas executam pelo MESMO código da tela
 * (o `_handler` da rota e o serviço de tarefas), com a pessoa logada como ator
 * e o cliente de sessão: papel, RLS, atividade na linha do tempo e auditoria
 * são os da tela.
 *
 * O modelo não chama `executar`: ele só consegue PROPOR (`preparar`). Quem
 * executa é o clique do usuário, em `lib/assistente/confirmar.ts`.
 */
import { z } from "zod";

import { getLeadHandler, updateLeadHandler } from "@/app/api/v1/leads/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { portaDaAplicacao } from "@/lib/db";
import { criarTarefa } from "@/lib/tarefas/servico";

import { capacidade, type Capacidade, type ContextoDoAssistente } from "../tipos";

export const TESTE_DAS_ESCRITAS = "tests/invariants/assistente-escritas-so-no-clique.test.ts";

/** Teto de itens que o SCHEMA aceita; o limite de lote do plano é menor e é conferido no executor. */
const MAXIMO_DE_ITENS_NO_SCHEMA = 50;

function ctxDaTela(ctx: ContextoDoAssistente): HandlerCtx {
  return {
    organization_id: ctx.orgId,
    actor: { type: "user", id: ctx.userId, role: ctx.papel },
    requestId: ctx.requestId,
    idioma: ctx.idioma,
  };
}

const entradaDaEtiqueta = z.object({
  lead_ids: z.array(z.string().uuid()).min(1).max(MAXIMO_DE_ITENS_NO_SCHEMA),
  etiqueta: z.string().trim().min(1).max(60),
});

/** Adicionar uma etiqueta a negócios. Inverso: remover a etiqueta pela tela. */
const etiquetasAdicionar = capacidade({
  nome: "etiquetas_adicionar",
  descricao:
    "Propõe adicionar UMA etiqueta a um ou mais negócios (`lead_ids`). Nada é alterado até o usuário confirmar no cartão. Lote pequeno: se forem muitos negócios, proponha mais de um cartão.",
  nivel: "escrever",
  papelMinimo: "agent",
  rotaDaTela: { caminho: "/api/v1/leads", metodo: "PATCH" },
  entrada: entradaDaEtiqueta,
  temInverso: { parcial: "a etiqueta é removida pela tela do negócio; não há capacidade de remover na Fase 1" },
  teste: TESTE_DAS_ESCRITAS,
  origem: { tipo: "tela", handler: "app/api/v1/leads/_handler.ts#updateLeadHandler" },
  preparar: async ({ lead_ids, etiqueta }, ctx) => {
    const unicos = [...new Set(lead_ids)];
    const itens: { id: string; rotulo: string }[] = [];
    for (const id of unicos) {
      // Lê pelo mesmo caminho da tela: negócio de outra empresa ou que a pessoa
      // não enxerga estoura aqui, e o cartão não nasce.
      const lead = await getLeadHandler(ctx.db, ctxDaTela(ctx), id);
      itens.push({ id, rotulo: String((lead as { title?: unknown }).title ?? id) });
    }
    return { resumo: `Adicionar a etiqueta "${etiqueta}" a ${itens.length} negócio(s)`, itens };
  },
  executar: async ({ lead_ids, etiqueta }, ctx) => {
    const alterados: string[] = [];
    for (const id of [...new Set(lead_ids)]) {
      const lead = await getLeadHandler(ctx.db, ctxDaTela(ctx), id);
      const atuais = Array.isArray((lead as { tags?: unknown }).tags) ? ((lead as { tags: string[] }).tags) : [];
      if (atuais.includes(etiqueta)) continue;
      await updateLeadHandler(ctx.db, ctxDaTela(ctx), id, { tags: [...atuais, etiqueta] } as never);
      alterados.push(id);
    }
    return { etiqueta, negocios_alterados: alterados };
  },
});

const entradaDaTarefa = z.object({
  titulo: z.string().trim().min(1).max(255),
  descricao: z.string().trim().max(2000).optional(),
  vence_em: z.string().datetime({ offset: true }).optional(),
  lead_id: z.string().uuid().optional(),
});

/** Criar uma tarefa para o PRÓPRIO usuário. Inverso parcial: concluir pela tela. */
const tarefasCriar = capacidade({
  nome: "tarefas_criar",
  descricao:
    "Propõe criar uma tarefa para o PRÓPRIO usuário (ele é o responsável), com título, descrição e prazo opcionais, e opcionalmente ligada a um negócio. Nada é criado até o usuário confirmar no cartão.",
  nivel: "escrever",
  papelMinimo: "agent",
  rotaDaTela: { caminho: "/api/v1/tasks", metodo: "POST" },
  entrada: entradaDaTarefa,
  temInverso: { parcial: "a tarefa pode ser concluída ou editada pela tela de Tarefas; não é apagada" },
  teste: TESTE_DAS_ESCRITAS,
  origem: { tipo: "tela", handler: "lib/tarefas/servico.ts#criarTarefa" },
  preparar: async ({ titulo, lead_id }, ctx) => {
    let ligadaA = "";
    if (lead_id) {
      const lead = await getLeadHandler(ctx.db, ctxDaTela(ctx), lead_id);
      ligadaA = ` (negócio: ${String((lead as { title?: unknown }).title ?? lead_id)})`;
    }
    return { resumo: `Criar a tarefa "${titulo}" para você${ligadaA}`, itens: [{ id: "tarefa", rotulo: titulo }] };
  },
  executar: async ({ titulo, descricao, vence_em, lead_id }, ctx) => {
    const desfecho = await criarTarefa({
      supabase: ctx.db,
      db: portaDaAplicacao(),
      organizationId: ctx.orgId,
      dados: {
        title: titulo,
        description: descricao ?? null,
        due_date: vence_em ?? null,
        priority: "medium",
        status: "pending",
        lead_id: lead_id ?? null,
        assigned_to: ctx.userId,
      },
      criadaPor: ctx.userId,
      ator: { type: "user", id: ctx.userId },
      auditoria: { actorUserId: ctx.userId, requestId: ctx.requestId },
    });
    if (!desfecho.ok) throw new Error(`tarefa_recusada:${desfecho.recusa}`);
    return { tarefa_id: desfecho.tarefa.id, criada: true };
  },
});

export const ESCRITAS_DE_EXEMPLO: readonly Capacidade[] = [etiquetasAdicionar, tarefasCriar];
