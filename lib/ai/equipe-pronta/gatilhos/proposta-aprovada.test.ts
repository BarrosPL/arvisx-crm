// @vitest-environment node
/**
 * GATILHO: proposta aprovada pela equipe → Propostas envia e move o negócio.
 *
 * Mede a aprovação (gravada pelo servidor, uma vez por revisão), o envio em
 * nome do agente e CADA trava: ensaio, pessoa que assumiu, janela do canal,
 * opt-out, pausa e plano. Em toda trava a aprovação fica gravada e nada sai.
 *
 *     pnpm vitest run lib/ai/equipe-pronta/gatilhos/proposta-aprovada.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const planoLibera = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/cobranca/equipe-pronta-no-plano", () => ({ planoLiberaAEquipePronta: planoLibera }));

const enviarProposta = vi.hoisted(() => vi.fn());
vi.mock("@/lib/propostas/enviar-proposta", () => ({ enviarProposta }));

const moveLeadHandler = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/v1/leads/_handler", () => ({ moveLeadHandler }));

const audit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit", () => ({ audit }));

vi.mock("@/lib/propostas/data-no-fuso", () => ({
  dataIsoNoFuso: () => "2026-11-20",
  fusoDaOrganizacao: async () => "America/Sao_Paulo",
}));

import { AI_TEST_PHONE_NUMBERS_KEY, metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";

import {
  AGENTES,
  CONTATO,
  CONVERSA,
  ETAPA_EM_NEGOCIACAO,
  ETAPA_PROPOSTA_ENVIADA,
  ETAPA_QUALIFICADO,
  FUNIL,
  NEGOCIO,
  ORG,
  bancoPadrao,
  dublarSupabase,
  perfilInstalado,
} from "./dubles-de-teste";
import { aprovarPropostaParaOAgente, fraseDeNaoEnviar, type MotivoDeNaoEnviar } from "./proposta-aprovada";

const PROPOSTA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const GESTOR = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function banco(mudancas: Parameters<typeof bancoPadrao>[0] = {}) {
  return bancoPadrao({
    crm_proposals: [
      {
        id: PROPOSTA,
        organization_id: ORG,
        lead_id: NEGOCIO,
        contact_id: CONTATO,
        conversation_id: CONVERSA,
        status: "rascunho",
        valid_until: "2026-12-31",
        revision: 3,
        aprovada_em: null,
        aprovada_na_revisao: null,
      },
    ],
    crm_leads: [{ id: NEGOCIO, organization_id: ORG, status: "open", pipeline_id: FUNIL, stage_id: ETAPA_QUALIFICADO }],
    ...mudancas,
  });
}

const entrada = { orgId: ORG, propostaId: PROPOSTA, userId: GESTOR, requestId: "req-1", t: (s: string) => s };

async function aprovar(b: ReturnType<typeof banco>) {
  const duble = dublarSupabase(b);
  const resultado = await aprovarPropostaParaOAgente(duble.cliente, entrada);
  return { resultado, duble, proposta: duble.tabelas.crm_proposals![0]! };
}

beforeEach(() => {
  planoLibera.mockReset();
  planoLibera.mockResolvedValue(true);
  enviarProposta.mockReset();
  enviarProposta.mockResolvedValue({ tipo: "ok", desfecho: "enviada", proposta: { id: PROPOSTA, status: "enviada" } });
  moveLeadHandler.mockReset();
  moveLeadHandler.mockResolvedValue({});
  audit.mockReset();
});

describe("aprovar e deixar o agente enviar", () => {
  it("⭐ grava a aprovação da revisão atual, envia em nome do agente de Propostas e move para proposta enviada", async () => {
    const { resultado, proposta } = await aprovar(banco());
    expect(resultado.tipo).toBe("ok");
    if (resultado.tipo !== "ok") return;
    expect(resultado.envio).toEqual({ enviada: true, em_fila: false, motivo: null, mensagem: null });
    expect(resultado.negocio_movido).toBe(true);

    // A aprovação: as duas colunas, com a revisão que a pessoa viu.
    expect(proposta.aprovada_na_revisao).toBe(3);
    expect(typeof proposta.aprovada_em).toBe("string");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "proposal.aprovada_para_o_agente",
        actorUserId: GESTOR,
        organizationId: ORG,
        resourceId: PROPOSTA,
      }),
    );

    // O envio: a mesma função da tela, com o AGENTE como autor e ninguém como `userId`.
    expect(enviarProposta).toHaveBeenCalledTimes(1);
    const envio = enviarProposta.mock.calls[0]![1];
    expect(envio).toMatchObject({ orgId: ORG, propostaId: PROPOSTA });
    expect(envio.quem.actor).toEqual({ type: "ai_agent", id: AGENTES.proposta, role: "agent", agent_id: AGENTES.proposta });
    expect(envio.quem.userId).toBeNull();
    expect(envio.quem.auditoria.metadata).toMatchObject({
      gatilho: "proposta_aprovada",
      agent_id: AGENTES.proposta,
      aprovada_por_user_id: GESTOR,
    });

    // O negócio: movido pelo agente de Propostas, o dono da etapa.
    expect(moveLeadHandler).toHaveBeenCalledTimes(1);
    const [, ctx, leadId, destino] = moveLeadHandler.mock.calls[0]!;
    expect(ctx).toMatchObject({ organization_id: ORG, actor: { type: "ai_agent", agent_id: AGENTES.proposta } });
    expect(leadId).toBe(NEGOCIO);
    expect(destino).toEqual({ to_stage_id: ETAPA_PROPOSTA_ENVIADA });
  });

  /** Toda trava: a aprovação fica, nada é enviado, nada é movido, e a resposta diz por quê. */
  async function travado(b: ReturnType<typeof banco>, motivo: MotivoDeNaoEnviar) {
    const { resultado, proposta } = await aprovar(b);
    expect(resultado.tipo).toBe("ok");
    if (resultado.tipo !== "ok") return;
    expect(resultado.envio.enviada).toBe(false);
    expect(resultado.envio.motivo).toBe(motivo);
    expect(resultado.envio.mensagem).toContain("Aprovada");
    expect(resultado.negocio_movido).toBe(false);
    expect(proposta.aprovada_na_revisao).toBe(3);
    expect(enviarProposta).not.toHaveBeenCalled();
    expect(moveLeadHandler).not.toHaveBeenCalled();
  }

  it("modo ensaio: número que não é de teste não recebe a proposta", async () => {
    const b = banco();
    b.channel_sessions![0]!.metadata = { ...metadataInicialDoCanal(), [AI_TEST_PHONE_NUMBERS_KEY]: ["+5511888880000"] };
    await travado(b, "modo_ensaio");
  });

  it("modo ensaio: o número de teste recebe", async () => {
    const b = banco();
    b.channel_sessions![0]!.metadata = { ...metadataInicialDoCanal(), [AI_TEST_PHONE_NUMBERS_KEY]: ["+5511999990000"] };
    const { resultado } = await aprovar(b);
    expect(resultado.tipo === "ok" && resultado.envio.enviada).toBe(true);
  });

  it("pessoa que assumiu a conversa: o agente não envia por cima dela", async () => {
    const b = banco();
    b.conversations![0]!.bot_silenced_until = "infinity";
    await travado(b, "humano_assumiu");
  });

  it("opt-out: contato que pediu para parar não recebe", async () => {
    const b = banco();
    b.contacts![0]!.is_blocked = true;
    await travado(b, "contato_pediu_para_parar");
  });

  it("pausa: equipe pausada pela tela, ou agente de Propostas pausado", async () => {
    await travado(
      banco({ equipe_pronta_perfis: [perfilInstalado({ pausa: { em: "2026-11-19T10:00:00.000Z", agentes: [] } })] }),
      "equipe_pausada",
    );
    const b = banco();
    b.ai_agents!.find((a) => a.id === AGENTES.proposta)!.paused_at = "2026-11-19T10:00:00.000Z";
    await travado(b, "equipe_pausada");
  });

  it("plano: fora do Premium o agente não envia", async () => {
    planoLibera.mockResolvedValue(false);
    await travado(banco(), "fora_do_plano");
  });

  it("sem equipe instalada: aprova, e avisa que não há agente para enviar", async () => {
    await travado(banco({ equipe_pronta_perfis: [] }), "sem_agente");
  });

  it("proposta vencida: aprova, e não envia", async () => {
    const b = banco();
    b.crm_proposals![0]!.valid_until = "2026-11-01";
    await travado(b, "proposta_expirada");
  });

  it("janela e horário do canal: quem confere é o envio, e a recusa dele vira o motivo, sem mover o negócio", async () => {
    for (const motivo of ["fora_da_janela", "limite_diario"] as const) {
      enviarProposta.mockResolvedValueOnce({ tipo: "recusa", motivo, codigo: "validation_failed", status: 422, mensagem: "x" });
      const { resultado, proposta } = await aprovar(banco());
      expect(resultado.tipo === "ok" && resultado.envio).toMatchObject({ enviada: false, motivo });
      expect(resultado.tipo === "ok" && resultado.negocio_movido).toBe(false);
      expect(proposta.aprovada_na_revisao).toBe(3);
    }
    expect(moveLeadHandler).not.toHaveBeenCalled();
  });

  it("envio que falhou ou ficou na fila não move o negócio", async () => {
    enviarProposta.mockResolvedValueOnce({ tipo: "ok", desfecho: "revertida", proposta: {} });
    const falhou = await aprovar(banco());
    expect(falhou.resultado.tipo === "ok" && falhou.resultado.envio.motivo).toBe("envio_falhou");

    enviarProposta.mockResolvedValueOnce({ tipo: "ok", desfecho: "em_fila", proposta: {} });
    const fila = await aprovar(banco());
    expect(fila.resultado.tipo === "ok" && fila.resultado.envio).toEqual({
      enviada: false,
      em_fila: true,
      motivo: null,
      mensagem: null,
    });
    expect(moveLeadHandler).not.toHaveBeenCalled();
  });

  it("proposta incompleta (item sem preço): aprova, não envia e diz qual item", async () => {
    enviarProposta.mockResolvedValueOnce({
      tipo: "recusa",
      motivo: "item_sem_preco",
      codigo: "validation_failed",
      status: 422,
      mensagem: "",
      itens: ["Instalação"],
    });
    const { resultado } = await aprovar(banco());
    expect(resultado.tipo === "ok" && resultado.envio.motivo).toBe("proposta_incompleta");
    expect(resultado.tipo === "ok" && resultado.envio.mensagem).toContain("Instalação");
  });

  it("nunca move para trás: negócio já em negociação, fechado, ou de outro funil fica onde está", async () => {
    for (const mudanca of [
      { stage_id: ETAPA_EM_NEGOCIACAO },
      { stage_id: ETAPA_PROPOSTA_ENVIADA },
      { status: "won" },
      { pipeline_id: "99999999-9999-4999-8999-999999999999" },
    ]) {
      const b = banco();
      Object.assign(b.crm_leads![0]!, mudanca);
      const { resultado } = await aprovar(b);
      expect(resultado.tipo === "ok" && resultado.envio.enviada, JSON.stringify(mudanca)).toBe(true);
      expect(resultado.tipo === "ok" && resultado.negocio_movido, JSON.stringify(mudanca)).toBe(false);
    }
    expect(moveLeadHandler).not.toHaveBeenCalled();
  });

  it("o negócio que não pôde ser movido não desfaz o envio", async () => {
    moveLeadHandler.mockRejectedValueOnce(new Error("etapa arquivada"));
    const { resultado } = await aprovar(banco());
    expect(resultado.tipo === "ok" && resultado.envio.enviada).toBe(true);
    expect(resultado.tipo === "ok" && resultado.negocio_movido).toBe(false);
  });

  it("aprovar de novo a MESMA revisão não regrava a aprovação nem audita de novo, e tenta o envio de novo", async () => {
    const b = banco();
    Object.assign(b.crm_proposals![0]!, { aprovada_em: "2026-11-19T09:00:00.000Z", aprovada_na_revisao: 3 });
    const { resultado, proposta } = await aprovar(b);
    expect(proposta.aprovada_em).toBe("2026-11-19T09:00:00.000Z");
    expect(audit).not.toHaveBeenCalled();
    expect(resultado.tipo === "ok" && resultado.envio.enviada).toBe(true);
  });

  it("aprovação de uma revisão ANTERIOR não vale: aprova a atual", async () => {
    const b = banco();
    Object.assign(b.crm_proposals![0]!, { aprovada_em: "2026-11-19T09:00:00.000Z", aprovada_na_revisao: 2 });
    const { proposta } = await aprovar(b);
    expect(proposta.aprovada_na_revisao).toBe(3);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("recusas: proposta de outra organização ou inexistente (404) e proposta que não é rascunho (409)", async () => {
    const outraOrg = banco();
    outraOrg.crm_proposals![0]!.organization_id = "99999999-9999-4999-8999-999999999999";
    const a = await aprovar(outraOrg);
    expect(a.resultado).toMatchObject({ tipo: "recusa", codigo: "not_found", status: 404 });
    expect(a.proposta.aprovada_em).toBeNull();

    const enviada = banco();
    enviada.crm_proposals![0]!.status = "enviada";
    const e = await aprovar(enviada);
    expect(e.resultado).toMatchObject({ tipo: "recusa", codigo: "proposal_context_stale", status: 409 });
    expect(e.proposta.aprovada_em).toBeNull();
    expect(enviarProposta).not.toHaveBeenCalled();
  });

  it("toda trava tem frase para quem aprovou", () => {
    const motivos: MotivoDeNaoEnviar[] = [
      "sem_agente",
      "proposta_expirada",
      "equipe_pausada",
      "fora_do_plano",
      "contato_pediu_para_parar",
      "contato_pessoal",
      "humano_assumiu",
      "modo_ensaio",
      "sem_canal",
      "consulta_indisponivel",
      "fora_da_janela",
      "limite_diario",
      "envio_falhou",
      "proposta_incompleta",
    ];
    for (const m of motivos) expect(fraseDeNaoEnviar(m, (s) => s), m).toMatch(/^Aprovada/);
  });
});
