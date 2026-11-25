-- manifest: **Fundação do Vix, o assistente do cliente dentro do CRM (Tarefa 7, Fase 1).** Oito tabelas `assistente_*`: conversas e mensagens por usuário, cartões de ação (escrita só no clique), estado e progresso por empresa, chamados, o registro de custo do Vix e a configuração de teto e pagador por plano. Leitura pela sessão só do que é do próprio usuário; toda escrita é do servidor. `fn_assistente_reservar_acao` troca o cartão de `proposta` para `confirmada` uma vez só. Nenhuma linha de configuração é semeada: plano sem linha em `assistente_planos` = o Vix não responde.
--
-- 9830 — fundação do Vix (assistente do cliente).
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 a 9824.
--
-- ═══ Por quê ═══
--
-- O Vix conversa com o usuário logado e só faz o que está num catálogo em
-- código (`lib/assistente/capacidades/`). Ler executa direto. Escrever vira um
-- CARTÃO gravado aqui, e só a rota de confirmação, no clique do usuário,
-- executa. O banco é quem garante que o cartão vale uma vez, só para o usuário
-- e a empresa que o receberam, e só dentro do prazo.
--
-- ═══ O que muda ═══
--
-- 1. `assistente_conversas`, `assistente_mensagens`: histórico curto, por
--    usuário. A policy de leitura exige a organização E o dono
--    (`user_id = auth.uid()`): nem o administrador da empresa lê a conversa de
--    outra pessoa por aqui. `user_id` está nas duas tabelas de propósito
--    (doutrina DIRC, Duplicar): a policy não pode depender de uma junção.
-- 2. `assistente_acoes`: os cartões. `entrada` é o argumento já validado da
--    capacidade; `itens` é o que será alterado, como o usuário viu.
-- 3. `assistente_estado_da_empresa`: a chave de ligar e desligar por empresa.
--    Sem linha = ligado (o que decide antes é a instalação e o plano).
-- 4. `assistente_progresso`: o que já foi feito na conta, base do modo
--    onboarding (tarefa futura). Só a estrutura nasce aqui.
-- 5. `assistente_chamados`: pedido de ajuda para a equipe da plataforma, com o
--    diagnóstico anexado.
-- 6. `assistente_custos`: o custo de cada resposta do Vix. Tabela PRÓPRIA de
--    propósito: gravar em `llm_calls` somaria no orçamento de IA da empresa
--    (gatilho `trg_llm_calls_budget`) e na régua `fn_gasto_de_ia_do_mes`, que
--    pausam os agentes de WhatsApp. Onde esse custo deve morar é decisão
--    pendente do dono; a aplicação fala com esta tabela por um módulo só
--    (`lib/assistente/custo.ts`).
-- 7. `assistente_planos`: teto mensal, pagador e limites por plano. Da
--    INSTALAÇÃO, sem `organization_id`, como `cobranca_planos`. `plano_id`
--    nulo é a linha de quem não tem plano. NENHUMA linha é semeada.
-- 8. `fn_assistente_reservar_acao`, `fn_assistente_gasto_do_mes`,
--    `fn_assistente_plano_da_org`: só o `service_role` executa. Quem chama é a
--    rota, com usuário e organização da SESSÃO.
--
-- ═══ O que NÃO muda ═══
--
-- `llm_calls`, `ai_budgets`, `fn_gasto_de_ia_do_mes`, `cobranca_planos` e o
-- resto da cobrança: intocados.

create table if not exists public.assistente_conversas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  modo text not null default 'suporte',
  titulo text,
  tela_de_origem text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  arquivada_em timestamptz
);

alter table public.assistente_conversas
  drop constraint if exists assistente_conversas_modo_check;
alter table public.assistente_conversas
  add constraint assistente_conversas_modo_check
  check (modo in ('suporte', 'consultor', 'onboarding'));

comment on table public.assistente_conversas is
  'Conversas do Vix (assistente do cliente), uma por usuário e assunto. Leitura só do dono; escrita só do servidor. Migration 9830.';

create index if not exists idx_assistente_conversas_dono
  on public.assistente_conversas (organization_id, user_id, updated_at desc);

create table if not exists public.assistente_mensagens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversa_id uuid not null references public.assistente_conversas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Gerado no cliente: agrupa pergunta e resposta e é a idempotência do envio.
  turn_id uuid not null,
  autor text not null,
  corpo text,
  origem_da_entrada text not null default 'texto',
  erro_codigo text,
  created_at timestamptz not null default now(),
  constraint assistente_mensagens_turno_unico
    unique (organization_id, conversa_id, turn_id, autor)
);

