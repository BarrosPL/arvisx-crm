/**
 * PATCH /api/v1/admin/cobranca/regua — a única escritora de
 * `COBRANCA_TOLERANCIA_DIAS` (spec da cobrança do revendedor §7g, §10, D-5) e
 * de `COBRANCA_MODO_FISCAL` (o modo fiscal em três estados: `desligado`,
 * `stripe_tax`, `managed_payments`; migration 9807).
 * De 5 a 30 dias inteiros: abaixo de 5, quem paga boleto na sexta seria
 * suspenso na segunda; a régua também tem o piso no código.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  falhaDaEscritaDePlatformAdmin,
  requirePlatformAdminEscrita,
  type PlatformAdminContext,
} from "@/lib/auth/requirePlatformAdmin";
import { TOLERANCIA_MAXIMA_DIAS, TOLERANCIA_MINIMA_DIAS, modoFiscal, toleranciaDias } from "@/lib/cobranca/configuracao";
import { MODOS_FISCAIS } from "@/lib/cobranca/vocabulario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { gravarPelaTela } from "@/lib/instalacao/config";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoSchema = z
  .strictObject({
    tolerancia_dias: z.number().int().min(TOLERANCIA_MINIMA_DIAS).max(TOLERANCIA_MAXIMA_DIAS).optional(),
    modo_fiscal: z.enum(MODOS_FISCAIS).optional(),
  })
  .refine((v) => v.tolerancia_dias !== undefined || v.modo_fiscal !== undefined, "Nada para mudar.");

export async function PATCH(req: NextRequest) {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  let ctx: PlatformAdminContext;
  try {
    ctx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  if (!(await moduloLigado(createAdminClient(), "cobranca"))) return fail("not_found", "Not found", 404, { requestId });
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) {
    return fail("validation_failed", "A tolerância vai de 5 a 30 dias, e o imposto é desligado, Stripe Tax ou Managed Payments.", 422, { requestId, details: corpo.error.flatten() });
  }
  const { tolerancia_dias: para, modo_fiscal: modo } = corpo.data;
  const de = await toleranciaDias();
  const modoAntes = await modoFiscal();
  if (para !== undefined) {
    const gravado = await gravarPelaTela("COBRANCA_TOLERANCIA_DIAS", String(para), { ehSegredo: false, ator: ctx.user.id });
    if (!gravado.ok) return fail("internal_error", "Não foi possível salvar a régua.", 500, { requestId });
  }
  if (modo !== undefined) {
    const gravado = await gravarPelaTela("COBRANCA_MODO_FISCAL", modo, { ehSegredo: false, ator: ctx.user.id });
    if (!gravado.ok) return fail("internal_error", "Não foi possível salvar o imposto.", 500, { requestId });
  }
  void audit({
    action: "cobranca.regua_salva",
    actorUserId: ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    resourceType: "platform_config",
    requestId,
    metadata: {
      ...(para !== undefined ? { de, para } : {}),
      ...(modo !== undefined ? { modo_fiscal_de: modoAntes, modo_fiscal_para: modo } : {}),
    },
  });
  return ok({ tolerancia_dias: para ?? de, modo_fiscal: modo ?? modoAntes }, { requestId });
}
