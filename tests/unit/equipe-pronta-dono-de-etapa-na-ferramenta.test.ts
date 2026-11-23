/**
 * DONO DE ETAPA E UM NEGÓCIO POR CONTATO — garantidos NA FERRAMENTA.
 *
 * A regra de quem move para onde é pura e está em
 * `lib/ai/equipe-pronta/etapas.test.ts`. Aqui se mede a ligação dela com as
 * ferramentas de verdade (`crm_move_lead_stage`, `crm_create_lead`,
 * `crm_close_demand`, `crm_retomar_lead`) e com o espelho do motor:
 *
 *  - o agente da Equipe pronta é recusado ANTES de qualquer escrita, com a
 *    orientação de passar a vez;
 *  - criar negócio para quem já tem um aberto no funil devolve o que existe;
 *  - ⭐ agente externo por token e agente nativo que não é da equipe NÃO mudam
 *    de comportamento: as mesmas chamadas seguem para o handler de sempre.
 *
 * O banco é o de `tests/helpers/banco-em-memoria.ts`; os handlers de negócio
 * (`moveLeadHandler` e irmãos) são espiões: o que importa é se foram chamados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type BancoEmMemoria } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  mover: vi.fn(),
  criar: vi.fn(),
  ler: vi.fn(),
  retomar: vi.fn(),
  encerrar: vi.fn(),
}));
vi.mock("@/app/api/v1/leads/_handler", () => ({
  listLeadsHandler: vi.fn(),
  getLeadHandler: h.ler,
  createLeadHandler: h.criar,
  updateLeadHandler: vi.fn(),
  moveLeadHandler: h.mover,
  retomarLeadHandler: h.retomar,
}));
vi.mock("@/lib/leads/encerramento", () => ({ encerraDemanda: h.encerrar }));
vi.mock("@/lib/mcp/conferencia-de-campos", () => ({
  conferirCamposPersonalizados: vi.fn(async () => ({ custom_fields: undefined, recusados: [] })),
}));
vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

const { crmCreateLead, crmMoveLeadStage, crmRetomarLead } = await import("@/lib/mcp/tools/leads");
const { crmCloseDemand } = await import("@/lib/mcp/tools/retencao");
const { espelhoPodeMoverPara, funilDaEquipe, papelDoAgenteDaEquipe } = await import(
  "@/lib/ai/equipe-pronta/dono-de-etapa"
);
const { sincronizaEstagioDoAgente } = await import("@/lib/leads/agent-stage-sync");
import type { McpContext } from "@/lib/mcp/types";
import type { PapelId } from "@/lib/ai/equipe-pronta/tipos";

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const OUTRA_ORG = "bbbbbbbb-0000-4000-8000-000000000002";
const TOKEN = "aaaaaaaa-0000-4000-8000-0000000000f1";
const FUNIL = "aaaaaaaa-0000-4000-8000-000000000011";
const OUTRO_FUNIL = "aaaaaaaa-0000-4000-8000-000000000012";
const CONTATO = "aaaaaaaa-0000-4000-8000-0000000000c1";
const CONTATO_SEM_NEGOCIO = "aaaaaaaa-0000-4000-8000-0000000000c2";
const NEGOCIO = "aaaaaaaa-0000-4000-8000-0000000000d1";
const NEGOCIO_PERDIDO = "aaaaaaaa-0000-4000-8000-0000000000d2";
const NEGOCIO_DE_OUTRO_FUNIL = "aaaaaaaa-0000-4000-8000-0000000000d3";
const AGENTE_COMUM = "aaaaaaaa-0000-4000-8000-0000000000a9";

const ETAPA = {
  novo: "aaaaaaaa-0000-4000-8000-0000000000e1",
  em_atendimento: "aaaaaaaa-0000-4000-8000-0000000000e2",
  qualificado: "aaaaaaaa-0000-4000-8000-0000000000e3",
  agendado: "aaaaaaaa-0000-4000-8000-0000000000e4",
  proposta_enviada: "aaaaaaaa-0000-4000-8000-0000000000e5",
  ganho: "aaaaaaaa-0000-4000-8000-0000000000e6",
  perdido: "aaaaaaaa-0000-4000-8000-0000000000e7",
} as const;
const ETAPA_DA_EMPRESA = "aaaaaaaa-0000-4000-8000-0000000000e9";

const AGENTE: Record<PapelId, string> = {
  sdr: "aaaaaaaa-0000-4000-8000-0000000000a1",
  agendamento: "aaaaaaaa-0000-4000-8000-0000000000a2",
  proposta: "aaaaaaaa-0000-4000-8000-0000000000a3",
  recuperador: "aaaaaaaa-0000-4000-8000-0000000000a4",
};

let banco: BancoEmMemoria;

function ctx(actor: McpContext["actor"], extra: Partial<McpContext> = {}): McpContext {
  return {
    organizationId: ORG,
    role: "agent",
    actor,
    apiTokenId: TOKEN,
    requestId: "req-1",
    supabase: banco.cliente as never,
    ...extra,
  };
}
const daEquipe = (papel: PapelId, extra: Partial<McpContext> = {}) =>
  ctx({ type: "ai_agent", id: "run-1", role: "agent", agent_id: AGENTE[papel] }, extra);
/** Agente externo: token de API, sem agente nativo por trás. */
const externo = () => ctx({ type: "api_token", id: TOKEN, role: "agent" });
/** Agente nativo que a empresa criou por conta própria: sem a marca da equipe. */
const nativoComum = () => ctx({ type: "ai_agent", id: "run-9", role: "agent", agent_id: AGENTE_COMUM });

