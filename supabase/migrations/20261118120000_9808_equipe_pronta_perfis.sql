-- manifest: **Equipe de IA pronta: o perfil do negócio.** Tabela `equipe_pronta_perfis`, uma linha por organização, com as respostas do questionário (`respostas`), o estado (`rascunho`/`instalado`), o modo (`ensaio`/`ativo`) e o que a instalação criou (`instalacao`: ids, versão de cada papel e hash do texto gerado). RLS: membros da organização leem; manager e admin escrevem. Nenhuma linha existente muda.
--
-- 9808 — o perfil do negócio da Equipe de IA pronta (plano Premium).
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 a 9807.
--
-- ═══ Por quê ═══
--
-- A Equipe de IA pronta são 4 agentes (SDR, Agendamento, Proposta e Recuperador
-- de vendas) que servem a qualquer negócio. O que cada agente FAZ mora no
-- código (`lib/ai/equipe-pronta/`), igual para todas as empresas. O que muda de
-- uma empresa para outra são as respostas de um questionário — e é isso que
-- esta tabela guarda. O instalador lê as respostas e cria os agentes, o
-- roteador, a base e a agenda da empresa; a tabela guarda também o que ele
-- criou, para rodar de novo sem duplicar nada.
--
-- ═══ O que muda ═══
--
-- 1. `equipe_pronta_perfis` — UMA linha por organização (`organization_id` é a
--    chave primária: não existe "segundo perfil" de uma empresa).
--
--    * `respostas` (jsonb): o questionário. Aceita rascunho incompleto; quem
--      valida a forma é o Zod de `lib/schemas/equipe-pronta.ts`, não um CHECK —
--      o questionário ganha pergunta com versão de código, e um CHECK de forma
--      quebraria o `update.sh` de quem tem rascunho antigo.
--    * `estado`: `rascunho` (ainda não instalou) ou `instalado`.
--    * `modo`: `ensaio` (os agentes só falam com os telefones de teste do canal)
--      ou `ativo`.
--    * `instalado_em`: quando a instalação rodou pela última vez.
--    * `instalacao` (jsonb): os ids que a instalação criou, a versão de cada
--      papel aplicada e o hash dos campos gravados em cada agente.
--    * `updated_by`: quem salvou por último.
--
-- 2. RLS — membros da organização LEEM (a tela mostra o estado a quem pode
--    abri-la); INSERT e UPDATE exigem `manager` ou acima. Não há policy de
--    DELETE: a linha some com a organização (cascade), e "desinstalar" não
--    apaga respostas.
--
-- 3. Gatilho `updated_at`, com a função `fn_set_updated_at` que o banco já tem.
--    Nenhuma função nova nasce aqui.
--
-- ═══ O que NÃO muda ═══
--
-- Nenhuma tabela de agente. A marca de "agente da equipe pronta" vai em
-- `ai_agents.config.equipe_pronta`, coluna jsonb que já existe.

create table if not exists public.equipe_pronta_perfis (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  respostas jsonb not null default '{}'::jsonb,
  estado text not null default 'rascunho' check (estado in ('rascunho', 'instalado')),
  modo text not null default 'ensaio' check (modo in ('ensaio', 'ativo')),
  instalado_em timestamptz,
  instalacao jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.equipe_pronta_perfis is
  'Equipe de IA pronta (Premium): o perfil do negócio de cada organização. respostas = questionário (validado no app, lib/schemas/equipe-pronta.ts); estado = rascunho|instalado; modo = ensaio|ativo; instalacao = ids criados, versão de cada papel e hash dos campos de cada agente. Uma linha por organização. Migration 9808.';

drop trigger if exists trg_equipe_pronta_perfis_updated_at on public.equipe_pronta_perfis;
create trigger trg_equipe_pronta_perfis_updated_at
  before update on public.equipe_pronta_perfis
  for each row execute function public.fn_set_updated_at();

alter table public.equipe_pronta_perfis enable row level security;

drop policy if exists tenant_isolation_equipe_pronta_perfis_select on public.equipe_pronta_perfis;
create policy tenant_isolation_equipe_pronta_perfis_select on public.equipe_pronta_perfis
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  );

drop policy if exists tenant_isolation_equipe_pronta_perfis_insert on public.equipe_pronta_perfis;
create policy tenant_isolation_equipe_pronta_perfis_insert on public.equipe_pronta_perfis
  for insert with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists tenant_isolation_equipe_pronta_perfis_update on public.equipe_pronta_perfis;
create policy tenant_isolation_equipe_pronta_perfis_update on public.equipe_pronta_perfis
  for update using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon` do baseline alcança
-- toda tabela criada depois dele. Sem este revoke, as respostas da empresa
-- ficariam legíveis pela anon key, que vai para o browser.
revoke all on public.equipe_pronta_perfis from anon, authenticated;
grant select, insert, update on public.equipe_pronta_perfis to authenticated;
grant all on public.equipe_pronta_perfis to service_role;

-- Empresa suspensa não grava pelo banco (9806): a função só cria a policy que
-- falta, e esta tabela acabou de abrir INSERT e UPDATE à sessão.
select public.fn_aplicar_trava_de_org_suspensa();

notify pgrst, 'reload schema';
