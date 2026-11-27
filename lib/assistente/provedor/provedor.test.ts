/**
 * A COSTURA DO PROVEDOR DO VIX: uma chave escolhe o pagador, e só ele é tentado.
 *
 * Nenhuma chamada sai para a rede e nenhuma chave real é lida: a configuração
 * da instalação, o leitor da chave de plataforma e a fábrica do modelo são
 * trocados por dublês, e o que se mede é QUEM foi chamado, COM O QUÊ, e o que
 * saiu.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildModel, chaveDePlataforma } from "@/lib/ai/runtime/agent";
import { valorDaInstalacao } from "@/lib/instalacao/config";

vi.mock("@/lib/instalacao/config", () => ({ valorDaInstalacao: vi.fn() }));
vi.mock("@/lib/ai/runtime/agent", () => ({
  buildModel: vi.fn((provedor: string, chave: string, modelo: string) => ({ dubleDeModelo: true, provedor, chave, modelo })),
  chaveDePlataforma: vi.fn(),
}));

const { pagadorDoVix, provedorDoVix } = await import("./index");

const URL_DO_HERMES = "https://hermes.exemplo.test/p/vix-crm";
const SEGREDO = ["segredo", "falso", "do", "hermes", "123456"].join("-");
const CHAVE_FALSA = ["chave", "falsa", "da", "plataforma"].join("-");

let config: Record<string, string | null>;

beforeEach(() => {
  vi.clearAllMocks();
  config = { VIX_PAGADOR: "hermes", VIX_HERMES_URL: URL_DO_HERMES, VIX_HERMES_SEGREDO: SEGREDO };
  vi.mocked(valorDaInstalacao).mockImplementation(async (chave: string) => ({ valor: config[chave] ?? null }) as never);
  vi.mocked(chaveDePlataforma).mockReturnValue(CHAVE_FALSA);
});

describe("VIX_PAGADOR: a chave que liga, desliga e escolhe", () => {
  it.each([null, "", "  ", "ligado", "sim", "anthropic", "assinatura", "assinatura_plataforma", "DESLIGADO"])(
    "ausente, vazio ou desconhecido (%s) vale desligado",
    async (valor) => {
      config.VIX_PAGADOR = valor;
      expect(await pagadorDoVix()).toBe("desligado");
      expect(await provedorDoVix()).toEqual({ disponivel: false, pagador: "desligado", motivo: "desligado" });
    },
  );

  it("desligado não lê nenhuma chave nem endereço", async () => {
    config.VIX_PAGADOR = "desligado";
    await provedorDoVix();
    expect(vi.mocked(valorDaInstalacao).mock.calls.map((c) => c[0])).toEqual(["VIX_PAGADOR"]);
    expect(chaveDePlataforma).not.toHaveBeenCalled();
  });

  it("aceita os dois valores ligados, sem diferenciar caixa nem espaços", async () => {
    config.VIX_PAGADOR = "  HERMES ";
    expect(await pagadorDoVix()).toBe("hermes");
    config.VIX_PAGADOR = " Chave_Plataforma";
    expect(await pagadorDoVix()).toBe("chave_plataforma");
  });
});

describe("hermes", () => {
  it("pronto: modelo do Hermes, custo zero e a origem da assinatura (controle positivo)", async () => {
    const p = await provedorDoVix();
    expect(p).toMatchObject({ disponivel: true, pagador: "hermes", provedor: "hermes", modelo: "vix-crm" });
    if (!p.disponivel) throw new Error("devia estar disponível");
    expect(p.custoUsdCents({ entrada: 1_000_000, saida: 1_000_000 })).toBe(0);
  });

  it("não toca a chave de plataforma dos agentes", async () => {
    await provedorDoVix();
    expect(chaveDePlataforma).not.toHaveBeenCalled();
    expect(buildModel).not.toHaveBeenCalled();
  });

  it("não expõe o segredo nem o endereço fora do modelo", async () => {
    const p = await provedorDoVix();
    if (!p.disponivel) throw new Error("devia estar disponível");
    const { model: _model, ...resto } = p as unknown as Record<string, unknown>;
    const texto = JSON.stringify(resto);
    expect(texto).not.toContain(SEGREDO);
    expect(texto).not.toContain("hermes.exemplo.test");
  });

  it("não tem renovação nem queda para outro pagador", async () => {
    const p = await provedorDoVix();
    if (!p.disponivel) throw new Error("devia estar disponível");
    expect((p as unknown as Record<string, unknown>).renovarApos401).toBeUndefined();
  });

  it.each([
    ["sem endereço", (): void => { config.VIX_HERMES_URL = ""; }],
    ["endereço que não é uma URL", (): void => { config.VIX_HERMES_URL = "hermes sem url"; }],
    ["endereço http com nome público", (): void => { config.VIX_HERMES_URL = "http://hermes.exemplo.test/p/vix-crm"; }],
    ["endereço com usuário e senha embutidos", (): void => { config.VIX_HERMES_URL = "https://u:s@hermes.exemplo.test/p/vix-crm"; }],
    ["endereço com parâmetros na URL", (): void => { config.VIX_HERMES_URL = "https://hermes.exemplo.test/p/vix-crm?x=1"; }],
    ["sem segredo", (): void => { config.VIX_HERMES_SEGREDO = ""; }],
    ["segredo curto demais", (): void => { config.VIX_HERMES_SEGREDO = "curto"; }],
  ])("%s: indisponível (sem_hermes), sem modelo, e SEM cair para a chave de API", async (_nome, quebrar) => {
    quebrar();
    expect(await provedorDoVix()).toEqual({ disponivel: false, pagador: "hermes", motivo: "sem_hermes" });
    expect(chaveDePlataforma).not.toHaveBeenCalled();
    expect(buildModel).not.toHaveBeenCalled();
  });

  it("http em máquina local vale (desenvolvimento)", async () => {
    config.VIX_HERMES_URL = "http://localhost:8642/p/vix-crm";
    expect(await provedorDoVix()).toMatchObject({ disponivel: true, pagador: "hermes" });
  });

  it.each([
    [{ statusCode: 429 }, "limite_de_uso"],
    [{ statusCode: 402 }, "limite_de_uso"],
    [{ statusCode: 401, message: "unauthorized" }, "sem_autorizacao"],
    [{ statusCode: 403, message: "forbidden" }, "sem_autorizacao"],
    [{ statusCode: 500 }, "falha_do_provedor"],
    [{ statusCode: 502 }, "falha_do_provedor"],
    [{ statusCode: 400, message: "invalid request" }, "erro_de_pedido"],
    [{ message: "sem conexão com o Hermes" }, "rede"],
  ] as const)("classifica a falha %j como %s", async (erro, motivo) => {
    const p = await provedorDoVix();
    expect(p.disponivel && p.classificarFalha(erro)).toBe(motivo);
  });

  it("resposta que o CRM não entende vira resposta_invalida", async () => {
    const { RespostaInvalidaDoHermes } = await import("./modelo-hermes");
    const p = await provedorDoVix();
    expect(p.disponivel && p.classificarFalha(new RespostaInvalidaDoHermes())).toBe("resposta_invalida");
  });
});

describe("chave_plataforma", () => {
  beforeEach(() => {
    config.VIX_PAGADOR = "chave_plataforma";
  });

  it("pronta: modelo pequeno fixo pela chave de plataforma, com origem própria (controle positivo)", async () => {
    const p = await provedorDoVix();
    expect(p).toMatchObject({
      disponivel: true,
      pagador: "chave_plataforma",
      provedor: "anthropic",
      modelo: "claude-haiku-5-5",
    });
    expect(chaveDePlataforma).toHaveBeenCalledWith("anthropic");
    expect(buildModel).toHaveBeenCalledWith("anthropic", CHAVE_FALSA, "claude-haiku-5-5");
  });

  it("não toca o Hermes", async () => {
    await provedorDoVix();
    const lidas = vi.mocked(valorDaInstalacao).mock.calls.map((c) => c[0]);
    expect(lidas).not.toContain("VIX_HERMES_URL");
    expect(lidas).not.toContain("VIX_HERMES_SEGREDO");
  });

  it("o custo é o real, pela tabela de preços do motor: cresce com os tokens e não é zero", async () => {
    const p = await provedorDoVix();
    if (!p.disponivel) throw new Error("devia estar disponível");
    const pouco = p.custoUsdCents({ entrada: 1_000, saida: 1_000 });
    const muito = p.custoUsdCents({ entrada: 1_000_000, saida: 1_000_000 });
    expect(pouco).toBeGreaterThan(0);
    expect(muito).toBeGreaterThan(pouco);
  });

  it("não expõe a chave", async () => {
    const p = await provedorDoVix();
    if (!p.disponivel) throw new Error("devia estar disponível");
    const { model: _model, ...resto } = p as unknown as Record<string, unknown>;
    expect(JSON.stringify(resto)).not.toContain(CHAVE_FALSA);
  });

  it("sem a chave no servidor: indisponível, e não tenta o Hermes", async () => {
    vi.mocked(chaveDePlataforma).mockReturnValue(null);
    expect(await provedorDoVix()).toEqual({ disponivel: false, pagador: "chave_plataforma", motivo: "sem_chave" });
    expect(buildModel).not.toHaveBeenCalled();
  });
});
