import { fail } from "@/lib/api/wrappers";
import { EquipeProntaError } from "@/lib/ai/equipe-pronta/instalar";
import { logger } from "@/lib/logger";

/**
 * A recusa das rotas da equipe pronta, num lugar só.
 *
 * `EquipeProntaError` é recusa de negócio: sai com o código, a mensagem para
 * quem usa e os detalhes (a lista de agentes editados à mão, os itens
 * pendentes do checklist). Qualquer outra coisa é falha nossa: vai para o log
 * e sai genérica — a mensagem do banco não chega à tela.
 */
export function respostaDeErro(erro: unknown, requestId: string, onde: string): Response {
  if (erro instanceof EquipeProntaError) {
    return fail(`equipe_pronta_${erro.codigo}`, erro.message, erro.status, {
      requestId,
      ...(erro.detalhes ? { details: erro.detalhes } : {}),
    });
  }
  logger.error(`[equipe-pronta] ${onde} falhou`, {
    request_id: requestId,
    erro: erro instanceof Error ? erro.message : String(erro),
  });
  return fail(
    "internal_error",
    "Não foi possível concluir agora. Tente de novo em instantes.",
    500,
    { requestId },
  );
}
