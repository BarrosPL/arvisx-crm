/**
 * O login do Facebook para a conexão direta — ida, troca do código e páginas.
 *
 * ─── O caminho ──────────────────────────────────────────────────────────────
 *
 *   1. a tela pede a URL do diálogo (`urlDoLogin`), com o `state` assinado
 *      (organização + pessoa, `../estado-da-volta.ts`);
 *   2. a Meta devolve o navegador a `/auth/meta-social-return` com `code` e
 *      `state` — rota pública e SEM efeito, que só repassa à tela autenticada
 *      (o cookie de sessão é Strict e não viaja na volta de outro site);
 *   3. a tela entrega `code` + `state` à rota autenticada, que confere o estado
 *      contra a SESSÃO (a organização nunca vem do corpo), troca o código por um
 *      token de usuário, troca esse por um de LONGA duração e lista as páginas;
 *   4. a pessoa escolhe a página — e o token de usuário volta lacrado
 *      (`./selecao.ts`), nunca legível no navegador.
 *
 * O token de PÁGINA obtido de um token de usuário de longa duração não expira
 * (documentação da Meta, "Long-Lived Page Access Token"): é o que fica gravado,
 * cifrado, na sessão. O de usuário não é guardado.
 */
import { graphVersion } from "@/lib/graph-version";

import { chamarGraph } from "./graph";

/**
 * As permissões pedidas no diálogo — e as que vão para o App Review.
 *
 * `business_management` entra porque páginas de um Gerenciador de Negócios só
 * aparecem em `me/accounts` com ela; sem ela, quem administra a página pelo
 * Business Manager veria a lista vazia e acharia que não tem página.
 */
export const ESCOPOS_DO_LOGIN = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
  "instagram_basic",
  "instagram_manage_messages",
  "business_management",
] as const;

/** Sem estas não há atendimento nenhum: recusar no fim, não depois de gravar. */
export const ESCOPOS_OBRIGATORIOS = ["pages_show_list", "pages_messaging", "pages_manage_metadata"] as const;

/** As do Instagram: sem elas a página conecta, mas o Instagram não. */
export const ESCOPOS_DO_INSTAGRAM = ["instagram_basic", "instagram_manage_messages"] as const;

/** O caminho da volta — o MESMO que o dono cadastra no app da Meta. */
export const CAMINHO_DA_VOLTA = "/auth/meta-social-return";

export function urlDoLogin(entrada: { appId: string; redirectUri: string; estado: string }): string {
  const url = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
  url.searchParams.set("client_id", entrada.appId);
  url.searchParams.set("redirect_uri", entrada.redirectUri);
  url.searchParams.set("state", entrada.estado);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", ESCOPOS_DO_LOGIN.join(","));
  // Quem negou uma permissão na primeira vez é perguntado de novo: sem isto o
  // diálogo pula o que foi negado e a reconexão nunca conserta nada.
  url.searchParams.set("auth_type", "rerequest");
  return url.toString();
}

interface RespostaDoToken {
  access_token?: string;
  expires_in?: number;
}

/** `code` → token de usuário de LONGA duração (duas trocas). */
export async function tokenDeUsuarioDeLongaDuracao(entrada: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
}): Promise<string> {
  const curto = await chamarGraph<RespostaDoToken>("oauth/access_token", {
    formulario: {
      client_id: entrada.appId,
      client_secret: entrada.appSecret,
      redirect_uri: entrada.redirectUri,
      code: entrada.code,
    },
  });
  if (!curto.access_token) throw new Error("a Meta não devolveu o token de acesso");
  const longo = await chamarGraph<RespostaDoToken>("oauth/access_token", {
    formulario: {
      grant_type: "fb_exchange_token",
      client_id: entrada.appId,
      client_secret: entrada.appSecret,
      fb_exchange_token: curto.access_token,
    },
  });
  return longo.access_token ?? curto.access_token;
}

