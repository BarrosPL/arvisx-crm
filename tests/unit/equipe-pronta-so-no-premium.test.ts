// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DESTINO_DA_EQUIPE_PRONTA } from "@/lib/ai/equipe-pronta/constantes";
import {
  ERRO_DA_EQUIPE_FORA_DO_PLANO,
  agenteDaEquipeProntaPodeAgir,
  agentesDaEquipeForaDoPlano,
  reguaDaEquipeForaDoPlano,
} from "@/lib/cobranca/equipe-pronta-no-plano";
import { destinoDaRotaDeApi } from "@/lib/cobranca/rotas-do-plano";
import { planoLibera, planoLiberaParaCron, type LeituraDoPlano } from "@/lib/cobranca/telas-do-plano";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import { INTERFACE_COMPLETA } from "@/lib/navigation/interface";
import { interfaceDoPlanoSchema } from "@/lib/schemas/cobranca-plano";
import { PLANOS, type NomeDoPlano } from "../helpers/distribuicao-dos-planos";

/**
 * A EQUIPE DE IA PRONTA É SÓ DO PREMIUM — nas três pontas.
 *
 *   1. TELA: o destino `/app/ai/equipe-pronta` está no catálogo e é liberado
 *      pelo Premium (o perfil "completa", sem lista) e por nenhuma das listas
 *      explícitas de Essencial e Standard;
 *   2. API: as quatro rotas respondem 403 `fora_do_plano:…` fora do Premium;
 *   3. MOTOR: agente instalado pela equipe pronta não responde nem arma
 *      follow-up quando o plano não libera a tela — e só ele: o agente que o
 *      cliente criou segue a regra de sempre. Falha de leitura = segue.
 *
 * Rebaixar é PAUSA: a pergunta é feita contra o plano de agora, e nada aqui
 * apaga ou despublica coisa alguma.
 */

const leitura = vi.hoisted(() => ({ atual: { tipo: "isenta" } as LeituraDoPlano }));
vi.mock("@/lib/cobranca/leitura-do-plano", () => ({ leituraDoPlanoDaOrg: async () => leitura.atual }));

function leituraDe(plano: NomeDoPlano): LeituraDoPlano {
  return {
    tipo: "plano",
    interface: interfaceDoPlanoSchema.parse({ preset: "completa", destinos: PLANOS[plano] }),
  };
}
/** O Premium como o dono o cadastra: perfil "completa", sem personalizar. */
const PREMIUM_SEM_LISTA: LeituraDoPlano = { tipo: "plano", interface: INTERFACE_COMPLETA };
const ESSENCIAL_SIMPLIFICADA: LeituraDoPlano = { tipo: "plano", interface: { preset: "simplificada" } };

beforeEach(() => {
  leitura.atual = { tipo: "isenta" };
});

describe("a tela", () => {
  it("o destino existe no catálogo, no grupo de IA, para manager", () => {
    const entrada = NAV_CATALOG.find((d) => d.href === DESTINO_DA_EQUIPE_PRONTA);
    expect(entrada).toMatchObject({ group: "ia", minRole: "manager", label: "Equipe pronta" });
    // Fora do menu lateral, que é fixo: a porta mora no hub de IA e na busca.
    expect(entrada).not.toHaveProperty("sidebar");
  });

  it("⭐ o Premium libera; Standard e Essencial não", () => {
    expect(planoLibera(PREMIUM_SEM_LISTA, DESTINO_DA_EQUIPE_PRONTA)).toBe(true);
    expect(planoLibera(leituraDe("Premium"), DESTINO_DA_EQUIPE_PRONTA)).toBe(true);
    expect(planoLibera(leituraDe("Standard"), DESTINO_DA_EQUIPE_PRONTA)).toBe(false);
    expect(planoLibera(leituraDe("Essencial"), DESTINO_DA_EQUIPE_PRONTA)).toBe(false);
    expect(planoLibera(ESSENCIAL_SIMPLIFICADA, DESTINO_DA_EQUIPE_PRONTA)).toBe(false);
  });

  it("empresa sem assinatura (isenta) também vê a tela — a regra atual da régua", () => {
    expect(planoLibera({ tipo: "isenta" }, DESTINO_DA_EQUIPE_PRONTA)).toBe(true);
  });

  it("o Standard continua com os agentes dele: a trava é da equipe pronta, não da IA", () => {
    expect(planoLibera(leituraDe("Standard"), "/app/ai/agents")).toBe(true);
  });
});

