---
impacto: capacidade_nova
secao: adicionado
titulo: Agentes fecham a conversa que ficou sem resposta
---

Um agente que fala com o CRM por token de API não tinha como tirar da caixa de
entrada a conversa em que ele falou por último e o cliente não respondeu:
fechar conversa só existia na tela. As ferramentas que já existiam fecham outra
coisa (`crm_close_human_case`, o chamado; `crm_close_demand`, o negócio).

Ferramenta nova, a mesma para o agente externo (por token) e para os agentes
nativos: `crm_close_conversation`, com a conversa e um motivo opcional.

- Nada é enviado ao cliente. Se ele escrever de novo, a conversa reabre.
- Fechar uma conversa já encerrada não muda nada e responde que ela já estava
  encerrada. Conversa arquivada continua arquivada.
- O fechamento fica na auditoria como o da tela (`conversation.closed`), com o
  agente como autor e o motivo informado.
- A trava de atendimento humano do contato não é tocada: devolver o contato ao
  automático continua sendo escolha de quem fecha pela tela.

A regra é a mesma da tela: ela saiu da rota de fechar conversa para um módulo
que os dois lados chamam. Em "O que o agente pode fazer", a ferramenta fica em
"Não perder o cliente". Nenhuma migration.