/** As permissões que a pessoa NÃO concedeu, dentre as pedidas. */
export async function permissoesNegadas(token: string, appSecret: string): Promise<string[]> {
  const r = await chamarGraph<{ data?: { permission?: string; status?: string }[] }>(
    "me/permissions",
    { token, appSecret },
  );
  const concedidas = new Set(
    (r.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission ?? ""),
  );
  return ESCOPOS_DO_LOGIN.filter((e) => !concedidas.has(e));
}

/** O id da pessoa no app (app-scoped). É o que o pedido de exclusão da Meta traz. */
export async function idDoUsuarioNoApp(token: string, appSecret: string): Promise<string | null> {
  const r = await chamarGraph<{ id?: string }>("me", { token, appSecret, query: { fields: "id" } });
  return typeof r.id === "string" && /^[0-9]+$/.test(r.id) ? r.id : null;
}

export interface ContaDoInstagram {
  id: string;
  username: string | null;
}

export interface PaginaAutorizada {
  id: string;
  nome: string;
  /** Token da PÁGINA — fica no servidor. */
  token: string;
  instagram: ContaDoInstagram | null;
  /** A pessoa pode mandar mensagem como esta página? (`tasks` contém MESSAGING) */
  podeMensagens: boolean;
}

interface PaginaDaGraph {
  id?: string;
  name?: string;
  access_token?: string;
  tasks?: string[];
  instagram_business_account?: { id?: string; username?: string };
}

/** Lê `me/accounts` e normaliza. Página sem token não entra: não há como agir por ela. */
export function normalizarPaginas(dados: PaginaDaGraph[]): PaginaAutorizada[] {
  const paginas: PaginaAutorizada[] = [];
  for (const p of dados) {
    if (!p.id || !/^[0-9]+$/.test(p.id) || !p.access_token) continue;
    const ig = p.instagram_business_account;
    paginas.push({
      id: p.id,
      nome: (p.name ?? p.id).slice(0, 200),
      token: p.access_token,
      instagram:
        ig?.id && /^[0-9]+$/.test(ig.id) ? { id: ig.id, username: ig.username ?? null } : null,
      // Sem `tasks` (página pessoal antiga, ou o campo não veio) não recusamos:
      // quem decide é a assinatura do app, que falha com a frase certa.
      podeMensagens: !p.tasks || p.tasks.includes("MESSAGING") || p.tasks.includes("MANAGE"),
    });
  }
  return paginas;
}

export async function paginasDoUsuario(token: string, appSecret: string): Promise<PaginaAutorizada[]> {
  const r = await chamarGraph<{ data?: PaginaDaGraph[] }>("me/accounts", {
    token,
    appSecret,
    query: {
      fields: "id,name,access_token,tasks,instagram_business_account{id,username}",
      limit: "100",
    },
  });
  return normalizarPaginas(r.data ?? []);
}

/** Os campos de mensagens que a página entrega ao app (Messenger e Instagram). */
export const CAMPOS_DA_ASSINATURA = [
  "messages",
  "message_echoes",
  "message_deliveries",
  "message_reads",
  "messaging_postbacks",
] as const;

/**
 * Assina o app NA PÁGINA. É esta assinatura que faz a Meta entregar ao webhook
 * da instalação as mensagens da página — e as do Instagram ligado a ela: na
 * Messenger Platform, o Instagram profissional entrega pelo app assinado na
 * página vinculada, com o objeto `instagram` habilitado no painel do app.
 */
export async function assinarAppNaPagina(pageId: string, pageToken: string, appSecret: string): Promise<void> {
  const r = await chamarGraph<{ success?: boolean }>(`${pageId}/subscribed_apps`, {
    token: pageToken,
    appSecret,
    formulario: { subscribed_fields: CAMPOS_DA_ASSINATURA.join(",") },
  });
  if (r.success !== true) throw new Error("a Meta não confirmou a assinatura da página");
}

/** Tira o app da página. 404/erro de token aqui é "já saiu" — quem chama trata. */
export async function desassinarAppDaPagina(pageId: string, pageToken: string, appSecret: string): Promise<void> {
  await chamarGraph(`${pageId}/subscribed_apps`, { token: pageToken, appSecret, metodo: "DELETE" });
}
