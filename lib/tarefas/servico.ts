/**
 * CRIAR, EDITAR E FILTRAR TAREFA — a regra, fora da rota.
 *
 * Duas portas escrevem tarefa a pedido de alguém: a tela (`app/api/v1/tasks`,
 * sessão de usuário) e o agente (`lib/mcp/tools/tarefas.ts`, token de API ou
 * agente nativo). O token não entra na rota REST — `requireRole` só reconhece
 * sessão —, então sem este módulo a segunda porta teria de repetir as
 * conferências da primeira, e regra escrita duas vezes diverge no primeiro
 * ajuste: uma das portas deixaria gravar responsável de outra organização.
 *
 * O que mora aqui é o que as duas portas têm de fazer IGUAL:
 *
 *  - a forma do que se aceita (`criacaoDaTarefaSchema`, `edicaoDaTarefaSchema`);
 *  - as conferências que a chave estrangeira não faz (responsável da mesma
 *    equipe, demanda da mesma organização e ainda aberta);
 *  - a gravação filtrada por organização;
 *  - a auditoria e a linha na timeline do negócio (o laço de retorno).
 *
 * O que NÃO mora aqui é quem pediu: cada porta autentica do seu jeito e entrega
 * a organização (de fonte confiável, nunca do corpo), o ator e os dados de
 * auditoria. A recusa volta como CÓDIGO, não como frase: a rota traduz para o
 * idioma de quem está na tela e a ferramenta escreve para o modelo.
 *
 * A tarefa automática (regra de automação, nó de follow-up) continua em
 * `criar-tarefa.ts`: lá o título tem placeholder e o responsável é "o dono do
 * negócio", perguntas que estas duas portas não fazem.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Actor } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import {
  EVENTO_TAREFA_CONCLUIDA,
  EVENTO_TAREFA_CRIADA,
  emitirEventoDaSuperficie,
} from "@/lib/automation/eventos-de-saida";
import type { Db } from "@/lib/db";
import { registraAtividadeDaTarefa } from "@/lib/tarefas/atividade";
import { conferirDemanda } from "@/lib/tarefas/demanda";
import { conferirResponsavel } from "@/lib/tarefas/responsavel";
import {
  PRIORIDADES_DA_TAREFA,
  SITUACOES_ABERTAS_DA_TAREFA,
  SITUACOES_DA_TAREFA,
  type Tarefa,
} from "@/lib/tarefas/tipos";

/** As colunas que a tela lê. Explícitas para o `select *` não vazar coluna nova. */
export const COLUNAS_DA_TAREFA =
  "id, organization_id, title, description, due_date, priority, status, lead_id, contact_id, demanda_id, assigned_to, created_by, created_at, updated_at, lead:crm_leads(id, title)";

/**
 * As mesmas, mais o TIPO e o RESULTADO (migration 9809).
 *
 * Lista separada de propósito: a tela não lê as duas colunas, e a rota REST
 * continua pedindo exatamente o que pedia. Só a ferramenta do agente as pede.
 */
export const COLUNAS_DA_TAREFA_COM_DESFECHO = `${COLUNAS_DA_TAREFA}, kind, result`;

export const criacaoDaTarefaSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().max(5000).nullable().optional(),
  due_date: z.string().datetime({ offset: true }).nullable().optional(),
  priority: z.enum(PRIORIDADES_DA_TAREFA).default("medium"),
  status: z.enum(SITUACOES_DA_TAREFA).default("pending"),
  lead_id: z.string().uuid().nullable().optional(),
  contact_id: z.string().uuid().nullable().optional(),
  // O vínculo com o ASSUNTO do atendimento (#2818): é o que faz a tarefa
  // criada de dentro da conversa voltar para a tela de quem precisa cumpri-la.
  // Opcional como os outros dois — a tarefa avulsa é caso real.
  demanda_id: z.string().uuid().nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
});

