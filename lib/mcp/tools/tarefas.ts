/**
 * Handlers das capacidades de TAREFA — o combinado de trabalho interno com prazo.
 *
 *  Read:
 *   - crm_list_tasks
 *  Write:
 *   - crm_create_task
 *   - crm_complete_task
 *   - crm_update_task
 *
 * Fachada fina: a regra mora em `lib/tarefas/servico.ts`, a MESMA que a tela usa
 * por `app/api/v1/tasks`. Um token de API não entra naquela rota (`requireRole`
 * só reconhece sessão de usuário), então a superfície do agente — externo, por
 * token, ou nativo — é esta. Nenhuma conferência é reescrita aqui: responsável
 * da mesma equipe, vínculo da mesma organização, auditoria e linha na timeline
 * do negócio saem da função compartilhada.
 *
 * `organization_id` SEMPRE do `ctx` (o token), NUNCA do input — o cliente é
 * service role e ignora RLS.
 *
 * Tarefa não fala com o cliente: nada aqui envia mensagem. Quem lê a tarefa é a
 * equipe, na tela de Tarefas e na linha do tempo do negócio.
 */
import { z } from "zod";

import { portaDaAplicacao } from "@/lib/db";
import {
  COLUNAS_DA_TAREFA_COM_DESFECHO,
  RESULTADO_DA_TAREFA_MAX,
  TIPO_DA_TAREFA_MAX,
  aplicarFiltrosDaLista,
  criacaoDaTarefaSchema,
  criarTarefa,
  editarTarefa,
  type RecusaDaTarefa,
} from "@/lib/tarefas/servico";
import { PRIORIDADES_DA_TAREFA, estaAtrasada, type Tarefa } from "@/lib/tarefas/tipos";
import { instanteDoArgumento, responsavelDoArgumento } from "../argumentos-do-agente";
import { auditoriaDoContexto } from "../ator-do-contexto";
import { comChaveDoPedido } from "../idempotencia";
import {
  CONSULTA_INDISPONIVEL,
  NEGOCIO_FORA_DA_CONVERSA,
  contatoDoContexto,
  negocioDoContexto,
  recusa,
  type RecusaParaOAgente,
} from "../negocio-do-contexto";
import type { McpContext, McpToolDefinition } from "../types";

/**
 * O responsável e as datas são TEXTO no esquema e conferidos no handler
 * (`lib/mcp/argumentos-do-agente.ts`): declarados como união/uuid/data-hora, o
 * zod os traduz em expressão regular, que vai ao modelo em todo passo do turno.
 */
const RESPONSAVEL = z.string().min(1).max(36);
const INSTANTE = z.string().min(1).max(40);

const DESCRICAO_DO_RESPONSAVEL = "user_id de um atendente, ou 'equipe' (sem dono).";

/** A tarefa como o agente a lê: sem coluna interna, com o atraso já calculado. */
function paraOAgente(tarefa: Tarefa, agora: Date = new Date()) {
  return {
    id: tarefa.id,
    title: tarefa.title,
    description: tarefa.description,
    kind: tarefa.kind ?? null,
    due_date: tarefa.due_date,
    priority: tarefa.priority,
    status: tarefa.status,
    overdue: estaAtrasada(tarefa, agora),
    assigned_to: tarefa.assigned_to,
    lead_id: tarefa.lead_id,
    lead_title: tarefa.lead?.title ?? null,
    contact_id: tarefa.contact_id,
    result: tarefa.result ?? null,
    created_at: tarefa.created_at,
    updated_at: tarefa.updated_at,
  };
}

const TAREFA_NAO_ENCONTRADA = recusa(
  "tarefa_nao_encontrada",
  "não existe tarefa com esse id nesta organização. Liste as tarefas para conferir o id.",
);

function recusaDaTarefa(codigo: RecusaDaTarefa): RecusaParaOAgente {
  switch (codigo) {
    case "responsavel_fora_da_equipe":
      return recusa(
        "responsavel_fora_da_equipe",
        "o responsável informado não faz parte da equipe desta organização (ou só tem acesso de " +
          "leitura). Use o user_id de um atendente da equipe, ou 'equipe' para deixar sem dono.",
      );
    case "vinculo_inexistente":
      return recusa(
        "vinculo_inexistente",
        "o negócio ou o contato vinculado não existe mais. Confira os ids e tente de novo.",
      );
    case "demanda_encerrada":
      return recusa("demanda_encerrada", "a demanda vinculada já foi encerrada.");
    case "nao_encontrada":
      return TAREFA_NAO_ENCONTRADA;
    default:
      return recusa(
        "indisponivel",
        "não consegui gravar a tarefa agora; tente de novo em instantes.",
      );
  }
}

