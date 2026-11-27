---
impacto: capacidade_nova
secao: adicionado
titulo: Seis gatilhos novos para sistemas externos, texto inteiro no webhook, consulta de proposta e passagem entre agentes
---

Mais coisas a escutar por webhook ("Avisar outro sistema"):

- **Seis gatilhos novos:** `lead.tag_removed`, `lead.field_changed`, `lead.note_added`, `lead.task_created`, `lead.attachment_added` e `task.completed`.
- **Texto inteiro:** entregas de mensagem levam `message.text` completo (antes 280 caracteres); campos antigos iguais. A condição "Texto da mensagem contém" também lê a mensagem inteira.
- **`crm_get_proposal`:** situação, validade, itens e valor, só leitura.
- **Passagem entre agentes do mesmo número,** com motivo e resumo, sem o cliente notar. Nasce desligada (`passagem_entre_colegas` no roteador, ainda sem botão); se o colega deixa de atender, volta para quem passou.

Lista de eventos em `docs/integracao/webhooks-de-saida.md`. Sem mudança de banco.
