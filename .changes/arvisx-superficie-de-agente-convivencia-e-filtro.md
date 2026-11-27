---
impacto: capacidade_nova
secao: adicionado
titulo: O agente externo fica sabendo quando uma pessoa assume a conversa, e a empresa pode barrar mensagens por regra antes da IA
---

- **O agente externo sabe ficar calado:** `crm_get_conversation` informa se a IA está pausada e quem assumiu, e dois gatilhos novos (`conversation.ai_paused`, `conversation.ai_resumed`) saem pelo webhook das automações.
- **Prazo de silêncio:** depois que alguém responde pela tela, a IA se cala por um prazo (padrão 5 minutos); ajuste `screen_reply_silence_minutes` pela rota de atendimento (sem campo na tela).
- **Filtro de entrada:** a empresa cadastra termos de ofensa, spam e assunto fora do escopo; a mensagem que casar não vai a modelo nenhum e recebe uma resposta curta da empresa, ou nada. Nasce desligado e sem lista, só pela rota de atendimento (`docs/arvisx/SUPERFICIE-DE-AGENTE.md`). Só barra mensagem com até 3 palavras além do termo e, com agente assistido, a resposta do filtro não sai.

Migration 9811: gatilho em `conversations`, sem tabela ou dado alterado.
