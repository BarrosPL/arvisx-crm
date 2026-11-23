// @vitest-environment node
/**
 * GATILHO: negócio ganho → tarefa "dar seguimento" para a equipe.
 *
 * Mede a idempotência (ganho regravado não duplica) e cada trava que vale para
 * uma tarefa interna: plano, pausa da equipe e ensaio. A tarefa não fala com o
 * cliente, então pessoa que assumiu, opt-out e janela do canal NÃO a seguram, e
 * isso também é medido.
 *
 *     pnpm vitest run lib/ai/equipe-pronta/gatilhos/negocio-ganho.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const planoLibera = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/cobranca/equipe-pronta-no-plano", () => ({
  planoLiberaAEquipePronta: planoLibera,
  // A leitura que falha fechada (`null` = não deu para ler), usada onde se fala com o cliente.
  planoLiberaAEquipeProntaSeLido: planoLibera,
}));

const criarTarefa = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tarefas/servico", () => ({ criarTarefa }));

import { AI_TEST_PHONE_NUMBERS_KEY, metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";
import type { EventRow } from "@/lib/event-log/dispatcher";

import {
  AGENTES,
  CONTATO,
  FUNIL,
  NEGOCIO,
  ORG,
  bancoPadrao,
  dublarSupabase,
  perfilInstalado,
  type DubleDoSupabase,
} from "./dubles-de-teste";
import {
  TIPO_DA_TAREFA_DE_SEGUIMENTO,
  TITULO_DA_TAREFA_DE_SEGUIMENTO,
  tarefaDeSeguimentoDoGanho,
} from "./negocio-ganho";

const DONO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function banco(mudancas: Parameters<typeof bancoPadrao>[0] = {}) {
  return bancoPadrao({
    crm_leads: [
      { id: NEGOCIO, organization_id: ORG, status: "won", pipeline_id: FUNIL, contact_id: CONTATO, owner_user_id: DONO },
    ],
    crm_tasks: [],
    ...mudancas,
  });
}

/** `criarTarefa` de mentira que GRAVA na tabela do dublê: é o que a segunda chamada precisa achar. */
function ligarCriacao(duble: DubleDoSupabase, recusaPara: (dados: Record<string, unknown>) => string | null = () => null) {
  criarTarefa.mockImplementation(async (portas: { dados: Record<string, unknown>; organizationId: string }) => {
    const recusa = recusaPara(portas.dados);
    if (recusa) return { ok: false, recusa };
    const tarefa = { id: `tarefa-${duble.tabelas.crm_tasks!.length + 1}`, organization_id: portas.organizationId, ...portas.dados };
    duble.tabelas.crm_tasks!.push(tarefa);
    return { ok: true, tarefa, fechouAgora: false };
  });
}

const db = {} as never;
const entrada = { organizationId: ORG, leadId: NEGOCIO, requestId: "event:1", agora: new Date("2026-11-20T12:00:00.000Z") };

beforeEach(() => {
  planoLibera.mockReset();
  planoLibera.mockResolvedValue(true);
  criarTarefa.mockReset();
});

