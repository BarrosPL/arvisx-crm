-- VIX: LIMITE DE MENSAGENS POR PLANO E MARCA "SEM LIMITE" (Tarefa 7)
-- Script para o Lucas rodar À MÃO, depois do deploy.
--
-- NÃO é migration e não entra no baseline: é dado de produção desta instalação.
-- A migration 9830 cria as tabelas VAZIAS de propósito: nenhum limite e nenhuma
-- marca vêm semeados, e NENHUM número ou nome de empresa está escrito no código.
--
-- ⚠️ NADA AQUI LIGA O ASSISTENTE. O Vix continua desligado até a chave
-- `VIX_PAGADOR` ser trocada em Painel › Configuração. Este arquivo só diz QUEM
-- tem direito a ele quando for ligado.
--
-- Quem tem o Vix (as duas portas, e só elas):
--   1. a organização assina um plano que tem linha em `assistente_planos`
--      (com a cobrança ligada): responde, com o limite daquele plano;
--   2. a organização tem a marca `sem_limite`: responde, sem limite de mensagens.
-- Sem as duas, o Vix não responde para aquela organização. Organização isenta
-- (sem assinatura) NÃO ganha o Vix sozinha: só pela marca.
--
-- O limite é de MENSAGENS por mês de calendário, em UTC (vira no dia 1 às
-- 00:00 UTC, 21:00 do dia anterior em Brasília). Conta a mensagem que chegou ao
-- modelo. Ao atingir o limite só o Vix para; o CRM e os agentes seguem.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- COMO RODAR
--
-- Os valores entram por variável do psql. SEM a variável, o psql para com erro
-- e nada é gravado: é de propósito, para ninguém rodar com número inventado.
--
-- Bloco A, limite por plano (os três planos novos da Tarefa 8; o script
-- `docs/arvisx/ci/PLANOS-NOVOS-2026-11.sql` precisa ter rodado ANTES, porque é
-- ele que cria os planos com estes ids fixos):
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--     -v limite_plano_1=<N> -v limite_plano_2=<N> -v limite_plano_3=<N> \
--     -v org_slug= \
--     -f docs/arvisx/ci/VIX-LIMITES-E-MARCA-2026-11.sql
--
-- Bloco B, marca sem limite para UMA organização (rode uma vez por organização;
-- `org_slug` é o slug dela, o mesmo da URL):
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--     -v limite_plano_1= -v limite_plano_2= -v limite_plano_3= \
--     -v org_slug=<SLUG-DA-ORGANIZACAO> \
--     -f docs/arvisx/ci/VIX-LIMITES-E-MARCA-2026-11.sql
--
-- Variável vazia = aquele bloco é PULADO. Os números do bloco A são decisão do
-- Lucas e ainda não existem: nenhum valor é sugerido aqui.
--
-- Idempotente: rodar de novo com os mesmos valores não duplica; com outros
-- valores, atualiza (é o jeito de corrigir). Sem BEGIN/COMMIT.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A. LIMITE DE MENSAGENS POR PLANO ─────────────────────────────────────────
select set_config('vix.limite_1', :'limite_plano_1', false),
       set_config('vix.limite_2', :'limite_plano_2', false),
       set_config('vix.limite_3', :'limite_plano_3', false),
       set_config('vix.org_slug', :'org_slug', false);

do $limites$
declare
  v record;
  v_bruto text;
  v_limite integer;
begin
  for v in
    select * from (values
      ('a7150008-0000-4000-8000-000000000001'::uuid, 'Plano 1', 'vix.limite_1'),
      ('a7150008-0000-4000-8000-000000000002'::uuid, 'Plano 2', 'vix.limite_2'),
      ('a7150008-0000-4000-8000-000000000003'::uuid, 'Plano 3', 'vix.limite_3')
    ) as t (plano_id, rotulo, variavel)
  loop
    v_bruto := btrim(coalesce(current_setting(v.variavel, true), ''));
    if v_bruto = '' then
      raise notice 'Vix: % PULADO (sem limite informado).', v.rotulo;
      continue;
    end if;
    if v_bruto !~ '^[0-9]+$' then
      raise exception 'Vix: limite inválido para %: "%". Informe um número inteiro de mensagens por mês.', v.rotulo, v_bruto;
    end if;
    v_limite := v_bruto::integer;
    if not exists (select 1 from public.cobranca_planos p where p.id = v.plano_id) then
      raise exception 'Vix: % (%) não existe. Rode antes docs/arvisx/ci/PLANOS-NOVOS-2026-11.sql.', v.rotulo, v.plano_id;
    end if;

    update public.assistente_planos
       set mensagens_por_mes = v_limite, updated_at = now()
     where plano_id = v.plano_id;
    if not found then
      insert into public.assistente_planos (plano_id, mensagens_por_mes) values (v.plano_id, v_limite);
    end if;
    raise notice 'Vix: % configurado com % mensagens por mês.', v.rotulo, v_limite;
  end loop;
end
$limites$;

-- ── B. MARCA "SEM LIMITE" PARA UMA ORGANIZAÇÃO ───────────────────────────────
-- A marca é da PLATAFORMA: a tela da empresa não a escreve, e a sessão só lê.
-- Preserva o `ligado` que a empresa já tiver escolhido.
do $marca$
declare
  v_slug text := btrim(coalesce(current_setting('vix.org_slug', true), ''));
  v_org uuid;
begin
  if v_slug = '' then
    raise notice 'Vix: marca PULADA (nenhuma organização informada).';
    return;
  end if;
  select o.id into v_org from public.organizations o where o.slug = v_slug;
  if v_org is null then
    raise exception 'Vix: não existe organização com o slug "%".', v_slug;
  end if;

  insert into public.assistente_estado_da_empresa (organization_id, sem_limite)
  values (v_org, true)
  on conflict (organization_id) do update set sem_limite = true, updated_at = now();
  raise notice 'Vix: organização "%" marcada como sem limite de mensagens.', v_slug;
end
$marca$;

-- ── CONFERIR ─────────────────────────────────────────────────────────────────
select p.nome as plano, a.mensagens_por_mes, a.limite_de_lote, a.mensagens_por_minuto, a.ferramentas_por_turno
  from public.assistente_planos a
  join public.cobranca_planos p on p.id = a.plano_id
 order by p.nome;

select o.slug as organizacao, e.ligado, e.sem_limite
  from public.assistente_estado_da_empresa e
  join public.organizations o on o.id = e.organization_id
 where e.sem_limite
 order by o.slug;

-- ── DESFAZER ─────────────────────────────────────────────────────────────────
-- Tirar a marca de uma organização (ela volta a depender do plano):
--   update public.assistente_estado_da_empresa e set sem_limite = false
--     from public.organizations o where o.id = e.organization_id and o.slug = '<SLUG>';
-- Tirar o Vix de um plano:
--   delete from public.assistente_planos where plano_id = '<ID-DO-PLANO>';
