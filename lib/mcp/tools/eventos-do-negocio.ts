/**
 * Handler da LINHA DO TEMPO por MCP — o que aconteceu num negócio, ou nos
 * negócios de um funil, num intervalo.
 *
 *  Read:
 *   - crm_list_lead_events
 *
 * A regra mora em `lib/leads/eventos-do-negocio.ts`, e o cabeçalho de lá diz de
 * onde cada linha vem (a linha do tempo do card e a fila de eventos) e o que as
 * fontes não sustentam: mensagem não é evento de negócio, e nem toda linha
 * guarda quem agiu.
 *
 * `organization_id` SEMPRE do `ctx` (o token), NUNCA do input. Num turno de
 * atendimento, só o que é do cliente da conversa: um negócio passa por
 * `negocioDoContexto`, e a consulta por funil enxerga apenas os negócios dele.
 */
import { z } from "zod";

import {
  AUTORES_DE_EVENTO,
  JANELA_MAXIMA_DO_FUNIL_DIAS,
  TIPOS_DE_EVENTO,
  listarEventosDoNegocio,
  type AlvoDosEventos,
} from "@/lib/leads/eventos-do-negocio";
import { instanteDoArgumento } from "../argumentos-do-agente";
import { alcanceDaIdentidadeDoToken } from "../identidade-do-token";
import { CONSULTA_INDISPONIVEL, negocioDoContexto, recusa } from "../negocio-do-contexto";
import type { McpToolDefinition } from "../types";

const DIA_MS = 24 * 60 * 60 * 1000;

const eventosInputShape = {
  lead_id: z.string().uuid().optional(),
  pipeline_id: z.string().uuid().optional(),
  // Texto no esquema, conferido no handler (`lib/mcp/argumentos-do-agente.ts`).
  since: z.string().optional().describe("A partir de (ISO-8601 com fuso)."),
  until: z.string().optional().describe("Antes de (idem)."),
  type: z.array(z.enum(TIPOS_DE_EVENTO)).optional(),
  author: z.array(z.enum(AUTORES_DE_EVENTO)).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
};

export const crmListLeadEvents: McpToolDefinition<typeof eventosInputShape> = {
  name: "crm_list_lead_events",
  description:
    "Linha do tempo de um negócio (`lead_id`) ou dos negócios de um funil (`pipeline_id`, que exige " +
    `\`since\` e janela de até ${JANELA_MAXIMA_DO_FUNIL_DIAS} dias), em ordem cronológica: mudança de etapa, ` +
    "responsável, tag e campo, nota, tarefa e o resto (`outro`), com autor (`is_self`: foi " +
    "você; id e nome de outro token só para gerente) e texto inteiro. Mensagem " +
    "não entra: leia a conversa. Repita com o `cursor` enquanto `has_more` for true (a página pode " +
    "vir menor que o limite, até vazia). Troca de responsável sai com autor `nao_registrado`, que " +
    "`author` nunca casa.",
  inputSchema: eventosInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    if ((input.lead_id === undefined) === (input.pipeline_id === undefined)) {
      return recusa(
        "alvo_invalido",
        "informe exatamente um: `lead_id` (um negócio) ou `pipeline_id` (todos os negócios do funil).",
      );
    }

    const desde = input.since ? instanteDoArgumento("since", input.since) : null;
    if (desde && !desde.ok) return desde.recusa;
    const ate = input.until ? instanteDoArgumento("until", input.until) : null;
    if (ate && !ate.ok) return ate.recusa;
    const inicio = desde?.ok ? Date.parse(desde.iso) : null;
    const fim = ate?.ok ? Date.parse(ate.iso) : null;
    if (inicio !== null && fim !== null && fim <= inicio) {
      return recusa("periodo_invalido", "`until` tem de ser depois de `since`.");
    }

    let alvo: AlvoDosEventos;
    if (input.lead_id !== undefined) {
      const negocio = await negocioDoContexto(ctx, input.lead_id);
      if (!negocio.ok) return negocio.recusa;
      alvo = { leadId: negocio.lead.id };
    } else {
      // O funil inteiro custa caro sem janela: a consulta varre a organização
      // pela data, então o começo é obrigatório e o tamanho tem teto.
      if (inicio === null) {
        return recusa(
          "periodo_obrigatorio",
          "com `pipeline_id`, informe `since` (ISO-8601 com fuso). " + `Agora é ${new Date().toISOString()}.`,
        );
      }
      if ((fim ?? Date.now()) - inicio > JANELA_MAXIMA_DO_FUNIL_DIAS * DIA_MS) {
        return recusa(
          "periodo_longo_demais",
          `com \`pipeline_id\` a janela vai até ${JANELA_MAXIMA_DO_FUNIL_DIAS} dias; ` +
            "peça em partes, com `since` e `until`.",
        );
      }
      const { data: funil, error } = await ctx.supabase
        .from("crm_pipelines")
        .select("id")
        .eq("organization_id", ctx.organizationId)
        .eq("id", input.pipeline_id!)
        .maybeSingle();
      if (error) return CONSULTA_INDISPONIVEL;
      if (!funil) {
        return recusa(
          "funil_nao_encontrado",
          "não existe funil com esse id nesta organização. Confira o id com `crm_list_pipelines`.",
        );
      }
      alvo = {
        pipelineId: input.pipeline_id!,
        contatoDoTurno: ctx.contatoDoTurno ?? null,
      };
    }

    const lista = await listarEventosDoNegocio(ctx.supabase, ctx.organizationId, alvo, {
      desde: desde?.ok ? desde.iso : undefined,
      ate: ate?.ok ? ate.iso : undefined,
      tipos: input.type,
      autores: input.author,
      limite: input.limit,
      cursor: input.cursor,
      // Para `author.is_self`: o token de quem lê e, no agente do CRM, o agente.
      leitor: {
        tokenId: ctx.apiTokenId,
        agentId: ctx.actor.type === "ai_agent" ? (ctx.actor.agent_id ?? null) : null,
        // O id e o nome de um token só saem para quem administra ou para o
        // próprio token; num turno de atendimento, para ninguém (item 2.32).
        identidadeDoToken: alcanceDaIdentidadeDoToken(ctx),
      },
    });
    if (!lista.ok) {
      return lista.recusa === "cursor_invalido"
        ? recusa("cursor_invalido", "o cursor não é o que esta ferramenta devolveu; recomece sem ele.")
        : CONSULTA_INDISPONIVEL;
    }

    return {
      ...("leadId" in alvo ? { lead_id: alvo.leadId } : { pipeline_id: alvo.pipelineId }),
      events: lista.eventos,
      has_more: lista.has_more,
      cursor: lista.cursor,
    };
  },
};
