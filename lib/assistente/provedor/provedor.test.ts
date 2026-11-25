/**
 * A COSTURA DO PROVEDOR DO VIX: uma chave escolhe o pagador, e só ele é tentado.
 *
 * Nenhuma chamada sai para a rede e nenhuma chave real é lida: a configuração
 * da instalação, o leitor da assinatura, o leitor da chave de plataforma e a
 * fábrica do modelo são trocados por dublês, e o que se mede é QUEM foi
 * chamado, COM O QUÊ, e o que saiu.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { lerLoginCodexRenovandoSeProxima, renovarAssinaturaNoTurno } from "@/lib/ai/credenciais/login-codex";
import { buildModel, chaveDePlataforma } from "@/lib/ai/runtime/agent";
import { valorDaInstalacao } from "@/lib/instalacao/config";

vi.mock("@/lib/instalacao/config", () => ({ valorDaInstalacao: vi.fn() }));
vi.mock("@/lib/ai/credenciais/login-codex", () => ({
  lerLoginCodexRenovandoSeProxima: vi.fn(),
  renovarAssinaturaNoTurno: vi.fn(),
}));
vi.mock("@/lib/ai/runtime/agent", () => ({
  buildModel: vi.fn((provedor: string, chave: string, modelo: string) => ({ dubleDeModelo: true, provedor, chave, modelo })),
  chaveDePlataforma: vi.fn(),
}));

const { pagadorDoVix, provedorDoVix } = await import("./index");

const DESIGNADA = "d0000000-0000-4000-8000-00000000000d";
const TOKEN = ["token", "de", "acesso", "do", "teste"].join("-");
const TOKEN_NOVO = ["token", "renovado", "do", "teste"].join("-");
const CHAVE_FALSA = ["chave", "falsa", "da", "plataforma"].join("-");

let config: Record<string, string | null>;
let org: { id: string; status: string } | null;

/** O cliente de serviço de mentira: só responde pela organização designada. */
const admin = {
  from: (tabela: string) => ({
    select: () => ({
      eq: (_coluna: string, valor: string) => ({
        maybeSingle: async () => ({
          data: tabela === "organizations" && org && org.id === valor ? org : null,
          error: null,
        }),
      }),
    }),
  }),
} as never;

function tokens(access: string) {
  return {
    access_token: access,
    refresh_token: "refresh-do-teste",
    client_id: "cliente",
    email: "conta-da-plataforma@exemplo.test",
    scopes: ["chatgpt.tokens.use.direct"],
    expires_at: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  config = { VIX_PAGADOR: "assinatura_plataforma", VIX_ORGANIZACAO_DA_CONTA: DESIGNADA, VIX_MODELO: "modelo-da-conta" };
  org = { id: DESIGNADA, status: "active" };
  vi.mocked(valorDaInstalacao).mockImplementation(async (chave: string) => ({ valor: config[chave] ?? null }) as never);
  vi.mocked(lerLoginCodexRenovandoSeProxima).mockResolvedValue(tokens(TOKEN) as never);
  vi.mocked(renovarAssinaturaNoTurno).mockResolvedValue({ ok: true, tokens: tokens(TOKEN_NOVO) } as never);
  vi.mocked(chaveDePlataforma).mockReturnValue(CHAVE_FALSA);
});

describe("VIX_PAGADOR: a chave que liga, desliga e escolhe", () => {
  it.each([null, "", "  ", "ligado", "sim", "anthropic", "assinatura", "DESLIGADO"])(
    "ausente, vazio ou desconhecido (%s) vale desligado",
    async (valor) => {
      config.VIX_PAGADOR = valor;
      expect(await pagadorDoVix()).toBe("desligado");
      expect(await provedorDoVix(admin)).toEqual({ disponivel: false, pagador: "desligado", motivo: "desligado" });
    },
  );

  it("desligado não lê conta, não lê chave e não monta modelo", async () => {
    config.VIX_PAGADOR = "desligado";
    await provedorDoVix(admin);
    expect(lerLoginCodexRenovandoSeProxima).not.toHaveBeenCalled();
    expect(chaveDePlataforma).not.toHaveBeenCalled();
    expect(buildModel).not.toHaveBeenCalled();
  });

  it("aceita os três valores, sem diferenciar caixa nem espaços", async () => {
    config.VIX_PAGADOR = "  Assinatura_Plataforma ";
    expect(await pagadorDoVix()).toBe("assinatura_plataforma");
    config.VIX_PAGADOR = "chave_plataforma";
    expect(await pagadorDoVix()).toBe("chave_plataforma");
  });
});

