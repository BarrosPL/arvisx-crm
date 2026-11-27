/**
 * DE QUEM É A CHAVE QUE PAGOU A CHAMADA — o lado TypeScript do CHECK de
 * `llm_calls.origem_da_chave` (migration 9825). Par vigiado por
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts`.
 *
 *   • `cliente`     — credencial da organização. Ela paga o próprio provedor.
 *   • `plataforma`  — a chave da instalação. É o que o plano inclui e o que o
 *                     teto e a franquia do plano somam.
 *   • `assinatura_plataforma` — o assistente da plataforma rodando na
 *                     ASSINATURA dela, e não em chave de API. Grava os tokens
 *                     reais e `cost_cents = 0`.
 *   • `assistente_chave_plataforma` — o assistente da plataforma rodando pela
 *                     CHAVE da plataforma, como saída quando a assinatura não
 *                     pode ser usada. É a mesma chave de `plataforma`, e mesmo
 *                     assim NÃO conta no teto do plano: decide o valor da
 *                     coluna, não a chave.
 *
 * Os dois últimos são do assistente e não são gasto da empresa: nenhuma soma de
 * limite os conta (orçamento da empresa, gasto do mês, teto e franquia do plano,
 * aviso de 80%). Nada neste repositório grava esses valores ainda. O login por
 * assinatura que a PRÓPRIA empresa conecta é `cliente`.
 *
 * O PADRÃO DA COLUNA É `plataforma`: a linha de origem desconhecida conta no
 * teto do plano. O porquê está no cabeçalho da migration 9825.
 *
 * Arquivo sem dependência nenhuma, de propósito: quem grava em `llm_calls` são
 * o motor (`pg`), os workers e rotas do app, e nenhum deles pode arrastar o
 * outro para dentro só por causa de quatro literais.
 */
export const ORIGENS_DA_CHAVE = ["cliente", "plataforma", "assinatura_plataforma", "assistente_chave_plataforma"] as const;
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
