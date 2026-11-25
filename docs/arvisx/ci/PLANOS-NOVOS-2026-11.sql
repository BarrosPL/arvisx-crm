-- PLANOS NOVOS (Tarefa 8, parte 2) — script para o Lucas rodar À MÃO.
--
-- NÃO é migration e não entra no baseline: mexe em dado de produção desta
-- instalação (a tabela de planos que a ArvisX vende), e não em schema.
--
-- O que faz: cria os três planos novos em EUR. Só isso.
-- O que NÃO faz: não altera, não arquiva e não oculta nenhum plano que já
-- existe; não toca em `cobranca_assinaturas` (a assinatura de ninguém muda);
-- não muda o plano padrão do cadastro (`padrao_no_cadastro` fica onde está).
--
-- Idempotente: cada plano tem id fixo e entra com `on conflict (id) do nothing`.
-- Rodar de novo não duplica e NÃO sobrescreve o que foi editado depois na tela
-- de /admin/cobranca. Para corrigir um valor de um plano já criado, edite na
-- tela (ou com um UPDATE próprio); rodar este arquivo de novo não corrige.
--
-- ⚠️ TRÊS ESCOLHAS DESTE ARQUIVO QUE O LUCAS PRECISA CONFIRMAR ANTES DE RODAR:
--
--   1. NOMES. A tarefa chama os planos de 1, 2 e 3 e não dá nome comercial. Os
--      nomes abaixo ("Plano 1", "Plano 2", "Plano 3") são PROVISÓRIOS: troque
--      aqui antes de rodar, ou depois na tela.
--   2. `oferecido_ao_cliente = false`. Os planos nascem FORA da vitrine (página
--      inicial e tela de troca de plano), porque a vitrine lê o banco e mostraria
--      na hora três cards com nome provisório, sem texto, ao lado dos antigos.
--      Para publicar, rode o bloco "PUBLICAR", no fim deste arquivo.
--   3. DIAS DE TESTE GRÁTIS. Copiados do plano que hoje é o padrão do cadastro;
--      sem plano padrão, 14 (o padrão da coluna).
--
-- O que cada coluna recebe:
--   preco_cents / moeda      129,90 · 199,90 · 249,90 em EUR
--   max_canais               3 · 6 · 12
--   max_assentos             5 · 10 · 25
--   teto_ia_usd_cents        1200 · 3200 · 6000  (US$ 12 · 32 · 60 por ciclo)
--   franquia_conversas_ia    300 · 800 · 1500    (bloco próprio, mais abaixo)
--   interface_settings       {"preset":"completa"} = todas as telas, inclusive
--                            a Equipe pronta (lib/cobranca/telas-do-plano.ts)
--   textos da vitrine        nulos: escreva em /admin/cobranca antes de publicar
--
-- Como rodar:  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f docs/arvisx/ci/PLANOS-NOVOS-2026-11.sql
-- Sem BEGIN/COMMIT: cada comando é atômico e o arquivo pode ser reaplicado.

insert into public.cobranca_planos
  (id, nome, preco_cents, moeda, intervalo, trial_dias,
   max_canais, max_assentos, teto_ia_usd_cents,
   padrao_no_cadastro, oferecido_ao_cliente, interface_settings)
select v.id, v.nome, v.preco_cents, 'EUR', 'mes',
       coalesce((select p.trial_dias from public.cobranca_planos p
                  where p.padrao_no_cadastro and p.arquivado_em is null), 14),
       v.max_canais, v.max_assentos, v.teto_ia_usd_cents,
       false, false, '{"preset":"completa"}'::jsonb
  from (values
    ('a7150008-0000-4000-8000-000000000001'::uuid, 'Plano 1', 12990::bigint,  3,  5, 1200),
    ('a7150008-0000-4000-8000-000000000002'::uuid, 'Plano 2', 19990::bigint,  6, 10, 3200),
    ('a7150008-0000-4000-8000-000000000003'::uuid, 'Plano 3', 24990::bigint, 12, 25, 6000)
  ) as v (id, nome, preco_cents, max_canais, max_assentos, teto_ia_usd_cents)
on conflict (id) do nothing;

-- ── FRANQUIA DE CONVERSAS COM IA (coluna da migration 9825) ──────────────────
-- 300 · 800 · 1.500 conversas com IA por ciclo. A coluna
-- `cobranca_planos.franquia_conversas_ia` nasce na migration 9825 (Tarefa 8,
-- parte 1), que chega ao banco pelo deploy (`update.sh` reaplica o baseline).
--
-- RODE ESTE ARQUIVO DEPOIS DO DEPLOY. Num banco que ainda não recebeu a 9825 o
-- bloco não falha: avisa que a franquia NÃO foi gravada e segue; é só rodar o
-- arquivo de novo depois. Só preenche plano com a franquia ainda vazia: não
-- sobrescreve valor que já foi posto.
--
-- ⚠️ SEM A FRANQUIA GRAVADA o plano fica só com o teto em dólar: a IA funciona,
-- mas a tela mostra as conversas como "sem limite". Confira no SELECT do fim.
do $franquia$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'cobranca_planos'
       and column_name = 'franquia_conversas_ia'
  ) then
    raise notice 'franquia NÃO gravada: a coluna ainda não existe (migration 9825). Rode este arquivo de novo depois do deploy.';
    return;
  end if;
  execute $sql$
    update public.cobranca_planos p
       set franquia_conversas_ia = v.franquia
      from (values
        ('a7150008-0000-4000-8000-000000000001'::uuid, 300),
        ('a7150008-0000-4000-8000-000000000002'::uuid, 800),
        ('a7150008-0000-4000-8000-000000000003'::uuid, 1500)
      ) as v (id, franquia)
     where p.id = v.id and p.franquia_conversas_ia is null
  $sql$;
end
$franquia$;

-- ── CONFERIR ─────────────────────────────────────────────────────────────────
-- `to_jsonb(p) ->> …` em vez do nome da coluna: o SELECT também roda num banco
-- que ainda não tem a coluna, e aí a franquia sai vazia em vez de dar erro.
select nome, preco_cents, moeda, max_canais, max_assentos, teto_ia_usd_cents,
       to_jsonb(p) ->> 'franquia_conversas_ia' as franquia_conversas_ia,
       oferecido_ao_cliente, interface_settings
  from public.cobranca_planos p
 where id in ('a7150008-0000-4000-8000-000000000001',
              'a7150008-0000-4000-8000-000000000002',
              'a7150008-0000-4000-8000-000000000003')
 order by preco_cents;

-- ── PUBLICAR (rode À PARTE, depois de pôr nome e textos) ─────────────────────
-- Põe os três planos novos na vitrine. Os antigos continuam oferecidos até
-- alguém os ocultar na tela (ou com `oferecido_ao_cliente = false`), e quem já
-- assina um plano antigo continua nele do mesmo jeito.
--
-- update public.cobranca_planos set oferecido_ao_cliente = true
--  where id in ('a7150008-0000-4000-8000-000000000001',
--               'a7150008-0000-4000-8000-000000000002',
--               'a7150008-0000-4000-8000-000000000003');
