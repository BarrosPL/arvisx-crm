/**
 * Capacidades de ACOMPANHAMENTO DO NEGÓCIO — o que o agente deixa registrado
 * para a equipe (e para outro agente) em volta de um negócio: tarefas internas,
 * anotações com autoria, documentos anexados e a próxima ação proposta.
 *
 * ESTE ARQUIVO FALA COM O HUMANO que configura o agente — `rotulo`,
 * `explicacao` e `oQueToca`. O texto que vai ao MODELO é a `description` do
 * HANDLER (`lib/mcp/tools/tarefas.ts`, `notas-do-negocio.ts`,
 * `anexos-do-negocio.ts`, `proxima-acao.ts`), e ela não tem cópia aqui.
 *
 * ═══ Em que pacote cada uma entra, e por que não é um só ═══
 *
 * Nenhuma destas capacidades fala com o cliente: tudo o que elas escrevem é
 * lido pela equipe, dentro do CRM. Por isso entram por pacote (`atencao`, não
 * `critico`). O pacote natural das nove seria o de operação (`organizar`), mas
 * ele não as comporta: um pacote sozinho não pode passar do teto por agente, e
 * `organizar` já ocupava 22 das 27 vagas — com as nove iria a 31
 * (`tests/unit/pacote-reserva-vaga-da-critica.test.ts`). E nenhuma entra em
 * `vender`, o pacote com que todo agente nasce: cada capacidade a mais ali
 * consome a folga que deixa uma segunda jornada caber no teto (mesmo teste).
 *
 * Então cada grupo vai para a jornada a que serve:
 *
 *  - TAREFAS → `organizar`: é a distribuição de trabalho da equipe;
 *  - ANOTAÇÕES → `escalar`: o recado para a equipe ou para outro agente é o
 *    que acompanha a passagem do atendimento ("entrega o resumo do que já
 *    aconteceu");
 *  - DOCUMENTOS e PRÓXIMA AÇÃO → `reter`: é o acompanhamento do negócio depois
 *    da conversa, ao lado da proposta de campos lida de um documento.
 *
 * Os papéis da Equipe pronta listam capacidade por capacidade, não por pacote:
 * para eles o pacote não decide nada. Ele decide só o que o toggle da tela liga.
 *
 * ═══ Por que o papel mínimo das escritas é o de quem atende ═══
 *
 * A régua do papel de uma capacidade é o que a ROTA HTTP equivalente exige
 * (`tests/unit/capacidade-alcancavel-pelo-agente.test.ts`). Criar e editar
 * tarefa, anexar documento e decidir a próxima ação pedem `agent` na tela —
 * é o gesto de quem ATENDE, todo dia —, e é o mesmo aqui. É também o papel
 * que um token de API tem por padrão, que é como o agente externo chega.
 */
import { declararTools } from "./tipos";

export const TOOLS_ACOMPANHAMENTO = declararTools([
  {
    name: "crm_list_tasks",
    category: "read",
    rotulo: "Listar tarefas da equipe",
    explicacao:
      "Mostra as tarefas internas da equipe, com prazo, responsável e o que já foi concluído, para o agente saber o que está combinado e o que está atrasado.",
    oQueToca: "Tarefas da equipe",
    risco: "seguro",
    pacotes: ["organizar"],
  },
  {
    name: "crm_create_task",
    category: "write",
    rotulo: "Criar tarefa para a equipe",
    explicacao:
      "Cria um lembrete de trabalho interno com prazo, para um atendente ou para a equipe, ligado ao negócio ou ao contato. Nada é enviado ao cliente.",
    oQueToca: "Tarefas da equipe",
    risco: "atencao",
    pacotes: ["organizar"],
  },
  {
    name: "crm_complete_task",
    category: "write",
    rotulo: "Concluir tarefa da equipe",
    explicacao:
      "Marca uma tarefa interna como concluída e registra, em texto, o que foi feito. A conclusão aparece na linha do tempo do negócio.",
    oQueToca: "Tarefas da equipe",
    risco: "atencao",
    pacotes: ["organizar"],
  },
  {
    name: "crm_update_task",
    category: "write",
    rotulo: "Mudar prazo ou responsável da tarefa",
    explicacao:
      "Altera o prazo de uma tarefa interna ou passa a tarefa para outro atendente, para o trabalho combinado não ficar parado com quem não pode cumprir.",
    oQueToca: "Tarefas da equipe",
    risco: "atencao",
    pacotes: ["organizar"],
  },
  {
    name: "crm_list_lead_notes",
    category: "read",
    rotulo: "Ler anotações do negócio",
    explicacao:
      "Lê as anotações deixadas no negócio, com quem escreveu, quando e o texto inteiro, inclusive os recados que outro agente deixou.",
    oQueToca: "Linha do tempo do negócio",
    risco: "seguro",
    pacotes: ["escalar"],
  },
  {
    name: "crm_add_lead_note",
    category: "write",
    rotulo: "Anotar no negócio",
    explicacao:
      "Escreve uma anotação no negócio, assinada pelo agente, que a equipe lê na linha do tempo. Pode ser um recado para uma área ou para outro agente. Nada é enviado ao cliente.",
    oQueToca: "Linha do tempo do negócio",
    risco: "atencao",
    pacotes: ["escalar"],
  },
  {
    name: "crm_list_lead_attachments",
    category: "read",
    rotulo: "Listar documentos do negócio",
    explicacao:
      "Mostra os documentos anexados ao negócio, com nome, tipo e tamanho, e um acesso temporário para abrir cada arquivo.",
    oQueToca: "Documentos do negócio",
    risco: "seguro",
    pacotes: ["reter"],
  },
  {
    name: "crm_attach_to_lead",
    category: "write",
    rotulo: "Anexar documento ao negócio",
    explicacao:
      "Guarda no negócio um arquivo que o cliente já enviou na conversa, para o documento ficar no cartão e não se perder no meio das mensagens.",
    oQueToca: "Documentos do negócio",
    risco: "atencao",
    pacotes: ["reter"],
  },
  {
    name: "crm_set_next_action",
    category: "write",
    rotulo: "Propor a próxima ação do negócio",
    explicacao:
      "Deixa no cartão do negócio a próxima ação sugerida pelo agente, para uma pessoa da equipe aprovar ou descartar. Nada é executado sozinho.",
    oQueToca: "Funil de vendas",
    risco: "atencao",
    pacotes: ["reter"],
  },
]);
