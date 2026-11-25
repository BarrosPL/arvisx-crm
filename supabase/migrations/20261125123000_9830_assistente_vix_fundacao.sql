-- manifest: **Fundação do Vix, o assistente do cliente dentro do CRM (Tarefa 7, Fase 1).** Sete tabelas `assistente_*`: conversas e mensagens por usuário, cartões de ação (escrita só no clique), estado e progresso por empresa, chamados e o registro de uso. Leitura pela sessão só do que é do próprio usuário; toda escrita é do servidor. `fn_assistente_reservar_acao` troca o cartão de `proposta` para `confirmada` uma vez só. `fn_assistente_acesso_da_org` decide quem tem o assistente: organização com a marca `isenta` (da plataforma) ou com assinatura ativa, em qualquer plano. Não há limite de mensagens por plano e nada é semeado.
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
-- 3. `assistente_estado_da_empresa`: a chave de ligar e desligar por empresa
--    (sem linha = ligado; o que decide antes é a instalação e o acesso) e a
--    MARCA `isenta`: a organização tem o assistente mesmo sem assinatura.
--    A marca é da PLATAFORMA: a sessão só lê, a rota da empresa não a
--    escreve, e nenhuma linha nasce marcada.
-- 4. `assistente_progresso`: o que já foi feito na conta, base do modo
--    onboarding (tarefa futura). Só a estrutura nasce aqui.
-- 5. `assistente_chamados`: pedido de ajuda para a equipe da plataforma, com o
--    diagnóstico anexado.
-- 6. `assistente_usos`: uma linha por mensagem do usuário que CHEGOU ao modelo,
--    com os tokens. Só contagem, tokens e data: NUNCA texto de mensagem. É o
--    que a plataforma olha para ver o uso por organização. Não guarda
--    dinheiro. Não é `llm_calls` de propósito: gravar lá hoje somaria no
--    orçamento de IA da empresa (gatilho `trg_llm_calls_budget`) e na régua
--    `fn_gasto_de_ia_do_mes`, que
--    pausam os agentes de WhatsApp. A aplicação fala com esta tabela por um
--    módulo só (`lib/assistente/custo.ts`).
-- 7. `fn_assistente_reservar_acao`, `fn_assistente_registrar_mensagem`,
--    `fn_assistente_mensagens_do_mes`, `fn_assistente_acesso_da_org`,
--    `fn_assistente_uso_do_mes`: só o `service_role` executa. Quem chama é a
--    rota, com usuário e organização da SESSÃO.
--
-- ═══ Quem tem o assistente ═══
--
-- Duas portas, e só duas (`fn_assistente_acesso_da_org`):
--   * a organização tem a marca `isenta`, que só a plataforma escreve;
--   * a organização tem ASSINATURA ATIVA, em qualquer plano, novo ou antigo.
-- Sem uma das duas, o assistente não responde.
--
-- "Ativa" usa as duas réguas que a cobrança já tem, sem inventar uma terceira:
--   * a organização está OPERANTE (`organizations.status = 'active'`, a régua
--     de `lib/organizacao/operante.ts`): empresa suspensa não tem assistente;
--   * a assinatura NÃO está devendo: `fn_cobranca_suspender_se_devendo` chama
--     de devendo o estado `em_atraso` ou `cancelada`. Sobram `trial` e `ativa`.
-- E a cobrança precisa estar ligada na instalação (`fn_cobranca_ligada`): com
-- ela desligada ninguém tem assinatura que valha, e só a marca dá o assistente.
--
-- NÃO há limite de mensagens por plano. O freio contra abuso (mensagens por
-- minuto e tamanho da mensagem) é configuração da instalação, na aplicação.
--
-- ═══ O que NÃO muda, e o que o assistente NÃO lê ═══
--
-- `llm_calls`, `ai_budgets`, `fn_gasto_de_ia_do_mes` e todo o resto da cobrança
-- ficam como estão. O assistente não é item de plano: não lê preço, teto de IA
-- nem franquia de plano nenhum. Da cobrança ele lê só a EXISTÊNCIA e o ESTADO da
-- assinatura da organização.

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
  -- Marca da PLATAFORMA: esta organização tem o assistente mesmo sem assinatura.
  isenta boolean not null default false,
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
  'A chave de ligar e desligar o Vix por empresa (sem linha = ligado) e a marca isenta, que só a plataforma escreve: a organização tem o assistente mesmo sem assinatura. Migration 9830.';

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

create table if not exists public.assistente_usos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  conversa_id uuid references public.assistente_conversas(id) on delete set null,
  -- Quem pagou a chamada (a chave da instalação `VIX_PAGADOR` no momento).
  pagador text not null,
  provedor text,
  modelo text,
  tokens_de_entrada integer not null default 0,
  tokens_de_saida integer not null default 0,
  falhou boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.assistente_usos is
  'Uma linha por mensagem do usuário que chegou ao modelo do Vix, com os tokens. Só contagem, tokens e data: nunca texto de mensagem. A empresa lê o próprio uso; só o servidor grava. Migration 9830.';

create index if not exists idx_assistente_usos_org_tempo
  on public.assistente_usos (organization_id, created_at);

-- ---- RLS e privilégios ----

alter table public.assistente_conversas enable row level security;
alter table public.assistente_mensagens enable row level security;
alter table public.assistente_acoes enable row level security;
alter table public.assistente_estado_da_empresa enable row level security;
alter table public.assistente_progresso enable row level security;
alter table public.assistente_chamados enable row level security;
alter table public.assistente_usos enable row level security;

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

