---
impacto: capacidade_nova
secao: adicionado
titulo: Comentários do Instagram podem ser lidos e respondidos pela API e pelo MCP
---

Os comentários que a conexão direta do Instagram recebe passam a poder ser
lidos e respondidos por um sistema externo. Há rotas novas em
`/api/v1/social-comments` e seis ferramentas no MCP: listar e ver comentário,
responder em público, responder em privado (mensagem direta a quem comentou),
marcar como sem ação e criar contato a partir do comentário. Pela API também dá
para ocultar o comentário.

Quem pode chamar: gerente ou administrador da empresa, pela sessão, ou um
token de API marcado como gerente. Um token comum não alcança essas rotas nem
essas ferramentas.

Nada sai sozinho. O que decide é o modo da conexão: desligado (o padrão)
recusa as respostas; em modo de registro tudo é conferido e a resposta fica
só anotada, sem publicar; em modo real ela é publicada. Cada comentário aceita
uma resposta pública e uma privada; a privada só até 7 dias depois do
comentário, que é o limite da própria rede. Se a rede recusar, o comentário
não fica como respondido; se ela não confirmar, a resposta não é repetida
sozinha. A resposta anotada em modo de registro não impede a resposta de
verdade: depois que a conexão passa para o modo real, o comentário pode ser
respondido, e a anotação anterior fica na auditoria.

A resposta privada enviada fica gravada na conversa do contato, e o que a
pessoa responder cai no atendimento normal. Comentário continua não virando
contato nem negócio por conta própria: só quando alguém pede.

O comentário ligado a um contato entra na anonimização e na cópia dos dados do
titular (LGPD).

Há três colunas novas na tabela `social_comments`. Quem atualiza pelo kit
recebe a mudança sozinho; quem aplica as migrações à mão precisa aplicar a
`9812` e a `9816` antes de subir a versão nova (a `9816` faz a anonimização
alcançar também os comentários de quem já era contato por mensagem direta). A tela de comentários chega na versão
seguinte. O contrato está em `docs/integracao/comentarios-do-instagram.md`.
