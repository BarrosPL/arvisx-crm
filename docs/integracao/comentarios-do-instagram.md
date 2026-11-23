# Comentários do Instagram — receber, guardar e avisar

> **Para quem é:** quem administra a instalação (o passo no painel da Meta), quem
> liga os comentários numa empresa e quem mantém o sistema de fora que recebe o
> aviso `comment.received`.
> **O que cobre:** a primeira das três entregas — o comentário chega, é
> guardado e um sistema externo é avisado. Responder (em público e em privado)
> e a tela de comentários vêm nas entregas seguintes.
> **Fonte da verdade no código:** `lib/channels/meta-social/webhook.ts` (leitura),
> `lib/channels/meta-social/comentarios.ts` (modo, gravação e aviso),
> `lib/channels/meta-social/store.ts` (estado da conexão e troca de modo),
> migration `9810` (tabela `social_comments`).

Legenda: **CONFIRMADO** = provado por código ou pela documentação da Meta lida
em 20/11/2026; **A CONFIRMAR** = depende de teste com conta real.

---

## 1. O que muda para quem já usa a conexão direta

Nada, até alguém ligar. **CONFIRMADO** por teste:

- toda conexão do Instagram nasce (e as que já existem ficam) com os
  comentários **desligados**: o comentário que chega é descartado, sem gravar;
- conexão feita antes desta versão continua recebendo e respondendo mensagens
  sem reautorizar;
- o login normal **não pede** as duas permissões novas. O login é em duas
  fases: conectar (ou reconectar) pede só as permissões de mensagem, as mesmas
  de antes; as de comentários só são pedidas num login próprio, o de
  **reautorização para comentários** (seção 3). Assim, se a Meta ainda não
  liberou as permissões de comentários para o app, o login de quem só usa
  mensagens não é recusado ("Invalid Scopes");
- as duas permissões continuam **não obrigatórias**: quem não as concede na
  reautorização segue conectado e atendendo mensagens; só os comentários
  ficam indisponíveis.

## 2. O passo manual no painel da Meta (uma vez, para a instalação inteira)

Quem faz: o dono do app da Meta da instalação
(developers.facebook.com › o app).

1. **Webhooks › objeto Instagram › assinar os campos `comments` e
   `live_comments`.** A URL de callback e o token de verificação são os mesmos
   que o objeto Instagram já usa para as mensagens
   (`https://<domínio>/api/v1/webhooks/meta-social`). Não assine `mentions`:
   não é lido.
2. **Nada muda na assinatura por página.** O CRM assina o app em cada página
   ao conectar (`subscribed_apps`, com os campos de mensagem), e isso já
   satisfaz a Meta. **CONFIRMADO** na documentação: os campos do objeto
   Instagram são escolhidos no painel do app e valem para todas as contas — não
   há escolha de campo por conta —, e o `subscribed_apps` da página não recebe
   campos do Instagram. Por isso `CAMPOS_DA_ASSINATURA` não mudou.
3. **App Review:** pedir **Acesso avançado** para `instagram_manage_comments`
   e `pages_read_engagement` (as outras três que o campo `comments` exige —
   `instagram_basic`, `pages_manage_metadata`, `pages_show_list` — a conexão já
   pede).

### Acesso padrão × avançado

**CONFIRMADO** na documentação da Meta:

- o app precisa estar **publicado (Ao vivo)** para receber notificação de
  usuário do app;
- com login do Facebook, `comments` e `live_comments` exigem **Acesso
  avançado**. Com acesso padrão, só chegam dados de quem tem papel no app
  (administrador, desenvolvedor, testador);
- a **conta que publicou precisa ser pública**: conta privada não gera
  notificação de comentário;
- em transmissão ao vivo, as notificações param quando a transmissão termina;
- a notificação não traz o id do álbum (carrossel), e não traz o id do anúncio
  quando a mídia é de anúncio dinâmico.

## 3. As permissões

| Permissão | Para quê | Obrigatória para conectar? |
|---|---|---|
| `instagram_manage_comments` | receber e (nas próximas entregas) responder comentários | não |
| `pages_read_engagement` | exigida pela Meta para o campo `comments` com login do Facebook | não |

A conexão guarda, a cada login, quais permissões a pessoa concedeu
(`metadata.meta_escopos_concedidos`). `GET /api/v1/channels/meta-social`
devolve, em cada conexão do Instagram:

