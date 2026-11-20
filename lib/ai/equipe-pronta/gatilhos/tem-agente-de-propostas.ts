/**
 * Esta empresa tem um agente de Propostas da Equipe pronta para enviar?
 *
 * É o que decide se a tela da proposta mostra "Aprovar e deixar o agente
 * enviar". Falha de leitura = não mostra: um botão a menos é melhor que um
 * botão que promete um agente que não existe. A rota confere tudo de novo.
 */
import { createAdminClient } from "@/lib/supabase/admin";

import { lerEquipeInstalada } from "./travas";

export async function temAgenteDePropostas(organizationId: string): Promise<boolean> {
  try {
    const equipe = await lerEquipeInstalada(createAdminClient(), organizationId);
    return Boolean(equipe?.instalacao.agentes.proposta?.agent_id);
  } catch {
    return false;
  }
}
