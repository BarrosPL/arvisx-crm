/**
 * Argumentos que o esquema da ferramenta declara como TEXTO e o handler confere.
 *
 * ─── Por que não `z.string().datetime()` e `z.union([...uuid()])` no esquema ───
 *
 * O esquema da ferramenta vai INTEIRO ao modelo em todo passo do turno, e o zod
 * traduz essas duas validações em `pattern`: a expressão regular de data-hora
 * sozinha custa perto de 250 tokens, por campo, por ferramenta, por passo
 * (medido por `tests/unit/peso-das-ferramentas.test.ts`). O modelo não lê
 * expressão regular para decidir o que escrever — lê a descrição do campo.
 *
 * Então o esquema declara um texto curto, e a conferência acontece aqui, com
 * uma recusa que ENSINA o formato (e diz que horas são, que é o que o modelo
 * mais erra). É o mesmo arranjo da ferramenta de agendar retorno
 * (`promised_at` em `lib/mcp/tools/retencao.ts`).
 */
import { z } from "zod";

import { recusa, type RecusaParaOAgente } from "./negocio-do-contexto";

const INSTANTE = z.string().datetime({ offset: true });
const UUID = z.string().uuid();

/** Um instante ISO-8601 COM fuso — o mesmo formato que a rota da tela exige. */
export function instanteDoArgumento(
  campo: string,
  valor: string,
): { ok: true; iso: string } | { ok: false; recusa: RecusaParaOAgente } {
  const texto = valor.trim();
  if (INSTANTE.safeParse(texto).success) return { ok: true, iso: texto };
  return {
    ok: false,
    recusa: recusa(
      "data_invalida",
      `\`${campo}\` não é um instante ISO-8601 com fuso (exemplo: 2026-01-31T15:00:00-03:00). ` +
        `Agora é ${new Date().toISOString()}.`,
    ),
  };
}

/**
 * O responsável de uma tarefa: o `user_id` de um atendente, ou `equipe`.
 *
 * `equipe` vira `null` — sem responsável, a tarefa fica para quem da equipe a
 * pegar. Ausente continua ausente: quem chama decide o que isso significa.
 */
export function responsavelDoArgumento(
  valor: string | undefined,
): { ok: true; responsavel: string | null | undefined } | { ok: false; recusa: RecusaParaOAgente } {
  if (valor === undefined) return { ok: true, responsavel: undefined };
  const texto = valor.trim();
  if (texto.toLowerCase() === "equipe") return { ok: true, responsavel: null };
  if (UUID.safeParse(texto).success) return { ok: true, responsavel: texto };
  return {
    ok: false,
    recusa: recusa(
      "responsavel_invalido",
      "`assigned_to` aceita o user_id de um atendente da equipe ou a palavra 'equipe' (sem dono).",
    ),
  };
}
