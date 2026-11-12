/**
 * O CONTEXTO DO ONBOARDING — a leitura única de "o que esta empresa encontra pela frente".
 *
 * O roteiro do wizard era o MESMO para todos os planos: só variava pela
 * integração de loja. Ele é inteiro sobre montar um "funcionário" de IA, e o
 * plano Essencial não tem IA — a pessoa colava uma chave, criava um agente que
 * nunca respondia (`planoIncluiIaParaOMotor` = false) e batia em 403 no ensaio.
 *
 * "Tem IA" é a MESMA leitura que já trava as telas e o motor
 * (`leituraDoPlanoDaOrg` + o grupo `ia` do catálogo), e não uma segunda régua.
 *
 * ⚠️ DECISÃO DE FALHA, igual à do motor (`planoIncluiIaParaOMotor`): leitura
 * que não respondeu = COM IA, o roteiro de sempre. Um Premium não pode perder os
 * passos de IA porque uma leitura oscilou; o pior caso do outro lado é um
 * Essencial ver, numa falha rara, os passos que a trava de servidor ainda recusa.
 *
 * Nada aqui lança.
 */
import { leituraDoPlanoDaOrg } from "@/lib/cobranca/leitura-do-plano";
import { planoIncluiIaParaOMotor } from "@/lib/cobranca/telas-do-plano";
import { env } from "@/lib/env";
import type { ContextoDoPasso } from "./passos";

/** O que as actions de IA do onboarding respondem a quem não tem IA no plano. */
export const MENSAGEM_IA_FORA_DO_PLANO = "Os agentes de IA estão no Standard e no Premium.";

/** O plano desta empresa inclui os agentes de IA? Falha de leitura = sim. */
export async function iaNoPlanoDaOrg(orgId: string): Promise<boolean> {
  try {
    return planoIncluiIaParaOMotor(await leituraDoPlanoDaOrg(orgId));
  } catch {
    return true;
  }
}

/** O contexto que o roteador, o indicador e o resumo do wizard recebem. */
export async function contextoDoOnboarding(orgId: string): Promise<ContextoDoPasso> {
  return { lojaLigada: env.NUVEMSHOP_ENABLED, iaNoPlano: await iaNoPlanoDaOrg(orgId) };
}
