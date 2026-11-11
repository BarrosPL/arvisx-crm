/**
 * QUAL TELA DO CATÁLOGO cada página de `/app` e cada rota de `/api/v1` serve
 * (ArvisX, telas do plano — migration 9802). Puro: roda no `proxy.ts`, nas
 * rotas e nos testes, sem banco.
 *
 * Duas cercas reprovam o build quando algo nasce sem classificação:
 *  - toda `page.tsx` de `app/app/**` cai no catálogo (prefixo mais longo), num
 *    hub, em `PAGINAS_COM_DESTINO` ou em `PAGINAS_LIVRES`
 *    (tests/unit/telas-do-plano-cerca-de-paginas.test.ts);
 *  - todo prefixo de `app/api/v1/*` (e de segundo nível nos prefixos de
 *    `PREFIXOS_POR_SUB_ROTA`) está em `ROTAS_DE_API`
 *    (tests/unit/telas-do-plano-cerca-de-api.test.ts).
 *
 * "Livre" quer dizer "o plano não decide" — nunca "sem autenticação": papel,
 * RLS, MFA e suspensão continuam valendo.
 */
import { NAV_CATALOG, NAV_GROUPS, type NavDestinationId, type NavGroupId } from "@/lib/navigation/catalogo";

export const LIVRE = "livre" as const;

/**
 * Rota que não cabe em "uma tela só" (auditoria de 11/11/2026). A tela DONA vai
 * no código do 403; o resto diz quem mais pode usar, e só o que foi medido:
 *  - `tambem`: outra tela que usa a rota inteira (qualquer método);
 *  - `leituras`: um GET de caminho EXATO que outra tela precisa ler. `LIVRE` =
 *    o plano não decide essa leitura; lista = basta o plano ter UMA das telas.
 * Criar, editar e apagar nunca entram em `leituras`.
 */
export type RegraDeRota = {
  destino: NavDestinationId;
  tambem?: readonly NavDestinationId[];
  leituras?: Readonly<Record<string, typeof LIVRE | readonly NavDestinationId[]>>;
};
type Classe = NavDestinationId | typeof LIVRE | RegraDeRota;

// ─────────────────────────────── PÁGINAS ───────────────────────────────────

/**
 * Páginas fora do catálogo que o plano NÃO decide, com o porquê.
 */
export const PAGINAS_LIVRES: Readonly<Record<string, string>> = {
  "/app": "início: só redireciona para a primeira tela que a pessoa vê",
  "/app/fora-do-plano": "a própria tela de 'isso não está no seu plano'",
  "/app/settings/atualizacao": "do dono do servidor (platform admin), não da empresa; tem gate próprio",
  "/app/settings/canal-oficial": "rota antiga: só redireciona para Conexões, que o plano decide",
  "/app/settings/templates": "rota antiga: só redireciona para Conexões, que o plano decide",
};

/**
 * Páginas fora do catálogo que pertencem a uma tela dele (as filhas de um
 * prefixo do catálogo já herdam sozinhas; aqui só o que mora em outro caminho).
 */
export const PAGINAS_COM_DESTINO: Readonly<Record<string, NavDestinationId>> = {
  // A URL estável de um lead abre o dossiê do quadro (Funis).
  "/app/leads": "/app/kanban",
  // O quadro de um funil é o quadro (Funis).
  "/app/pipelines": "/app/kanban",
};

export type ClasseDaPagina =
  | { tipo: "livre" }
  | { tipo: "destino"; destino: NavDestinationId }
  | { tipo: "grupo"; grupo: NavGroupId }
  | { tipo: "desconhecida" };

function semBarraNoFim(caminho: string): string {
  return caminho.length > 1 && caminho.endsWith("/") ? caminho.slice(0, -1) : caminho;
}

function prefixoMaisLongo<T extends string>(caminho: string, prefixos: readonly T[]): T | null {
  let melhor: T | null = null;
  for (const p of prefixos) {
    if ((caminho === p || caminho.startsWith(`${p}/`)) && (!melhor || p.length > melhor.length)) melhor = p;
  }
  return melhor;
}

const HREFS = NAV_CATALOG.map((d) => d.href) as readonly NavDestinationId[];

/**
 * A tela do catálogo que este caminho de página serve. Filhas (`/app/ai/agents/[id]`)
 * herdam do prefixo mais longo. O hub de um grupo (`/app/ai`) vale pelo grupo.
 */
