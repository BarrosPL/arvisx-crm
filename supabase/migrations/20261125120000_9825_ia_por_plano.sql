-- manifest: **IA por plano: origem da chave em `llm_calls`, franquia de conversas e ciclo.** `llm_calls.origem_da_chave` (`cliente` | `plataforma` | `assinatura_plataforma` | `assistente_chave_plataforma`, padrão `plataforma`) diz de quem é a chave que pagou a chamada; `cobranca_planos.franquia_conversas_ia` é o limite de conversas com IA por ciclo. `fn_gasto_de_ia_do_mes` e o gatilho de `ai_budgets` passam a ignorar os dois valores do assistente da plataforma (`assinatura_plataforma` e `assistente_chave_plataforma`). Funções novas: `fn_ciclo_de_ia`, `fn_ia_do_plano` (teto, franquia, gasto e conversas só da chave da plataforma, no ciclo), `fn_contato_na_franquia` e `fn_cobranca_avisar_uso_de_ia` (aviso de 80% uma vez por ciclo). Nenhum plano e nenhuma assinatura mudam.
--
-- 9825 — IA por plano (Tarefa 8, parte 1). Faixa 98xx, a do fork (ArvisX CRM).
--
-- ═══ Por quê ═══
--
-- A IA passa a vir incluída no plano, paga pela chave da PLATAFORMA. Para isso o
-- banco precisa saber três coisas que hoje não sabe:
--
--   1. DE QUEM É A CHAVE de cada chamada. `llm_calls` não distinguia, e o teto
--      do plano somava o mês inteiro de todas as chaves (decisão antiga, D-9 da
--      cobrança: "conta tudo, bloqueia só a chave da instalação"). A decisão do
--      dono em 25/11/2026 INVERTE isso: o teto do plano soma SÓ a chave da
--      plataforma. Quem usa a própria chave paga o próprio provedor e não gasta
--      o que o plano inclui.
--   2. A FRANQUIA em conversas, que é o que o cliente vê. O teto em dólar é a
--      trava de baixo.
--   3. O CICLO. A soma era sempre o mês-calendário. Com assinatura mensal em
--      período pago, o ciclo é o da assinatura.
--
-- ═══ O que muda ═══
--
-- A. `llm_calls.origem_da_chave` — `cliente` (credencial da organização),
--    `plataforma` (a chave da instalação, que o plano paga) e os DOIS valores do
--    assistente da plataforma, que não são gasto da empresa:
--      · `assinatura_plataforma` — chamada feita com a ASSINATURA da plataforma,
--        e não com chave de API (grava os tokens reais e `cost_cents = 0`);
--      · `assistente_chave_plataforma` — o assistente rodando pela CHAVE da
--        plataforma, como saída quando a assinatura não pode ser usada.
--    Os dois são reservados para a Tarefa 7; nada grava esses valores ainda. O
--    login por assinatura que a PRÓPRIA empresa conecta continua sendo `cliente`.
--
--    ⚠️ `assistente_chave_plataforma` usa a MESMA chave que `plataforma` e NÃO
--    conta no teto do plano: quem decide é o valor da coluna, não a chave. O
--    teto e a franquia do plano somam só `plataforma`.
--
--    ⚠️ O PADRÃO É `plataforma`, E É DE PROPÓSITO. Vale para a linha antiga e
--    para o escritor que esquecer de preencher. A pergunta é "para que lado
--    erra?": com `plataforma`, a chamada de origem desconhecida CONTA no teto do
--    plano — erra para o lado que protege o bolso de quem paga a chave, e o erro
--    aparece (o uso sobe). Com `cliente` ela sumiria da conta em silêncio, e um
--    escritor esquecido furaria o teto sem ninguém ver. O custo do padrão é
--    limitado: o teto do plano só BLOQUEIA quem está chamando com a chave da
--    plataforma, então a empresa que usa a própria chave nunca é parada por
--    linha antiga; e a linha antiga só entra na soma do ciclo em que foi
--    gravada. Constante não reescreve a tabela (Postgres 11+).
-- B. `cobranca_planos.franquia_conversas_ia` — nulo = sem franquia. Mora na
--    mesma tabela dos outros limites do plano (`max_assentos`, `max_canais`,
--    `teto_ia_usd_cents`): é atributo do plano, lido junto com eles.
-- C. `fn_gasto_de_ia_do_mes` e `fn_update_budget_consumption` (o gatilho que
--    soma em `ai_budgets`) ignoram os dois valores do assistente. Para `cliente` e `plataforma` a
--    regra do orçamento da EMPRESA é a de sempre: soma as duas.
-- D. `fn_ciclo_de_ia(org)` — o período pago da assinatura quando ela tem
--    `periodo_pago_desde` e `proximo_vencimento`, o plano é mensal e agora está
--    dentro do período; mês-calendário nos demais casos (teste grátis, plano
--    anual, período vencido, dado faltando, empresa isenta).
-- E. `fn_ia_do_plano(org)` — numa ida: se a empresa tem assinatura, o teto, a
--    franquia, o ciclo, o gasto e as conversas. Gasto e conversas contam SÓ
--    `plataforma`. "Conversa com IA" = contato distinto atendido por um agente
--    no ciclo: chamada que deu certo, com contato, num dos pontos em que o
--    agente fala com a pessoa.
-- F. `fn_contato_na_franquia(org, contato)` — o contato já foi contado neste
--    ciclo? Quem já está dentro da franquia continua atendido quando ela enche.
-- G. `fn_cobranca_avisar_uso_de_ia(org, título, corpo, desde)` — o aviso de 80%,
--    um por ciclo. A irmã `fn_cobranca_avisar_teto_de_ia` deduplica por
--    mês-calendário e fica como está.
--
-- Idempotente: `add column if not exists`, constraint em bloco `do`,
-- `create or replace`. Sem BEGIN/COMMIT. Toda função perde EXECUTE de public,
-- anon e authenticated. Gate: tests/invariants/ia-por-plano.test.ts.

