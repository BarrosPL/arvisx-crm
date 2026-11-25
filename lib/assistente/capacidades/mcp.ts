/**
 * AS LEITURAS DO CRM QUE O VIX REAPROVEITA DAS FERRAMENTAS MCP.
 *
 * O handler de cada ferramenta é o mesmo código que o agente de atendimento
 * usa. O que muda é QUEM chama e COM O QUÊ:
 *
 *  - o ator é a PESSOA logada (`{ type: "user" }`), com o papel dela;
 *  - o cliente é o de SESSÃO (`ctx.db`), não o de serviço. A RLS vale junto com
 *    o filtro de organização do handler, e a visibilidade por atendente das
 *    conversas vale pelo Vix como vale pela tela;
 *  - não há token de API. O Vix não cunha token; a auditoria é dele
 *    (`assistente.leitura`), não a `mcp.tool_called`.
 *
 * O papel mínimo de cada uma é o MAIS RESTRITO entre a tela e o MCP. As seis
 * de dado sensível (banco externo, receitas, honorários) e as de comentário são
 * de gerente para cima.
 *
 * REGRA: ferramenta só entra aqui com a prova dela em
 * `tests/invariants/assistente-leituras-isolamento.test.ts` (duas empresas
 * reais, PostgREST real, JWT de uma pessoa). O que não está aqui o Vix não lê.
 * A lista do que ficou de fora, e por quê, está em
 * `docs/arvisx/vix/CAPACIDADES-VIX-FASE-1.md`.
 */
import { z } from "zod";

import type { ModuloOpcional } from "@/lib/instalacao/modulos";
import type { McpContext } from "@/lib/mcp/types";
import { allTools } from "@/lib/mcp/tools";

import { capacidade, type Capacidade, type ContextoDoAssistente, type PapelHumano, type RotaDaTela } from "../tipos";

export const TESTE_DAS_LEITURAS = "tests/invariants/assistente-leituras-isolamento.test.ts";

/** O contexto MCP montado da SESSÃO. Sem token: `apiTokenId` vazio, e nenhuma leitura daqui o usa. */
export function contextoMcpDaSessao(ctx: ContextoDoAssistente): McpContext {
  return {
    organizationId: ctx.orgId,
    role: ctx.papel,
    actor: { type: "user", id: ctx.userId, role: ctx.papel },
    apiTokenId: "",
    requestId: ctx.requestId,
    supabase: ctx.db,
  };
}

interface LeituraMcp {
  ferramenta: string;
  papelMinimo: PapelHumano;
  rota: string;
  modulo?: ModuloOpcional;
}

function leituraMcp(l: LeituraMcp): Capacidade {
  const def = allTools.find((t) => t.name === l.ferramenta);
  if (!def) throw new Error(`assistente: ferramenta MCP "${l.ferramenta}" não existe`);
  if (def.category !== "read") {
    throw new Error(`assistente: "${l.ferramenta}" não é leitura e não pode entrar por aqui`);
  }
  const rotaDaTela: RotaDaTela = { caminho: l.rota, metodo: "GET" };
  return capacidade({
    nome: def.name,
    descricao: def.description,
    nivel: "ler",
    papelMinimo: l.papelMinimo,
    rotaDaTela,
    ...(l.modulo ? { modulo: l.modulo } : {}),
    entrada: z.object(def.inputSchema),
    temInverso: "nao_se_aplica",
    teste: TESTE_DAS_LEITURAS,
    origem: { tipo: "mcp", ferramenta: def.name },
    executar: (entrada, ctx) => def.handler(entrada as never, contextoMcpDaSessao(ctx)),
  });
}

/**
 * Onda 1. A coluna da direita é a rota da tela equivalente: é por ela que o
 * plano da empresa é perguntado (`lib/cobranca/rotas-do-plano.ts`).
 */
const ONDA_1: readonly LeituraMcp[] = [
  // Negócios e funil. A lista de negócios pede `agent` na tela; funis, `manager`.
  { ferramenta: "crm_list_leads", papelMinimo: "agent", rota: "/api/v1/leads" },
  { ferramenta: "crm_get_lead", papelMinimo: "agent", rota: "/api/v1/leads" },
  { ferramenta: "crm_list_at_risk_leads", papelMinimo: "agent", rota: "/api/v1/leads" },
  { ferramenta: "crm_list_lead_notes", papelMinimo: "agent", rota: "/api/v1/leads" },
  { ferramenta: "crm_list_pipelines", papelMinimo: "manager", rota: "/api/v1/pipelines" },
  { ferramenta: "crm_get_pipeline_forecast", papelMinimo: "manager", rota: "/api/v1/pipelines" },
  { ferramenta: "crm_list_stages", papelMinimo: "manager", rota: "/api/v1/pipelines" },
  // Contatos e conversas.
  { ferramenta: "crm_search_contacts", papelMinimo: "agent", rota: "/api/v1/contacts" },
  { ferramenta: "crm_get_contact", papelMinimo: "agent", rota: "/api/v1/contacts" },
  { ferramenta: "crm_list_conversations", papelMinimo: "agent", rota: "/api/v1/conversations" },
  { ferramenta: "crm_get_conversation", papelMinimo: "agent", rota: "/api/v1/conversations" },
  { ferramenta: "crm_get_conversation_history", papelMinimo: "agent", rota: "/api/v1/conversations" },
  { ferramenta: "crm_get_queue_status", papelMinimo: "agent", rota: "/api/v1/conversations" },
  // Tarefas e agenda.
  { ferramenta: "crm_list_tasks", papelMinimo: "agent", rota: "/api/v1/tasks" },
  { ferramenta: "crm_list_appointments", papelMinimo: "agent", rota: "/api/v1/agenda" },
  { ferramenta: "crm_list_event_types", papelMinimo: "agent", rota: "/api/v1/agenda" },
  // Casos em que a IA espera uma pessoa.
  { ferramenta: "crm_list_human_cases", papelMinimo: "agent", rota: "/api/v1/ai/cases" },
  { ferramenta: "crm_get_human_case", papelMinimo: "agent", rota: "/api/v1/ai/cases" },
  // Retornos e catálogo. `crm_get_proposal` NÃO entra: para saber se propostas
  // estão ligadas ela lê `platform_config`, que só a chave de serviço alcança;
  // com o cliente de sessão responde sempre "propostas desligadas".
  { ferramenta: "crm_list_followups", papelMinimo: "agent", rota: "/api/v1/ai/followups" },
  { ferramenta: "crm_search_products", papelMinimo: "agent", rota: "/api/v1/products" },
  // Organização.
  { ferramenta: "crm_list_tags", papelMinimo: "agent", rota: "/api/v1/tags" },
  { ferramenta: "crm_list_message_templates", papelMinimo: "agent", rota: "/api/v1/message-templates" },
  { ferramenta: "crm_list_team_members", papelMinimo: "agent", rota: "/api/v1/team" },
];

export const LEITURAS_MCP: readonly Capacidade[] = ONDA_1.map(leituraMcp);
