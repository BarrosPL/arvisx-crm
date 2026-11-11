-- manifest: **Modo fiscal em três estados e planos fora do Managed Payments.** O booleano `COBRANCA_IVA` de `platform_config` vira `COBRANCA_MODO_FISCAL` (`ligado` → `stripe_tax`, o resto → `desligado`; a linha antiga fica), e `cobranca_planos` ganha `fora_do_managed_payments` (default false; nasce true nos planos com `inclui_agentes_arvisx`). Idempotente: rodar de novo não muda nada nem desfaz escolha feita pela tela.
--
-- 9807 — suporte a Stripe Managed Payments na cobrança.
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 a 9806.
--
-- ═══ Por quê ═══
--
-- A conta Stripe passa a vender por Managed Payments: a Stripe é a vendedora
-- oficial e recolhe o IVA. O imposto deixa de ser um liga/desliga ("Cobrar IVA
-- pela Stripe Tax") e passa a ter três modos, escolhidos em Cobrança › Régua:
--   desligado          nenhum imposto no pagamento (o padrão);
--   stripe_tax         nós vendemos; a Stripe Tax soma o IVA (o "ligado" de antes);
--   managed_payments   a Stripe é a vendedora oficial e recolhe o IVA.
-- E nem todo plano pode ser vendido pela Stripe em nome próprio: o que inclui
-- serviço feito por pessoas (desenvolvimento sob medida) é inelegível
-- (docs.stripe.com/payments/managed-payments/eligibility). Esse plano leva a
-- marca `fora_do_managed_payments` e segue em `stripe_tax`.
--
-- ═══ O que muda ═══
--
-- 1. `platform_config`: a linha `COBRANCA_MODO_FISCAL` nasce da `COBRANCA_IVA`
--    quando esta existe: `ligado` → `stripe_tax`; qualquer outro valor →
--    `desligado`. Instalação que nunca gravou o IVA fica sem linha, e sem linha
--    o código lê `desligado` (o padrão das instalações novas).
--    `on conflict do nothing`: a linha nova, uma vez gravada (por esta
--    migration ou pela tela), nunca é sobrescrita — rodar de novo não desfaz
--    a escolha de ninguém. A linha antiga NÃO é apagada: nada do que estava
--    salvo se perde, e `modoFiscal()` (lib/cobranca/configuracao.ts) ainda a lê
--    enquanto a nova não existir.
--
-- 2. `cobranca_planos.fora_do_managed_payments boolean not null default false`.
--    Só no momento em que a coluna é CRIADA, os planos com
--    `inclui_agentes_arvisx` (o Equipe Completa: inclui desenvolvimento sob
--    medida) nascem com `true`. Depois disso a marca é do dono, editável em
--    /admin/cobranca: rodar de novo não remarca o que ele desmarcou.
--
-- ═══ Dados ═══
--
-- Nenhuma linha é apagada. Segura sobre o banco atual. Não cria função.

do $$
begin
  if not exists (
    select 1
      from pg_attribute
     where attrelid = 'public.cobranca_planos'::regclass
       and attname = 'fora_do_managed_payments'
       and not attisdropped
  ) then
    alter table public.cobranca_planos
      add column fora_do_managed_payments boolean not null default false;
    update public.cobranca_planos
       set fora_do_managed_payments = true
     where inclui_agentes_arvisx;
  end if;
end
$$;

comment on column public.cobranca_planos.fora_do_managed_payments is
  'O plano NÃO é vendido por Stripe Managed Payments (inclui serviço sob medida, inelegível): com o modo fiscal managed_payments, ele é cobrado por stripe_tax. Nasce true nos planos com inclui_agentes_arvisx; editável em /admin/cobranca. Migration 9807.';

insert into public.platform_config (chave, valor, eh_segredo, semeado_do_env, updated_by)
select 'COBRANCA_MODO_FISCAL',
       case when c.valor = 'ligado' then 'stripe_tax' else 'desligado' end,
       false,
       false,
       c.updated_by
  from public.platform_config c
 where c.chave = 'COBRANCA_IVA'
   and not c.eh_segredo
on conflict (chave) do nothing;

notify pgrst, 'reload schema';
