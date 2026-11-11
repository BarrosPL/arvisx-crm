# Stripe Managed Payments na cobrança

Como o ArvisX CRM vende por **Stripe Managed Payments** (a Stripe é a vendedora
oficial e recolhe o IVA), o que muda em relação à Stripe Tax e o que ainda
precisa ser provado contra a conta real. Migration 9807.

Docs da Stripe em que isto se apoia (lidas em 11/11/2026):

- <https://docs.stripe.com/payments/managed-payments/update-checkout>
- <https://docs.stripe.com/payments/managed-payments/eligibility>
- <https://docs.stripe.com/payments/managed-payments/how-it-works>

## O modo fiscal (Admin › Cobrança › Régua)

Uma escolha entre três, gravada em `platform_config.COBRANCA_MODO_FISCAL`
(`lib/cobranca/configuracao.ts`, `modoFiscal()`):

| Modo | Quem vende | O que a sessão de Checkout leva |
|---|---|---|
| `desligado` (padrão) | nós | nada de imposto; `managed_payments[enabled]=false` |
| `stripe_tax` | nós | `automatic_tax`, endereço obrigatório, `customer_update`, `tax_id_collection`, `tax_behavior=exclusive`; `managed_payments[enabled]=false` |
| `managed_payments` | a Stripe (Link) | só `managed_payments[enabled]=true` e `tax_behavior=exclusive` |

`managed_payments[enabled]=false` vai explícito nos dois primeiros porque a conta
pode ter o Managed Payments ligado por padrão; sem isso a sessão é recusada com
"the product tax code is missing".

Nos dois modos com imposto o preço do plano é **sem IVA** e as telas mostram
"+ IVA" (`cobraIva()`).

A migration 9807 converte o booleano antigo `COBRANCA_IVA`: `ligado` →
`stripe_tax`, o resto → `desligado`. A linha antiga fica no banco, e
`modoFiscal()` ainda a lê enquanto a nova não existir (imagem nova num banco sem
a 9807 não desliga o IVA de ninguém).

## O que NÃO vai numa sessão de Managed Payments

A Stripe recusa, e o adaptador não envia (`fiscalDoCheckout` em
`lib/cobranca/provedores/stripe.ts`; lista conferida em
`stripe-managed-payments.test.ts`):

- `automatic_tax`, `tax_id_collection`
- `customer_update[name]`, `customer_update[address]`
- `adaptive_pricing`
- `payment_method_types`, `payment_method_configuration`, `excluded_payment_method_types`
- `subscription_data.default_tax_rates`, `subscription_data.invoice_settings`, `invoice_creation`
- `payment_intent_data.statement_descriptor`, `.statement_descriptor_suffix`, `.receipt_email`, `.shipping`
- `shipping_address_collection`, `shipping_options`
- qualquer parâmetro de Connect (`application_fee_*`, `on_behalf_of`, `transfer_data`, `transfer_group`)

## Produtos e código fiscal

Cada plano tem **um** produto na conta, de id fixo `dc_plano_<uuid do plano>`.
`garantirProduto` cria ou atualiza esse produto com
`tax_code=txcd_10103001` (Software as a service, business use). Produto criado
antes do código o recebe na atualização. Nunca é criado um segundo produto.

O produto só nascia na primeira compra do plano, e a Stripe pede produtos com
código elegível para liberar o Managed Payments. Por isso existe o botão
**Sincronizar produtos na Stripe** (Admin › Cobrança › Planos, só para o dono da
instalação; `POST /api/v1/admin/cobranca/planos/sincronizar`):

- cria ou atualiza o produto de todo plano ativo (não arquivado) na conta da
  chave salva, de teste ou real;
- pode ser repetido: a segunda vez só atualiza;
- mostra o resultado por plano: criado, atualizado ou erro (com o código da Stripe).

## Plano fora do Managed Payments

`cobranca_planos.fora_do_managed_payments` (default `false`; editável no
formulário do plano). Plano com a marca é vendido por **`stripe_tax`** mesmo com
o modo em `managed_payments`.

A 9807 marca `true`, uma única vez (na criação da coluna), os planos com
`inclui_agentes_arvisx` — a Equipe Completa: ela inclui desenvolvimento sob
medida, e serviço feito por pessoas não é elegível para Managed Payments.

Consequência: com o modo em `managed_payments` e um plano com a marca à venda, a
conta precisa ter **também** o Stripe Tax ativo (endereço de origem e registro do
IVA); sem ele o Checkout desse plano é recusado.

## Troca de plano

Cada assinatura guarda no metadata da Stripe o modo em que foi vendida
(`modo_fiscal`, gravado no Checkout). O modo de uma assinatura **nunca muda**:

