/**
 * GET /api/v1/admin/assistente/uso — o uso do assistente no mês, por
 * organização, para a ADMINISTRAÇÃO DA PLATAFORMA.
 *
 * Só equipe da plataforma. Devolve contagem, tokens, falhas e pessoas, com o
 * destaque de quem destoa (`lib/assistente/uso-da-plataforma.ts`). Nenhum texto
 * de mensagem: a tabela de uso não guarda texto.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { criterioDeAlerta, marcarQuemDestoa, usoDoMes } from "@/lib/assistente/uso-da-plataforma";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch (erro) {
    return falhaDaEscritaDePlatformAdmin(erro, requestId);
  }

  const admin = createAdminClient();
  const usos = await usoDoMes(admin);
  if (usos === null) return fail("internal_error", "Não foi possível ler o uso do assistente.", 500, { requestId });

  const criterio = await criterioDeAlerta();
  const marcados = marcarQuemDestoa(usos, criterio);
  const nomes = new Map<string, { nome: string; slug: string }>();
  if (marcados.length > 0) {
    const { data: empresas } = await admin
      .from("organizations")
      .select("id, display_name, slug")
      .in(
        "id",
        marcados.map((m) => m.organization_id),
      );
    for (const e of empresas ?? []) nomes.set(e.id, { nome: e.display_name, slug: e.slug });
  }

  return ok(
    {
      criterio,
      organizacoes: marcados.map((m) => ({ ...m, empresa: nomes.get(m.organization_id) ?? null })),
    },
    { requestId },
  );
}
