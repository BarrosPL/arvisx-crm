/**
 * O MODELO COM QUE A EQUIPE PRONTA NASCE (Tarefa 8, parte 5).
 *
 * A IA vem incluída no plano, paga pela chave da PLATAFORMA (a variável de
 * ambiente `ANTHROPIC_API_KEY` do app e do worker). Quando essa chave existe, o
 * agente novo da equipe pronta nasce no modelo padrão da plataforma, com
 * `credential_id: null` — "sem credencial escolhida", que na hora da chamada
 * resolve para a credencial da empresa naquele provedor e, sem ela, para a
 * chave da instalação (`lib/agent-engine/edge/llm/credentials.ts`).
 *
 * Antes, com a chave da plataforma, a escolha caía no modelo curado do catálogo
 * (hoje bem mais caro por conversa), e é a franquia do plano que paga.
 *
 * ═══ Quando NÃO é o modelo padrão — fica o comportamento de antes ═══
 *
 *   • a chave da plataforma não existe no ambiente: a escolha de sempre
 *     (`resolveSetupModel`), que sem chave nenhuma termina no erro de sempre,
 *     "configure uma chave de IA";
 *   • a empresa tem credencial própria, ativa e validada: ela trouxe a chave
 *     dela, e a escolha de sempre a respeita (inclusive o provedor);
 *   • o modelo padrão não está no catálogo desta instalação, ou está sem
 *     ferramentas (clone com o catálogo atrasado): a escolha de sempre.
 *
 * Só vale para o agente NOVO. O agente que já existe mantém o modelo que tem:
 * o instalador nunca troca modelo nem credencial de quem já foi instalado
 * (`renderizar.ts`, `camposCanonicos`).
 *
 * ⚠️ A CHAVE NUNCA PASSA POR AQUI. Este módulo recebe só a resposta "existe?",
 * como booleano. O valor não entra em parâmetro, retorno, log nem erro.
 */
import type pg from "pg";

import type { ModeloEscolhido } from "./instalar";

/** O modelo padrão da plataforma. Preço em `lib/agent-engine/edge/llm/pricing.ts`. */
export const MODELO_PADRAO_DA_PLATAFORMA = { provider: "anthropic", model: "claude-haiku-5-5" } as const;

export interface PortasDoModeloPadrao {
  /** A chave de plataforma deste provedor existe no ambiente? Só a resposta, nunca o valor. */
  temChaveDaPlataforma: (provider: string) => boolean;
  /** O provedor é oferecido nesta instalação? (`provedorOferecido`) */
  oferece: (provider: string) => boolean;
  /** A escolha de antes, intacta. */
  escolhaDeSempre: () => Promise<ModeloEscolhido>;
}

export async function escolherModeloDaEquipe(
  db: Pick<pg.PoolClient, "query">,
  orgId: string,
  portas: PortasDoModeloPadrao,
): Promise<ModeloEscolhido> {
  const { provider, model } = MODELO_PADRAO_DA_PLATAFORMA;
  if (!portas.temChaveDaPlataforma(provider) || !portas.oferece(provider)) return portas.escolhaDeSempre();

  const propria = await db.query(
    "select 1 from ai_provider_credentials where organization_id=$1 and is_active and validated_at is not null limit 1",
    [orgId],
  );
  if (propria.rows.length > 0) return portas.escolhaDeSempre();

  const noCatalogo = await db.query(
    "select 1 from ai_models where provider=$1 and model_id=$2 and deprecated_at is null and supports_tools limit 1",
    [provider, model],
  );
  if (noCatalogo.rows.length === 0) return portas.escolhaDeSempre();

  return { provider, model, credential_id: null };
}