describe("assinatura_plataforma", () => {
  it("pronta: lê a conta da organização DESIGNADA e monta o modelo com o token dela (controle positivo)", async () => {
    const p = await provedorDoVix(admin);
    expect(p.disponivel).toBe(true);
    expect(lerLoginCodexRenovandoSeProxima).toHaveBeenCalledWith({ admin, orgId: DESIGNADA });
    expect(buildModel).toHaveBeenCalledWith("openai-assinatura", TOKEN, "modelo-da-conta");
    expect(p).toMatchObject({ pagador: "assinatura_plataforma", origemDaChave: "assinatura_plataforma", modelo: "modelo-da-conta" });
  });

  it("o que sai da costura não carrega token, e-mail da conta nem a organização designada", async () => {
    const p = await provedorDoVix(admin);
    // O modelo de verdade é opaco; aqui o dublê guarda a chave, então ele fica de fora da conferência.
    const { model: _model, ...resto } = p as unknown as Record<string, unknown>;
    const exposto = JSON.stringify(resto);
    for (const proibido of [TOKEN, "refresh-do-teste", "conta-da-plataforma@exemplo.test", DESIGNADA]) {
      expect(exposto, `a costura expôs "${proibido}"`).not.toContain(proibido);
    }
  });

  it("custo de uma chamada por assinatura é zero, sejam quantos forem os tokens", async () => {
    const p = await provedorDoVix(admin);
    expect(p.disponivel && p.custoUsdCents({ entrada: 1_000_000, saida: 500_000 })).toBe(0);
  });

  it.each([
    ["sem organização designada", (): void => { config.VIX_ORGANIZACAO_DA_CONTA = ""; }, "sem_organizacao_designada"],
    ["organização designada que não é uuid", (): void => { config.VIX_ORGANIZACAO_DA_CONTA = "nao-e-uuid"; }, "organizacao_designada_invalida"],
    ["organização designada que não existe", (): void => { org = null; }, "organizacao_designada_invalida"],
    ["organização designada suspensa", (): void => { org = { id: DESIGNADA, status: "suspended" }; }, "organizacao_designada_invalida"],
    ["sem modelo escolhido", (): void => { config.VIX_MODELO = ""; }, "sem_modelo"],
    ["conta não conectada (ou módulo de login desligado)", (): void => { vi.mocked(lerLoginCodexRenovandoSeProxima).mockResolvedValue(null); }, "sem_conta"],
  ] as const)("%s: indisponível, sem modelo, e SEM cair para a chave de API", async (_caso, preparar, motivo) => {
    preparar();
    expect(await provedorDoVix(admin)).toEqual({ disponivel: false, pagador: "assinatura_plataforma", motivo });
    expect(buildModel).not.toHaveBeenCalled();
    expect(chaveDePlataforma).not.toHaveBeenCalled();
  });

  it("organização inválida nem chega a ler a conta", async () => {
    config.VIX_ORGANIZACAO_DA_CONTA = "nao-e-uuid";
    await provedorDoVix(admin);
    expect(lerLoginCodexRenovandoSeProxima).not.toHaveBeenCalled();
  });

  it("renovação no 401: reaproveita a renovação existente, com a organização designada, e devolve modelo com o token novo", async () => {
    const p = await provedorDoVix(admin);
    if (!p.disponivel || !p.renovarApos401) throw new Error("a assinatura precisa expor a renovação");
    const novo = (await p.renovarApos401()) as unknown as { chave: string };
    expect(renovarAssinaturaNoTurno).toHaveBeenCalledTimes(1);
    expect(renovarAssinaturaNoTurno).toHaveBeenCalledWith({ admin, orgId: DESIGNADA });
    expect(novo.chave).toBe(TOKEN_NOVO);
  });

  it.each(["em_curso", "nao_encontrada", "falha", "modulo_desligado"] as const)(
    "renovação recusada (%s): devolve nulo e não cai para a chave de API",
    async (motivo) => {
      vi.mocked(renovarAssinaturaNoTurno).mockResolvedValue({ ok: false, motivo } as never);
      const p = await provedorDoVix(admin);
      if (!p.disponivel || !p.renovarApos401) throw new Error("a assinatura precisa expor a renovação");
      expect(await p.renovarApos401()).toBeNull();
      expect(chaveDePlataforma).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ statusCode: 429 }, "limite_de_uso"],
    [{ statusCode: 402 }, "limite_de_uso"],
    [{ statusCode: 400, message: "Subscription Sharing usage limit exceeded" }, "limite_de_uso"],
    [{ statusCode: 401, message: "Provided authentication token is expired" }, "token_expirado"],
    [{ statusCode: 401, message: "unauthorized" }, "sem_autorizacao"],
    [{ statusCode: 403, message: "forbidden" }, "sem_autorizacao"],
    [{ statusCode: 500 }, "falha_do_provedor"],
    [{ statusCode: 400, message: "invalid request" }, "erro_de_pedido"],
    [{ message: "fetch failed" }, "rede"],
  ] as const)("classifica a falha %j como %s", async (erro, motivo) => {
    const p = await provedorDoVix(admin);
    expect(p.disponivel && p.classificarFalha(erro)).toBe(motivo);
  });
});