alter table public.assistente_mensagens
  drop constraint if exists assistente_mensagens_autor_check;
alter table public.assistente_mensagens
  add constraint assistente_mensagens_autor_check
  check (autor in ('usuario', 'assistente'));
alter table public.assistente_mensagens
  drop constraint if exists assistente_mensagens_origem_check;
alter table public.assistente_mensagens
  add constraint assistente_mensagens_origem_check
  check (origem_da_entrada in ('texto', 'voz_transcrita'));

comment on table public.assistente_mensagens is
  'Mensagens das conversas do Vix. Só o texto da conversa: resultado bruto de leitura nunca é gravado aqui. Leitura só do dono; escrita só do servidor. Migration 9830.';

create index if not exists idx_assistente_mensagens_conversa
  on public.assistente_mensagens (organization_id, conversa_id, created_at);

create table if not exists public.assistente_acoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversa_id uuid not null references public.assistente_conversas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  capacidade text not null,
  nivel text not null,
  entrada jsonb not null default '{}'::jsonb,
  resumo text not null,
  itens jsonb not null default '[]'::jsonb,
  quantidade integer not null default 1,
  estado text not null default 'proposta',
  expira_em timestamptz not null,
  confirmada_em timestamptz,
  executada_em timestamptz,
  resultado jsonb,
  erro text,
  created_at timestamptz not null default now()
);

alter table public.assistente_acoes
  drop constraint if exists assistente_acoes_nivel_check;
alter table public.assistente_acoes
  add constraint assistente_acoes_nivel_check
  check (nivel in ('escrever', 'sensivel'));
alter table public.assistente_acoes
  drop constraint if exists assistente_acoes_estado_check;
alter table public.assistente_acoes
  add constraint assistente_acoes_estado_check
  check (estado in ('proposta', 'confirmada', 'executada', 'falhou', 'cancelada', 'expirada'));
alter table public.assistente_acoes
  drop constraint if exists assistente_acoes_quantidade_check;
alter table public.assistente_acoes
  add constraint assistente_acoes_quantidade_check
  check (quantidade >= 1);

comment on table public.assistente_acoes is
  'Cartões de ação do Vix: a escrita proposta pelo assistente, que só é executada no clique do usuário. Vale uma vez, para o usuário e a organização que a receberam, até expira_em (fn_assistente_reservar_acao). Migration 9830.';

create index if not exists idx_assistente_acoes_conversa
  on public.assistente_acoes (organization_id, conversa_id, created_at);