describe("negócio ganho → tarefa de seguimento", () => {
  it("⭐ cria UMA tarefa no negócio, para o dono dele, com prazo e tipo, em nome do agente de Propostas", async () => {
    const duble = dublarSupabase(banco());
    ligarCriacao(duble);
    const r = await tarefaDeSeguimentoDoGanho(duble.cliente, db, entrada);
    expect(r).toEqual({ estado: "criada", tarefaId: "tarefa-1" });
    expect(criarTarefa).toHaveBeenCalledTimes(1);
    const chamada = criarTarefa.mock.calls[0]![0];
    expect(chamada.organizationId).toBe(ORG);
    expect(chamada.dados).toMatchObject({
      title: TITULO_DA_TAREFA_DE_SEGUIMENTO,
      lead_id: NEGOCIO,
      contact_id: CONTATO,
      assigned_to: DONO,
      kind: TIPO_DA_TAREFA_DE_SEGUIMENTO,
      priority: "high",
      due_date: "2026-11-21T12:00:00.000Z",
    });
    expect(chamada.ator).toMatchObject({ type: "ai_agent", agent_id: AGENTES.proposta });
    expect(chamada.auditoria.metadata).toMatchObject({ via: "equipe_pronta", gatilho: "negocio_ganho" });
    expect(chamada.criadaPor).toBeNull();
  });

  it("⭐ idempotente: o ganho regravado, e o dreno que repete a linha, acham a tarefa e não criam outra", async () => {
    const duble = dublarSupabase(banco());
    ligarCriacao(duble);
    await tarefaDeSeguimentoDoGanho(duble.cliente, db, entrada);
    const segunda = await tarefaDeSeguimentoDoGanho(duble.cliente, db, { ...entrada, requestId: "event:2" });
    expect(segunda).toEqual({ estado: "ja_existia", tarefaId: "tarefa-1" });
    expect(criarTarefa).toHaveBeenCalledTimes(1);
    expect(duble.tabelas.crm_tasks).toHaveLength(1);
  });

  it("tarefa de seguimento já CONCLUÍDA também conta: reabrir e ganhar de novo não cria a segunda", async () => {
    const duble = dublarSupabase(
      banco({
        crm_tasks: [
          { id: "antiga", organization_id: ORG, lead_id: NEGOCIO, kind: TIPO_DA_TAREFA_DE_SEGUIMENTO, status: "completed" },
        ],
      }),
    );
    ligarCriacao(duble);
    expect(await tarefaDeSeguimentoDoGanho(duble.cliente, db, entrada)).toEqual({ estado: "ja_existia", tarefaId: "antiga" });
    expect(criarTarefa).not.toHaveBeenCalled();
  });

  it("tarefa de OUTRO tipo no mesmo negócio não impede a de seguimento", async () => {
    const duble = dublarSupabase(
      banco({ crm_tasks: [{ id: "outra", organization_id: ORG, lead_id: NEGOCIO, kind: "ligar", status: "pending" }] }),
    );
    ligarCriacao(duble);
    expect((await tarefaDeSeguimentoDoGanho(duble.cliente, db, entrada)).estado).toBe("criada");
  });

  async function pulado(b: ReturnType<typeof banco>, motivo: string) {
    const duble = dublarSupabase(b);
    ligarCriacao(duble);
    expect(await tarefaDeSeguimentoDoGanho(duble.cliente, db, entrada)).toEqual({ estado: "pulado", motivo });
    expect(criarTarefa).not.toHaveBeenCalled();
  }

  it("plano: fora do Premium o gatilho não dispara", async () => {
    planoLibera.mockResolvedValue(false);
    await pulado(banco(), "fora_do_plano");
  });

  it("pausa da equipe: nada é criado enquanto a pausa durar", async () => {
    await pulado(
      banco({ equipe_pronta_perfis: [perfilInstalado({ pausa: { em: "2026-11-19T10:00:00.000Z", agentes: [] } })] }),
      "equipe_pausada",
    );
  });

  it("modo ensaio: só o negócio de um número de teste gera tarefa", async () => {
    const fora = banco();
    fora.channel_sessions![0]!.metadata = { ...metadataInicialDoCanal(), [AI_TEST_PHONE_NUMBERS_KEY]: ["+5511888880000"] };
    await pulado(fora, "modo_ensaio");

    const deTeste = banco();
    deTeste.channel_sessions![0]!.metadata = { ...metadataInicialDoCanal(), [AI_TEST_PHONE_NUMBERS_KEY]: ["+5511999990000"] };
    const duble = dublarSupabase(deTeste);
    ligarCriacao(duble);
    expect((await tarefaDeSeguimentoDoGanho(duble.cliente, db, entrada)).estado).toBe("criada");
  });

  it("a tarefa é interna: pessoa que assumiu a conversa e opt-out do contato NÃO a seguram", async () => {
    const b = banco();
    b.conversations![0]!.bot_silenced_until = "infinity";
    b.contacts![0]!.is_blocked = true;
    const duble = dublarSupabase(b);
    ligarCriacao(duble);
    expect((await tarefaDeSeguimentoDoGanho(duble.cliente, db, entrada)).estado).toBe("criada");
  });

  it("sem equipe instalada, negócio de outro funil, ou negócio que não está ganho: nada", async () => {
    await pulado(banco({ equipe_pronta_perfis: [] }), "sem_equipe");
    const outroFunil = banco();
    outroFunil.crm_leads![0]!.pipeline_id = "99999999-9999-4999-8999-999999999999";
    await pulado(outroFunil, "outro_funil");
    const aberto = banco();
    aberto.crm_leads![0]!.status = "open";
    await pulado(aberto, "negocio_nao_ganho");
  });

  it("dono que saiu da equipe: a tarefa nasce sem responsável, para a equipe", async () => {
    const duble = dublarSupabase(banco());
    ligarCriacao(duble, (dados) => (dados.assigned_to === DONO ? "responsavel_fora_da_equipe" : null));
    expect((await tarefaDeSeguimentoDoGanho(duble.cliente, db, entrada)).estado).toBe("criada");
    expect(criarTarefa).toHaveBeenCalledTimes(2);
    expect(criarTarefa.mock.calls[1]![0].dados.assigned_to).toBeNull();
  });

  it("falha de leitura vira 'falha' (o dreno tenta de novo), nunca tarefa pela metade", async () => {
    const duble = dublarSupabase(banco());
    duble.quebrar("crm_tasks");
    expect((await tarefaDeSeguimentoDoGanho(duble.cliente, db, entrada)).estado).toBe("falha");
    expect(criarTarefa).not.toHaveBeenCalled();
  });
});

