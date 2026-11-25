/**
 * A RODADA HORÁRIA DA COBRANÇA (spec da cobrança do revendedor §8).
 *
 * Três passos, nesta ordem:
 *  1. reconciliação — relê pela API quem `fn_cobranca_reconciliaveis` marca
 *     `precisa_reler`: 50 por rodada, a nunca lida primeiro. Cura o webhook
 *     perdido, o provedor que desistiu de avisar e a VPS que ficou fora do ar;
 *  2. régua só com o banco para as demais. Quem teve a leitura FALHANDO nesta
 *     rodada não passa pela régua: com o provedor fora, suspender seria decidir
 *     sobre uma linha velha;
 *  3. aviso de 80% da IA incluída no plano — a franquia de conversas ou o teto
 *     em dólar, o que estiver mais perto do fim —, um por empresa por CICLO (a
 *     função do banco deduplica); de 100% em diante quem fala é o bloqueio do
 *     motor. Só conta o que a chave da plataforma pagou (migration 9825).
 * Cada empresa é isolada: a falha de uma vira contagem e log, e a rodada segue.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AcaoDaRegua } from "@/lib/cobranca/regua";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma, type Idioma } from "@/lib/i18n/idiomas";
import { logger } from "@/lib/logger";
import { ehOperante } from "@/lib/organizacao/operante";

import { aplicarRegua, sincronizar, type DependenciasDaCobranca } from "./sincronizar";

export interface ResumoDaRodada {
  relidas: number;
  falhas: number;
  avisos: number;
  suspensas: number;
  reativadas: number;
  canceladas: number;
  avisosDeIa: number;
}

export const LIMITE_DA_RECONCILIACAO = 50;
const LIMIAR_DO_AVISO_DE_IA = 0.8;
// Teto de linhas por resposta do PostgREST (max_rows) numa instalação padrão.
const PAGE_SIZE = 1000;
const LOTE_DE_EMPRESAS = 200;

interface Reconciliavel {
  organization_id: string;
  relida_em: string | null;
  precisa_reler: boolean;
}

const instante = (v: string | null) => (v === null ? Number.MIN_SAFE_INTEGER : Date.parse(v));

export async function rodadaDaCobranca(admin: SupabaseClient, deps: DependenciasDaCobranca = {}): Promise<ResumoDaRodada> {
  const resumo: ResumoDaRodada = { relidas: 0, falhas: 0, avisos: 0, suspensas: 0, reativadas: 0, canceladas: 0, avisosDeIa: 0 };
  const contar = (acao: AcaoDaRegua["tipo"]) => {
    if (acao === "avisar") resumo.avisos += 1;
    else if (acao === "suspender") resumo.suspensas += 1;
    else if (acao === "reativar") resumo.reativadas += 1;
    else if (acao === "cancelar_no_provedor") resumo.canceladas += 1;
  };
  const falhou = (org: string, e: unknown) => {
    resumo.falhas += 1;
    logger.error("cobranca.rodada_falhou", { organization_id: org, erro: e instanceof Error ? e.message : "desconhecido" });
  };

  // O PostgREST pode cortar a resposta antes de ela chegar aqui (max_rows).
  // A prioridade e o recorte precisam valer no banco, inclusive para a
  // assinatura nunca lida que ficou depois das primeiras 1.000 linhas.
  const { data: conjunto, error } = await admin
    .rpc("fn_cobranca_reconciliaveis")
    .eq("precisa_reler", true)
    .order("relida_em", { ascending: true, nullsFirst: true })
    .limit(LIMITE_DA_RECONCILIACAO);
  if (error) throw new Error(`cobranca: reconciliáveis ilegíveis (${error.code ?? "sem_codigo"})`);
  const fila = ((conjunto ?? []) as Reconciliavel[])
    .filter((l) => l.precisa_reler)
    .sort((a, b) => instante(a.relida_em) - instante(b.relida_em))
    .slice(0, LIMITE_DA_RECONCILIACAO);

  const jaVistas = new Set<string>();
  for (const { organization_id: org } of fila) {
    jaVistas.add(org);
    try {
      const r = await sincronizar(admin, org, deps);
      if (r.tipo === "falhou") resumo.falhas += 1;
      // sem provedor a régua já rodou dentro de sincronizar: a ação aconteceu e tem de entrar no resumo
      if (r.tipo === "sem_provedor") contar(r.acao);
      if (r.tipo === "aplicada") {
        resumo.relidas += 1;
        contar(r.acao);
      }
    } catch (e) {
      falhou(org, e);
    }
  }

  const todas: Array<{ organization_id: string }> = [];
  let inicio = 0;
  for (let pagina = 0; pagina < 100; pagina++) {
    const { data: lote, error: erroDoLote } = await admin
      .from("cobranca_assinaturas")
      .select("organization_id")
      .not("organization_id", "is", null)
      // range sem ordem total não é paginação: o Postgres não garante a mesma ordem entre duas leituras
      .order("organization_id", { ascending: true })
      .range(inicio, inicio + PAGE_SIZE - 1);
    if (erroDoLote) throw new Error(`cobranca: assinaturas ilegíveis (${erroDoLote.code ?? "sem_codigo"})`);
    const linhasDoLote = (lote ?? []) as Array<{ organization_id: string }>;
    if (linhasDoLote.length === 0) break;
    todas.push(...linhasDoLote);
    inicio += linhasDoLote.length;
    if (linhasDoLote.length < PAGE_SIZE) break;
  }
  for (const { organization_id: org } of todas) {
    if (jaVistas.has(org)) continue;
    try {
      contar(await aplicarRegua(admin, org, deps));
    } catch (e) {
      falhou(org, e);
    }
  }

  resumo.avisosDeIa = await avisarTetoDeIa(admin);
  return resumo;
}

/**
 * O texto do aviso de 80%. A franquia em conversas é o que o cliente vê, então
 * ela vem primeiro; o teto em dólar só é citado quando o plano não tem franquia
 * ou quando é ele que está perto do fim. Sempre com as duas saídas.
 */