describe("chave_plataforma", () => {
  beforeEach(() => {
    config.VIX_PAGADOR = "chave_plataforma";
  });

  it("pronta: modelo pequeno fixo pela chave de plataforma, com origem própria (controle positivo)", async () => {
    const p = await provedorDoVix(admin);
    expect(p).toMatchObject({
      disponivel: true,
      pagador: "chave_plataforma",
      origemDaChave: "assistente_chave_plataforma",
      provedor: "anthropic",
      modelo: "claude-haiku-5-5",
    });
    expect(chaveDePlataforma).toHaveBeenCalledWith("anthropic");
    expect(buildModel).toHaveBeenCalledWith("anthropic", CHAVE_FALSA, "claude-haiku-5-5");
  });

  it("não toca a assinatura nem a organização designada", async () => {
    await provedorDoVix(admin);
    expect(lerLoginCodexRenovandoSeProxima).not.toHaveBeenCalled();
    expect(renovarAssinaturaNoTurno).not.toHaveBeenCalled();
  });

  it("o custo é o real, pela tabela de preços do motor: cresce com os tokens e não é zero", async () => {
    const p = await provedorDoVix(admin);
    if (!p.disponivel) throw new Error("devia estar disponível");
    const pouco = p.custoUsdCents({ entrada: 1_000, saida: 1_000 });
    const muito = p.custoUsdCents({ entrada: 1_000_000, saida: 1_000_000 });
    expect(pouco).toBeGreaterThan(0);
    expect(muito).toBeGreaterThan(pouco);
  });

  it("não tem renovação (não é assinatura) e não expõe a chave", async () => {
    const p = await provedorDoVix(admin);
    if (!p.disponivel) throw new Error("devia estar disponível");
    expect(p.renovarApos401).toBeUndefined();
    const { model: _model, ...resto } = p as unknown as Record<string, unknown>;
    expect(JSON.stringify(resto)).not.toContain(CHAVE_FALSA);
  });

  it("sem a chave no servidor: indisponível, e não tenta a assinatura", async () => {
    vi.mocked(chaveDePlataforma).mockReturnValue(null);
    expect(await provedorDoVix(admin)).toEqual({ disponivel: false, pagador: "chave_plataforma", motivo: "sem_chave" });
    expect(lerLoginCodexRenovandoSeProxima).not.toHaveBeenCalled();
    expect(buildModel).not.toHaveBeenCalled();
  });
});
