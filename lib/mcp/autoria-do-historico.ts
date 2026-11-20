/**
 * QUEM ESCREVEU cada mensagem do histórico que o agente lê.
 *
 * `direction` só separa o que entrou do que saiu. Para um agente que divide a
 * conversa com a equipe isso não basta: o que saiu pode ter sido escrito por
 * uma pessoa, por um agente de IA, por uma regra de automação ou por uma
 * integração — e ele precisa separar o que a equipe disse ao cliente do que a
 * IA disse.
 *
 * A fonte é a própria linha de `messages`, lida do MESMO jeito que o balão da
 * caixa de entrada (`components/inbox/MessageBubble.tsx`): `sent_via`,
 * `sent_by_user_id`, `sent_on_behalf_of_user_id` e os nomes que o servidor
 * grava em `metadata` depois da entrada do cliente (`ai_actor_name`,
 * `sent_on_behalf`, `sent_by_token`). Esta leitura não grava nada.
 *
 * ─── As origens ────────────────────────────────────────────────────────────
 *
 *  - `cliente`: mensagem recebida. Em grupo, `name` é o participante que falou.
 *  - `ia`: escrita por um agente de IA DO CRM. `name` é o nome gravado na linha
 *    (ou o do cadastro); `id` só sai quando o id gravado é de um agente desta
 *    organização.
 *  - `agente`: enviada por um sistema de fora, por token de API (o agente
 *    externo). `id` é o id do token e `name` o nome que o administrador deu a
 *    ele. `is_self` diz se o token é o MESMO de quem está lendo: é assim que o
 *    agente externo separa a própria fala da de outra integração.
 *  - `equipe`: escrita por uma pessoa. `name` é só o nome (nunca e-mail nem
 *    telefone). `detail: "celular"` = saiu do aparelho ligado ao número, fora do
 *    CRM, e a linha não diz quem digitou. `detail: "em_nome_de"` = um sistema
 *    enviou por decisão daquela pessoa (`via_token` diz qual).
 *  - `sistema`: ninguém escreveu na hora. `detail: "automacao"` = texto fixo de
 *    regra, follow-up ou lembrete; `detail: "integracao"` = enviada por token de
 *    API numa linha que não guarda qual (ver abaixo).
 *
 * ─── De onde vem o token ───────────────────────────────────────────────────
 *
 * O envio grava `metadata.sent_by_token = { token_id, token_name }` a partir do
 * token AUTENTICADO (`app/api/v1/messages/_handler.ts`), e tira a mesma chave
 * do que o chamador mandou: ninguém a forja pelo corpo da requisição. Só o id
 * e o nome; o valor do token não existe no banco. O nome devolvido é o do
 * cadastro de hoje (token renomeado sai com o nome novo) e, sem ele (token
 * apagado), o que foi gravado no envio. Só vale em linha que saiu por token
 * (`sent_via` `system` ou `ai`).
 *
 * ─── O que a linha ANTIGA não guarda ───────────────────────────────────────
 *
 * A mensagem enviada por token ANTES de o envio gravar o token continua como
 * estava: `sistema` / `integracao` (ou `ia` sem id, no token com escopo de
 * agente). Não há como saber, depois, qual token a enviou, e nada é reescrito.
 */
import { CHAVE_DO_ENVIO_POR_TOKEN } from "@/lib/api/handlers/token-do-ator";
import { lerRemetenteDeGrupo } from "@/lib/messaging/remetente-de-grupo";
import { nomesDosAtendentesCom } from "@/lib/users/nome-do-atendente";

import type { McpContext } from "./types";

export interface AutorDaMensagem {
  kind: "cliente" | "ia" | "agente" | "equipe" | "sistema";
  id: string | null;
  name: string | null;
  /** Só em `agente`: o token que enviou é o mesmo de quem está lendo. */
  is_self?: boolean;
  detail?: "celular" | "em_nome_de" | "automacao" | "integracao" | "participante_de_grupo";
  /** Só em `em_nome_de`: o nome do token que enviou. */
  via_token?: string | null;
}