export function classeDaPagina(caminhoBruto: string): ClasseDaPagina {
  const caminho = semBarraNoFim(caminhoBruto.split("?")[0] ?? caminhoBruto);
  if (caminho in PAGINAS_LIVRES) return { tipo: "livre" };
  const hub = NAV_GROUPS.find((g) => g.hub?.href === caminho);
  if (hub) return { tipo: "grupo", grupo: hub.id };
  const doCatalogo = prefixoMaisLongo(caminho, HREFS);
  if (doCatalogo) return { tipo: "destino", destino: doCatalogo };
  const alias = prefixoMaisLongo(caminho, Object.keys(PAGINAS_COM_DESTINO));
  if (alias) return { tipo: "destino", destino: PAGINAS_COM_DESTINO[alias]! };
  return { tipo: "desconhecida" };
}

/**
 * A página está liberada para a lista de telas do plano? `null` = isenta.
 * Página desconhecida passa: a cerca reprova no build, e em produção recusar o
 * que não se sabe classificar seria um 404 mudo.
 */
export function paginaLiberada(caminho: string, telasDoPlano: readonly string[] | null): boolean {
  if (telasDoPlano === null) return true;
  const c = classeDaPagina(caminho);
  if (c.tipo === "livre" || c.tipo === "desconhecida") return true;
  if (c.tipo === "destino") return telasDoPlano.includes(c.destino);
  return NAV_CATALOG.some((d) => d.group === c.grupo && telasDoPlano.includes(d.href));
}

/** O destino que a página fora do plano pediu (para o texto da tela), ou `null`. */
export function destinoDaPagina(caminho: string): NavDestinationId | null {
  const c = classeDaPagina(caminho);
  return c.tipo === "destino" ? c.destino : null;
}

// ──────────────────────────────── API ──────────────────────────────────────

/**
 * Prefixos cujo SEGUNDO nível é classificado um a um (a cerca cobra cada
 * subdiretório): misturam rota do Inbox com rota de tela de configuração.
 */
export const PREFIXOS_POR_SUB_ROTA = ["ai", "settings", "reports", "financeiro"] as const;

/**
 * Cada prefixo de `app/api/v1`. Regra de corte: LIVRE tudo que o Inbox, a casca
 * (layout, menu, faixas) ou o Atendimento usam, o que entra de fora (webhooks,
 * cron, callbacks, landings) e o que é da conta/empresa; LIGADO à tela só o que
 * serve exclusivamente a ela.
 */
