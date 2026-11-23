---
impacto: capacidade_nova
secao: adicionado
titulo: O que o agente externo faz por token passa a ficar com a autoria dele
---

Um agente externo fala com o CRM por token de API. Até aqui, a mensagem que ele
enviava saía no histórico igual à de qualquer outra integração, e a mudança de
etapa que ele fazia entrava na linha do tempo do negócio como "sistema".

- **No histórico da conversa** (`crm_get_conversation_history`) — a mensagem
  enviada por token sai com `author.kind: "agente"`, o id e o nome do token, e
  `is_self`, que diz se foi o próprio token que está lendo. O agente separa a
  própria fala da de outra integração, da equipe, do cliente e da IA do CRM.
- **Na linha do tempo do negócio** (`crm_list_lead_events`) — mover etapa,
  editar o negócio, fechar, criar ou concluir tarefa, anexar e pôr ou tirar tag
  por token saem com autor `agente`, o id e o nome do token, e o filtro
  `author: ["agente"]` as encontra.
- **O que é guardado** — só o id do token e o nome que o administrador deu a
  ele. O valor do token não é gravado.
- **Quem vê o id e o nome do token** — token com papel de gerente ou admin vê
  de todo token; token comum vê só o do próprio (de outro token ele sabe que
  foi outro agente externo, sem nome e sem id). Durante um atendimento ninguém
  recebe nome nem id de token, para o agente não repetir ao cliente o nome que
  o administrador deu ao token. `is_self` sai sempre.

A tela não mudou: o balão da caixa de entrada e o card do negócio mostram o
mesmo de antes. Mensagens e linhas anteriores a esta versão ficam como estavam
(não guardam o token). A troca de responsável continua sem autor na linha
`responsavel`; quem trocou está na linha de edição do negócio ao lado. Não há
migration.
