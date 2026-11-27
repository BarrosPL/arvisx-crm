---
impacto: capacidade_nova
secao: adicionado
titulo: Assistente dentro do CRM (Vix), desligado por padrão
---

O CRM ganha um assistente que tira dúvidas de uso pela base de ajuda, consulta os dados da empresa com a permissão de quem pergunta e mostra a tela certa, em botão fixo (Ctrl+J; busca Ctrl+K).

**Nasce desligado.** Quem administra a instalação escolhe em Painel › Configuração por onde ele chama a IA (`VIX_PAGADOR`). A empresa precisa de assinatura ativa ou isenção. Sem limite por plano, só freio contra abuso (mensagens por minuto e tamanho, ajustável ali); uso por empresa em Painel › Chamados.

Só lê. Alterar dados é outra chave (Painel › Sistema, "Ações do assistente"), também desligada: ligada, ele propõe num cartão e nada acontece sem confirmação. A empresa o desliga em Configurações › Empresa. O histórico é apagado com 30 dias (`ASSISTENTE_HISTORICO_RETENTION_DAYS`) e na anonimização do contato.
