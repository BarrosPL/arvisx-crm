/**
 * Handler da capacidade de PRÓXIMA AÇÃO — a proposta que o agente deixa no card
 * para uma pessoa aprovar ou descartar.
 *
 *  Write:
 *   - crm_set_next_action
 *
 * A tela decide sobre a proposta em `app/api/v1/leads/[id]/next-action`
 * (aprovar/descartar, sessão de usuário). O token de API não entra naquela
 * rota, e ao agente não cabe decidir: cabe PROPOR. Três peças já existentes são
 * reusadas, nenhuma reescrita:
 *
 *  - a ponte negócio → contato → proposta: `lerPropostaDoNegocio`
 *    (`lib/leads/proposta-de-proxima-acao.ts`), a mesma leitura da rota;
 *  - a escrita: `applyLeadStateUpdate` (`lib/agent-engine/agent/lead-state.ts`),
 *    o ÚNICO caminho que grava `next_action` e move `next_action_seq` — a
 *    identidade que a aprovação humana confere. Uma segunda escrita aqui
 *    deixaria a pessoa aprovar uma proposta e o sistema executar outra;
 *  - em qual card a proposta aparece: `roteiaProximasAcoes`
 *    (`lib/leads/next-action.ts`), a mesma regra do quadro.
 *
 * ⚠️ A proposta é por CONTATO (`lead_state`), e o card é um NEGÓCIO. Quando a
 * pessoa tem mais de um negócio aberto, a proposta pode ir para outro card ou
 * ficar com a equipe para desambiguar — a resposta diz qual dos casos foi, em
 * vez de afirmar que "ficou no card" quando não ficou.
 *
 * `organization_id` SEMPRE do `ctx`, NUNCA do input.
 */
import { z } from "zod";

import { applyLeadStateUpdate } from "@/lib/agent-engine/agent/lead-state";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { audit } from "@/lib/audit";
import type { LeadCandidate } from "@/lib/leads/active-lead";
import { roteiaProximasAcoes } from "@/lib/leads/next-action";
import { lerPropostaDoNegocio } from "@/lib/leads/proposta-de-proxima-acao";
import { auditoriaDoContexto } from "../ator-do-contexto";
import {
  CONSULTA_INDISPONIVEL,
  NEGOCIO_NAO_ENCONTRADO,
  negocioDoContexto,
  recusa,
} from "../negocio-do-contexto";
import type { McpToolDefinition } from "../types";

const inputShape = {
  lead_id: z.string().uuid(),
  next_action: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .nullable()
    .describe("O que fazer, e até quando, em uma frase. null retira a proposta."),
};

export const crmSetNextAction: McpToolDefinition<typeof inputShape> = {
  name: "crm_set_next_action",
  description:
    "Propõe a próxima ação de um negócio: uma frase concreta que aparece no card para alguém " +
    "da equipe aprovar ou descartar — nada vai ao cliente nem é executado sozinho. Escrever de " +
    "novo substitui a anterior.",
  inputSchema: inputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const negocio = await negocioDoContexto(ctx, input.lead_id);
    if (!negocio.ok) return negocio.recusa;

    const antes = await lerPropostaDoNegocio(ctx.supabase, negocio.lead.id, ctx.organizationId);
    if (!antes.ok) {
      if (antes.recusa === "negocio_sem_contato") {
        return recusa(
          "negocio_sem_contato",
          "este negócio não tem contato ligado, e a próxima ação é guardada por contato. Ligue " +
            "um contato ao negócio antes de propor.",
        );
      }
      return antes.recusa === "negocio_nao_encontrado" ? NEGOCIO_NAO_ENCONTRADO : CONSULTA_INDISPONIVEL;
    }

    const contato = antes.lead.contact_id;
    const escrita = await applyLeadStateUpdate(
      getRequestPool(),
      { tenantId: ctx.organizationId, leadId: contato },
      { next_action: input.next_action },
    );
    if (!escrita.ok) {
      return recusa("proxima_acao_invalida", escrita.error.message);
    }

    // `next_action_seq` só anda quando a proposta foi REESCRITA: é o que separa
    // "gravei" de "a frase era genérica e ficou como estava".
    const gravada = escrita.state.next_action_seq !== antes.seq;
    const proposta = escrita.state.next_action?.trim() || null;

    // Em qual card ela aparece — a mesma regra do quadro.
    let ondeAparece: "neste_negocio" | "em_outro_negocio" | "aguarda_escolha_da_equipe" | "em_nenhum" =
      "em_nenhum";
    let outroNegocio: string | null = null;
    if (proposta) {
      const { data: abertos, error } = await ctx.supabase
        .from("crm_leads")
        .select("id, organization_id, pipeline_id, status, last_activity_at, created_at, contact_id")
        .eq("organization_id", ctx.organizationId)
        .eq("contact_id", contato)
        .eq("status", "open");
      if (!error) {
        const rota = roteiaProximasAcoes(
          [
            {
              contact_id: contato,
              next_action: proposta,
              next_action_seq: escrita.state.next_action_seq,
              updated_at: new Date(escrita.state.updated_at).toISOString(),
            },
          ],
          (abertos ?? []) as Array<LeadCandidate & { contact_id: string | null }>,
        );
        if (rota.porLead.has(negocio.lead.id)) ondeAparece = "neste_negocio";
        else if (rota.porLead.size > 0) {
          ondeAparece = "em_outro_negocio";
          outroNegocio = [...rota.porLead.keys()][0] ?? null;
        } else if (rota.ambiguas.length > 0) ondeAparece = "aguarda_escolha_da_equipe";
      }
    }

    if (gravada) {
      const a = auditoriaDoContexto(ctx, {
        seq: escrita.state.next_action_seq,
        cleared: proposta === null,
      });
      await audit({
        action: "lead.next_action_proposed",
        organizationId: ctx.organizationId,
        actorUserId: a.actorUserId,
        actorApiTokenId: a.actorApiTokenId,
        resourceType: "crm_leads",
        resourceId: negocio.lead.id,
        requestId: a.requestId,
        metadata: a.metadata,
      });
    }

    const explicacao: Record<typeof ondeAparece, string> = {
      neste_negocio: "A proposta está no card deste negócio, esperando alguém da equipe aprovar ou descartar.",
      em_outro_negocio:
        "A proposta foi gravada, mas aparece no card de OUTRO negócio aberto deste contato (ver `shown_on_lead_id`): a próxima ação é por contato e vai para o negócio ativo dele.",
      aguarda_escolha_da_equipe:
        "A proposta foi gravada, mas este contato tem mais de um negócio aberto e ela não foi para nenhum card: a equipe escolhe a qual pertence.",
      em_nenhum: proposta
        ? "A proposta foi gravada, mas este contato não tem negócio aberto onde mostrá-la."
        : "Não há proposta pendente para este negócio.",
    };

    return {
      lead_id: negocio.lead.id,
      recorded: gravada,
      next_action: proposta,
      seq: escrita.state.next_action_seq,
      shown: ondeAparece,
      shown_on_lead_id: ondeAparece === "neste_negocio" ? negocio.lead.id : outroNegocio,
      next_step: gravada
        ? explicacao[ondeAparece]
        : "Nada foi gravado: a frase não descreve uma ação concreta (responder o cliente é o que " +
          "já se faz a cada mensagem). Escreva o que fazer, e até quando.",
    };
  },
};
