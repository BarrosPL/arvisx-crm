/**
 * A DISTRIBUIÇÃO DAS TELAS NOS QUATRO PLANOS (ArvisX, tarefa 2 dos planos),
 * escrita À MÃO, de propósito: não deriva do código. Os planos reais são criados
 * pelo dono em /admin/cobranca (sem seed); estas listas são a referência do que
 * marcar lá (docs/arvisx/PLANOS.md) e a base dos testes
 * `planos-distribuicao-das-telas` (a cerca) e `planos-comparativo` (a tela).
 */
/** ESSENCIAL — atender e organizar (12). */
export const ESSENCIAL = [
  "/app/inbox", // Atendimento › Inbox
  "/app/agenda", // Atendimento › Agenda
  "/app/templates", // Atendimento › Respostas rápidas
  "/app/kanban", // CRM › Funis
  "/app/settings/tenant/pipelines", // CRM › Etapas do funil
  "/app/contacts", // CRM › Contatos
  "/app/tasks", // CRM › Tarefas
  "/app/connections", // Canais › Conexões
  "/app/settings/tenant/agenda", // Organização › Tipos de agendamento
  "/app/agenda/avisos", // Organização › Aviso de agendamento
  "/app/settings/tags", // Organização › Tags
  "/app/lgpd/requests", // Organização › LGPD (obrigação legal: nunca fica de fora)
] as const;

/** STANDARD — mais 19: automatizar com IA e organizar a operação (total 31). */
export const STANDARD_A_MAIS = [
  "/app/radar", // Atendimento › Radar
  "/app/companies", // CRM › Empresas
  "/app/people", // CRM › Pessoas
  "/app/tasks/planos", // CRM › Planos de tarefa
  "/app/imports", // CRM › Importações
  "/app/ai/agents", // Agente de IA › Agentes
  "/app/ai/followups", // Agente de IA › Follow-ups
  "/app/ai/atendimento", // Agente de IA › Fluxos de atendimento
  "/app/ai/knowledge/sources", // Agente de IA › Conhecimento
  "/app/ai/credentials", // Agente de IA › Credenciais
  "/app/ai/providers", // Agente de IA › Provedores
  "/app/ai/cases", // Agente de IA › Casos
  "/app/ai/inbox", // Agente de IA › Alertas
  "/app/ai/cases/avisos", // Agente de IA › Aviso no WhatsApp
  "/app/ai/usage", // Agente de IA › Uso e orçamento
  "/app/activities", // Análise › Atividades
  "/app/settings/atendimento", // Organização › Distribuição de atendimento
  "/app/settings/recursos", // Organização › Recursos opcionais
  "/app/settings/automacoes", // Organização › Automações
] as const;

/** PREMIUM — mais 32: vender, prospectar, medir, integrar e IA avançada (total 63). */
export const PREMIUM_A_MAIS = [
  // Vender
  "/app/proposals", // CRM › Propostas
  "/app/products", // CRM › Produtos
  "/app/comandas", // CRM › Comandas
  "/app/campaigns", // CRM › Campanhas
  "/app/settings/tenant/proposals", // Organização › Propostas (configuração)
  "/app/settings/tenant/proposals/modelos", // Organização › Modelos de proposta
  "/app/settings/tenant/financeiro", // Organização › Financeiro
  "/app/settings/metas", // Organização › Meta de vendas
  // Prospectar
  "/app/prospecting", // CRM › Prospecção
  "/app/cold-call", // CRM › Cold Call
  "/app/calls", // CRM › Chamadas
  "/app/settings/voip-trunk", // Organização › Trunk SIP
  // IA avançada
  "/app/ai/routers", // Agente de IA › Roteadores
  "/app/ai/memory", // Agente de IA › Memória
  "/app/ai/skills", // Agente de IA › Skills
  "/app/ai/proposals", // Agente de IA › Propostas (da IA)
  "/app/ai/runs", // Agente de IA › Execuções
  // Medir e gerir
  "/app/metrics", // Análise › Desempenho
  "/app/faturamento", // Análise › Faturamento
  "/app/honorarios", // Análise › Honorários
  "/app/ads/meta", // Análise › Meta Ads
  "/app/ai/evolution", // Análise › Evolução da IA
  "/app/audit", // Análise › Audit Log
  "/app/settings/conversoes", // Organização › Conversões
  "/app/settings/meta-ads", // Organização › Meta Ads (configuração)
  // Integrar e controlar
  "/app/webhooks", // Canais › Webhooks
  "/app/integrations/nuvemshop", // Canais › Nuvemshop
  "/app/settings/api-tokens", // Organização › API Tokens
  "/app/settings/servidor-mcp-externo", // Organização › Servidor MCP externo
  "/app/extensions", // Organização › Extensões
  "/app/integracao-dados", // Organização › Dados externos
  "/app/settings/marca", // Organização › Marca
] as const;

export const DEGRAUS = { ESSENCIAL, STANDARD_A_MAIS, PREMIUM_A_MAIS } as const;

/** As telas de cada plano, como o dono as marca no seletor (`destinos`). */
export const PLANOS = {
  Essencial: [...ESSENCIAL],
  Standard: [...ESSENCIAL, ...STANDARD_A_MAIS],
  Premium: [...ESSENCIAL, ...STANDARD_A_MAIS, ...PREMIUM_A_MAIS],
  "Equipe Completa": [...ESSENCIAL, ...STANDARD_A_MAIS, ...PREMIUM_A_MAIS],
} as const;
export type NomeDoPlano = keyof typeof PLANOS;
