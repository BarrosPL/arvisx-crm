/**
 * A EDIÇÃO DO RASCUNHO, NUMA TRANSAÇÃO SÓ (migration 9815).
 *
 * `PATCH /proposals/[id]` e `assistant/apply` gravavam a edição em três
 * chamadas ao banco: UPDATE de `crm_proposals` (com o CAS da revisão), DELETE
 * dos itens e INSERT dos itens. Desde a 9815 quem garante que editar invalida
 * a aprovação é o banco: mexer em item soma um na revisão. Em três transações
 * separadas uma edição somaria três, e a revisão devolvida à tela ficaria
 * velha antes de chegar.
 *
 * `fn_proposta_gravar_edicao` faz as três coisas numa transação: a revisão
 * sobe UMA vez, a troca dos itens não soma de novo, e a edição é atômica (a
 * falha ao gravar os itens não deixa mais o rascunho sem item nenhum).
 *
 * A função é `security invoker`: com o cliente da sessão, a RLS e o gatilho de
 * transição valem para quem está editando, como antes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** O item já resolvido pelo servidor (`resolverItensDaProposta`). */
export interface ItemDaEdicao {
  product_id: string | null;
  descricao: string;
  quantidade: number;
  preco_unitario_cents: number | null;
  desconto_cents: number;
  position: number;
}

/**
 * Os campos que a edição grava. Chave AUSENTE fica como está no banco; chave
 * com `null` grava nulo. `total_cents` e `pricing_status` vêm sempre: são
 * recalculados dos itens.
 */
export interface CamposDaEdicao {
  titulo?: string;
  condicoes?: string | null;
  valid_until?: string | null;
  prazo_dias_uteis?: number | null;
  pagamento?: string | null;
  briefing_json?: unknown;
  total_cents: number;
  pricing_status: string;
}

export type ResultadoDaEdicao =
  | { tipo: "ok"; revision: number }
  /** O CAS não casou: revisão velha, não é mais rascunho, ou não é desta organização. */
  | { tipo: "desatualizada" }
  | { tipo: "falha" };

export async function gravarEdicaoDaProposta(
  supabase: SupabaseClient,
  entrada: {
    orgId: string;
    propostaId: string;
    /** A revisão que quem edita leu. */
    revisao: number;
    campos: CamposDaEdicao;
    itens: readonly ItemDaEdicao[];
  },
): Promise<ResultadoDaEdicao> {
  // Sem as chaves indefinidas: no banco, "ausente" é "não mexe".
  const campos = Object.fromEntries(Object.entries(entrada.campos).filter(([, valor]) => valor !== undefined));
  const { data, error } = await supabase.rpc("fn_proposta_gravar_edicao", {
    p_org: entrada.orgId,
    p_proposta: entrada.propostaId,
    p_revisao: entrada.revisao,
    p_campos: campos,
    p_itens: entrada.itens.map((it) => ({
      product_id: it.product_id,
      descricao: it.descricao,
      quantidade: it.quantidade,
      preco_unitario_cents: it.preco_unitario_cents,
      desconto_cents: it.desconto_cents,
      position: it.position,
    })),
  });
  if (error) return { tipo: "falha" };
  if (data === null || data === undefined) return { tipo: "desatualizada" };
  return { tipo: "ok", revision: Number(data) };
}
