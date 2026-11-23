/**
 * OS AVISOS DO FILTRO DE ENTRADA, no idioma de quem configura (revisão de
 * 20/11, item 2.29).
 *
 * O filtro de entrada da IA barra mensagem por lista de palavras, e lista não
 * entende contexto. Ele ainda não tem tela: quem o liga recebe aqui, na
 * resposta da leitura e da gravação de `/api/v1/settings/routing`, onde a
 * lista que gravou pode calar um cliente. Uma tela futura mostra estes mesmos
 * textos — por isso a frase mora aqui, e não na rota.
 *
 * QUAIS avisos valem para uma configuração é regra pura
 * (`avisosDoFiltro`, em `lib/agent-engine/guardrails/filtro-de-entrada.ts`);
 * este módulo só escreve a frase de cada código.
 */
import {
  avisosDoFiltro,
  type AvisoDoFiltro,
  type FiltroDeEntrada,
} from "@/lib/agent-engine/guardrails/filtro-de-entrada";
import { traduzir } from "@/lib/i18n/dicionario";

export interface AvisoDoFiltroParaATela {
  code: AvisoDoFiltro;
  message: string;
}

export function avisosDoFiltroParaQuemConfigura(
  filtro: FiltroDeEntrada,
  idioma: Parameters<typeof traduzir>[1],
): AvisoDoFiltroParaATela[] {
  const t = (texto: string) => traduzir(texto, idioma);
  const frase = (codigo: AvisoDoFiltro): string => {
    switch (codigo) {
      case "falso_positivo":
        return t(
          "O filtro de entrada barra a mensagem pelas palavras da lista, sem entender o contexto. Um termo que também é sobrenome, nome de lugar ou palavra do dia a dia pode deixar um cliente sem resposta. Prefira expressões de duas ou mais palavras e acompanhe as conversas marcadas.",
        );
      case "sem_limite_de_palavras":
        return t(
          "Há regra sem limite de palavras além do termo: qualquer mensagem que contenha um termo da lista fica sem resposta, mesmo trazendo um pedido ou uma reclamação legítima.",
        );
      case "termo_curto":
        return t(
          "Há termo de uma palavra só e curta na lista. É o caso que mais barra por engano: confira se ele não é também um nome ou uma palavra comum.",
        );
      case "resposta_e_modo_assistido":
        return t(
          "Em número com agente em modo assistido, a resposta automática do filtro não é enviada: a mensagem segue para o agente, e a resposta só sai depois de uma pessoa aprovar.",
        );
    }
  };
  return avisosDoFiltro(filtro).map((code) => ({ code, message: frase(code) }));
}