- `trocarPlano` mantém `tax_behavior=exclusive`, não envia `automatic_tax` e não
  toca `default_payment_method` (a Stripe proíbe em assinatura de Managed
  Payments; o cartão troca pelo Portal ou pela Link).
- O ajuste proporcional (sessão avulsa) segue o modo da assinatura que ele
  complementa, não o modo de hoje da instalação.
- Assinatura sem `modo_fiscal` (anterior à 9807) segue o modo de hoje para o plano.

### `troca_exige_novo_checkout`

Assinatura de **Managed Payments** indo para um plano **fora** dele (ex.: Premium
→ Equipe Completa) não é trocada: a Stripe seguiria como vendedora de um plano
inelegível. A troca é recusada com **409 `troca_exige_novo_checkout`**, antes de
cobrar ajuste, expirar link ou gravar qualquer coisa
(`lib/cobranca/troca.ts`; vale para a empresa e para o dono).

Saída: cancelar a assinatura atual e assinar o plano novo quando ela terminar
(um Checkout novo, em `stripe_tax`). Não há conversão automática.

O sentido inverso (assinatura em `stripe_tax` indo para um plano dentro do
Managed Payments) é troca comum: a assinatura continua em `stripe_tax`.

## Mudança feita fora do CRM (Link)

Com Managed Payments o cliente também gerencia a assinatura pelo site da Link.
A Stripe avisa por `customer.subscription.updated` / `.deleted`; o aviso só
acorda a leitura, e `lerSituacao` relê a API:

- cancelada → a empresa fica `cancelada`;
- cancelamento no fim do período → `cancela_no_fim`;
- em atraso → `em_atraso`;
- cancelou e reassinou → a assinatura nova passa a ser a da linha.

**Limite conhecido:** o plano mora só no banco do CRM. Se o preço da assinatura
mudar por fora, o plano do CRM **não** muda sozinho; a divergência é auditada
(`cobranca.preco_divergente`, com os dois valores) para quem administra decidir.

Coberto em `lib/cobranca/mudanca-fora-do-crm.test.ts`.

## Ordem para colocar no ar

1. Aplicar a migration 9807 **antes** da imagem nova (o `init.sh` do deploy
   ArvisX já a lista). Sem a coluna, o checkout e a troca de plano falham ao ler o plano.
2. Subir a imagem.
3. Admin › Cobrança › Planos: conferir a marca "Fora do Managed Payments" (só a
   Equipe Completa) e clicar em **Sincronizar produtos na Stripe**.
4. No painel da Stripe, ativar o Managed Payments (os produtos já existem com o
   código fiscal) e manter o Stripe Tax ativo para a Equipe Completa.
5. Admin › Cobrança › Régua: escolher **Managed Payments** e salvar.
6. Fazer uma compra de teste de cada tipo (ver abaixo).

## O que NÃO foi testado contra a Stripe real

Tudo foi provado com uma Stripe de mentira (testes unitários) e com o banco
(testes de invariante). Falta provar na conta, primeiro em modo de teste:

1. A sessão de assinatura com `managed_payments[enabled]=true` é aceita na versão
   fixada da API (`2026-08-26.dahlia`) com os parâmetros que enviamos
   (`customer`, `client_reference_id`, `subscription_data[metadata]`,
   `subscription_data[trial_end]`, `locale`, `tax_behavior=exclusive` em `price_data`).
2. A sessão avulsa (`mode=payment`) do ajuste proporcional em Managed Payments.
3. `managed_payments[enabled]=false` é aceito em conta com e sem o Managed
   Payments ativo (nos modos `desligado` e `stripe_tax`).
4. O produto com `tax_code=txcd_10103001` libera a ativação do Managed Payments
   no painel, e a chave restrita em uso tem permissão de escrita em Produtos.
5. `POST /subscriptions/{id}` com `price_data` novo (troca de plano) é aceito em
   assinatura de Managed Payments.
6. O `metadata.modo_fiscal` gravado no Checkout chega à assinatura criada por
   uma sessão de Managed Payments.
7. Os webhooks `customer.subscription.updated` / `.deleted` chegam quando o
   cliente cancela ou altera pela Link (em modo de teste as compras não aparecem
   no app da Link; só em modo real).
8. O Portal do cliente continua abrindo e trocando o cartão em assinatura de
   Managed Payments.
9. Preço em euro com o Adaptive Pricing (sempre ligado em Managed Payments): o
   valor que `lerSituacao` lê (`unit_amount` do item) continua sendo o do plano.
10. Boleto e outros meios locais: em Managed Payments a Stripe escolhe os meios;
    não foi conferido quais aparecem para plano em BRL.
