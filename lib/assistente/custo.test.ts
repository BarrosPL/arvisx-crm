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
 *  - erro ao contar a mensagem recusa (falha fechada), e o limite atingido é
 *    distinguido do erro.
 *
 * O que NÃO prova: que `llm_calls` aceita a linha. A coluna `origem_da_chave`
 * ainda não existe na `main` (vem da migration 9825, de outra entrega), e por
 * isso o destino fica desligado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  COLUNA_DA_ORIGEM_DA_CHAVE,
  REGISTRAR_EM_LLM_CALLS,
  concluirUso,
  linhaDeLlmCallsDoVix,
  registrarMensagem,
  type UsoDeUmaResposta,
} from "./custo";

const USO: UsoDeUmaResposta = {
  orgId: "11111111-1111-4111-8111-111111111111",
  usoId: "22222222-2222-4222-8222-222222222222",
  provedor: "openai-codex",
  modelo: "modelo-de-teste",
  tokensDeEntrada: 1234.4,
  tokensDeSaida: 56,
  falhou: false,
  custoUsdCents: 0,
  origemDaChave: "assinatura_plataforma",
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
    const linha = linhaDeLlmCallsDoVix({ ...USO, custoUsdCents: 3, origemDaChave: "assistente_chave_plataforma", falhou: true });
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

describe("contar a mensagem antes do modelo", () => {
  const entrada = { orgId: USO.orgId, userId: "33333333-3333-4333-8333-333333333333", conversaId: null, pagador: "assinatura_plataforma", limite: 10 };
  const comRpc = (resposta: { data: unknown; error: { message: string } | null }) => {
    const rpc = vi.fn(async (..._args: unknown[]) => resposta);
    return { admin: { rpc } as unknown as SupabaseClient, rpc };
  };

  it("contada: devolve o id do uso e passa o limite do plano à função", async () => {
    const { admin, rpc } = comRpc({ data: USO.usoId, error: null });
    expect(await registrarMensagem(admin, entrada)).toEqual({ ok: true, usoId: USO.usoId });
    expect(rpc).toHaveBeenCalledWith("fn_assistente_registrar_mensagem", {
      p_org: entrada.orgId,
      p_user: entrada.userId,
      p_conversa: null,
      p_pagador: "assinatura_plataforma",
      p_limite: 10,
    });
  });

  it("função devolve nulo: limite atingido", async () => {
    expect(await registrarMensagem(comRpc({ data: null, error: null }).admin, entrada)).toEqual({ ok: false, motivo: "limite_atingido" });
  });

  it("erro de banco: recusa (falha fechada), e não é confundido com limite", async () => {
    expect(await registrarMensagem(comRpc({ data: null, error: { message: "x" } }).admin, entrada)).toEqual({ ok: false, motivo: "erro" });
  });
});
