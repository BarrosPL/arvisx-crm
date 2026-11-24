/**
 * A VARREDURA de contatos duplicados de uma organização — a mesma para a tela
 * (`GET /api/v1/contacts/duplicates`) e para o agente
 * (`crm_find_duplicate_contacts`).
 *
 * A DETECÇÃO é pura e mora em `./duplicados.ts`. Aqui fica o que a cerca: ler
 * os contatos vivos em páginas, ler os pares que alguém dispensou e devolver os
 * grupos. Morava dentro da rota; saiu para o agente não ganhar uma segunda
 * versão da regra.
 *
 * ─── Dois clientes, de propósito ────────────────────────────────────────────
 * `contatos` lê `contacts`. Na tela é o cliente da SESSÃO (a RLS decide o que o
 * usuário vê); no agente é o cliente de serviço, e por isso o filtro de
 * `organization_id` é explícito aqui, sempre.
 * `dispensas` lê `merge_queue`, cuja policy só deixa gestor ler: é sempre o
 * cliente de serviço, filtrado pela organização de quem chama.
 *
 * A organização vem de quem chama (a sessão ou o token), nunca de um argumento
 * de quem pede.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerParesDispensados } from "./dispensar-par";
import {
  encontrarContatosDuplicados,
  encontrarParecidosPorNome,
  principalSugerido,
  type ContatoParaDeduplicar,
  type GrupoDeDuplicados,
} from "./duplicados";

/**
 * Teto de linhas varridas.
 *
 * A varredura é O(n) e roda sobre contatos VIVOS — mas ela é uma tela de
 * limpeza, não um relatório: numa base grande, devolver "os 5.000 grupos" não
 * ajuda ninguém a decidir nada e custa memória do contêiner do self-hoster.
 * Quem passa daqui limpa em levas, e a resposta diz que truncou (`varreuTudo`)
 * em vez de calar — silêncio aqui leria como "não há mais duplicata".
 */
export const TETO_DE_VARREDURA = 2000;

/**
 * Tamanho de cada página da varredura.
 *
 * Igual ao `max_rows = 1000` do `supabase/config.toml` — o mesmo teto que o
 * `win-rates` e o relatório de Perdas (#2560) já respeitam. Um `.limit(2001)`
 * NÃO lê 2.001: o PostgREST corta a resposta em `max_rows` sem erro nenhum, e
 * o `varreuTudo` respondia `true` com a base inteira cortada em 1.000 linhas.
 * Numa instalação com `max_rows` MENOR que esta página, a página curta também
 * não é tratada como fim: o fim é provado pelo `count` exato ou por página
 * VAZIA (`lib/agenda/protecao-followup.ts`).
 */
const TAMANHO_DA_PAGINA = 1000;

const COLUNAS_DO_CONTATO =
  "id, name, display_name, address_book_name, email, email_normalized, phone_number, is_merged_into, is_anonymized, source_metadata, created_at, last_activity_at";

export interface GrupoVarrido {
  grupo: GrupoDeDuplicados;
  principalSugerido: string;
}

export type VarreduraDeDuplicados =
  | { ok: true; grupos: GrupoVarrido[]; varreuTudo: boolean; contatosVarridos: number }
  /** `contatos` leva a mensagem do banco; `dispensas` não (ela não é para quem opera). */
  | { ok: false; etapa: "contatos"; mensagem: string }
  | { ok: false; etapa: "dispensas" };

export interface OpcoesDaVarredura {
  /**
   * Só o que é da operação: tira o contato marcado como pessoal e o contato que
   * representa um grupo de WhatsApp. É o recorte do agente (leitura por MCP não
   * devolve contato pessoal); a tela não o usa.
   */
  soDaOperacao?: boolean;
}

export async function varrerContatosDuplicados(
  clientes: { contatos: SupabaseClient; dispensas: SupabaseClient },
  organizationId: string,
  opcoes: OpcoesDaVarredura = {},
): Promise<VarreduraDeDuplicados> {
  // Varredura PAGINADA por `range`, com ordem estável (`created_at`, `id`): o
  // fim é provado pelo `count` exato ou por página VAZIA. Página curta não é
  // fim — numa instalação com `max_rows` menor que a página, ela vem curta sem
  // ser o fim. O `+1` além do teto é o que prova que existia mais do que a
  // varredura alcança.
  const linhas: ContatoParaDeduplicar[] = [];
  let totalDeVivos: number | null = null;
  let acabou = false;
  for (let pagina = 0; linhas.length <= TETO_DE_VARREDURA && !acabou; pagina++) {
    const inicio = linhas.length;
    const pedaco = Math.min(TAMANHO_DA_PAGINA, TETO_DE_VARREDURA + 1 - linhas.length);
    let consulta = clientes.contatos
      .from("contacts")
      .select(COLUNAS_DO_CONTATO, pagina === 0 ? { count: "exact" } : undefined)
      .eq("organization_id", organizationId)
      .is("is_merged_into", null)
      .eq("is_anonymized", false);
    if (opcoes.soDaOperacao) {
      consulta = consulta.eq("is_personal", false).eq("kind", "person");
    }
    const { data, error, count } = await consulta
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(inicio, inicio + pedaco - 1);
    if (error) return { ok: false, etapa: "contatos", mensagem: error.message };
    if (pagina === 0) totalDeVivos = count;
    const lote = (data ?? []) as unknown as ContatoParaDeduplicar[];
    linhas.push(...lote);
    acabou = lote.length === 0 || (totalDeVivos !== null && linhas.length >= totalDeVivos);
  }

  const varreuTudo =
    totalDeVivos !== null ? totalDeVivos <= TETO_DE_VARREDURA : linhas.length <= TETO_DE_VARREDURA;
  const varridos = linhas.slice(0, TETO_DE_VARREDURA);

  // As dispensas são lidas com o cliente de serviço, filtrado pela organização
  // de quem chama (nunca do pedido): a policy de `merge_queue` só deixa gestor
  // ler, e o par dispensado tem de sumir para todo papel que vê esta lista. Se a
  // leitura falhar, a varredura falha — mostrar a lista sem as dispensas faria
  // um par tirado voltar calado.
  let dispensados: Set<string>;
  try {
    dispensados = await lerParesDispensados(clientes.dispensas, organizationId);
  } catch {
    return { ok: false, etapa: "dispensas" };
  }

  // Os fortes vêm primeiro, com o mesmo formato. O nome vem depois, em grupos de
  // dois: sugestão para conferir, não prova.
  const grupos = [
    ...encontrarContatosDuplicados(varridos),
    ...encontrarParecidosPorNome(varridos, { dispensados }),
  ];

  return {
    ok: true,
    grupos: grupos.map((grupo) => ({ grupo, principalSugerido: principalSugerido(grupo) })),
    varreuTudo,
    contatosVarridos: Math.min(linhas.length, TETO_DE_VARREDURA),
  };
}