beforeEach(() => {
  for (const espiao of Object.values(h)) espiao.mockReset();
  h.mover.mockResolvedValue({ id: NEGOCIO });
  h.criar.mockResolvedValue({ id: "novo-negocio" });
  h.ler.mockResolvedValue({ id: NEGOCIO, stage_id: ETAPA.novo, title: "Negócio da Maria" });
  h.retomar.mockResolvedValue({ id: "retomado" });
  h.encerrar.mockResolvedValue({ lead: { status: "won" }, jaEstava: false });
  banco = bancoEmMemoria({
    ai_agents: [
      ...Object.entries(AGENTE).map(([papel, id]) => ({
        id,
        organization_id: ORG,
        config: { equipe_pronta: { papel, versao: 2, hash: "x" } },
      })),
      { id: AGENTE_COMUM, organization_id: ORG, config: { outra_coisa: true } },
    ],
    equipe_pronta_perfis: [{ organization_id: ORG, instalacao: { pipeline_id: FUNIL, etapas: ETAPA } }],
    crm_leads: [
      { id: NEGOCIO, organization_id: ORG, contact_id: CONTATO, pipeline_id: FUNIL, stage_id: ETAPA.novo, status: "open", created_at: "2026-11-01T10:00:00Z" },
      { id: NEGOCIO_PERDIDO, organization_id: ORG, contact_id: CONTATO_SEM_NEGOCIO, pipeline_id: FUNIL, stage_id: ETAPA.perdido, status: "lost", created_at: "2026-11-01T10:00:00Z" },
      { id: NEGOCIO_DE_OUTRO_FUNIL, organization_id: ORG, contact_id: CONTATO, pipeline_id: OUTRO_FUNIL, stage_id: ETAPA_DA_EMPRESA, status: "open", created_at: "2026-11-01T10:00:00Z" },
    ],
  });
});

const moverPara = (c: McpContext, etapa: string, extra: Record<string, unknown> = {}, lead = NEGOCIO) =>
  crmMoveLeadStage.handler({ lead_id: lead, to_stage_id: etapa, ...extra } as never, c) as Promise<Record<string, unknown>>;

