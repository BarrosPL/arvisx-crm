import { describe, expect, it, vi } from "vitest";
import type pg from "pg";

import { drainTick } from "@/lib/agent-engine/edge/crm/drain";
import { cronPodeRodarPeloPlano, motorPodeResponderPeloPlano } from "@/lib/cobranca/plano-no-motor";
import { ADIAMENTO_FORA_DO_PLANO_MS, runFollowupTick, type AdminClient } from "@/lib/followup/engine";

/**
 * O MOTOR DE IA E OS CRONS respeitam as telas do plano (migration 9802).
 *
 * Plano sem o grupo `ia`: o drain consome o evento SEM turno — o mesmo desfecho
 * de "nenhum agente atende" —, e a conversa fica para a distribuição humana; o
 * follow-up é ADIADO, nunca cancelado. Os agentes não são tocados (nenhum
 * UPDATE em agente). Falha de leitura: o motor segue.
 */

const { acordarLacoDeEventLog } = vi.hoisted(() => ({ acordarLacoDeEventLog: vi.fn() }));
vi.mock("@/lib/event-log/sinal-de-trabalho", () => ({ acordarLacoDeEventLog }));

const ESSENCIAL = { restrito: true, interface: { preset: "simplificada" } };
const STANDARD = {
  restrito: true,
  interface: { preset: "simplificada", destinos: ["/app/inbox", "/app/ai/agents", "/app/ai/followups"] },
};

function poolComPlano(plano: unknown, calls: string[] = []) {
  const query = vi.fn().mockImplementation((sql: string) => {
    calls.push(sql);
    if (sql.includes("fn_telas_do_plano")) {
      if (plano instanceof Error) throw plano;
      return { rows: [{ plano }] };
    }
    if (sql.includes("returning e.id")) {
      return {
        rows: [
          {
            id: "e1",
            organization_id: "org1",
            attempts: 1,
            payload: {
              conversation_id: "11111111-1111-4111-8111-111111111111",
              contact_id: "22222222-2222-4222-8222-222222222222",
              channel_session_id: "33333333-3333-4333-8333-333333333333",
              inbound_message_id: "44444444-4444-4444-8444-444444444444",
            },
          },
        ],
      };
    }
    if (sql.includes("ai_dispatch_mode")) return { rows: [{ mode: null, status: "active" }] };
    if (sql.includes("is_group")) return { rows: [{ is_group: false }] };
    if (sql.includes("tem_agente")) return { rows: [{ tem_agente: false, tem_roteador: false }] };
    return { rows: [] };
  });
  return { query } as unknown as pg.Pool;
}

const knobs = { batchSize: 10, intervalMs: 0, idleIntervalMs: 0, debounceMs: 0, reapTimeoutMs: 60000 };
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

describe("motor de IA", () => {
  it("plano sem IA: o evento vira done SEM job, antes de procurar agente, sem tocar agente nenhum", async () => {
    const calls: string[] = [];
    await drainTick(poolComPlano(ESSENCIAL, calls), knobs, log);
    expect(calls.some((s) => s.includes("fn_telas_do_plano"))).toBe(true);
    expect(calls.some((s) => s.includes("tem_agente")), "parou antes de procurar agente").toBe(false);
    expect(calls.some((s) => s.includes("job_queue"))).toBe(false);
    expect(calls.some((s) => /update\s+(public\.)?ai_agents/i.test(s))).toBe(false);
    expect(calls.some((s) => s.includes("status = 'done'"))).toBe(true);
  });

  it("plano com IA: o drain segue para a pergunta de quem atende", async () => {
    const calls: string[] = [];
    await drainTick(poolComPlano(STANDARD, calls), knobs, log);
    expect(calls.some((s) => s.includes("tem_agente"))).toBe(true);
  });

  it("a régua do motor: isenta e com IA respondem; Essencial não; falha de leitura segue", async () => {
    expect(await motorPodeResponderPeloPlano(poolComPlano({ restrito: false }), "o")).toBe(true);
    expect(await motorPodeResponderPeloPlano(poolComPlano(STANDARD), "o")).toBe(true);
    expect(await motorPodeResponderPeloPlano(poolComPlano(ESSENCIAL), "o")).toBe(false);
    expect(await motorPodeResponderPeloPlano(poolComPlano(new Error("fora do ar")), "o")).toBe(true);
  });

  it("crons: campanha e prospecção só rodam onde o plano libera a tela", async () => {
    expect(await cronPodeRodarPeloPlano(poolComPlano(ESSENCIAL), "o", "/app/campaigns")).toBe(false);
    expect(await cronPodeRodarPeloPlano(poolComPlano({ restrito: false }), "o", "/app/campaigns")).toBe(true);
    expect(await cronPodeRodarPeloPlano(poolComPlano(new Error("x")), "o", "/app/prospecting")).toBe(true);
  });
});

describe("follow-up", () => {
  it("plano sem IA: a inscrição é ADIADA (não cancelada) e nenhum passo roda", async () => {
    const agora = new Date("2026-11-09T12:00:00Z");
    const updateEnrollment = vi.fn().mockResolvedValue(undefined);
    const loadFlowGraph = vi.fn();
    const db = {
      claimDueEnrollments: vi.fn().mockResolvedValue([
        { id: "en1", organization_id: "org1", current_node_id: "n1", steps_taken: 0, status: "active" },
      ]),
      planoIncluiIa: vi.fn().mockResolvedValue(false),
      updateEnrollment,
      loadFlowGraph,
    } as unknown as AdminClient;
    const enqueueJob = vi.fn();
    const r = await runFollowupTick({ db, clock: () => agora, enqueueJob });
    expect(r.claimed).toBe(1);
    expect(loadFlowGraph).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(updateEnrollment).toHaveBeenCalledWith("en1", "org1", {
      next_eval_at: new Date(agora.getTime() + ADIAMENTO_FORA_DO_PLANO_MS).toISOString(),
      claimed_until: null,
      last_error: "fora_do_plano:ia",
    });
    expect(JSON.stringify(updateEnrollment.mock.calls)).not.toContain("cancelled");
  });
});
