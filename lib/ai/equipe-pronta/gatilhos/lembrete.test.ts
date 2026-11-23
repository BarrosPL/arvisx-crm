// @vitest-environment node
/**
 * GATILHO: resposta ao lembrete da agenda → Agendamento.
 *
 * O gatilho só fixa o agente da conversa; nada é enviado. Cada trava é um caso:
 * ensaio, pessoa que assumiu, opt-out, pausa e plano. A janela de resposta do
 * canal é do turno de resposta, e não deste gatilho.
 *
 *     pnpm vitest run lib/ai/equipe-pronta/gatilhos/lembrete.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const planoLibera = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/cobranca/equipe-pronta-no-plano", () => ({
  planoLiberaAEquipePronta: planoLibera,
  // A leitura que falha fechada (`null` = não deu para ler), usada onde se fala com o cliente.
  planoLiberaAEquipeProntaSeLido: planoLibera,
}));

import { AI_TEST_PHONE_NUMBERS_KEY, metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";

import { PAPEL_AGENDAMENTO } from "../papeis/agendamento";
import { AGENTES, CONTATO, CONVERSA, ORG, bancoPadrao, dublarSupabase, perfilInstalado } from "./dubles-de-teste";
import { entregarRespostaDoLembreteAoAgendamento } from "./lembrete";

const entrada = { organizationId: ORG, conversationId: CONVERSA, contactId: CONTATO };

async function rodar(banco: ReturnType<typeof bancoPadrao>) {
  const duble = dublarSupabase(banco);
  const resultado = await entregarRespostaDoLembreteAoAgendamento(duble.cliente, entrada);
  return { resultado, duble, conversa: duble.tabelas.conversations?.[0] };
}

beforeEach(() => {
  planoLibera.mockReset();
  planoLibera.mockResolvedValue(true);
});

describe("resposta ao lembrete → Agendamento", () => {
  it("⭐ fixa o agente de Agendamento e a intenção dele na conversa do lembrete, e não envia nada", async () => {
    const { resultado, duble, conversa } = await rodar(bancoPadrao());
    expect(resultado).toEqual({ fixado: true, agentId: AGENTES.agendamento });
    expect(conversa?.active_ai_agent_id).toBe(AGENTES.agendamento);
    expect(conversa?.active_intent).toBe(PAPEL_AGENDAMENTO.intencao.nome);
    // Uma escrita só, na conversa: nenhuma mensagem, nenhuma outra tabela.
    expect(duble.escritas.map((e) => `${e.operacao}:${e.tabela}`)).toEqual(["update:conversations"]);
  });

  async function naoFixa(banco: ReturnType<typeof bancoPadrao>, motivo: string) {
    const { resultado, duble, conversa } = await rodar(banco);
    expect(resultado).toEqual({ fixado: false, motivo });
    expect(conversa?.active_ai_agent_id ?? null).toBeNull();
    expect(duble.escritas).toEqual([]);
  }

  it("modo ensaio: número que não é de teste não é entregue à equipe", async () => {
    const banco = bancoPadrao();
    banco.channel_sessions![0]!.metadata = { ...metadataInicialDoCanal(), [AI_TEST_PHONE_NUMBERS_KEY]: ["+5511888880000"] };
    await naoFixa(banco, "modo_ensaio");
  });

  it("modo ensaio: o número de teste é entregue", async () => {
    const banco = bancoPadrao();
    banco.channel_sessions![0]!.metadata = { ...metadataInicialDoCanal(), [AI_TEST_PHONE_NUMBERS_KEY]: ["+5511999990000"] };
    expect((await rodar(banco)).resultado.fixado).toBe(true);
  });

  it("pessoa que assumiu a conversa: a equipe não entra por cima", async () => {
    const banco = bancoPadrao();
    banco.conversations![0]!.bot_silenced_until = "infinity";
    await naoFixa(banco, "humano_assumiu");
  });

  it("opt-out: contato que pediu para parar", async () => {
    const banco = bancoPadrao();
    banco.contacts![0]!.is_blocked = true;
    await naoFixa(banco, "contato_pediu_para_parar");
  });

  it("pausa da equipe, e pausa só do agente de Agendamento", async () => {
    await naoFixa(
      bancoPadrao({ equipe_pronta_perfis: [perfilInstalado({ pausa: { em: "2026-11-19T10:00:00.000Z", agentes: [] } })] }),
      "equipe_pausada",
    );
    const banco = bancoPadrao();
    banco.ai_agents!.find((a) => a.id === AGENTES.agendamento)!.paused_at = "2026-11-19T10:00:00.000Z";
    await naoFixa(banco, "equipe_pausada");
  });

  it("plano: fora do Premium o gatilho não dispara", async () => {
    planoLibera.mockResolvedValue(false);
    await naoFixa(bancoPadrao(), "fora_do_plano");
  });

  it("empresa sem equipe instalada, ou que não agenda: o lembrete segue como sempre foi", async () => {
    await naoFixa(bancoPadrao({ equipe_pronta_perfis: [] }), "sem_equipe");
    await naoFixa(
      bancoPadrao({ equipe_pronta_perfis: [perfilInstalado({ instalacao: { event_type_id: null } })] }),
      "sem_agente_de_agendamento",
    );
  });

  it("conversa de outro número: a equipe só atende no canal dela", async () => {
    const banco = bancoPadrao();
    banco.conversations![0]!.channel_session_id = "99999999-9999-4999-8999-999999999999";
    await naoFixa(banco, "conversa_de_outro_canal");
  });

  it("nunca lança: leitura que falha vira 'não fixou', e o lembrete que já saiu não vira erro", async () => {
    const duble = dublarSupabase(bancoPadrao());
    duble.quebrar("equipe_pronta_perfis");
    await expect(entregarRespostaDoLembreteAoAgendamento(duble.cliente, entrada)).resolves.toEqual({
      fixado: false,
      motivo: "falha",
    });
  });
});