create table if not exists public.assistente_estado_da_empresa (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  ligado boolean not null default true,
  modo_padrao text not null default 'suporte',
  atualizado_por uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.assistente_estado_da_empresa
  drop constraint if exists assistente_estado_da_empresa_modo_check;
alter table public.assistente_estado_da_empresa
  add constraint assistente_estado_da_empresa_modo_check
  check (modo_padrao in ('suporte', 'consultor', 'onboarding'));

comment on table public.assistente_estado_da_empresa is
  'A chave de ligar e desligar o Vix por empresa. Sem linha = ligado. Migration 9830.';

create table if not exists public.assistente_progresso (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  chave text not null,
  feito_em timestamptz not null default now(),
  conferido_por text not null default 'leitura',
  user_id uuid references auth.users(id) on delete set null,
  primary key (organization_id, chave)
);

alter table public.assistente_progresso
  drop constraint if exists assistente_progresso_conferido_check;
alter table public.assistente_progresso
  add constraint assistente_progresso_conferido_check
  check (conferido_por in ('leitura', 'usuario'));

comment on table public.assistente_progresso is
  'O que já foi feito na conta, por empresa: base do modo onboarding do Vix. Migration 9830.';

create table if not exists public.assistente_chamados (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  conversa_id uuid references public.assistente_conversas(id) on delete set null,
  resumo text not null,
  diagnostico jsonb not null default '{}'::jsonb,
  estado text not null default 'aberto',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.assistente_chamados
  drop constraint if exists assistente_chamados_estado_check;
alter table public.assistente_chamados
  add constraint assistente_chamados_estado_check
  check (estado in ('aberto', 'em_andamento', 'resolvido'));

comment on table public.assistente_chamados is
  'Chamado aberto pelo Vix para a equipe da plataforma, com o diagnóstico anexado. Migration 9830.';

create index if not exists idx_assistente_chamados_org
  on public.assistente_chamados (organization_id, created_at desc);

create table if not exists public.assistente_custos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  conversa_id uuid references public.assistente_conversas(id) on delete set null,
  provedor text not null,
  modelo text not null,
  tokens_de_entrada integer not null default 0,
  tokens_de_saida integer not null default 0,
  -- Centavos de DÓLAR, fracionados, a mesma moeda de `llm_calls`.
  custo_usd_cents numeric not null default 0,
  falhou boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.assistente_custos is
  'Custo de cada resposta do Vix, em centavos de dólar. Tabela própria enquanto o dono não decide se esse custo entra em llm_calls (que soma no orçamento de IA da empresa). A empresa lê o próprio uso; só o servidor grava. Migration 9830.';

create index if not exists idx_assistente_custos_org_tempo
  on public.assistente_custos (organization_id, created_at);

create table if not exists public.assistente_planos (
  id uuid primary key default gen_random_uuid(),
  -- Nulo = a linha de quem não tem plano (cobrança desligada ou empresa sem assinatura).
  plano_id uuid references public.cobranca_planos(id) on delete cascade,
  pagador text not null,
  teto_mensal_usd_cents integer not null,
  limite_de_lote integer not null default 5,
  mensagens_por_minuto integer not null default 6,
  ferramentas_por_turno integer not null default 8,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.assistente_planos
  drop constraint if exists assistente_planos_pagador_check;
alter table public.assistente_planos
  add constraint assistente_planos_pagador_check
  check (pagador in ('plataforma', 'empresa'));
alter table public.assistente_planos
  drop constraint if exists assistente_planos_limites_check;
alter table public.assistente_planos
  add constraint assistente_planos_limites_check
  check (
    teto_mensal_usd_cents >= 0
    and limite_de_lote between 1 and 50
    and mensagens_por_minuto between 1 and 60
    and ferramentas_por_turno between 1 and 30
  );

comment on table public.assistente_planos is
  'Teto mensal, pagador e limites do Vix por plano. Da INSTALAÇÃO, sem organization_id: RLS ligada sem policy, só o service_role. plano_id nulo = empresa sem plano. Nenhuma linha é semeada: sem linha, o Vix não responde. Migration 9830.';

create unique index if not exists assistente_planos_um_por_plano
  on public.assistente_planos (plano_id) where plano_id is not null;
create unique index if not exists assistente_planos_um_sem_plano
  on public.assistente_planos ((true)) where plano_id is null;

-- ---- RLS e privilégios ----

alter table public.assistente_conversas enable row level security;
alter table public.assistente_mensagens enable row level security;
alter table public.assistente_acoes enable row level security;
alter table public.assistente_estado_da_empresa enable row level security;
alter table public.assistente_progresso enable row level security;
alter table public.assistente_chamados enable row level security;
alter table public.assistente_custos enable row level security;
alter table public.assistente_planos enable row level security;

drop policy if exists tenant_isolation_assistente_conversas_select on public.assistente_conversas;
create policy tenant_isolation_assistente_conversas_select on public.assistente_conversas
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()) and user_id = auth.uid());

drop policy if exists tenant_isolation_assistente_mensagens_select on public.assistente_mensagens;
create policy tenant_isolation_assistente_mensagens_select on public.assistente_mensagens
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()) and user_id = auth.uid());

drop policy if exists tenant_isolation_assistente_acoes_select on public.assistente_acoes;
create policy tenant_isolation_assistente_acoes_select on public.assistente_acoes
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()) and user_id = auth.uid());

drop policy if exists tenant_isolation_assistente_estado_da_empresa_select on public.assistente_estado_da_empresa;
create policy tenant_isolation_assistente_estado_da_empresa_select on public.assistente_estado_da_empresa
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists tenant_isolation_assistente_progresso_select on public.assistente_progresso;
create policy tenant_isolation_assistente_progresso_select on public.assistente_progresso
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists tenant_isolation_assistente_chamados_select on public.assistente_chamados;
create policy tenant_isolation_assistente_chamados_select on public.assistente_chamados
  for select to authenticated
  using (
    organization_id in (select public.fn_user_org_ids())
    and (user_id = auth.uid() or public.fn_user_role_in(organization_id) >= 3)
  );

