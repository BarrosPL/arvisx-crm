---
impacto: nada_mudou
secao: alterado
titulo: Todo fechamento de conversa passa pela mesma regra
---

Quatro caminhos fecham conversa: o botão da tela, a ferramenta dos agentes
(`crm_close_conversation`), a API (`PATCH /api/v1/conversations/[id]` com
`status: "closed"`) e o marcar contato como pessoal, que fecha as conversas
abertas daquele contato. Os dois últimos chamavam o banco por conta própria;
agora os quatro chamam o mesmo módulo.

Nada muda para quem usa: cada caminho responde o mesmo, recusa com os mesmos
códigos e deixa na auditoria as mesmas linhas, na mesma ordem. O marcar como
pessoal continua fechando sem conferir a revisão do atendimento, como sempre
fez. Nenhuma migration.

Uma exceção, pedida pelo dono em 23/11/2026: agente de IA não fecha conversa que
uma pessoa da equipe assumiu. A ferramenta dos agentes recusa, e a API recusa o
mesmo pedido quando ele não vem de uma pessoa. Pela tela, e ao marcar contato
como pessoal, nada muda.
