# Comentários do Instagram — receber, guardar, avisar e responder

> **Para quem é:** quem administra a instalação (o passo no painel da Meta), quem
> liga os comentários numa empresa e quem mantém o sistema de fora que recebe o
> aviso `comment.received`.
> **O que cobre:** as duas primeiras das três entregas — o comentário chega, é
> guardado e um sistema externo é avisado (seções 1 a 8); e pode ser lido e
> respondido pela API e pelo MCP (seções 9 a 14). A tela de comentários vem na
> terceira entrega.
> **Fonte da verdade no código:** `lib/channels/meta-social/webhook.ts` (leitura),
> `lib/channels/meta-social/comentarios.ts` (modo, gravação e aviso),
> `lib/channels/meta-social/store.ts` (estado da conexão e troca de modo),
> `lib/comentarios/acoes.ts` (a regra de responder, ocultar, ignorar e criar
> contato), `lib/channels/meta-social/comentarios-resposta.ts` (as chamadas à
> Meta), migrations `9810` e `9812` (tabela `social_comments`).

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
| `instagram_manage_comments` | receber e responder comentários | não |
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
| `registrar` | gravado e avisado. As respostas são validadas e gravadas como simuladas, sem publicar (seção 11) |
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
  responder em privado ou pedir a criação (seção 12).
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
  aparece na listagem da API (seção 10).

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
  não deve ser forçado. Responder não depende disso: o contato é ligado pelo id
  que a Meta devolve na resposta privada (seção 12);
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

---

## 9. Quem pode ler e responder

A regra mora uma vez, em `lib/comentarios/acoes.ts`. As rotas e as ferramentas
do MCP só autenticam e chamam essa regra.

| Quem chama | Como | O que precisa |
|---|---|---|
| Pessoa da equipe | sessão do navegador, nas rotas `/api/v1/social-comments` | papel de **gerente** ou **administrador** |
| Sistema externo | `Authorization: Bearer dsk_...`, nas mesmas rotas ou no MCP (`/api/mcp`) | token **marcado como gerente** (na tela de tokens de API, a opção "Tratar o token como gerente") e o escopo `mcp:read` (ler) ou `mcp:write` (escrever) |

**CONFIRMADO** por teste: um token sem a marca de gerente recebe 403 nas rotas e
nas ferramentas, e o agente que atende conversas dentro do CRM não alcança
nenhuma delas. A organização vem sempre da sessão ou do token, nunca do corpo.

Toda escrita fica na auditoria (`social_comment.respondido`,
`social_comment.respondido_em_privado`, `social_comment.ocultado`,
`social_comment.ignorado`, `social_comment.contato_criado`), com o token ou a
pessoa que agiu e `metadata.simulada`.

## 10. As rotas e as ferramentas

Todas as rotas respondem no envelope padrão (`{ data, meta? }` ou
`{ error: { code, message, details? } }`).

| Rota | O que faz |
|---|---|
| `GET /api/v1/social-comments` | Lista, do mais recente. Filtros: `canal` (id da conexão), `estado`, `desde` (ISO-8601 com fuso), `midia` (id da publicação), `limite` (até 100), `cursor`. `meta.cursor` e `meta.has_more` paginam. |
| `GET /api/v1/social-comments/:id` | Um comentário, com o texto inteiro, as respostas, o estado e `private_reply_deadline`. |
| `POST .../:id/reply` `{ text }` | Responde em público. |
| `POST .../:id/private-reply` `{ text, criar_contato? }` | Responde em privado (mensagem direta a quem comentou). |
| `POST .../:id/hide` | Oculta o comentário na rede. |
| `POST .../:id/ignore` `{ motivo? }` | Marca como sem ação (`estado: "sem_acao"`) e grava o motivo. |
| `POST .../:id/criar-contato` `{ pipeline_id?, stage_id?, title? }` | Cria o contato de quem comentou e, com `pipeline_id`, o negócio. |

`:id` é o `id` do comentário no CRM (o `social_comment_id` do aviso), não o id
da rede.