describe("quem é da Equipe pronta", () => {
  it("o papel sai da marca no cadastro do agente, pelo agent_id do ator", async () => {
    for (const [papel, id] of Object.entries(AGENTE)) {
      expect(
        await papelDoAgenteDaEquipe({ supabase: banco.cliente as never, organizationId: ORG, actor: { type: "ai_agent", id: "r", role: "agent", agent_id: id } }),
      ).toBe(papel);
    }
  });

  it("⭐ token externo, agente sem a marca e agente de outra organização não têm papel", async () => {
    const supabase = banco.cliente as never;
    expect(await papelDoAgenteDaEquipe({ supabase, organizationId: ORG, actor: { type: "api_token", id: TOKEN } })).toBeNull();
    expect(
      await papelDoAgenteDaEquipe({ supabase, organizationId: ORG, actor: { type: "ai_agent", id: "r", role: "agent", agent_id: AGENTE_COMUM } }),
    ).toBeNull();
    // Sem `agent_id` (token de agente externo): não há cadastro a ler.
    expect(await papelDoAgenteDaEquipe({ supabase, organizationId: ORG, actor: { type: "ai_agent", id: "r", role: "agent" } })).toBeNull();
    // O filtro de organização é aplicado: o agente da equipe, lido de outra empresa, não existe.
    expect(
      await papelDoAgenteDaEquipe({ supabase, organizationId: OUTRA_ORG, actor: { type: "ai_agent", id: "r", role: "agent", agent_id: AGENTE.sdr } }),
    ).toBeNull();
  });

  it("instalação sem mapeamento gravado: o funil é lido pelas marcas", async () => {
    banco.tabelas.equipe_pronta_perfis![0]!.instalacao = { pipeline_id: FUNIL };
    banco.tabelas.crm_stages = [
      { id: ETAPA.qualificado, organization_id: ORG, pipeline_id: FUNIL, name: "Qualificado", agent_stage_hint: "qualified", is_won: false, is_lost: false, is_archived: false },
      { id: ETAPA.perdido, organization_id: ORG, pipeline_id: FUNIL, name: "Perdido", agent_stage_hint: null, is_won: false, is_lost: true, is_archived: false },
    ];
    expect(await funilDaEquipe(banco.cliente as never, ORG)).toEqual({
      pipelineId: FUNIL,
      etapas: { qualificado: ETAPA.qualificado, perdido: ETAPA.perdido },
    });
  });
});

describe("crm_move_lead_stage", () => {
  it("⭐ papel que não é dono da etapa é recusado, sem mover, com a quem passar a vez", async () => {
    const r = await moverPara(daEquipe("sdr"), ETAPA.agendado);
    expect(r).toMatchObject({ permitido: false, motivo: "etapa_de_outro_papel", passe_para: ["agenda"] });
    expect(String(r.mensagem)).toContain("passar_para_colega");
    expect(h.mover).not.toHaveBeenCalled();
  });

  it("o dono move", async () => {
    expect(await moverPara(daEquipe("sdr"), ETAPA.qualificado)).toEqual({ lead: { id: NEGOCIO } });
    expect(await moverPara(daEquipe("agendamento"), ETAPA.agendado)).toEqual({ lead: { id: NEGOCIO } });
    expect(await moverPara(daEquipe("proposta"), ETAPA.proposta_enviada)).toEqual({ lead: { id: NEGOCIO } });
    expect(h.mover).toHaveBeenCalledTimes(3);
  });

  it("perdido: qualquer papel, mas só com o motivo", async () => {
    expect(await moverPara(daEquipe("agendamento"), ETAPA.perdido)).toMatchObject({ permitido: false, motivo: "perda_sem_motivo" });
    expect(await moverPara(daEquipe("agendamento"), ETAPA.perdido, { lost_reason: "   " })).toMatchObject({ motivo: "perda_sem_motivo" });
    expect(h.mover).not.toHaveBeenCalled();
    expect(await moverPara(daEquipe("agendamento"), ETAPA.perdido, { lost_reason: "sem interesse" })).toEqual({ lead: { id: NEGOCIO } });
  });

  it("reabrir negócio perdido: só quem cuida da retomada", async () => {
    const r = await moverPara(daEquipe("sdr"), ETAPA.em_atendimento, {}, NEGOCIO_PERDIDO);
    expect(r).toMatchObject({ permitido: false, motivo: "reabrir_e_da_retomada", passe_para: ["retomada"] });
    expect(h.mover).not.toHaveBeenCalled();
    await moverPara(daEquipe("recuperador"), ETAPA.em_atendimento, {}, NEGOCIO_PERDIDO);
    expect(h.mover).toHaveBeenCalledTimes(1);
  });

  it("etapa que a empresa criou e negócio de outro funil ficam fora da regra", async () => {
    await moverPara(daEquipe("recuperador"), ETAPA_DA_EMPRESA);
    await moverPara(daEquipe("sdr"), ETAPA.agendado, {}, NEGOCIO_DE_OUTRO_FUNIL);
    expect(h.mover).toHaveBeenCalledTimes(2);
  });

  it("⭐ agente externo por token e agente nativo comum: nada muda", async () => {
    for (const c of [externo(), nativoComum()]) {
      expect(await moverPara(c, ETAPA.agendado)).toEqual({ lead: { id: NEGOCIO } });
      expect(await moverPara(c, ETAPA.ganho)).toEqual({ lead: { id: NEGOCIO } });
      // Nem a perda sem motivo é barrada AQUI: quem a recusa, para eles, é o handler de sempre.
      expect(await moverPara(c, ETAPA.perdido)).toEqual({ lead: { id: NEGOCIO } });
      expect(await moverPara(c, ETAPA.em_atendimento, {}, NEGOCIO_PERDIDO)).toEqual({ lead: { id: NEGOCIO } });
    }
    expect(h.mover).toHaveBeenCalledTimes(8);
  });
});

