import { describe, expect, it } from "vitest";

import { dividirEmFrases, escolherVoz, idiomaDaFala, textoParaFalar } from "./voz";

const voz = (name: string, lang: string, localService = true) => ({ name, lang, localService }) as SpeechSynthesisVoice;

describe("escolherVoz", () => {
  it("prefere a voz neural do português do Brasil à voz comum do sistema", () => {
    const escolhida = escolherVoz(
      [
        voz("Microsoft Maria Desktop", "pt-BR"),
        voz("Microsoft Francisca Online (Natural) - Portuguese (Brazil)", "pt-BR", false),
        voz("Samantha", "en-US"),
      ],
      "pt-BR",
    );
    expect(escolhida?.name).toContain("Francisca");
  });

  it("português de Portugal só entra se não houver do Brasil", () => {
    expect(escolherVoz([voz("Joana", "pt-PT"), voz("Luciana", "pt-BR")], "pt-BR")?.name).toBe("Luciana");
    expect(escolherVoz([voz("Joana", "pt-PT")], "pt-BR")?.name).toBe("Joana");
  });

  it("sem voz do idioma, devolve null (o navegador usa a dele)", () => {
    expect(escolherVoz([voz("Samantha", "en-US")], "pt-BR")).toBeNull();
    expect(escolherVoz([], "pt-BR")).toBeNull();
  });
});

describe("textoParaFalar", () => {
  it("tira markdown, emoji, link e símbolos que a voz leria em voz alta", () => {
    const falado = textoParaFalar("**Passo 1:** clique em `Canais` 😀\n- depois em [Conectar](https://x.com/app/a)\nVeja https://x.com");
    expect(falado).not.toMatch(/[*`\[\]]|https?:|😀/);
    expect(falado).toContain("Passo 1: clique em Canais");
    expect(falado).toContain("depois em Conectar");
  });

  it("não lê bloco de código", () => {
    expect(textoParaFalar("Veja:\n```\nselect 1\n```\nPronto.")).not.toContain("select");
  });
});

describe("dividirEmFrases", () => {
  it("separa por frase e quebra a frase longa demais", () => {
    expect(dividirEmFrases("Oi. Tudo bem? Sim!")).toEqual(["Oi.", "Tudo bem?", "Sim!"]);
    const longa = "a".repeat(500);
    expect(dividirEmFrases(longa, 220).every((f) => f.length <= 220)).toBe(true);
  });
});

describe("idiomaDaFala", () => {
  it("segue o idioma da interface; sem informação, português do Brasil", () => {
    expect(idiomaDaFala("en")).toBe("en-US");
    expect(idiomaDaFala("es-MX")).toBe("es-ES");
    expect(idiomaDaFala("pt-BR")).toBe("pt-BR");
    expect(idiomaDaFala("")).toBe("pt-BR");
    expect(idiomaDaFala(null)).toBe("pt-BR");
  });
});
