---
impacto: capacidade_nova
secao: adicionado
titulo: Agentes criam tarefa, anotam, anexam documento e propõem a próxima ação
---

Nove ferramentas novas, iguais para o agente externo (token) e os nativos, para registrar o que combinaram:

- **Tarefas:** `crm_create_task`, `crm_list_tasks`, `crm_complete_task`, `crm_update_task`.
- **Anotações do negócio:** `crm_add_lead_note`, `crm_list_lead_notes`, assinadas e na linha do tempo.
- **Documentos:** `crm_attach_to_lead`, `crm_list_lead_attachments` (arquivo já no CRM; formatos e 50 MB da tela).
- **Próxima ação:** `crm_set_next_action`, para uma pessoa aprovar ou descartar no card.

Nenhuma envia mensagem. Valem as regras da tela, com auditoria e o agente como autor; repetir o pedido em 10 minutos devolve o primeiro resultado. Migrations 9809 (duas colunas de tarefa) e 9818 (índice único de nota): nada é apagado.
