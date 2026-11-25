/**
 * O VIX ESTÁ LIGADO? Uma resposta só, para a tela e para as rotas.
 *
 * Três perguntas, nesta ordem, e a primeira que disser não encerra:
 *
 *  1. a INSTALAÇÃO: `VIX_PAGADOR` diferente de `desligado` (a chave geral;
 *     ausente ou desconhecida vale desligado);
 *  2. a EMPRESA: não desligou o dela (`assistente_estado_da_empresa.ligado`;
 *     sem linha = ligado);
 *  3. o DIREITO: a organização tem a marca `sem_limite` ou um plano com linha
 *     em `assistente_planos` (`configDoVix`).
 *
 * Desligado nas duas primeiras = o botão some e as rotas recusam. Na terceira,
 * o botão também não aparece, e a rota explica que o plano não inclui o
 * assistente.
 *
 * Quem consome: `app/app/layout.tsx` (não monta o painel) e toda rota de
 * `/api/v1/assistente`. A organização vem SEMPRE da sessão, resolvida por quem
 * chama; `admin` é o cliente de serviço, porque a configuração da instalação e
 * a do plano são do servidor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { moduloLigado } from "@/lib/instalacao/modulos";
import { logger } from "@/lib/logger";

import { configDoVix, type ConfigDoVix } from "./custo";
import { pagadorDoVix, type Pagador } from "./provedor";

export type MotivoDoVixDesligado = "desligado_na_instalacao" | "desligado_na_empresa" | "sem_plano";

export type EstadoDoVix =
  | { ligado: true; pagador: Exclude<Pagador, "desligado">; config: ConfigDoVix }
  | { ligado: false; motivo: MotivoDoVixDesligado };

/** A empresa deixou o assistente ligado? Erro de leitura = desligado (falha fechada). */
export async function empresaDeixouLigado(admin: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("assistente_estado_da_empresa")
    .select("ligado")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) {
    logger.warn("vix: estado da empresa ilegível — tratado como desligado", {
      organization_id: orgId,
      erro: error.message,
    });
    return false;
  }
  return (data as { ligado?: boolean } | null)?.ligado !== false;
}

export async function estadoDoVix(admin: SupabaseClient, orgId: string): Promise<EstadoDoVix> {
  const pagador = await pagadorDoVix();
  if (pagador === "desligado") return { ligado: false, motivo: "desligado_na_instalacao" };
  if (!(await empresaDeixouLigado(admin, orgId))) return { ligado: false, motivo: "desligado_na_empresa" };
  const config = await configDoVix(admin, orgId);
  if (!config) return { ligado: false, motivo: "sem_plano" };
  return { ligado: true, pagador, config };
}

/** As escritas do assistente no CRM (cartões) estão ligadas na instalação? */
export async function escritasDoVixLigadas(admin: SupabaseClient): Promise<boolean> {
  return moduloLigado(admin, "assistente_escritas");
}
