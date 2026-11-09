-- manifest: **Plano de cobrança em euro.** O CHECK de `cobranca_planos.moeda` passa de só `BRL` para `BRL` ou `EUR` (sem tirar o real): a Stripe cobra o plano na moeda dele; o Asaas segue só em real e recusa plano em euro no código (`provedorCobraEm`).
--
-- 9801 — cobranca_planos.moeda aceita EUR.
--
-- Número da faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800: o
-- upstream aloca a 92xx em rodadas, e uma migration só do fork no meio dela
-- colidiria no próximo merge.
--
-- ═══ O que muda ═══
--
-- A 0583 criou a coluna com `check (moeda = any (array['BRL']))`, porque o
-- boleto da Stripe e o Asaas só cobram em real. Os planos novos da instalação
-- ArvisX são vendidos em euro, só pela Stripe (decisão do dono, 09/11/2026).
-- O CHECK alarga para `BRL` ou `EUR`; nenhuma linha muda de valor (toda linha
-- existente é BRL, que segue valendo) e o default continua `BRL`.
--
-- O par TypeScript é `MOEDAS` em lib/cobranca/vocabulario.ts, vigiado por
-- tests/invariants/vocabulario-banco-x-typescript.test.ts. Quem decide QUAL
-- provedor cobra em qual moeda é o código (`provedorCobraEm`): o Asaas não tem
-- moeda, e plano em euro é recusado nele com erro claro, antes de criar
-- qualquer coisa no provedor.
--
-- `preco_cents >= 500` NÃO muda: vale para as duas moedas (R$ 5,00 / € 5,00),
-- acima do mínimo da Stripe em euro (€ 0,50).
--
-- Idempotente: drop if exists + add, com o nome que o Postgres deu ao CHECK
-- inline da 0583 (`cobranca_planos_moeda_check`).

alter table public.cobranca_planos
  drop constraint if exists cobranca_planos_moeda_check;

alter table public.cobranca_planos
  add constraint cobranca_planos_moeda_check
  check (moeda = any (array['BRL'::text, 'EUR'::text]));

comment on column public.cobranca_planos.moeda is
  'Moeda do plano, ISO-4217: BRL ou EUR (migration 9801). A Stripe cobra na moeda do plano; o Asaas só em BRL (lib/cobranca/vocabulario.ts, provedorCobraEm). Trava junto do preço e do intervalo quando o plano tem assinantes.';

comment on table public.cobranca_planos is
  'Planos que o dono da instalação vende às empresas dela (migration 0583). Da INSTALAÇÃO, sem organization_id: RLS ligada sem policy, só o service_role. Limite nulo = sem limite. preco_cents >= 500 (mínimo de boleto); moeda BRL ou EUR (migration 9801); teto_ia_usd_cents na moeda de fn_gasto_de_ia_do_mes.';
