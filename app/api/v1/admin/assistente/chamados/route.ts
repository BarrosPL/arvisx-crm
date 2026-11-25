/**
 * GET /api/v1/admin/assistente/chamados — os chamados que as empresas abriram
 * pelo assistente, para a EQUIPE DA PLATAFORMA.
 *
 * É o leitor do chamado: sem esta rota (e a tela que a consome) o
 * `suporte_abrir_chamado` gravaria um pedido que ninguém vê.
 *
 * Só equipe da plataforma (`requirePlatformAdmin`). A leitura cruza empresas e
 * por isso usa a chave de serviço; a guarda é a única porta. O administrador de
 * uma empresa NÃO passa aqui: ele lê os chamados da própria empresa pela RLS.
 *
 * Devolve o diagnóstico anexado inteiro (o que o assistente juntou na hora).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const consulta = z
  .object({
    estado: z.enum(["aberto", "em_andamento", "resolvido", "todos"]).default("aberto"),
    limite: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch (erro) {
    return falhaDaEscritaDePlatformAdmin(erro, requestId);
  }

  const lida = consulta.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!lida.success) return fail("validation_failed", "Parâmetros inválidos.", 422, { requestId });

  const admin = createAdminClient();
  let pedido = admin
    .from("assistente_chamados")
    .select(
      "id, organization_id, user_id, resumo, diagnostico, estado, created_at, updated_at, visto_em, visto_por, resolvido_em, resolvido_por",
    )
    .order("created_at", { ascending: false })
    .limit(lida.data.limite);
  if (lida.data.estado !== "todos") pedido = pedido.eq("estado", lida.data.estado);

  const { data, error } = await pedido;
  if (error) return fail("internal_error", "Não foi possível ler os chamados.", 500, { requestId });

  const linhas = data ?? [];
  const orgs = [...new Set(linhas.map((l) => l.organization_id))];
  const nomes = new Map<string, { nome: string; slug: string }>();
  if (orgs.length > 0) {
    const { data: empresas } = await admin.from("organizations").select("id, display_name, slug").in("id", orgs);
    for (const e of empresas ?? []) nomes.set(e.id, { nome: e.display_name, slug: e.slug });
  }

  return ok(
    linhas.map((l) => ({
      ...l,
      empresa: nomes.get(l.organization_id) ?? null,
    })),
    { requestId },
  );
}
