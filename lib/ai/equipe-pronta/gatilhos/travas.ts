/**
 * AS TRAVAS DE FALAR COM O CLIENTE — as mesmas para a ferramenta e para o gatilho.
 *
 * Nasceram dentro de `crm_send_proposal` (`lib/mcp/tools/envio-de-proposta.ts`)
 * e saíram para cá sem mudar de regra: o gatilho que age sem o cliente escrever
 * (a proposta aprovada pela equipe, a resposta ao lembrete, o negócio ganho)
 * precisa parar nas mesmas condições em que a ferramenta para. Regra escrita
 * duas vezes diverge no primeiro ajuste, e a divergência aqui é uma mensagem
 * saindo para quem pediu para parar.
 *
 * O que trava, antes de qualquer efeito:
 *
 *   • `equipe_pausada`           — o agente está pausado, ou a equipe foi pausada pela tela;
 *   • `fora_do_plano`            — o plano da empresa não libera a Equipe pronta;
 *   • `contato_pediu_para_parar` — o contato bloqueou o atendimento (opt-out);
 *   • `humano_assumiu`           — uma pessoa assumiu a conversa, ou o contato é de atendimento humano;
 *   • `modo_ensaio`              — o canal está em ensaio e este número não é de teste;
 *   • `sem_canal`                — não há contato, conversa ou canal conectado por onde falar.
 *
 * A janela e o horário do canal NÃO estão aqui de propósito: quem os confere é
 * o envio (`enviarProposta` recusa `fora_da_janela`; o motor de follow-up adia
 * o passo até a janela abrir). Conferir de novo aqui criaria a segunda régua.
 *
 * A organização vem sempre de quem chama, de fonte confiável. O cliente é de
 * serviço: toda consulta filtra `organization_id` à mão.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { decidirPreGoLiveDoCanalViaSupabase } from "@/lib/ai/elegibilidade/consulta-pre-go-live";
import { planoLiberaAEquipePronta } from "@/lib/cobranca/equipe-pronta-no-plano";
import { instalacaoSchema, type InstalacaoDaEquipe } from "@/lib/schemas/equipe-pronta";
import { CHAVE_DE_CONFIG } from "../constantes";

export type CodigoDaTrava =
  | "equipe_pausada"
  | "fora_do_plano"
  | "contato_pediu_para_parar"
  | "contato_pessoal"
  | "humano_assumiu"
  | "modo_ensaio"
  | "sem_canal"
  | "consulta_indisponivel";

export interface Trava {
  codigo: CodigoDaTrava;
  /** Escrita para o agente ler. Quem fala com uma pessoa escreve a própria frase. */
  mensagem: string;
}

const trava = (codigo: CodigoDaTrava, mensagem: string): Trava => ({ codigo, mensagem });

const CONSULTA_INDISPONIVEL = trava(
  "consulta_indisponivel",
  "a consulta ao CRM falhou agora. Nada foi feito; tente de novo em instantes.",
);

/** A equipe instalada de uma organização. `null` = não há equipe instalada. */
export interface EquipeInstalada {
  modo: "ensaio" | "ativo";
  instalacao: InstalacaoDaEquipe;
  respostas: unknown;
}

/**
 * Lê a equipe instalada. Lança quando a leitura falha: quem chama decide se a
 * falha trava (gatilho que fala com o cliente) ou segue (leitura de tela).
 */
