/**
 * QUEM CUIDA DOS AGENTES DE IA (ArvisX, tarefa 3 dos planos; revisto em
 * 12/11/2026 e em 25/11/2026, Tarefa 8).
 *
 * O aviso comercial fixo, num lugar só: a landing e o comparativo dos planos
 * mostram EXATAMENTE estas frases, pelo componente
 * `components/cobranca/QuemCuidaDosAgentes.tsx`. Não é texto de plano (esses
 * vêm do cadastro, em /admin/cobranca): é a regra de quem configura os agentes
 * e de quem paga a IA.
 *
 * A regra desde a Tarefa 8 (decisão do Lucas, 25/11/2026): a IA vem incluída em
 * TODOS os planos, com uma franquia mensal de conversas com IA; usar a própria
 * chave de IA é opcional. A gestão e a configuração dos agentes dentro da
 * plataforma continuam sendo do cliente. A Arvisx só desenvolve soluções
 * personalizadas pelos Agentes Arvisx, um serviço À PARTE, contratado depois de
 * uma reunião (/agendar) e de uma proposta, sem preço público e fora da
 * cobrança do CRM. Não escrever "integrados ao CRM".
 *
 * O aviso NÃO cita nome de plano: os planos novos têm nome provisório e os
 * antigos saem da vitrine. ⚠️ Este texto descreve os planos NOVOS (com franquia
 * e teto). Ele só deve ir ao ar junto com a vitrine dos planos novos, que é um
 * passo de quem opera (ver `docs/arvisx/PLANOS.md`): com os planos antigos na
 * vitrine, "a IA vem incluída" não é verdade para quem os assina.
 *
 * Histórico: até 12/11/2026 o serviço sob medida era o plano Equipe Completa,
 * que saiu da oferta. Até 25/11/2026 o aviso dizia que o Essencial não tinha IA
 * e que o consumo era sempre cobrado pelo provedor do cliente. Não prometer
 * quantidade de agentes nem funções fixas.
 *
 * Isto é texto: a franquia e o teto são aplicados pelo motor
 * (`docs/arvisx/IA-POR-PLANO.md`), não por este arquivo.
 */
export const QUEM_CUIDA_DOS_AGENTES = {
  titulo: "Quem cuida dos agentes de IA",
  itens: [
    {
      id: "todos_os_planos",
      planos: "Todos os planos",
      texto:
        "A IA vem incluída, com uma franquia mensal de conversas com IA, e você é responsável pela gestão e pela configuração dos seus agentes de IA dentro da plataforma: cadastra o conhecimento do seu negócio, define os fluxos e acompanha os resultados.",
    },
    {
      id: "chave_propria",
      planos: "Chave própria (opcional)",
      texto:
        "Se preferir, a sua empresa cadastra a própria chave de IA. Com ela, o consumo é cobrado pelo seu provedor de IA e não gasta a franquia do plano.",
    },
    {
      id: "agentes_arvisx",
      planos: "Agentes Arvisx (à parte)",
      texto:
        "Em qualquer plano, quem quiser agentes de IA desenvolvidos pela Arvisx contrata o serviço à parte, depois de uma reunião: a equipe entende a sua operação, envia a proposta e desenvolve os agentes sob medida, conectados à sua operação.",
    },
  ],
  consumo:
    "Quando a franquia do mês acaba, a IA para e as conversas seguem com a sua equipe, até o próximo ciclo ou até você cadastrar a própria chave.",
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
