/**
 * O QUE O VIX NUNCA FAZ. Só pela tela, com recusa em código.
 *
 * Dado puro, lido por três lugares: o executor (recusa o nome antes de qualquer
 * coisa), a cerca do catálogo (nenhuma capacidade pode apontar para cá) e o
 * prompt (para o Vix saber explicar e levar à tela certa).
 */

/**
 * Prefixos de rota que nenhuma capacidade pode ter como `rotaDaTela` de
 * ESCRITA. Ler chaves e senhas, excluir empresa, exportar ou anonimizar (LGPD),
 * cobrança da plataforma, convidar ou mudar papel de equipe, credenciais de IA,
 * instalar módulo, tronco de voz, canais oficiais, painel da plataforma e
 * provisionamento.
 */
export const PREFIXOS_PROIBIDOS = [
  "/api/v1/admin",
  "/api/v1/tenants",
  "/api/v1/cobranca",
  "/api/v1/lgpd",
  "/api/v1/modulos",
  "/api/v1/voip",
  "/api/v1/channels/official",
  "/api/v1/ai/credentials",
  "/api/v1/team",
  "/api/v1/settings/security",
  "/api/v1/mcp",
] as const;

/**
 * Desses prefixos, os que admitem LEITURA declarada no catálogo (método GET),
 * e só ela: saber se há credencial válida (sem o segredo) e listar a equipe
 * (sem convidar nem mudar papel).
 */
export const PREFIXOS_SO_LEITURA = ["/api/v1/ai/credentials", "/api/v1/team"] as const;

/** A rota cai num prefixo proibido para o método dado? */
export function rotaProibida(caminho: string, metodo: string): boolean {
  const casa = (p: string) => caminho === p || caminho.startsWith(`${p}/`);
  const proibido = PREFIXOS_PROIBIDOS.find(casa);
  if (!proibido) return false;
  if (metodo === "GET" && (PREFIXOS_SO_LEITURA as readonly string[]).includes(proibido)) return false;
  return true;
}

/**
 * Ferramentas do MCP que NUNCA entram no catálogo do Vix, nem como leitura:
 * as do turno de atendimento (falam com o cliente final ou mudam quem atende)
 * e a lista de pedidos de LGPD.
 */
export const FERRAMENTAS_MCP_FORA_DO_VIX = [
  "crm_request_human_handoff",
  "crm_resume_ai_attendance",
  "crm_propose_contact_field",
  "crm_propose_lead_fields_from_document",
  "crm_send_whatsapp_message",
  "crm_start_conversation_and_send",
  "crm_send_proposal",
  "crm_reply_comment",
  "crm_private_reply_comment",
  "crm_list_privacy_requests",
] as const;

/** Nomes de campo que nenhum schema de entrada pode ter: a empresa vem da sessão. */
export const CAMPOS_QUE_NOMEIAM_EMPRESA = [
  "organization_id",
  "organizationid",
  "org_id",
  "orgid",
  "organizacao",
  "organizacao_id",
  "empresa_id",
  "tenant",
  "tenant_id",
] as const;

/** O campo nomeia a empresa? (comparação sem caixa) */
export function campoNomeiaEmpresa(nome: string): boolean {
  return (CAMPOS_QUE_NOMEIAM_EMPRESA as readonly string[]).includes(nome.toLowerCase());
}

/**
 * Pedidos que o Vix reconhece e para os quais só explica e aponta a tela.
 * `tela` é o destino no catálogo de navegação.
 */
export const SO_PELA_TELA: readonly { assunto: string; tela: string }[] = [
  { assunto: "chave de IA, senha, token ou código de login", tela: "/app/ai/credentials" },
  { assunto: "convidar pessoa ou mudar o papel de alguém da equipe", tela: "/app/team" },
  { assunto: "exportar ou anonimizar dados de um contato (LGPD)", tela: "/app/lgpd/requests" },
  { assunto: "plano, cobrança e assinatura", tela: "/app/settings/billing" },
  { assunto: "conectar ou trocar canal oficial", tela: "/app/connections" },
];