export async function lerEquipeInstalada(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<EquipeInstalada | null> {
  const { data, error } = await supabase
    .from("equipe_pronta_perfis")
    .select("estado, modo, instalacao, respostas")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error(`equipe_pronta: leitura do perfil falhou: ${error.message}`);
  const linha = data as { estado?: string; modo?: string; instalacao?: unknown; respostas?: unknown } | null;
  if (!linha || linha.estado !== "instalado") return null;
  const lida = instalacaoSchema.safeParse(linha.instalacao ?? {});
  if (!lida.success) return null;
  return { modo: linha.modo === "ativo" ? "ativo" : "ensaio", instalacao: lida.data, respostas: linha.respostas };
}

/**
 * A EQUIPE pode agir agora? Plano e pausa, as duas travas que não dependem do
 * cliente. `null` = pode.
 */
export async function travaDaEquipe(
  supabase: SupabaseClient,
  organizationId: string,
  equipe: Pick<EquipeInstalada, "instalacao">,
): Promise<Trava | null> {
  if (equipe.instalacao.pausa) {
    return trava("equipe_pausada", "a equipe está pausada: nada é enviado ao cliente enquanto a pausa durar.");
  }
  if (!(await planoLiberaAEquipePronta(supabase, organizationId))) {
    return trava("fora_do_plano", "o plano desta empresa não inclui a equipe de IA: nada é enviado.");
  }
  return null;
}

export interface ConversaDoEnvio {
  id: string;
  channel_session_id: string;
}

export type ResultadoDasTravas =
  | { trava: Trava }
  | { trava: null; conversa: ConversaDoEnvio; telefone: string };

/**
 * Pode falar com ESTE cliente agora, em nome DESTE agente?
 *
 * `agentId` ausente = quem age não é um agente do cadastro (token de fora): as
 * travas do agente e da equipe não se aplicam, as do cliente sim.
 * `conversationId` é a conversa preferida (a que originou a proposta, a do
 * compromisso); sem ela vale a mais recente do contato — a mesma escolha de
 * `enviarProposta`.
 */
export async function travasDeFalarComOCliente(
  supabase: SupabaseClient,
  entrada: {
    organizationId: string;
    agentId?: string | null;
    contactId: string | null;
    conversationId?: string | null;
  },
): Promise<ResultadoDasTravas> {
  const { organizationId, agentId, contactId } = entrada;

  // ── quem envia está pausado, ou fora do plano? ──
  if (agentId) {
    const { data: agente, error } = await supabase
      .from("ai_agents")
      .select("paused_at, archived_at, config")
      .eq("organization_id", organizationId)
      .eq("id", agentId)
      .maybeSingle();
    if (error) return { trava: CONSULTA_INDISPONIVEL };
    const a = agente as { paused_at?: string | null; archived_at?: string | null; config?: unknown } | null;
    if (!a || a.paused_at || a.archived_at) {
      return {
        trava: trava("equipe_pausada", "este agente está pausado: nada é enviado ao cliente enquanto a pausa durar."),
      };
    }
    const daEquipe =
      a.config !== null && typeof a.config === "object" && CHAVE_DE_CONFIG in (a.config as Record<string, unknown>);
    if (daEquipe) {
      const { data: perfil, error: erroDoPerfil } = await supabase
        .from("equipe_pronta_perfis")
        .select("instalacao")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (erroDoPerfil) return { trava: CONSULTA_INDISPONIVEL };
      const instalacao = (perfil as { instalacao?: { pausa?: unknown } | null } | null)?.instalacao;
      if (instalacao?.pausa) {
        return {
          trava: trava("equipe_pausada", "a equipe está pausada: nada é enviado ao cliente enquanto a pausa durar."),
        };
      }
      if (!(await planoLiberaAEquipePronta(supabase, organizationId))) {
        return { trava: trava("fora_do_plano", "o plano desta empresa não inclui a equipe de IA: nada é enviado.") };
      }
    }
  }

  if (!contactId) {
    return {
      trava: trava("sem_canal", "não há contato ligado: não há para quem enviar. Chame uma pessoa da equipe."),
    };
  }

  // ── o contato: opt-out e atendimento humano ──
  const { data: contato, error: erroDoContato } = await supabase
    .from("contacts")
    .select("is_blocked, is_personal, force_human, ai_opt_out, phone_number")
    .eq("organization_id", organizationId)
    .eq("id", contactId)
    .maybeSingle();
  if (erroDoContato) return { trava: CONSULTA_INDISPONIVEL };
  const c = contato as {
    is_blocked?: boolean;
    is_personal?: boolean;
    force_human?: boolean;
    ai_opt_out?: boolean;
    phone_number?: string | null;
  } | null;
  if (!c) return { trava: trava("sem_canal", "o contato não existe mais. Chame uma pessoa da equipe.") };
  if (c.is_personal === true) {
    return { trava: trava("contato_pessoal", "este contato é pessoal: a equipe de IA não age sobre ele.") };
  }
  if (c.is_blocked === true) {
    return {
      trava: trava(
        "contato_pediu_para_parar",
        "esta pessoa pediu para não receber mensagens: nada é enviado a ela. Não insista.",
      ),
    };
  }
  if (c.force_human === true || c.ai_opt_out === true) {
    return {
      trava: trava("humano_assumiu", "o atendimento desta pessoa é feito pela equipe: quem fala com ela é uma pessoa."),
    };
  }

  // ── a conversa por onde a mensagem sai: a mesma escolha de `enviarProposta` ──
  const colunas = "id, channel_session_id, bot_silenced_until";
  const { data: conversa, error: erroDaConversa } = entrada.conversationId
    ? await supabase
        .from("conversations")
        .select(colunas)
        .eq("organization_id", organizationId)
        .eq("id", entrada.conversationId)
        .eq("contact_id", contactId)
        .maybeSingle()
    : await supabase
        .from("conversations")
        .select(colunas)
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
  if (erroDaConversa) return { trava: CONSULTA_INDISPONIVEL };
  const conv = conversa as { id: string; channel_session_id: string; bot_silenced_until: string | null } | null;
  if (!conv) {
    return {
      trava: trava("sem_canal", "não há conversa com este contato por onde enviar. Chame uma pessoa da equipe."),
    };
  }

  // Uma pessoa assumiu (ou respondeu há pouco) em QUALQUER conversa do contato:
  // a mesma leitura de `isLeadInHandoff`, do motor.
  const { data: silenciadas, error: erroDoSilencio } = await supabase
    .from("conversations")
    .select("bot_silenced_until")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId);
  if (erroDoSilencio) return { trava: CONSULTA_INDISPONIVEL };
  const agora = Date.now();
  const assumida = ((silenciadas ?? []) as Array<{ bot_silenced_until: string | null }>).some(
    (s) =>
      s.bot_silenced_until === "infinity" ||
      (s.bot_silenced_until !== null && new Date(s.bot_silenced_until).getTime() > agora),
  );
  if (assumida) {
    return {
      trava: trava(
        "humano_assumiu",
        "uma pessoa da equipe assumiu esta conversa: você não envia por cima dela. Deixe para ela enviar.",
      ),
    };
  }

  // ── o canal: conectado, e fora do ensaio para este número ──
  const { data: canal, error: erroDoCanal } = await supabase
    .from("channel_sessions")
    .select("status, archived_at")
    .eq("organization_id", organizationId)
    .eq("id", conv.channel_session_id)
    .maybeSingle();
  if (erroDoCanal) return { trava: CONSULTA_INDISPONIVEL };
  const sessao = canal as { status?: string; archived_at?: string | null } | null;
  if (!sessao || sessao.archived_at || sessao.status !== "WORKING") {
    return {
      trava: trava(
        "sem_canal",
        "o canal desta conversa não está conectado: não há por onde enviar. Chame uma pessoa da equipe.",
      ),
    };
  }
  try {
    const acesso = await decidirPreGoLiveDoCanalViaSupabase(supabase, {
      organizationId,
      channelSessionId: conv.channel_session_id,
      contactPhoneNumber: c.phone_number ?? "",
    });
    if (!acesso.permite) {
      return {
        trava: trava(
          "modo_ensaio",
          "o canal está em ensaio e este número não é um dos números de teste: nada é enviado a ele.",
        ),
      };
    }
  } catch {
    return { trava: CONSULTA_INDISPONIVEL };
  }
  return {
    trava: null,
    conversa: { id: conv.id, channel_session_id: conv.channel_session_id },
    telefone: c.phone_number ?? "",
  };
}
