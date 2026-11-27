---
impacto: capacidade_nova
secao: adicionado
titulo: Linha do tempo do negócio por agente, filtros novos na lista de negócios e autoria no histórico da conversa
---

- **`crm_list_lead_events`:** o que aconteceu num negócio, ou nos de um funil num período (etapa, responsável, tag, campo, notas, tarefas), com quem fez. Filtra por período, tipo e autor e pagina por cursor. A troca de responsável sai com autor `nao_registrado`.
- **Filtros novos em `crm_list_leads`:** `created_since`, `moved_since`, `last_activity_before`, `tag`, `sem_tag`.
- **`crm_get_conversation_history`** traz `author` (cliente, IA e qual agente, pessoa, sistema) e `channel`.

Só leitura; limites em `docs/arvisx/SUPERFICIE-DE-AGENTE.md`. Sem mudança de banco.
