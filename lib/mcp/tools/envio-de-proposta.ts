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
 * A ferramenta passa a `revision` que ela julgou (`revisaoEsperada`): o envio
 * só entra em `enviando` se o rascunho ainda estiver nessa revisão e ainda for
 * rascunho. Proposta editada no meio do caminho, ou dois turnos pedindo o
 * mesmo envio ao mesmo tempo, terminam em `proposta_mudou` para quem perdeu, e
 * a proposta sai uma vez só.
 *
 * `organization_id` SEMPRE do contexto. Num turno de atendimento, só proposta
 * do cliente da conversa; proposta de outro cliente e proposta inexistente
 * recebem a mesma recusa.
 */
import { z } from "zod";

import { CHAVE_DE_CONFIG } from "@/lib/ai/equipe-pronta/constantes";
import { decidirPreGoLiveDoCanalViaSupabase } from "@/lib/ai/elegibilidade/consulta-pre-go-live";
import { planoLiberaAEquipeProntaSeLido } from "@/lib/cobranca/equipe-pronta-no-plano";
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

/** As travas de convivência: `null` = pode falar com este cliente agora. */
async function travaDeFalarComOCliente(
  ctx: McpContext,
  proposta: LinhaDaProposta,
): Promise<RecusaParaOAgente | null> {
  // ── quem envia está pausado, ou fora do plano? ──
  const agentId = ctx.actor.type === "ai_agent" ? ctx.actor.agent_id : undefined;
  if (agentId) {
    const { data: agente, error } = await ctx.supabase
      .from("ai_agents")
      // `config` vem na MESMA leitura da pausa: é dela que sai "este agente é
      // da Equipe pronta?", que decide as travas de pausa da equipe e de plano.
      // Uma segunda leitura que falhasse em silêncio (`papelDoAgenteDaEquipe`
      // devolve "não é da equipe" no erro) fazia a ferramenta pular as duas e
      // falar com o cliente (revisão de 20/11, item 2.2). Aqui, leitura que
      // falha é recusa.
      .select("paused_at, archived_at, config")
      .eq("organization_id", ctx.organizationId)
      .eq("id", agentId)
      .maybeSingle();
    if (error) return CONSULTA_INDISPONIVEL;
    const a = agente as { paused_at?: string | null; archived_at?: string | null; config?: unknown } | null;
    if (!a || a.paused_at || a.archived_at) {
      return recusa("equipe_pausada", "este agente está pausado: nada é enviado ao cliente enquanto a pausa durar.");
    }
    // Marcado como da equipe = a chave existe na config, qualquer que seja o
    // papel escrito nela: marca com papel ilegível ainda é agente da equipe.
    const daEquipe =
      a.config !== null && typeof a.config === "object" && CHAVE_DE_CONFIG in (a.config as Record<string, unknown>);
    if (daEquipe) {
      const { data: perfil, error: erroDoPerfil } = await ctx.supabase
        .from("equipe_pronta_perfis")
        .select("instalacao")
        .eq("organization_id", ctx.organizationId)
        .maybeSingle();
      if (erroDoPerfil) return CONSULTA_INDISPONIVEL;
      const instalacao = (perfil as { instalacao?: { pausa?: unknown } | null } | null)?.instalacao;
      if (instalacao?.pausa) {
        return recusa("equipe_pausada", "a equipe está pausada: nada é enviado ao cliente enquanto a pausa durar.");
      }
      // Plano que não pôde ser lido NÃO é plano que libera: falha fechada.
      const liberado = await planoLiberaAEquipeProntaSeLido(ctx.supabase, ctx.organizationId);
      if (liberado === null) return CONSULTA_INDISPONIVEL;
      if (!liberado) {
        return recusa("fora_do_plano", "o plano desta empresa não inclui a equipe de IA: nada é enviado.");
      }
    }
  }

  if (!proposta.contact_id) {
    return recusa("sem_canal", "esta proposta não tem contato ligado: não há para quem enviar. Chame uma pessoa da equipe.");
  }

  // ── o contato: opt-out e atendimento humano ──
  const { data: contato, error: erroDoContato } = await ctx.supabase
    .from("contacts")
    .select("is_blocked, is_personal, force_human, ai_opt_out, phone_number")
    .eq("organization_id", ctx.organizationId)
    .eq("id", proposta.contact_id)
    .maybeSingle();
  if (erroDoContato) return CONSULTA_INDISPONIVEL;
  const c = contato as {
    is_blocked?: boolean;
    is_personal?: boolean;
    force_human?: boolean;
    ai_opt_out?: boolean;
    phone_number?: string | null;
  } | null;
  if (!c) return recusa("sem_canal", "o contato desta proposta não existe mais. Chame uma pessoa da equipe.");
  if (c.is_personal === true) return NEGOCIO_DE_CONTATO_PESSOAL;
  if (c.is_blocked === true) {
    return recusa(
      "contato_pediu_para_parar",
      "esta pessoa pediu para não receber mensagens: nada é enviado a ela. Não insista.",
    );
  }
  if (c.force_human === true || c.ai_opt_out === true) {
    return recusa("humano_assumiu", "o atendimento desta pessoa é feito pela equipe: quem envia a proposta é uma pessoa.");
  }

  // ── a conversa por onde a proposta sai: a mesma escolha de `enviarProposta` ──
  const colunas = "id, channel_session_id, bot_silenced_until";
  const { data: conversa, error: erroDaConversa } = proposta.conversation_id
    ? await ctx.supabase
        .from("conversations")
        .select(colunas)
        .eq("organization_id", ctx.organizationId)
        .eq("id", proposta.conversation_id)
        .eq("contact_id", proposta.contact_id)
        .maybeSingle()
    : await ctx.supabase
        .from("conversations")
        .select(colunas)
        .eq("organization_id", ctx.organizationId)
        .eq("contact_id", proposta.contact_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
  if (erroDaConversa) return CONSULTA_INDISPONIVEL;
  const conv = conversa as { id: string; channel_session_id: string; bot_silenced_until: string | null } | null;
  if (!conv) {
    return recusa("sem_canal", "não há conversa com este contato por onde enviar a proposta. Chame uma pessoa da equipe.");
  }

  // Uma pessoa assumiu (ou respondeu há pouco) em QUALQUER conversa do contato:
  // a mesma leitura de `isLeadInHandoff`, do motor.
  const { data: silenciadas, error: erroDoSilencio } = await ctx.supabase
    .from("conversations")
    .select("bot_silenced_until")
    .eq("organization_id", ctx.organizationId)
    .eq("contact_id", proposta.contact_id);
  if (erroDoSilencio) return CONSULTA_INDISPONIVEL;
  const agora = Date.now();
  const assumida = ((silenciadas ?? []) as Array<{ bot_silenced_until: string | null }>).some(
    (s) => s.bot_silenced_until === "infinity" || (s.bot_silenced_until !== null && new Date(s.bot_silenced_until).getTime() > agora),
  );
  if (assumida) {
    return recusa(
      "humano_assumiu",
      "uma pessoa da equipe assumiu esta conversa: você não envia por cima dela. Deixe a proposta para ela enviar.",
    );
  }

  // ── o canal: conectado, e fora do ensaio para este número ──
  const { data: canal, error: erroDoCanal } = await ctx.supabase
    .from("channel_sessions")
    .select("status, archived_at")
    .eq("organization_id", ctx.organizationId)
    .eq("id", conv.channel_session_id)
    .maybeSingle();
  if (erroDoCanal) return CONSULTA_INDISPONIVEL;
  const sessao = canal as { status?: string; archived_at?: string | null } | null;
  if (!sessao || sessao.archived_at || sessao.status !== "WORKING") {
    return recusa(
      "sem_canal",
      "o canal desta conversa não está conectado: a proposta não tem por onde sair. Chame uma pessoa da equipe.",
    );
  }
  try {
    const acesso = await decidirPreGoLiveDoCanalViaSupabase(ctx.supabase, {
      organizationId: ctx.organizationId,
      channelSessionId: conv.channel_session_id,
      contactPhoneNumber: c.phone_number ?? "",
    });
    if (!acesso.permite) {
      return recusa(
        "modo_ensaio",
        "o canal está em ensaio e este número não é um dos números de teste: nada é enviado a ele.",
      );
    }
  } catch {
    return CONSULTA_INDISPONIVEL;
  }
  return null;
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
    "`modo_ensaio`, `humano_assumiu`, `contato_pediu_para_parar`, `equipe_pausada`, `proposta_mudou` " +
    "(foi editada ou já está sendo enviada: consulte antes de repetir). Só diga que enviou " +
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
      // A revisão que as regras acima julgaram (a aprovada, ou a que a regra do
      // envio direto conferiu item a item). Se o rascunho for editado entre a
      // leitura e o envio, ou se outro turno já estiver enviando, nada sai.
      revisaoEsperada: Number(proposta.revision),
    });

    if (resultado.tipo === "recusa") {
      if (resultado.motivo === "mudou") {
        return recusa(
          "proposta_mudou",
          "a proposta foi alterada depois de conferida, ou outro pedido já está enviando esta mesma proposta: " +
            "nada saiu por esta chamada. Consulte a proposta (`crm_get_proposal`) para saber o estado dela antes " +
            "de dizer qualquer coisa à pessoa; não repita o envio às cegas.",
        );
      }
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
