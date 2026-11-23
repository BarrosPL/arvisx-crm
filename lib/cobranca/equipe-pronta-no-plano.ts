/**
 * A EQUIPE DE IA PRONTA É DO PLANO QUE LIBERA A TELA DELA (ArvisX, migration 9808).
 *
 * A trava de TELA e de API já sai do mapa (`telas-do-plano.ts`,
 * `rotas-do-plano.ts`). Este arquivo é a terceira ponta, a do MOTOR: agente
 * instalado pela equipe pronta não responde nem dispara follow-up quando o
 * plano da empresa não libera `/app/ai/equipe-pronta`.
 *
 * ═══ O que isto é, e o que não é ═══
 *
 * É PAUSA, não desinstalação. Rebaixar o plano não apaga nem despublica nada:
 * agentes, roteador, base, régua e respostas ficam como estão, e voltar ao
 * plano que libera a tela faz tudo voltar a funcionar sem reinstalar. A
 * pergunta é feita a cada turno e a cada tique, contra o plano de AGORA.
 *
 * Só alcança o agente MARCADO (`ai_agents.config.equipe_pronta`). O agente que
 * o cliente criou por conta própria segue a regra de sempre — a do grupo `ia`
 * (`motorPodeResponderPeloPlano`), que este arquivo não substitui.
 *
 * ═══ Falha de leitura = segue ═══
 *
 * A mesma régua de `planoLiberaParaCron`: se o plano não pôde ser lido, o
 * motor segue. Um banco que soluça não pode calar o atendimento de uma empresa
 * que paga pelo plano. E se a MARCA do agente não pôde ser lida, idem: na
 * dúvida, o agente é tratado como um agente comum.
 */
import type pg from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CHAVE_DE_CONFIG, DESTINO_DA_EQUIPE_PRONTA } from "@/lib/ai/equipe-pronta/constantes";
import { cronPodeRodarPeloPlano } from "./plano-no-motor";
import { lerTelasDoPlano, planoLiberaParaCron } from "./telas-do-plano";

type ComQuery = Pick<pg.Pool, "query">;

/** O motivo gravado quando uma inscrição de follow-up é adiada por esta trava. */
export const ERRO_DA_EQUIPE_FORA_DO_PLANO = `fora_do_plano:${DESTINO_DA_EQUIPE_PRONTA}`;

/**
 * Este agente pode agir neste turno, pelo plano?
 *
 * `true` para todo agente que NÃO é da equipe pronta — a pergunta não é dele.
 */
export async function agenteDaEquipeProntaPodeAgir(
  pool: ComQuery,
  orgId: string,
  agentId: string,
): Promise<boolean> {
  let marcado: boolean;
  try {
    const r = await pool.query<{ marcado: boolean }>(
      "select (config ? $3) as marcado from ai_agents where organization_id=$1 and id=$2",
      [orgId, agentId, CHAVE_DE_CONFIG],
    );
    marcado = (r as { rows?: Array<{ marcado?: boolean }> } | undefined)?.rows?.[0]?.marcado === true;
  } catch {
    return true;
  }
  if (!marcado) return true;
  return cronPodeRodarPeloPlano(pool, orgId, DESTINO_DA_EQUIPE_PRONTA);
}

/** O plano desta empresa libera a equipe pronta? Falha de leitura = sim. */
export async function planoLiberaAEquipePronta(admin: SupabaseClient, orgId: string): Promise<boolean> {
  return planoLiberaParaCron(await lerTelasDoPlano(admin, orgId), DESTINO_DA_EQUIPE_PRONTA);
}

/**
 * A mesma pergunta, para a ação que FALA COM O CLIENTE: aqui a falha de
 * leitura não vira "sim". `null` = o plano não pôde ser lido, e quem chama
 * recusa (falha fechada). "Leitura falha = segue" é a régua do motor que
 * responde e do follow-up; não a da ferramenta que envia uma proposta
 * (revisão de 20/11, item 2.2).
 */
export async function planoLiberaAEquipeProntaSeLido(admin: SupabaseClient, orgId: string): Promise<boolean | null> {
  const leitura = await lerTelasDoPlano(admin, orgId);
  if (leitura.tipo === "falha") return null;
  return planoLiberaParaCron(leitura, DESTINO_DA_EQUIPE_PRONTA);
}

/**
 * Dos agentes dados, quais NÃO podem agir pelo plano: os da equipe pronta,
 * quando o plano não libera a tela dela. Vazio quando o plano libera, quando
 * nenhum é da equipe, ou quando a leitura falha.
 */
export async function agentesDaEquipeForaDoPlano(
  admin: SupabaseClient,
  orgId: string,
  agentIds: readonly string[],
): Promise<Set<string>> {
  if (agentIds.length === 0) return new Set();
  // ⚠️ O `try` cobre a leitura que LANÇA, não só a que devolve `error`: este
  // filtro roda dentro do portão de follow-up de TODA empresa, e uma exceção
  // aqui derrubaria o follow-up de quem nem tem equipe pronta.
  try {
    const { data, error } = await admin
      .from("ai_agents")
      .select("id, config")
      .eq("organization_id", orgId)
      .in("id", [...agentIds]);
    if (error) return new Set();
    const daEquipe = (data ?? [])
      .filter((a) => {
        const config = a.config as Record<string, unknown> | null;
        return config !== null && typeof config === "object" && CHAVE_DE_CONFIG in config;
      })
      .map((a) => String(a.id));
    if (daEquipe.length === 0) return new Set();
    return (await planoLiberaAEquipePronta(admin, orgId)) ? new Set() : new Set(daEquipe);
  } catch {
    return new Set();
  }
}

/**
 * Este fluxo de follow-up é um dos fluxos da equipe pronta (a régua de silêncio
 * ou um dos fluxos dos gatilhos) de uma empresa cujo plano não a libera? É o
 * que adia a inscrição que já estava em andamento quando o plano mudou, e a
 * que um gatilho criou depois dele.
 */
export async function reguaDaEquipeForaDoPlano(
  admin: SupabaseClient,
  orgId: string,
  pointerId: string,
): Promise<boolean> {
  // Leitura que lança = nada é adiado (a mesma régua da função acima).
  try {
    const { data, error } = await admin
      .from("equipe_pronta_perfis")
      .select("instalacao")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (error || !data) return false;
    // A régua de silêncio e os dois fluxos dos gatilhos (faltou ao compromisso,
    // proposta parada): os três são da equipe, e os três param com o plano.
    const instalacao = data.instalacao as {
      followup_flow_pointer_id?: unknown;
      gatilhos?: { fluxo_de_falta_id?: unknown; fluxo_de_proposta_parada_id?: unknown } | null;
    } | null;
    const daEquipe = [
      instalacao?.followup_flow_pointer_id,
      instalacao?.gatilhos?.fluxo_de_falta_id,
      instalacao?.gatilhos?.fluxo_de_proposta_parada_id,
    ];
    if (!daEquipe.includes(pointerId)) return false;
    return !(await planoLiberaAEquipePronta(admin, orgId));
  } catch {
    return false;
  }
}
