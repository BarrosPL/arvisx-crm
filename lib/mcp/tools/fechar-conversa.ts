/**
 * MCP write tool — crm_close_conversation (Ajustes, PR AJ-1).
 *
 * A LACUNA: um agente que fala com o CRM por token não tinha como tirar da
 * caixa de entrada a conversa em que ele falou por último e o cliente não
 * respondeu. `crm_close_human_case` fecha o CHAMADO e `crm_close_demand` fecha
 * o NEGÓCIO; fechar a CONVERSA só existia na tela
 * (`POST /api/v1/conversations/[id]/close`, sessão de usuário).
 *
 * DOUTRINA DIRC: nenhuma regra nova aqui. A leitura com filtro de organização,
 * a trava de revisão da `fn_service_status` e a auditoria `conversation.closed`
 * são as de `lib/inbox/fechar-conversa.ts`, o MESMO módulo que a rota chama.
 *
 * O que é só desta porta:
 *
 *  - `organization_id` SEMPRE do `ctx` (o token), NUNCA do input;
 *  - num turno de atendimento, só a conversa do contato atendido — e conversa
 *    de outro cliente recebe a MESMA recusa de conversa inexistente;
 *  - NADA é enviado ao cliente e nenhuma trava de atendimento humano é solta:
 *    a devolução ao automático é escolha da tela, e o agente nunca reassume;
 *  - é IDEMPOTENTE: conversa já encerrada (fechada, resolvida ou arquivada)
 *    devolve sucesso sem escrever nada e sem nova linha de auditoria. Uma
 *    conversa arquivada continua arquivada — a ferramenta não a traz de volta;
 *  - conversa ASSUMIDA POR UMA PESSOA (`assigned_to_user_id` preenchido) não é
 *    fechada por esta porta: recusa `conversa_com_humano`, sem escrever e sem
 *    auditar. Vale para todo ator daqui, de qualquer papel (token comum, de
 *    gerente, de administrador e agente nativo): quem chama esta ferramenta é
 *    um agente, e papel alto no token não o torna a pessoa que assumiu. Fechar
 *    conversa assumida é da tela, onde vale `exigirControleDaConversa`.
 *    Decisão do dono em 23/11/2026, que troca a de 20/11 registrada no PR #14
 *    (revisão 20/11, item 2.31).
 *
 *    A conferência daqui (na leitura) é só o caminho rápido. A regra mora em
 *    `lib/inbox/fechar-conversa.ts` (`origem: "agente"`) e na
 *    `fn_service_status` (`p_ator = 'agente'`, migration 9824), que recusa COM A
 *    LINHA TRAVADA: se uma pessoa assumir no instante entre a leitura e o
 *    fechamento, o banco responde `PT403` e a ferramenta devolve a mesma recusa
 *    `conversa_com_humano`.
 *
 *    BANCO ANTERIOR À 9824 (imagem nova, banco antigo): a função de 5
 *    argumentos não existe e o PostgREST responde PGRST202. A ferramenta
 *    devolve `indisponivel` e NÃO fecha. Não há volta ao caminho antigo.
 */
import { z } from "zod";

import {
  conversaJaEncerrada,
  fecharConversa,
  lerConversaParaFechar,
  type ConversaParaFechar,
} from "@/lib/inbox/fechar-conversa";
import { auditoriaDoContexto } from "../ator-do-contexto";
import { CONSULTA_INDISPONIVEL, recusa } from "../negocio-do-contexto";
import type { McpContext, McpToolDefinition } from "../types";

export const MOTIVO_DO_FECHAMENTO_MAX = 300;

const CONVERSA_FORA_DO_TURNO = recusa(
  "fora_da_conversa",
  "esta conversa é com outra pessoa — a conversa de um cliente que não é o desta conversa não é " +
    "sua para fechar; siga a conversa com quem está falando.",
);

const CONVERSA_NAO_ENCONTRADA = recusa(
  "conversa_nao_encontrada",
  "não existe conversa com esse id nesta organização. Confira o id (é o da CONVERSA, não o do " +
    "contato nem o do negócio) e tente de novo.",
);

const CONVERSA_DE_CONTATO_PESSOAL = recusa(
  "contato_pessoal",
  "esta conversa é de um contato marcado como pessoal — fora da operação: não a altere.",
);

const CONVERSA_COM_HUMANO = recusa(
  "conversa_com_humano",
  "uma pessoa da equipe assumiu esta conversa e está com ela: você não pode fechá-la. Nada foi " +
    "alterado. Não tente de novo; se a conversa precisa mesmo ser encerrada, quem fecha é a " +
    "pessoa responsável (ou um gerente), pela tela.",
);

