/**
 * A EMENDA DE CUSTO DO VIX.
 *
 * O que este arquivo prova:
 *  - o segundo destino (`llm_calls`) está DESLIGADO: por padrão, `concluirUso`
 *    só atualiza `assistente_usos` e nunca toca em `llm_calls`;
 *  - a linha que será gravada quando ele for ligado tem a forma combinada:
 *    tokens reais, a origem da chave na coluna `origem_da_chave`, custo zero
 *    quando o pagador é a assinatura;
 *  - falha de registro não lança (a conversa não cai por causa do registro);
 *  - erro ao registrar a mensagem recusa (falha fechada); não há limite de
 *    mensagens a conferir;
 *  - quem tem o assistente (marca ou assinatura) e o freio técnico da instalação.
 *
 * O que NÃO prova: que `llm_calls` aceita a linha. A coluna `origem_da_chave`
 * ainda não existe na `main` (vem da migration 9825, de outra entrega), e por
 * isso o destino fica desligado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const instalacao = vi.hoisted(() => ({ valores: {} as Record<string, string> }));
vi.mock("@/lib/instalacao/config", () => ({
  valorDaInstalacao: vi.fn(async (chave: string) => ({ valor: instalacao.valores[chave] ?? null, fonte: "nenhuma" })),
}));

import {
  COLUNA_DA_ORIGEM_DA_CHAVE,
  FERRAMENTAS_POR_TURNO,
  LIMITE_DE_LOTE,
  MENSAGENS_POR_MINUTO_PADRAO,
  TAMANHO_MAXIMO_ABSOLUTO,
  TAMANHO_MAXIMO_DA_MENSAGEM_PADRAO,
  configDoVix,
  freioDoVix,
  REGISTRAR_EM_LLM_CALLS,
  concluirUso,
  linhaDeLlmCallsDoVix,
  registrarMensagem,
  type UsoDeUmaResposta,
} from "./custo";

beforeEach(() => {
  instalacao.valores = {};
});

const USO: UsoDeUmaResposta = {
  orgId: "11111111-1111-4111-8111-111111111111",
  usoId: "22222222-2222-4222-8222-222222222222",
  provedor: "openai-codex",
  modelo: "modelo-de-teste",
  tokensDeEntrada: 1234.4,
  tokensDeSaida: 56,
  falhou: false,
  custoUsdCents: 0,
  pagador: "assinatura_plataforma",
};

function bancoEspiao(opcoes: { erroNoUpdate?: boolean; lancar?: boolean } = {}) {
  const tocadas: string[] = [];
  const inseridas: Record<string, unknown>[] = [];
  const atualizadas: Record<string, unknown>[] = [];
  const admin = {
    from(tabela: string) {
      if (opcoes.lancar) throw new Error("banco fora do ar");
      tocadas.push(tabela);
      return {
        update(valores: Record<string, unknown>) {
          atualizadas.push(valores);
          const fim = { error: opcoes.erroNoUpdate ? { message: "falhou" } : null };
          const elo = { eq: () => elo, then: (ok: (v: typeof fim) => unknown) => Promise.resolve(fim).then(ok) };
          return elo;
        },
        insert(linha: Record<string, unknown>) {
          inseridas.push(linha);
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { admin, tocadas, inseridas, atualizadas };
}

describe("o segundo destino (llm_calls) está desligado", () => {
  it("a chave nasce desligada", () => {
    expect(REGISTRAR_EM_LLM_CALLS).toBe(false);
  });

  it("por padrão, concluirUso grava só em assistente_usos", async () => {
    const b = bancoEspiao();
    await concluirUso(b.admin, USO);
    expect(b.tocadas).toEqual(["assistente_usos"]);
    expect(b.inseridas).toHaveLength(0);
    expect(b.atualizadas[0]).toEqual({
      provedor: "openai-codex",
      modelo: "modelo-de-teste",
      tokens_de_entrada: 1234,
      tokens_de_saida: 56,
      falhou: false,
    });
  });

  it("ligado (só no teste), grava também a linha de llm_calls", async () => {
    const b = bancoEspiao();
    await concluirUso(b.admin, USO, true);
    expect(b.tocadas).toEqual(["assistente_usos", "llm_calls"]);
    expect(b.inseridas).toEqual([linhaDeLlmCallsDoVix(USO)]);
  });
});

describe("a forma da linha de llm_calls", () => {
  it("o nome da coluna de origem é o combinado", () => {
    expect(COLUNA_DA_ORIGEM_DA_CHAVE).toBe("origem_da_chave");
  });

  it("assinatura: tokens reais, custo zero e a origem da assinatura", () => {
    expect(linhaDeLlmCallsDoVix(USO)).toEqual({
      organization_id: USO.orgId,
      purpose: "assistente_vix",
      provider: "openai-codex",
      model: "modelo-de-teste",
      input_tokens: 1234,
      output_tokens: 56,
      cost_cents: 0,
      status: "ok",
      origem_da_chave: "assinatura_plataforma",
    });
  });

  it("chave da plataforma: custo real e a origem própria do assistente", () => {
    const linha = linhaDeLlmCallsDoVix({ ...USO, custoUsdCents: 3, pagador: "chave_plataforma", falhou: true });
    expect(linha.cost_cents).toBe(3);
    expect(linha.origem_da_chave).toBe("assistente_chave_plataforma");
    expect(linha.status).toBe("erro");
  });

  it("token inválido ou negativo vira zero, nunca NaN", () => {
    const linha = linhaDeLlmCallsDoVix({ ...USO, tokensDeEntrada: Number.NaN, tokensDeSaida: -5 });
    expect(linha.input_tokens).toBe(0);
    expect(linha.output_tokens).toBe(0);
  });
});

describe("registrar nunca derruba a conversa", () => {
  it("erro no update não lança", async () => {
    await expect(concluirUso(bancoEspiao({ erroNoUpdate: true }).admin, USO)).resolves.toBeUndefined();
  });

  it("banco lançando não lança", async () => {
    await expect(concluirUso(bancoEspiao({ lancar: true }).admin, USO)).resolves.toBeUndefined();
  });
});

describe("registrar a mensagem antes do modelo (não há limite a conferir)", () => {
  const entrada = { orgId: USO.orgId, userId: "33333333-3333-4333-8333-333333333333", conversaId: null, pagador: "assinatura_plataforma" };
  const comRpc = (resposta: { data: unknown; error: { message: string } | null }) => {
    const rpc = vi.fn(async (..._args: unknown[]) => resposta);
    return { admin: { rpc } as unknown as SupabaseClient, rpc };
  };

  it("registrada: devolve o id do uso, e o pedido ao banco não leva limite nenhum", async () => {
    const { admin, rpc } = comRpc({ data: USO.usoId, error: null });
    expect(await registrarMensagem(admin, entrada)).toEqual({ ok: true, usoId: USO.usoId });
    expect(rpc).toHaveBeenCalledWith("fn_assistente_registrar_mensagem", {
      p_org: entrada.orgId,
      p_user: entrada.userId,
      p_conversa: null,
      p_pagador: "assinatura_plataforma",
    });
  });

  it("erro de banco, ou resposta sem id: recusa (falha fechada)", async () => {
    expect(await registrarMensagem(comRpc({ data: null, error: { message: "x" } }).admin, entrada)).toEqual({ ok: false, motivo: "erro" });
    expect(await registrarMensagem(comRpc({ data: null, error: null }).admin, entrada)).toEqual({ ok: false, motivo: "erro" });
  });
});

describe("quem tem o assistente", () => {
  const comAcesso = (data: unknown, error: { message: string } | null = null) =>
    ({ rpc: vi.fn(async (..._args: unknown[]) => ({ data, error })) }) as unknown as SupabaseClient;

  it.each(["marca", "assinatura_ativa"] as const)("porta %s: tem, com o freio técnico e os tetos fixos", async (porta) => {
    expect(await configDoVix(comAcesso(porta), USO.orgId)).toEqual({
      origem: porta,
      limiteDeLote: LIMITE_DE_LOTE,
      ferramentasPorTurno: FERRAMENTAS_POR_TURNO,
      mensagensPorMinuto: MENSAGENS_POR_MINUTO_PADRAO,
      tamanhoMaximoDaMensagem: TAMANHO_MAXIMO_DA_MENSAGEM_PADRAO,
    });
  });

  it.each([null, "", "plano", "assinatura", "sim", 1])("resposta que não é uma das duas portas (%s): não tem", async (resposta) => {
    expect(await configDoVix(comAcesso(resposta), USO.orgId)).toBeNull();
  });

  it("erro de leitura: não tem (falha fechada)", async () => {
    expect(await configDoVix(comAcesso("assinatura_ativa", { message: "x" }), USO.orgId)).toBeNull();
  });

  it("a pergunta vai ao banco com a organização recebida", async () => {
    const admin = comAcesso("marca");
    await configDoVix(admin, USO.orgId);
    expect((admin as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith("fn_assistente_acesso_da_org", { p_org: USO.orgId });
  });
});

describe("freio técnico: os valores vêm da instalação e chave ruim não o afrouxa", () => {
  it("vazio: os padrões", async () => {
    expect(await freioDoVix()).toEqual({ mensagensPorMinuto: 6, tamanhoMaximoDaMensagem: 2000 });
  });

  it("valores válidos valem", async () => {
    instalacao.valores = { VIX_MENSAGENS_POR_MINUTO: "12", VIX_TAMANHO_MAXIMO_DA_MENSAGEM: "800" };
    expect(await freioDoVix()).toEqual({ mensagensPorMinuto: 12, tamanhoMaximoDaMensagem: 800 });
  });

  it.each([
    ["zero", "0", "0"],
    ["negativo", "-1", "-1"],
    ["texto", "ilimitado", "sem limite"],
    ["acima da faixa", "61", "4001"],
    ["decimal", "6.5", "2000.5"],
    ["enorme", "99999999", "99999999"],
  ])("%s: cai no padrão, nunca em 'sem freio'", async (_caso, porMinuto, tamanho) => {
    instalacao.valores = { VIX_MENSAGENS_POR_MINUTO: porMinuto, VIX_TAMANHO_MAXIMO_DA_MENSAGEM: tamanho };
    expect(await freioDoVix()).toEqual({ mensagensPorMinuto: 6, tamanhoMaximoDaMensagem: 2000 });
  });

  it("o tamanho configurado nunca passa do teto absoluto", () => {
    expect(TAMANHO_MAXIMO_ABSOLUTO).toBe(4000);
  });
});
