/**
 * O AGENTE PODE ENVIAR ESTA PROPOSTA? — a regra de `envio_de_proposta`.
 *
 * Na tela, quem envia proposta é uma pessoa com papel `manager`. Um agente não
 * tem papel humano: a autorização dele vem do MODO que a empresa escolheu
 * (`equipe_pronta_perfis.respostas.proposta.envio_de_proposta`):
 *
 *   • `apos_aprovacao` (padrão) — só envia o rascunho que a equipe APROVOU;
 *   • `direto` — envia sozinho quando TODOS os itens são do catálogo, com o
 *     preço do catálogo, sem desconto e sem condição escrita à mão. Fora disso,
 *     volta a precisar da aprovação.
 *
 * ⚠️ FALHA FECHADA. Sem perfil, com perfil ilegível ou com a leitura falhando,
 * o modo é `apos_aprovacao`: na dúvida, o agente não envia sozinho. Vale igual
 * para o agente externo por token, que não tem perfil de Equipe pronta.
 *
 * ═══ A aprovação ═══
 *
 * Não existe status "aprovada": a proposta aprovada continua `rascunho` até
 * sair. A aprovação são duas colunas (migration 9814), `aprovada_em` e
 * `aprovada_na_revisao`, e só VALE enquanto a revisão aprovada for a atual
 * (`revision`). Editar o rascunho soma um na revisão e invalida a aprovação:
 * ninguém aprova um valor para o agente enviar outro. Quem grava as colunas é
 * o servidor (a sessão não consegue, pelo gatilho de transição).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MODOS_DE_ENVIO_DE_PROPOSTA,
  type ModoDeEnvioDeProposta,
} from "@/lib/schemas/equipe-pronta";
import { buscarPadroesDaOrganizacao } from "./padroes-da-organizacao";

export const MODO_DE_ENVIO_PADRAO: ModoDeEnvioDeProposta = "apos_aprovacao";

/** O modo de envio da empresa. Nunca lança: na dúvida, o padrão. */
export async function modoDeEnvioDaEmpresa(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<ModoDeEnvioDeProposta> {
  try {
    const { data, error } = await supabase
      .from("equipe_pronta_perfis")
      .select("respostas")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error || !data) return MODO_DE_ENVIO_PADRAO;
    const respostas = (data as { respostas?: unknown }).respostas;
    const proposta =
      respostas !== null && typeof respostas === "object"
        ? (respostas as Record<string, unknown>).proposta
        : null;
    const modo =
      proposta !== null && typeof proposta === "object"
        ? (proposta as Record<string, unknown>).envio_de_proposta
        : null;
    return (MODOS_DE_ENVIO_DE_PROPOSTA as readonly unknown[]).includes(modo)
      ? (modo as ModoDeEnvioDeProposta)
      : MODO_DE_ENVIO_PADRAO;
  } catch {
    return MODO_DE_ENVIO_PADRAO;
  }
}

export interface PropostaParaDecidir {
  revision: number;
  moeda: string;
  condicoes: string | null;
  aprovada_em: string | null;
  aprovada_na_revisao: number | null;
}

export interface ItemParaDecidir {
  descricao: string;
  product_id: string | null;
  preco_unitario_cents: number | null;
  desconto_cents: number;
}

/** A equipe aprovou ESTA revisão do rascunho? */
export function propostaEstaAprovada(p: PropostaParaDecidir): boolean {
  return (
    p.aprovada_em !== null &&
    p.aprovada_na_revisao !== null &&
    Number(p.aprovada_na_revisao) === Number(p.revision)
  );
}

export type PorQuePrecisaDeAprovacao =
  /** O modo da empresa é `apos_aprovacao` e ninguém aprovou esta revisão. */
  | "aguardando_aprovacao"
  /** A equipe aprovou, mas o rascunho foi editado depois. */
  | "editada_depois_de_aprovada"
  | "item_fora_do_catalogo"
  | "preco_diferente_do_catalogo"
  | "tem_desconto"
  | "condicao_fora_do_padrao";

