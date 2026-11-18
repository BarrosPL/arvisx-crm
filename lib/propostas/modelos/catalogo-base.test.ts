import { describe, expect, it } from "vitest";
import { MODELOS_BASE } from "./catalogo-base";

const SLUGS_ESPERADOS = [
  "site_institucional",
  "landing_page",
  "ecommerce",
  "catalogo_imobiliario",
  "site_profissional",
  "sistema_web",
  "automacao",
  "projeto_personalizado",
  // O genérico: serve a qualquer negócio (os oito acima são de agência de site).
  "proposta_comercial",
];

describe("MODELOS_BASE — catálogo de modelos da plataforma (código, não banco)", () => {
  it("tem os 8 modelos-piloto (pacote de modelos do dono, trazido em 25/09/2026) e o genérico", () => {
    expect(Object.keys(MODELOS_BASE).sort()).toEqual([...SLUGS_ESPERADOS].sort());
  });

  it("é um objeto congelado — ninguém muta o catálogo em runtime", () => {
    expect(Object.isFrozen(MODELOS_BASE)).toBe(true);
  });

  it.each(SLUGS_ESPERADOS)("%s: slug bate com a chave, version é número, tem pelo menos 1 seção", (slug) => {
    const modelo = MODELOS_BASE[slug]!;
    expect(modelo.slug).toBe(slug);
    expect(typeof modelo.version).toBe("number");
    expect(modelo.sections.length).toBeGreaterThan(0);
  });

  it.each(SLUGS_ESPERADOS)("%s: sectionOrder não tem id fantasma nem deixa seção de fora", (slug) => {
    const modelo = MODELOS_BASE[slug]!;
    const idsDasSecoes = modelo.sections.map((s) => s.id).sort();
    const idsDaOrdem = [...modelo.sectionOrder].sort();
    expect(idsDaOrdem).toEqual(idsDasSecoes);
  });
});

describe("proposta_comercial — o modelo genérico", () => {
  const modelo = MODELOS_BASE.proposta_comercial!;
  const texto = modelo.sections.map((s) => `${s.title}\n${s.body}`).join("\n");

  it("não cita ramo nenhum: nada de site, página, sistema ou loja", () => {
    expect(texto).not.toMatch(/\b(site|sites|página|páginas|sistema|e-commerce|loja|imóve|landing)\b/i);
  });

  it("só usa variáveis que os modelos-piloto já usam (o motor já sabe preenchê-las)", () => {
    const variaveisDosPilotos = new Set(
      Object.values(MODELOS_BASE)
        .filter((m) => m.slug !== "proposta_comercial")
        .flatMap((m) => m.sections.flatMap((s) => s.body.match(/\{\{[a-z_.]+\}\}/g) ?? [])),
    );
    const doGenerico = texto.match(/\{\{[a-z_.]+\}\}/g) ?? [];
    expect(doGenerico.length).toBeGreaterThan(0);
    expect(doGenerico.filter((v) => !variaveisDosPilotos.has(v))).toEqual([]);
  });

  it("tem o mínimo de uma proposta: o que inclui, o investimento, a validade e a aprovação", () => {
    for (const id of ["included", "investment", "terms", "approval"]) {
      expect(modelo.sections.find((s) => s.id === id)?.required, id).toBe(true);
    }
    expect(texto).toContain("{{commercial_terms.validity_days}}");
    expect(texto).toContain("{{investment.total_formatted}}");
  });
});
