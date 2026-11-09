/**
 * O PLANO NO MOTOR DE IA E NOS CRONS (ArvisX, telas do plano — migration 9802).
 *
 * O motor (`lib/agent-engine`) e os workers falam `pg` puro, sem cliente
 * Supabase; esta é a mesma régua de lib/cobranca/telas-do-plano.ts, lida pela
 * MESMA função do banco (`fn_telas_do_plano`), por um `query` qualquer.
 *
 * Plano sem o grupo `ia`: o motor não responde nem dispara follow-up. Os
 * agentes ficam como estão (desligados pelo plano, não apagados nem pausados):
 * ao reassinar, voltam sozinhos. A conversa segue o caminho de quando não há
 * agente que atenda — o evento é consumido sem turno e a distribuição humana
 * (`runRoutingWorker`, que não olha a IA) a leva à fila de pessoas. A mensagem
 * do cliente já está gravada: webhooks de entrada e gravação nunca passam aqui.
 *
 * Falha de leitura: o motor SEGUE (ver `planoIncluiIaParaOMotor`).
 */
import type pg from "pg";

import { leituraDaResposta, planoIncluiIaParaOMotor, planoLiberaParaCron, type LeituraDoPlano } from "./telas-do-plano";

type ComQuery = Pick<pg.Pool, "query">;

/** Lê o plano pelo `pg`. Nunca lança: erro vira `falha`. */
export async function lerPlanoPeloPool(pool: ComQuery, orgId: string): Promise<LeituraDoPlano> {
  try {
    const r = await pool.query<{ plano: unknown }>("select public.fn_telas_do_plano($1) as plano", [orgId]);
    const linha = (r as { rows?: Array<{ plano?: unknown }> } | undefined)?.rows?.[0];
    if (!linha || !("plano" in linha)) return { tipo: "falha" };
    return leituraDaResposta(linha.plano ?? null, null);
  } catch {
    return { tipo: "falha" };
  }
}

/** O motor de IA pode responder/disparar para esta empresa? Falha = sim. */
export async function motorPodeResponderPeloPlano(pool: ComQuery, orgId: string): Promise<boolean> {
  return planoIncluiIaParaOMotor(await lerPlanoPeloPool(pool, orgId));
}

/** Um cron que roda a função desta tela pode rodar para esta empresa? Falha = sim. */
export async function cronPodeRodarPeloPlano(pool: ComQuery, orgId: string, destino: string): Promise<boolean> {
  return planoLiberaParaCron(await lerPlanoPeloPool(pool, orgId), destino);
}
