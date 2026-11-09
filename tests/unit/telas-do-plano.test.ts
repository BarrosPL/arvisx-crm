import { describe, expect, it } from "vitest";

import {
  TELAS_NA_FALHA_DE_LEITURA,
  destinosDoPlano,
  leituraDaResposta,
  planoIncluiGrupo,
  planoIncluiIaParaOMotor,
  planoLibera,
  planoLiberaParaCron,
  telasLiberadasDaOrganizacao,
  type LeituraDoPlano,
} from "@/lib/cobranca/telas-do-plano";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import {
  DESTINOS_DA_SIMPLIFICADA,
  PORTAS_ESSENCIAIS,
  combinarInterfaces,
  comTelasDoPlano,
  lerInterface,
} from "@/lib/navigation/interface";
import { interfaceDoPlanoSchema } from "@/lib/schemas/cobranca-plano";

/**
 * A RÉGUA ÚNICA das telas do plano (ArvisX, migration 9802): o que o plano
 * libera, o que o membro vê (plano ∩ empresa ∩ vínculo), e as decisões de falha.
 */

const TODOS = NAV_CATALOG.map((d) => d.href);
const DO_GRUPO_IA = NAV_CATALOG.filter((d) => d.group === "ia").map((d) => d.href);

const ISENTA: LeituraDoPlano = { tipo: "isenta" };
const FALHA: LeituraDoPlano = { tipo: "falha" };
const ESSENCIAL: LeituraDoPlano = { tipo: "plano", interface: { preset: "simplificada" } };
const STANDARD: LeituraDoPlano = {
  tipo: "plano",
  interface: { preset: "simplificada", destinos: [...DESTINOS_DA_SIMPLIFICADA, ...DO_GRUPO_IA] },
};
const PREMIUM: LeituraDoPlano = { tipo: "plano", interface: { preset: "completa" } };

/** O que o membro vê, como o menu calcula a partir da interface da sessão. */
function vistas(leitura: LeituraDoPlano, papel: "admin" | "agent", vinculo?: unknown, empresa?: unknown) {
  const interfaceDaSessao = comTelasDoPlano(
    combinarInterfaces(empresa, vinculo),
    destinosDoPlano(leitura),
  );
  return telasLiberadasDaOrganizacao({ interface_settings: interfaceDaSessao }, false, papel, [], []).map(
    (d) => d.href,
  );
}

describe("o que cada plano libera", () => {
  it("sem assinatura (isenta) = TODAS as telas, sem recorte nenhum", () => {
    expect(destinosDoPlano(ISENTA)).toBeNull();
    expect(planoLibera(ISENTA, "/app/ai/agents")).toBe(true);
    // e o menu é exatamente o de antes da migration
    expect(vistas(ISENTA, "admin")).toEqual(
      telasLiberadasDaOrganizacao({ interface_settings: undefined }, false, "admin", [], []).map((d) => d.href),
    );
  });

  it("Essencial (simplificada) = o preset simplificada + as portas essenciais, e nada de IA", () => {
    const lista = destinosDoPlano(ESSENCIAL)!;
    for (const h of DESTINOS_DA_SIMPLIFICADA) expect(lista).toContain(h);
    for (const h of PORTAS_ESSENCIAIS) expect(lista).toContain(h);
    expect(lista.filter((h) => !DESTINOS_DA_SIMPLIFICADA.includes(h) && !(PORTAS_ESSENCIAIS as readonly string[]).includes(h))).toEqual([]);
    expect(planoIncluiGrupo(ESSENCIAL, "ia")).toBe(false);
    expect(planoLibera(ESSENCIAL, "/app/campaigns")).toBe(false);
  });

  it("Standard = simplificada + o grupo Agente de IA inteiro", () => {
    const lista = destinosDoPlano(STANDARD)!;
    for (const h of DO_GRUPO_IA) expect(lista).toContain(h);
    expect(planoIncluiGrupo(STANDARD, "ia")).toBe(true);
    expect(planoLibera(STANDARD, "/app/campaigns")).toBe(false);
    expect(planoLibera(STANDARD, "/app/metrics")).toBe(false);
  });

  it("Premium (completa) = todas", () => {
    expect([...destinosDoPlano(PREMIUM)!].sort()).toEqual([...TODOS].sort());
    expect(planoIncluiGrupo(PREMIUM, "analise")).toBe(true);
  });

  it("erro de leitura mantém Atendimento (simplificada) e as essenciais, e fecha o resto", () => {
    expect(destinosDoPlano(FALHA)).toEqual(TELAS_NA_FALHA_DE_LEITURA);
    expect(planoLibera(FALHA, "/app/inbox")).toBe(true);
    expect(planoLibera(FALHA, "/app/connections")).toBe(true);
    expect(planoLibera(FALHA, "/app/ai/agents")).toBe(false);
    // ...mas o motor e os crons seguem (decisão escrita em telas-do-plano.ts)
    expect(planoIncluiIaParaOMotor(FALHA)).toBe(true);
    expect(planoLiberaParaCron(FALHA, "/app/campaigns")).toBe(true);
    expect(planoIncluiIaParaOMotor(ESSENCIAL)).toBe(false);
    expect(planoLiberaParaCron(ESSENCIAL, "/app/campaigns")).toBe(false);
  });

  it("lê a resposta da função do banco sem lançar", () => {
    expect(leituraDaResposta({ restrito: false }, null)).toEqual(ISENTA);
    expect(leituraDaResposta(null, null)).toEqual(ISENTA);
    expect(leituraDaResposta({ restrito: true, interface: { preset: "simplificada" } }, null)).toEqual(ESSENCIAL);
    expect(leituraDaResposta(null, new Error("x"))).toEqual(FALHA);
    expect(leituraDaResposta("lixo", null)).toEqual(FALHA);
    expect(leituraDaResposta({}, null)).toEqual(FALHA);
  });
});