```json
"comentarios": { "modo": "off", "escopo_concedido": false, "disponivel": false }
```

- `escopo_concedido`: a conexão tem as duas permissões. `false` para conexão
  feita antes desta versão e para toda conexão feita pelo login normal — para
  liberar, a pessoa faz a **reautorização para comentários**;
- `disponivel`: é do Instagram **e** tem as permissões.

### O login em duas fases

O login normal (`POST /api/v1/channels/meta-social` com `{ "acao": "iniciar" }`)
pede só as permissões de mensagem. A reautorização para comentários é um login
próprio, o único que pede `instagram_manage_comments` e `pages_read_engagement`:

```json
{ "acao": "iniciar", "para_comentarios": true }
```

A volta é a mesma do login normal (`concluir`, depois `conectar` na mesma
página). Os dois logins usam `auth_type=rerequest`, então quem negou uma
permissão antes é perguntado de novo. O que fica gravado na conexão é tudo o
que a pessoa já concedeu ao app (a Meta devolve o conjunto inteiro), então
reconectar depois pelo login normal não tira as de comentários. Enquanto não
há tela, a reautorização é feita por esta chamada; o botão "Reautorizar para
comentários" vem com a tela e faz exatamente ela.

Decisão registrada (revisão de 20/11/2026, item 2.20): enquanto o dono do
produto não disser o contrário, vale o login em duas fases.

## 4. O modo por conexão

| Modo | O que acontece com o comentário que chega |
|---|---|
| `off` (padrão) | descartado: a Meta recebe 200, nada é gravado, ninguém é avisado |
| `registrar` | gravado e avisado. As respostas (próxima entrega) são validadas e gravadas como simuladas, sem publicar |
| `real` | gravado e avisado. As respostas são publicadas de verdade |

Mudar o modo (**CONFIRMADO**: só administrador da empresa, com registro na
auditoria — ação `channel.comentarios_modo_alterado`, com o modo de antes e o
de depois):

```
POST /api/v1/channels/meta-social
{ "acao": "comentarios_modo", "channel_session_id": "<id da conexão>", "modo": "registrar" }
```

Conectar de novo ou reautorizar **não muda o modo**. Enquanto não há tela, a
troca é por esta chamada; a tela vem na terceira entrega.

## 5. O que é guardado

Tabela `social_comments`, uma linha por comentário, única por
`(organization_id, comment_id)`. Guarda o canal, a publicação
(`media_id`, `media_product_type`), o anúncio (`ad_id`, `ad_title`), o autor
(`author_id`, `author_username`), o texto inteiro, a hora e o estado.

- **Quem lê.** Só o servidor grava. Pela sessão de uma pessoa (a REST do
  banco), só **gerente para cima** lê: é o mesmo papel que as rotas e as
  ferramentas de comentários pedem (migration `9819`). Atendente e leitor não
  leem comentário pelo banco.

- **Não vira contato nem negócio.** Contato nasce quando alguém decide
  responder em privado ou pedir a criação (próxima entrega).
- **Comentário da própria conta é ignorado** — inclusive as respostas que o
  CRM publicar, que a Meta devolve como comentário. Sem isso o agente
  responderia a si mesmo.
  São três conferências, e qualquer uma basta: (a) `from.id` é a conta
  (`entry.id`); (b) `from.username` é o nome de usuário da conta conectada
  (gravado em `metadata.instagram_username` ao conectar; em conexão antiga,
  lido do nome do canal `instagram · @usuario`), para o caso de `from.id` vir
  ausente ou em outro espaço de ids; (c) o id do comentário é o de uma
  resposta pública que o CRM gravou (`public_reply.id` de outro comentário da
  mesma empresa). A (c) só pega a resposta que já estava gravada quando a
  notificação chegou; por isso não substitui as outras.
- **Repetição é absorvida.** A Meta reentrega o que não recebe 2xx e pode
  notificar mais de uma vez o mesmo comentário em anúncio; o segundo é
  recusado pela chave única.
- **Hora:** a notificação não traz a hora do comentário, só a hora em que a
  Meta a enviou (`entry.time`). É ela que fica em `commented_at`.
- **Guarda por 365 dias.** Comentário mais antigo que isso é apagado pela
  rotina `webhook-log-retention`, em lotes.

