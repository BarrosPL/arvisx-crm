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
 * `sent_on_behalf`). Nada novo é gravado.
 *
 * ─── As quatro origens ─────────────────────────────────────────────────────
 *
 *  - `cliente`: mensagem recebida. Em grupo, `name` é o participante que falou.
 *  - `ia`: escrita por um agente de IA. `name` é o nome gravado na linha (ou o
 *    do cadastro); `id` só sai quando o id gravado é de um agente desta
 *    organização.
 *  - `equipe`: escrita por uma pessoa. `name` é só o nome (nunca e-mail nem
 *    telefone). `detail: "celular"` = saiu do aparelho ligado ao número, fora do
 *    CRM, e a linha não diz quem digitou. `detail: "em_nome_de"` = um sistema
 *    enviou por decisão daquela pessoa (`via_token` diz qual).
 *  - `sistema`: ninguém escreveu na hora. `detail: "automacao"` = texto fixo de
 *    regra, follow-up ou lembrete; `detail: "integracao"` = enviada por token de
 *    API sem agente de IA.
 *
 * ─── O que a linha NÃO guarda ──────────────────────────────────────────────
 *
 * A mensagem enviada por token de API não leva o token: duas integrações
 * diferentes saem iguais (`sistema` / `integracao`), e um agente externo não
 * distingue a própria fala da de outra integração. O que ele distingue com
 * certeza é o que importa para não repetir nem contradizer: o que foi a equipe.
 */
import { lerRemetenteDeGrupo } from "@/lib/messaging/remetente-de-grupo";
import { nomesDosAtendentesCom } from "@/lib/users/nome-do-atendente";

import type { McpContext } from "./types";

export interface AutorDaMensagem {
  kind: "cliente" | "ia" | "equipe" | "sistema";
  id: string | null;
  name: string | null;
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

/**
 * O autor de cada mensagem de UMA página. Nunca lança: nome que não pôde ser
 * lido sai `null`, e o histórico continua legível.
 */
export async function autoresDoHistorico(
  ctx: Pick<McpContext, "supabase" | "organizationId">,
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
        .filter((m) => m.sent_via === "ai")
        .map(idDoAgenteGravado)
        .filter((id): id is string => id !== null),
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