// ---------------------------------------------------------------------------
// crm_list_tasks
// ---------------------------------------------------------------------------

const listaInputShape = {
  lead_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  assigned_to: RESPONSAVEL.optional().describe(DESCRICAO_DO_RESPONSAVEL),
  state: z.enum(["open", "completed", "all"]).default("open"),
  overdue: z.boolean().optional().describe("true = só as abertas com prazo vencido."),
  since: INSTANTE.optional().describe("Alteradas desde (ISO-8601 com fuso)."),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
};

interface CursorDeTarefa {
  created_at: string;
  id: string;
}

function codificarCursor(c: CursorDeTarefa): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodificarCursor(bruto: string): CursorDeTarefa | null {
  try {
    const lido = JSON.parse(Buffer.from(bruto, "base64url").toString("utf8")) as CursorDeTarefa;
    if (typeof lido.id !== "string" || typeof lido.created_at !== "string") return null;
    // O cursor entra num filtro `or(...)`: só o formato que este módulo emite.
    if (!/^[0-9a-f-]{36}$/i.test(lido.id) || !/^[0-9T:.+\-Z ]+$/.test(lido.created_at)) return null;
    return lido;
  } catch {
    return null;
  }
}

export const crmListTasks: McpToolDefinition<typeof listaInputShape> = {
  name: "crm_list_tasks",
  description:
    "Lista as tarefas internas da equipe, da mais antiga para a mais nova, com prazo, " +
    "prioridade, tipo, responsável, `overdue` e o `result` das concluídas. Abertas por padrão. " +
    "Paginada: repita com o `cursor` enquanto `has_more` for true.",
  inputSchema: listaInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const cursor = input.cursor ? decodificarCursor(input.cursor) : null;
    if (input.cursor && !cursor) {
      return recusa("cursor_invalido", "o cursor não é o que esta ferramenta devolveu; recomece sem ele.");
    }

    const responsavel = responsavelDoArgumento(input.assigned_to);
    if (!responsavel.ok) return responsavel.recusa;
    const desde = input.since ? instanteDoArgumento("since", input.since) : null;
    if (desde && !desde.ok) return desde.recusa;

    // Num turno de atendimento, só as tarefas do cliente atendido.
    let doTurno: { contato: string; negocios: string[] } | null = null;
    if (ctx.contatoDoTurno) {
      if (input.contact_id && input.contact_id.toLowerCase() !== ctx.contatoDoTurno.toLowerCase()) {
        return NEGOCIO_FORA_DA_CONVERSA;
      }
      const { data, error } = await ctx.supabase
        .from("crm_leads")
        .select("id")
        .eq("organization_id", ctx.organizationId)
        .eq("contact_id", ctx.contatoDoTurno);
      if (error) return CONSULTA_INDISPONIVEL;
      const negocios = ((data ?? []) as Array<{ id: string }>).map((l) => l.id);
      if (input.lead_id && !negocios.includes(input.lead_id)) return NEGOCIO_FORA_DA_CONVERSA;
      doTurno = { contato: ctx.contatoDoTurno, negocios };
    }

    const agora = new Date();
    let query = ctx.supabase
      .from("crm_tasks")
      .select(COLUNAS_DA_TAREFA_COM_DESFECHO)
      .eq("organization_id", ctx.organizationId);

    query = aplicarFiltrosDaLista(query, {
      lead_id: input.lead_id,
      contact_id: input.contact_id,
      status: input.state === "completed" ? "done" : undefined,
      abertas: input.state === "open" || input.overdue === true,
      responsavel: responsavel.responsavel,
    });
    if (input.overdue === true) query = query.lt("due_date", agora.toISOString());
    if (desde?.ok) query = query.gte("updated_at", desde.iso);
    if (doTurno) {
      query =
        doTurno.negocios.length > 0
          ? query.or(`contact_id.eq.${doTurno.contato},lead_id.in.(${doTurno.negocios.join(",")})`)
          : query.eq("contact_id", doTurno.contato);
    }
    if (cursor) {
      query = query.or(
        `created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`,
      );
    }

    const { data, error } = await query
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(input.limit + 1);
    if (error) return CONSULTA_INDISPONIVEL;

    const linhas = (data ?? []) as unknown as Tarefa[];
    const temMais = linhas.length > input.limit;
    const pagina = temMais ? linhas.slice(0, input.limit) : linhas;
    const ultima = pagina[pagina.length - 1];

    return {
      tasks: pagina.map((t) => paraOAgente(t, agora)),
      has_more: temMais,
      cursor: temMais && ultima ? codificarCursor({ created_at: ultima.created_at, id: ultima.id }) : null,
    };
  },
};

