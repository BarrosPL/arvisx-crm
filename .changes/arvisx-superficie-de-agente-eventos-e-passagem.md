---
impacto: capacidade_nova
secao: adicionado
titulo: Seis gatilhos novos para sistemas externos, texto inteiro no webhook, consulta de proposta e passagem entre agentes
---

Quem acompanha o CRM por webhook passa a poder escutar mais coisas sobre um
negócio, pela mesma ação "Avisar outro sistema (webhook)" das automações.

- **Seis gatilhos novos** — quando um lead perder uma tag
  (`lead.tag_removed`), quando um campo do negócio for alterado
  (`lead.field_changed`), quando alguém escrever uma nota (`lead.note_added`),
  quando uma tarefa for criada no negócio (`lead.task_created`), quando um
  documento for anexado (`lead.attachment_added`) e quando uma tarefa for
  concluída (`task.completed`). Valem para o que é feito na tela e para o que
  é feito por um agente. Trocar o responsável e perder o negócio já tinham
  gatilho (`lead.assigned` e `lead.lost`) e continuam com ele.
- **Texto inteiro na entrega** — o aviso de mensagem recebida levava só os
  primeiros 280 caracteres. Agora toda entrega de evento de mensagem leva
  também `message.text`, o texto completo. A nota e a tarefa saem do mesmo
  jeito, sem corte. Os campos que já existiam (`body_preview` inclusive) não
  mudaram: quem já recebe não precisa alterar nada.
- **Consulta de proposta por agente** — `crm_get_proposal` devolve a situação,
  a validade, os itens e o valor de uma proposta, com um acesso temporário ao
  documento enviado. Só leitura. Em "O que o agente pode fazer", fica em
  "Não perder o cliente".
- **Passagem entre agentes do mesmo número** — num número com roteador, um
  agente pode passar a vez a outro com motivo e resumo. O colega responde ao
  cliente na mesma rodada, sem o cliente perceber a troca, e segue na conversa
  até o assunto mudar. Nasce desligada: o roteador a liga com a opção
  `passagem_entre_colegas`, que ainda não tem botão na tela.

A assinatura, as três tentativas e o identificador que evita processar duas
vezes a mesma entrega são os que já existiam, e valem para os gatilhos novos.
Organização suspensa continua sem enviar aviso nenhum. O guia de quem recebe
(`docs/integracao/webhooks-de-saida.md`) ganhou a lista dos eventos e do que
cada um traz. Não há mudança de banco.

Depois da revisão de 20/11: a regra de automação com a condição "Texto da
mensagem contém" passa a ler a mensagem inteira (antes só os primeiros 280
caracteres, e a palavra dita depois disso não disparava a regra). Na passagem
entre agentes, se o colega deixar de atender entre a passagem e a resposta, a
conversa volta para quem passou, que responde na mesma rodada; antes o cliente
ficava sem resposta.
