/**
 * UM TURNO DO VIX: a pergunta do usuário, o laço do modelo com as ferramentas
 * do catálogo, e a resposta em stream.
 *
 * O que o modelo alcança daqui, e SÓ isto:
 *
 *   - capacidade de leitura  → `executarLeitura`. O resultado volta ao modelo
 *     dentro do bloco de dado não confiável (`embrulharComoDado`);
 *   - capacidade de escrita  → `proporEscrita`, que GRAVA O CARTÃO e não
 *     altera mais nada. A execução mora em `./confirmar.ts`, que este arquivo
 *     não importa (cerca: `tests/unit/assistente-catalogo-cerca.test.ts`).
 *
 * O conjunto de ferramentas já vem recortado por papel, plano, módulo e modo
 * (`capacidadesOferecidas`), e cada chamada é conferida de novo no executor:
 * o recorte é conforto para o modelo, não a trava.
 *
 * Limites do turno: `ferramentasPorTurno` chamadas de ferramenta (a que passa
 * recebe recusa, e o laço para no passo seguinte) e, no stream, uma cauda
 * retida para o filtro de segredo alcançar uma chave que chegue em pedaços.
 *
 * Falha do provedor: sem queda para outro pagador e sem nova tentativa; o erro
 * encerra o turno com o motivo classificado. Nada de mensagem técnica sai daqui.
 */
import { stepCountIs, streamText, tool, type LanguageModel, type ModelMessage, type ToolSet } from "ai";

import { embrulharComoDado } from "./dado-nao-confiavel";
import { capacidadesOferecidas, executarLeitura, proporEscrita, type DependenciasDoExecutor } from "./executor";
import { mascararSegredos } from "./filtro-de-segredo";
import type { MotivoDeIndisponibilidade, ProvedorPronto } from "./provedor/tipos";
import type { ContextoDoAssistente, Modo } from "./tipos";

/** Quantos caracteres do fim ficam retidos até o filtro de segredo poder vê-los inteiros. */
export const CAUDA_RETIDA = 160;

export interface CartaoDoTurno {
  acaoId: string;
  capacidade: string;
  nivel: "escrever" | "sensivel";
  resumo: string;
  itens: { id: string; rotulo: string }[];
  expiraEm: string;
}

export interface EntradaDoTurno {
  ctx: ContextoDoAssistente;
  conversaId: string;
  modo: Modo;
  system: string;
  /** O histórico curto e, por último, a mensagem nova do usuário. */
  mensagens: ModelMessage[];
  provedor: ProvedorPronto;
  ferramentasPorTurno: number;
  deps: DependenciasDoExecutor;
  /** Recebe o texto já mascarado, em pedaços. */
  aoEscrever: (pedaco: string) => void;
  aoCartao: (cartao: CartaoDoTurno) => void;
  /**
   * O guia de telas apontou uma tela que a pessoa PODE abrir. O endereço vem
   * do catálogo de navegação (a capacidade `telas_apontar` confere), nunca do
   * texto do modelo: é com ele que o painel desenha o botão de abrir.
   */
  aoApontarTela?: (tela: { nome: string; abrir: string }) => void;
}

export interface ResultadoDoTurno {
  /** O texto inteiro da resposta, já mascarado. Vazio quando falhou antes de escrever. */
  texto: string;
  cartoes: CartaoDoTurno[];
  uso: { entrada: number; saida: number };
  chamadasDeFerramenta: number;
  /** Presente quando o provedor falhou. */
  falha?: MotivoDeIndisponibilidade;
}

/** Emite o texto mascarado, segurando a cauda. */
function criarEmissor(aoEscrever: (pedaco: string) => void) {
  let acumulado = "";
  let emitido = 0;
  return {
    receber(delta: string) {
      acumulado += delta;
      const mascarado = mascararSegredos(acumulado);
      const limite = mascarado.length - CAUDA_RETIDA;
      if (limite <= emitido) return;
      // Corta num espaço: metade de uma palavra pode ser metade de uma chave.
      const corte = mascarado.lastIndexOf(" ", limite);
      if (corte <= emitido) return;
      aoEscrever(mascarado.slice(emitido, corte));
      emitido = corte;
    },
    fechar(): string {
      const mascarado = mascararSegredos(acumulado);
      if (mascarado.length > emitido) aoEscrever(mascarado.slice(emitido));
      emitido = mascarado.length;
      return mascarado;
    },
    escreveuAlgo: () => emitido > 0,
  };
}

