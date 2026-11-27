---
impacto: nada_mudou
secao: alterado
titulo: Todo fechamento de conversa passa pela mesma regra
---

Os quatro caminhos que fecham conversa (botão da tela, `crm_close_conversation`, `PATCH /api/v1/conversations/[id]` com `status: "closed"` e marcar contato como pessoal) passam pelo mesmo módulo, com as mesmas respostas, recusas e auditoria. Exceção pedida pelo dono em 23/11/2026: agente de IA não fecha conversa que uma pessoa assumiu; a ferramenta e a API (quando o pedido não vem de pessoa) recusam. Pela tela e ao marcar como pessoal nada muda. Sem migration.
