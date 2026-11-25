/**
 * O USO DO ASSISTENTE POR ORGANIZAÇÃO, PARA A ADMINISTRAÇÃO DA PLATAFORMA.
 *
 * Não há limite de mensagens por plano. O que a plataforma tem é VISIBILIDADE:
 * quantas mensagens cada organização mandou no mês, e um destaque quando uma
 * delas destoa. O destaque não bloqueia nada; é um aviso para alguém olhar.
 *
 * O critério, com os dois números na configuração da instalação:
 *
 *  1. ABSOLUTO: a organização passou de `VIX_ALERTA_DE_USO_MENSAGENS` mensagens
 *     no mês (padrão 1000).
 *  2. RELATIVO: a organização usou `VIX_ALERTA_DE_USO_MULTIPLO` vezes a mediana
 *     das organizações com uso no mês (padrão 5 vezes). Só vale com pelo menos
 *     três organizações com uso (com menos, mediana não diz nada) e a partir de
 *     `PISO_DO_ALERTA_RELATIVO` mensagens (cinco vezes quase nada ainda é quase
 *     nada).
 *
 * Só contagem e tokens entram aqui: `assistente_usos` não guarda texto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { valorDaInstalacao } from "@/lib/instalacao/config";

export const ALERTA_DE_USO_MENSAGENS_PADRAO = 1000;
export const ALERTA_DE_USO_MULTIPLO_PADRAO = 5;
export const PISO_DO_ALERTA_RELATIVO = 50;
const MINIMO_DE_ORGANIZACOES_PARA_A_MEDIANA = 3;

export interface CriterioDeAlerta {
  mensagens: number;
  multiplo: number;
}

export interface UsoDaOrganizacao {
  organization_id: string;
  mensagens: number;
  tokens_de_entrada: number;
  tokens_de_saida: number;
  falhas: number;
  usuarios: number;
}

export type MotivoDoDestaque = "acima_do_numero" | "acima_da_mediana";

export interface UsoComDestaque extends UsoDaOrganizacao {
  destoa: boolean;
  motivo: MotivoDoDestaque | null;
}

function inteiroEntre(bruto: string | null | undefined, minimo: number, maximo: number, padrao: number): number {
  const texto = (bruto ?? "").trim();
  if (!/^\d{1,7}$/.test(texto)) return padrao;
  const n = Number(texto);
  return n >= minimo && n <= maximo ? n : padrao;
}

/** O critério em vigor. Chave vazia, inválida ou fora da faixa cai no padrão. */
export async function criterioDeAlerta(): Promise<CriterioDeAlerta> {
  const [mensagens, multiplo] = await Promise.all([
    valorDaInstalacao("VIX_ALERTA_DE_USO_MENSAGENS"),
    valorDaInstalacao("VIX_ALERTA_DE_USO_MULTIPLO"),
  ]);
  return {
    mensagens: inteiroEntre(mensagens.valor, 1, 1_000_000, ALERTA_DE_USO_MENSAGENS_PADRAO),
    multiplo: inteiroEntre(multiplo.valor, 2, 1000, ALERTA_DE_USO_MULTIPLO_PADRAO),
  };
}

export function mediana(valores: readonly number[]): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1 ? ordenados[meio]! : (ordenados[meio - 1]! + ordenados[meio]!) / 2;
}

/** Marca quem destoa e ordena do maior uso para o menor. Pura. */
export function marcarQuemDestoa(usos: readonly UsoDaOrganizacao[], criterio: CriterioDeAlerta): UsoComDestaque[] {
  const comUso = usos.filter((u) => u.mensagens > 0);
  const med = comUso.length >= MINIMO_DE_ORGANIZACOES_PARA_A_MEDIANA ? mediana(comUso.map((u) => u.mensagens)) : null;
  return [...usos]
    .map((u): UsoComDestaque => {
      let motivo: MotivoDoDestaque | null = null;
      if (u.mensagens >= criterio.mensagens) motivo = "acima_do_numero";
      else if (med !== null && med > 0 && u.mensagens >= PISO_DO_ALERTA_RELATIVO && u.mensagens >= med * criterio.multiplo) {
        motivo = "acima_da_mediana";
      }
      return { ...u, destoa: motivo !== null, motivo };
    })
    .sort((a, b) => b.mensagens - a.mensagens);
}

/** O uso do mês corrente, por organização, lido pelo servidor. `null` = leitura falhou. */
export async function usoDoMes(admin: SupabaseClient): Promise<UsoDaOrganizacao[] | null> {
  const { data, error } = await admin.rpc("fn_assistente_uso_do_mes");
  if (error) return null;
  return ((data ?? []) as Record<string, unknown>[]).map((l) => ({
    organization_id: String(l.organization_id),
    mensagens: Number(l.mensagens ?? 0),
    tokens_de_entrada: Number(l.tokens_de_entrada ?? 0),
    tokens_de_saida: Number(l.tokens_de_saida ?? 0),
    falhas: Number(l.falhas ?? 0),
    usuarios: Number(l.usuarios ?? 0),
  }));
}
