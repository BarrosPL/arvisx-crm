import { afterEach, describe, expect, it, vi } from "vitest";

import { atualizacaoPelaTelaLigada } from "./atualizacao-pela-tela";

/**
 * ArvisX: o painel "Atualizar pela UI" vem DESLIGADO. Só `on` liga — qualquer
 * outra coisa (inclusive `true`, `1`, `yes`) deixa desligado, para que um valor
 * digitado errado no Easypanel nunca ligue sozinho o caminho que puxa do upstream.
 */
describe("atualizacaoPelaTelaLigada", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ausente = desligado (o padrão do fork)", () => {
    vi.stubEnv("ATUALIZACAO_PELA_TELA", undefined);
    expect(atualizacaoPelaTelaLigada()).toBe(false);
  });

  it("vazio = desligado", () => {
    vi.stubEnv("ATUALIZACAO_PELA_TELA", "");
    expect(atualizacaoPelaTelaLigada()).toBe(false);
  });

  it("`on` liga, lido de process.env na hora da chamada", () => {
    vi.stubEnv("ATUALIZACAO_PELA_TELA", "on");
    expect(atualizacaoPelaTelaLigada()).toBe(true);
    vi.stubEnv("ATUALIZACAO_PELA_TELA", "off");
    expect(atualizacaoPelaTelaLigada()).toBe(false);
  });

  it("tolera caixa e espaço em volta do `on`", () => {
    expect(atualizacaoPelaTelaLigada(" ON ")).toBe(true);
    expect(atualizacaoPelaTelaLigada("On")).toBe(true);
  });

  it.each(["true", "1", "yes", "ligado", "off", "o n"])("`%s` não liga", (valor) => {
    expect(atualizacaoPelaTelaLigada(valor)).toBe(false);
  });
});
