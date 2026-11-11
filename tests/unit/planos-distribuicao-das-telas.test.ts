// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ROTAS_DE_API, regraDaRotaDeApi } from "@/lib/cobranca/rotas-do-plano";
import {
  planoIncluiIaParaOMotor,
  planoLibera,
  planoLiberaParaCron,
  type LeituraDoPlano,
} from "@/lib/cobranca/telas-do-plano";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import { essencial, permitidos } from "@/lib/navigation/interface";
import { interfaceDoPlanoSchema } from "@/lib/schemas/cobranca-plano";
import { DEGRAUS, ESSENCIAL, PLANOS, PREMIUM_A_MAIS, STANDARD_A_MAIS, type NomeDoPlano } from "../helpers/distribuicao-dos-planos";

/**
 * A DISTRIBUIÇÃO DAS TELAS NOS QUATRO PLANOS (ArvisX, tarefa 2 dos planos).
 *
 * A fonte é o SELETOR de telas do plano (`InterfaceEditor` em /admin/cobranca:
 * `permitidos(false, "admin")` sem as portas essenciais). Cada tela dele fica
 * em exatamente UM degrau; os planos de cima herdam os de baixo. Equipe
 * Completa = as telas do Premium (o que muda nele são os agentes da Arvisx).
 *
 * As listas são escritas À MÃO em tests/helpers/distribuicao-dos-planos.ts,
 * de propósito: não derivam do código. Este arquivo é a cerca que reprova
 * quando o catálogo ganha tela que ninguém classificou.
 */



function leituraDe(plano: NomeDoPlano): LeituraDoPlano {
  return { tipo: "plano", interface: interfaceDoPlanoSchema.parse({ preset: "completa", destinos: PLANOS[plano] }) };
}

/** O seletor de telas do plano, como /admin/cobranca o desenha. */
const SELETOR = permitidos(false, "admin").filter((d) => !essencial(d, "admin"));

describe("a distribuição bate com o seletor de telas", () => {
  it("12 + 19 + 32 = 63, o tamanho do seletor", () => {
    expect(ESSENCIAL).toHaveLength(12);
    expect(STANDARD_A_MAIS).toHaveLength(19);
    expect(PREMIUM_A_MAIS).toHaveLength(32);
    expect(SELETOR).toHaveLength(63);
  });

  it("nenhuma tela em dois degraus", () => {
    const todas = Object.values(DEGRAUS).flat();
    const repetidas = todas.filter((h, i) => todas.indexOf(h) !== i);
    expect(repetidas).toEqual([]);
  });

  it("toda tela do seletor tem degrau (tela nova sem classificação reprova aqui)", () => {
    const classificadas = new Set<string>(Object.values(DEGRAUS).flat());
    const semDegrau = SELETOR.filter((d) => !classificadas.has(d.href)).map((d) => `${d.href} (${d.label})`);
    expect(semDegrau).toEqual([]);
  });

  it("todo degrau aponta para tela do seletor (nada de tela essencial, removida ou inventada)", () => {
    const doSeletor = new Set<string>(SELETOR.map((d) => d.href));
    const catalogo = new Set<string>(NAV_CATALOG.map((d) => d.href));
    const fora = Object.values(DEGRAUS).flat().filter((h) => !doSeletor.has(h) || !catalogo.has(h));
    expect(fora).toEqual([]);
  });

  it("cada plano é aceito pelo schema das telas do plano, e o Equipe Completa = Premium", () => {
    for (const plano of Object.keys(PLANOS) as NomeDoPlano[]) {
      expect(() => leituraDe(plano)).not.toThrow();
    }
    expect([...PLANOS["Equipe Completa"]].sort()).toEqual([...PLANOS.Premium].sort());
  });
});

