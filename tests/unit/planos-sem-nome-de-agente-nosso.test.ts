/**
 * GUARDA (ArvisX, tarefa 3 dos planos): nenhuma tela do cliente da landing nem
 * do comparativo dos planos escreve o nome de um agente nosso.
 *
 * Os agentes feitos sob medida são o serviço à parte Agentes Arvisx (até
 * 12/11/2026, o plano Equipe Completa) e cada cliente dá o nome que quiser ao seu. Um nome nosso numa tela de venda faria o cliente do
 * Standard achar que recebe aquele agente pronto.
 *
 * "Financeiro" é também o nome de uma TELA do CRM (a aba do carrossel da
 * landing), então ele só reprova quando aparece como nome de agente: na mesma
 * linha de "agente"/"assistente".
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

/** As telas do cliente desta guarda: a landing, as páginas que ela abre e o comparativo dos planos. */
const ARQUIVOS = [
  "app/page.tsx",
  "app/agendar/page.tsx",
  ...readdirSync(join(RAIZ, "components/landing"))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
    .map((f) => `components/landing/${f}`),
  "lib/landing/links.ts",
  "lib/landing/planos.ts",
  "components/cobranca/ComparativoDosPlanos.tsx",
  "components/cobranca/QuemCuidaDosAgentes.tsx",
  "components/cobranca/AcoesDaAssinatura.tsx",
  "components/cobranca/PainelDaAssinatura.tsx",
  "lib/cobranca/quem-cuida-dos-agentes.ts",
  "lib/cobranca/comparativo.ts",
];

const NOME_PROPRIO = /\b(Sophia|Sofia|Matheus|Pedro)\b/;
const FINANCEIRO_COMO_AGENTE = /(agente|assistente)[^\n]{0,40}\bFinanceiro\b|\bFinanceiro\b[^\n]{0,40}(agente|assistente)/i;

export function nomesDeAgenteEm(fonte: string): string[] {
  return fonte
    .split("\n")
    .map((linha, i) => ({ linha, n: i + 1 }))
    .filter(({ linha }) => NOME_PROPRIO.test(linha) || FINANCEIRO_COMO_AGENTE.test(linha))
    .map(({ linha, n }) => `${n}: ${linha.trim()}`);
}

describe("nenhum nome de agente nosso nas telas de venda", () => {
  it("a guarda enxerga o que procura (controle positivo) e não confunde a tela Financeiro", () => {
    expect(nomesDeAgenteEm("<p>A Sophia atende por você</p>")).toHaveLength(1);
    expect(nomesDeAgenteEm("<li>Agente Financeiro incluso</li>")).toHaveLength(1);
    expect(nomesDeAgenteEm('aba: "Financeiro",')).toEqual([]);
  });

  it("a lista de arquivos existe e não está vazia", () => {
    expect(ARQUIVOS.length).toBeGreaterThanOrEqual(10);
    for (const arquivo of ARQUIVOS) expect(() => readFileSync(join(RAIZ, arquivo), "utf8")).not.toThrow();
  });

  it.each(ARQUIVOS)("%s", (arquivo) => {
    expect(nomesDeAgenteEm(readFileSync(join(RAIZ, arquivo), "utf8"))).toEqual([]);
  });
});
