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
 * Sem o cabeçalho nada muda: a escrita roda como sempre. O turno nativo não
 * manda cabeçalho — ele não passa pela rede.
 *
 * A RECUSA não vira recibo: quem repete depois de consertar o pedido (ou depois
 * de a condição mudar) precisa ser atendido, e não receber de volta a recusa
 * gravada 24 horas antes.
 */
import { comIdempotencia } from "@/lib/api/idempotency";

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

export async function comChaveDoPedido<T extends object>(
  ctx: McpContext,
  ferramenta: string,
  corpo: unknown,
  executar: () => Promise<T | RecusaParaOAgente>,
): Promise<T | RecusaParaOAgente> {
  if (!ctx.idempotencyKey) return executar();

  try {
    const desfecho = await comIdempotencia<T>({
      db: ctx.supabase,
      organizationId: ctx.organizationId,
      endpoint: `mcp:${ferramenta}`,
      chave: ctx.idempotencyKey,
      corpo,
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
        return { ...desfecho.resposta, idempotent_replay: true };
      case "conflito":
        return recusa(
          "chave_de_idempotencia_em_conflito",
          "esta Idempotency-Key já foi usada com outros dados nesta ferramenta. Gere uma chave " +
            "nova para um pedido novo; repita a mesma chave só para repetir o MESMO pedido.",
        );
      case "em_curso":
        return recusa(
          "pedido_em_andamento",
          "um pedido com esta Idempotency-Key ainda está sendo processado. Espere alguns " +
            "segundos e repita com a mesma chave para receber o resultado.",
        );
    }
  } catch (erro) {
    if (erro instanceof RecusaNaoViraRecibo) return erro.recusa;
    throw erro;
  }
}
