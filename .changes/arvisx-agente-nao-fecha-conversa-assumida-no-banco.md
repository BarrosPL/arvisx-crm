---
impacto: nada_mudou
secao: corrigido
titulo: O agente não fecha conversa que uma pessoa acabou de assumir
---

A regra "o agente não fecha conversa que uma pessoa assumiu" era conferida só na leitura: se a pessoa assumisse entre a leitura e o fechamento, o agente ainda fechava. Agora a conferência está na função do banco (migration 9824), com a conversa travada, e vale também para arquivar e resolver. A tela não muda. O `init` aplica a migration no deploy; sem ela, o agente responde "indisponível" ao fechar até ser aplicada.
