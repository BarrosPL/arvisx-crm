---
impacto: capacidade_nova
secao: adicionado
titulo: Agentes fecham a conversa que ficou sem resposta
---

Ferramenta nova `crm_close_conversation` (agente externo e nativos): fecha a conversa em que o agente falou por último e o cliente não respondeu, com motivo opcional. Não envia nada; se o cliente escrever, reabre. Fica na auditoria (`conversation.closed`). **Não fecha conversa que uma pessoa assumiu**, nem com token de gerente. Sem migration.
