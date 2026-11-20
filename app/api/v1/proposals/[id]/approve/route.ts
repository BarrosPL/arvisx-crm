import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { aprovarPropostaParaOAgente } from "@/lib/ai/equipe-pronta/gatilhos/proposta-aprovada";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { sePropostasDesligadas } from "@/lib/propostas/porta";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const paramsSchema = z.object({ id: z.string().uuid() });

/**
 * POST /api/v1/proposals/[id]/approve — "Aprovar e deixar o agente enviar".
 *
 * A pessoa (`manager`, o mesmo papel de enviar pela tela) aprova o rascunho. A
 * aprovação é gravada pelo servidor (a sessão não grava as duas colunas, pelo
 * gatilho de transição da 9814) e, na mesma chamada, o agente de Propostas da
 * Equipe pronta envia a proposta e move o negócio para proposta enviada.
 *
 * Casca fina: autentica e chama `aprovarPropostaParaOAgente`
 * (`lib/ai/equipe-pronta/gatilhos/proposta-aprovada.ts`), onde moram a regra e
 * as travas. Sem corpo: a organização vem da sessão e a proposta, do caminho.
 *
 * Resposta: `{ proposta, envio: { enviada, em_fila, motivo, mensagem }, negocio_movido }`.
 * Aprovar e não enviar é 200: a aprovação ficou gravada, e `envio.mensagem` diz
 * por que nada saiu.
 */
export async function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_proposals" });
  if (!authz.ok) return authz.response;
  const desligada = await sePropostasDesligadas(authz.org.orgId, requestId);
  if (desligada) return desligada;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, { requestId, details: params.error.flatten() });
  }

  try {
    const resultado = await aprovarPropostaParaOAgente(createAdminClient(), {
      orgId: authz.org.orgId,
      propostaId: params.data.id,
      userId: authz.user.id,
      requestId,
      idioma: authz.user.idioma,
      t,
    });
    if (resultado.tipo === "recusa") {
      return fail(resultado.codigo, resultado.mensagem, resultado.status, { requestId });
    }
    return ok(
      { proposta: resultado.proposta, envio: resultado.envio, negocio_movido: resultado.negocio_movido },
      { requestId },
    );
  } catch {
    return fail("internal_error", t("Não foi possível aprovar a proposta agora."), 500, { requestId });
  }
}
