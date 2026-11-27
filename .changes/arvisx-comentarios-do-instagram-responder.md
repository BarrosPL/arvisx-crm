---
impacto: capacidade_nova
secao: adicionado
titulo: Comentários do Instagram podem ser lidos e respondidos pela API e pelo MCP
---

Sistemas externos podem ler e responder comentários da conexão direta do Instagram: rotas `/api/v1/social-comments` e seis ferramentas MCP (listar, ver, responder em público, responder em privado, marcar sem ação, criar contato; ocultar só pela API). Só gerente, administrador ou token de gerente.

O modo da conexão decide: desligado (padrão) recusa, registro só anota, real publica. Cada comentário aceita uma resposta pública e uma privada (até 7 dias, limite da rede). Comentário só vira contato quando alguém pede, e entra na LGPD.

Três colunas novas em `social_comments`: o kit aplica sozinho; à mão, aplique as migrations `9812` e `9816` antes da versão. Contrato em `docs/integracao/comentarios-do-instagram.md`.
