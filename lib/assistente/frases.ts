/**
 * AS FRASES FIXAS DO VIX — o que o usuário lê quando o modelo NÃO é chamado.
 *
 * São chaves do dicionário (`lib/i18n/dicionario.ts`): a rota as traduz com
 * `traduzir()`. Nenhuma carrega detalhe técnico; o motivo real vai para o log e
 * para a auditoria.
 */
export const FRASES = {
  segredo:
    "Isso parece uma chave, senha ou código, e não deve ser colado aqui. Eu não li nem guardei o que você enviou. Para cadastrar uma chave de IA, use a tela de Credenciais. Se o que você colou era uma chave verdadeira, o mais seguro é revogá-la no site do provedor e criar outra.",
  indisponivel:
    "O assistente está indisponível no momento. Tente de novo daqui a pouco. O CRM e os seus agentes de atendimento continuam funcionando normalmente.",
  semAcesso: "O assistente não está disponível para a sua empresa.",
  longa: "A mensagem ficou longa demais. Envie um texto mais curto.",
  desligado: "O assistente está desligado.",
  taxa: "Muitas mensagens seguidas. Tente de novo em um minuto.",
  naoConseguiu: "Não consegui concluir a resposta agora. Tente de novo em instantes.",
} as const;

/** O que o usuário lê quando a confirmação de um cartão é recusada. */
export const FRASES_DA_CONFIRMACAO = {
  indisponivel: "Este cartão não está mais disponível: já foi usado, expirou ou não é seu.",
  papel: "Você não tem permissão para esta ação.",
  plano: "Esta função não está no plano da sua empresa.",
  desligadas: "As ações do assistente estão desligadas.",
  lote: "Esta ação alteraria registros demais de uma vez. Peça ao assistente para dividir em partes menores.",
  palavra: "Para confirmar esta ação, digite a palavra confirmar.",
  falhou: "Não consegui concluir esta ação. Nada foi alterado.",
} as const;
