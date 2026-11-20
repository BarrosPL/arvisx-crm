/**
 * A RÉGUA DO RECUPERADOR — o fluxo de follow-up que a equipe pronta instala.
 *
 * Mesmo mecanismo de `POST /api/v1/ai/followup-flows/from-model`: um ponteiro
 * em `followup_flow_pointers` com grafo e gatilho, publicado e ligado ao agente
 * por `followup.flow_pointer_ids`. A diferença é só de onde vêm os números: lá
 * de um modelo fixo, aqui das respostas da empresa (bloco 9 do questionário).
 *
 * ⚠️ AS MENSAGENS SÃO GERADAS (`ai_message`), NÃO TEXTO FIXO. O papel do
 * Recuperador manda retomar com uma mensagem PESSOAL, citando o que a pessoa
 * queria — e texto fixo é o contrário disso, além de ser texto de nicho
 * nenhum: a dica ao modelo é genérica e não cita ramo, preço nem horário.
 *
 * ⚠️ LEAD FRIO FICA DE FORA PELO PRÓPRIO GATILHO. O gatilho de silêncio só
 * alcança silêncio RECENTE (`max_silence_minutes`, teto de 7 dias do schema).
 * Quem está parado há mais tempo que isso não entra na régua sozinho — a
 * retomada de lead frio é por `crm_propose_reactivation`, com aprovação humana.
 */
import { createHash } from "node:crypto";

import type { TriggerConfig } from "@/lib/followup/api-schemas";
import type { FlowEdge, FlowGraph, FlowNode } from "@/lib/followup/graph-schema";
import { rotuloDaEspera } from "@/lib/followup/modelos/escada";
import type { PerfilDoNegocio } from "@/lib/schemas/equipe-pronta";
import { NO_DE_INICIO_DA_ESCADA } from "./constantes";

/** `followup_flow_pointers` tem `unique (organization_id, name)`: é por ele que se reencontra. */
export const NOME_DA_REGUA = "Equipe pronta · Recuperação de vendas";

const DIA_MS = 86_400_000;
const MINUTOS_POR_DIA = 1440;
/** Teto de `threshold_minutes`/`max_silence_minutes` em `triggerConfigSchema`. */
const TETO_DO_SILENCIO_MIN = 10_080;
const COLUNA = 260;

const DICA_DO_PRIMEIRO_TOQUE =
  "Retome a conversa com uma mensagem curta e pessoal. Cite, em uma frase, o que a pessoa " +
  "procurava ou onde a conversa parou, e termine com uma pergunta simples que seja fácil de " +
  "responder. Não pressione, não ofereça desconto e não escreva valor nem data de memória.";

const DICA_DOS_TOQUES_SEGUINTES =
  "A pessoa não respondeu à mensagem anterior. Escreva uma última retomada, ainda mais curta, " +
  "sem repetir o texto de antes: mostre que continua à disposição e deixe claro que ela pode " +
  "responder quando quiser ou avisar se não tem mais interesse. Não pressione, não ofereça " +
  "desconto e não escreva valor nem data de memória.";

function aresta(
  source: string,
  target: string,
  condition: FlowEdge["condition"] = { type: "always" },
): FlowEdge {
  const sufixo = condition.type === "branch" ? condition.branch_id : "segue";
  return { id: `${source}__${target}__${sufixo}`, source, target, priority: 0, condition };
}

/** O gatilho: silêncio recente, só de quem a equipe já respondeu. */
export function gatilhoDaRegua(perfil: PerfilDoNegocio): TriggerConfig {
  const limiar = Math.min(
    perfil.recuperacao.dias_para_esfriar * MINUTOS_POR_DIA,
    TETO_DO_SILENCIO_MIN - MINUTOS_POR_DIA,
  );
  return {
    kind: "silence",
    params: {
      threshold_minutes: limiar,
      // Só silêncio RECENTE entra sozinho; o resto é lead frio, com aprovação.
      max_silence_minutes: TETO_DO_SILENCIO_MIN,
      // Dívida da equipe não é silêncio do cliente: só retoma quem já foi respondido.
      exige_resposta_da_equipe: true,
    },
    // Respondeu, a régua para — e a resposta volta ao roteador da equipe.
    cancel_on_reply: true,
  };
}

/**
 * O grafo: uma escada de `toques_maximos` mensagens geradas, com
 * `intervalo_dias` entre elas. Ids estáveis e legíveis, como em
 * `lib/followup/modelos/escada.ts`, porque aparecem no dossiê da inscrição.
 */
