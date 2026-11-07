# Instagram e Facebook Messenger direto na Meta

Guia da conexão DIRETA (provider `meta_social`, migration 9800): cada empresa
conecta o Instagram profissional e a página do Facebook sozinha, pelo login do
Facebook, sem o parceiro externo (Zernio). Usa o MESMO app da Meta que a
instalação já cadastra para a API Oficial do WhatsApp.

Código: `lib/channels/meta-social/` (login, webhook, envio, sessões, exclusão),
`app/api/v1/channels/meta-social/` (tela → servidor), `app/api/v1/webhooks/meta-social/`
(webhook e callback de exclusão), `app/auth/meta-social-return/` (volta do login),
`components/connections/ConexaoDiretaMeta.tsx` (cartão em Conexões › Redes sociais),
`app/exclusao-de-dados/` (página pública).

---

## 1. O que o dono configura (uma vez, para a instalação inteira)

### 1.1 No CRM — Administração › API Oficial da Meta

1. **Chave secreta do aplicativo** (App Secret) e **token de verificação**: os
   mesmos do WhatsApp oficial. Se ainda não existem, salve a chave secreta; o
   token é gerado pelo sistema e aparece UMA vez (copie).
2. **App ID** (cartão "Instagram e Facebook Messenger"): só números, fica em
   Configurações do app › Básico. Salve.
3. O mesmo cartão mostra os **endereços para colar na Meta** (com o domínio da
   instalação, `NEXT_PUBLIC_APP_URL`). Em produção:

| Onde, no painel da Meta | Endereço |
|---|---|
| Webhooks › **Page** › URL de callback | `https://crm.arvisx.com.br/api/v1/webhooks/meta-social` |
| Webhooks › **Instagram** › URL de callback | `https://crm.arvisx.com.br/api/v1/webhooks/meta-social` |
| Webhooks › Verificar token (os dois) | o token de verificação do passo 1 |
| Login do Facebook › Configurações › URIs de redirecionamento do OAuth válidos | `https://crm.arvisx.com.br/auth/meta-social-return` |
| Configurações do app › Básico › URL da Política de Privacidade | `https://crm.arvisx.com.br/legal/privacy` |
| Configurações do app › Básico › URL dos Termos de Serviço | `https://crm.arvisx.com.br/legal/terms` |
| Configurações do app › Básico › Exclusão de dados do usuário › URL de callback | `https://crm.arvisx.com.br/api/v1/webhooks/meta-social/exclusao-de-dados` |
| (alternativa aceita pela Meta) URL de instruções de exclusão | `https://crm.arvisx.com.br/exclusao-de-dados` |
| Login do Facebook › Configurações › URL de callback para cancelar autorização | `https://crm.arvisx.com.br/api/v1/webhooks/meta-social/exclusao-de-dados` |

### 1.2 No painel da Meta (developers.facebook.com › o app)

1. **Tipo do app**: Empresa (Business). O app precisa estar ligado a um
   Gerenciador de Negócios verificado para o modo Ao vivo e o App Review.
2. **Produtos** a adicionar: **Login do Facebook** (Facebook Login for
   Business serve), **Messenger** e **Instagram** (a API do Instagram com Login
   do Facebook / "Instagram Messaging" da Messenger Platform) e **Webhooks**.
3. **Webhooks**:
   - Objeto **Page** — URL de callback e token da tabela acima; assine os campos
     `messages`, `message_echoes`, `message_deliveries`, `message_reads`,
     `messaging_postbacks`.
   - Objeto **Instagram** — mesma URL e token; assine `messages`,
     `messaging_postbacks`, `messaging_seen` e, se aparecer, `message_echoes`.
   - A assinatura por PÁGINA (`subscribed_apps`) é feita pelo CRM quando a
     empresa conecta; o dono não faz nada por página.
4. **Login do Facebook**: cole a URI de redirecionamento exata (com `https`,
   sem barra no fim). "Login com o SDK do JavaScript" pode ficar desligado.
5. **Configurações do app › Básico**: ícone, categoria, e-mail de contato,
   domínio do app (`crm.arvisx.com.br`), as três URLs legais da tabela.
6. Recomendado: **Exigir App Secret** ligado (Configurações › Avançado). O CRM
   já manda `appsecret_proof` em toda chamada com token.