export type DecisaoDoEnvioPeloAgente =
  | { pode: true; por: "aprovacao" | "direto" }
  | { pode: false; porque: PorQuePrecisaDeAprovacao; item?: string };

/**
 * A DECISÃO — pura, para ser medida sem banco.
 *
 * `precoDoCatalogo` devolve o preço ATUAL do produto na moeda dele, ou `null`
 * quando o produto não existe mais ou está desativado.
 */
export function decidirEnvioPeloAgente(c: {
  modo: ModoDeEnvioDeProposta;
  proposta: PropostaParaDecidir;
  itens: readonly ItemParaDecidir[];
  precoDoCatalogo: (productId: string) => { preco_cents: number; moeda: string } | null;
  /** As condições padrão da empresa: texto igual a elas não é condição especial. */
  condicoesPadrao: string | null;
}): DecisaoDoEnvioPeloAgente {
  if (propostaEstaAprovada(c.proposta)) return { pode: true, por: "aprovacao" };
  const editada = c.proposta.aprovada_em !== null;

  if (c.modo !== "direto") {
    return { pode: false, porque: editada ? "editada_depois_de_aprovada" : "aguardando_aprovacao" };
  }

  for (const item of c.itens) {
    if (item.product_id === null) return { pode: false, porque: "item_fora_do_catalogo", item: item.descricao };
    const doCatalogo = c.precoDoCatalogo(item.product_id);
    if (
      doCatalogo === null ||
      item.preco_unitario_cents === null ||
      Number(item.preco_unitario_cents) !== Number(doCatalogo.preco_cents) ||
      doCatalogo.moeda !== c.proposta.moeda
    ) {
      return {
        pode: false,
        porque: doCatalogo === null ? "item_fora_do_catalogo" : "preco_diferente_do_catalogo",
        item: item.descricao,
      };
    }
    if (Number(item.desconto_cents) > 0) return { pode: false, porque: "tem_desconto", item: item.descricao };
  }

  const condicoes = (c.proposta.condicoes ?? "").trim();
  if (condicoes !== "" && condicoes !== (c.condicoesPadrao ?? "").trim()) {
    return { pode: false, porque: "condicao_fora_do_padrao" };
  }
  return { pode: true, por: "direto" };
}

/** A mesma decisão, lendo o modo, o catálogo e os padrões da empresa. */
export async function agentePodeEnviarAProposta(
  supabase: SupabaseClient,
  organizationId: string,
  proposta: PropostaParaDecidir,
  itens: readonly ItemParaDecidir[],
): Promise<DecisaoDoEnvioPeloAgente & { modo: ModoDeEnvioDeProposta }> {
  const modo = await modoDeEnvioDaEmpresa(supabase, organizationId);
  if (propostaEstaAprovada(proposta) || modo !== "direto") {
    return {
      ...decidirEnvioPeloAgente({ modo, proposta, itens, precoDoCatalogo: () => null, condicoesPadrao: null }),
      modo,
    };
  }

  const ids = [...new Set(itens.map((i) => i.product_id).filter((id): id is string => id !== null))];
  const precos = new Map<string, { preco_cents: number; moeda: string }>();
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("catalog_products")
      .select("id, preco_cents, moeda")
      .eq("organization_id", organizationId)
      .eq("ativo", true)
      .in("id", ids);
    // Sem conseguir ler o catálogo, nenhum preço é confirmado: pede aprovação.
    if (!error) {
      for (const p of (data ?? []) as Array<{ id: string; preco_cents: number; moeda: string }>) {
        precos.set(p.id, { preco_cents: Number(p.preco_cents), moeda: p.moeda });
      }
    }
  }
  const padroes = await buscarPadroesDaOrganizacao(supabase, organizationId).catch(() => null);
  return {
    ...decidirEnvioPeloAgente({
      modo,
      proposta,
      itens,
      precoDoCatalogo: (id) => precos.get(id) ?? null,
      condicoesPadrao: padroes?.defaultConditions ?? null,
    }),
    modo,
  };
}
