/**
 * POST /api/v1/assistente/acoes/:id/confirmar — o CLIQUE que executa um cartão.
 *
 * É a única rota por onde uma escrita proposta pelo Vix acontece, e o único
 * arquivo que importa `executarConfirmada` (cerca:
 * `tests/unit/assistente-catalogo-cerca.test.ts`). O modelo não chega aqui:
 * quem chama é o navegador do usuário, com a sessão dele.
 *
 * O cartão é reservado no banco com o usuário e a organização da SESSÃO:
 * repetido, expirado, de outra pessoa ou de outra empresa não reserva, e a
 * resposta é a mesma 409 para os quatro (não confirma que o cartão existe).
 * Reservado, tudo é revalidado com o estado de agora: papel, plano, módulo,
 * escritas ligadas, entrada e lote.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { executarConfirmada, type MotivoDaConfirmacao } from "@/lib/assistente/confirmar";
import { escritasDoVixLigadas, estadoDoVix } from "@/lib/assistente/disponibilidade";
import { FRASES, FRASES_DA_CONFIRMACAO } from "@/lib/assistente/frases";
import { auditarVix, dependenciasReais } from "@/lib/assistente/servidor";
import { RANK_DO_PAPEL, type ContextoDoAssistente, type PapelHumano } from "@/lib/assistente/tipos";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const corpoDoPost = z.object({ confirmacao: z.string().trim().max(40).optional() }).strict();

/** O que o usuário lê e o status HTTP de cada recusa. */
const RECUSA: Record<MotivoDaConfirmacao, { frase: string; status: number; codigo: string }> = {
  cartao_indisponivel: { frase: FRASES_DA_CONFIRMACAO.indisponivel, status: 409, codigo: "assistente_acao_indisponivel" },
  confirmacao_ausente: { frase: FRASES_DA_CONFIRMACAO.palavra, status: 422, codigo: "assistente_confirmacao_ausente" },
  papel_insuficiente: { frase: FRASES_DA_CONFIRMACAO.papel, status: 403, codigo: "forbidden_role" },
  fora_do_plano: { frase: FRASES_DA_CONFIRMACAO.plano, status: 403, codigo: "assistente_fora_do_plano" },
  modulo_desligado: { frase: FRASES_DA_CONFIRMACAO.plano, status: 403, codigo: "assistente_fora_do_plano" },
  escritas_desligadas: { frase: FRASES_DA_CONFIRMACAO.desligadas, status: 403, codigo: "assistente_escritas_desligadas" },
  lote_acima_do_limite: { frase: FRASES_DA_CONFIRMACAO.lote, status: 422, codigo: "assistente_lote_acima_do_limite" },
  proibida: { frase: FRASES_DA_CONFIRMACAO.papel, status: 403, codigo: "assistente_acao_proibida" },
  capacidade_inexistente: { frase: FRASES_DA_CONFIRMACAO.falhou, status: 422, codigo: "assistente_acao_invalida" },
  nivel_errado: { frase: FRASES_DA_CONFIRMACAO.falhou, status: 422, codigo: "assistente_acao_invalida" },
  entrada_invalida: { frase: FRASES_DA_CONFIRMACAO.falhou, status: 422, codigo: "assistente_acao_invalida" },
  falha_ao_executar: { frase: FRASES_DA_CONFIRMACAO.falhou, status: 500, codigo: "assistente_acao_falhou" },
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "assistente_acoes" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const t = (texto: string) => traduzir(texto, user.idioma);

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("validation_failed", t("Dados inválidos."), 422, { requestId });
  }
  const lido = corpoDoPost.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", t("Dados inválidos."), 422, { requestId });

  const papel = org.role as PapelHumano;
  if (RANK_DO_PAPEL[papel] === undefined) {
    return fail("forbidden_role", t(FRASES_DA_CONFIRMACAO.papel), 403, { requestId });
  }

  const admin = createAdminClient();
  const estado = await estadoDoVix(admin, org.orgId);
  if (!estado.ligado) {
    return estado.motivo === "sem_plano"
      ? fail("assistente_fora_do_plano", t(FRASES.semPlano), 403, { requestId })
      : fail("assistente_desligado", t(FRASES.desligado), 403, { requestId });
  }

  const ctx: ContextoDoAssistente = {
    orgId: org.orgId,
    userId: user.id,
    papel,
    idioma: user.idioma,
    requestId,
    db: await createClient(),
  };
  const deps = await dependenciasReais(admin, ctx, {
    escritasLigadas: await escritasDoVixLigadas(admin),
    limiteDeLote: estado.config.limiteDeLote,
  });

  auditarVix("assistente.acao_confirmada", ctx, { recursoTipo: "assistente_acao", recursoId: id });
  const r = await executarConfirmada(admin, id, lido.data.confirmacao, ctx, deps);

  if (!r.ok) {
    auditarVix("assistente.acao_falhou", ctx, {
      recursoTipo: "assistente_acao",
      recursoId: id,
      metadata: { motivo: r.motivo, ...(r.capacidade ? { capacidade: r.capacidade } : {}) },
    });
    const recusa = RECUSA[r.motivo];
    return fail(recusa.codigo, t(recusa.frase), recusa.status, { requestId });
  }

  auditarVix("assistente.acao_executada", ctx, {
    recursoTipo: "assistente_acao",
    recursoId: id,
    metadata: { capacidade: r.capacidade },
  });
  return ok({ id, estado: "executada", capacidade: r.capacidade, resultado: r.resultado ?? null }, { requestId });
}