export const ROTAS_DE_API: Readonly<Record<string, Classe>> = {
  "/api/v1/admin": LIVRE, // painel da plataforma; gate próprio (platform admin)
  "/api/v1/ads": "/app/ads/meta",
  "/api/v1/agenda": LIVRE, // Atendimento (Agenda) e componentes dentro do Inbox
  "/api/v1/ai": LIVRE, // classificado por sub-rota abaixo
  "/api/v1/ai/agents": {
    destino: "/app/ai/agents",
    leituras: {
      // Funis (atribuir a conversa a um agente) e Conexões › Telefonia: só nome e canal.
      "/api/v1/ai/agents/assignable": LIVRE,
      // A lista de agentes, lida por Campanhas (destino da campanha) e Webhooks (ação da automação).
      "/api/v1/ai/agents": ["/app/campaigns", "/app/webhooks"],
    },
  },
  "/api/v1/ai/automatico-ativo": LIVRE, // Inbox
  "/api/v1/ai/budget": "/app/ai/usage",
  "/api/v1/ai/cases": LIVRE, // contador da casca (todas as telas)
  "/api/v1/ai/credentials": {
    destino: "/app/ai/credentials",
    // O editor do agente escolhe a credencial; Conhecimento e Provedores mostram qual está em uso.
    leituras: { "/api/v1/ai/credentials": ["/app/ai/agents", "/app/ai/knowledge/sources", "/app/ai/providers"] },
  },
  "/api/v1/ai/evolution": "/app/ai/evolution",
  "/api/v1/ai/followup-flows": LIVRE, // Inbox (inscrever contato num fluxo)
  "/api/v1/ai/followups": LIVRE, // Inbox (fila de follow-up do contato)
  "/api/v1/ai/guardrail-layers": "/app/ai/agents",
  "/api/v1/ai/inbox": LIVRE, // contador da casca (todas as telas)
  "/api/v1/ai/jev": "/app/ai/providers",
  "/api/v1/ai/knowledge": LIVRE, // Inbox (conhecimento a partir da conversa)
  "/api/v1/ai/mapas": "/app/ai/providers",
  "/api/v1/ai/memory": "/app/ai/memory",
  "/api/v1/ai/operator-metrics": "/app/ai/agents",
  "/api/v1/ai/pacing": LIVRE, // Conexões (ritmo de envio do canal)
  "/api/v1/ai/providers": "/app/ai/providers",
  "/api/v1/ai/replies": LIVRE, // Inbox (sugestão de resposta)
  "/api/v1/ai/routers": "/app/ai/routers",
  "/api/v1/ai/routing-results": "/app/ai/routers",
  "/api/v1/ai/runs": "/app/ai/runs",
  "/api/v1/ai/skills": "/app/ai/skills",
  "/api/v1/ai/style-adjustments": "/app/ai/agents",
  "/api/v1/ai/turn-traces": "/app/ai/runs",
  "/api/v1/ai/usage": "/app/ai/usage",
  "/api/v1/ai/voz": { destino: "/app/ai/agents", tambem: ["/app/ai/providers"] }, // a voz do agente é escolhida em Provedores; o motor lê do banco, não desta rota
  "/api/v1/anuncios": LIVRE, // landing de clique (entrada externa, D-11)
  "/api/v1/attendants": LIVRE, // presença: casca
  "/api/v1/audit": "/app/audit",
  "/api/v1/auth": LIVRE,
  "/api/v1/automation-rules": "/app/webhooks",
  "/api/v1/avisos": LIVRE, // sem consumidor na tela; recado da equipe
  "/api/v1/calls": "/app/calls", // o alerta de chamada recebida da casca é Realtime (voice_calls), não passa por aqui
  "/api/v1/campaign-suppressions": "/app/campaigns",
  "/api/v1/campaign-templates": "/app/campaigns",
  "/api/v1/campaigns": "/app/campaigns",
  "/api/v1/channel-schedules": LIVRE, // Conexões
  "/api/v1/channel-sessions": LIVRE, // Conexões, casca (canal caído), Inbox
  "/api/v1/channels": LIVRE, // Conexões e templates do Inbox
  "/api/v1/cobranca": LIVRE, // assinatura: a porta de volta
  "/api/v1/cold-call": "/app/cold-call",
  "/api/v1/companies": "/app/companies",
  "/api/v1/company-people": "/app/companies",
  "/api/v1/contact-tags": LIVRE, // Inbox
  "/api/v1/contacts": LIVRE, // Inbox e Contatos
  "/api/v1/conversation-tags": LIVRE, // Inbox
  "/api/v1/conversations": LIVRE, // Inbox (núcleo)
  "/api/v1/conversions": "/app/settings/conversoes",
  "/api/v1/cron": LIVRE, // agendador; os crons respeitam o plano por dentro
  "/api/v1/demandas": LIVRE, // Inbox
  "/api/v1/extensions": "/app/extensions",
  "/api/v1/external-db": "/app/integracao-dados",
  "/api/v1/financeiro": "/app/settings/tenant/financeiro", // classificado por sub-rota abaixo; o que nascer sem linha cai aqui, fechado
  "/api/v1/financeiro/catalogo": {
    destino: "/app/settings/tenant/financeiro",
    // Formas de pagamento e contas: Comandas, Faturamento e Honorários leem para preencher; só a configuração grava.
    leituras: {
      "/api/v1/financeiro/catalogo/formas": ["/app/comandas", "/app/faturamento", "/app/honorarios"],
      "/api/v1/financeiro/catalogo/contas": ["/app/comandas", "/app/faturamento", "/app/honorarios"],
    },
  },
  "/api/v1/financeiro/comandas": "/app/comandas",
  "/api/v1/financeiro/fidelidade": "/app/comandas",
  "/api/v1/financeiro/lancamentos": "/app/faturamento",
  "/api/v1/health": LIVRE,
  "/api/v1/honorarios": "/app/honorarios",
  "/api/v1/imports": "/app/imports",
  "/api/v1/integrations": "/app/integrations/nuvemshop",
  "/api/v1/lead-captures": "/app/webhooks",
  "/api/v1/leads": LIVRE, // Funis, Inbox e Radar
  "/api/v1/lgpd": LIVRE, // direito do titular: nunca bloqueado
  "/api/v1/marca": LIVRE,
  // Só existe `mcp/tools` (GET): o catálogo de ferramentas. A integração de fora é
  // API Tokens (Premium); o editor do agente (Standard) precisa ler a lista para marcar.
  "/api/v1/mcp": { destino: "/app/settings/api-tokens", leituras: { "/api/v1/mcp/tools": ["/app/ai/agents"] } },
  "/api/v1/mcp-oauth": LIVRE, // callback
  "/api/v1/message-template-groups": LIVRE, // Inbox e Respostas rápidas
  "/api/v1/message-templates": LIVRE, // Inbox e Respostas rápidas
  "/api/v1/messages": LIVRE, // Inbox (núcleo)
  "/api/v1/metrics": "/app/metrics",
  "/api/v1/modulos": LIVRE, // instalação de módulo (gate próprio)
  "/api/v1/notifications": LIVRE, // preferência pessoal
  "/api/v1/onboarding": LIVRE,
  "/api/v1/people": "/app/people",
  "/api/v1/phone-numbers": LIVRE, // Conexões
  "/api/v1/pipelines": LIVRE, // Funis e Inbox
  "/api/v1/plataformas-de-anuncio": "/app/settings/conversoes",
  "/api/v1/products": "/app/products",
  "/api/v1/proposals": {
    destino: "/app/proposals",
    // O dossiê do lead (Funis) lê a lista. A PRÓPRIA rota devolve vazio, sem
    // erro, para a empresa sem Propostas (`telaForaDoPlano` em app/api/v1/proposals/route.ts).
    leituras: { "/api/v1/proposals": LIVRE },
  },
  "/api/v1/prospecting": "/app/prospecting",
  "/api/v1/rastreio": LIVRE, // link rastreável: o clique vem de fora (D-11)
  "/api/v1/reports": LIVRE, // classificado por sub-rota abaixo
  "/api/v1/reports/activities": "/app/activities",
  "/api/v1/reports/financeiro": "/app/faturamento",
  "/api/v1/reports/tags": "/app/activities",
  "/api/v1/settings": LIVRE, // classificado por sub-rota abaixo
  "/api/v1/settings/agenda-apresentacao": LIVRE, // Agenda (Atendimento)
  "/api/v1/settings/api-tokens": "/app/settings/api-tokens",
  "/api/v1/settings/art15": LIVRE, // dados da empresa
  "/api/v1/settings/assinatura": LIVRE, // assinatura das mensagens do Inbox
  "/api/v1/settings/campanhas": "/app/campaigns",
  "/api/v1/settings/proposal-templates": { destino: "/app/proposals", tambem: ["/app/settings/tenant/proposals/modelos"] },
  "/api/v1/settings/proposals": { destino: "/app/proposals", tambem: ["/app/settings/tenant/proposals"] },
  "/api/v1/settings/prospeccao": "/app/prospecting",
  "/api/v1/settings/routing": {
    destino: "/app/settings/atendimento",
    // Equipe e Conexões MOSTRAM a distribuição em vigor; mudar é da tela Distribuição de atendimento.
    leituras: { "/api/v1/settings/routing": LIVRE, "/api/v1/settings/routing/channels": LIVRE },
  },
  "/api/v1/settings/sons": LIVRE, // casca
  "/api/v1/settings/task-plans": "/app/tasks/planos",
  "/api/v1/system": LIVRE, // versão/relógio: casca
  "/api/v1/tags": LIVRE, // casca e Inbox
  "/api/v1/tasks": LIVRE, // casca e Inbox
  "/api/v1/team": LIVRE, // Equipe (essencial) e Inbox
  "/api/v1/tenants": LIVRE, // provisionamento
  "/api/v1/voice": LIVRE, // chamada de voz: casca e Inbox
  "/api/v1/voip": "/app/settings/voip-trunk",
  "/api/v1/webhook-sources": "/app/webhooks", // a gestão das fontes; só a tela Webhooks consome
  "/api/v1/webhooks": LIVRE, // só ENTRADA (WhatsApp, Meta, cobrança, Nuvemshop): nunca para por plano nem por suspensão. Nenhuma rota de gestão mora aqui (cerca em telas-do-plano-cercas)
};

