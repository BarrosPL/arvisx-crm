---
impacto: capacidade_nova
secao: adicionado
titulo: Linha do tempo do negócio por agente, filtros novos na lista de negócios e autoria no histórico da conversa
---

Três coisas que os agentes externos precisavam para trabalhar sem a tela.

- **Linha do tempo por agente** — `crm_list_lead_events` devolve o que
  aconteceu num negócio, ou em todos os negócios de um funil num período:
  mudança de etapa, de responsável, de tag e de campo, notas e tarefas, com
  quem fez cada coisa e o texto inteiro. Filtra por período, por tipo e por
  autor (pessoa, agente, sistema, cliente) e pagina por cursor. Só leitura. Em
  "O que o agente pode fazer", fica em "Não perder o cliente".
- **Filtros novos em `crm_list_leads`** — criados a partir de uma data
  (`created_since`), que entraram na etapa atual a partir de uma data
  (`moved_since`), sem movimento desde uma data (`last_activity_before`), com
  uma tag (`tag`) e sem uma tag (`sem_tag`). Combinam com os filtros que já
  existiam, e o cursor continua valendo.
- **Quem escreveu cada mensagem** — `crm_get_conversation_history` passa a
  dizer, em cada mensagem, o autor (`author`: cliente, IA e qual agente, pessoa
  da equipe com o nome, ou sistema) e o canal (`channel`). Os campos que já
  existiam não mudaram.

A linha do tempo não cria tabela: lê a linha do tempo do card e a fila de
eventos que já existiam. Mensagem não entra nela (é da conversa, não do
negócio), e nem todo registro guarda quem agiu: os limites estão em
`docs/arvisx/SUPERFICIE-DE-AGENTE.md`. Não há mudança de banco.
