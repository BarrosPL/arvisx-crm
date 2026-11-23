---
impacto: capacidade_nova
secao: adicionado
titulo: Comentários do Instagram chegam ao CRM e avisam um sistema externo
---

A conexão direta do Instagram passa a poder receber os comentários feitos nas
publicações da empresa. Cada comentário é guardado (texto inteiro, autor,
publicação e, quando houver, o anúncio) e dispara o gatilho novo de automação
"Quando chegar um comentário no Instagram", que pode avisar outro sistema pela
ação de webhook, com o comentário completo no corpo.

Nada muda sozinho: os comentários nascem desligados em toda conexão, as que já
existem inclusive, e as conexões atuais continuam recebendo e respondendo
mensagens sem reautorizar. Para usar, o administrador da empresa liga o modo da
conexão (registrar ou real). Comentário não vira contato nem negócio; o que a
própria conta escreve é ignorado; a mesma notificação repetida não duplica.

O login da conexão continua pedindo só as permissões de mensagem. As duas
permissões de comentários são pedidas num login separado, o de reautorização
para comentários, para que o login de quem só usa mensagens não seja recusado
enquanto a Meta não liberar essas permissões para o app.

Nesta versão entra o recebimento. Responder ao comentário (em público e em
privado) e a tela de comentários chegam nas versões seguintes; até lá a troca
de modo é feita pela API.

Quem administra a instalação precisa, uma vez, assinar os campos `comments` e
`live_comments` do objeto Instagram no painel do app da Meta e pedir acesso
avançado às permissões `instagram_manage_comments` e `pages_read_engagement`.
O passo a passo está em `docs/integracao/comentarios-do-instagram.md`. Sem
isso nada quebra: os comentários só não chegam.

Há uma tabela nova no banco (`social_comments`). Quem atualiza pelo kit recebe
a mudança sozinho; quem aplica as migrações à mão precisa aplicar a `9810` e
a `9819` antes de subir a versão nova (a `9819` deixa a leitura dos
comentários pelo banco só para gerente e administrador). Comentários com mais de 365 dias são apagados
pela rotina de retenção que já roda.
