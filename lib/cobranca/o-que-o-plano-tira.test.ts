/**
 * "O que o cliente perde em cada plano" (ArvisX, etapa 3): a lista sai do
 * catálogo e do `interface_settings` do plano, pela régua da trava
 * (`destinosDoPlano`). Os três planos do dono, 09/11/2026: Essencial =
 * simplificada; Standard = simplificada + o grupo `ia`; Premium = completa.
 */
import { describe, expect, it } from "vitest";

import { NAV_CATALOG, type NavMetadata } from "@/lib/navigation/catalogo";
import { DESTINOS_DA_SIMPLIFICADA, PORTAS_ESSENCIAIS, permitidos } from "@/lib/navigation/interface";

import { oQueOPlanoTira } from "./o-que-o-plano-tira";

const ESSENCIAL = { preset: "simplificada" };
const STANDARD = {
  preset: "simplificada",
  destinos: [...DESTINOS_DA_SIMPLIFICADA, ...NAV_CATALOG.filter((d) => d.group === "ia").map((d) => d.href)],
};
const PREMIUM = { preset: "completa" };

const grupos = (r: ReturnType<typeof oQueOPlanoTira>) => r.map((g) => g.grupo);
const todasAsTelas = (r: ReturnType<typeof oQueOPlanoTira>) => r.flatMap((g) => g.telas);

describe("oQueOPlanoTira — gerado do catálogo, sem texto solto", () => {
  it("⭐ Premium (completa): não perde nada", () => {
    expect(oQueOPlanoTira(PREMIUM, [])).toEqual([]);
  });

  it("⭐ Essencial (simplificada): perde o Agente de IA inteiro, e nunca as telas da simplificada nem as essenciais", () => {
    const r = oQueOPlanoTira(ESSENCIAL, []);
    const ia = r.find((g) => g.grupo === "ia");
    expect(ia).toMatchObject({ rotulo: "Agente de IA", inteiro: true });
    // Exatamente as telas do grupo `ia` que o admin vê (a lista é o catálogo, não uma cópia).
    expect(ia?.telas).toEqual(permitidos(false, "admin", []).filter((d) => d.group === "ia").map((d) => d.label));
    // O grupo Atendimento perde só o que a simplificada não tem (ex.: Radar), nunca o grupo inteiro.
    expect(r.find((g) => g.grupo === "atendimento")?.inteiro ?? false).toBe(false);
    const perdidas = todasAsTelas(r);
    for (const href of [...DESTINOS_DA_SIMPLIFICADA, ...PORTAS_ESSENCIAIS]) {
      const tela = NAV_CATALOG.find((d) => d.href === href);
      if (tela) expect(perdidas).not.toContain(tela.label);
    }
  });

  it("⭐ Standard (simplificada + ia): perde o que o Essencial perde, MENOS o grupo Agente de IA", () => {
    const essencial = oQueOPlanoTira(ESSENCIAL, []);
    const standard = oQueOPlanoTira(STANDARD, []);
    expect(grupos(standard)).not.toContain("ia");
    expect(standard).toEqual(essencial.filter((g) => g.grupo !== "ia"));
    expect(standard.length).toBeGreaterThan(0);
  });

  it("tela de módulo opcional DESLIGADO não é perda de plano; ligado, entra na lista", () => {
    const comModulo = (NAV_CATALOG as readonly NavMetadata[]).find((d) => d.modulo !== undefined);
    expect(comModulo).toBeTruthy();
    const modulo = comModulo!.modulo!;
    expect(todasAsTelas(oQueOPlanoTira(ESSENCIAL, []))).not.toContain(comModulo!.label);
    // Ligado, a simplificada não o libera (o plano é estrito, como a trava): é perda.
    if (!(DESTINOS_DA_SIMPLIFICADA as readonly string[]).includes(comModulo!.href)) {
      expect(todasAsTelas(oQueOPlanoTira(ESSENCIAL, [modulo]))).toContain(comModulo!.label);
    }
  });
});
