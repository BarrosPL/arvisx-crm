/**
 * QUEM CUIDA DOS AGENTES DE IA (ArvisX, tarefa 3 dos planos; revisto em 12/11/2026).
 *
 * O aviso comercial fixo, num lugar só: a landing e o comparativo dos planos
 * mostram EXATAMENTE estas frases, pelo componente
 * `components/cobranca/QuemCuidaDosAgentes.tsx`. Não é texto de plano (esses
 * vêm do cadastro, em /admin/cobranca): é a regra de quem configura os agentes.
 *
 * A regra: nos planos (Essencial, Standard e Premium), a gestão e a configuração
 * dos agentes de IA dentro da plataforma são do cliente; a Arvisx só desenvolve
 * soluções personalizadas pelos Agentes Arvisx, um serviço À PARTE de qualquer
 * plano, contratado depois de uma reunião (/agendar) e de uma proposta, sem
 * preço público e fora da cobrança do CRM.
 *
 * Histórico: até 12/11/2026 esse serviço era o plano Equipe Completa, que saiu
 * da oferta (arquivado em `cobranca_planos`, sem assinantes). O terceiro item,
 * que era o do plano, virou o do serviço à parte. Não prometer quantidade de
 * agentes nem funções fixas.
 *
 * Verdadeiro com o que o sistema faz: o Essencial não tem as telas de IA
 * (docs/arvisx/PLANOS.md), por isso a frase dele não fala em configurar agente.
 * Isto é texto: nenhuma trava nova, nenhum limite de quantidade de agentes.
 */
export const QUEM_CUIDA_DOS_AGENTES = {
  titulo: "Quem cuida dos agentes de IA",
  itens: [
    {
      id: "essencial",
      planos: "Essencial",
      texto:
        "O Essencial não tem agentes de IA: a IA começa no Standard. A Arvisx só desenvolve soluções personalizadas pelo serviço à parte Agentes Arvisx.",
    },
    {
      id: "standard_e_premium",
      planos: "Standard e Premium",
      texto:
        "Nesses planos, você é responsável pela gestão e pela configuração dos seus agentes de IA dentro da plataforma: conecta a sua credencial de IA, cadastra o conhecimento do seu negócio, define os fluxos e acompanha os resultados. A Arvisx só desenvolve soluções personalizadas pelo serviço à parte Agentes Arvisx.",
    },
    {
      id: "agentes_arvisx",
      planos: "Agentes Arvisx (à parte)",
      texto:
        "Em qualquer plano, quem quiser agentes de IA desenvolvidos pela Arvisx contrata o serviço à parte, depois de uma reunião: a equipe entende a sua operação, envia a proposta e desenvolve os agentes sob medida, integrados ao CRM.",
    },
  ],
  consumo: "O consumo da IA é cobrado pelo seu provedor de IA, nunca pela Arvisx.",
} as const;

/**
 * Na troca de um plano com o serviço sob medida para um plano sem ele: o que se
 * perde. Só aparece para quem ESTÁ num plano com `inclui_agentes_arvisx` (o
 * Equipe Completa, arquivado e sem assinantes), por isso a frase ficou como era.
 * Só diz o que o código faz (a saída é registrada e a equipe é avisada);
 * não promete nada sobre o que já foi entregue.
 */
export const SAIDA_DO_SOB_MEDIDA =
  "Ao sair do Equipe Completa, o desenvolvimento de soluções personalizadas pela Arvisx deixa de valer para novos pedidos.";

/** Todas as frases do aviso, na ordem em que aparecem (para os testes e o dicionário). */
export const FRASES_DE_QUEM_CUIDA: readonly string[] = [
  QUEM_CUIDA_DOS_AGENTES.titulo,
  ...QUEM_CUIDA_DOS_AGENTES.itens.flatMap((i) => [i.planos, i.texto]),
  QUEM_CUIDA_DOS_AGENTES.consumo,
];
