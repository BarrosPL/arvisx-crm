/**
 * MCP write tool — crm_send_proposal.
 *
 * O agente ENVIA ao cliente a proposta que está em rascunho: o PDF sai na
 * conversa. É a única ferramenta de proposta que fala com o cliente, e por isso
 * é de risco crítico: nunca entra ligada por pacote.
 *
 * ═══ Quem autoriza ═══
 *
 * Não é papel humano (pela tela, enviar exige `manager`). É o MODO da empresa,
 * `envio_de_proposta` (`lib/propostas/envio-pelo-agente.ts`):
 *
 *   • `apos_aprovacao` (padrão) — só a proposta que a equipe aprovou;
 *   • `direto` — sozinho, se todos os itens são do catálogo, com o preço do
 *     catálogo e sem desconto.
 *
 * Fora disso a resposta é `precisa_aprovacao`, e nada sai.
 *
 * ═══ O que bloqueia o envio, antes de qualquer efeito ═══
 *
 * As mesmas travas de toda ação que fala com o cliente:
 *
 *   • `contato_pediu_para_parar` — o contato bloqueou o atendimento (opt-out);
 *   • `humano_assumiu` — uma pessoa da equipe assumiu a conversa, ou o contato
 *     é de atendimento humano;
 *   • `modo_ensaio` — o canal está em ensaio e este número não é de teste;
 *   • `equipe_pausada` — o agente (ou a Equipe pronta) está pausado;
 *   • `fora_do_plano` — agente da Equipe pronta numa empresa cujo plano não a
 *     libera.
 *
 * Todas são conferidas ANTES de alocar número e montar o PDF. O
 * `sendMessageHandler` confere de novo o bloqueio e o ensaio na hora de sair:
 * é a segunda porta, para a corrida entre a conferência e o envio.
 *
 * ═══ O envio em si ═══
 *
 * `enviarProposta` (`lib/propostas/enviar-proposta.ts`), a MESMA função da rota
 * da tela: mesma conferência de itens, preço, modelo e documento, mesma janela
 * e limite do canal, mesmo PDF.
 *
 * `organization_id` SEMPRE do contexto. Num turno de atendimento, só proposta
 * do cliente da conversa; proposta de outro cliente e proposta inexistente
 * recebem a mesma recusa.
 */
import { z } from "zod";

import { travasDeFalarComOCliente } from "@/lib/ai/equipe-pronta/gatilhos/travas";
import { capacidadesDaOrganizacao } from "@/lib/organizacao/capacidades";
import { dataIsoNoFuso, fusoDaOrganizacao } from "@/lib/propostas/data-no-fuso";
import { enviarProposta } from "@/lib/propostas/enviar-proposta";
import {
  agentePodeEnviarAProposta,
  type ItemParaDecidir,
  type PorQuePrecisaDeAprovacao,
} from "@/lib/propostas/envio-pelo-agente";
import { auditoriaDoContexto } from "../ator-do-contexto";
import {
  CONSULTA_INDISPONIVEL,
  NEGOCIO_DE_CONTATO_PESSOAL,
  recusa,
  type RecusaParaOAgente,
} from "../negocio-do-contexto";
import type { McpContext, McpToolDefinition } from "../types";

const PROPOSTA_FORA_DA_CONVERSA = recusa(
  "fora_da_conversa",
  "esta conversa é com outra pessoa — uma proposta que não é deste cliente não é sua para enviar; " +
    "siga a conversa com quem está falando.",
);

const PROPOSTA_NAO_ENCONTRADA = recusa(
  "proposta_nao_encontrada",
  "não existe proposta com esse id nesta organização. Confira o id (é o da PROPOSTA); " +
    "`crm_get_proposal` com `lead_id` lista as propostas do negócio.",
);

