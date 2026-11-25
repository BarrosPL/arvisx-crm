/**
 * PAGADOR `chave_plataforma`: o Vix roda num modelo pequeno pela chave de API
 * da instalação.
 *
 * É a SAÍDA decidida pelo dono para o caso de a assinatura não poder ser usada.
 * A chave é a mesma chave de plataforma dos agentes, lida pelo leitor que já
 * existe (`chaveDePlataforma`); este arquivo é o único do assistente que a
 * alcança (`tests/unit/assistente-provedor-cerca.test.ts`), e ela nunca sai
 * daqui: só o modelo montado.
 *
 * O modelo é FIXO. O custo é o real, pela tabela de preços do motor
 * (`pricing.ts`). O limite de mensagens por plano vale igual.
 *
 * Só é usado quando `VIX_PAGADOR` vale `chave_plataforma`. Não há queda da
 * assinatura para cá.
 */
import { costCents } from "@/lib/agent-engine/edge/llm/pricing";
import { buildModel, chaveDePlataforma } from "@/lib/ai/runtime/agent";

import { statusEDetalheDoErro, type MotivoDeIndisponibilidade, type ProvedorDoVix } from "./tipos";

const PAGADOR = "chave_plataforma" as const;
const PROVEDOR = "anthropic";
/** O modelo do assistente neste pagador. Tem preço na tabela do motor. */
export const MODELO_DA_CHAVE_DA_PLATAFORMA = "claude-haiku-5-5";
/** O valor do Vix, neste pagador, na coluna de origem da chave de `llm_calls`. */
const ORIGEM_DA_CHAVE = "assistente_chave_plataforma";

function classificar(erro: unknown): MotivoDeIndisponibilidade {
  const { status } = statusEDetalheDoErro(erro);
  if (status === null) return "rede";
  if (status === 429 || status === 402) return "limite_de_uso";
  if (status === 401 || status === 403) return "sem_autorizacao";
  if (status >= 500) return "falha_do_provedor";
  return "erro_de_pedido";
}

export function chaveDaPlataforma(): ProvedorDoVix {
  const chave = chaveDePlataforma(PROVEDOR);
  if (chave === null) return { disponivel: false, pagador: PAGADOR, motivo: "sem_chave" };
  return {
    disponivel: true,
    pagador: PAGADOR,
    origemDaChave: ORIGEM_DA_CHAVE,
    provedor: PROVEDOR,
    modelo: MODELO_DA_CHAVE_DA_PLATAFORMA,
    model: buildModel(PROVEDOR, chave, MODELO_DA_CHAVE_DA_PLATAFORMA),
    custoUsdCents: (uso) =>
      costCents(MODELO_DA_CHAVE_DA_PLATAFORMA, {
        inputTokens: uso.entrada,
        outputTokens: uso.saida,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }) ?? 0,
    classificarFalha: classificar,
  };
}
