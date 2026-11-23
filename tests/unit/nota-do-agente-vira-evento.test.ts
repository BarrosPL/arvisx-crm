/**
 * A nota escrita por um agente vira `lead.note_added` no ponto da escrita.
 *
 * É a prova da LIGAÇÃO entre a ferramenta e o evento: o emissor é chamado com a
 * organização do token, leva o id da nota e NÃO leva o texto (quem entrega o
 * texto é o webhook, lendo a linha; ver `eventos-da-superficie-de-agente`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type BancoEmMemoria } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({ audit: vi.fn(async (..._args: unknown[]) => undefined) }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));

const { crmAddLeadNote } = await import("@/lib/mcp/tools/notas-do-negocio");
import type { McpContext } from "@/lib/mcp/types";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const TOKEN = "aaaaaaaa-0000-4000-8000-0000000000f1";
const CONTATO_A = "aaaaaaaa-0000-4000-8000-0000000000c1";
const CONTATO_B = "bbbbbbbb-0000-4000-8000-0000000000c1";
const NEGOCIO_A = "aaaaaaaa-0000-4000-8000-0000000000d1";
const NEGOCIO_B = "bbbbbbbb-0000-4000-8000-0000000000d1";
const FUNIL = "aaaaaaaa-0000-4000-8000-000000000011";

const TEXTO = `${"combinado com o cliente ".repeat(100)}FIM`;

let banco: BancoEmMemoria;
let rpc: ReturnType<typeof vi.fn>;

function ctx(): McpContext {
  return {
    organizationId: ORG_A,
    role: "agent",
    actor: { type: "api_token", id: TOKEN, role: "agent" },
    apiTokenId: TOKEN,
    requestId: "req-1",
    supabase: Object.assign(banco.cliente as object, { rpc }) as never,
  };
}

beforeEach(() => {
  rpc = vi.fn(async () => ({ data: null, error: null }));
  banco = bancoEmMemoria({
    api_tokens: [{ id: TOKEN, organization_id: ORG_A, name: "Agente de vendas" }],
    contacts: [
      { id: CONTATO_A, organization_id: ORG_A, is_personal: false },
      { id: CONTATO_B, organization_id: ORG_B, is_personal: false },
    ],
    crm_leads: [
      { id: NEGOCIO_A, organization_id: ORG_A, contact_id: CONTATO_A, pipeline_id: FUNIL, title: "A" },
      { id: NEGOCIO_B, organization_id: ORG_B, contact_id: CONTATO_B, pipeline_id: FUNIL, title: "B" },
    ],
    crm_lead_activities: [],
    lead_notes: [],
  });
});

function eventosEmitidos() {
  return rpc.mock.calls.filter(([nome]) => nome === "emit_event").map(([, args]) => args as Record<string, unknown>);
}

describe("crm_add_lead_note emite lead.note_added", () => {
  it("uma nota gravada emite um evento, com ids e sem o texto", async () => {
    const res = (await crmAddLeadNote.handler(
      { lead_id: NEGOCIO_A, text: TEXTO, recipient: "financeiro" } as never,
      ctx(),
    )) as { note?: { id: string } };
    const emitidos = eventosEmitidos();
    expect(emitidos).toHaveLength(1);
    const evento = emitidos[0]!;
    expect(evento.p_event_type).toBe("lead.note_added");
    expect(evento.p_entity_kind).toBe("crm_lead");
    expect(evento.p_entity_id).toBe(NEGOCIO_A);
    expect(evento.p_organization_id).toBe(ORG_A);
    const payload = evento.p_payload as Record<string, unknown>;
    expect(payload.lead_id).toBe(NEGOCIO_A);
    expect(payload.contact_id).toBe(CONTATO_A);
    expect(payload.recipient).toBe("financeiro");
    expect(typeof payload.note_id).toBe("string");
    if (res.note?.id) expect(payload.note_id).toBe(res.note.id);
    // O texto fica na linha da nota; o event_log não ganha uma cópia.
    expect(JSON.stringify(evento)).not.toContain("combinado com o cliente");
  });

  it("negócio de outra organização: recusa, e nenhum evento sai", async () => {
    await crmAddLeadNote.handler({ lead_id: NEGOCIO_B, text: "x" } as never, ctx());
    expect(eventosEmitidos()).toEqual([]);
  });

  it("falha ao emitir não derruba a nota que já foi gravada", async () => {
    rpc.mockRejectedValue(new Error("fila fora do ar"));
    await expect(
      crmAddLeadNote.handler({ lead_id: NEGOCIO_A, text: "nota curta" } as never, ctx()),
    ).resolves.toBeDefined();
    expect((banco.tabelas.crm_lead_activities ?? []).filter((l) => l.lead_id === NEGOCIO_A)).toHaveLength(1);
  });
});