No MCP: `crm_list_comments`, `crm_get_comment`, `crm_reply_comment`,
`crm_private_reply_comment`, `crm_ignore_comment` e
`crm_create_contact_from_comment`. Não há ferramenta de ocultar. A recusa volta
como dado: `{ permitido: false, motivo, mensagem, detalhes? }`, com `motivo`
igual ao `code` da rota. Nenhuma das seis entra ligada por pacote: as duas de
resposta são capacidades críticas, e as outras quatro são de marcação manual
(aparecem no pacote "Não perder o cliente" para marcar uma a uma, e o
interruptor do pacote não as liga). Motivo: o agente do atendimento nunca
monta essas ferramentas, e ligadas por arrasto elas só ocupariam vagas do
teto de capacidades por agente.

## 11. O que cada resposta garante

**O modo da conexão decide se algo sai** (seção 4):

- `off`: 409 `comentarios_desligados`;
- `registrar`: tudo é conferido e a resposta é gravada com `simulada: true`,
  sem chamar a Meta. Nada entra na caixa de entrada e nenhum contato é criado;
- `real`: a resposta é publicada.

**Uma resposta pública e uma privada por comentário.** A segunda chamada recebe
409 `ja_respondido` (pública) ou `ja_respondido_em_privado` (privada), com a
resposta existente em `details.resposta`.

**Resposta simulada não trava a resposta real.** A resposta gravada em modo
`registrar` não saiu. Enquanto a conexão continua em `registrar`, ela vale como
a resposta do comentário: repetir devolve o 409 acima, com ela, e nada é
regravado. Quando a conexão passa para `real`, a mesma chamada **publica** a
resposta de verdade, que substitui a simulada no comentário; a simulada
continua na auditoria (a entrada dela, e `metadata.substituiu_simulada` na
entrada da resposta real). Se a Meta recusar a resposta real, a simulada volta
para o comentário. Resposta de verdade nunca é substituída: `real` seguido de
`real` continua 409, e a privada continua limitada a 7 dias. Com simulada
gravada e a conexão desligada (ou desconectada), a recusa é a da conexão
(`comentarios_desligados` ou `canal_indisponivel`).

**Erro da Meta não deixa o comentário como respondido.** Se a Meta recusa, a
resposta não é gravada e o estado não muda; a chamada pode ser repetida depois
de corrigir a causa.

**Resposta que pode ter saído não é repetida sozinha.** Quando a Meta não
responde, ou responde com erro de servidor, a publicação pode ter sido feita. A
chamada devolve 502 `resposta_incerta`, e as seguintes devolvem 409
`resposta_incerta` até alguém conferir na rede e repetir com
`confirmar_reenvio: true`. Só o limite de chamadas da Meta é repetido
automaticamente (duas tentativas, com espera), porque ali ela garante que nada
foi feito.

| `code` | HTTP | Quando |
|---|---|---|
| `ja_respondido`, `ja_respondido_em_privado` | 409 | já existe resposta |
| `resposta_em_andamento` | 409 | outra chamada está enviando agora |
| `resposta_incerta` | 502 / 409 | a Meta não confirmou; pode ter saído |
| `comentarios_desligados` | 409 | a conexão está em `off` |
| `canal_indisponivel` | 409 | a conexão foi desconectada ou está sem autorização |
| `janela_de_7_dias` | 422 | passou o prazo da resposta privada |
| `comentario_ao_vivo` | 422 | resposta pública ou ocultação em comentário de transmissão ao vivo |
| `comentario_oculto` | 422 | resposta pública a comentário oculto |
| `escopo_ausente` | 422 | a conexão não tem a permissão de comentários; reautorizar resolve |
| `contato_bloqueado` | 422 | a pessoa pediu para não receber mensagens, ou é contato pessoal |
| `contato_anonimizado` | 409 | o contato do comentário foi anonimizado a pedido do titular |
| `rate_limited` | 429 | a Meta limitou as chamadas e não cedeu |
| `upstream_unavailable` | 502 | a Meta recusou; a frase diz por quê |

**Sem regra de conteúdo.** O CRM exige só que o texto não seja vazio. Link,
preço e tamanho são decisão de quem responde; o limite de tamanho é o da rede.

## 12. A resposta privada, o contato e a conversa

A resposta privada enviada é gravada na conversa do contato pelo mesmo caminho
das mensagens diretas. Quando a pessoa responde, a mensagem dela cai na mesma
conversa, com a janela de 24 horas e o resto do atendimento. A mensagem entra
como saída feita por fora da caixa de entrada, o que pausa o atendimento
automático naquela conversa.

Quem é o contato (**CONFIRMADO** por teste):

