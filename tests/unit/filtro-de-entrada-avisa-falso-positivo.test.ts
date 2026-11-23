/**
 * QUEM LIGA O FILTRO DE ENTRADA É AVISADO DO FALSO POSITIVO (revisão de 20/11,
 * item 2.29).
 *
 * O filtro barra mensagem por lista de palavras, antes do modelo, e lista não
 * entende contexto. Ele ainda não tem tela: a configuração entra por
 * `GET/PATCH /api/v1/settings/routing`, e é nessa resposta que o aviso vai —
 * no idioma de quem configura.
 *
 * QUAIS avisos valem é regra pura, testada em
 * `lib/agent-engine/guardrails/filtro-de-entrada.test.ts`. Aqui: a frase de
 * cada código, em português e em espanhol, e a rota devolvendo o campo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AVISOS_DO_FILTRO,
  filtroDeEntradaSchema,
  type FiltroDeEntrada,
} from "@/lib/agent-engine/guardrails/filtro-de-entrada";
import { avisosDoFiltroParaQuemConfigura } from "@/lib/atendimento/avisos-do-filtro-de-entrada";

/** Uma configuração (de teste) que aciona os QUATRO avisos. */
const COM_TUDO: FiltroDeEntrada = filtroDeEntradaSchema.parse({
  enabled: true,
  rules: {
    offense: { terms: ["lixo"], action: "reply", reply: "Vamos manter o respeito." },
    spam: { terms: ["clique no link agora"], max_extra_words: null },
  },
});

describe("os avisos do filtro de entrada, para quem configura", () => {
  it("a configuração de teste aciona todos os códigos — nenhum fica sem frase", () => {
    const avisos = avisosDoFiltroParaQuemConfigura(COM_TUDO, "pt-BR");
    expect(avisos.map((a) => a.code).sort()).toEqual([...AVISOS_DO_FILTRO].sort());
    for (const aviso of avisos) expect(aviso.message.length, aviso.code).toBeGreaterThan(40);
  });

  it("⭐ em português: diz que a lista não entende contexto e que pode calar um cliente", () => {
    const geral = avisosDoFiltroParaQuemConfigura(COM_TUDO, "pt-BR").find((a) => a.code === "falso_positivo")!;
    expect(geral.message).toContain("sem entender o contexto");
    expect(geral.message).toContain("sem resposta");
    expect(geral.message).toContain("sobrenome");
  });

  it("⭐ em espanhol: toda frase tem tradução (nenhuma cai no português)", () => {
    const pt = avisosDoFiltroParaQuemConfigura(COM_TUDO, "pt-BR");
    const es = avisosDoFiltroParaQuemConfigura(COM_TUDO, "es");
    expect(es.map((a) => a.code)).toEqual(pt.map((a) => a.code));
    for (const [i, aviso] of es.entries()) {
      expect(aviso.message, `${aviso.code} sem espanhol`).not.toBe(pt[i]!.message);
    }
    expect(es.find((a) => a.code === "falso_positivo")!.message).toContain("sin entender el contexto");
    expect(es.find((a) => a.code === "resposta_e_modo_assistido")!.message).toContain("modo asistido");
  });

  it("o aviso do modo assistido diz o que acontece: a resposta automática não é enviada", () => {
    const aviso = avisosDoFiltroParaQuemConfigura(COM_TUDO, "pt-BR").find(
      (a) => a.code === "resposta_e_modo_assistido",
    )!;
    expect(aviso.message).toContain("modo assistido");
    expect(aviso.message).toContain("não é enviada");
  });

  it("filtro desligado: sem aviso", () => {
    expect(avisosDoFiltroParaQuemConfigura(filtroDeEntradaSchema.parse({ enabled: false }), "pt-BR")).toEqual([]);
  });
});

describe("a rota de configuração devolve os avisos", () => {
  const rota = readFileSync(join(process.cwd(), "app/api/v1/settings/routing/route.ts"), "utf8");

  it("na leitura (GET) e na gravação (PATCH), no idioma de quem está logado", () => {
    const usos = rota.match(/entry_filter_warnings:\s*avisosDoFiltroParaQuemConfigura\(/g) ?? [];
    expect(usos, "o GET e o PATCH têm de devolver `entry_filter_warnings`").toHaveLength(2);
    expect(rota.match(/authz\.user\.idioma/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
