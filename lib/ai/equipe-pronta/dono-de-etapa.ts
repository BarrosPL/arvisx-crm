/**
 * DONO DE ETAPA E UM NEGÓCIO POR CONTATO — garantidos NA FERRAMENTA.
 *
 * O texto do papel diz a cada agente quais etapas são dele. Texto se esquece;
 * por isso a mesma regra é conferida aqui, no handler das ferramentas que
 * movem, criam e fecham negócio (`lib/mcp/tools/leads.ts` e `retencao.ts`) e no
 * espelho do motor (`lib/leads/agent-stage-sync.ts`).
 *
 * ⚠️ SÓ VALE PARA AGENTE DA EQUIPE PRONTA. Quem decide é a marca em
 * `ai_agents.config.equipe_pronta`, lida do cadastro pelo `agent_id` do ator —
 * nunca um argumento. Agente externo por token e agente nativo que a empresa
 * criou por conta própria não têm papel: toda função daqui devolve "segue" para
 * eles, e o comportamento das ferramentas não muda.
 *
 * ⚠️ LEITURA QUE FALHA = SEGUE. A mesma régua da trava de plano
 * (`lib/cobranca/equipe-pronta-no-plano.ts`): um banco que soluça não pode
 * travar o atendimento. A regra volta a valer na chamada seguinte.
 *
 * A organização vem sempre do contexto do ator. O cliente é service role:
 * toda consulta filtra `organization_id` à mão.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/lib/api/handlers/types";
import { negocioAbertoDoContato } from "@/lib/leads/negocio-aberto-do-contato";
import { CHAVE_DE_CONFIG } from "./constantes";
import {
  DEFINICOES_DAS_ETAPAS,
  chaveDaEtapa,
  mapaPelasMarcas,
  papelPodeCriarEm,
  papelPodeMover,
  type ChaveDeEtapa,
  type EtapaLida,
  type MapaDeEtapas,
  type VereditoDoMovimento,
} from "./etapas";
import { PAPEIS_DA_EQUIPE, type PapelId } from "./tipos";

interface Quem {
  supabase: SupabaseClient;
  organizationId: string;
  actor: Actor;
}

export interface RecusaDaEquipe {
  permitido: false;
  motivo: string;
  mensagem: string;
  /** O `papel` a informar em `passar_para_colega`, quando a saída é passar a vez. */
  passe_para?: string[];
}

/**
 * O nome da INTENÇÃO de cada papel no roteador — é o `papel` que
 * `passar_para_colega` espera. Repetido aqui (e conferido por teste contra o
 * catálogo de papéis) para as ferramentas não carregarem os textos dos papéis.
 */
export const INTENCAO_DO_PAPEL: Readonly<Record<PapelId, string>> = {
  sdr: "chegada_e_duvidas",
  agendamento: "agenda",
  proposta: "proposta",
  recuperador: "retomada",
};

/** O papel da Equipe pronta de quem age. `null` = não é agente da equipe. */
export async function papelDoAgenteDaEquipe(quem: Quem): Promise<PapelId | null> {
  if (quem.actor.type !== "ai_agent" || !quem.actor.agent_id) return null;
  try {
    const { data, error } = await quem.supabase
      .from("ai_agents")
      .select("config")
      .eq("organization_id", quem.organizationId)
      .eq("id", quem.actor.agent_id)
      .maybeSingle();
    if (error || !data) return null;
    const config = (data as { config?: unknown }).config;
    if (config === null || typeof config !== "object") return null;
    const marca = (config as Record<string, unknown>)[CHAVE_DE_CONFIG];
    if (marca === null || typeof marca !== "object") return null;
    const papel = (marca as Record<string, unknown>).papel;
    return typeof papel === "string" && (PAPEIS_DA_EQUIPE as readonly string[]).includes(papel)
      ? (papel as PapelId)
      : null;
  } catch {
    return null;
  }
}

export interface FunilDaEquipe {
  pipelineId: string;
  etapas: MapaDeEtapas;
}

/**
 * O funil da equipe e o mapeamento chave → etapa. Sem mapeamento gravado
 * (instalação anterior a ele), lê o que as marcas do funil já dizem.
 * `null` = a equipe não tem funil, ou a leitura falhou.
 */