describe("o que cada plano roda", () => {
  it("o Essencial não roda IA; Standard, Premium e Equipe Completa rodam", () => {
    expect(planoIncluiIaParaOMotor(leituraDe("Essencial"))).toBe(false);
    expect(planoIncluiIaParaOMotor(leituraDe("Standard"))).toBe(true);
    expect(planoIncluiIaParaOMotor(leituraDe("Premium"))).toBe(true);
    expect(planoIncluiIaParaOMotor(leituraDe("Equipe Completa"))).toBe(true);
  });

  it("o Standard não roda Campanha nem Prospecção; Premium e Equipe Completa rodam", () => {
    for (const tela of ["/app/campaigns", "/app/prospecting"]) {
      expect(planoLiberaParaCron(leituraDe("Essencial"), tela)).toBe(false);
      expect(planoLiberaParaCron(leituraDe("Standard"), tela)).toBe(false);
      expect(planoLiberaParaCron(leituraDe("Premium"), tela)).toBe(true);
      expect(planoLiberaParaCron(leituraDe("Equipe Completa"), tela)).toBe(true);
    }
  });

  it("o Standard não tem Skills, Memória nem Roteadores (a IA avançada é do Premium)", () => {
    for (const tela of ["/app/ai/skills", "/app/ai/memory", "/app/ai/routers"]) {
      expect(planoLibera(leituraDe("Standard"), tela)).toBe(false);
      expect(planoLibera(leituraDe("Premium"), tela)).toBe(true);
    }
  });

  it("LGPD está em todo plano", () => {
    for (const plano of Object.keys(PLANOS) as NomeDoPlano[]) {
      expect(planoLibera(leituraDe(plano), "/app/lgpd/requests")).toBe(true);
    }
  });
});

const leitura = vi.hoisted(() => ({ atual: { tipo: "isenta" } as LeituraDoPlano }));
vi.mock("@/lib/cobranca/leitura-do-plano", () => ({ leituraDoPlanoDaOrg: async () => leitura.atual }));

describe("a trava de API de cada plano", () => {
  beforeEach(() => {
    leitura.atual = { tipo: "isenta" };
  });

  async function status(plano: NomeDoPlano, caminho: string): Promise<number> {
    const { recusaForaDoPlano } = await import("@/lib/cobranca/trava-do-plano");
    leitura.atual = leituraDe(plano);
    const r = await recusaForaDoPlano("org-1", { caminho });
    return r?.status ?? 200;
  }

  it("o Essencial recusa as APIs de IA com 403; o Standard as aceita", async () => {
    for (const rota of ["/api/v1/ai/providers", "/api/v1/ai/budget", "/api/v1/ai/usage", "/api/v1/ai/guardrail-layers"]) {
      expect(await status("Essencial", rota)).toBe(403);
      expect(await status("Standard", rota)).toBe(200);
    }
  });

  it("o Standard recusa as APIs de campanha e de prospecção com 403; Premium e Equipe Completa aceitam as mesmas", async () => {
    const rotas = [
      "/api/v1/campaigns",
      "/api/v1/campaign-templates",
      "/api/v1/settings/campanhas",
      "/api/v1/prospecting",
      "/api/v1/settings/prospeccao",
      "/api/v1/cold-call",
    ];
    for (const rota of rotas) {
      expect(await status("Standard", rota)).toBe(403);
      expect(await status("Premium", rota)).toBe(200);
      expect(await status("Equipe Completa", rota)).toBe(200);
    }
  });

  it("toda rota ligada a uma tela responde 403 exatamente quando a tela está fora do plano", async () => {
    // Sem método a chamada vale como escrita: as leituras abertas não entram
    // aqui (são medidas em telas-do-plano-prefixos-fechados.test.ts).
    const ligadas = Object.keys(ROTAS_DE_API).filter((p) => regraDaRotaDeApi(p) !== null);
    expect(ligadas.length).toBeGreaterThan(0);
    for (const plano of Object.keys(PLANOS) as NomeDoPlano[]) {
      for (const rota of ligadas) {
        const telas = regraDaRotaDeApi(rota)!.aceitos;
        const esperado = telas.some((tela) => (PLANOS[plano] as readonly string[]).includes(tela)) ? 200 : 403;
        expect({ plano, rota, status: await status(plano, rota) }).toEqual({ plano, rota, status: esperado });
      }
    }
  });
});
