/**
 * O estado da IA numa conversa, como o agente de fora o lê
 * (`crm_get_conversation.ai` e `data.conversation.ai` do webhook).
 */
import { describe, expect, it } from "vitest";

import { estadoDaIaNaConversa, type FatosDaIaNaConversa } from "./estado-da-ia";

const AGORA = new Date("2026-11-20T15:00:00.000Z");
const ATENDENTE = "11111111-1111-4111-8111-111111111111";

function fatos(extra: Partial<FatosDaIaNaConversa> = {}): FatosDaIaNaConversa {
  return {
    status: "ai_handling",
    assigned_to_user_id: null,
    assignee_kind: "ai",
    assigned_at: null,
    bot_silenced_until: null,
    last_handoff_at: null,
    last_handoff_reason: null,
    last_outbound_at: null,
    is_group: false,
    force_human: false,
    ai_opt_out: false,
    is_blocked: false,
    ...extra,
  };
}

describe("estadoDaIaNaConversa", () => {
  it("conversa com o automático: não está pausada", () => {
    expect(estadoDaIaNaConversa(fatos(), AGORA)).toEqual({
      paused: false,
      human_in_command: false,
      reason: null,
      since: null,
      by_user_id: null,
      until: null,
      resumes_automatically: false,
      detail: null,
    });
  });

  it("uma pessoa assumiu: pausada, diz desde quando e por quem, e não volta sozinha", () => {
    const estado = estadoDaIaNaConversa(
      fatos({
        status: "claimed",
        assigned_to_user_id: ATENDENTE,
        assignee_kind: "user",
        assigned_at: "2026-11-20T14:30:00.000Z",
        bot_silenced_until: "infinity",
        last_handoff_reason: "Automático pausado pelo atendente",
      }),
      AGORA,
    );
    expect(estado).toMatchObject({
      paused: true,
      human_in_command: true,
      reason: "human_assigned",
      since: "2026-11-20T14:30:00.000Z",
      by_user_id: ATENDENTE,
      until: null,
      resumes_automatically: false,
      detail: "Automático pausado pelo atendente",
    });
  });

  it("dono humano SEM silêncio gravado (conversa distribuída): o motor não responde, então está pausada", () => {
    const estado = estadoDaIaNaConversa(
      fatos({ status: "open", assigned_to_user_id: ATENDENTE, assignee_kind: "user", assigned_at: "2026-11-20T14:00:00.000Z" }),
      AGORA,
    );
    expect(estado).toMatchObject({ paused: true, reason: "human_assigned", by_user_id: ATENDENTE, resumes_automatically: false });
  });

  it("dono humano com silêncio de prazo curto: o prazo não devolve nada sozinho", () => {
    const estado = estadoDaIaNaConversa(
      fatos({ assigned_to_user_id: ATENDENTE, assignee_kind: "user", bot_silenced_until: "2026-11-20T15:05:00.000Z" }),
      AGORA,
    );
    expect(estado).toMatchObject({ paused: true, reason: "human_assigned", until: null, resumes_automatically: false });
  });

  it("uma pessoa respondeu sem assumir: pausada com prazo, e volta sozinha na hora marcada", () => {
    const estado = estadoDaIaNaConversa(
      fatos({ bot_silenced_until: "2026-11-20T15:05:00.000Z", last_outbound_at: "2026-11-20T15:00:00.000Z" }),
      AGORA,
    );
    expect(estado).toMatchObject({
      paused: true,
      human_in_command: false,
      reason: "human_replied",
      since: "2026-11-20T15:00:00.000Z",
      by_user_id: null,
      until: "2026-11-20T15:05:00.000Z",
      resumes_automatically: true,
    });
  });

  it("o prazo venceu: a IA voltou, sem ninguém escrever na conversa", () => {
    const estado = estadoDaIaNaConversa(
      fatos({ bot_silenced_until: "2026-11-20T14:59:59.000Z", last_outbound_at: "2026-11-20T14:54:59.000Z" }),
      AGORA,
    );
    expect(estado.paused).toBe(false);
    expect(estado.reason).toBeNull();
  });

  it("resposta pelo celular com pausa sem prazo: só volta por comando", () => {
    const estado = estadoDaIaNaConversa(
      fatos({
        bot_silenced_until: "infinity",
        last_handoff_at: "2026-11-20T13:00:00.000Z",
        last_handoff_reason: "Atendimento manual pelo canal (resposta fora do CRM)",
      }),
      AGORA,
    );
    expect(estado).toMatchObject({
      paused: true,
      reason: "human_replied_outside_crm",
      since: "2026-11-20T13:00:00.000Z",
      until: null,
      resumes_automatically: false,
    });
  });

  it("o agente passou o caso e ninguém assumiu ainda: com a trava do contato é contact_locked", () => {
    const estado = estadoDaIaNaConversa(
      fatos({
        status: "pending",
        assignee_kind: null,
        bot_silenced_until: "infinity",
        last_handoff_at: "2026-11-20T12:00:00.000Z",
        last_handoff_reason: "requested_human",
        force_human: true,
      }),
      AGORA,
    );
    expect(estado).toMatchObject({
      paused: true,
      human_in_command: false,
      reason: "contact_locked",
      since: "2026-11-20T12:00:00.000Z",
    });
  });

  it("pausada sem dono e sem trava do contato: handed_to_team", () => {
    const estado = estadoDaIaNaConversa(
      fatos({ status: "pending", assignee_kind: null, bot_silenced_until: "infinity", last_handoff_at: "2026-11-20T12:00:00.000Z" }),
      AGORA,
    );
    expect(estado).toMatchObject({ paused: true, reason: "handed_to_team", resumes_automatically: false });
  });

  it("depois de assumida, a conversa travada diz QUEM assumiu, não a trava", () => {
    const estado = estadoDaIaNaConversa(
      fatos({ assigned_to_user_id: ATENDENTE, assignee_kind: "user", bot_silenced_until: "infinity", force_human: true }),
      AGORA,
    );
    expect(estado).toMatchObject({ reason: "human_assigned", by_user_id: ATENDENTE });
  });

  it("as travas permanentes do contato vencem o resto", () => {
    expect(estadoDaIaNaConversa(fatos({ ai_opt_out: true }), AGORA)).toMatchObject({
      paused: true,
      reason: "contact_always_human",
    });
    expect(
      estadoDaIaNaConversa(fatos({ is_blocked: true, assigned_to_user_id: ATENDENTE, assignee_kind: "user" }), AGORA),
    ).toMatchObject({ paused: true, reason: "contact_opted_out", human_in_command: true });
  });

  it("grupo e conversa encerrada não são pausa: devolver ao automático não mudaria nada", () => {
    expect(estadoDaIaNaConversa(fatos({ is_group: true, bot_silenced_until: "infinity" }), AGORA).paused).toBe(false);
    expect(estadoDaIaNaConversa(fatos({ status: "closed", bot_silenced_until: "infinity" }), AGORA).paused).toBe(false);
  });
});