O que a resposta do webhook diz de cada comentário (`outcomes`):
`comentario_registrado`, `comentarios_desligados`, `comentario_proprio`,
`comentario_repetido`, `conta_desconhecida`, `falhou`.

## 6. O aviso `comment.received`

Sai pelo mesmo mecanismo dos outros gatilhos: crie uma automação com o gatilho
**"Quando chegar um comentário no Instagram"** e a ação **"Avisar outro
sistema (webhook)"**. Cabeçalhos, assinatura, retentativa e deduplicação são os
de [`webhooks-de-saida.md`](webhooks-de-saida.md). O `data` do corpo:

```json
{
  "comment_id": "17865799348089039",
  "social_comment_id": "55555555-5555-4555-8555-555555555555",
  "parent_comment_id": null,
  "media_id": "17900000000000123",
  "media_product_type": "REELS",
  "ad_id": null,
  "ad_title": null,
  "ao_vivo": false,
  "author": { "id": "232323232", "username": "cliente.exemplo" },
  "text": "o texto inteiro do comentário, sem corte",
  "commented_at": "2026-11-20T12:00:00.000Z",
  "channel_session_id": "44444444-4444-4444-8444-444444444444",
  "canal": { "id": "44444444-4444-4444-8444-444444444444", "rede": "instagram", "conta": "17840000000000001", "nome": "instagram · @loja" },
  "modo": "registrar"
}
```

- `comment_id` é o id na rede; `social_comment_id` é o id da linha no CRM.
- `text` vai **inteiro**. (O aviso de mensagem corta em 280 caracteres; aqui
  não há corte.)
- `modo` diz se uma resposta seria publicada (`real`) ou só registrada
  (`registrar`).
- A regra pode filtrar pelo texto (`event.text`) e pela publicação
  (`event.media_id`).
- O aviso é melhor esforço: se ele falhar, o comentário continua gravado e
  aparece na listagem da API (próxima entrega).

## 7. O que a documentação da Meta diz do payload — e onde ela se contradiz

**CONFIRMADO** (lido em 20/11/2026, Graph API v27.0):

- Envelope, login do Facebook: `object: "instagram"`, `entry[].id` = a conta
  profissional do Instagram, `entry[].time`, `entry[].changes[]` com `field`
  (`comments` ou `live_comments`) e `value`.
- A **referência do campo**
  (`developers.facebook.com/docs/graph-api/webhooks/reference/instagram/`) lista
  em `value`: `id`, `from { id, username, self_ig_scoped_id }`,
  `media { id, media_product_type }`, `parent_id`, `text`, `ad_id`, `ad_title`,
  `original_media_id`.
- A **página de exemplos**
  (`developers.facebook.com/documentation/instagram-platform/webhooks/examples`)
  mostra o mesmo comentário com `value.comment_id` no lugar de `value.id`, e
  `ad_id`/`ad_title`/`original_media_id` **dentro** de `value.media`.
- No login direto do Instagram o envelope não tem `changes`: `field` e `value`
  ficam na própria entrada.
- Comentário feito pela própria conta: `from.id` é igual a `entry.id`
  (`developers.facebook.com/documentation/instagram-platform/self-messaging`).

O leitor aceita as duas formas e o envelope sem `changes`, em vez de apostar
numa.

**A CONFIRMAR com conta real:**

- se `from.id` do comentário é o mesmo identificador (IGSID) que a pessoa tem
  nas mensagens diretas. Se for, o contato criado a partir do comentário será o
  mesmo que escreve depois; se não for, são identidades distintas e o vínculo
  não deve ser forçado. Nada nesta entrega depende disso;
- se a Meta notifica duas vezes o comentário em anúncio (a documentação lida
  não menciona; a chave única absorve nos dois casos).

## 8. Como testar sem publicar nada

1. Faça o passo 2 no painel da Meta.
2. Faça a reautorização para comentários (`iniciar` com
   `para_comentarios: true`), aceitando todas as permissões, conecte a mesma
   página e confira `comentarios.disponivel: true` no `GET`.
3. Ponha a conexão em `registrar`.
4. Com outra conta (testador do app, enquanto o acesso for padrão), comente
   numa publicação. O webhook responde `comentario_registrado`; a linha aparece
   em `social_comments`; a automação entrega o aviso.
5. Comente de novo com a conta da empresa: `comentario_proprio`, nada gravado.