describe("a API", () => {
  const ROTAS = [
    "/api/v1/ai/equipe-pronta",
    "/api/v1/ai/equipe-pronta/instalar",
    "/api/v1/ai/equipe-pronta/ativar",
    "/api/v1/ai/equipe-pronta/pausar",
  ];

  it("as quatro rotas são da tela da equipe pronta", () => {
    for (const rota of ROTAS) expect(destinoDaRotaDeApi(rota)).toBe(DESTINO_DA_EQUIPE_PRONTA);
  });

  it.each(["GET", "PUT", "POST"])("⭐ %s: 403 de plano no Standard e no Essencial, livre no Premium", async (metodo) => {
    const { recusaForaDoPlano } = await import("@/lib/cobranca/trava-do-plano");
    for (const caminho of ROTAS) {
      for (const [plano, fora] of [
        [leituraDe("Standard"), true],
        [leituraDe("Essencial"), true],
        [ESSENCIAL_SIMPLIFICADA, true],
        [leituraDe("Premium"), false],
        [PREMIUM_SEM_LISTA, false],
      ] as const) {
        leitura.atual = plano;
        const r = await recusaForaDoPlano("org-1", { caminho, metodo });
        expect({ caminho, status: r?.status ?? 200 }).toEqual({ caminho, status: fora ? 403 : 200 });
        if (r) {
          const corpo = (await r.json()) as { error: { code: string } };
          expect(corpo.error.code).toBe(`fora_do_plano:${DESTINO_DA_EQUIPE_PRONTA}`);
        }
      }
    }
  });
});

/** Um pool de mentira: responde à marca do agente e à função do plano. */
function pool(opcoes: { marcado: boolean | "erro"; plano: unknown | "erro" }) {
  const consultas: string[] = [];
  return {
    consultas,
    query: (async (sql: string) => {
      consultas.push(sql);
      if (sql.includes("from ai_agents")) {
        if (opcoes.marcado === "erro") throw new Error("banco fora");
        return { rows: [{ marcado: opcoes.marcado }] };
      }
      if (opcoes.plano === "erro") throw new Error("banco fora");
      return { rows: [{ plano: opcoes.plano }] };
    }) as never,
  };
}

const PLANO_PREMIUM = { restrito: true, interface: { preset: "completa" } };
const PLANO_STANDARD = { restrito: true, interface: { preset: "completa", destinos: PLANOS.Standard } };

describe("o motor: o agente da equipe pronta num turno", () => {
  it("⭐ agente da equipe pronta + plano que não libera a tela: NÃO age", async () => {
    expect(await agenteDaEquipeProntaPodeAgir(pool({ marcado: true, plano: PLANO_STANDARD }), "org", "ag")).toBe(false);
  });

  it("agente da equipe pronta + Premium: age", async () => {
    expect(await agenteDaEquipeProntaPodeAgir(pool({ marcado: true, plano: PLANO_PREMIUM }), "org", "ag")).toBe(true);
  });

  it("empresa isenta (sem assinatura, ou cobrança desligada): age", async () => {
    expect(await agenteDaEquipeProntaPodeAgir(pool({ marcado: true, plano: { restrito: false } }), "org", "ag")).toBe(true);
  });

  it("⭐ agente do CLIENTE (sem a marca) nunca é barrado aqui — e o plano nem é consultado", async () => {
    const p = pool({ marcado: false, plano: PLANO_STANDARD });
    expect(await agenteDaEquipeProntaPodeAgir(p, "org", "ag")).toBe(true);
    expect(p.consultas).toHaveLength(1);
  });

  it("falha de leitura do plano = segue (a mesma régua dos crons)", async () => {
    expect(await agenteDaEquipeProntaPodeAgir(pool({ marcado: true, plano: "erro" }), "org", "ag")).toBe(true);
    expect(planoLiberaParaCron({ tipo: "falha" }, DESTINO_DA_EQUIPE_PRONTA)).toBe(true);
  });

  it("falha ao ler a marca do agente = segue, como agente comum", async () => {
    expect(await agenteDaEquipeProntaPodeAgir(pool({ marcado: "erro", plano: PLANO_STANDARD }), "org", "ag")).toBe(true);
  });

  it("a consulta filtra a organização e o agente", async () => {
    const chamadas: unknown[][] = [];
    const p = {
      query: (async (_sql: string, params: unknown[]) => {
        chamadas.push(params);
        return { rows: [{ marcado: false }] };
      }) as never,
    };
    await agenteDaEquipeProntaPodeAgir(p, "org-1", "agente-1");
    expect(chamadas[0]).toEqual(["org-1", "agente-1", "equipe_pronta"]);
  });
});