describe("o que o membro vê = plano ∩ empresa ∩ vínculo", () => {
  it("o vínculo escolhe menos dentro do plano, nunca mais", () => {
    const vinculo = { preset: "completa", destinos: ["/app/inbox", "/app/campaigns", "/app/ai/agents"] };
    const v = vistas(STANDARD, "admin", vinculo);
    expect(v).toContain("/app/inbox");
    expect(v).toContain("/app/ai/agents");
    expect(v).not.toContain("/app/campaigns"); // o vínculo pediu, o plano não libera
    expect(v).not.toContain("/app/kanban"); // o plano libera, o vínculo dispensou
  });

  it("o plano vence até a porta de módulo ligado da simplificada", () => {
    const interfaceDaSessao = comTelasDoPlano({ preset: "simplificada" }, destinosDoPlano(ESSENCIAL));
    const comModulo = telasLiberadasDaOrganizacao(
      { interface_settings: interfaceDaSessao },
      false,
      "admin",
      ["crm_b2b"],
      [],
    ).map((d) => d.href);
    expect(comModulo).not.toContain("/app/companies");
  });

  it("Ajuda e Guia de uso aparecem em TODO plano, mesmo com vínculo simplificado, para admin e atendente", () => {
    for (const leitura of [ESSENCIAL, STANDARD, PREMIUM, FALHA, ISENTA]) {
      for (const papel of ["admin", "agent"] as const) {
        const v = vistas(leitura, papel, { preset: "simplificada" });
        expect(v, `${leitura.tipo}/${papel}`).toContain("/app/ajuda");
        expect(v, `${leitura.tipo}/${papel}`).toContain("/app/ajuda/treinamento");
      }
    }
  });

  it("a tela de assinatura fica para quem administra em todo plano (a porta de volta)", () => {
    expect(vistas(ESSENCIAL, "admin", { preset: "simplificada" })).toContain("/app/settings/billing");
    expect(vistas(ESSENCIAL, "agent", { preset: "simplificada" })).not.toContain("/app/settings/billing");
  });

  it("o recorte do plano NÃO é gravável: `lerInterface` o descarta", () => {
    const comPlano = comTelasDoPlano({ preset: "completa" }, ["/app/inbox"]);
    expect(lerInterface(comPlano).settings).toEqual({ preset: "completa" });
  });
});

describe("o schema das telas do plano", () => {
  it("aceita preset e destinos do catálogo, e recusa preferência da empresa", () => {
    expect(interfaceDoPlanoSchema.safeParse({ preset: "simplificada" }).success).toBe(true);
    expect(interfaceDoPlanoSchema.safeParse({ preset: "completa", destinos: ["/app/inbox"] }).success).toBe(true);
    expect(interfaceDoPlanoSchema.safeParse({ preset: "completa", bloquearAteAssumir: true }).success).toBe(false);
    expect(interfaceDoPlanoSchema.safeParse({ preset: "completa", destinos: ["/app/nao-existe"] }).success).toBe(false);
    expect(interfaceDoPlanoSchema.safeParse({ preset: "completa", destinos: [] }).success).toBe(false);
  });
});