export function corpoDoAvisoDeIa(
  uso: { conversas: number; franquia: number | null; gasto: number; teto: number | null },
  t: (s: string) => string,
): string {
  const saidas = t(
    "Ao chegar ao limite, a IA para e as conversas passam para a equipe. Para continuar: fale com a ArvisX para contratar um pacote extra, ou cadastre uma chave de IA própria em IA › Credenciais.",
  );
  const pelaFranquia =
    uso.franquia !== null && (uso.teto === null || uso.conversas / uso.franquia >= uso.gasto / uso.teto);
  if (pelaFranquia && uso.franquia !== null) {
    return `${t("Neste ciclo a empresa já usou {usadas} de {total} conversas com IA incluídas no plano.")
      .replace("{usadas}", String(uso.conversas))
      .replace("{total}", String(uso.franquia))} ${saidas}`;
  }
  const pct = uso.teto !== null && uso.teto > 0 ? Math.floor((uso.gasto / uso.teto) * 100) : 0;
  return `${t("Neste ciclo a empresa já usou {pct}% do uso de IA incluído no plano.").replace("{pct}", String(pct))} ${saidas}`;
}

/** Quanto do plano já foi usado: o maior entre a franquia e o teto. `null` = o plano não tem limite nenhum. */
export function fracaoUsadaDoPlano(uso: {
  conversas: number;
  franquia: number | null;
  gasto: number;
  teto: number | null;
}): number | null {
  const partes: number[] = [];
  if (uso.franquia !== null && uso.franquia > 0) partes.push(uso.conversas / uso.franquia);
  if (uso.teto !== null && uso.teto > 0) partes.push(uso.gasto / uso.teto);
  return partes.length === 0 ? null : Math.max(...partes);
}