/** Um admin de mentira: `ai_agents`, `equipe_pronta_perfis` e a RPC do plano. */
function admin(opcoes: {
  agentes?: { id: string; config: unknown }[];
  instalacao?: unknown;
  plano: unknown | "erro";
  erroNaLeitura?: boolean;
}): SupabaseClient {
  const tabela = (nome: string) => {
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      in: () => q,
      maybeSingle: async () =>
        opcoes.erroNaLeitura
          ? { data: null, error: { message: "banco fora" } }
          : { data: opcoes.instalacao === undefined ? null : { instalacao: opcoes.instalacao }, error: null },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(
          opcoes.erroNaLeitura
            ? { data: null, error: { message: "banco fora" } }
            : { data: nome === "ai_agents" ? (opcoes.agentes ?? []) : [], error: null },
        ).then(resolve),
    };
    return q;
  };
  return {
    from: tabela,
    rpc: async () =>
      opcoes.plano === "erro"
        ? { data: null, error: { message: "banco fora" } }
        : { data: opcoes.plano, error: null },
  } as unknown as SupabaseClient;
}

describe("o motor: follow-up", () => {
  const AGENTES = [
    { id: "da-equipe", config: { equipe_pronta: { papel: "recuperador", versao: 1, hash: "x" } } },
    { id: "do-cliente", config: {} },
  ];

  it("⭐ fora do Premium, só o agente da equipe pronta sai do portão de follow-up", async () => {
    const fora = await agentesDaEquipeForaDoPlano(admin({ agentes: AGENTES, plano: PLANO_STANDARD }), "org", [
      "da-equipe",
      "do-cliente",
    ]);
    expect([...fora]).toEqual(["da-equipe"]);
  });

  it("no Premium ninguém sai; com falha de leitura do plano ninguém sai", async () => {
    for (const plano of [PLANO_PREMIUM, { restrito: false }, "erro"] as const) {
      const fora = await agentesDaEquipeForaDoPlano(admin({ agentes: AGENTES, plano }), "org", ["da-equipe", "do-cliente"]);
      expect([...fora]).toEqual([]);
    }
  });

  it("sem agente nenhum, ou sem agente da equipe, nem pergunta pelo plano", async () => {
    expect((await agentesDaEquipeForaDoPlano(admin({ plano: PLANO_STANDARD }), "org", [])).size).toBe(0);
    const soDoCliente = admin({ agentes: [AGENTES[1]!], plano: PLANO_STANDARD });
    expect((await agentesDaEquipeForaDoPlano(soDoCliente, "org", ["do-cliente"])).size).toBe(0);
  });

  it("falha ao ler os agentes = ninguém sai", async () => {
    const fora = await agentesDaEquipeForaDoPlano(admin({ plano: PLANO_STANDARD, erroNaLeitura: true }), "org", ["da-equipe"]);
    expect(fora.size).toBe(0);
  });

  it("⭐ a régua da equipe pronta é adiada fora do Premium; outro fluxo da mesma empresa não", async () => {
    const instalacao = { followup_flow_pointer_id: "regua-da-equipe" };
    const standard = admin({ instalacao, plano: PLANO_STANDARD });
    expect(await reguaDaEquipeForaDoPlano(standard, "org", "regua-da-equipe")).toBe(true);
    expect(await reguaDaEquipeForaDoPlano(standard, "org", "fluxo-do-cliente")).toBe(false);
    expect(await reguaDaEquipeForaDoPlano(admin({ instalacao, plano: PLANO_PREMIUM }), "org", "regua-da-equipe")).toBe(false);
  });

  it("empresa sem equipe pronta, ou leitura que falha: nada é adiado", async () => {
    expect(await reguaDaEquipeForaDoPlano(admin({ plano: PLANO_STANDARD }), "org", "x")).toBe(false);
    expect(await reguaDaEquipeForaDoPlano(admin({ plano: PLANO_STANDARD, erroNaLeitura: true }), "org", "x")).toBe(false);
    const instalacao = { followup_flow_pointer_id: "regua" };
    expect(await reguaDaEquipeForaDoPlano(admin({ instalacao, plano: "erro" }), "org", "regua")).toBe(false);
  });

  it("o motivo gravado na inscrição adiada nomeia a tela", () => {
    expect(ERRO_DA_EQUIPE_FORA_DO_PLANO).toBe("fora_do_plano:/app/ai/equipe-pronta");
  });
});