/** A capacidade cujo resultado vira botão de abrir tela no painel. */
export const CAPACIDADE_DE_APONTAR_TELA = "telas_apontar";

const RECUSA_POR_LIMITE_DE_FERRAMENTAS =
  "Limite de consultas desta resposta atingido. Responda agora com o que você já tem e diga o que faltou conferir.";

export async function rodarTurno(e: EntradaDoTurno): Promise<ResultadoDoTurno> {
  const oferecidas = await capacidadesOferecidas(e.ctx, e.deps, e.modo);
  const cartoes: CartaoDoTurno[] = [];
  let chamadas = 0;

  const ferramentas: ToolSet = {};
  for (const cap of oferecidas) {
    ferramentas[cap.nome] = tool({
      description: cap.descricao,
      // `loose`: campo a mais NÃO é descartado em silêncio pelo SDK. Ele chega ao
      // executor, que valida no modo estrito, recusa e audita (um argumento
      // nomeando outra empresa vira recusa registrada, não um campo ignorado).
      inputSchema: cap.entrada.loose(),
      execute: async (args: unknown) => {
        chamadas += 1;
        if (chamadas > e.ferramentasPorTurno) return RECUSA_POR_LIMITE_DE_FERRAMENTAS;
        if (cap.nivel === "ler") {
          const r = await executarLeitura(cap.nome, args, e.ctx, e.deps);
          if (r.ok && cap.nome === CAPACIDADE_DE_APONTAR_TELA) {
            const d = r.dados as { pode_abrir?: unknown; nome?: unknown; abrir?: unknown } | null;
            if (d?.pode_abrir === true && typeof d.abrir === "string" && typeof d.nome === "string") {
              e.aoApontarTela?.({ nome: d.nome, abrir: d.abrir });
            }
          }
          return embrulharComoDado(cap.nome, r.ok ? r.dados : { recusado: true, motivo: r.motivo });
        }
        const r = await proporEscrita(cap.nome, args, e.conversaId, e.ctx, e.deps);
        if (!r.ok) return embrulharComoDado(cap.nome, { recusado: true, motivo: r.motivo });
        const cartao: CartaoDoTurno = {
          acaoId: r.acaoId,
          capacidade: cap.nome,
          nivel: r.nivel,
          resumo: r.resumo,
          itens: r.itens,
          expiraEm: r.expiraEm,
        };
        cartoes.push(cartao);
        e.aoCartao(cartao);
        return "Cartão criado e mostrado ao usuário. NADA foi alterado ainda: a ação só acontece se ele confirmar. Diga em uma frase o que o cartão fará e espere.";
      },
    });
  }

  const emissor = criarEmissor(e.aoEscrever);

  const tentar = async (
    model: LanguageModel,
  ): Promise<{ ok: true; uso: { entrada: number; saida: number } } | { ok: false; erro: unknown }> => {
    let erroDoStream: unknown = null;
    try {
      const resposta = streamText({
        model,
        system: e.system,
        messages: e.mensagens,
        tools: ferramentas,
        // Um passo a mais que o limite: o modelo recebe a recusa e ainda fecha a resposta.
        stopWhen: stepCountIs(e.ferramentasPorTurno + 2),
        onError: ({ error }) => {
          erroDoStream = error;
        },
      });
      for await (const delta of resposta.textStream) emissor.receber(delta);
      if (erroDoStream) return { ok: false, erro: erroDoStream };
      const uso = await resposta.totalUsage;
      return { ok: true, uso: { entrada: uso.inputTokens ?? 0, saida: uso.outputTokens ?? 0 } };
    } catch (erro) {
      return { ok: false, erro: erroDoStream ?? erro };
    }
  };

  const tentativa = await tentar(e.provedor.model);

  if (!tentativa.ok) {
    return {
      texto: emissor.fechar(),
      cartoes,
      uso: { entrada: 0, saida: 0 },
      chamadasDeFerramenta: chamadas,
      falha: e.provedor.classificarFalha(tentativa.erro),
    };
  }
  return { texto: emissor.fechar(), cartoes, uso: tentativa.uso, chamadasDeFerramenta: chamadas };
}
