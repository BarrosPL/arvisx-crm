/**
 * `crm_set_next_action` — o agente PROPÕE a próxima ação do negócio.
 *
 * O handler é real, e a escrita também: `applyLeadStateUpdate`, o único caminho
 * que grava `next_action` e move `next_action_seq`. O que é dublê é o POOL: ele
 * guarda a linha de `lead_state` nas mesmas tabelas em memória e responde às
 * duas consultas daquela função (ler o estado, gravar o estado). Que o SQL de
 * verdade faça o que promete é coisa do Postgres real — os invariantes de
 * `lead_state` já cobrem.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type BancoEmMemoria, type Linha } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  audit: vi.fn(async (..._args: unknown[]) => undefined),
  banco: { atual: null as unknown },
}));

vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({
  getRequestPool: () => ({
    query: async (sql: string, p: unknown[]) => {
      const banco = h.banco.atual as BancoEmMemoria;
      const estados = (banco.tabelas.lead_state ??= []);
      const achar = () => estados.find((l) => l.organization_id === p[0] && l.contact_id === p[1]);
      if (sql.startsWith("select * from lead_state")) {
        const linha = achar();
        return { rows: linha ? [linha] : [] };
      }
      if (sql.includes("insert into lead_state")) {
        const reescreveu = p[5] === true;
        let linha = achar();
        if (!linha) {
          linha = { organization_id: p[0], contact_id: p[1], next_action_seq: 0 } as Linha;
          estados.push(linha);
        }
        Object.assign(linha, {
          stage: p[2],
          qualification: JSON.parse(p[3] as string),
          next_action: p[4],
          next_action_seq: (linha.next_action_seq as number) + (reescreveu ? 1 : 0),
          updated_at: new Date("2026-11-20T12:00:00.000Z"),
        });
        return { rows: [linha] };
      }
      throw new Error(`pool em memória: SQL não previsto: ${sql.slice(0, 60)}`);
    },
  }),
}));

const { crmSetNextAction } = await import("@/lib/mcp/tools/proxima-acao");
import type { McpContext } from "@/lib/mcp/types";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const TOKEN_A = "aaaaaaaa-0000-4000-8000-0000000000f1";
const CONTATO_A = "aaaaaaaa-0000-4000-8000-0000000000c1";
const CONTATO_DOIS = "aaaaaaaa-0000-4000-8000-0000000000c2";
const CONTATO_B = "bbbbbbbb-0000-4000-8000-0000000000c1";
const NEGOCIO_A = "aaaaaaaa-0000-4000-8000-0000000000d1";
const NEGOCIO_SEM_CONTATO = "aaaaaaaa-0000-4000-8000-0000000000d2";
const NEGOCIO_DOIS_1 = "aaaaaaaa-0000-4000-8000-0000000000d3";
const NEGOCIO_DOIS_2 = "aaaaaaaa-0000-4000-8000-0000000000d4";
const NEGOCIO_B = "bbbbbbbb-0000-4000-8000-0000000000d1";
const FUNIL = "aaaaaaaa-0000-4000-8000-000000000011";

let banco: BancoEmMemoria;

const negocio = (id: string, org: string, contato: string | null, extra: Linha = {}): Linha => ({
  id,
  organization_id: org,
  contact_id: contato,
  pipeline_id: FUNIL,
  title: "Negócio",
  status: "open",
  last_activity_at: "2026-11-10T10:00:00.000Z",
  created_at: "2026-11-01T10:00:00.000Z",
  ...extra,
});

function ctx(extra: Partial<McpContext> = {}): McpContext {
  return {
    organizationId: ORG_A,
    role: "agent",
    actor: { type: "api_token", id: TOKEN_A, role: "agent" },
    apiTokenId: TOKEN_A,
    requestId: "req-1",
    supabase: banco.cliente as never,
    ...extra,
  };
}

beforeEach(() => {
  h.audit.mockClear();
  banco = bancoEmMemoria({
    contacts: [
      { id: CONTATO_A, organization_id: ORG_A, is_personal: false },
      { id: CONTATO_DOIS, organization_id: ORG_A, is_personal: false },
      { id: CONTATO_B, organization_id: ORG_B, is_personal: false },
    ],
    crm_leads: [
      negocio(NEGOCIO_A, ORG_A, CONTATO_A),
      negocio(NEGOCIO_SEM_CONTATO, ORG_A, null),
      // Mesmo contato, mesmo funil, os dois abertos e igualmente recentes: ambíguo.
      negocio(NEGOCIO_DOIS_1, ORG_A, CONTATO_DOIS),
      negocio(NEGOCIO_DOIS_2, ORG_A, CONTATO_DOIS),
      negocio(NEGOCIO_B, ORG_B, CONTATO_B),
    ],
    lead_state: [
      { organization_id: ORG_B, contact_id: CONTATO_B, stage: "new", qualification: {}, next_action: "proposta da empresa B", next_action_seq: 7 },
    ],
  });
  h.banco.atual = banco;
});

type Resposta = Record<string, unknown>;
const propor = (args: Record<string, unknown>, c = ctx()) =>
  crmSetNextAction.handler(args as never, c) as Promise<Resposta>;
const estadoDe = (org: string, contato: string) =>
  banco.tabelas.lead_state!.find((l) => l.organization_id === org && l.contact_id === contato);

describe("crm_set_next_action", () => {
  it("⭐ grava a proposta no contato do negócio, na organização do token, e diz que ela está no card", async () => {
    const r = await propor({ lead_id: NEGOCIO_A, next_action: "Enviar o contrato até sexta" });

    expect(r).toMatchObject({
      lead_id: NEGOCIO_A,
      recorded: true,
      next_action: "Enviar o contrato até sexta",
      seq: 1,
      shown: "neste_negocio",
      shown_on_lead_id: NEGOCIO_A,
    });
    expect(estadoDe(ORG_A, CONTATO_A)).toMatchObject({ next_action: "Enviar o contrato até sexta", next_action_seq: 1 });
  });

  it("⭐ escrever de novo MOVE a identidade da proposta — é o que a aprovação humana confere", async () => {
    await propor({ lead_id: NEGOCIO_A, next_action: "Enviar o contrato até sexta" });
    const r = await propor({ lead_id: NEGOCIO_A, next_action: "Enviar o contrato até sexta" });

    // mesma frase, proposta nova: quem aprovou a primeira não aprovou esta
    expect(r).toMatchObject({ recorded: true, seq: 2 });
  });

  it("⭐ audita com o agente como ator, e sem o texto da proposta", async () => {
    await propor({ lead_id: NEGOCIO_A, next_action: "Ligar para o cliente na terça" });

    expect(h.audit).toHaveBeenCalledTimes(1);
    const linha = h.audit.mock.calls[0]![0];
    expect(linha).toMatchObject({
      action: "lead.next_action_proposed",
      organizationId: ORG_A,
      actorUserId: null,
      actorApiTokenId: TOKEN_A,
      resourceType: "crm_leads",
      resourceId: NEGOCIO_A,
      metadata: expect.objectContaining({ via: "mcp", actor_type: "api_token", seq: 1, cleared: false }),
    });
    expect(JSON.stringify(linha)).not.toContain("terça");
  });

  it("frase vazia de conteúdo NÃO é gravada, não audita, e a resposta diz por quê", async () => {
    const r = await propor({ lead_id: NEGOCIO_A, next_action: "Responder o cliente" });

    expect(r).toMatchObject({ recorded: false, next_action: null });
    expect(String(r.next_step)).toMatch(/Nada foi gravado/);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("null retira a proposta pendente", async () => {
    await propor({ lead_id: NEGOCIO_A, next_action: "Enviar o contrato até sexta" });
    const r = await propor({ lead_id: NEGOCIO_A, next_action: null });

    expect(r).toMatchObject({ recorded: true, next_action: null, shown: "em_nenhum" });
    expect(estadoDe(ORG_A, CONTATO_A)!.next_action).toBeNull();
  });

  it("⭐ negócio de OUTRA organização: recusa, e a proposta de lá fica intacta", async () => {
    const r = await propor({ lead_id: NEGOCIO_B, next_action: "Sobrescrever a da outra empresa" });

    expect(r).toMatchObject({ permitido: false, motivo: "negocio_nao_encontrado" });
    expect(estadoDe(ORG_B, CONTATO_B)).toMatchObject({ next_action: "proposta da empresa B", next_action_seq: 7 });
    expect(banco.tabelas.lead_state).toHaveLength(1);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("negócio sem contato é recusado: a proposta é guardada por contato", async () => {
    const r = await propor({ lead_id: NEGOCIO_SEM_CONTATO, next_action: "Enviar o contrato até sexta" });
    expect(r).toMatchObject({ permitido: false, motivo: "negocio_sem_contato" });
    expect(banco.tabelas.lead_state).toHaveLength(1);
  });

  it("contato com mais de um negócio aberto: grava, e NÃO afirma que ficou no card", async () => {
    const r = await propor({ lead_id: NEGOCIO_DOIS_1, next_action: "Enviar o contrato até sexta" });

    expect(r).toMatchObject({ recorded: true, shown: "aguarda_escolha_da_equipe", shown_on_lead_id: null });
    expect(String(r.next_step)).toMatch(/mais de um negócio aberto/);
  });

  it("no turno de atendimento, negócio de outro cliente e inexistente recebem a MESMA recusa", async () => {
    const turno = ctx({ contatoDoTurno: CONTATO_DOIS });
    const alheio = await propor({ lead_id: NEGOCIO_A, next_action: "x y z" }, turno);
    const inexistente = await propor({ lead_id: "99999999-9999-4999-8999-999999999999", next_action: "x y z" }, turno);

    expect(alheio).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
    expect(inexistente).toEqual(alheio);
    expect(estadoDe(ORG_A, CONTATO_A)).toBeUndefined();
  });

  it("contrato: escrita, papel mínimo `agent`, sem organização nos argumentos", () => {
    expect(crmSetNextAction).toMatchObject({ category: "write", requiresRole: "agent", requiresScope: "mcp:write" });
    expect(Object.keys(crmSetNextAction.inputSchema).sort()).toEqual(["lead_id", "next_action"]);
  });
});
