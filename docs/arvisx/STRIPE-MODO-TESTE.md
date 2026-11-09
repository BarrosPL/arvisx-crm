# Stripe em modo de teste (sem dinheiro)

Passo a passo para provar a cobrança em euro com a conta de **teste** da Stripe,
antes de pôr a chave de produção. Nenhum pagamento aqui é real.

**Regra:** chave e segredo nunca vão para `.env`, arquivo ou commit. Tudo entra
pela tela `/admin/cobranca`, que guarda cifrado (cerca:
`tests/unit/sem-chave-stripe-no-repositorio.test.ts`).

O que o código já faz sozinho (não há nada para criar à mão na Stripe):

| O quê | Onde no código | Como |
|---|---|---|
| Produto | `lib/cobranca/provedores/stripe.ts` (`garantirProduto`) | Um por plano, id `dc_plano_<id do plano>`, criado no 1º Checkout e renomeado nos seguintes |
| Preço | mesmo arquivo (`precoRecorrente`) | Vai como `price_data` em cada Checkout e em cada troca: na moeda do plano (`eur`), no valor do plano. Preço da Stripe é imutável, então valor novo = preço novo; nenhum id de preço é guardado |
| Webhook | `prepararWebhook`, chamado ao **conectar** | Cria o endpoint `<endereço do CRM>/api/v1/webhooks/cobranca/stripe` com 8 eventos e grava o segredo dele cifrado. Você não copia o segredo |
| Portal de gestão | `urlDeGerenciar` e `POST /api/v1/cobranca/assinatura/gerenciar` | Botão **Gerenciar pagamento** em `/app/settings/billing` (só admin da empresa): cartão, faturas e cancelamento no fim do período. Troca de plano fica na nossa tela |

O aviso da Stripe só acorda o CRM: quem decide o estado é a releitura na API
(`lib/cobranca/sincronizar.ts`), que roda no **worker** (ou no dreno
`/api/v1/cron/event-log-drain`). Sem nenhum dos dois, o estado só muda pelo
botão **Já paguei** ou pelo cron de reconciliação.

---

## 1. Antes de começar

1. **Endereço https público.** A conexão recusa `http://localhost` (a Stripe só
   entrega aviso em https público). Use o ambiente publicado ou, na sua
   máquina, um túnel (`cloudflared tunnel --url http://localhost:3000`, ngrok)
   com `NEXT_PUBLIC_APP_URL` igual ao endereço do túnel, e reinicie o app.
2. **Cifra do servidor** (`AI_CRED_AES_KEY`) configurada. Sem ela a tela recusa guardar a chave.
3. **Módulo Cobrança ligado** em `/admin/sistema`.
4. **App e worker de pé** (`pnpm start` ou `pnpm dev`, e `pnpm worker`).

Sobre o **Stripe CLI** (`stripe listen --forward-to localhost:3000/api/v1/webhooks/cobranca/stripe`):
ele assina com um segredo PRÓPRIO, que não é o que a conexão gravou, então o
CRM responde 401 a tudo que ele repassa (é o comportamento certo; há teste para
isso). Não use o `listen` para este roteiro. O CLI serve para **reenviar** um
evento ao endpoint que a conexão criou: `stripe events resend <id do evento>`.
`stripe trigger` cria clientes que o CRM não conhece: o aviso volta 200 e é
ignorado (`cliente_desconhecido`).

## 2. Criar os planos (`/admin/cobranca` › Planos)

| Plano | Preço | Moeda | Canais | Pessoas | Telas | Oferecido |
|---|---|---|---|---|---|---|
| Essencial | 59,90 | EUR | 3 | 5 | Simplificada | sim |
| Standard | 129,90 | EUR | 6 | 10 | Simplificada + Agente de IA | sim |
| Premium | 199,90 | EUR | vazio | vazio | Completa | sim |
| Teste | 5,00 ou mais (o mínimo; nunca é cobrado) | EUR | vazio | vazio | Completa, 7 dias de teste | **não**, e **padrão no cadastro** |

Preço, moeda e intervalo travam quando o plano tem assinante (aí arquive e crie outro).

## 3. Conectar a chave de teste (`/admin/cobranca` › Conexão)

1. No painel da Stripe, com **Modo de teste** ligado: Desenvolvedores › Chaves
   de API › **Chave secreta** (começa com `sk_test_`). Uma chave restrita
   (`rk_test_`) também serve, com escrita em clientes, produtos, assinaturas,
   faturas, Checkout, portal do cliente e webhooks.
