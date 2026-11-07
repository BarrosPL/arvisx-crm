/**
 * Quando um pedido de LGPD está EM ABERTO — uma régua só para a lista de
 * `/app/lgpd/requests` e para o hub de `/account-suspended`.
 *
 * O critério é o que a lista já usava para o aviso de prazo (`SlaBanner`):
 * todo status que não é terminal. Terminais são `completed` e `failed`; os
 * outros (`received`, `processing`, `pending_review`) ainda correm prazo.
 * Morava como `TERMINAL_STATUSES` dentro do banner; saiu para cá para o hub
 * perguntar a mesma coisa sem escrever uma segunda lista que diverge.
 *
 * Sem dependência de servidor: o banner é componente de cliente e importa
 * daqui. A consulta recebe o client pronto, e o `organization_id` vem de quem
 * chama, resolvido da sessão — nunca da URL nem do corpo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const STATUS_TERMINAIS_DA_LGPD: readonly string[] = ["completed", "failed"];

export function pedidoDaLgpdEmAberto(status: string): boolean {
  return !STATUS_TERMINAIS_DA_LGPD.includes(status);
}

/**
 * A empresa tem algum pedido de LGPD em aberto?
 *
 * Mesma tabela e mesmo filtro de organização da rota da lista
 * (`app/api/v1/lgpd/requests/route.ts`), com o critério de `pedidoDaLgpdEmAberto`.
 *
 * Leitura que falha responde `true`: prazo legal escondido por erro de rede é
 * pior do que uma seção a mais na tela (a lista, aberta, diz o que houver).
 */
export async function temPedidoDaLgpdEmAberto(
  client: SupabaseClient,
  organizationId: string,
): Promise<boolean> {
  const { count, error } = await client
    .from("lgpd_requests")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .not("status", "in", `(${STATUS_TERMINAIS_DA_LGPD.join(",")})`);
  if (error) return true;
  return (count ?? 0) > 0;
}
