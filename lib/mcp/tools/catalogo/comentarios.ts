/**
 * Capacidades de COMENTÁRIOS de rede social — ler o que as pessoas comentam nas
 * publicações e decidir o que fazer com cada comentário.
 *
 * ESTE ARQUIVO FALA COM O HUMANO que configura o agente — `rotulo`,
 * `explicacao` e `oQueToca`. O texto que vai ao MODELO é a `description` do
 * handler (`lib/mcp/tools/comentarios.ts`), e ela não tem cópia aqui.
 *
 * ═══ Por que as seis são `apenasHumano` ═══
 *
 * Quem decide o que responder a um comentário é quem trabalha por FORA do
 * atendimento: a equipe, pela tela, ou um agente externo, com um token tratado
 * como gerente. O agente que conversa num atendimento não as alcança — o papel
 * mínimo é o da rota e da tela (gerente), acima do papel do agente publicado.
 * A marca diz isso à tela, para ninguém ligar achando que o agente do
 * atendimento vai responder comentário sozinho.
 *
 * ═══ Por que duas são críticas ═══
 *
 * Responder em público e responder em privado FALAM com a pessoa, fora do
 * sistema, e não voltam atrás. Capacidade crítica nunca entra ligada por
 * pacote: é marcada uma a uma. As outras quatro não saem do CRM.
 *
 * ═══ O pacote ═══
 *
 * `reter`: comentário sem resposta é interessado que esfria. Não `vender` (o
 * pacote com que todo agente nasce, onde cada capacidade a mais consome a folga
 * do teto) nem `organizar` (o mais cheio).
 */
import { declararTools } from "./tipos";

export const TOOLS_COMENTARIOS = declararTools([
  {
    name: "crm_list_comments",
    category: "read",
    rotulo: "Listar comentários das publicações",
    explicacao:
      "Mostra os comentários recebidos nas publicações do Instagram, com o texto inteiro, quem comentou e o que já foi respondido.",
    oQueToca: "Comentários das publicações",
    risco: "seguro",
    pacotes: ["reter"],
    apenasHumano: true,
  },
  {
    name: "crm_get_comment",
    category: "read",
    rotulo: "Ver um comentário",
    explicacao:
      "Mostra um comentário com o texto inteiro, as respostas já dadas e até quando ainda dá para responder em privado.",
    oQueToca: "Comentários das publicações",
    risco: "seguro",
    pacotes: ["reter"],
    apenasHumano: true,
  },
  {
    name: "crm_reply_comment",
    category: "write",
    rotulo: "Responder comentário em público",
    explicacao:
      "Publica uma resposta ao comentário, na própria publicação, à vista de todos. Com a conexão em modo de registro, a resposta fica só anotada e nada é publicado.",
    oQueToca: "Comentários das publicações",
    risco: "critico",
    pacotes: ["reter"],
    apenasHumano: true,
  },
  {
    name: "crm_private_reply_comment",
    category: "write",
    rotulo: "Responder comentário em privado",
    explicacao:
      "Manda uma mensagem direta a quem comentou, de verdade, na caixa de mensagens da pessoa. A rede aceita uma por comentário, até 7 dias depois dele.",
    oQueToca: "Comentários das publicações",
    risco: "critico",
    pacotes: ["reter"],
    apenasHumano: true,
  },
  {
    name: "crm_ignore_comment",
    category: "write",
    rotulo: "Marcar comentário como sem ação",
    explicacao:
      "Tira o comentário da fila de novos e anota o motivo, quando não há o que responder. Nada é enviado nem publicado.",
    oQueToca: "Comentários das publicações",
    risco: "atencao",
    pacotes: ["reter"],
    apenasHumano: true,
  },
  {
    name: "crm_create_contact_from_comment",
    category: "write",
    rotulo: "Criar contato a partir de um comentário",
    explicacao:
      "Cria o cadastro de quem comentou e, se você indicar o funil, abre um negócio para a pessoa. Nada é enviado a ela.",
    oQueToca: "Comentários das publicações",
    risco: "atencao",
    pacotes: ["reter"],
    apenasHumano: true,
  },
]);