1. o contato que já tem a identidade que a Meta devolveu em `recipient_id` (a
   pessoa já tinha escrito por mensagem direta): a resposta é gravada na
   conversa dele, com ou sem `criar_contato`;
2. o contato criado antes por `criar-contato` a partir deste comentário: ele
   ganha essa identidade agora;
3. nenhum dos dois: com `criar_contato: true` nasce contato e conversa; sem,
   a resposta sai e fica registrada só no comentário
   (`sem_conversa: "sem_contato"`).

A identidade do contato é montada com o `recipient_id` da resposta da Meta, e
não com o `from.id` do comentário. O contato criado por `criar-contato` nasce
sem identidade social, pelo mesmo motivo (seção 7, item a confirmar). A única
vez em que o `from.id` é usado como se fosse o id das mensagens é para
**recusar**: se existe um contato bloqueado com essa identidade, a resposta
privada não é enviada.

`criar-contato` é idempotente: chamar de novo devolve o mesmo contato, e outro
comentário do mesmo autor reaproveita o contato. Com `pipeline_id`, o negócio
reaproveita o card aberto do contato naquele funil (a mesma regra da captação
por webhook); sem card aberto, é criado na etapa informada ou na primeira etapa
ativa do funil.

## 13. LGPD

O comentário ligado a um contato (`contact_id`) é dado da pessoa.

- **Anonimização:** quando o contato é anonimizado, o texto do comentário vira
  `(anonimizado)`, o autor e o motivo do ignorar são apagados e o texto das
  duas respostas é redigido. Vale para os comentários ligados ao contato e
  para os outros comentários do mesmo autor naquela organização. A linha fica
  (publicação, hora e estado).
- **Cópia dos dados do titular:** o arquivo entregue traz os mesmos
  comentários, com o texto e o que foi respondido.

## 14. O que a documentação da Meta diz sobre responder

Lido em 20/11/2026.

**CONFIRMADO:**

- Resposta pública: `POST /{ig-comment-id}/replies` com `message`; devolve
  `{ id }`. Só se responde a comentário de primeiro nível (a resposta a uma
  resposta é anexada ao comentário de origem); não se responde a comentário
  oculto nem a comentário de transmissão ao vivo.
  (`developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-comment/replies`)
- Ocultar: `POST /{ig-comment-id}` com `hide=true`; devolve
  `{ success: true }`. Comentário do dono da publicação continua visível;
  comentário de transmissão ao vivo não é suportado.
  (`developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-comment`)
- Resposta privada: `POST /{id da conta do Instagram}/messages` com
  `recipient: { comment_id }` e `message: { text }`; devolve `recipient_id` (o
  id com escopo do Instagram de quem recebeu) e `message_id`. Com login do
  Facebook, vai com o token da página. Limites: 7 dias a partir do comentário;
  em transmissão ao vivo, só durante a transmissão; a conversa só continua se
  a pessoa responder, em até 24 horas da resposta dela.
  (`developers.facebook.com/docs/instagram-platform/private-replies`)
- `from.id` do comentário é descrito como "Instagram-scoped ID" na referência
  do comentário.

**A CONFIRMAR com conta real** (a documentação lida não diz, ou se contradiz):

- se o limite da resposta privada é uma **por comentário** ou uma **por
  pessoa**: a página diz "Only one message can be sent to the commenter". O
  CRM impõe uma por comentário; se a Meta recusar a segunda à mesma pessoa em
  outro comentário, a recusa volta como `upstream_unavailable`;
- se a resposta privada exige também `instagram_manage_messages` com login do
  Facebook (a frase aparece na coluna de outro tipo de login). A conexão já
  pede essa permissão para as mensagens;
- o tamanho máximo do texto da resposta pública e da privada (nenhuma das
  páginas informa). O CRM não corta: quem recusa é a Meta;
- os códigos de erro de cada recusa (prazo vencido, segunda resposta,
  comentário apagado): não são documentados. As frases vêm da tabela geral de
  `lib/channels/meta-social/graph.ts`;
- se o `recipient_id` devolvido é igual ao `from.id` do comentário;
- o endereço da resposta privada: a página documenta o id da conta do
  Instagram, e é o que o CRM usa. As mensagens comuns desta conexão saem pelo
  id da página, que é a forma mais antiga do mesmo endpoint.

Em transmissão ao vivo o CRM não tem como saber se a transmissão ainda está no
ar: a resposta privada é tentada, e a Meta recusa se ela já terminou.