export function grafoDaRegua(perfil: PerfilDoNegocio): FlowGraph {
  return escadaDeRetomada(perfil, {
    primeiroToque: DICA_DO_PRIMEIRO_TOQUE,
    toquesSeguintes: DICA_DOS_TOQUES_SEGUINTES,
  });
}

/**
 * A ESCADA — a mesma para a régua de silêncio e para os fluxos dos gatilhos
 * (`gatilhos/fluxos.ts`): `toques_maximos` mensagens geradas, com
 * `intervalo_dias` entre elas. Só as dicas ao modelo mudam de um fluxo para o
 * outro; o limite de toques é o mesmo por construção.
 */
export function escadaDeRetomada(
  perfil: PerfilDoNegocio,
  dicas: { primeiroToque: string; toquesSeguintes: string },
): FlowGraph {
  const { toques_maximos: toques, intervalo_dias: intervalo } = perfil.recuperacao;
  const esperaMs = intervalo * DIA_MS;
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  let coluna = 0;
  const x = () => COLUNA * coluna++;

  const INICIO = NO_DE_INICIO_DA_ESCADA;
  const FIM_VOLTOU = "fim-voltou";
  const FIM_RESPONDEU = "fim-respondeu";
  const FIM_ESGOTOU = "fim-esgotou";

  nodes.push({ id: INICIO, type: "trigger", label: "Início", position: { x: x(), y: 0 }, config: {} });

  for (let n = 1; n <= toques; n++) {
    // Só o primeiro degrau pendura no gatilho; do segundo em diante quem liga é
    // a saída "sem resposta" do degrau anterior (mesma regra de `montarEscada`).
    let anterior: string | null = n === 1 ? INICIO : null;

    if (n > 1) {
      const espera = `espera-${n}`;
      nodes.push({
        id: espera,
        type: "wait",
        label: rotuloDaEspera(esperaMs),
        position: { x: x(), y: 0 },
        config: { mode: "fixed", duration_ms: esperaMs },
      });
      anterior = espera;
    }

    const msg = `msg-${n}`;
    nodes.push({
      id: msg,
      type: "action",
      label: n === 1 ? "Retoma a conversa" : "Última tentativa",
      position: { x: x(), y: 0 },
      config: {
        mode: "ai_message",
        prompt_hint: n === 1 ? dicas.primeiroToque : dicas.toquesSeguintes,
      },
    });
    if (anterior) edges.push(aresta(anterior, msg));

    const resposta = `resposta-${n}`;
    nodes.push({
      id: resposta,
      type: "match_reply",
      label: "Espera a resposta",
      position: { x: x(), y: 0 },
      config: {
        branches: [{ id: "voltou", label: "Voltou com interesse", op: "contains", pattern: "quero" }],
        grace_timeout_ms: esperaMs,
      },
    });
    edges.push(aresta(msg, resposta));
    edges.push(aresta(resposta, FIM_VOLTOU, { type: "branch", branch_id: "voltou" }));
    edges.push(aresta(resposta, FIM_RESPONDEU, { type: "always" }));
    if (n === toques) {
      edges.push(aresta(resposta, FIM_ESGOTOU, { type: "branch", branch_id: "no_reply" }));
    }
  }

  const xFim = COLUNA * coluna;
  nodes.push(
    {
      id: FIM_VOLTOU,
      type: "end",
      label: "Fim: voltou com interesse",
      position: { x: xFim, y: -200 },
      config: { outcome: "converted" },
    },
    {
      id: FIM_RESPONDEU,
      type: "end",
      label: "Fim: respondeu",
      position: { x: xFim, y: 0 },
      config: { outcome: "custom", note: "A pessoa respondeu: a equipe de IA segue a conversa." },
    },
    {
      id: FIM_ESGOTOU,
      type: "end",
      label: "Fim: sem resposta",
      position: { x: xFim, y: 200 },
      config: { outcome: "exhausted" },
    },
  );

  for (let n = 1; n < toques; n++) {
    edges.push(aresta(`resposta-${n}`, `espera-${n + 1}`, { type: "branch", branch_id: "no_reply" }));
  }

  return { nodes, edges } as FlowGraph;
}

/** O hash do que a régua seria agora — é o que diz se precisa republicar. */
export function hashDaRegua(perfil: PerfilDoNegocio): string {
  return createHash("sha256")
    .update(JSON.stringify({ grafo: grafoDaRegua(perfil), gatilho: gatilhoDaRegua(perfil) }))
    .digest("hex");
}
