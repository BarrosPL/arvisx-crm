/**
 * `Idempotency-Key` nas escritas do agente por MCP.
 *
 * O agente externo fala com o CRM pela rede: a chamada pode gravar e a resposta
 * se perder, e quem repete sem proteção cria a tarefa (ou a nota, ou o anexo)
 * duas vezes. O cabeçalho `Idempotency-Key` da requisição MCP já chega ao
 * handler (`ctx.idempotencyKey`, validado como UUID em `app/api/mcp/route.ts`);
 * aqui ele é ligado ao MESMO recibo da API REST (`lib/api/idempotency.ts`,
 * tabela `idempotency_keys`, único por organização + chave + endpoint), com o
 * nome da ferramenta no lugar do endpoint.
 *
 * SEM O CABEÇALHO, a ferramenta que cria coisa (tarefa, nota, anexo) deriva a
 * chave do CONTEÚDO do pedido (revisão de 20/11, item 2.13). O agente externo
 * que esquece o cabeçalho e o turno nativo — que não passa pela rede e nunca o
 * manda — repetem a chamada do mesmo jeito: depois de um timeout, ou no replay
 * do mesmo job. A chave derivada é o resumo de QUEM pediu (token, agente,
 * contato do turno) e do QUE pediu, e vale por `JANELA_DA_CHAVE_DERIVADA_MS`:
 * o mesmo pedido, do mesmo autor, dentro da janela, devolve o primeiro
 * resultado em vez de criar de novo. A janela é curta de propósito — a chave
 * derivada não é promessa de quem chama, e duas tarefas iguais criadas com
 * horas de distância são duas tarefas. Quem quer criar duas iguais em seguida
 * manda uma `Idempotency-Key` nova em cada pedido.
 *
 * Só deriva quem passa `derivarDe`; as demais escritas seguem como antes.
 *
 * A RECUSA não vira recibo: quem repete depois de consertar o pedido (ou depois
 * de a condição mudar) precisa ser atendido, e não receber de volta a recusa
 * gravada 24 horas antes.
 */
import { comIdempotencia, hashDoCorpo } from "@/lib/api/idempotency";

import { recusa, type RecusaParaOAgente } from "./negocio-do-contexto";
import type { McpContext } from "./types";

class RecusaNaoViraRecibo extends Error {
  constructor(public readonly recusa: RecusaParaOAgente) {
    super("recusa");
  }
}

function ehRecusa(valor: unknown): valor is RecusaParaOAgente {
  return (
    typeof valor === "object" &&
    valor !== null &&
    (valor as { permitido?: unknown }).permitido === false
  );
}

/** Por quanto tempo o mesmo pedido, sem cabeçalho, devolve o primeiro resultado. */
export const JANELA_DA_CHAVE_DERIVADA_MS = 10 * 60 * 1000;

const AVISO_DA_CHAVE_DERIVADA =
  "pedido idêntico ao que você fez há menos de 10 minutos, sem Idempotency-Key: devolvi o " +
  "resultado do primeiro e nada foi criado de novo. Para criar outro igual de propósito, " +
  "envie uma Idempotency-Key nova.";

/**
 * A chave derivada do conteúdo. Leva QUEM pediu: dois agentes que escrevem a
 * mesma coisa não são repetição um do outro. Do ator entra o agente
 * (`agent_id`), nunca `actor.id` — no turno nativo ele é o id do run, que muda
 * a cada tentativa e faria o replay do mesmo job parecer um pedido novo.
 */
export function chaveDerivadaDoConteudo(
  ctx: McpContext,
  ferramenta: string,
  conteudo: unknown,
): string {
  const agente = ctx.actor.type === "ai_agent" ? (ctx.actor.agent_id ?? null) : null;
  return `auto:${hashDoCorpo({
    ferramenta,
    token: ctx.apiTokenId,
    agente,
    contato: ctx.contatoDoTurno ?? null,
    conteudo,
  })}`;
}

export async function comChaveDoPedido<T extends object>(
  ctx: McpContext,
  ferramenta: string,
  corpo: unknown,
  executar: () => Promise<T | RecusaParaOAgente>,
  opcoes: {
    /**
     * O conteúdo que identifica o pedido quando o cabeçalho falta. Ausente =
     * sem cabeçalho a escrita roda sem recibo, como sempre rodou.
     */
    derivarDe?: unknown;
  } = {},
): Promise<T | RecusaParaOAgente> {
  const derivada = !ctx.idempotencyKey && opcoes.derivarDe !== undefined;
  if (!ctx.idempotencyKey && !derivada) return executar();
  const chave = ctx.idempotencyKey ?? chaveDerivadaDoConteudo(ctx, ferramenta, opcoes.derivarDe);

  try {
    const desfecho = await comIdempotencia<T>({
      db: ctx.supabase,
      organizationId: ctx.organizationId,
      endpoint: `mcp:${ferramenta}`,
      chave,
      // Com chave derivada, o corpo conferido é o mesmo conteúdo que a gerou:
      // nunca há "mesma chave, outros dados".
      corpo: derivada ? opcoes.derivarDe : corpo,
      ...(derivada ? { ttlMs: JANELA_DA_CHAVE_DERIVADA_MS } : {}),
      executar: async () => {
        const resposta = await executar();
        if (ehRecusa(resposta)) throw new RecusaNaoViraRecibo(resposta);
        return { resposta, status: 200 };
      },
    });

    switch (desfecho.tipo) {
      case "executou":
        return desfecho.resposta;
      case "replay":
        // A resposta gravada da primeira execução — nada foi escrito de novo.
        return {
          ...desfecho.resposta,
          idempotent_replay: true,
          ...(derivada ? { idempotent_replay_reason: AVISO_DA_CHAVE_DERIVADA } : {}),
        };
      case "conflito":
        return recusa(
          "chave_de_idempotencia_em_conflito",
          "esta Idempotency-Key já foi usada com outros dados nesta ferramenta. Gere uma chave " +
            "nova para um pedido novo; repita a mesma chave só para repetir o MESMO pedido.",
        );
      case "em_curso":
        return recusa(
          "pedido_em_andamento",
          derivada
            ? "um pedido idêntico a este ainda está sendo processado. Espere alguns segundos e " +
                "repita para receber o resultado; nada foi criado em dobro."
            : "um pedido com esta Idempotency-Key ainda está sendo processado. Espere alguns " +
                "segundos e repita com a mesma chave para receber o resultado.",
        );
    }
  } catch (erro) {
    if (erro instanceof RecusaNaoViraRecibo) return erro.recusa;
    throw erro;
  }
}