drop policy if exists tenant_isolation_assistente_custos_select on public.assistente_custos;
create policy tenant_isolation_assistente_custos_select on public.assistente_custos
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.assistente_conversas from public, anon, authenticated;
revoke all on public.assistente_mensagens from public, anon, authenticated;
revoke all on public.assistente_acoes from public, anon, authenticated;
revoke all on public.assistente_estado_da_empresa from public, anon, authenticated;
revoke all on public.assistente_progresso from public, anon, authenticated;
revoke all on public.assistente_chamados from public, anon, authenticated;
revoke all on public.assistente_custos from public, anon, authenticated;
revoke all on public.assistente_planos from public, anon, authenticated;

grant select on public.assistente_conversas to authenticated;
grant select on public.assistente_mensagens to authenticated;
grant select on public.assistente_acoes to authenticated;
grant select on public.assistente_estado_da_empresa to authenticated;
grant select on public.assistente_progresso to authenticated;
grant select on public.assistente_chamados to authenticated;
grant select on public.assistente_custos to authenticated;

grant select, insert, update, delete on public.assistente_conversas to service_role;
grant select, insert, update, delete on public.assistente_mensagens to service_role;
grant select, insert, update, delete on public.assistente_acoes to service_role;
grant select, insert, update, delete on public.assistente_estado_da_empresa to service_role;
grant select, insert, update, delete on public.assistente_progresso to service_role;
grant select, insert, update, delete on public.assistente_chamados to service_role;
grant select, insert, update, delete on public.assistente_custos to service_role;
grant select, insert, update, delete on public.assistente_planos to service_role;

-- ---- funções (só o servidor) ----

-- O cartão vale UMA vez, para o usuário e a organização que o receberam, dentro
-- do prazo. Uma instrução só: duas confirmações simultâneas não passam as duas.
create or replace function public.fn_assistente_reservar_acao(
  p_org uuid,
  p_user uuid,
  p_acao uuid
) returns setof public.assistente_acoes
language sql
volatile
security invoker
set search_path = ''
as $$
  update public.assistente_acoes a
     set estado = 'confirmada',
         confirmada_em = now()
   where a.id = p_acao
     and a.organization_id = p_org
     and a.user_id = p_user
     and a.estado = 'proposta'
     and a.expira_em > now()
  returning a.*;
$$;

comment on function public.fn_assistente_reservar_acao(uuid, uuid, uuid) is
  'Troca o cartão do Vix de proposta para confirmada, uma vez só: exige a organização e o usuário donos do cartão, estado proposta e prazo vigente. Devolve a linha, ou nada. Só o service_role executa; a rota passa usuário e organização da sessão. Migration 9830.';

revoke execute on function public.fn_assistente_reservar_acao(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_assistente_reservar_acao(uuid, uuid, uuid) to service_role;

create or replace function public.fn_assistente_gasto_do_mes(p_org uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(c.custo_usd_cents), 0)::numeric
    from public.assistente_custos c
   where c.organization_id = p_org
     and c.created_at >= date_trunc('month', now());
$$;

comment on function public.fn_assistente_gasto_do_mes(uuid) is
  'Gasto do Vix da organização no mês corrente, em centavos de dólar, somado de assistente_custos. Não é o gasto de IA da empresa (fn_gasto_de_ia_do_mes): é só o do assistente. Só o service_role executa. Migration 9830.';

revoke execute on function public.fn_assistente_gasto_do_mes(uuid) from public, anon, authenticated;
grant execute on function public.fn_assistente_gasto_do_mes(uuid) to service_role;

-- A configuração do Vix que vale para a organização: a do plano assinado, ou a
-- linha sem plano quando a cobrança está desligada ou não há assinatura. Sem
-- linha, devolve nada, e a aplicação não responde (falha fechada).
create or replace function public.fn_assistente_plano_da_org(p_org uuid)
returns setof public.assistente_planos
language sql
stable
security invoker
set search_path = ''
as $$
  with assinado as (
    select a.plano_id
      from public.cobranca_assinaturas a
     where a.organization_id = p_org
       and public.fn_cobranca_ligada()
  )
  select p.*
    from public.assistente_planos p
   where (exists (select 1 from assinado) and p.plano_id = (select plano_id from assinado))
      or (not exists (select 1 from assinado) and p.plano_id is null)
   limit 1;
$$;

comment on function public.fn_assistente_plano_da_org(uuid) is
  'A linha de assistente_planos que vale para a organização: a do plano assinado (cobrança ligada), senão a linha sem plano. Sem linha, devolve nada e o Vix não responde. Só o service_role executa. Migration 9830.';

revoke execute on function public.fn_assistente_plano_da_org(uuid) from public, anon, authenticated;
grant execute on function public.fn_assistente_plano_da_org(uuid) to service_role;

notify pgrst, 'reload schema';
