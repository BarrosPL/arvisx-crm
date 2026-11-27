---
impacto: capacidade_nova
secao: adicionado
titulo: Comentários do Instagram chegam ao CRM e avisam um sistema externo
---

A conexão direta do Instagram passa a receber os comentários das publicações da empresa: cada um é guardado e dispara o gatilho "Quando chegar um comentário no Instagram" (webhook). Não vira contato nem negócio, e comentário da própria conta é ignorado.

Nasce desligado em toda conexão; as atuais seguem com mensagens sem reautorizar. O administrador liga o modo (registrar ou real); até a tela chegar, pela API.

**Requer atenção:** na Meta, assinar `comments` e `live_comments` do objeto Instagram e pedir acesso avançado a `instagram_manage_comments` e `pages_read_engagement` (`docs/integracao/comentarios-do-instagram.md`); sem isso, só não chegam.

Tabela nova `social_comments`: o kit aplica sozinho; à mão, migrations `9810` e `9819` antes da versão. Comentários com mais de 365 dias são apagados.
