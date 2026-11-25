/**
 * O MODELO SIMULADO DOS TESTES DO VIX — zero rede, zero chave.
 *
 * Um `MockLanguageModelV3` (do próprio AI SDK) que segue um ROTEIRO: a cada
 * passo do laço ele devolve o que o roteiro manda — pedir ferramentas, escrever
 * texto ou falhar com um status HTTP. O laço de ferramentas, o stream e a
 * execução das ferramentas são os de produção; só o modelo é de mentira.
 *
 * É assim que os testes de ataque dizem "o modelo obedeceu ao texto injetado":
 * o roteiro pede a ferramenta que um modelo enganado pediria.
 */
import { MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream, type LanguageModel } from "ai";

import type { ProvedorPronto } from "@/lib/assistente/provedor/tipos";

export type PassoDoRoteiro =
  | { texto: string }
  | { ferramentas: { nome: string; args: Record<string, unknown> }[] }
  | { erro: { status?: number; mensagem?: string } };

const USO = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

export interface ModeloSimulado {
  model: LanguageModel;
  /** Quantas vezes o modelo foi chamado (cada passo do laço é uma chamada). */
  chamadas: () => number;
  /** O que o modelo recebeu em cada chamada: `prompt` cru do SDK. */
  recebidos: () => unknown[];
}

/** Erro com a cara dos erros de API do SDK (`statusCode`). */
export function erroDoProvedor(status: number | undefined, mensagem = "erro do provedor"): Error {
  const erro = new Error(mensagem) as Error & { statusCode?: number };
  if (status !== undefined) erro.statusCode = status;
  return erro;
}

export function modeloRoteirizado(roteiro: PassoDoRoteiro[]): ModeloSimulado {
  let n = 0;
  const recebidos: unknown[] = [];
  const model = new MockLanguageModelV3({
    modelId: "modelo-simulado",
    doStream: async (opcoes: unknown) => {
      recebidos.push((opcoes as { prompt?: unknown }).prompt);
      // Roteiro esgotado: o modelo encerra com texto, para o laço não ficar preso.
      const passo: PassoDoRoteiro = roteiro[n] ?? { texto: "Pronto." };
      n += 1;
      if ("erro" in passo) throw erroDoProvedor(passo.erro.status, passo.erro.mensagem);
      const partes: unknown[] = [{ type: "stream-start", warnings: [] }];
      if ("texto" in passo) {
        partes.push({ type: "text-start", id: "t1" });
        // Em pedaços pequenos: é assim que um stream de verdade chega.
        for (let i = 0; i < passo.texto.length; i += 7) {
          partes.push({ type: "text-delta", id: "t1", delta: passo.texto.slice(i, i + 7) });
        }
        partes.push({ type: "text-end", id: "t1" });
        partes.push({ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: USO });
      } else {
        passo.ferramentas.forEach((f, i) => {
          partes.push({ type: "tool-call", toolCallId: `chamada-${n}-${i}`, toolName: f.nome, input: JSON.stringify(f.args) });
        });
        partes.push({ type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage: USO });
      }
      return { stream: simulateReadableStream({ chunks: partes }) } as never;
    },
  });
  return { model: model as unknown as LanguageModel, chamadas: () => n, recebidos: () => recebidos };
}

/** Um provedor pronto em volta do modelo simulado, com os espiões que os testes leem. */
export function provedorSimulado(
  simulado: ModeloSimulado,
  sobre: Partial<ProvedorPronto> = {},
): ProvedorPronto {
  return {
    pagador: "assinatura_plataforma",
    provedor: "simulado",
    modelo: "modelo-simulado",
    model: simulado.model,
    custoUsdCents: () => 0,
    classificarFalha: () => "falha_do_provedor",
    ...sobre,
  };
}