-- ── A. de quem é a chave ─────────────────────────────────────────────────────
alter table public.llm_calls
  add column if not exists origem_da_chave text not null default 'plataforma';

-- Num bloco só: o update.sh reaplica sem ON_ERROR_STOP e em autocommit, e um
-- add que falhasse depois do drop solto deixaria a coluna sem guarda. Tirar e
-- pôr de novo é o que faz o vocabulário poder crescer por reaplicação.
do $origem$
begin
  alter table public.llm_calls
    drop constraint if exists llm_calls_origem_da_chave_check;
  alter table public.llm_calls
    add constraint llm_calls_origem_da_chave_check
    check (origem_da_chave in ('cliente', 'plataforma', 'assinatura_plataforma', 'assistente_chave_plataforma'));
end
$origem$;

comment on column public.llm_calls.origem_da_chave is
  'De quem é a chave que pagou a chamada (migration 9825): cliente = credencial da organização; plataforma = chave da instalação, que o plano paga; assinatura_plataforma = o assistente da plataforma rodando na assinatura dela; assistente_chave_plataforma = o assistente da plataforma rodando pela chave dela. Nenhum dos dois é gasto da empresa. Padrão plataforma: a origem desconhecida conta no teto do plano. O teto e a franquia do plano somam só plataforma; o orçamento da empresa soma cliente e plataforma; nenhuma soma de limite conta os dois valores do assistente. Par TypeScript: ORIGENS_DA_CHAVE em lib/ai/usage/origem-da-chave.ts.';

-- ── B. a franquia do plano ───────────────────────────────────────────────────
alter table public.cobranca_planos
  add column if not exists franquia_conversas_ia integer;