const O_QUE_FALTA: Readonly<Record<PorQuePrecisaDeAprovacao, string>> = {
  aguardando_aprovacao: "a equipe ainda não aprovou este rascunho",
  editada_depois_de_aprovada: "a proposta foi alterada depois de aprovada, e a aprovação anterior não vale mais",
  item_fora_do_catalogo: "há item que não é do catálogo",
  preco_diferente_do_catalogo: "há item com preço diferente do catálogo",
  tem_desconto: "há desconto",
  condicao_fora_do_padrao: "há condição escrita que não é a condição padrão da empresa",
};

interface LinhaDaProposta {
  id: string;
  lead_id: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  status: string;
  valid_until: string | null;
  revision: number;
  moeda: string;
  condicoes: string | null;
  aprovada_em: string | null;
  aprovada_na_revisao: number | null;
}

/**
 * As travas de convivência: `null` = pode falar com este cliente agora.
 *
 * A regra mora em `lib/ai/equipe-pronta/gatilhos/travas.ts`, a MESMA que os
 * gatilhos da equipe usam (a proposta aprovada pela tela, por exemplo): a
 * ferramenta e o gatilho param nas mesmas condições.
 */
async function travaDeFalarComOCliente(
  ctx: McpContext,
  proposta: LinhaDaProposta,
): Promise<RecusaParaOAgente | null> {
  const resultado = await travasDeFalarComOCliente(ctx.supabase, {
    organizationId: ctx.organizationId,
    agentId: ctx.actor.type === "ai_agent" ? (ctx.actor.agent_id ?? null) : null,
    contactId: proposta.contact_id,
    conversationId: proposta.conversation_id,
  });
  if (resultado.trava === null) return null;
  if (resultado.trava.codigo === "consulta_indisponivel") return CONSULTA_INDISPONIVEL;
  if (resultado.trava.codigo === "contato_pessoal") return NEGOCIO_DE_CONTATO_PESSOAL;
  return recusa(resultado.trava.codigo, resultado.trava.mensagem);
}

const inputShape = {
  proposal_id: z.string().uuid().describe("A proposta em rascunho a enviar."),
};

