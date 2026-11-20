// @vitest-environment node
/**
 * A TRAVA DOS FLUXOS DA EQUIPE NO MOTOR: pausa (adia) e limite de toques
 * (encerra a inscrição que acabou de nascer).
 *
 * Três camadas, cada uma medida: a decisão pura, a leitura (perfil, pausa,
 * toques) e o tique do motor de follow-up, que tem de adiar ou encerrar SEM
 * processar a inscrição (isto é, sem mandar nada).
 *
 *     pnpm vitest run lib/ai/equipe-pronta/gatilhos/trava-do-fluxo.test.ts
 */
import { describe, expect, it, vi } from "vitest";

import { runFollowupTick, type AdminClient } from "@/lib/followup/engine";
import type { EnrollmentRow } from "@/lib/followup/node-handlers";

import { NO_DE_INICIO_DA_ESCADA } from "../constantes";
import { AGENTES, CONTATO, FLUXOS, ORG, bancoPadrao, dublarSupabase, perfilInstalado } from "./dubles-de-teste";
import {
  ERRO_DA_EQUIPE_PAUSADA,
  MOTIVO_DO_LIMITE_DE_TOQUES,
  decidirTravaDoFluxo,
  fluxosDaEquipe,
  travaDoFluxoDaEquipe,
} from "./trava-do-fluxo";

const inscricao = (mudancas: Partial<{ id: string; pointer_id: string; current_node_id: string }> = {}) => ({
  id: "insc-nova",
  organization_id: ORG,
  pointer_id: FLUXOS.proposta,
  contact_id: CONTATO,
  current_node_id: NO_DE_INICIO_DA_ESCADA,
  ...mudancas,
});

/** Uma inscrição ANTERIOR de um fluxo da equipe, com as mensagens que ela mandou. */
function comToquesAnteriores(fluxo: string, enviadasEm: string[]) {
  return {
    followup_enrollments: [{ id: "insc-antiga", organization_id: ORG, contact_id: CONTATO, pointer_id: fluxo }],
    followup_enrollment_events: enviadasEm.map((created_at, i) => ({
      id: `ev-${i}`,
      organization_id: ORG,
      enrollment_id: "insc-antiga",
      event_type: "action_sent",
      created_at,
    })),
  };
}

describe("a decisão", () => {
  const base = { fluxoDaEquipe: true, pausada: false, acabouDeNascer: true, toquesDesdeAUltimaResposta: 0 };

  it("fluxo que não é da equipe nunca é tocado", () => {
    expect(decidirTravaDoFluxo({ ...base, fluxoDaEquipe: false, pausada: true, toquesDesdeAUltimaResposta: 9 })).toBeNull();
  });

  it("pausa adia, em qualquer ponto da escada", () => {
    expect(decidirTravaDoFluxo({ ...base, pausada: true })).toEqual({ acao: "adiar", motivo: ERRO_DA_EQUIPE_PAUSADA });
    expect(decidirTravaDoFluxo({ ...base, pausada: true, acabouDeNascer: false })).toEqual({
      acao: "adiar",
      motivo: ERRO_DA_EQUIPE_PAUSADA,
    });
  });

  it("⭐ limite de toques: inscrição recém-nascida, com retomada já feita depois da última resposta, é encerrada", () => {
    expect(decidirTravaDoFluxo({ ...base, toquesDesdeAUltimaResposta: 1 })).toEqual({
      acao: "encerrar",
      motivo: MOTIVO_DO_LIMITE_DE_TOQUES,
      toques: 1,
    });
  });

  it("sem retomada anterior, ou no meio da própria escada, segue", () => {
    expect(decidirTravaDoFluxo(base)).toBeNull();
    expect(decidirTravaDoFluxo({ ...base, acabouDeNascer: false, toquesDesdeAUltimaResposta: 2 })).toBeNull();
  });
});