describe("crm_create_lead", () => {
  const criar = (c: McpContext, extra: Record<string, unknown> = {}) =>
    crmCreateLead.handler(
      { pipeline_id: FUNIL, stage_id: ETAPA.novo, title: "Negócio novo", contact_id: CONTATO, ...extra } as never,
      c,
    ) as Promise<Record<string, unknown>>;

  it("⭐ contato com negócio aberto no funil: devolve o existente e não cria outro", async () => {
    const r = await criar(daEquipe("sdr"));
    expect(r).toMatchObject({ ja_existia: true, lead: { id: NEGOCIO } });
    expect(h.criar).not.toHaveBeenCalled();
    expect(h.ler).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organization_id: ORG }), NEGOCIO);
  });

  it("sem `contact_id`, vale o contato do turno", async () => {
    const r = await criar(daEquipe("agendamento", { contatoDoTurno: CONTATO }), { contact_id: undefined });
    expect(r).toMatchObject({ ja_existia: true });
    expect(h.criar).not.toHaveBeenCalled();
  });

  it("negócio perdido não é 'aberto': quem não tem negócio aberto ganha um novo", async () => {
    const r = await criar(daEquipe("sdr"), { contact_id: CONTATO_SEM_NEGOCIO });
    expect(r).toMatchObject({ lead: { id: "novo-negocio" } });
    expect(h.criar).toHaveBeenCalledTimes(1);
  });

  it("criar direto na etapa de outro papel é recusado", async () => {
    const r = await criar(daEquipe("sdr"), { contact_id: CONTATO_SEM_NEGOCIO, stage_id: ETAPA.agendado });
    expect(r).toMatchObject({ permitido: false, motivo: "etapa_de_outro_papel", passe_para: ["agenda"] });
    expect(h.criar).not.toHaveBeenCalled();
    // Na etapa dele, pode.
    await criar(daEquipe("agendamento"), { contact_id: CONTATO_SEM_NEGOCIO, stage_id: ETAPA.agendado });
    expect(h.criar).toHaveBeenCalledTimes(1);
  });

  it("⭐ agente externo e agente nativo comum criam como sempre: o segundo negócio nasce", async () => {
    for (const c of [externo(), nativoComum()]) {
      expect(await criar(c)).toMatchObject({ lead: { id: "novo-negocio" } });
      expect(await criar(c, { stage_id: ETAPA.agendado })).toMatchObject({ lead: { id: "novo-negocio" } });
    }
    expect(h.criar).toHaveBeenCalledTimes(4);
    expect(h.ler).not.toHaveBeenCalled();
  });
});