export async function funilDaEquipe(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<FunilDaEquipe | null> {
  try {
    const { data, error } = await supabase
      .from("equipe_pronta_perfis")
      .select("instalacao")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error || !data) return null;
    const instalacao = (data as { instalacao?: unknown }).instalacao as
      | { pipeline_id?: unknown; etapas?: unknown }
      | null;
    if (!instalacao || typeof instalacao.pipeline_id !== "string") return null;
    const gravado =
      instalacao.etapas !== null && typeof instalacao.etapas === "object"
        ? (instalacao.etapas as Record<string, unknown>)
        : {};
    const etapas: MapaDeEtapas = {};
    for (const [chave, id] of Object.entries(gravado)) {
      if (chave in DEFINICOES_DAS_ETAPAS && typeof id === "string") etapas[chave as ChaveDeEtapa] = id;
    }
    if (Object.keys(etapas).length > 0) return { pipelineId: instalacao.pipeline_id, etapas };

    const lidas = await supabase
      .from("crm_stages")
      .select("id, name, agent_stage_hint, is_won, is_lost")
      .eq("organization_id", organizationId)
      .eq("pipeline_id", instalacao.pipeline_id)
      .eq("is_archived", false);
    if (lidas.error) return null;
    return {
      pipelineId: instalacao.pipeline_id,
      etapas: mapaPelasMarcas((lidas.data ?? []) as unknown as EtapaLida[]),
    };
  } catch {
    return null;
  }
}

/** A recusa que o modelo lê: o motivo em código e o que fazer em seguida. */
export function recusaDoMovimento(
  veredito: Extract<VereditoDoMovimento, { ok: false }>,
  destino: ChaveDeEtapa | null,
): RecusaDaEquipe {
  const passe = veredito.donos.map((p) => INTENCAO_DO_PAPEL[p]);
  const aQuem =
    passe.length > 0
      ? ` Passe a vez com \`passar_para_colega\` (papel: "${passe[0]}"), com o motivo e o resumo.`
      : "";
  if (veredito.motivo === "perda_sem_motivo") {
    return {
      permitido: false,
      motivo: veredito.motivo,
      mensagem:
        "marcar o negócio como perdido exige o motivo que a pessoa deu. Pergunte o motivo uma vez, " +
        "se ela ainda não disse, e informe-o ao marcar a perda.",
    };
  }
  if (veredito.motivo === "reabrir_e_da_retomada") {
    return {
      permitido: false,
      motivo: veredito.motivo,
      mensagem: `este negócio está como perdido, e reabrir é trabalho de quem cuida da retomada.${aQuem}`,
      passe_para: passe,
    };
  }
  const nome = destino ? DEFINICOES_DAS_ETAPAS[destino].nome : "essa";
  return {
    permitido: false,
    motivo: veredito.motivo,
    mensagem: `a etapa "${nome}" não é sua: quem move o negócio para ela é outro colega da equipe.${aQuem}`,
    passe_para: passe,
  };
}

/**
 * MOVER DE ETAPA. `null` = pode (ou quem age não é da equipe).
 *
 * Só vigia o funil da equipe: negócio em outro funil segue a regra de sempre.
 */
export async function conferirMovimentoDaEquipe(
  quem: Quem,
  alvo: { leadId: string; toStageId: string; temMotivoDaPerda: boolean },
): Promise<RecusaDaEquipe | null> {
  const papel = await papelDoAgenteDaEquipe(quem);
  if (papel === null) return null;
  const funil = await funilDaEquipe(quem.supabase, quem.organizationId);
  if (funil === null) return null;
  const lead = await negocioParaConferir(quem, alvo.leadId);
  if (lead === null || lead.pipeline_id !== funil.pipelineId) return null;

  const destino = chaveDaEtapa(funil.etapas, alvo.toStageId);
  const veredito = papelPodeMover({
    papel,
    destino,
    origem: chaveDaEtapa(funil.etapas, lead.stage_id),
    negocioPerdido: lead.status === "lost",
    temMotivoDaPerda: alvo.temMotivoDaPerda,
  });
  return veredito.ok ? null : recusaDoMovimento(veredito, destino);
}

/**
 * FECHAR O NEGÓCIO (ganho ou perdido). `null` = pode.
 *
 * O ganho é de quem cuida da proposta; a perda é de qualquer papel, com motivo.
 */