export const edicaoDaTarefaSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(5000).nullable().optional(),
    due_date: z.string().datetime({ offset: true }).nullable().optional(),
    priority: z.enum(PRIORIDADES_DA_TAREFA).optional(),
    status: z.enum(SITUACOES_DA_TAREFA).optional(),
    lead_id: z.string().uuid().nullable().optional(),
    contact_id: z.string().uuid().nullable().optional(),
    /** Vincular (`<uuid>`) e desvincular (`null`) a demanda do atendimento (#2818). */
    demanda_id: z.string().uuid().nullable().optional(),
    assigned_to: z.string().uuid().nullable().optional(),
  })
  // PATCH vazio gravaria só o `updated_at` e devolveria 200: a tela diria
  // "salvo" sobre uma edição que não existiu.
  .refine((v) => Object.keys(v).length > 0, { message: "Nada para alterar." });

/**
 * O que a tarefa do agente tem a mais (migration 9809): o TIPO, texto livre que
 * quem configura o agente escolhe ("ligação", "documento"), e o RESULTADO, o
 * que foi feito, escrito por quem concluiu.
 *
 * Nenhum dos dois tem vocabulário no código: tipo de tarefa é coisa de cada
 * operação, e uma lista fechada aqui seria o vocabulário de um nicho só.
 */
export const TIPO_DA_TAREFA_MAX = 60;
export const RESULTADO_DA_TAREFA_MAX = 20_000;

export type DadosDaNovaTarefa = z.infer<typeof criacaoDaTarefaSchema> & {
  kind?: string | null;
};

export type MudancasDaTarefa = z.infer<typeof edicaoDaTarefaSchema> & {
  kind?: string | null;
  result?: string | null;
};

/** Por que a tarefa não foi gravada. Cada porta escreve a frase do seu leitor. */
export type RecusaDaTarefa =
  | "responsavel_fora_da_equipe"
  | "vinculo_inexistente"
  | "demanda_encerrada"
  | "nao_encontrada"
  | "falha";

export type DesfechoDaTarefa =
  | { ok: true; tarefa: Tarefa; fechouAgora: boolean }
  | { ok: false; recusa: RecusaDaTarefa };

/** Quem responde pela escrita no `api_audit_log`. */
export interface AuditoriaDaTarefa {
  /** Linha de `auth.users`, ou `null` quando quem agiu foi um token/agente. */
  actorUserId: string | null;
  /** O token de API que agiu (MCP). Ausente na rota da tela. */
  actorApiTokenId?: string | null;
  requestId: string;
  /** Somado ao `metadata` da linha: de onde veio, qual agente. */
  metadata?: Record<string, unknown>;
}

interface PortasDaTarefa {
  /** RLS (sessão) ou admin (token): nos dois casos a organização vai no filtro. */
  supabase: SupabaseClient;
  /** A porta de SQL, para as conferências que não passam por RLS. */
  db: Db;
  organizationId: string;
  /** Quem assina a linha da timeline do negócio. */
  ator: Actor;
  auditoria: AuditoriaDaTarefa;
  /** As colunas devolvidas. Default: as da tela. */
  colunas?: string;
}

/** As duas conferências que a chave estrangeira não faz. */
async function conferirVinculos(
  db: Db,
  organizationId: string,
  dados: { assigned_to?: string | null; demanda_id?: string | null },
): Promise<RecusaDaTarefa | null> {
  if (dados.assigned_to) {
    // A chave estrangeira de `assigned_to` é só para `auth.users`: sem esta conferência, um id de
    // outra organização (ou de quem saiu da equipe) gravaria sem erro. A régua
    // e o porquê do filtro de organização estão em `lib/tarefas/responsavel.ts`
    // (SQL direto na porta de `lib/db` — o pool NÃO passa por RLS).
    const veredito = await conferirResponsavel(db, organizationId, dados.assigned_to);
    if (veredito === "falha_na_consulta") return "falha";
    if (veredito === "fora_da_equipe") return "responsavel_fora_da_equipe";
  }

  if (dados.demanda_id) {
    // A chave estrangeira não passa pela RLS: sem esta conferência, a demanda
    // de outra organização gravaria sem erro. A régua está em `lib/tarefas/demanda.ts`.
    const veredito = await conferirDemanda(db, organizationId, dados.demanda_id);
    if (veredito === "falha_na_consulta") return "falha";
    if (veredito === "fora_da_organizacao") return "vinculo_inexistente";
    if (veredito === "encerrada") return "demanda_encerrada";
  }

  return null;
}

