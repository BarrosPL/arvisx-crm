/**
 * Handler da CONSULTA DE PROPOSTA — o agente lê o que já existe de proposta
 * comercial: em que estado está, até quando vale, o que foi oferecido e por
 * quanto.
 *
 *  Read:
 *   - crm_get_proposal
 *
 * Só leitura. Quem cria é `crm_draft_proposal` (`./propostas.ts`); quem envia,
 * aceita e recusa é uma pessoa, pela tela.
 *
 * `organization_id` SEMPRE do `ctx` (o token), NUNCA do input. O cliente é
 * service role, então toda consulta filtra a organização à mão.
 *
 * ═══ As travas, as mesmas de `negocioDoContexto` ═══
 *
 *  - Por `lead_id`, o negócio passa por `negocioDoContexto`: organização,
 *    conversa e contato pessoal.
 *  - Por `proposal_id`, a proposta é conferida aqui com a mesma régua. Num
 *    turno de atendimento, proposta de outro cliente e proposta inexistente
 *    recebem a MESMA recusa, com a mesma consulta: o id não vira oráculo. A
 *    conferência é pelo `contact_id` da própria proposta, porque ela sobrevive
 *    ao negócio apagado (`lead_id` pode ser nulo).
 *
 * ═══ O link ═══
 *
 * Não existe página pública de proposta: o cliente a recebe como PDF, na
 * conversa. O que há para apontar é esse PDF, no Storage. O link é assinado,
 * curto, e só existe para proposta que já saiu (o PDF de um rascunho cujo envio
 * falhou pode não corresponder mais ao que está no editor).
 */
import { z } from "zod";

import { capacidadesDaOrganizacao } from "@/lib/organizacao/capacidades";
import {
  VALIDADE_DO_LINK_DE_CONSULTA_DO_PDF_S,
  linkDeConsultaDoPdfDaProposta,
} from "@/lib/propostas/storage";
import {
  CONSULTA_INDISPONIVEL,
  NEGOCIO_DE_CONTATO_PESSOAL,
  negocioDoContexto,
  recusa,
  type RecusaParaOAgente,
} from "../negocio-do-contexto";
import type { McpContext, McpToolDefinition } from "../types";

/** Quantas propostas de um negócio voltam numa consulta por `lead_id`. */
export const MAXIMO_DE_PROPOSTAS_POR_CONSULTA = 10;

/** Estados em que o PDF gravado ainda não é o que o cliente recebeu. */
const STATUS_SEM_PDF_VALIDO = new Set(["rascunho", "enviando"]);

const COLUNAS_DA_PROPOSTA =
  "id, lead_id, contact_id, numero, ano, versao, substitui_id, titulo, status, valid_until, " +
  "moeda, total_cents, pricing_status, prazo_dias_uteis, pagamento, condicoes, sent_at, " +
  "decided_at, decision_reason, pdf_path, created_at";

const COLUNAS_DO_ITEM =
  "proposal_id, product_id, descricao, quantidade, preco_unitario_cents, desconto_cents, position";

const PROPOSTA_FORA_DA_CONVERSA = recusa(
  "fora_da_conversa",
  "esta conversa é com outra pessoa — uma proposta que não é deste cliente não é sua para ver; " +
    "siga a conversa com quem está falando.",
);

const PROPOSTA_NAO_ENCONTRADA = recusa(
  "proposta_nao_encontrada",
  "não existe proposta com esse id nesta organização. Confira o id (é o da PROPOSTA) ou " +
    "consulte por `lead_id` para ver as propostas do negócio.",
);

interface LinhaDaProposta {
  id: string;
  lead_id: string | null;
  contact_id: string | null;
  numero: number | null;
  ano: number | null;
  versao: number;
  substitui_id: string | null;
  titulo: string;
  status: string;
  valid_until: string | null;
  moeda: string;
  total_cents: number;
  pricing_status: string;
  prazo_dias_uteis: number | null;
  pagamento: string | null;
  condicoes: string | null;
  sent_at: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  pdf_path: string | null;
  created_at: string;
}

interface LinhaDoItem {
  proposal_id: string;
  product_id: string | null;
  descricao: string;
  quantidade: number;
  preco_unitario_cents: number | null;
  desconto_cents: number;
  position: number;
}

/**
 * A proposta que o agente pediu por id — conferida. Sempre UMA consulta a
 * `crm_proposals` antes de qualquer recusa de conversa, exista a linha ou não.
 */
async function propostaDoContexto(
  ctx: McpContext,
  proposalId: string,
): Promise<{ ok: true; proposta: LinhaDaProposta } | { ok: false; recusa: RecusaParaOAgente }> {
  const { data, error } = await ctx.supabase
    .from("crm_proposals")
    .select(COLUNAS_DA_PROPOSTA)
    .eq("organization_id", ctx.organizationId)
    .eq("id", proposalId)
    .maybeSingle();
  if (error) return { ok: false, recusa: CONSULTA_INDISPONIVEL };

  const proposta = data as unknown as LinhaDaProposta | null;

  if (ctx.contatoDoTurno) {
    if (!proposta || proposta.contact_id?.toLowerCase() !== ctx.contatoDoTurno.toLowerCase()) {
      return { ok: false, recusa: PROPOSTA_FORA_DA_CONVERSA };
    }
  }
  if (!proposta) return { ok: false, recusa: PROPOSTA_NAO_ENCONTRADA };

  if (proposta.contact_id) {
    const { data: contato } = await ctx.supabase
      .from("contacts")
      .select("is_personal")
      .eq("organization_id", ctx.organizationId)
      .eq("id", proposta.contact_id)
      .maybeSingle();
    if ((contato as { is_personal?: boolean } | null)?.is_personal === true) {
      return { ok: false, recusa: NEGOCIO_DE_CONTATO_PESSOAL };
    }
  }

  return { ok: true, proposta };
}