### 1.3 Permissões para o App Review (Acesso avançado)

| Permissão | Para quê, no CRM |
|---|---|
| `pages_show_list` | listar as páginas da empresa no "Conectar" |
| `pages_messaging` | receber e responder mensagens do Messenger pela página |
| `pages_manage_metadata` | assinar o app na página (receber os webhooks) |
| `instagram_basic` | ler a conta profissional do Instagram ligada à página |
| `instagram_manage_messages` | receber e responder as mensagens diretas do Instagram |
| `business_management` | ver as páginas que a empresa administra pelo Gerenciador de Negócios |
| (opcional) **Human Agent** | responder até 7 dias depois da última mensagem do cliente; só depois de aprovada, ligar `META_HUMAN_AGENT_TAG=on` no `.env` |

Texto de uso (para cada permissão): "O Arvisx CRM é uma central de atendimento.
A empresa cliente conecta a própria página e o Instagram profissional; as
mensagens que os clientes enviam chegam na caixa de entrada do CRM, onde a
equipe (e, se a empresa ligar, um assistente de IA) responde. Usamos [permissão]
para [o que a tabela diz]. Nenhum dado é usado para anúncios nem vendido."

### 1.4 Roteiro do vídeo do App Review (um vídeo, ~3 min, tela inteira)

1. Abrir `https://crm.arvisx.com.br/login`, entrar com uma conta de teste
   (admin de uma empresa).
2. Conexões › Redes sociais › **Conectar Instagram / Facebook**.
3. Mostrar o diálogo da Meta com as permissões, aceitar, escolher a página.
4. De volta ao CRM: escolher a página, marcar Messenger e Instagram, **Conectar**.
   Mostrar o cartão "Recebendo".
5. Em outro aparelho (conta de testador), mandar uma mensagem para a página no
   Messenger e uma DM para o Instagram. Mostrar as duas chegando na Caixa de
   entrada do CRM, com o nome da pessoa.
6. Responder pelas duas conversas; mostrar a resposta chegando no Messenger e
   no Instagram do testador. Mandar uma imagem também.
7. Desconectar a conta no CRM (mostrar o aviso) e abrir
   `https://crm.arvisx.com.br/exclusao-de-dados`.

---

## 2. Testar em modo desenvolvimento (antes do App Review)

Em **modo Desenvolvimento** a Meta só entrega e só deixa responder para pessoas
com papel no app.

1. Funções do app › **Testadores**: adicione as contas do Facebook que vão
   conectar páginas e as que vão mandar mensagem (elas aceitam o convite em
   developers.facebook.com › Solicitações).
2. A página do Facebook de teste precisa ser administrada por um desses
   testadores, e o Instagram de teste tem de ser **profissional** (Empresa ou
   Criador) e **ligado a essa página** (Instagram › Configurações › Conta ›
   Página do Facebook). No Instagram, ligue "Permitir acesso às mensagens"
   (Configurações › Privacidade › Mensagens › Ferramentas conectadas).
3. No CRM, como admin da empresa: Conexões › Redes sociais › Conectar.
4. Mande mensagem de outro testador para a página e para o Instagram. Deve
   aparecer na Caixa de entrada em segundos. O webhook responde
   `{"received":N,"outcomes":[…]}` — `conta_desconhecida` quer dizer que a
   página não está conectada em nenhuma empresa; `eco_do_proprio_envio` é o
   retorno de uma resposta enviada pelo próprio CRM (ignorado de propósito).
5. Botão "Testar" do painel de Webhooks da Meta manda um evento de exemplo com
   ids falsos: a resposta é 200 com `conta_desconhecida` — isso prova que a URL
   e a assinatura estão certas.

---

## 3. O passo a passo da empresa (cliente), na tela

1. Conexões › **Redes sociais**. No topo, o cartão **Instagram e Facebook
   Messenger** (Recomendado).
2. **Conectar Instagram / Facebook** → abre o Facebook. Entre com a conta que
   administra a página e **mantenha todas as permissões marcadas**.
3. De volta ao CRM, escolha a **página**. Se ela tem um Instagram profissional
   ligado, ele aparece embaixo; marque **Facebook Messenger** e/ou **Instagram**
   e clique **Conectar**.
