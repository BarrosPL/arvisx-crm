---
impacto: capacidade_nova
secao: adicionado
titulo: Instagram e Facebook Messenger conectam direto na Meta, sem parceiro
---

Cada empresa conecta Instagram e Facebook Messenger sozinha em **Conexões › Redes sociais › Conectar Instagram / Facebook**: entra com o Facebook, escolhe a página e as mensagens chegam na caixa de entrada, com resposta, IA por canal, pausa e desconectar. Quem conectou por parceiro continua funcionando. Usa o mesmo app da Meta do WhatsApp API Oficial; sem ele configurado o botão aparece desligado.

**Requer atenção:** cadastrar o **App ID** em **Administração › API Oficial da Meta** e colar no painel da Meta os endereços que a tela mostra (webhook, redirecionamento do login, exclusão de dados). Passo a passo em `docs/arvisx/META-INSTAGRAM-MESSENGER.md`.

Entra a página pública **/exclusao-de-dados** (exigência da Meta). A migração 9800 é aplicada sozinha. `META_HUMAN_AGENT_TAG=on` só depois de aprovada a permissão "Human Agent".