2. Na Conexão: provedor **Stripe**, cole a chave, **Conectar**.
3. Confira: o selo **MODO DE TESTE** (amarelo) aparece ao lado do título e a
   mensagem diz "Conectado em modo de teste: nenhum pagamento é real".
4. Na Stripe, Desenvolvedores › Webhooks: há UM endpoint com o endereço do CRM
   e a descrição "Cobrança do revendedor". Reconectar não duplica.

## 4. Assinar com cartão de teste

1. Crie uma empresa pelo cadastro: ela entra no plano **Teste** (7 dias, sem seletor de plano).
2. Como admin dela, vá a **Configurações › Plano e cobrança** (`/app/settings/billing`),
   escolha o **Essencial** e clique em assinar. Abre o Checkout da Stripe em euro (€ 59,90/mês).
3. Use um destes cartões (qualquer validade futura, qualquer CVC, qualquer nome):

| Cartão | O que acontece |
|---|---|
| `4242 4242 4242 4242` | Aprovado |
| `4000 0000 0000 9995` | Recusado (saldo insuficiente). O Checkout mostra o erro; nada muda no CRM |
| `4000 0025 0000 3155` | Pede 3D Secure: abre a janela de autenticação. **Concluir** aprova; **Falhar** recusa |

**Atenção ao teste grátis.** Com mais de 2 dias de teste sobrando, a Stripe cria
a assinatura **em teste até o fim dos 7 dias**: o cartão fica guardado e nada é
cobrado agora (fatura de € 0). O CRM segue em "teste" até lá. Para ver a
cobrança na hora, assine com uma empresa cujo teste já acabou (ou que esteja
suspensa: a tela de conta suspensa também deixa escolher o plano), ou, no
painel da Stripe, abra a assinatura e encerre o período de teste.

## 5. Conferir que ficou ativa

- **Stripe** (modo teste): Clientes › o cliente com o nome da empresa; Assinaturas
  › ativa, € 59,90, produto `dc_plano_…`. Desenvolvedores › Webhooks › o endpoint
  › entregas com **200**.
- **CRM**: `/app/settings/billing` mostra o plano ativo e o próximo vencimento.
  Se ainda não mudou, clique **Já paguei** (relê na hora) e confira se o worker está de pé.
- **Dono**: `/admin/cobranca` › Visão geral e Clientes mostram a empresa ativa.
- **Telas**: no Essencial, Agente de IA e as demais telas fora do plano mostram
  "isso não está no seu plano".

## 6. Portal de gestão

1. Em `/app/settings/billing`, **Gerenciar pagamento** abre o portal da Stripe (modo teste).
2. Troque o cartão (use outro `4242…`) e veja as faturas.
3. Para simular falha na próxima cobrança, cadastre `4000 0000 0000 0341` (salva,
   mas recusa cobrar). Quando a renovação falhar, o aviso `invoice.payment_failed`
   leva o CRM a "em atraso" e a régua começa.
4. Se o portal responder erro ao abrir, no painel da Stripe (modo teste) abra
   Configurações › Portal do cliente e salve uma vez; depois tente de novo.

## 7. Cancelamento

- **Pelo portal** ("Cancelar plano"): cancela **no fim do período pago**. O CRM
  mostra que a assinatura termina na data; o acesso segue até lá.
- **Pela nossa tela** (Cancelar assinatura em `/app/settings/billing`): o mesmo efeito.
- **Imediato pelo painel da Stripe** (Assinatura › Cancelar › imediatamente): chega
  `customer.subscription.deleted` e o CRM marca a assinatura como cancelada.

## 8. Fim do teste sem pagamento

Empresa no plano Teste que não assina: ao fim dos 7 dias vira "em atraso", recebe
os avisos da régua e é suspensa depois da tolerância (padrão 7 dias,
`/admin/cobranca` › Régua). A tela de conta suspensa mostra os três planos e
deixa assinar; pagar reativa sozinho.

Para não esperar 7 dias, **só numa base de teste**, adiante o fim do teste e
rode o cron de cobrança:

```sql
update public.cobranca_assinaturas
   set trial_ate = now() - interval '1 minute'
 where organization_id = '<id da empresa de teste>';
```

Depois chame o cron de cobrança (o `pnpm dev:crons` não o inclui):

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" <endereço do CRM>/api/v1/cron/cobranca
```

## 9. Passar para produção (só quando tudo acima passou)

Na Conexão, cole a chave de **produção** (`sk_live_`). A tela pede confirmação:
as empresas que assinaram em modo de teste voltam ao teste grátis e assinam de
novo com cartão real. O endpoint do modo de teste é apagado. O selo passa a
**PRODUÇÃO** (verde).
