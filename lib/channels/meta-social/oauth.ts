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
 * As permissões pedidas no diálogo do login NORMAL — as de atendimento por
 * mensagem.
 *
 * `business_management` entra porque páginas de um Gerenciador de Negócios só
 * aparecem em `me/accounts` com ela; sem ela, quem administra a página pelo
 * Business Manager veria a lista vazia e acharia que não tem página.
 *
 * As duas de comentários (`ESCOPOS_DE_COMENTARIOS`) NÃO entram aqui, de
 * propósito (revisão de 20/11/2026, item 2.20). O login é em duas fases: se o
 * app ainda não tem uma permissão liberada, a Meta pode recusar o diálogo
 * INTEIRO ("Invalid Scopes"), e pedir as de comentários a todo mundo
 * derrubaria o login de quem só usa mensagens. Elas só são pedidas no login de
 * reautorização (`ESCOPOS_DA_REAUTORIZACAO_PARA_COMENTARIOS`).
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

/**
 * As de COMENTÁRIOS do Instagram — as que o webhook `comments`/`live_comments`
 * exige além das que a conexão já pedia (matriz de campos e permissões da
 * Meta, login do Facebook: `instagram_basic`, `instagram_manage_comments`,
 * `pages_manage_metadata`, `pages_read_engagement`, `pages_show_list`).
 *
 * OPCIONAIS, e é por isso que NÃO entram em `ESCOPOS_DO_INSTAGRAM` nem em
 * `ESCOPOS_DO_LOGIN`: aquelas listas decidem se a conexão acontece, e uma
 * permissão que a Meta ainda não liberou para o app (ou que a pessoa
 * desmarcou) não pode tirar as mensagens de quem só quer mensagens. Sem estas
 * duas, a conexão recebe e responde mensagem como sempre; só os comentários
 * ficam indisponíveis, e a conexão diz isso (`estadoDosComentarios`, em
 * `./store.ts`).
 */
export const ESCOPOS_DE_COMENTARIOS = ["instagram_manage_comments", "pages_read_engagement"] as const;

/**
 * O que o login de REAUTORIZAÇÃO para comentários pede: tudo do login normal
 * mais as duas de comentários. É um login próprio, que só começa quando
 * alguém pede (`urlDoLogin` com `paraComentarios`); o login normal nunca usa
 * esta lista.
 */
export const ESCOPOS_DA_REAUTORIZACAO_PARA_COMENTARIOS = [...ESCOPOS_DO_LOGIN, ...ESCOPOS_DE_COMENTARIOS] as const;

/** O caminho da volta — o MESMO que o dono cadastra no app da Meta. */
export const CAMINHO_DA_VOLTA = "/auth/meta-social-return";

export function urlDoLogin(entrada: {
  appId: string;
  redirectUri: string;
  estado: string;
  /** Login de reautorização: pede também as permissões de comentários. */
  paraComentarios?: boolean;
}): string {
  const url = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
  url.searchParams.set("client_id", entrada.appId);
  url.searchParams.set("redirect_uri", entrada.redirectUri);
  url.searchParams.set("state", entrada.estado);
  url.searchParams.set("response_type", "code");
  const escopos = entrada.paraComentarios === true ? ESCOPOS_DA_REAUTORIZACAO_PARA_COMENTARIOS : ESCOPOS_DO_LOGIN;
  url.searchParams.set("scope", escopos.join(","));
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

async function permissoesConcedidasNaMeta(token: string, appSecret: string): Promise<Set<string>> {
  const r = await chamarGraph<{ data?: { permission?: string; status?: string }[] }>(
    "me/permissions",
    { token, appSecret },
  );
  return new Set((r.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission ?? ""));
}

/**
 * As permissões que a pessoa NÃO concedeu, dentre as do login normal. As de
 * comentários não aparecem aqui: são opcionais e a falta delas nunca é recusa.
 */
export async function permissoesNegadas(token: string, appSecret: string): Promise<string[]> {
  const concedidas = await permissoesConcedidasNaMeta(token, appSecret);
  return ESCOPOS_DO_LOGIN.filter((e) => !concedidas.has(e));
}

/**
 * As permissões que a pessoa CONCEDEU, dentre as que o produto conhece (as do
 * login normal e as de comentários). É o que fica gravado na conexão, para ela
 * saber dizer — sem perguntar de novo à Meta — se tem as de comentários.
 *
 * A lista é a da reautorização mesmo num login normal: `me/permissions`
 * devolve TUDO o que a pessoa já concedeu ao app, então quem reautorizou para
 * comentários e depois reconectou pelo login normal continua com as duas
 * gravadas.
 */
export async function escoposConcedidos(token: string, appSecret: string): Promise<string[]> {
  const concedidas = await permissoesConcedidasNaMeta(token, appSecret);
  return ESCOPOS_DA_REAUTORIZACAO_PARA_COMENTARIOS.filter((e) => concedidas.has(e));
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

/**
 * Os campos de mensagens que a página entrega ao app (Messenger e Instagram).
 *
 * Comentários do Instagram NÃO entram aqui, e não é esquecimento: `comments` e
 * `live_comments` são campos do objeto `instagram`, escolhidos UMA vez no
 * painel do app (Webhooks › Instagram) e válidos para todas as contas. O
 * `subscribed_apps` da página só aceita campos de página; o que a Meta exige
 * dela é estar assinada, e estes campos já a assinam. O passo do painel está
 * em `docs/integracao/comentarios-do-instagram.md`.
 */
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
