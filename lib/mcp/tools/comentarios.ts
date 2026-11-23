/**
 * Capacidades de COMENTÁRIOS de rede social — ler os comentários recebidos e
 * decidir o que fazer com cada um: responder em público, responder em privado,
 * marcar como sem ação ou transformar quem comentou em contato.
 *
 * Nenhuma regra mora aqui. As seis ferramentas chamam `lib/comentarios/acoes.ts`,
 * as MESMAS funções das rotas `/api/v1/social-comments/...`: o que a tela faz
 * e o que o agente faz passam pela mesma conferência (modo do canal, uma
 * resposta por comentário, prazo da rede) e deixam a mesma auditoria.
 *
 * ─── Quem alcança ───────────────────────────────────────────────────────────
 *
 * Papel mínimo `manager`, o da rota e o da tela. É a ferramenta de quem decide
 * por FORA do atendimento — o agente externo, com token tratado como gerente —
 * e não a do agente que conversa num turno: comentário não é do cliente de uma
 * conversa, e responder em público não tem o caminho seguro de envio do motor.
 * Por isso o catálogo as marca `apenasHumano`, e por isso cada handler recusa
 * por conta própria quando há contato do turno.
 *
 * A organização vem do token (`ctx.organizationId`); nenhuma aceita
 * `organization_id`. A recusa volta como dado (`permitido: false`, `motivo`,
 * `mensagem`), não como exceção: quem chama precisa ler o motivo para decidir.
 */
import { z } from "zod";

import { ApiError } from "@/lib/api/types";
import {
  criarContatoDoComentario,
  ignorarComentario,
  lerComentario,
  listarComentarios,
  responderEmPrivado,
  responderEmPublico,
  type QuemAge,
} from "@/lib/comentarios/acoes";
import { LIMITE_MAXIMO_DA_LISTA, TETO_DE_TRANSPORTE_DO_TEXTO } from "@/lib/comentarios/schemas";
import { ESTADOS_DO_COMENTARIO } from "@/lib/channels/meta-social/comentarios";

import type { McpContext, McpToolDefinition } from "../types";

const FORA_DO_ATENDIMENTO = {
  permitido: false,
  motivo: "fora_da_conversa",
  mensagem:
    "comentários de publicação não são da conversa com este cliente — esta ação não se faz de dentro de um atendimento.",
} as const;

function quem(ctx: McpContext): QuemAge {
  return { actor: ctx.actor, apiTokenId: ctx.apiTokenId, requestId: ctx.requestId, via: "mcp" };
}

/** Roda a ação e devolve a recusa de negócio como DADO. Defeito continua subindo. */
async function comRecusa<T>(ctx: McpContext, acao: () => Promise<T>): Promise<T | Record<string, unknown>> {
  if (ctx.contatoDoTurno) return FORA_DO_ATENDIMENTO;
  try {
    return await acao();
  } catch (erro) {
    if (!(erro instanceof ApiError) || erro.code === "internal_error") throw erro;
    return {
      permitido: false,
      motivo: erro.code,
      mensagem: erro.message,
      ...(erro.details ? { detalhes: erro.details } : {}),
    };
  }
}

const id = z.string().uuid().describe("O `id` do comentário no CRM (não o id da rede).");
const texto = z.string().min(1).max(TETO_DE_TRANSPORTE_DO_TEXTO);
const confirmarReenvio = z
  .boolean()
  .optional()
  .describe("Só depois de uma recusa `resposta_incerta`: envia de novo mesmo podendo duplicar.");

// ---------------------------------------------------------------------------
// leitura
// ---------------------------------------------------------------------------

const listarShape = {
  canal: z.string().uuid().optional().describe("Id da conexão que recebeu os comentários."),
  estado: z.enum(ESTADOS_DO_COMENTARIO).optional().describe("`novo` é o que ainda espera decisão."),
  desde: z.string().optional().describe("ISO-8601 com fuso: só comentários a partir daqui."),
  midia: z.string().optional().describe("Id da publicação na rede."),
  limite: z.number().int().min(1).max(LIMITE_MAXIMO_DA_LISTA).optional(),
  cursor: z.string().optional().describe("O `cursor` da página anterior."),
};

export const crmListComments: McpToolDefinition<typeof listarShape> = {
  name: "crm_list_comments",
  description:
    "Lista os comentários recebidos nas publicações do Instagram, do mais recente para o mais antigo, com o texto " +
    "inteiro, quem comentou, a publicação e o que já foi feito (resposta pública, resposta privada, estado). " +
    "Paginada: repita com o `cursor` devolvido enquanto `tem_mais` for verdadeiro.",
  inputSchema: listarShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  handler: (input, ctx) =>
    comRecusa(ctx, () => {
      if (input.desde !== undefined && Number.isNaN(Date.parse(input.desde))) {
        throw new ApiError(422, "validation_error", undefined, ctx.requestId, "`desde` precisa ser uma data ISO-8601.");
      }
      return listarComentarios(ctx.supabase, ctx.organizationId, input, quem(ctx));
    }),
};

