/**
 * QUEM CUIDA DOS AGENTES DE IA (ArvisX, tarefa 3 dos planos).
 *
 * O aviso comercial fixo, num lugar só: a landing e o comparativo dos planos
 * mostram EXATAMENTE estas frases, pelo componente
 * `components/cobranca/QuemCuidaDosAgentes.tsx`. Não é texto de plano (esses
 * vêm do cadastro, em /admin/cobranca): é a regra de quem configura os agentes.
 *
 * A regra: nos planos sem o serviço sob medida, a gestão e a configuração dos
 * agentes de IA dentro da plataforma são do cliente; a Arvisx só desenvolve
 * soluções personalizadas no Equipe Completa.
 *
 * O Equipe Completa começa por uma reunião (/agendar), em que a equipe orienta a
 * assinatura; a assinatura segue sendo feita no CRM e nada a trava sem reunião
 * (tarefa 4 dos planos).
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
        "O Essencial não tem agentes de IA: a IA começa no Standard. A Arvisx não desenvolve soluções personalizadas nesse plano.",
    },
    {
      id: "standard_e_premium",
      planos: "Standard e Premium",
      texto:
        "Nesses planos, você é responsável pela gestão e pela configuração dos seus agentes de IA dentro da plataforma: conecta a sua credencial de IA, cadastra o conhecimento do seu negócio, define os fluxos e acompanha os resultados. A Arvisx não desenvolve soluções personalizadas nesses planos.",
    },
    {
      id: "equipe_completa",
      planos: "Equipe Completa",
      texto:
        "No Equipe Completa, a Arvisx entra em um processo de desenvolvimento de soluções personalizadas: começa por uma reunião, entende a sua operação e cria 4 agentes de IA sob medida, integrados ao CRM e às suas ferramentas. É o único plano em que a Arvisx desenvolve soluções para você.",
    },
  ],
  consumo: "O consumo da IA é cobrado pelo seu provedor de IA, nunca pela Arvisx.",
} as const;

/**
 * Na troca de um plano com o serviço sob medida para um plano sem ele: o que se
 * perde. Só diz o que o código faz (a saída é registrada e a equipe é avisada);
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
