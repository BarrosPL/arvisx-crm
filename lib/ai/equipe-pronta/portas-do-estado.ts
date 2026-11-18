/**
 * AS PORTAS DE PRODUÇÃO DO ESTADO — o que o checklist pergunta ao mundo de fora.
 *
 * Três perguntas que não são do banco da equipe pronta: a instalação tem chave
 * de IA no ambiente, a organização tem chave para preparar a base, e a agenda
 * principal tem horário livre. As três reaproveitam a função que o produto já
 * usa para a mesma pergunta em outra tela.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { horariosLivresDaOrg } from "@/lib/agenda/consulta";
import { temChaveDeEmbedding } from "@/lib/ai/embeddings/chave";
import { lerAmbiente } from "@/lib/instalacao/ambiente";
import type { PortasDoEstado } from "./estado";

const DIA_MS = 86_400_000;

export function portasDoEstadoDeProducao(admin: SupabaseClient): PortasDoEstado {
  return {
    async temChaveDeIaDaInstalacao() {
      return Object.values(lerAmbiente().chavesDeProvedor).some((tem) => tem === true);
    },

    temChaveDeEmbedding,

    async agendaTemHorario(orgId, eventTypeId, dias) {
      // A MESMA coleta que a tela da Agenda e as ferramentas do agente usam: o
      // checklist não pode dizer "tem horário" onde o agente vai ouvir "não tem".
      const agora = new Date();
      const consulta = await horariosLivresDaOrg(admin, orgId, {
        eventTypeId,
        de: agora,
        ate: new Date(agora.getTime() + dias * DIA_MS),
        agora,
      });
      return consulta.ok && consulta.slots.length > 0;
    },
  };
}
