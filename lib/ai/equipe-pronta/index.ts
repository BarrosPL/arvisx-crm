/**
 * EQUIPE PRONTA — a face do módulo.
 *
 * Quem consome (o instalador, as rotas, a tela, os testes) importa daqui e
 * nunca do arquivo de um papel: acrescentar ou trocar um papel é mexer em
 * `PAPEIS`, sem tocar em nenhum consumidor. Mesmo desenho de
 * `lib/followup/modelos/`.
 */
import { PAPEL_AGENDAMENTO } from "./papeis/agendamento";
import { PAPEL_PROPOSTA } from "./papeis/proposta";
import { PAPEL_RECUPERADOR } from "./papeis/recuperador";
import { PAPEL_SDR } from "./papeis/sdr";
import type { PapelDaEquipe, PapelId } from "./tipos";

export type {
  CamposDoAgente,
  ContextoDaInstalacao,
  EtapaDoFunil,
  IntencaoDoPapel,
  PapelDaEquipe,
  PapelId,
  PassoDaEquipe,
} from "./tipos";
export { PAPEIS_DA_EQUIPE, PASSOS_DA_EQUIPE } from "./tipos";
export { REGRAS_COMUNS, VERSAO_DAS_REGRAS_COMUNS } from "./papeis/comum";

/** A ordem é a do roteador e a da tela: quem chega, agenda, proposta, retomada. */
export const PAPEIS: readonly PapelDaEquipe[] = [
  PAPEL_SDR,
  PAPEL_AGENDAMENTO,
  PAPEL_PROPOSTA,
  PAPEL_RECUPERADOR,
];

/** O papel que recebe o que o roteador não soube classificar. */
export const PAPEL_DE_ENTRADA: PapelId = "sdr";

/** `undefined` — e não um erro — para quem chama decidir a própria recusa. */
export function papelPorId(id: string): PapelDaEquipe | undefined {
  return PAPEIS.find((p) => p.id === id);
}

/** O destino na navegação e nas travas de plano. Um literal só, importado. */
export const DESTINO_DA_EQUIPE_PRONTA = "/app/ai/equipe-pronta";

/** A chave em `ai_agents.config` que marca um agente como instalado pela equipe pronta. */
export const CHAVE_DE_CONFIG = "equipe_pronta";