const CONVERSA_MUDOU = recusa(
  "conversa_mudou",
  "o atendimento desta conversa mudou enquanto você fechava. Leia a conversa de novo e só " +
    "repita o fechamento se ele ainda fizer sentido.",
);

/** A conversa do pedido, com as travas desta porta. */
async function conversaDoContexto(
  ctx: McpContext,
  conversationId: string,
): Promise<{ ok: true; conversa: ConversaParaFechar } | { ok: false; recusa: ReturnType<typeof recusa> }> {
  const leitura = await lerConversaParaFechar(ctx.supabase, ctx.organizationId, conversationId);
  if (!leitura.ok) return { ok: false, recusa: CONSULTA_INDISPONIVEL };

  const conversa = leitura.conversa;
  if (ctx.contatoDoTurno && (!conversa || conversa.contact_id !== ctx.contatoDoTurno)) {
    return { ok: false, recusa: CONVERSA_FORA_DO_TURNO };
  }
  if (!conversa) return { ok: false, recusa: CONVERSA_NAO_ENCONTRADA };

  if (conversa.contact_id) {
    const { data, error } = await ctx.supabase
      .from("contacts")
      .select("is_personal")
      .eq("organization_id", ctx.organizationId)
      .eq("id", conversa.contact_id)
      .maybeSingle();
    if (error) return { ok: false, recusa: CONSULTA_INDISPONIVEL };
    if ((data as { is_personal?: boolean } | null)?.is_personal === true) {
      return { ok: false, recusa: CONVERSA_DE_CONTATO_PESSOAL };
    }
  }
  return { ok: true, conversa };
}

function jaEncerrada(conversa: Pick<ConversaParaFechar, "id" | "status">) {
  return {
    conversation_id: conversa.id,
    status: conversa.status,
    already_closed: true,
    next_action: "Esta conversa já estava encerrada; nada foi alterado.",
  };
}

const inputShape = {
  conversation_id: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(MOTIVO_DO_FECHAMENTO_MAX)
    .optional()
    .describe("Por que está fechando, em uma frase. Fica na auditoria."),
};

export const crmCloseConversation: McpToolDefinition<typeof inputShape> = {
  name: "crm_close_conversation",
  description:
    "Fecha uma conversa para ela sair da caixa de entrada — por exemplo, quando você falou por " +
    "último e o cliente não respondeu há dias. NADA é enviado ao cliente; se ele escrever de " +
    "novo, a conversa reabre. Não fecha chamado nem negócio. Repetir numa conversa já encerrada " +
    "não muda nada. NÃO fecha conversa que uma pessoa da equipe assumiu: nesse caso recusa, e quem " +
    "fecha é a pessoa, pela tela.",
  inputSchema: inputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const pedido = await conversaDoContexto(ctx, input.conversation_id);
    if (!pedido.ok) return pedido.recusa;
    const { conversa } = pedido;

    if (conversaJaEncerrada(conversa.status)) return jaEncerrada(conversa);
    if (conversa.assigned_to_user_id !== null) return CONVERSA_COM_HUMANO;

    const a = auditoriaDoContexto(ctx, {
      previous_status: conversa.status,
      ...(input.reason ? { reason: input.reason } : {}),
    });
    const fechamento = await fecharConversa({
      admin: ctx.supabase,
      conversa,
      origem: "agente",
      revisaoEsperada: conversa.service_revision,
      requestId: a.requestId,
      ator: {
        actorUserId: a.actorUserId,
        actorApiTokenId: a.actorApiTokenId,
        metadata: a.metadata,
      },
    });

    if (!fechamento.ok) {
      // A pessoa assumiu entre a leitura daqui e a função do banco.
      if (fechamento.erro === "com_humano") return CONVERSA_COM_HUMANO;
      if (fechamento.erro !== "conflito") {
        return recusa("indisponivel", "não consegui fechar a conversa agora; tente de novo em instantes.");
      }
      // Alguém mexeu no atendimento entre a leitura e o fechamento. Se quem
      // mexeu FECHOU, o pedido já está atendido — e é o caso de dois pedidos
      // iguais chegando juntos. Qualquer outra mudança volta para o agente
      // decidir: fechar por cima de estado que ele não viu não é idempotência.
      const releitura = await lerConversaParaFechar(ctx.supabase, ctx.organizationId, conversa.id);
      if (releitura.ok && releitura.conversa && conversaJaEncerrada(releitura.conversa.status)) {
        return jaEncerrada(releitura.conversa);
      }
      return CONVERSA_MUDOU;
    }

    return {
      conversation_id: conversa.id,
      status: "closed",
      already_closed: false,
      next_action:
        "Conversa fechada. Nenhuma mensagem foi enviada ao cliente; se ele escrever, ela reabre.",
    };
  },
};
