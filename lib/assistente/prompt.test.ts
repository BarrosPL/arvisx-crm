import { describe, expect, it } from "vitest";

import { montarPrompt } from "./prompt";

const base = { papel: "admin" as const, idioma: "pt-BR" as never, nomeDoUsuario: "Ana", telaAtual: "/app/inbox", podePropor: false };

describe("o prompt do Vix", () => {
  it("manda falar pelo que a pessoa vê e proíbe rota, Guia e mandar procurar material", () => {
    const p = montarPrompt(base);
    expect(p).toMatch(/COMO VOCÊ FALA/);
    expect(p).toMatch(/NUNCA escreva endereço, rota/);
    expect(p).toMatch(/NUNCA mande a pessoa procurar, ler ou consultar/);
  });

  it("não ensina nenhuma rota ao modelo: as telas só-pela-tela vão pelo nome do menu", () => {
    // A frase de proibição cita "/app/..." como exemplo do que NÃO escrever; tirando-a, não sobra endereço.
    const p = montarPrompt(base).replace(/\(nada com \/app\/\.\.\.\)/, "");
    expect(p).not.toMatch(/\/app\//);
  });

  it("conta em montagem: vira consultor de implantação e recebe o que já está pronto, como dado", () => {
    const p = montarPrompt({ ...base, implantacao: "- Criar o primeiro agente de IA: FALTA" });
    expect(p).toMatch(/AINDA ESTÁ MONTANDO/);
    expect(p).toMatch(/O QUE JÁ ESTÁ PRONTO NESTA EMPRESA/);
    expect(p).toContain("Criar o primeiro agente de IA: FALTA");
    expect(p).toMatch(/UM passo|um passo/);
  });

  it("conta pronta: o mesmo Vix, sem o foco de implantação", () => {
    const p = montarPrompt({ ...base, implantacao: null });
    expect(p).not.toMatch(/AINDA ESTÁ MONTANDO/);
    expect(p).toMatch(/UM assistente só/);
  });

  it("só pede texto de fala quando a resposta será lida em voz alta", () => {
    expect(montarPrompt(base)).not.toMatch(/LIDA EM VOZ ALTA/);
    expect(montarPrompt({ ...base, respostaEmVoz: true })).toMatch(/LIDA EM VOZ ALTA/);
  });
});