function linhaDeAuditoria(auditoria: AuditoriaDaTarefa): {
  actorUserId: string | null;
  actorApiTokenId?: string | null;
  requestId: string;
} {
  return {
    actorUserId: auditoria.actorUserId,
    ...(auditoria.actorApiTokenId ? { actorApiTokenId: auditoria.actorApiTokenId } : {}),
    requestId: auditoria.requestId,
  };
}

export async function criarTarefa(
  portas: PortasDaTarefa & {
    dados: DadosDaNovaTarefa;
    /** `crm_tasks.created_by` (FK para `auth.users`): `null` quando não foi uma pessoa. */
    criadaPor: string | null;
  },
): Promise<DesfechoDaTarefa> {
  const { supabase, db, organizationId, dados } = portas;

  const recusa = await conferirVinculos(db, organizationId, dados);
  if (recusa) return { ok: false, recusa };

  const { data, error } = await supabase
    .from("crm_tasks")
    .insert({
      ...dados,
      organization_id: organizationId,
      created_by: portas.criadaPor,
    })
    .select(portas.colunas ?? COLUNAS_DA_TAREFA)
    .single();

  if (error) {
    // 23503 = negócio, contato ou demanda apagado no meio, entre a escolha e a
    // gravação. A recusa nomeia os campos porque quem lê é quem escolheu.
    if (error.code === "23503") return { ok: false, recusa: "vinculo_inexistente" };
    return { ok: false, recusa: "falha" };
  }

  const tarefa = data as unknown as Tarefa;

  await audit({
    organizationId,
    ...linhaDeAuditoria(portas.auditoria),
    action: "crm_task.created",
    resourceType: "crm_tasks",
    resourceId: tarefa.id,
    metadata: {
      due_date: tarefa.due_date,
      priority: tarefa.priority,
      ...portas.auditoria.metadata,
    },
  });

  // O laço de retorno: tarefa presa a um negócio aparece na linha do tempo dele.
  await registraAtividadeDaTarefa(db, {
    organizationId,
    tarefa,
    tipo: "task_created",
    actor: portas.ator,
  });

  // O evento para sistemas de fora: só a tarefa presa a um negócio é
  // "tarefa do negócio". Leva IDs; título e descrição saem na entrega.
  if (tarefa.lead_id) {
    await emitirEventoDaSuperficie(supabase, {
      tipo: EVENTO_TAREFA_CRIADA,
      organizationId,
      entidadeId: tarefa.lead_id,
      payload: {
        lead_id: tarefa.lead_id,
        task_id: tarefa.id,
        ...(tarefa.contact_id ? { contact_id: tarefa.contact_id } : {}),
      },
      requestId: portas.auditoria.requestId,
    });
  }

  return { ok: true, tarefa, fechouAgora: false };
}