const PREFIXOS_DE_API = Object.keys(ROTAS_DE_API);

/** A tela dona e as que também abrem esta chamada. */
export type DecisaoDaRota = { destino: NavDestinationId; aceitos: readonly NavDestinationId[] };

/**
 * Quem pode chamar esta rota, ou `null` quando o plano não decide.
 * Sem método conhecido a chamada vale como ESCRITA: as leituras abertas só
 * abrem para GET/HEAD declarado.
 */
export function regraDaRotaDeApi(caminhoBruto: string | null | undefined, metodo?: string | null): DecisaoDaRota | null {
  if (!caminhoBruto) return null;
  const caminho = semBarraNoFim(caminhoBruto.split("?")[0] ?? caminhoBruto);
  if (!caminho.startsWith("/api/v1/")) return null;
  const prefixo = prefixoMaisLongo(caminho, PREFIXOS_DE_API);
  if (!prefixo) return null;
  const classe = ROTAS_DE_API[prefixo]!;
  if (classe === LIVRE) return null;
  if (typeof classe === "string") return { destino: classe, aceitos: [classe] };
  const aceitos = [classe.destino, ...(classe.tambem ?? [])];
  const leitura = ["GET", "HEAD"].includes((metodo ?? "").toUpperCase()) ? classe.leituras?.[caminho] : undefined;
  if (leitura === LIVRE) return null;
  return { destino: classe.destino, aceitos: leitura ? [...aceitos, ...leitura] : aceitos };
}

/** A tela que esta rota de API serve, ou `null` quando o plano não decide. */
export function destinoDaRotaDeApi(caminhoBruto: string | null | undefined, metodo?: string | null): NavDestinationId | null {
  return regraDaRotaDeApi(caminhoBruto, metodo)?.destino ?? null;
}