do $franquia$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.cobranca_planos'::regclass and conname = 'cobranca_planos_franquia_conversas_ia_check'
  ) then
    alter table public.cobranca_planos
      add constraint cobranca_planos_franquia_conversas_ia_check
      check (franquia_conversas_ia is null or franquia_conversas_ia >= 1);
  end if;
end
$franquia$;

comment on column public.cobranca_planos.franquia_conversas_ia is
  'Conversas com IA incluídas no plano por ciclo (migration 9825): contatos distintos atendidos por um agente com a chave da plataforma. Nulo = sem franquia (vale só o teto em dólar). É o limite que o cliente vê; teto_ia_usd_cents é a trava de baixo.';

-- ── C. as somas do orçamento da empresa ignoram o assistente da plataforma ─────────────────
create or replace function public.fn_gasto_de_ia_do_mes(p_org uuid)
returns numeric
  language sql
  stable
  security invoker
  set search_path to 'public', 'pg_temp'
as $$
  select coalesce(sum(cost_cents), 0)::numeric
    from public.llm_calls
   where organization_id = p_org
     and created_at >= date_trunc('month', now())
     -- 9825: o assistente da plataforma (na assinatura ou na chave dela) não é gasto da empresa.
     and origem_da_chave not in ('assinatura_plataforma', 'assistente_chave_plataforma');
$$;

revoke execute on function public.fn_gasto_de_ia_do_mes(uuid) from public, anon, authenticated;
grant  execute on function public.fn_gasto_de_ia_do_mes(uuid) to service_role;

-- O gatilho serve a `llm_calls` e a `ai_invocations` (a tabela antiga, que não
-- tem a coluna): por isso a leitura é pelo jsonb da linha, e não `new.coluna`.
create or replace function public.fn_update_budget_consumption()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 9825: o assistente da plataforma (na assinatura ou na chave dela) não soma no orçamento da empresa.
  if (to_jsonb(new) ->> 'origem_da_chave') in ('assinatura_plataforma', 'assistente_chave_plataforma') then
    return new;
  end if;
  insert into public.ai_budgets (organization_id, current_month_consumed_cents)
  values (new.organization_id, coalesce(new.cost_cents, 0))
  on conflict (organization_id) do update
  set current_month_consumed_cents =
        public.ai_budgets.current_month_consumed_cents
        + coalesce(new.cost_cents, 0),
      updated_at = now();
  return new;
end;
$$;

revoke execute on function public.fn_update_budget_consumption() from public, anon, authenticated;
grant  execute on function public.fn_update_budget_consumption() to service_role;

