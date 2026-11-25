/**
 * DE QUEM É A CHAVE QUE PAGOU A CHAMADA — o lado TypeScript do CHECK de
 * `llm_calls.origem_da_chave` (migration 9825). Par vigiado por
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts`.
 *
 *   • `cliente`     — credencial da organização. Ela paga o próprio provedor.
 *   • `plataforma`  — a chave da instalação. É o que o plano inclui e o que o
 *                     teto e a franquia do plano somam.
 *   • `assinatura_plataforma` — chamada feita com a ASSINATURA da plataforma, e
 *                     não com chave de API. Hoje só o assistente da plataforma
 *                     a usa. Não é gasto da empresa: nenhuma soma de limite a
 *                     conta (orçamento da empresa, gasto do mês, teto e
 *                     franquia do plano, aviso de 80%). Nada neste repositório
 *                     grava esse valor ainda. O login por assinatura que a
 *                     PRÓPRIA empresa conecta é `cliente`.
 *
 * O PADRÃO DA COLUNA É `plataforma`: a linha de origem desconhecida conta no
 * teto do plano. O porquê está no cabeçalho da migration 9825.
 *
 * Arquivo sem dependência nenhuma, de propósito: quem grava em `llm_calls` são
 * o motor (`pg`), os workers e rotas do app, e nenhum deles pode arrastar o
 * outro para dentro só por causa de três literais.
 */
export const ORIGENS_DA_CHAVE = ["cliente", "plataforma", "assinatura_plataforma"] as const;
export type OrigemDaChave = (typeof ORIGENS_DA_CHAVE)[number];

/**
 * A resposta do resolvedor de credencial (`OrigemDaChaveLlm`, em
 * `lib/agent-engine/edge/llm/credentials.ts`) como valor da coluna. O parâmetro
 * é a união literal, e não o tipo importado, para este arquivo seguir sem
 * dependência; o compilador confere que os dois lados batem em quem chama.
 */
export function origemDaChaveGravada(
  origem: "credencial_da_organizacao" | "chave_da_instalacao",
): Extract<OrigemDaChave, "cliente" | "plataforma"> {
  return origem === "chave_da_instalacao" ? "plataforma" : "cliente";
}
