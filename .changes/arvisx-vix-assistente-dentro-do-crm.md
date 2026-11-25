---
impacto: capacidade_nova
secao: adicionado
titulo: Assistente dentro do CRM (Vix), desligado por padrão
---

O CRM ganhou um assistente que conversa com quem usa o sistema: tira dúvidas de
uso pela base de ajuda, consulta os dados da própria empresa com a permissão de
quem pergunta e mostra a tela certa. Ele aparece como um botão fixo em todas as
telas (atalho Ctrl+J, e uma entrada na busca do Ctrl+K).

**Ele nasce desligado e nada muda para quem não o ligar.** Para ligar, quem
administra a instalação escolhe, em Painel › Configuração, por onde o assistente
chama a IA (`VIX_PAGADOR`). Além disso, a empresa só tem o assistente se tiver
assinatura ativa, em qualquer plano, ou se a plataforma a marcar como isenta.
Não há limite de mensagens por plano: há um freio contra abuso (mensagens por
minuto e tamanho da mensagem), ajustável em Painel › Configuração, e a
administração da instalação vê o uso por empresa em Painel › Chamados.

O assistente só lê. Alterar dados é uma chave separada (Painel › Sistema, "Ações
do assistente"), também desligada: com ela, o assistente propõe a ação num
cartão e nada acontece até a pessoa confirmar.

Cada empresa pode desligar o assistente para si em Configurações › Empresa. Os
pedidos de ajuda abertos pelo assistente aparecem para a equipe da instalação em
Painel › Chamados. O histórico das conversas com o assistente é apagado com 30
dias (`ASSISTENTE_HISTORICO_RETENTION_DAYS`), e é apagado inteiro, na empresa,
quando um contato dela é anonimizado.

A atualização cria tabelas novas (`assistente_*`) e não altera nenhuma que já
existia.
