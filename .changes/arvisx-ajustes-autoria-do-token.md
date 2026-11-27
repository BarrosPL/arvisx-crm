---
impacto: capacidade_nova
secao: adicionado
titulo: O que o agente externo faz por token passa a ficar com a autoria dele
---

Ação de agente externo por token passa a registrar quem foi: `crm_get_conversation_history` devolve a mensagem com `author.kind: "agente"`, id e nome do token e `is_self`; `crm_list_lead_events` mostra etapa, edição, fechamento, tarefa, anexo e tag como autor `agente` (filtro `author: ["agente"]`). Só id e nome do token são guardados, nunca o valor; token de gerente ou admin vê o de todos, token comum só o próprio, e em atendimento ninguém vê. A tela não muda e o histórico anterior fica como estava. Sem migration.