interface MensagemComAutoria {
  id: string;
  direction: string;
  contact_id?: string | null;
  sent_via?: string | null;
  sent_by_user_id?: string | null;
  sent_on_behalf_of_user_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

/** O id que o envio gravou como autor da fala da IA, quando tem forma de id. */
function idDoAgenteGravado(m: MensagemComAutoria): string | null {
  const id = texto(m.metadata?.ai_actor_id);
  return id && UUID.test(id) ? id : null;
}

/** O token que o envio gravou na linha, quando ela saiu por token. */
function tokenGravado(m: MensagemComAutoria): { id: string; nome: string | null } | null {
  if (m.sent_via !== "system" && m.sent_via !== "ai") return null;
  const gravado = (m.metadata?.[CHAVE_DO_ENVIO_POR_TOKEN] ?? null) as { token_id?: unknown; token_name?: unknown } | null;
  const id = texto(gravado?.token_id);
  return id ? { id, nome: texto(gravado?.token_name) } : null;
}

/**
 * O autor de cada mensagem de UMA página. Nunca lança: nome que não pôde ser
 * lido sai `null`, e o histórico continua legível.
 */
export async function autoresDoHistorico(
  ctx: Pick<McpContext, "supabase" | "organizationId"> & Partial<Pick<McpContext, "apiTokenId">>,
  mensagens: ReadonlyArray<MensagemComAutoria>,
): Promise<Map<string, AutorDaMensagem>> {
  const saidas = mensagens.filter((m) => m.direction === "outbound");
  const daEquipe = (m: MensagemComAutoria) => m.sent_via === "user" || m.sent_via === "crm";

  const usuarios = saidas
    .filter((m) => daEquipe(m) && !m.sent_on_behalf_of_user_id)
    .map((m) => m.sent_by_user_id);
  const agentes = [
    ...new Set(
      saidas
        .filter((m) => m.sent_via === "ai" && !tokenGravado(m))
        .map(idDoAgenteGravado)
        .filter((id): id is string => id !== null),
    ),
  ];
  const tokens = [
    ...new Set(
      saidas
        .filter((m) => !m.sent_on_behalf_of_user_id)
        .map((m) => tokenGravado(m)?.id)
        .filter((id): id is string => typeof id === "string" && UUID.test(id)),
    ),
  ];

  let nomeDoUsuario = new Map<string, string | null>();
  const nomeDoAgente = new Map<string, string | null>();
  // Duas leituras independentes: a falha de uma não tira o que a outra sabe.
  // Sem nomes, a origem (`kind`) continua certa, que é o que decide.
  try {
    if (usuarios.some(Boolean)) {
      nomeDoUsuario = await nomesDosAtendentesCom(ctx.supabase, ctx.organizationId, usuarios);
    }
  } catch {
    nomeDoUsuario = new Map();
  }
  try {
    if (agentes.length > 0) {
      // O filtro de organização é o que faz do id gravado um agente DESTA casa:
      // o `ai_actor_id` de um envio por token é o id da execução, não o do agente.
      const { data } = await ctx.supabase
        .from("ai_agents")
        .select("id, name")
        .eq("organization_id", ctx.organizationId)
        .in("id", agentes);
      for (const a of (data ?? []) as Array<{ id: string; name: string | null }>) {
        nomeDoAgente.set(a.id, texto(a.name));
      }
    }
  } catch {
    nomeDoAgente.clear();
  }
  const nomeDoToken = new Map<string, string | null>();
  try {
    if (tokens.length > 0) {
      // Só o nome, e só de token DESTA organização.
      const { data } = await ctx.supabase
        .from("api_tokens")
        .select("id, name")
        .eq("organization_id", ctx.organizationId)
        .in("id", tokens);
      for (const t of (data ?? []) as Array<{ id: string; name: string | null }>) {
        nomeDoToken.set(t.id, texto(t.name));
      }
    }
  } catch {
    nomeDoToken.clear();
  }

  const autores = new Map<string, AutorDaMensagem>();
  for (const m of mensagens) {
    if (m.direction !== "outbound") {
      const participante = lerRemetenteDeGrupo(m.metadata ?? null);
      autores.set(
        m.id,
        participante
          ? { kind: "cliente", id: null, name: participante.name, detail: "participante_de_grupo" }
          : { kind: "cliente", id: m.contact_id ?? null, name: null },
      );
      continue;
    }
    if (m.sent_on_behalf_of_user_id) {
      const emNomeDe = (m.metadata?.sent_on_behalf ?? null) as { user_name?: unknown; token_name?: unknown } | null;
      autores.set(m.id, {
        kind: "equipe",
        id: m.sent_on_behalf_of_user_id,
        name: texto(emNomeDe?.user_name),
        detail: "em_nome_de",
        via_token: texto(emNomeDe?.token_name),
      });
      continue;
    }
    const token = tokenGravado(m);
    if (token) {
      autores.set(m.id, {
        kind: "agente",
        id: token.id,
        name: nomeDoToken.get(token.id) ?? token.nome,
        is_self: Boolean(ctx.apiTokenId) && token.id === ctx.apiTokenId,
      });
      continue;
    }
    if (m.sent_via === "ai") {
      const gravado = idDoAgenteGravado(m);
      const id = gravado && nomeDoAgente.has(gravado) ? gravado : null;
      autores.set(m.id, {
        kind: "ia",
        id,
        // Só `ai_actor_name`: é o campo que o envio grava DEPOIS da entrada do
        // cliente, então não é forjável (a mesma leitura do balão).
        name: texto(m.metadata?.ai_actor_name) ?? (id ? (nomeDoAgente.get(id) ?? null) : null),
      });
      continue;
    }
    if (daEquipe(m)) {
      const id = m.sent_by_user_id ?? null;
      autores.set(m.id, { kind: "equipe", id, name: id ? (nomeDoUsuario.get(id) ?? null) : null });
      continue;
    }
    if (m.sent_via === "external_device") {
      autores.set(m.id, { kind: "equipe", id: null, name: null, detail: "celular" });
      continue;
    }
    autores.set(m.id, {
      kind: "sistema",
      id: null,
      name: null,
      ...(m.sent_via === "automation"
        ? { detail: "automacao" as const }
        : m.sent_via === "system"
          ? { detail: "integracao" as const }
          : {}),
    });
  }
  return autores;
}

/** O canal da conversa (`whatsapp`, `instagram`…). `null` quando não pôde ser lido. */
export async function canalDaConversa(
  ctx: Pick<McpContext, "supabase" | "organizationId">,
  conversationId: string,
): Promise<string | null> {
  try {
    const { data } = await ctx.supabase
      .from("conversations")
      .select("channel")
      .eq("organization_id", ctx.organizationId)
      .eq("id", conversationId)
      .maybeSingle();
    const canal = (data as { channel?: unknown } | null)?.channel;
    return typeof canal === "string" && canal !== "" ? canal : null;
  } catch {
    return null;
  }
}
