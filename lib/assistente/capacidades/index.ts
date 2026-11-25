/**
 * O CATÁLOGO DO VIX. O que não está aqui, o Vix não faz.
 *
 * Três grupos: as leituras reaproveitadas do MCP (`./mcp.ts`), as capacidades
 * próprias (`./proprias.ts`) e as duas escritas de exemplo, atrás de chave
 * desligada (`./escritas.ts`).
 *
 * Capacidade nova só entra com nível, papel, entrada validada, "tem inverso?"
 * e o teste que a prova: `tests/unit/assistente-catalogo-cerca.test.ts` reprova
 * o que faltar.
 */
import type { Capacidade } from "../tipos";

import { ESCRITAS_DE_EXEMPLO } from "./escritas";
import { LEITURAS_MCP } from "./mcp";
import { CAPACIDADES_PROPRIAS } from "./proprias";

export const CATALOGO: readonly Capacidade[] = [...CAPACIDADES_PROPRIAS, ...LEITURAS_MCP, ...ESCRITAS_DE_EXEMPLO];

export function capacidadePorNome(nome: string): Capacidade | undefined {
  return CATALOGO.find((c) => c.nome === nome);
}
