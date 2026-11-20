import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/tasks — as tarefas da organização, em ordem de prazo.
 * POST /api/v1/tasks — cria uma tarefa.
 *
 * Extraído do PR #418 (@clinicacentrodosorrisosc-code). Duas coisas do original
 * NÃO vieram, e as duas por motivo escrito:
 *
 *  1. **A lista de "agendamentos" derivada de `custom_fields`.** O GET original
 *     varria `crm_leads` procurando `agendamento_data`, `agendamento_hora`,
 *     `procedimento` e `agendamento_status` e sintetizava itens com título
 *     `🗓️ Fulano (Limpeza)`. Para a clínica dele isso era a agenda inteira; num
 *     produto que já tem `calendar_appointments` (migration 0177) seria uma
 *     SEGUNDA verdade sobre o mesmo compromisso, alimentada por um jsonb sem
 *     schema — e escrita em vocabulário de um nicho só.
 *
 *  2. **O fallback para `custom_fields.tasks` quando a tabela não existe.** O
 *     original capturava `42P01`/`PGRST205` e passava a gravar as tarefas dentro
 *     do lead. Isso existia porque lá a tabela vivia só no `baseline.sql`, sem
 *     migration — quem aplicasse `migrations/` não a teria. Aqui a 0210 fecha
 *     essa lacuna, e o fallback vira o pior tipo de rede: ele transforma "o
 *     banco desta instalação está desatualizado" em sucesso silencioso, com o
 *     dado indo para um lugar que nenhuma lista, índice ou policy alcança.
 *     Falhar aberto na INFORMAÇÃO é o certo aqui: 500 com a mensagem do banco.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { portaDaAplicacao } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import {
  COLUNAS_DA_TAREFA,
  aplicarFiltrosDaLista,
  criacaoDaTarefaSchema,
  criarTarefa,
} from "@/lib/tarefas/servico";
import { PRIORIDADES_DA_TAREFA, SITUACOES_DA_TAREFA, type Tarefa } from "@/lib/tarefas/tipos";

export const dynamic = "force-dynamic";

/**
 * As colunas que a tela lê e a regra de criação moram em `lib/tarefas/servico.ts`:
 * a ferramenta do agente (`lib/mcp/tools/tarefas.ts`) grava pela MESMA função,
 * porque o token de API não entra nesta rota.
 */
const COLUNAS = COLUNAS_DA_TAREFA;

/**
 * Com o filtro de funil o `lead` vira INNER JOIN: o PostgREST só filtra pela coluna de um
 * recurso embutido se o embutido for obrigatório; com o join comum a tarefa de outro funil
 * continuaria na lista, só que com `lead: null`. Sem o filtro a consulta é a de sempre — o
 * join obrigatório esconderia as tarefas soltas (sem negócio), que são caso real.
 */
const COLUNAS_NO_FUNIL = COLUNAS.replace("lead:crm_leads(", "lead:crm_leads!inner(");

const criacaoSchema = criacaoDaTarefaSchema;

const listaSchema = z.object({
  status: z.enum(SITUACOES_DA_TAREFA).optional(),
  priority: z.enum(PRIORIDADES_DA_TAREFA).optional(),
  lead_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  /** As tarefas de UMA demanda — a seção "Tarefas desta demanda" do inbox. */
  demanda_id: z.string().uuid().optional(),
  due_from: z.string().datetime({ offset: true }).optional(),
  due_to: z.string().datetime({ offset: true }).optional(),
  /** "abertas" = o que ainda pede ação. É o default da tela. */
  aberto: z.enum(["true", "false"]).optional(),
  /**
   * De QUEM é a tarefa: `me` (o usuário da sessão, resolvido aqui), `ninguem`
   * (sem responsável) ou o id de um membro. Sem isto a tela de Tarefas misturava
   * a equipe inteira numa lista só (a lista corta em 500 — filtrar na tela
   * esconderia as que ficaram fora do corte). Um id de terceiro vindo do
   * navegador só ESTREITA uma lista que viewer+ já vê inteira; a organização sai
   * da sessão e a RLS segura o resto.
   */
  assigned_to: z.union([z.literal("me"), z.literal("ninguem"), z.string().uuid()]).optional(),
  /**
   * Só as tarefas de negócios DESTE funil (`crm_leads.pipeline_id`). A tarefa não tem funil
   * próprio: ela herda o do negócio a que está presa, então tarefa solta fica de fora quando
   * o filtro está ligado. Um id de outra organização não devolve nada — o `organization_id`
   * da consulta e a RLS continuam valendo.
   */
  pipeline_id: z.string().uuid().optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("viewer", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = listaSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return fail("validation_failed", t("Parâmetros inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const filtros = parsed.data;

  const supabase = await createClient();
  // ⚠️ `organization_id` à mão mesmo com RLS ligada: é a regra do CLAUDE.md, e
  // ela não é redundante — o dia em que esta rota trocar para o admin client
  // (que bypassa RLS) o filtro já está aqui.
  let query = supabase
    .from("crm_tasks")
    .select(filtros.pipeline_id ? COLUNAS_NO_FUNIL : COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);

  query = aplicarFiltrosDaLista(query, {
    status: filtros.status,
    priority: filtros.priority,
    lead_id: filtros.lead_id,
    contact_id: filtros.contact_id,
    demanda_id: filtros.demanda_id,
    due_from: filtros.due_from,
    due_to: filtros.due_to,
    abertas: filtros.aberto === "true",
    responsavel:
      filtros.assigned_to === "me"
        ? authz.user.id
        : filtros.assigned_to === "ninguem"
          ? null
          : filtros.assigned_to,
  });
  if (filtros.pipeline_id) query = query.eq("lead.pipeline_id", filtros.pipeline_id);

  const { data, error } = await query;
  if (error) {
    return fail("internal_error", t("Erro ao listar as tarefas."), 500, { requestId });
  }

  return ok({ tasks: (data ?? []) as unknown as Tarefa[] }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();

  // `agent` e não `manager`: criar tarefa é o gesto de quem ATENDE, todo dia.
  const authz = await requireRole("agent", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = criacaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();

  const desfecho = await criarTarefa({
    supabase,
    db: portaDaAplicacao(),
    organizationId: authz.org.orgId,
    dados: parsed.data,
    criadaPor: authz.user.id,
    ator: { type: "user", id: authz.user.id },
    auditoria: { actorUserId: authz.user.id, requestId },
  });

  if (!desfecho.ok) {
    switch (desfecho.recusa) {
      case "responsavel_fora_da_equipe":
        return fail("validation_failed", t("O responsável escolhido não faz parte da equipe."), 422, {
          requestId,
        });
      case "vinculo_inexistente":
        return fail("validation_failed", t("O negócio, o contato ou a demanda vinculada não existe."), 422, {
          requestId,
        });
      case "demanda_encerrada":
        return fail("state_conflict", t("Esta demanda já foi encerrada. Crie a tarefa numa demanda em andamento."), 409, {
          requestId,
        });
      default:
        return fail("internal_error", t("Erro ao salvar a tarefa."), 500, { requestId });
    }
  }

  const tarefa = desfecho.tarefa;

  return ok({ task: tarefa }, { requestId, status: 201 });
}
