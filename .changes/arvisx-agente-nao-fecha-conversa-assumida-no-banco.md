---
impacto: nada_mudou
secao: corrigido
titulo: O agente não fecha conversa que uma pessoa acabou de assumir
---

A regra "o agente não fecha conversa que uma pessoa assumiu" era conferida só
na leitura. Se a pessoa assumisse no instante entre a leitura e o fechamento, o
agente ainda fechava a conversa dela.

A conferência passou a morar dentro da função do banco (migration 9824), com a
linha da conversa travada, e vale também para arquivar e resolver. O agente
recebe a mesma recusa de sempre ("uma pessoa da equipe assumiu esta conversa").
Pela tela nada muda: a pessoa responsável e o gerente fecham como antes.

A migration é aplicada pelo `init` no deploy, como as demais. Se ela não entrar
e a imagem nova subir, o agente deixa de fechar conversas (responde
"indisponível") até a migration ser aplicada; a tela segue funcionando.
