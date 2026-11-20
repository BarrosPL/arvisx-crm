// @vitest-environment node
/**
 * AS TRAVAS DE FALAR COM O CLIENTE — uma por caso, na função que a ferramenta
 * `crm_send_proposal` e os gatilhos da equipe compartilham.
 *
 *     pnpm vitest run lib/ai/equipe-pronta/gatilhos/travas.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const planoLibera = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/cobranca/equipe-pronta-no-plano", () => ({ planoLiberaAEquipePronta: planoLibera }));

import { AI_TEST_PHONE_NUMBERS_KEY, metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";

import {
  AGENTES,
  CANAL,
  CONTATO,
  CONVERSA,
  ORG,
  bancoPadrao,
  dublarSupabase,
  perfilInstalado,
} from "./dubles-de-teste";
import { lerEquipeInstalada, travaDaEquipe, travasDeFalarComOCliente } from "./travas";

const entrada = { organizationId: ORG, agentId: AGENTES.proposta, contactId: CONTATO, conversationId: CONVERSA };

async function codigo(
  banco: ReturnType<typeof bancoPadrao>,
  mudancas: { agentId?: string | null; contactId?: string | null } = {},
) {
  const { cliente } = dublarSupabase(banco);
  const r = await travasDeFalarComOCliente(cliente, { ...entrada, ...mudancas });
  return r.trava?.codigo ?? null;
}

beforeEach(() => {
  planoLibera.mockReset();
  planoLibera.mockResolvedValue(true);
});

describe("travasDeFalarComOCliente", () => {
  it("controle: cliente comum, equipe ativa, canal aberto e conectado = pode, com a conversa do envio", async () => {
    const { cliente } = dublarSupabase(bancoPadrao());
    const r = await travasDeFalarComOCliente(cliente, entrada);
    expect(r).toEqual({
      trava: null,
      conversa: { id: CONVERSA, channel_session_id: CANAL },
      telefone: "+5511999990000",
    });
  });

  it("modo ensaio: canal em pré-lançamento e número fora da lista de teste", async () => {
    const banco = bancoPadrao();
    banco.channel_sessions![0]!.metadata = { ...metadataInicialDoCanal(), [AI_TEST_PHONE_NUMBERS_KEY]: ["+5511888880000"] };
    expect(await codigo(banco)).toBe("modo_ensaio");
  });

  it("modo ensaio: o número de teste passa", async () => {
    const banco = bancoPadrao();
    banco.channel_sessions![0]!.metadata = { ...metadataInicialDoCanal(), [AI_TEST_PHONE_NUMBERS_KEY]: ["+5511999990000"] };
    expect(await codigo(banco)).toBeNull();
  });

  it("pessoa que assumiu a conversa: silêncio da IA em QUALQUER conversa do contato", async () => {
    const banco = bancoPadrao();
    banco.conversations!.push({
      id: "outra",
      organization_id: ORG,
      contact_id: CONTATO,
      channel_session_id: CANAL,
      bot_silenced_until: "infinity",
    });
    expect(await codigo(banco)).toBe("humano_assumiu");
  });

  it("pessoa que assumiu: silêncio que ainda não venceu trava; o que já venceu não", async () => {
    const futuro = bancoPadrao();
    futuro.conversations![0]!.bot_silenced_until = new Date(Date.now() + 3_600_000).toISOString();
    expect(await codigo(futuro)).toBe("humano_assumiu");
    const passado = bancoPadrao();
    passado.conversations![0]!.bot_silenced_until = new Date(Date.now() - 3_600_000).toISOString();
    expect(await codigo(passado)).toBeNull();
  });

  it("contato de atendimento humano (force_human ou ai_opt_out)", async () => {
    for (const campo of ["force_human", "ai_opt_out"]) {
      const banco = bancoPadrao();
      banco.contacts![0]![campo] = true;
      expect(await codigo(banco), campo).toBe("humano_assumiu");
    }
  });

  it("opt-out: quem pediu para parar não recebe nada", async () => {
    const banco = bancoPadrao();
    banco.contacts![0]!.is_blocked = true;
    expect(await codigo(banco)).toBe("contato_pediu_para_parar");
  });

  it("contato pessoal fica fora da operação", async () => {
    const banco = bancoPadrao();
    banco.contacts![0]!.is_personal = true;
    expect(await codigo(banco)).toBe("contato_pessoal");
  });

  it("pausa: o agente pausado, ou a equipe pausada pela tela", async () => {
    const agentePausado = bancoPadrao();
    agentePausado.ai_agents!.find((a) => a.id === AGENTES.proposta)!.paused_at = "2026-11-19T10:00:00.000Z";
    expect(await codigo(agentePausado)).toBe("equipe_pausada");

    const equipePausada = bancoPadrao({
      equipe_pronta_perfis: [perfilInstalado({ pausa: { em: "2026-11-19T10:00:00.000Z", agentes: [] } })],
    });
    expect(await codigo(equipePausada)).toBe("equipe_pausada");
  });

  it("plano: agente da equipe numa empresa cujo plano não a libera", async () => {
    planoLibera.mockResolvedValue(false);
    expect(await codigo(bancoPadrao())).toBe("fora_do_plano");
  });

  it("agente que NÃO é da equipe não responde pela pausa nem pelo plano da equipe", async () => {
    planoLibera.mockResolvedValue(false);
    const banco = bancoPadrao({
      equipe_pronta_perfis: [perfilInstalado({ pausa: { em: "2026-11-19T10:00:00.000Z", agentes: [] } })],
    });
    banco.ai_agents!.find((a) => a.id === AGENTES.proposta)!.config = {};
    expect(await codigo(banco)).toBeNull();
    // Sem agente (token de fora): só as travas do cliente valem.
    expect(await codigo(banco, { agentId: null })).toBeNull();
  });

  it("sem canal: sem contato, sem conversa, ou com o canal desconectado", async () => {
    expect(await codigo(bancoPadrao(), { contactId: null })).toBe("sem_canal");
    expect(await codigo(bancoPadrao({ conversations: [] }))).toBe("sem_canal");
    const desconectado = bancoPadrao();
    desconectado.channel_sessions![0]!.status = "STOPPED";
    expect(await codigo(desconectado)).toBe("sem_canal");
  });

  it("a conversa preferida tem de ser do contato: a de outro contato não serve", async () => {
    const banco = bancoPadrao();
    banco.conversations![0]!.contact_id = "outro-contato";
    expect(await codigo(banco)).toBe("sem_canal");
  });

  it("leitura que falha TRAVA (falha fechada): nada sai com a consulta indisponível", async () => {
    for (const tabela of ["ai_agents", "contacts", "conversations", "channel_sessions"]) {
      const duble = dublarSupabase(bancoPadrao());
      duble.quebrar(tabela);
      const r = await travasDeFalarComOCliente(duble.cliente, entrada);
      expect(r.trava?.codigo, tabela).toBe("consulta_indisponivel");
    }
  });
});

describe("a equipe instalada e as travas dela", () => {
  it("sem perfil, ou só com o rascunho: não há equipe instalada", async () => {
    expect(await lerEquipeInstalada(dublarSupabase({ equipe_pronta_perfis: [] }).cliente, ORG)).toBeNull();
    const rascunho = dublarSupabase({ equipe_pronta_perfis: [perfilInstalado({ estado: "rascunho" })] });
    expect(await lerEquipeInstalada(rascunho.cliente, ORG)).toBeNull();
  });

  it("leitura que falha LANÇA: quem chama decide", async () => {
    const duble = dublarSupabase(bancoPadrao());
    duble.quebrar("equipe_pronta_perfis");
    await expect(lerEquipeInstalada(duble.cliente, ORG)).rejects.toThrow(/perfil/);
  });

  it("a equipe pausada e a equipe fora do plano não agem; a ativa, sim", async () => {
    const { cliente } = dublarSupabase(bancoPadrao());
    const ativa = (await lerEquipeInstalada(cliente, ORG))!;
    expect(await travaDaEquipe(cliente, ORG, ativa)).toBeNull();

    planoLibera.mockResolvedValue(false);
    expect((await travaDaEquipe(cliente, ORG, ativa))?.codigo).toBe("fora_do_plano");

    planoLibera.mockResolvedValue(true);
    const pausada = dublarSupabase({
      equipe_pronta_perfis: [perfilInstalado({ pausa: { em: "2026-11-19T10:00:00.000Z", agentes: [] } })],
    });
    const equipe = (await lerEquipeInstalada(pausada.cliente, ORG))!;
    expect((await travaDaEquipe(pausada.cliente, ORG, equipe))?.codigo).toBe("equipe_pausada");
  });
});