export async function editarTarefa(
  portas: PortasDaTarefa & { id: string; mudancas: MudancasDaTarefa },
): Promise<DesfechoDaTarefa> {
  const { supabase, db, organizationId, id, mudancas } = portas;

  const recusa = await conferirVinculos(db, organizationId, mudancas);
  if (recusa) return { ok: false, recusa };

  // A situação ANTES da edição decide se esta é a vez em que a tarefa fechou.
  // Sem ler antes, marcar "concluída" duas vezes emitiria duas linhas na
  // timeline do negócio — e a segunda seria mentira.
  const { data: antes } = await supabase
    .from("crm_tasks")
    .select("status")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("crm_tasks")
    .update(mudancas)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .select(portas.colunas ?? COLUNAS_DA_TAREFA)
    .single();

  if (error) {
    if (error.code === "PGRST116") return { ok: false, recusa: "nao_encontrada" };
    if (error.code === "23503") return { ok: false, recusa: "vinculo_inexistente" };
    return { ok: false, recusa: "falha" };
  }

  const tarefa = data as unknown as Tarefa;

  await audit({
    organizationId,
    ...linhaDeAuditoria(portas.auditoria),
    action: "crm_task.updated",
    resourceType: "crm_tasks",
    resourceId: tarefa.id,
    metadata: { campos: Object.keys(mudancas), ...portas.auditoria.metadata },
  });

  const fechouAgora =
    tarefa.status === "done" && (antes as { status?: string } | null)?.status !== "done";
  if (fechouAgora) {
    await registraAtividadeDaTarefa(db, {
      organizationId,
      tarefa,
      tipo: "task_completed",
      actor: portas.ator,
    });
    // `task.completed`: uma vez, na edição em que a tarefa fechou, venha ela da
    // tela ou de um agente. A entidade é a TAREFA (ela pode não ter negócio).
    await emitirEventoDaSuperficie(supabase, {
      tipo: EVENTO_TAREFA_CONCLUIDA,
      organizationId,
      entidadeId: tarefa.id,
      payload: {
        task_id: tarefa.id,
        ...(tarefa.lead_id ? { lead_id: tarefa.lead_id } : {}),
        ...(tarefa.contact_id ? { contact_id: tarefa.contact_id } : {}),
      },
      requestId: portas.auditoria.requestId,
    });
  }

  return { ok: true, tarefa, fechouAgora };
}

/** Os filtros que as duas listas (a da tela e a do agente) entendem do mesmo jeito. */
export interface FiltrosDaLista {
  status?: (typeof SITUACOES_DA_TAREFA)[number];
  priority?: (typeof PRIORIDADES_DA_TAREFA)[number];
  lead_id?: string;
  contact_id?: string;
  demanda_id?: string;
  due_from?: string;
  due_to?: string;
  /** `true` = só o que ainda pede ação (`SITUACOES_ABERTAS_DA_TAREFA`). */
  abertas?: boolean;
  /** Um membro, ou `null` para "sem responsável". Ausente = não filtra. */
  responsavel?: string | null;
}

/** O mínimo da cadeia do PostgREST que os filtros usam. */
interface ConsultaFiltravel<Q> {
  eq(coluna: string, valor: unknown): Q;
  is(coluna: string, valor: null): Q;
  in(coluna: string, valores: readonly unknown[]): Q;
  gte(coluna: string, valor: string): Q;
  lte(coluna: string, valor: string): Q;
}

/**
 * Aplica os filtros numa consulta de `crm_tasks` que JÁ filtra a organização.
 *
 * A ordem das chamadas é a que a rota sempre fez — os testes dela leem a
 * sequência de filtros que chegou ao cliente.
 */
export function aplicarFiltrosDaLista<Q extends ConsultaFiltravel<Q>>(
  consulta: Q,
  filtros: FiltrosDaLista,
): Q {
  let query = consulta;
  if (filtros.status) query = query.eq("status", filtros.status);
  if (filtros.priority) query = query.eq("priority", filtros.priority);
  if (filtros.lead_id) query = query.eq("lead_id", filtros.lead_id);
  if (filtros.contact_id) query = query.eq("contact_id", filtros.contact_id);
  if (filtros.demanda_id) query = query.eq("demanda_id", filtros.demanda_id);
  if (filtros.due_from) query = query.gte("due_date", filtros.due_from);
  if (filtros.due_to) query = query.lte("due_date", filtros.due_to);
  if (filtros.abertas === true) query = query.in("status", [...SITUACOES_ABERTAS_DA_TAREFA]);
  if (filtros.responsavel === null) query = query.is("assigned_to", null);
  else if (filtros.responsavel) query = query.eq("assigned_to", filtros.responsavel);
  return query;
}