// ---------------------------------------------------------------------------
// crm_create_task
// ---------------------------------------------------------------------------

const criacaoInputShape = {
  title: z.string().trim().min(1).max(255),
  description: z.string().max(5000).optional(),
  due_date: INSTANTE.optional().describe("Prazo (ISO-8601 com fuso)."),
  priority: z.enum(PRIORIDADES_DA_TAREFA).optional(),
  kind: z.string().trim().min(1).max(TIPO_DA_TAREFA_MAX).optional().describe("Tipo, em texto livre."),
  assigned_to: RESPONSAVEL.optional().describe(`${DESCRICAO_DO_RESPONSAVEL} Padrão: 'equipe'.`),
  lead_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
};

export const crmCreateTask: McpToolDefinition<typeof criacaoInputShape> = {
  name: "crm_create_task",
  description:
    "Cria uma tarefa interna para a equipe — um combinado de trabalho com prazo, nunca " +
    "mensagem ao cliente. Ligue-a ao negócio e/ou ao contato; com negócio, aparece na linha do " +
    "tempo dele. Recusa vem com `permitido: false` e o motivo.",
  inputSchema: criacaoInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) =>
    comChaveDoPedido(ctx, "crm_create_task", input, async () => {
      const responsavel = responsavelDoArgumento(input.assigned_to);
      if (!responsavel.ok) return responsavel.recusa;
      const prazo = input.due_date ? instanteDoArgumento("due_date", input.due_date) : null;
      if (prazo && !prazo.ok) return prazo.recusa;

      let contactId = input.contact_id ?? null;

      if (input.lead_id) {
        const negocio = await negocioDoContexto(ctx, input.lead_id);
        if (!negocio.ok) return negocio.recusa;
        // Tarefa presa a um negócio herda o contato dele quando nenhum foi dito:
        // é o que a faz aparecer também nas tarefas da pessoa.
        contactId ??= negocio.lead.contact_id;
      }
      if (input.contact_id) {
        const contato = await contatoDoContexto(ctx, input.contact_id);
        if (!contato.ok) return contato.recusa;
      }

      // A MESMA forma que a rota da tela aceita — a ferramenta não tem régua própria.
      const dados = criacaoDaTarefaSchema.parse({
        title: input.title,
        description: input.description ?? null,
        due_date: prazo?.ok ? prazo.iso : null,
        ...(input.priority ? { priority: input.priority } : {}),
        lead_id: input.lead_id ?? null,
        contact_id: contactId,
        assigned_to: responsavel.responsavel ?? null,
      });

      const desfecho = await criarTarefa({
        supabase: ctx.supabase,
        db: portaDaAplicacao(),
        organizationId: ctx.organizationId,
        dados: { ...dados, kind: input.kind ?? null },
        // `created_by` é chave estrangeira para pessoa; quem criou foi um agente.
        // A autoria fica na auditoria (token) e na timeline (ator).
        criadaPor: null,
        ator: ctx.actor,
        auditoria: auditoriaDoContexto(ctx),
        colunas: COLUNAS_DA_TAREFA_COM_DESFECHO,
      });
      if (!desfecho.ok) return recusaDaTarefa(desfecho.recusa);

      return {
        task: paraOAgente(desfecho.tarefa),
        next_action: desfecho.tarefa.assigned_to
          ? "Tarefa criada e atribuída; ela aparece na tela de Tarefas de quem vai cumprir."
          : "Tarefa criada sem responsável; ela fica na lista da equipe até alguém assumir.",
      };
    }),
};

// ---------------------------------------------------------------------------
// crm_complete_task
// ---------------------------------------------------------------------------

async function lerTarefa(
  ctx: McpContext,
  taskId: string,
): Promise<{ ok: true; tarefa: Tarefa } | { ok: false; recusa: RecusaParaOAgente }> {
  const { data, error } = await ctx.supabase
    .from("crm_tasks")
    .select(COLUNAS_DA_TAREFA_COM_DESFECHO)
    .eq("organization_id", ctx.organizationId)
    .eq("id", taskId)
    .maybeSingle();
  if (error) return { ok: false, recusa: CONSULTA_INDISPONIVEL };
  if (!data) return { ok: false, recusa: TAREFA_NAO_ENCONTRADA };
  return { ok: true, tarefa: data as unknown as Tarefa };
}

