/**
 * GET /api/v1/assistente/estado — o que o painel do Vix precisa para abrir:
 * se está ligado, o uso do mês contra o limite e se as ações estão ligadas.
 *
 * Nunca diz QUEM paga nem por que a instalação está desligada: para o usuário,
 * desligado é desligado.
 */
import { randomUUID } from "node:crypto";

import { ok } from "@/lib/api/wrappers";
import { mensagensUsadasNoMes } from "@/lib/assistente/custo";
import { escritasDoVixLigadas, estadoDoVix } from "@/lib/assistente/disponibilidade";
import { lerImplantacao } from "@/lib/assistente/implantacao";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "assistente" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const estado = await estadoDoVix(admin, authz.org.orgId);
  if (!estado.ligado) {
    return ok({ ligado: false, motivo: estado.motivo === "sem_acesso" ? "sem_acesso" : "desligado" }, { requestId });
  }
  // A implantação é assunto do administrador: é ele que monta a conta.
  const ehAdmin = authz.org.role === "admin";
  const [usadas, acoes, implantacao, conversas] = await Promise.all([
    mensagensUsadasNoMes(admin, authz.org.orgId),
    escritasDoVixLigadas(admin),
    ehAdmin ? lerImplantacao(admin, authz.org.orgId).catch(() => null) : Promise.resolve(null),
    ehAdmin
      ? admin
          .from("assistente_conversas")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", authz.org.orgId)
          .eq("user_id", authz.user.id)
          .then((r) => (r.error ? null : (r.count ?? 0)))
      : Promise.resolve(null),
  ]);
  return ok(
    {
      ligado: true,
      mensagens_no_mes: usadas,
      acoes_ligadas: acoes,
      // Só o administrador: o painel abre sozinho, uma vez, quando a conta está nova.
      implantacao: implantacao
        ? { completa: implantacao.completa, feitos: implantacao.feitos, total: implantacao.total }
        : null,
      primeira_vez: conversas === 0,
    },
    { requestId },
  );
}
