---
impacto: capacidade_nova
secao: adicionado
titulo: O agente externo fica sabendo quando uma pessoa assume a conversa, e a empresa pode barrar mensagens por regra antes da IA
---

Duas coisas novas na convivência entre a equipe e a IA.

- **O agente de fora do CRM sabe quando ficar calado.** O agente do próprio
  CRM já não respondia por cima de quem assume ou responde uma conversa. Quem
  atende por um sistema externo passa a saber também, de dois jeitos:
  `crm_get_conversation` diz se a IA está pausada naquela conversa, por quê,
  desde quando e quem assumiu; e há dois gatilhos novos nas automações,
  "Quando o atendimento automático for pausado numa conversa"
  (`conversation.ai_paused`) e "Quando o atendimento automático voltar numa
  conversa" (`conversation.ai_resumed`), que saem pela ação "Avisar outro
  sistema (webhook)".
- **Prazo de silêncio da empresa para a resposta pela tela.** Depois que
  alguém responde pela tela, a IA fica calada por um prazo. Era fixo em 5 minutos. O padrão continua 5; quem quiser outro
  prazo ajusta `screen_reply_silence_minutes` pela rota de atendimento (ainda
  sem campo na tela). Os outros prazos, em Configurações › Atendimento, não
  mudaram.
- **Filtro de entrada.** A empresa pode cadastrar listas de termos para
  ofensa, spam e assunto fora do que ela atende. A mensagem que casar não é
  enviada a modelo nenhum: sai uma resposta curta escrita pela empresa, ou
  nada, e a conversa pode ganhar um marcador. Nasce desligado e sem lista: o
  produto não traz palavra nenhuma. Mensagem que pede uma pessoa ou pede para
  parar continua sendo tratada como antes. Ainda não tem tela; a configuração
  é pela rota de atendimento e está descrita em
  `docs/arvisx/SUPERFICIE-DE-AGENTE.md`.

Na passagem entre agentes do mesmo número, se uma pessoa assume a conversa
entre os dois, o segundo agente não responde.

Há uma migration (9811): um gatilho em `conversations` que grava os dois
eventos. Não cria tabela nem coluna e não altera dado existente. O
`update.sh` a aplica sozinho.