export const crmSendProposal: McpToolDefinition<typeof inputShape> = {
  name: "crm_send_proposal",
  description:
    "ENVIA ao cliente, na conversa, a proposta em rascunho (o PDF). Fala com o cliente. A regra é da " +
    "empresa: ou só envia proposta que a equipe aprovou, ou envia sozinho quando todos os itens são do " +
    "catálogo, com preço do catálogo e sem desconto. Recusas: `precisa_aprovacao` (avise que está em " +
    "revisão e deixe tarefa para a equipe), `proposta_expirada` (prepare outra), `sem_canal`, " +
    "`modo_ensaio`, `humano_assumiu`, `contato_pediu_para_parar`, `equipe_pausada`. Só diga que enviou " +
    "com `enviada: true`.",
  inputSchema: inputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    if (!(await capacidadesDaOrganizacao(ctx.supabase, ctx.organizationId)).includes("propostas")) {
      return recusa("propostas_desligadas", "propostas estão desligadas nesta organização.");
    }

    const { data, error } = await ctx.supabase
      .from("crm_proposals")
      .select(
        "id, lead_id, contact_id, conversation_id, status, valid_until, revision, moeda, condicoes, aprovada_em, aprovada_na_revisao",
      )
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.proposal_id)
      .maybeSingle();
    if (error) return CONSULTA_INDISPONIVEL;
    const proposta = data as unknown as LinhaDaProposta | null;

    if (ctx.contatoDoTurno) {
      if (!proposta || proposta.contact_id?.toLowerCase() !== ctx.contatoDoTurno.toLowerCase()) {
        return PROPOSTA_FORA_DA_CONVERSA;
      }
    }
    if (!proposta) return PROPOSTA_NAO_ENCONTRADA;

    // ── o estado da proposta ──
    if (proposta.status === "vencida") {
      return recusa("proposta_expirada", "esta proposta venceu. Prepare uma nova, com validade nova.");
    }
    if (proposta.status !== "rascunho") {
      return recusa(
        proposta.status === "enviada" || proposta.status === "enviando" ? "proposta_ja_enviada" : "estado_invalido",
        `esta proposta está como "${proposta.status}" e não pode ser enviada. Só rascunho é enviado; ` +
          "para mudar uma proposta que já saiu, a equipe abre uma revisão.",
      );
    }
    if (proposta.valid_until) {
      const hoje = dataIsoNoFuso(new Date(), await fusoDaOrganizacao(ctx.supabase, ctx.organizationId));
      if (proposta.valid_until < hoje) {
        return recusa(
          "proposta_expirada",
          `a validade desta proposta terminou em ${proposta.valid_until}. Prepare uma nova, com validade nova.`,
        );
      }
    }

    // ── pode falar com este cliente agora? ──
    const trava = await travaDeFalarComOCliente(ctx, proposta);
    if (trava) return trava;

    // ── a regra de envio da empresa ──
    const { data: linhas, error: erroDosItens } = await ctx.supabase
      .from("crm_proposal_items")
      .select("descricao, product_id, preco_unitario_cents, desconto_cents")
      .eq("organization_id", ctx.organizationId)
      .eq("proposal_id", proposta.id);
    if (erroDosItens) return CONSULTA_INDISPONIVEL;
    const decisao = await agentePodeEnviarAProposta(
      ctx.supabase,
      ctx.organizationId,
      proposta,
      (linhas ?? []) as unknown as ItemParaDecidir[],
    );
    if (!decisao.pode) {
      return recusa(
        "precisa_aprovacao",
        `a equipe precisa aprovar esta proposta antes do envio: ${O_QUE_FALTA[decisao.porque]}` +
          `${decisao.item ? ` ("${decisao.item}")` : ""}. Diga à pessoa que a proposta está em revisão, ` +
          "deixe uma tarefa para a equipe aprovar e não diga que foi enviada.",
        { porque: decisao.porque, modo: decisao.modo },
      );
    }

    // ── envia: a mesma função da rota da tela ──
    const resultado = await enviarProposta(ctx.supabase, {
      orgId: ctx.organizationId,
      propostaId: proposta.id,
      requestId: ctx.requestId,
      quem: {
        actor: ctx.actor,
        userId: null,
        auditoria: (() => {
          const a = auditoriaDoContexto(ctx, { modo: decisao.modo, autorizada_por: decisao.por });
          return { actorApiTokenId: a.actorApiTokenId, metadata: a.metadata };
        })(),
      },
      t: (texto) => texto,
    });

    if (resultado.tipo === "recusa") {
      if (resultado.motivo === "sem_conversa") {
        return recusa("sem_canal", "não há conversa com este contato por onde enviar. Chame uma pessoa da equipe.");
      }
      if (resultado.motivo === "item_sem_preco") {
        return recusa(
          "item_sem_preco",
          `há item sem preço definido: ${(resultado.itens ?? []).join(", ")}. A proposta só sai com todos os preços definidos.`,
        );
      }
      return recusa(resultado.motivo, resultado.mensagem);
    }
    const linha = resultado.proposta as { status?: string; numero?: number | null; ano?: number | null; ultima_falha_envio?: string | null } | null;
    if (resultado.desfecho === "revertida") {
      return recusa(
        "envio_falhou",
        `o envio não saiu e a proposta continua em rascunho${linha?.ultima_falha_envio ? ` (${linha.ultima_falha_envio})` : ""}. ` +
          "Não diga que enviou; tente de novo mais tarde ou chame uma pessoa da equipe.",
      );
    }
    return {
      enviada: resultado.desfecho === "enviada",
      em_fila: resultado.desfecho === "em_fila",
      proposal_id: proposta.id,
      lead_id: proposta.lead_id,
      status: linha?.status ?? null,
      number: linha?.numero ?? null,
      year: linha?.ano ?? null,
      autorizada_por: decisao.por,
      ...(resultado.desfecho === "em_fila"
        ? { mensagem: "a proposta está na fila do canal e sai em instantes; não diga ainda que já chegou." }
        : {}),
    };
  },
};
