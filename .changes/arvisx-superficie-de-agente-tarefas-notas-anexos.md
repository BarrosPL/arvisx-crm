---
impacto: capacidade_nova
secao: adicionado
titulo: Agentes criam tarefa, anotam, anexam documento e propõem a próxima ação
---

Um agente que fala com o CRM por token de API não tinha como registrar o que
combinou: criar e concluir tarefa, anexar documento e decidir a próxima ação só
existiam na tela, e anotação com autoria não existia para agente nenhum.

Nove ferramentas novas, as mesmas para o agente externo (por token) e para os
agentes nativos:

- **Tarefas** — `crm_create_task`, `crm_list_tasks`, `crm_complete_task` e
  `crm_update_task`: tarefa interna com prazo, prioridade, tipo e responsável
  (um atendente ou a equipe), ligada ao negócio e/ou ao contato. Concluir aceita
  o resultado em texto e pode ser repetido sem duplicar nada.
- **Anotações do negócio** — `crm_add_lead_note` e `crm_list_lead_notes`: o
  texto fica inteiro, assinado por quem escreveu (o nome do agente ou do token),
  e aparece na linha do tempo do negócio. Um marcador opcional de destinatário
  serve de recado entre agentes. A ficha que o agente nativo mantém sobre o
  contato continua separada, e pode ser lida junto.
- **Documentos** — `crm_attach_to_lead` e `crm_list_lead_attachments`: anexa ao
  negócio um arquivo que já está no CRM (a mídia de uma mensagem da conversa),
  com os mesmos formatos e o mesmo limite de 50 MB da tela. Endereço externo não
  é aceito.
- **Próxima ação** — `crm_set_next_action`: a proposta aparece no card para uma
  pessoa aprovar ou descartar.

Nenhuma delas envia mensagem ao cliente. As regras são as mesmas da tela — a
validação foi extraída das rotas e é usada pelos dois lados — e toda escrita
fica na auditoria com o agente como autor.

A tarefa ganhou duas colunas opcionais (tipo e resultado, migration 9809), que
o `update.sh` aplica sozinho. Em "O que o agente pode fazer", as tarefas ficam
em "Organizar a operação", as anotações em "Passar para um humano" e os
documentos e a próxima ação em "Não perder o cliente".

Depois da revisão de 20/11: criar tarefa, anotar e anexar não duplicam mais
quando o agente repete o pedido sem `Idempotency-Key` (o mesmo pedido, do mesmo
autor, em até 10 minutos, devolve o primeiro resultado); a nota tem índice único
por chave (migration 9818, que o `update.sh` aplica sozinho e que não apaga
nota nenhuma); concluir tarefa não sobrescreve o resultado de uma conclusão
simultânea nem conclui por cima de um cancelamento; tarefa com negócio de um
contato e `contact_id` de outro é recusada; o anexo é medido antes de ser
baixado e o nome do arquivo precisa ter extensão de PDF ou imagem — a mesma
conferência passa a valer no envio pela tela, que recusa `foo.exe` mesmo
declarado como PDF. A descrição da tarefa e o nome do arquivo deixam de ir para
a auditoria, que guarda só o tamanho.