const conclusaoInputShape = {
  task_id: z.string().uuid(),
  result: z
    .string()
    .trim()
    .min(1)
    .max(RESULTADO_DA_TAREFA_MAX)
    .optional()
    .describe("O que foi feito; fica gravado inteiro."),
};

export const crmCompleteTask: McpToolDefinition<typeof conclusaoInputShape> = {
  name: "crm_complete_task",
  description:
    "Conclui uma tarefa interna, com o resultado em texto. Repetir é seguro: tarefa já " +
    "concluída não muda e responde `already_completed: true`. Cancelada não é concluída.",
  inputSchema: conclusaoInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  // O resultado é texto sobre o cliente: na auditoria vai só o tamanho.
  redigirParaAuditoria: (args) =>
    typeof args.result === "string"
      ? { ...args, result: `[${args.result.length} caracteres]` }
      : args,
  handler: async (input, ctx) => {
    const lida = await lerTarefa(ctx, input.task_id);
    if (!lida.ok) return lida.recusa;

    if (lida.tarefa.status === "done") {
      // Idempotente: nada é gravado, nenhuma segunda linha "Tarefa concluída"
      // entra na timeline, e o resultado da primeira conclusão fica como está.
      return {
        task: paraOAgente(lida.tarefa),
        completed: true,
        already_completed: true,
        next_action: "A tarefa já estava concluída; nada foi alterado.",
      };
    }
    if (lida.tarefa.status === "cancelled") {
      return recusa(
        "tarefa_cancelada",
        "esta tarefa foi cancelada — concluí-la registraria um trabalho que ninguém fez. Se o " +
          "trabalho voltou a existir, crie uma tarefa nova.",
      );
    }

    const desfecho = await editarTarefa({
      supabase: ctx.supabase,
      db: portaDaAplicacao(),
      organizationId: ctx.organizationId,
      id: input.task_id,
      mudancas: { status: "done", ...(input.result ? { result: input.result } : {}) },
      ator: ctx.actor,
      auditoria: auditoriaDoContexto(ctx),
      colunas: COLUNAS_DA_TAREFA_COM_DESFECHO,
    });
    if (!desfecho.ok) return recusaDaTarefa(desfecho.recusa);

    return {
      task: paraOAgente(desfecho.tarefa),
      completed: true,
      already_completed: !desfecho.fechouAgora,
      next_action: "Tarefa concluída; a conclusão aparece na linha do tempo do negócio dela.",
    };
  },
};

// ---------------------------------------------------------------------------
// crm_update_task
// ---------------------------------------------------------------------------

const edicaoInputShape = {
  task_id: z.string().uuid(),
  due_date: INSTANTE.nullable().optional().describe("Novo prazo (ISO-8601 com fuso); null tira o prazo."),
  assigned_to: RESPONSAVEL.optional().describe(DESCRICAO_DO_RESPONSAVEL),
};

export const crmUpdateTask: McpToolDefinition<typeof edicaoInputShape> = {
  name: "crm_update_task",
  description:
    "Muda o prazo ou o responsável de uma tarefa interna; envie só o que muda. Não conclui.",
  inputSchema: edicaoInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const responsavel = responsavelDoArgumento(input.assigned_to);
    if (!responsavel.ok) return responsavel.recusa;
    const prazo = input.due_date ? instanteDoArgumento("due_date", input.due_date) : null;
    if (prazo && !prazo.ok) return prazo.recusa;

    const mudancas: { due_date?: string | null; assigned_to?: string | null } = {};
    if (input.due_date !== undefined) mudancas.due_date = prazo?.ok ? prazo.iso : null;
    if (responsavel.responsavel !== undefined) mudancas.assigned_to = responsavel.responsavel;
    if (Object.keys(mudancas).length === 0) {
      return recusa("nada_para_alterar", "informe `due_date` e/ou `assigned_to` — nada foi enviado para mudar.");
    }

    const desfecho = await editarTarefa({
      supabase: ctx.supabase,
      db: portaDaAplicacao(),
      organizationId: ctx.organizationId,
      id: input.task_id,
      mudancas,
      ator: ctx.actor,
      auditoria: auditoriaDoContexto(ctx),
      colunas: COLUNAS_DA_TAREFA_COM_DESFECHO,
    });
    if (!desfecho.ok) return recusaDaTarefa(desfecho.recusa);

    return {
      task: paraOAgente(desfecho.tarefa),
      next_action: "Tarefa atualizada.",
    };
  },
};