/** O que o agente recebe de cada proposta: nada de briefing, snapshot ou autoria interna. */
async function apresentar(ctx: McpContext, propostas: LinhaDaProposta[]) {
  if (propostas.length === 0) return { ok: true as const, propostas: [] };

  const { data, error } = await ctx.supabase
    .from("crm_proposal_items")
    .select(COLUNAS_DO_ITEM)
    .eq("organization_id", ctx.organizationId)
    .in(
      "proposal_id",
      propostas.map((p) => p.id),
    )
    .order("position", { ascending: true });
  if (error) return { ok: false as const };
  const itens = (data ?? []) as unknown as LinhaDoItem[];

  const apresentadas = [];
  for (const p of propostas) {
    const pdfUrl = STATUS_SEM_PDF_VALIDO.has(p.status)
      ? null
      : await linkDeConsultaDoPdfDaProposta(ctx.supabase, {
          orgId: ctx.organizationId,
          propostaId: p.id,
          pdfPath: p.pdf_path,
        });
    apresentadas.push({
      id: p.id,
      lead_id: p.lead_id,
      number: p.numero,
      year: p.ano,
      version: p.versao,
      replaces_proposal_id: p.substitui_id,
      title: p.titulo,
      status: p.status,
      valid_until: p.valid_until,
      currency: p.moeda,
      total_cents: p.total_cents,
      pricing_status: p.pricing_status,
      delivery_business_days: p.prazo_dias_uteis,
      payment_terms: p.pagamento,
      conditions: p.condicoes,
      sent_at: p.sent_at,
      decided_at: p.decided_at,
      decision_reason: p.decision_reason,
      created_at: p.created_at,
      items: itens
        .filter((it) => it.proposal_id === p.id)
        .map((it) => ({
          description: it.descricao,
          quantity: Number(it.quantidade),
          unit_price_cents: it.preco_unitario_cents,
          discount_cents: it.desconto_cents,
          product_id: it.product_id,
        })),
      pdf_url: pdfUrl,
      pdf_url_expires_in_seconds: pdfUrl ? VALIDADE_DO_LINK_DE_CONSULTA_DO_PDF_S : null,
    });
  }
  return { ok: true as const, propostas: apresentadas };
}

const consultaInputShape = {
  proposal_id: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional().describe("Traz as propostas deste negócio."),
};

export const crmGetProposal: McpToolDefinition<typeof consultaInputShape> = {
  name: "crm_get_proposal",
  description:
    "Consulta proposta comercial: status (rascunho, enviando, enviada, aceita, recusada, vencida, " +
    "cancelada, substituida), validade, itens, valor total e link do PDF. Informe `proposal_id` OU " +
    "`lead_id` (as do negócio, da mais recente para a mais antiga). Rascunho ainda não chegou ao " +
    "cliente; `unit_price_cents` nulo é preço a definir. Só lê.",
  inputSchema: consultaInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    if ((input.proposal_id === undefined) === (input.lead_id === undefined)) {
      return recusa(
        "alvo_invalido",
        "informe exatamente um: `proposal_id` (uma proposta) ou `lead_id` (as propostas do negócio).",
      );
    }
    if (!(await capacidadesDaOrganizacao(ctx.supabase, ctx.organizationId)).includes("propostas")) {
      return recusa("propostas_desligadas", "propostas estão desligadas nesta organização.");
    }

    if (input.proposal_id !== undefined) {
      const conferida = await propostaDoContexto(ctx, input.proposal_id);
      if (!conferida.ok) return conferida.recusa;
      const vista = await apresentar(ctx, [conferida.proposta]);
      if (!vista.ok) return CONSULTA_INDISPONIVEL;
      return { proposal: vista.propostas[0] };
    }

    const negocio = await negocioDoContexto(ctx, input.lead_id!);
    if (!negocio.ok) return negocio.recusa;

    // Uma a mais que o máximo: é o que diz se ficou proposta de fora.
    const { data, error } = await ctx.supabase
      .from("crm_proposals")
      .select(COLUNAS_DA_PROPOSTA)
      .eq("organization_id", ctx.organizationId)
      .eq("lead_id", negocio.lead.id)
      .order("created_at", { ascending: false })
      .limit(MAXIMO_DE_PROPOSTAS_POR_CONSULTA + 1);
    if (error) return CONSULTA_INDISPONIVEL;
    const linhas = (data ?? []) as unknown as LinhaDaProposta[];

    const vista = await apresentar(ctx, linhas.slice(0, MAXIMO_DE_PROPOSTAS_POR_CONSULTA));
    if (!vista.ok) return CONSULTA_INDISPONIVEL;
    return {
      lead_id: negocio.lead.id,
      proposals: vista.propostas,
      has_more: linhas.length > MAXIMO_DE_PROPOSTAS_POR_CONSULTA,
    };
  },
};