drop policy if exists tenant_isolation_assistente_usos_select on public.assistente_usos;
create policy tenant_isolation_assistente_usos_select on public.assistente_usos
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.assistente_conversas from public, anon, authenticated;
revoke all on public.assistente_mensagens from public, anon, authenticated;
revoke all on public.assistente_acoes from public, anon, authenticated;
revoke all on public.assistente_estado_da_empresa from public, anon, authenticated;
revoke all on public.assistente_progresso from public, anon, authenticated;
revoke all on public.assistente_chamados from public, anon, authenticated;
revoke all on public.assistente_usos from public, anon, authenticated;

grant select on public.assistente_conversas to authenticated;
grant select on public.assistente_mensagens to authenticated;
grant select on public.assistente_acoes to authenticated;
grant select on public.assistente_estado_da_empresa to authenticated;
grant select on public.assistente_progresso to authenticated;
grant select on public.assistente_chamados to authenticated;
grant select on public.assistente_usos to authenticated;

grant select, insert, update, delete on public.assistente_conversas to service_role;
grant select, insert, update, delete on public.assistente_mensagens to service_role;
grant select, insert, update, delete on public.assistente_acoes to service_role;
grant select, insert, update, delete on public.assistente_estado_da_empresa to service_role;
grant select, insert, update, delete on public.assistente_progresso to service_role;
grant select, insert, update, delete on public.assistente_chamados to service_role;
grant select, insert, update, delete on public.assistente_usos to service_role;

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

create or replace function public.fn_assistente_mensagens_do_mes(p_org uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
    from public.assistente_usos u
   where u.organization_id = p_org
     and u.created_at >= date_trunc('month', now());
$$;

comment on function public.fn_assistente_mensagens_do_mes(uuid) is
  'Quantas mensagens do Vix a organização já usou no mês de calendário corrente (UTC): as linhas de assistente_usos. Só o service_role executa. Migration 9830.';

revoke execute on function public.fn_assistente_mensagens_do_mes(uuid) from public, anon, authenticated;
grant execute on function public.fn_assistente_mensagens_do_mes(uuid) to service_role;

-- Registra a mensagem ANTES de chamar o modelo e devolve o id da linha de uso.
-- Não há limite de mensagens: a função só grava. Sem conseguir gravar, a
-- aplicação não chama o modelo (falha fechada).
create or replace function public.fn_assistente_registrar_mensagem(
  p_org uuid,
  p_user uuid,
  p_conversa uuid,
  p_pagador text
) returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  insert into public.assistente_usos (organization_id, user_id, conversa_id, pagador)
  values (p_org, p_user, p_conversa, p_pagador)
  returning id;
$$;

comment on function public.fn_assistente_registrar_mensagem(uuid, uuid, uuid, text) is
  'Registra uma mensagem do Vix que vai chegar ao modelo e devolve o id da linha de uso. Não aplica limite. Só o service_role executa. Migration 9830.';

revoke execute on function public.fn_assistente_registrar_mensagem(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fn_assistente_registrar_mensagem(uuid, uuid, uuid, text) to service_role;

-- Quem tem o assistente. Duas portas: a marca `isenta` (da plataforma) ou a
-- assinatura ativa, em qualquer plano. Devolve por qual porta a organização
-- entra, ou NULO quando por nenhuma, e a aplicação não responde (falha fechada).
-- As réguas de "ativa" estão no cabeçalho.
create or replace function public.fn_assistente_acesso_da_org(p_org uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.assistente_estado_da_empresa e
       where e.organization_id = p_org and e.isenta
    ) then 'marca'
    when public.fn_cobranca_ligada() and exists (
      select 1
        from public.cobranca_assinaturas a
        join public.organizations o on o.id = a.organization_id
       where a.organization_id = p_org
         and a.estado not in ('em_atraso', 'cancelada')
         and o.status = 'active'
    ) then 'assinatura_ativa'
    else null
  end;
$$;

comment on function public.fn_assistente_acesso_da_org(uuid) is
  'Por qual porta a organização tem o Vix: marca (isenta, da plataforma) ou assinatura_ativa (assinatura que não está devendo, organização operante, cobrança ligada), em qualquer plano. Nulo = não tem. Só o service_role executa. Migration 9830.';

revoke execute on function public.fn_assistente_acesso_da_org(uuid) from public, anon, authenticated;
grant execute on function public.fn_assistente_acesso_da_org(uuid) to service_role;

-- O uso do mês de calendário corrente (UTC), por organização, para a
-- administração da PLATAFORMA. Só contagem e tokens.
create or replace function public.fn_assistente_uso_do_mes()
returns table (
  organization_id uuid,
  mensagens integer,
  tokens_de_entrada bigint,
  tokens_de_saida bigint,
  falhas integer,
  usuarios integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select u.organization_id,
         count(*)::integer,
         coalesce(sum(u.tokens_de_entrada), 0)::bigint,
         coalesce(sum(u.tokens_de_saida), 0)::bigint,
         (count(*) filter (where u.falhou))::integer,
         count(distinct u.user_id)::integer
    from public.assistente_usos u
   where u.created_at >= date_trunc('month', now())
   group by u.organization_id;
$$;

comment on function public.fn_assistente_uso_do_mes() is
  'Uso do Vix no mês de calendário corrente (UTC), por organização: mensagens, tokens, falhas e pessoas. Para a administração da plataforma. Só o service_role executa. Migration 9830.';

revoke execute on function public.fn_assistente_uso_do_mes() from public, anon, authenticated;
grant execute on function public.fn_assistente_uso_do_mes() to service_role;
