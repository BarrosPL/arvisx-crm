import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { traduzir } from "@/lib/i18n/dicionario";
import { enviarProposta } from "@/lib/propostas/enviar-proposta";
import { sePropostasDesligadas } from "@/lib/propostas/porta";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const corpoSchema = z.object({ revision: z.number().int().positive().optional() });

/**
 * POST /api/v1/proposals/[id]/send — a pessoa (`manager`) envia a proposta.
 *
 * Casca fina: autentica, chama `enviarProposta` (`lib/propostas/enviar-proposta.ts`)
 * e traduz o resultado em resposta. A regra do envio mora lá, porque a
 * ferramenta `crm_send_proposal` dos agentes usa a mesma.
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_proposals" });
  if (!authz.ok) return authz.response;
  const desligada = await sePropostasDesligadas(authz.org.orgId, requestId);
  if (desligada) return desligada;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;

  // `revision` é opcional: a tela manda a revisão que está mostrando, e o envio
  // é recusado (409) se o rascunho mudou desde então. Quem chama sem ela (um
  // cliente antigo, uma integração) continua enviando o rascunho como está; a
  // guarda contra o envio em dobro vale nos dois casos.
  const corpo = corpoSchema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!corpo.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, { requestId, details: corpo.error.flatten() });
  }

  const resultado = await enviarProposta(createAdminClient(), {
    orgId: authz.org.orgId,
    propostaId: id,
    requestId,
    quem: { actor: { type: "user", id: authz.user.id }, userId: authz.user.id, idioma: authz.user.idioma },
    t,
    ...(corpo.data.revision !== undefined ? { revisaoEsperada: corpo.data.revision } : {}),
  });

  if (resultado.tipo === "recusa") {
    // §5.2 — enviar com qualquer item sem preço é recusado, com a lista.
    if (resultado.motivo === "item_sem_preco") {
      const semPreco = resultado.itens ?? [];
      return fail(
        "validation_failed",
        t(`Item sem preço definido: ${semPreco.join(", ")}. Defina o preço antes de enviar.`),
        422,
        { requestId },
      );
    }
    return fail(resultado.codigo as Parameters<typeof fail>[0], resultado.mensagem, resultado.status, { requestId });
  }
  return ok(resultado.proposta, { requestId });
}