const lerShape = { id };

export const crmGetComment: McpToolDefinition<typeof lerShape> = {
  name: "crm_get_comment",
  description:
    "Traz um comentário pelo `id`, com o texto inteiro, as respostas já dadas, o estado, o contato ligado e até " +
    "quando a rede aceita a resposta privada (`private_reply_deadline`).",
  inputSchema: lerShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  handler: (input, ctx) =>
    comRecusa(ctx, () => lerComentario(ctx.supabase, ctx.organizationId, input.id, quem(ctx))),
};

// ---------------------------------------------------------------------------
// escrita
// ---------------------------------------------------------------------------

const responderShape = { id, text: texto, confirmar_reenvio: confirmarReenvio };

export const crmReplyComment: McpToolDefinition<typeof responderShape> = {
  name: "crm_reply_comment",
  description:
    "Responde a um comentário EM PÚBLICO, na própria publicação. Uma resposta por comentário: se já houver, volta " +
    "`ja_respondido` com a resposta existente. `simulada: true` quer dizer que o canal está em modo de registro e " +
    "nada foi publicado. Se voltar `resposta_incerta`, a resposta pode ter saído: confira antes de repetir.",
  inputSchema: responderShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: (input, ctx) =>
    comRecusa(ctx, () =>
      responderEmPublico(
        ctx.supabase,
        ctx.organizationId,
        input.id,
        { text: input.text, confirmar_reenvio: input.confirmar_reenvio },
        quem(ctx),
      ),
    ),
};

const privadoShape = {
  id,
  text: texto,
  criar_contato: z
    .boolean()
    .optional()
    .describe("Cria contato e conversa quando a pessoa ainda não tem, para a resposta dela cair no atendimento."),
  confirmar_reenvio: confirmarReenvio,
};

export const crmPrivateReplyComment: McpToolDefinition<typeof privadoShape> = {
  name: "crm_private_reply_comment",
  description:
    "Responde a um comentário EM PRIVADO, por mensagem direta a quem comentou. A rede aceita uma só por comentário " +
    "e até 7 dias depois dele (`janela_de_7_dias`); em transmissão ao vivo, só durante a transmissão. A conversa " +
    "só continua se a pessoa responder. `simulada: true` = modo de registro, nada foi enviado.",
  inputSchema: privadoShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: (input, ctx) =>
    comRecusa(ctx, () =>
      responderEmPrivado(
        ctx.supabase,
        ctx.organizationId,
        input.id,
        { text: input.text, criar_contato: input.criar_contato, confirmar_reenvio: input.confirmar_reenvio },
        quem(ctx),
      ),
    ),
};

const ignorarShape = { id, motivo: z.string().max(500).optional().describe("Por que não há o que fazer.") };

export const crmIgnoreComment: McpToolDefinition<typeof ignorarShape> = {
  name: "crm_ignore_comment",
  description:
    "Marca um comentário como sem ação (elogio, reação, spam), com o motivo. Nada é enviado nem publicado; o " +
    "comentário sai da fila de novos. Comentário já respondido não é marcado.",
  inputSchema: ignorarShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: (input, ctx) =>
    comRecusa(ctx, () =>
      ignorarComentario(ctx.supabase, ctx.organizationId, input.id, { motivo: input.motivo }, quem(ctx)),
    ),
};

const contatoShape = {
  id,
  pipeline_id: z.string().uuid().optional().describe("Funil onde abrir o negócio. Sem ele, só o contato é criado."),
  stage_id: z.string().uuid().optional().describe("Etapa do funil. Sem ela, a primeira etapa."),
  title: z.string().min(2).max(200).optional().describe("Título do negócio."),
};

export const crmCreateContactFromComment: McpToolDefinition<typeof contatoShape> = {
  name: "crm_create_contact_from_comment",
  description:
    "Cria o contato de quem comentou e, com `pipeline_id`, um negócio no funil. Chamar de novo devolve o mesmo " +
    "contato, e o negócio reaproveita o que já estiver aberto para ele naquele funil. Nada é enviado à pessoa.",
  inputSchema: contatoShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: (input, ctx) =>
    comRecusa(ctx, () => {
      if (input.stage_id && !input.pipeline_id) {
        throw new ApiError(422, "validation_error", undefined, ctx.requestId, "stage_id exige pipeline_id.");
      }
      return criarContatoDoComentario(
        ctx.supabase,
        ctx.organizationId,
        input.id,
        { pipeline_id: input.pipeline_id, stage_id: input.stage_id, title: input.title },
        quem(ctx),
      );
    }),
};
