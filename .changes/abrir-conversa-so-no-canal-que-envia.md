---
impacto: capacidade_nova
secao: corrigido
titulo: Abrir a conversa de quem acabou de ser cadastrado só acontece no canal que pode enviar
---

**Salvar e iniciar conversa** só abre a conversa em canal que pode enviar: antes, `channel_session_id` desligado ou fora do ar criava conversa vazia; agora recusa com o motivo na tela. Sem canal escolhido, contato com telefone prefere o canal que disca. Para integrações: `POST /api/v1/conversations/open-with-contact` responde `409` (`state_conflict`) nesses casos, e `start_conversation_and_send` responde `session_unavailable`.