describe("o consumidor do evento", () => {
  it("consome `lead.won`, pula na empresa parada e traduz o desfecho para o dreno", async () => {
    vi.resetModules();
    const tarefa = vi.fn();
    vi.doMock("./negocio-ganho", () => ({ tarefaDeSeguimentoDoGanho: tarefa }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
    vi.doMock("@/lib/db", () => ({ portaDaAplicacao: () => ({}) }));
    const { seguimentoDoGanhoHandler, SEGUIMENTO_DO_GANHO_KEY } = await import("./negocio-ganho.handler");
    expect(seguimentoDoGanhoHandler.events).toEqual(["lead.won"]);
    expect(seguimentoDoGanhoHandler.naOrgParada).toBe("pula");

    const linha = { id: "ev-1", organization_id: ORG, payload: { lead_id: NEGOCIO }, entity_id: NEGOCIO } as unknown as EventRow;
    tarefa.mockResolvedValueOnce({ estado: "criada", tarefaId: "t1" });
    expect(await seguimentoDoGanhoHandler.handle(linha)).toEqual({
      consumer_key: SEGUIMENTO_DO_GANHO_KEY,
      status: "ok",
      detail: "criada:t1",
    });
    // A organização vem da LINHA do evento.
    expect(tarefa.mock.calls[0]![2]).toMatchObject({ organizationId: ORG, leadId: NEGOCIO });

    tarefa.mockResolvedValueOnce({ estado: "pulado", motivo: "equipe_pausada" });
    expect((await seguimentoDoGanhoHandler.handle(linha)).status).toBe("skipped");
    tarefa.mockResolvedValueOnce({ estado: "falha", erro: "x" });
    expect((await seguimentoDoGanhoHandler.handle(linha)).status).toBe("error");
    tarefa.mockRejectedValueOnce(new Error("caiu"));
    expect((await seguimentoDoGanhoHandler.handle(linha)).status).toBe("error");
    vi.doUnmock("./negocio-ganho");
  });
});