describe("a leitura", () => {
  it("os fluxos da equipe são a régua e os dois dos gatilhos", () => {
    expect(
      fluxosDaEquipe({
        followup_flow_pointer_id: FLUXOS.regua,
        gatilhos: { fluxo_de_falta_id: FLUXOS.falta, fluxo_de_proposta_parada_id: null, regra_de_proposta_parada_id: null },
      }),
    ).toEqual([FLUXOS.regua, FLUXOS.falta]);
    expect(fluxosDaEquipe(null)).toEqual([]);
  });

  it("fluxo do cliente, na mesma empresa, não é da equipe: segue", async () => {
    const { cliente } = dublarSupabase(
      bancoPadrao({ equipe_pronta_perfis: [perfilInstalado({ pausa: { em: "2026-11-19T10:00:00.000Z", agentes: [] } })] }),
    );
    expect(await travaDoFluxoDaEquipe(cliente, inscricao({ pointer_id: "fluxo-do-cliente" }))).toBeNull();
  });

  it.each(Object.entries(FLUXOS))("pausa da equipe adia o fluxo %s", async (_nome, fluxo) => {
    const { cliente } = dublarSupabase(
      bancoPadrao({ equipe_pronta_perfis: [perfilInstalado({ pausa: { em: "2026-11-19T10:00:00.000Z", agentes: [] } })] }),
    );
    expect(await travaDoFluxoDaEquipe(cliente, inscricao({ pointer_id: fluxo }))).toEqual({
      acao: "adiar",
      motivo: ERRO_DA_EQUIPE_PAUSADA,
    });
  });

  it("agente de Recuperação pausado à mão também adia", async () => {
    const banco = bancoPadrao();
    banco.ai_agents!.find((a) => a.id === AGENTES.recuperador)!.paused_at = "2026-11-19T10:00:00.000Z";
    expect(await travaDoFluxoDaEquipe(dublarSupabase(banco).cliente, inscricao())).toEqual({
      acao: "adiar",
      motivo: ERRO_DA_EQUIPE_PAUSADA,
    });
  });

  it("⭐ a régua já retomou este contato depois da última mensagem dele: a proposta parada não soma outra escada", async () => {
    // Última mensagem do cliente em 10/11 12:00 (banco padrão); a régua mandou duas depois.
    const { cliente } = dublarSupabase(
      bancoPadrao(comToquesAnteriores(FLUXOS.regua, ["2026-11-13T12:00:00.000Z", "2026-11-15T12:00:00.000Z"])),
    );
    expect(await travaDoFluxoDaEquipe(cliente, inscricao({ pointer_id: FLUXOS.proposta }))).toEqual({
      acao: "encerrar",
      motivo: MOTIVO_DO_LIMITE_DE_TOQUES,
      toques: 2,
    });
    // Vale igual para a falta, e para a própria régua recomeçando.
    expect((await travaDoFluxoDaEquipe(cliente, inscricao({ pointer_id: FLUXOS.falta })))?.acao).toBe("encerrar");
    expect((await travaDoFluxoDaEquipe(cliente, inscricao({ pointer_id: FLUXOS.regua })))?.acao).toBe("encerrar");
  });

  it("a pessoa respondeu depois da retomada: a conta zera e o fluxo novo segue", async () => {
    const banco = bancoPadrao(comToquesAnteriores(FLUXOS.regua, ["2026-11-05T12:00:00.000Z"]));
    expect(await travaDoFluxoDaEquipe(dublarSupabase(banco).cliente, inscricao())).toBeNull();
  });

  it("mensagem de um fluxo que NÃO é da equipe não conta como retomada dela", async () => {
    const banco = bancoPadrao(comToquesAnteriores("fluxo-do-cliente", ["2026-11-15T12:00:00.000Z"]));
    expect(await travaDoFluxoDaEquipe(dublarSupabase(banco).cliente, inscricao())).toBeNull();
  });

  it("no meio da escada os toques não são contados: a escada termina os N dela", async () => {
    const { cliente } = dublarSupabase(bancoPadrao(comToquesAnteriores(FLUXOS.regua, ["2026-11-15T12:00:00.000Z"])));
    expect(await travaDoFluxoDaEquipe(cliente, inscricao({ current_node_id: "espera-2" }))).toBeNull();
  });

  it("falha de leitura = segue (não para o follow-up de quem nem tem equipe)", async () => {
    for (const tabela of ["equipe_pronta_perfis", "followup_enrollments", "followup_enrollment_events", "conversations"]) {
      const duble = dublarSupabase(bancoPadrao(comToquesAnteriores(FLUXOS.regua, ["2026-11-15T12:00:00.000Z"])));
      duble.quebrar(tabela);
      expect(await travaDoFluxoDaEquipe(duble.cliente, inscricao()), tabela).toBeNull();
    }
    const queLanca = { from: () => { throw new Error("conexão caiu"); } } as never;
    expect(await travaDoFluxoDaEquipe(queLanca, inscricao())).toBeNull();
  });
});