4. Cada rede vira uma conexão com "Recebendo". A IA começa **pausada** em toda
   conexão nova (como os outros canais): ligue em "Acesso da IA" quando quiser.
5. Responder: a Meta só aceita resposta para quem escreveu nas **últimas 24
   horas**; fora disso a conversa mostra a janela fechada.
6. **Desconectar** apaga a autorização da Meta do CRM e para a entrada; as
   conversas ficam. Para voltar, é só conectar de novo.

Erros que a tela explica: app da Meta não configurado (pede ao administrador da
instalação), permissão negada (conectar de novo e aceitar tudo), página sem
Instagram ligado, conta já conectada em outra empresa, limite de canais do plano.

---

## 4. Deploy (Hermes, Easypanel)

1. Redeploy do serviço `crm` com a imagem do commit. O `init.sh` aplica sozinho
   a migração `20261107190000_9800_conexao_direta_instagram_messenger.sql`
   (está em `deploy/arvisx/crm/migracoes-pos-baseline.txt`), com `pg_dump` antes.
2. Conferir: `/` 200, `/app` 307, `/exclusao-de-dados` 200,
   `GET /api/v1/webhooks/meta-social?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1` → 403.
3. Opcional: `META_APP_ID` no `.env` só como reserva (a tela vence).
   `META_HUMAN_AGENT_TAG=on` só depois da aprovação do Human Agent.

---

## 5. O que fica com o parceiro (Zernio) e como removê-lo depois

Nada foi removido: as conexões por parceiro existentes continuam funcionando, e
a seção "Conexão por parceiro (opcional)" segue abaixo do cartão direto. Para
tirar o Zernio de vez:

1. Migrar cada empresa: desconectar a conta no parceiro e conectar pela direta
   (o contato do Instagram/Messenger nasce de novo, porque a identidade social
   inclui a conta — `instagram:<conta>:<id>` — e o id da conta no parceiro é
   outro; as conversas antigas ficam no histórico).
2. Quando não houver sessão `zernio_social` ativa
   (`select count(*) from channel_sessions where provider='zernio_social' and archived_at is null`),
   esconder a seção do parceiro em `RedesSociaisClient.tsx` e a ação `authorize`
   de `app/api/v1/channels/social/route.ts`.
3. Em `lib/channels/social/catalog.ts`, tirar `"intermediada"` das portas do
   Instagram e do Facebook (as outras 13 redes só existem por ela — decidir se
   ficam).
4. O provider `zernio_social` NÃO sai do CHECK nem do código enquanto houver
   linha arquivada com ele (histórico das conversas aponta para a sessão).
   O WhatsApp por parceiro (`zernio`, "um clique") é outra frente.

---

## 6. Evidência visual (07/11/2026)

Sem Meta real: o cartão foi renderizado com a API dublada no navegador (página
de prova temporária, não versionada) e a página pública direto do `next dev`.
Sem estouro de largura em 1440 nem em 390 (`scrollWidth` = largura).

- App da Meta não configurado na instalação (botão desligado, a quem pedir):
  `evidence/meta-instagram-messenger/cartao-app-nao-configurado-1440.png`,
  `evidence/meta-instagram-messenger/cartao-app-nao-configurado-390.png`
- Pronto, com Instagram e Messenger conectados:
  `evidence/meta-instagram-messenger/cartao-pronto-com-conexoes-1440.png`,
  `evidence/meta-instagram-messenger/cartao-pronto-com-conexoes-390.png`
- Volta do login, escolha da página e das redes:
  `evidence/meta-instagram-messenger/cartao-escolha-da-pagina-1440.png`,
  `evidence/meta-instagram-messenger/cartao-escolha-da-pagina-390.png`
- Página pública de exclusão de dados:
  `evidence/meta-instagram-messenger/exclusao-de-dados-1440.png`,
  `evidence/meta-instagram-messenger/exclusao-de-dados-390.png`
- Status do pedido de exclusão (código de confirmação assinado):
  `evidence/meta-instagram-messenger/exclusao-de-dados-status-1440.png`,
  `evidence/meta-instagram-messenger/exclusao-de-dados-status-390.png`