describe("crm_close_demand e crm_retomar_lead", () => {
  const fechar = (c: McpContext, outcome: "won" | "lost", reason?: string) =>
    crmCloseDemand.handler({ lead_id: NEGOCIO, outcome, reason } as never, c) as Promise<Record<string, unknown>>;

  it("⭐ ganho é de quem cuida da proposta", async () => {
    for (const papel of ["sdr", "agendamento", "recuperador"] as const) {
      expect(await fechar(daEquipe(papel), "won")).toMatchObject({
        encerrado: false,
        motivo: "etapa_de_outro_papel",
        passe_para: ["proposta"],
      });
    }
    expect(h.encerrar).not.toHaveBeenCalled();
    expect(await fechar(daEquipe("proposta"), "won")).toMatchObject({ encerrado: true, desfecho: "won" });
  });

  it("perdido é de qualquer papel, com o motivo", async () => {
    expect(await fechar(daEquipe("sdr"), "lost")).toMatchObject({ encerrado: false, motivo: "perda_sem_motivo" });
    expect(h.encerrar).not.toHaveBeenCalled();
    for (const papel of Object.keys(AGENTE) as PapelId[]) {
      expect(await fechar(daEquipe(papel), "lost", "não quis")).toMatchObject({ encerrado: true });
    }
    expect(h.encerrar).toHaveBeenCalledTimes(4);
  });

  it("⭐ agente externo fecha como ganho como sempre fechou", async () => {
    expect(await fechar(externo(), "won")).toMatchObject({ encerrado: true });
    expect(await fechar(nativoComum(), "won")).toMatchObject({ encerrado: true });
  });

  it("retomar como negócio novo: só a retomada, entre os da equipe; os demais não mudam", async () => {
    const retomar = (c: McpContext) =>
      crmRetomarLead.handler({ lead_id: NEGOCIO_PERDIDO } as never, c) as Promise<Record<string, unknown>>;
    expect(await retomar(daEquipe("sdr"))).toMatchObject({ permitido: false, motivo: "reabrir_e_da_retomada" });
    expect(h.retomar).not.toHaveBeenCalled();
    await retomar(daEquipe("recuperador"));
    await retomar(externo());
    await retomar(nativoComum());
    expect(h.retomar).toHaveBeenCalledTimes(3);
  });
});

describe("o espelho do motor (o card anda quando o agente avança o próprio estado)", () => {
  const alvo = (toStageId: string) => ({ pipelineId: FUNIL, fromStageId: ETAPA.novo, toStageId });
  const quem = (c: McpContext) => ({ supabase: c.supabase, organizationId: ORG, actor: c.actor });

  it("⭐ segue a mesma regra: só o dono leva o card à etapa", async () => {
    expect(await espelhoPodeMoverPara(quem(daEquipe("sdr")), alvo(ETAPA.qualificado))).toBe(true);
    expect(await espelhoPodeMoverPara(quem(daEquipe("sdr")), alvo(ETAPA.proposta_enviada))).toBe(false);
    expect(await espelhoPodeMoverPara(quem(daEquipe("sdr")), alvo(ETAPA.ganho))).toBe(false);
    expect(await espelhoPodeMoverPara(quem(daEquipe("proposta")), alvo(ETAPA.ganho))).toBe(true);
    // A perda continua com a regra do próprio espelho, que avisa a equipe.
    expect(await espelhoPodeMoverPara(quem(daEquipe("sdr")), alvo(ETAPA.perdido))).toBe(true);
  });

  it("agente que não é da equipe, e outro funil: o espelho segue como antes", async () => {
    expect(await espelhoPodeMoverPara(quem(nativoComum()), alvo(ETAPA.ganho))).toBe(true);
    expect(
      await espelhoPodeMoverPara(quem(daEquipe("sdr")), { pipelineId: OUTRO_FUNIL, fromStageId: ETAPA.novo, toStageId: ETAPA.ganho }),
    ).toBe(true);
  });

  it("⭐ a sincronização não move quando a regra injetada diz não, e diz por quê", async () => {
    banco.tabelas.crm_stages = [
      { id: ETAPA.novo, organization_id: ORG, pipeline_id: FUNIL, name: "Novo", agent_stage_hint: "new", is_archived: false, is_lost: false, is_won: false },
      { id: ETAPA.proposta_enviada, organization_id: ORG, pipeline_id: FUNIL, name: "Proposta enviada", agent_stage_hint: "negotiating", is_archived: false, is_lost: false, is_won: false },
    ];
    banco.tabelas.crm_leads = banco.tabelas.crm_leads!.filter((l) => l.id === NEGOCIO);
    const pediu: unknown[] = [];
    const r = await sincronizaEstagioDoAgente(banco.cliente as never, {
      organizationId: ORG,
      contactId: CONTATO,
      passo: "negotiating",
      podeMoverPara: async (a) => {
        pediu.push(a);
        return false;
      },
    });
    expect(r).toEqual({ moveu: false, motivo: "etapa_de_outro_papel", leadId: NEGOCIO });
    expect(pediu).toEqual([{ pipelineId: FUNIL, fromStageId: ETAPA.novo, toStageId: ETAPA.proposta_enviada }]);
    // O card não saiu do lugar.
    expect(banco.tabelas.crm_leads![0]!.stage_id).toBe(ETAPA.novo);
  });
});