describe("o tique do motor de follow-up", () => {
  const AGORA = new Date("2026-11-20T12:00:00.000Z");
  const linha = { ...inscricao(), status: "active", steps_taken: 0 } as unknown as EnrollmentRow;

  function motor(trava: Awaited<ReturnType<typeof travaDoFluxoDaEquipe>> | "lanca") {
    const updateEnrollment = vi.fn(async () => undefined);
    const insertEnrollmentEvent = vi.fn(async () => ({ inserted: true }));
    // Qualquer outro método do adaptador sendo chamado significa que a
    // inscrição foi PROCESSADA: o teste falha alto.
    const db = new Proxy(
      {
        claimDueEnrollments: async () => [linha],
        updateEnrollment,
        insertEnrollmentEvent,
        travaDoFluxoDaEquipe: async () => {
          if (trava === "lanca") throw new Error("leitura caiu");
          return trava;
        },
      } as Record<string, unknown>,
      {
        get(alvo, chave: string) {
          if (chave in alvo) return alvo[chave];
          if (chave === "planoIncluiIa" || chave === "fluxoDaEquipeForaDoPlano") return undefined;
          return () => {
            throw new Error(`inscrição processada: ${chave}`);
          };
        },
      },
    ) as unknown as AdminClient;
    const enqueueJob = vi.fn(async () => undefined);
    return { deps: { db, clock: () => AGORA, enqueueJob }, updateEnrollment, insertEnrollmentEvent, enqueueJob };
  }

  it("⭐ pausa: a inscrição é adiada, não cancelada, e nenhum turno é enfileirado", async () => {
    const m = motor({ acao: "adiar", motivo: ERRO_DA_EQUIPE_PAUSADA });
    await runFollowupTick(m.deps);
    expect(m.enqueueJob).not.toHaveBeenCalled();
    expect(m.insertEnrollmentEvent).not.toHaveBeenCalled();
    expect(m.updateEnrollment).toHaveBeenCalledTimes(1);
    const [id, org, patch] = m.updateEnrollment.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect([id, org]).toEqual(["insc-nova", ORG]);
    expect(patch.last_error).toBe(ERRO_DA_EQUIPE_PAUSADA);
    expect(patch.status).toBeUndefined();
    expect(Date.parse(patch.next_eval_at as string)).toBeGreaterThan(AGORA.getTime());
  });

  it("⭐ limite de toques: a inscrição é encerrada com o motivo no dossiê, e nenhum turno é enfileirado", async () => {
    const m = motor({ acao: "encerrar", motivo: MOTIVO_DO_LIMITE_DE_TOQUES, toques: 2 });
    await runFollowupTick(m.deps);
    expect(m.enqueueJob).not.toHaveBeenCalled();
    expect(m.insertEnrollmentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        enrollment_id: "insc-nova",
        organization_id: ORG,
        event_type: "cancelled_by_touch_limit",
        payload: { reason: MOTIVO_DO_LIMITE_DE_TOQUES, toques: 2 },
      }),
    );
    const patch = (m.updateEnrollment.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2];
    expect(patch).toMatchObject({ status: "cancelled", cancel_reason: MOTIVO_DO_LIMITE_DE_TOQUES, next_eval_at: null });
  });

  it("leitura da trava que lança não segura a inscrição: o motor segue para processá-la", async () => {
    const m = motor("lanca");
    await runFollowupTick(m.deps);
    // Seguiu: o processamento começou (e, neste dublê, falhou alto no primeiro acesso).
    expect(m.updateEnrollment.mock.calls.every((c) => (c as unknown[])[2] && !("cancel_reason" in ((c as unknown[])[2] as object)))).toBe(true);
  });
});
