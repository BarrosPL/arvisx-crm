import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/contacts/merge — junta dois cadastros da MESMA pessoa em um.
 *
 * A regra inteira mora em `fn_mesclar_contatos` (migration 0215), e de propósito:
 * a fusão trava as duas pontas, reponta TODA FK que aponta para o perdedor —
 * lista derivada de `pg_constraint`, não escrita à mão — e escreve a lápide na
 * MESMA transação. Fazer isso em TypeScript, com um `update` por tabela, daria
 * fusão pela metade a cada timeout, e fusão não tem desfazer.
 *
 * Esta rota é a porta: autoriza, valida, chama, audita. `manager` é o piso — o
 * mesmo das policies de `merge_queue` —, e o gate é `requireRole`, nunca uma
 * comparação de rank na mão.
 *
 * O cliente é o do USUÁRIO (cookie), não o admin: assim `auth.uid()` chega à
 * função, ela reconfere o papel na org e a atividade da timeline sai com
 * `performed_by_user_id` preenchido. Trocar por service role apagaria as três
 * coisas de uma vez.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { desfechoDaFusao, type ResultadoDaFusao } from "@/lib/contacts/fusao-de-contatos";
import { contactsMergeSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "contact" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  let input;
  try {
    input = await validateRequest(contactsMergeSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_mesclar_contatos", {
    p_organization_id: org.orgId,
    p_contato_principal: input.primary_contact_id,
    p_contatos_secundarios: input.secondary_contact_ids,
  });

  if (error) {
    // O mapa do que a função levanta para o que o operador lê mora em
    // `lib/contacts/fusao-de-contatos.ts`, que a ferramenta do agente também usa.
    const previsto = desfechoDaFusao(error.message);
    if (previsto) {
      return fail(previsto.code, previsto.message, previsto.status, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  const resultado = data as unknown as ResultadoDaFusao;

  // A auditoria é o rastro que EXISTE SEMPRE. A timeline do passo 7 da função
  // só tem onde escrever quando o vencedor tem negócio no funil
  // (`crm_lead_activities.lead_id` é NOT NULL); um contato sem negócio nenhum
  // sairia da fusão sem registro em lugar algum se esta linha não existisse.
  await audit({
    action: "contact.merged",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "contact",
    resourceId: input.primary_contact_id,
    requestId,
    metadata: {
      merged_contact_ids: input.secondary_contact_ids,
      repointed: resultado.repontado,
      // O que NÃO foi repontado vai junto, e não só o que deu certo: são linhas
      // que continuam apontando para a lápide (colisão com um índice único de
      // runtime). Auditar só o sucesso descreveria uma fusão completa que não foi.
      not_repointed: resultado.nao_repontado,
      timeline_activities: resultado.atividades_emitidas,
    },
  });

  return ok(resultado, { requestId });
}