-- ── D. o ciclo ───────────────────────────────────────────────────────────────
create or replace function public.fn_ciclo_de_ia(p_org uuid)
returns table (inicio timestamptz, fim timestamptz, pelo_periodo_pago boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with pago as (
    select a.periodo_pago_desde as de, a.proximo_vencimento as ate
      from public.cobranca_assinaturas a
      join public.cobranca_planos p on p.id = a.plano_id
     where a.organization_id = p_org
       and p.intervalo = 'mes'
       and a.periodo_pago_desde is not null
       and a.proximo_vencimento is not null
       and a.periodo_pago_desde <= now()
       and now() < a.proximo_vencimento
  )
  select coalesce((select de from pago), date_trunc('month', now())),
         coalesce((select ate from pago), date_trunc('month', now()) + interval '1 month'),
         exists (select 1 from pago);
$$;

revoke execute on function public.fn_ciclo_de_ia(uuid) from public, anon, authenticated;
grant  execute on function public.fn_ciclo_de_ia(uuid) to service_role;

-- ── E. o uso de IA do plano ──────────────────────────────────────────────────
-- `com_assinatura = false`: cobrança desligada na instalação, ou empresa sem
-- assinatura (isenta). Aí nada é somado e tudo volta nulo: para elas a IA segue
-- sem limite de plano, como sempre foi (decisão do dono, 25/11/2026).
-- `com_assinatura = true` com `teto` nulo é o plano SEM TETO: quem decide o que
-- fazer com ele é o motor (lib/agent-engine/edge/llm/orcamento.ts).
create or replace function public.fn_ia_do_plano(p_org uuid)
returns table (
  com_assinatura boolean,
  teto integer,
  franquia integer,
  ciclo_inicio timestamptz,
  ciclo_fim timestamptz,
  pelo_periodo_pago boolean,
  gasto numeric,
  conversas integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_teto integer;
  v_franquia integer;
  v_inicio timestamptz;
  v_fim timestamptz;
  v_pago boolean;
  v_gasto numeric;
  v_conversas integer;
begin
  if public.fn_cobranca_ligada() then
    select p.teto_ia_usd_cents, p.franquia_conversas_ia
      into v_teto, v_franquia
      from public.cobranca_assinaturas a
      join public.cobranca_planos p on p.id = a.plano_id
     where a.organization_id = p_org;
  end if;
  if not found then
    return query select false, null::integer, null::integer, null::timestamptz, null::timestamptz,
                        null::boolean, null::numeric, null::integer;
    return;
  end if;

  select c.inicio, c.fim, c.pelo_periodo_pago into v_inicio, v_fim, v_pago
    from public.fn_ciclo_de_ia(p_org) c;

  select coalesce(sum(l.cost_cents), 0)::numeric,
         count(distinct l.contact_id) filter (
           where l.status = 'ok'
             and l.contact_id is not null
             and l.purpose in ('agent_turn', 'followup_turn', 'bot_respond', 'automation_ai_message')
         )::integer
    into v_gasto, v_conversas
    from public.llm_calls l
   where l.organization_id = p_org
     and l.origem_da_chave = 'plataforma'
     and l.created_at >= v_inicio
     and l.created_at < v_fim;

  return query select true, v_teto, v_franquia, v_inicio, v_fim, v_pago, v_gasto, v_conversas;
end;
$$;

revoke execute on function public.fn_ia_do_plano(uuid) from public, anon, authenticated;
grant  execute on function public.fn_ia_do_plano(uuid) to service_role;

-- ── F. o contato já está na franquia deste ciclo? ────────────────────────────
create or replace function public.fn_contato_na_franquia(p_org uuid, p_contato uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_contato is not null and exists (
    select 1
      from public.llm_calls l, public.fn_ciclo_de_ia(p_org) c
     where l.organization_id = p_org
       and l.contact_id = p_contato
       and l.origem_da_chave = 'plataforma'
       and l.status = 'ok'
       and l.purpose in ('agent_turn', 'followup_turn', 'bot_respond', 'automation_ai_message')
       and l.created_at >= c.inicio
       and l.created_at < c.fim
  );
$$;

revoke execute on function public.fn_contato_na_franquia(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.fn_contato_na_franquia(uuid, uuid) to service_role;

-- ── G. o aviso de 80%, um por ciclo ──────────────────────────────────────────
-- Deduplica por EXISTÊNCIA no ciclo, e não por estar aberto: fechar o aviso à
-- mão, ou o uso oscilar em torno de 80%, não abre outro no mesmo ciclo.
create or replace function public.fn_cobranca_avisar_uso_de_ia(
  p_org uuid, p_titulo text, p_corpo text, p_desde timestamptz
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 2284));
  if exists (select 1 from public.agent_inbox_items
              where organization_id = p_org and kind = 'cobranca' and ref_kind = 'plano'
                and created_at >= p_desde) then
    return false;
  end if;
  insert into public.agent_inbox_items (organization_id, kind, severity, title, body, ref_kind, ref_id)
  values (p_org, 'cobranca', 'warn', p_titulo, p_corpo, 'plano', p_org);
  return true;
end;
$$;

revoke execute on function public.fn_cobranca_avisar_uso_de_ia(uuid, text, text, timestamptz) from public, anon, authenticated;
grant  execute on function public.fn_cobranca_avisar_uso_de_ia(uuid, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