export async function conferirFechamentoDaEquipe(
  quem: Quem,
  alvo: { leadId: string; desfecho: "won" | "lost"; temMotivoDaPerda: boolean },
): Promise<RecusaDaEquipe | null> {
  const papel = await papelDoAgenteDaEquipe(quem);
  if (papel === null) return null;
  const funil = await funilDaEquipe(quem.supabase, quem.organizationId);
  if (funil === null) return null;
  const lead = await negocioParaConferir(quem, alvo.leadId);
  if (lead === null || lead.pipeline_id !== funil.pipelineId) return null;

  const destino: ChaveDeEtapa = alvo.desfecho === "won" ? "ganho" : "perdido";
  const veredito = papelPodeMover({
    papel,
    destino,
    origem: chaveDaEtapa(funil.etapas, lead.stage_id),
    negocioPerdido: lead.status === "lost",
    temMotivoDaPerda: alvo.temMotivoDaPerda,
  });
  return veredito.ok ? null : recusaDoMovimento(veredito, destino);
}

/** REABRIR como negócio novo (`crm_retomar_lead`): só quem cuida da retomada. */
export async function conferirReaberturaDaEquipe(quem: Quem): Promise<RecusaDaEquipe | null> {
  const papel = await papelDoAgenteDaEquipe(quem);
  if (papel === null || papel === "recuperador") return null;
  return recusaDoMovimento({ ok: false, motivo: "reabrir_e_da_retomada", donos: ["recuperador"] }, null);
}

export type VereditoDaCriacao =
  | { tipo: "segue" }
  | { tipo: "recusa"; recusa: RecusaDaEquipe }
  /** O contato já tem negócio aberto neste funil: é ele que a equipe usa. */
  | { tipo: "ja_existe"; leadId: string };

/**
 * CRIAR NEGÓCIO. Um negócio aberto por contato: se o contato já tem um aberto
 * no mesmo funil, a criação devolve o que existe em vez de abrir o segundo.
 */
export async function conferirCriacaoDaEquipe(
  quem: Quem,
  alvo: { pipelineId: string; stageId: string; contactId: string | null },
): Promise<VereditoDaCriacao> {
  const papel = await papelDoAgenteDaEquipe(quem);
  if (papel === null) return { tipo: "segue" };

  if (alvo.contactId) {
    const aberto = await negocioAbertoDoContato(
      quem.supabase,
      quem.organizationId,
      alvo.contactId,
      alvo.pipelineId,
    ).catch(() => null);
    if (aberto) return { tipo: "ja_existe", leadId: aberto.id };
  }

  const funil = await funilDaEquipe(quem.supabase, quem.organizationId);
  if (funil === null || funil.pipelineId !== alvo.pipelineId) return { tipo: "segue" };
  const destino = chaveDaEtapa(funil.etapas, alvo.stageId);
  const veredito = papelPodeCriarEm(papel, destino);
  return veredito.ok ? { tipo: "segue" } : { tipo: "recusa", recusa: recusaDoMovimento(veredito, destino) };
}

/**
 * O ESPELHO DO MOTOR pode levar o negócio a esta etapa? É a mesma regra, para o
 * caminho em que o agente avança o próprio estado e o card anda junto
 * (`sincronizaEstagioDoAgente`). O espelho nunca leva motivo de perda.
 */
export async function espelhoPodeMoverPara(
  quem: Quem,
  alvo: { pipelineId: string; fromStageId: string; toStageId: string },
): Promise<boolean> {
  const papel = await papelDoAgenteDaEquipe(quem);
  if (papel === null) return true;
  const funil = await funilDaEquipe(quem.supabase, quem.organizationId);
  if (funil === null || funil.pipelineId !== alvo.pipelineId) return true;
  const destino = chaveDaEtapa(funil.etapas, alvo.toStageId);
  // A perda segue com a regra do próprio espelho (`perda_sem_motivo`), que avisa a equipe.
  if (destino === "perdido") return true;
  return papelPodeMover({
    papel,
    destino,
    origem: chaveDaEtapa(funil.etapas, alvo.fromStageId),
    negocioPerdido: false,
    temMotivoDaPerda: false,
  }).ok;
}

async function negocioParaConferir(
  quem: Quem,
  leadId: string,
): Promise<{ pipeline_id: string; stage_id: string | null; status: string } | null> {
  try {
    const { data, error } = await quem.supabase
      .from("crm_leads")
      .select("pipeline_id, stage_id, status")
      .eq("organization_id", quem.organizationId)
      .eq("id", leadId)
      .maybeSingle();
    if (error || !data) return null;
    return data as { pipeline_id: string; stage_id: string | null; status: string };
  } catch {
    return null;
  }
}
