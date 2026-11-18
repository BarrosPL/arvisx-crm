/**
 * As duas constantes que o MOTOR precisa da equipe pronta — num arquivo sem
 * dependência nenhuma, para a trava de plano (`lib/cobranca/`) não carregar o
 * catálogo de papéis inteiro dentro do worker só por causa de dois literais.
 */

/** O destino na navegação e nas travas de plano. Um literal só, importado. */
export const DESTINO_DA_EQUIPE_PRONTA = "/app/ai/equipe-pronta";

/** A chave em `ai_agents.config` que marca um agente como instalado pela equipe pronta. */
export const CHAVE_DE_CONFIG = "equipe_pronta";