async function avisarTetoDeIa(admin: SupabaseClient): Promise<number> {
  // Plano com teto em dólar OU com franquia de conversas: os dois têm o que avisar.
  const { data: planos, error } = await admin
    .from("cobranca_planos")
    .select("id, teto_ia_usd_cents, franquia_conversas_ia")
    .or("teto_ia_usd_cents.not.is.null,franquia_conversas_ia.not.is.null");
  if (error) throw new Error(`cobranca: planos ilegíveis (${error.code ?? "sem_codigo"})`);
  const comLimite = new Set(((planos ?? []) as Array<{ id: string }>).map((p) => p.id));
  if (comLimite.size === 0) return 0;

  const comTeto: Array<{ organization_id: string; plano_id: string }> = [];
  let inicioTeto = 0;
  for (let pagina = 0; pagina < 100; pagina++) {
    const { data: lote, error: erroDoLote } = await admin
      .from("cobranca_assinaturas")
      .select("organization_id, plano_id")
      .in("plano_id", [...comLimite])
      .order("organization_id", { ascending: true })
      .range(inicioTeto, inicioTeto + PAGE_SIZE - 1);
    if (erroDoLote) throw new Error(`cobranca: assinaturas com teto ilegíveis (${erroDoLote.code ?? "sem_codigo"})`);
    const linhasDoLote = (lote ?? []) as Array<{ organization_id: string; plano_id: string }>;
    if (linhasDoLote.length === 0) break;
    comTeto.push(...linhasDoLote);
    inicioTeto += linhasDoLote.length;
    if (linhasDoLote.length < PAGE_SIZE) break;
  }
  if (comTeto.length === 0) return 0;

  // Em lotes: um .in() único com todas as empresas também seria cortado em
  // max_rows, e mil UUIDs na query string passam do limite de URL do proxy.
  const ids = comTeto.map((l) => l.organization_id);
  const orgs: Array<{ id: string; status: string; locale: string | null }> = [];
  for (let i = 0; i < ids.length; i += LOTE_DE_EMPRESAS) {
    const { data: lote, error: erroDasOrgs } = await admin
      .from("organizations")
      .select("id, status, locale")
      .in("id", ids.slice(i, i + LOTE_DE_EMPRESAS));
    if (erroDasOrgs) throw new Error(`cobranca: empresas ilegíveis (${erroDasOrgs.code ?? "sem_codigo"})`);
    orgs.push(...((lote ?? []) as typeof orgs));
  }
  const idiomaDe = new Map<string, Idioma>(
    orgs
      .filter((o) => ehOperante(o.status))
      .map((o) => [o.id, normalizarIdioma(o.locale)]),
  );

  let avisos = 0;
  for (const { organization_id: org } of comTeto) {
    const idioma = idiomaDe.get(org);
    if (idioma === undefined) continue;
    // A MESMA leitura do motor (`fn_ia_do_plano`): só a chave da plataforma, no ciclo.
    const { data: lido, error: erroDoUso } = await admin.rpc("fn_ia_do_plano", { p_org: org });
    if (erroDoUso) {
      logger.warn("cobranca.gasto_de_ia_ilegivel", { organization_id: org, codigo: erroDoUso.code ?? null });
      continue;
    }
    const linha = (Array.isArray(lido) ? lido[0] : lido) as Record<string, unknown> | null | undefined;
    if (!linha || linha.com_assinatura !== true) continue;
    const uso = {
      conversas: Number(linha.conversas ?? 0),
      franquia: linha.franquia === null || linha.franquia === undefined ? null : Number(linha.franquia),
      gasto: Number(linha.gasto ?? 0),
      teto: linha.teto === null || linha.teto === undefined ? null : Number(linha.teto),
    };
    const fracao = fracaoUsadaDoPlano(uso);
    if (fracao === null || fracao < LIMIAR_DO_AVISO_DE_IA || fracao >= 1) continue;
    const t = (s: string) => traduzir(s, idioma);
    const { data: ganhou, error: erroDoAviso } = await admin.rpc("fn_cobranca_avisar_uso_de_ia", {
      p_org: org,
      p_titulo: t("O uso de IA do plano chegou a 80%"),
      p_corpo: corpoDoAvisoDeIa(uso, t),
      // Um aviso por CICLO: a função deduplica pelo que foi aberto desde o início dele.
      p_desde: String(linha.ciclo_inicio),
    });
    if (erroDoAviso) {
      logger.warn("cobranca.aviso_de_ia_nao_registrado", { organization_id: org, codigo: erroDoAviso.code ?? null });
      continue;
    }
    if (ganhou === true) avisos += 1;
  }
  return avisos;
}
