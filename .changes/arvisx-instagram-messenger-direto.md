---
impacto: capacidade_nova
secao: adicionado
titulo: Instagram e Facebook Messenger conectam direto na Meta, sem parceiro
---

Cada empresa passa a conectar o Instagram e o Facebook Messenger sozinha, em
**Conexões › Redes sociais › Conectar Instagram / Facebook**: entra com o
Facebook, escolhe a página e as mensagens do Messenger e do Instagram
profissional ligado a ela chegam na caixa de entrada, com resposta pelo CRM
(texto e mídia), a IA por canal, pausa, renomear e desconectar — o mesmo
atendimento das redes que já existia, sem depender de um parceiro externo.

A conexão usa o **mesmo app da Meta** que a instalação já cadastra para a API
Oficial do WhatsApp (não há segundo cadastro). Enquanto o app não estiver
configurado, o botão aparece desligado dizendo a quem pedir; nada muda para
quem não usar. A conexão por parceiro continua funcionando para quem já
conectou por ela.

Para ligar, quem administra a instalação cadastra o **App ID** em
**Administração › API Oficial da Meta** (a chave secreta e o token de
verificação são os que já estão lá) e, no painel da Meta, cola os endereços que
a mesma tela mostra: webhook dos produtos Messenger e Instagram, URI de
redirecionamento do login do Facebook e callback de exclusão de dados. O passo a
passo, as permissões do App Review e o roteiro do vídeo estão em
`docs/arvisx/META-INSTAGRAM-MESSENGER.md`.

Também entra a página pública **/exclusao-de-dados** (exigência da Meta), que o
rodapé da página inicial passa a apontar, e o callback de exclusão de dados: o
pedido da Meta desconecta as páginas que a pessoa autorizou e apaga os tokens.

A atualização aplica sozinha a migração 9800 (provider `meta_social`, três
colunas em `channel_sessions` e o `app_id` em `platform_meta_app`). Variável
nova opcional: `META_HUMAN_AGENT_TAG=on` só depois que a permissão "Human Agent"
for aprovada no App Review.
