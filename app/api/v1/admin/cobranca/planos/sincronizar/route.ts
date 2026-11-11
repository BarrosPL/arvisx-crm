/**
 * POST /api/v1/admin/cobranca/planos/sincronizar — "Sincronizar produtos na
 * Stripe" (Admin › Cobrança › Planos), só para o dono da instalação.
 *
 * Cria ou atualiza, na conta da chave SALVA (de teste ou real, a que estiver
 * conectada), o produto de cada plano ativo, com o código fiscal de SaaS. O
 * produto de um plano só nascia na primeira compra dele; a Stripe pede produtos
 * com código elegível para liberar o Managed Payments, e este botão os cria
 * antes da primeira venda.
 *
 * Idempotente: o id do produto é fixo por plano (`dc_plano_<uuid>`), então
 * repetir só atualiza — nunca duplica. O resultado sai por plano (`criado`,
 * `atualizado` ou `erro` com o código do provedor); um plano que falha não
 * impede os outros. Sem corpo: nada do pedido escolhe conta, chave ou plano.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  falhaDaEscritaDePlatformAdmin,
  requirePlatformAdminEscrita,
  type PlatformAdminContext,
} from "@/lib/auth/requirePlatformAdmin";
import { provedorDaInstalacao } from "@/lib/cobranca/configuracao";
import { adaptador, modoDoProvedor } from "@/lib/cobranca/provedores";
import { ErroDoProvedor } from "@/lib/cobranca/provedores/contrato";
import type { Intervalo, Moeda } from "@/lib/cobranca/vocabulario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface PlanoAtivo {
  id: string;
  nome: string;
  preco_cents: number;
  moeda: Moeda;
  intervalo: Intervalo;
  fora_do_managed_payments: boolean;
}

export type ResultadoDoProduto =
  | { plano_id: string; nome: string; resultado: "criado" | "atualizado" }
  | { plano_id: string; nome: string; resultado: "erro"; erro: string };

export async function POST() {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  let ctx: PlatformAdminContext;
  try {
    ctx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  const admin = createAdminClient();
  if (!(await moduloLigado(admin, "cobranca"))) return fail("not_found", "Not found", 404, { requestId });

  const modo = (await provedorDaInstalacao()) === "stripe" ? await modoDoProvedor("stripe") : null;
  if (modo === null) {
    return fail("stripe_nao_conectada", "Conecte a Stripe em Cobrança › Conexão antes de sincronizar os produtos.", 409, { requestId });
  }

  const { data, error } = await admin
    .from("cobranca_planos")
    .select("id, nome, preco_cents, moeda, intervalo, fora_do_managed_payments")
    .is("arquivado_em", null)
    .order("nome");
  if (error) return fail("internal_error", "Não foi possível ler os planos.", 500, { requestId });
  const planos = (data ?? []) as PlanoAtivo[];

  const stripe = adaptador("stripe");
  const resultados: ResultadoDoProduto[] = [];
  // Um por vez: são poucos planos, e em sequência a Stripe não devolve 429.
  for (const p of planos) {
    try {
      const resultado = await stripe.sincronizarProduto!({
        id: p.id, nome: p.nome, precoCents: p.preco_cents, moeda: p.moeda, intervalo: p.intervalo,
        foraDoManagedPayments: p.fora_do_managed_payments === true,
      });
      resultados.push({ plano_id: p.id, nome: p.nome, resultado });
    } catch (e) {
      if (!(e instanceof ErroDoProvedor)) throw e;
      // Só o código do provedor: a mensagem dele pode ecoar pedaço da chave.
      resultados.push({ plano_id: p.id, nome: p.nome, resultado: "erro", erro: e.codigo });
    }
  }

  const contar = (r: ResultadoDoProduto["resultado"]) => resultados.filter((x) => x.resultado === r).length;
  const resumo = { criados: contar("criado"), atualizados: contar("atualizado"), erros: contar("erro") };
  // Rodada sem plano nenhum não fez nada na Stripe: não é mutação, não audita.
  if (planos.length > 0) {
    void audit({
      action: "cobranca.produtos_sincronizados",
      actorUserId: ctx.user.id,
      actingAsPlatformAdmin: true,
      bypassedRls: true,
      resourceType: "cobranca_plano",
      requestId,
      metadata: { modo, ...resumo },
    });
  }
  return ok({ modo, ...resumo, resultados }, { requestId });
}
