/**
 * Handlers das capacidades de NOTA DO NEGÓCIO — o registro com autoria que um
 * agente deixa para a equipe (e para outro agente) na linha do tempo do card.
 *
 *  Read:
 *   - crm_list_lead_notes
 *  Write:
 *   - crm_add_lead_note
 *
 * A regra mora em `lib/leads/notas-do-negocio.ts`, e o cabeçalho de lá explica
 * a diferença que importa: esta nota NÃO é a ficha do agente nativo
 * (`lead_notes`, `save_lead_note`). A ficha é a memória do agente sobre a
 * pessoa — por contato, podada para caber no prompt, sem autor. A nota daqui é
 * registro — por negócio, com autor e data, texto inteiro, que ninguém reescreve.
 * A leitura oferece as duas (`include_agent_memory`); a escrita só existe aqui
 * para a nota do negócio, porque a ficha tem dono: o motor.
 *
 * `organization_id` SEMPRE do `ctx` (o token), NUNCA do input. O autor também:
 * o nome sai do cadastro do agente ou do token, não de um argumento — senão um
 * agente assinaria como outro.
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import {
  DESTINATARIO_MAX,
  NOTA_MAX,
  fichaDoAgenteDoContato,
  listarNotasDoNegocio,
  registrarNotaDoNegocio,
} from "@/lib/leads/notas-do-negocio";
import { instanteDoArgumento } from "../argumentos-do-agente";
import { auditoriaDoContexto, autorDoContexto } from "../ator-do-contexto";
import { comChaveDoPedido } from "../idempotencia";
import { CONSULTA_INDISPONIVEL, negocioDoContexto, recusa } from "../negocio-do-contexto";
import type { McpToolDefinition } from "../types";

// ---------------------------------------------------------------------------
// crm_list_lead_notes
// ---------------------------------------------------------------------------

const listaInputShape = {
  lead_id: z.string().uuid(),
  // Texto no esquema, conferido no handler: `.datetime()` viraria uma expressão
  // regular que vai ao modelo em todo passo (`lib/mcp/argumentos-do-agente.ts`).
  since: z.string().min(1).max(40).optional().describe("A partir de (ISO-8601 com fuso)."),
  author: z.string().trim().min(1).max(120).optional().describe("Id ou nome exato do autor."),
  recipient: z.string().trim().min(1).max(DESTINATARIO_MAX).optional(),
  include_agent_memory: z
    .boolean()
    .default(false)
    .describe("true = traz também a ficha do agente nativo sobre o contato (só leitura)."),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
};

export const crmListLeadNotes: McpToolDefinition<typeof listaInputShape> = {
  name: "crm_list_lead_notes",
  description:
    "Lê as notas de um negócio em ordem cronológica: autor, data e o texto inteiro. Filtre por " +
    "`recipient` para achar o recado que outro agente deixou. Paginada: repita com o `cursor` " +
    "enquanto `has_more` for true.",
  inputSchema: listaInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const negocio = await negocioDoContexto(ctx, input.lead_id);
    if (!negocio.ok) return negocio.recusa;

    const desde = input.since ? instanteDoArgumento("since", input.since) : null;
    if (desde && !desde.ok) return desde.recusa;

    const lista = await listarNotasDoNegocio(ctx.supabase, ctx.organizationId, negocio.lead.id, {
      desde: desde?.ok ? desde.iso : undefined,
      autor: input.author,
      destinatario: input.recipient,
      limite: input.limit,
      cursor: input.cursor,
    });
    if (!lista.ok) {
      return lista.recusa === "cursor_invalido"
        ? recusa("cursor_invalido", "o cursor não é o que esta ferramenta devolveu; recomece sem ele.")
        : CONSULTA_INDISPONIVEL;
    }

    const resposta: Record<string, unknown> = {
      lead_id: negocio.lead.id,
      notes: lista.notas,
      has_more: lista.has_more,
      cursor: lista.cursor,
    };

    if (input.include_agent_memory) {
      // A ficha é por CONTATO: negócio sem contato não tem ficha.
      const ficha = negocio.lead.contact_id
        ? await fichaDoAgenteDoContato(ctx.supabase, ctx.organizationId, negocio.lead.contact_id)
        : { ok: true as const, notas: [] };
      if (!ficha.ok) return CONSULTA_INDISPONIVEL;
      resposta.agent_memory = ficha.notas;
      resposta.agent_memory_about =
        "Ficha que o agente nativo mantém sobre o contato (vale para todos os negócios dele). " +
        "Ele mesmo a consolida e substitui; não tem autor nem destinatário e não é escrita por aqui.";
    }

    return resposta;
  },
};

// ---------------------------------------------------------------------------
// crm_add_lead_note
// ---------------------------------------------------------------------------

const criacaoInputShape = {
  lead_id: z.string().uuid(),
  text: z
    .string()
    .trim()
    .min(1)
    .max(NOTA_MAX)
    .describe("Gravado e devolvido inteiro."),
  recipient: z
    .string()
    .trim()
    .min(1)
    .max(DESTINATARIO_MAX)
    .optional()
    .describe("Para quem é o recado (texto livre). Só um marcador: não avisa ninguém."),
};

export const crmAddLeadNote: McpToolDefinition<typeof criacaoInputShape> = {
  name: "crm_add_lead_note",
  description:
    "Escreve uma nota no negócio, assinada por você, que a equipe lê na linha do tempo — nunca " +
    "vai ao cliente. `recipient` deixa recado a uma área ou a outro agente.",
  inputSchema: criacaoInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  // A nota fala do cliente: na auditoria vai o tamanho, nunca o texto.
  redigirParaAuditoria: (args) =>
    typeof args.text === "string" ? { ...args, text: `[${args.text.length} caracteres]` } : args,
  // Três camadas contra a nota em dobro (revisão de 20/11, item 2.13):
  //  1. o recibo do pedido (`comChaveDoPedido`): a `Idempotency-Key` do
  //     cabeçalho ou, sem ela, a chave derivada do conteúdo — a mesma nota, do
  //     mesmo autor, no mesmo negócio, repetida em poucos minutos, devolve a
  //     primeira;
  //  2. a chave do cabeçalho gravada na própria nota, que responde depois que o
  //     recibo venceu;
  //  3. o índice único do banco sobre essa chave (migration 9818), que decide
  //     a corrida entre duas chamadas simultâneas.
  handler: async (input, ctx) =>
    comChaveDoPedido(
      ctx,
      "crm_add_lead_note",
      input,
      async () => {
        const negocio = await negocioDoContexto(ctx, input.lead_id);
        if (!negocio.ok) return negocio.recusa;

        const autor = await autorDoContexto(ctx);
        const desfecho = await registrarNotaDoNegocio({
          supabase: ctx.supabase,
          organizationId: ctx.organizationId,
          lead: { id: negocio.lead.id, contact_id: negocio.lead.contact_id },
          texto: input.text,
          destinatario: input.recipient ?? null,
          autor,
          ator: ctx.actor,
          chaveDeIdempotencia: ctx.idempotencyKey ?? null,
        });
        if (!desfecho.ok) {
          return recusa("indisponivel", "não consegui gravar a nota agora; tente de novo em instantes.");
        }

        if (!desfecho.repetida) {
          const a = auditoriaDoContexto(ctx, {
            note_id: desfecho.nota.id,
            text_length: input.text.length,
            has_recipient: Boolean(input.recipient),
          });
          await audit({
            action: "lead.note_added",
            organizationId: ctx.organizationId,
            actorUserId: a.actorUserId,
            actorApiTokenId: a.actorApiTokenId,
            resourceType: "crm_leads",
            resourceId: negocio.lead.id,
            requestId: a.requestId,
            metadata: a.metadata,
          });
        }

        return {
          note: desfecho.nota,
          ...(desfecho.repetida ? { idempotent_replay: true } : {}),
          next_action: desfecho.repetida
            ? "Esta nota já estava gravada (mesma Idempotency-Key); nada foi duplicado."
            : "Nota gravada na linha do tempo do negócio, com o seu nome.",
        };
      },
      { derivarDe: input },
    ),
};
