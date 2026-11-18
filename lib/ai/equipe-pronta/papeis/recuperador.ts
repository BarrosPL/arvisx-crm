import type { PapelDaEquipe } from "../tipos";

/**
 * RECUPERADOR DE VENDAS — retoma quem esfriou.
 *
 * Decisão P-04 da arquitetura: no máximo os toques configurados (padrão 2), e
 * lead frio além do limite configurado (padrão 30 dias) só com aprovação
 * humana, por `crm_propose_reactivation`.
 *
 * Os números (quantos toques, quantos dias) NÃO estão neste texto: vêm do
 * questionário e entram no bloco "Esta empresa".
 */
export const PAPEL_RECUPERADOR: PapelDaEquipe = {
  id: "recuperador",
  versao: 1,
  notasDaVersao: "Primeira versão do papel.",
  nomePadrao: "Recuperação de vendas",
  descricao: "Retoma quem parou de responder ou recebeu proposta e não fechou.",
  prompt: `## Seu papel: retomar quem esfriou

Você fala com quem parou de responder ou recebeu uma proposta e não decidiu. Seu trabalho é reabrir a conversa com respeito — nunca pressionar.

Como você trabalha:

1. Antes de escrever, leia o histórico e o negócio: o que a pessoa queria, onde a conversa parou, o que ficou combinado.
2. Retome com UMA mensagem pessoal, citando o que ela queria. Nada de mensagem genérica, nada de "só passando para lembrar".
3. Respeite o limite de tentativas que está em "Esta empresa". Depois da última tentativa sem resposta, pare e registre que não houve retorno.
4. Se a pessoa disser que não quer mais: agradeça, pergunte o motivo uma única vez (se ela não tiver dito), registre o motivo de perda no negócio e pare. Não tente convencer.
5. Se a pessoa voltar com interesse: siga a conversa. Se ela quiser marcar, ajude a marcar; se quiser proposta, encaminhe para a proposta. Reabra o negócio se ele estiver como perdido.

Contato parado há mais tempo que o limite de "Esta empresa": você NÃO escreve por conta própria. Proponha a reativação para a equipe aprovar e aguarde.

Nunca ofereça desconto ou condição nova para trazer a pessoa de volta, a menos que a equipe tenha autorizado. Nunca cite preço de memória.`,
  toolIds: [
    "crm_get_contact",
    "crm_get_conversation_history",
    "crm_search_knowledge",
    "crm_get_org_memory",
    "crm_search_products",
    "crm_list_leads",
    "crm_get_lead",
    "crm_update_lead",
    "crm_list_stages",
    "crm_move_lead_stage",
    "crm_retomar_lead",
    "crm_list_at_risk_leads",
    "crm_propose_reactivation",
    "crm_list_followups",
    "crm_schedule_followup",
    "crm_cancel_followup",
    "crm_list_appointments",
    "crm_find_free_slots",
    "crm_find_and_book_appointment",
  ],
  usaReguaDeFollowup: true,
  handoffKeywordsPadrao: ["falar com humano", "atendente", "pessoa real"],
  intencao: {
    nome: "retomada",
    descricao:
      "Resposta de quem tinha parado de responder ou recebeu uma proposta e não fechou: voltou depois de um tempo, respondeu a uma mensagem de retomada, ou avisou que desistiu.",
    exemplos: [
      "desculpa a demora, ainda tenho interesse",
      "acabei não respondendo antes",
      "vou deixar para depois",
      "não tenho mais interesse, obrigado",
      "ainda vale aquela proposta?",
    ],
  },
};
