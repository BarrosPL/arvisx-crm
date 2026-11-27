import { describe, expect, it, vi } from "vitest";

const caidas = vi.hoisted(() => ({ valor: [] as unknown[] | "erro" }));
vi.mock("@/lib/channels/health", () => ({
  listarConexoesCaidas: async () => {
    if (caidas.valor === "erro") throw new Error("falhou");
    return caidas.valor;
  },
}));

import { descreverImplantacao, lerImplantacao } from "./implantacao";

/** Um cliente de mentira: cada tabela responde com a contagem combinada (ou erro). */
function banco(contagens: Record<string, number | "erro">, publicados = 0) {
  return {
    from: (tabela: string) => {
      let soPublicados = false;
      const cadeia: Record<string, unknown> = {};
      const resposta = () => {
        const n = soPublicados ? publicados : contagens[tabela];
        return n === "erro" || n === undefined ? { count: null, error: { message: "x" } } : { count: n, error: null };
      };
      for (const m of ["select", "eq", "is"]) cadeia[m] = () => cadeia;
      cadeia.not = () => {
        soPublicados = true;
        return cadeia;
      };
      cadeia.then = (ok: (v: unknown) => unknown) => Promise.resolve(resposta()).then(ok);
      return cadeia;
    },
  } as never;
}

describe("lerImplantacao", () => {
  it("conta nova: tudo falta, só a pessoa que criou está na equipe", async () => {
    caidas.valor = [];
    const i = await lerImplantacao(
      banco({ channel_sessions: 0, ai_agents: 0, ai_knowledge_sources: 0, contacts: 0, user_organizations: 1 }),
      "org",
    );
    expect(i.passos.every((p) => p.situacao === "pendente")).toBe(true);
    expect(i.completa).toBe(false);
    expect(i.feitos).toBe(0);
  });

  it("canal caído não conta como conectado", async () => {
    caidas.valor = [{}];
    const i = await lerImplantacao(banco({ channel_sessions: 1, ai_agents: 0, ai_knowledge_sources: 0, contacts: 0, user_organizations: 1 }), "org");
    expect(i.passos.find((p) => p.passo === "canal")?.situacao).toBe("pendente");
  });

  it("conta montada: completa", async () => {
    caidas.valor = [];
    const i = await lerImplantacao(
      banco({ channel_sessions: 2, ai_agents: 1, ai_knowledge_sources: 3, contacts: 40, user_organizations: 4 }, 1),
      "org",
    );
    expect(i.completa).toBe(true);
    expect(i.feitos).toBe(i.total);
  });

  it("falha ao ler um passo: vira desconhecido, não derruba os outros nem finge que falta", async () => {
    caidas.valor = "erro";
    const i = await lerImplantacao(banco({ channel_sessions: 1, ai_agents: "erro", ai_knowledge_sources: 1, contacts: 1, user_organizations: 2 }, 1), "org");
    const situ = Object.fromEntries(i.passos.map((p) => [p.passo, p.situacao]));
    expect(situ.canal).toBe("desconhecido");
    expect(situ.agente).toBe("desconhecido");
    expect(situ.conhecimento).toBe("feito");
    expect(i.completa).toBe(true); // nada pendente: só não deu para conferir
  });
});

describe("descreverImplantacao", () => {
  it("usa o nome que a pessoa lê e nunca nome de tabela ou rota", () => {
    const texto = descreverImplantacao({
      passos: [{ passo: "agente", situacao: "pendente" }, { passo: "canal", situacao: "desconhecido" }],
      completa: false,
      feitos: 0,
      total: 2,
    });
    expect(texto).toContain("Criar o primeiro agente de IA: FALTA");
    expect(texto).toContain("não consegui conferir");
    expect(texto).not.toMatch(/ai_agents|channel_sessions|\/app\//);
  });
});
