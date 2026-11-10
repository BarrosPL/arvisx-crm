-- manifest: **Equipe Completa aguardando contato.** Tabela `cobranca_equipe_completa` (uma linha por entrada ou saída de uma empresa num plano com `inclui_agentes_arvisx`), preenchida por gatilho em `cobranca_assinaturas` quando o pagamento é confirmado ou o plano deixa de incluir os agentes, e o evento `cobranca.equipe_completa` no `event_log` para o aviso por e-mail à equipe. Nenhuma linha existente muda.
--
-- 9804 — o aviso à equipe quando uma empresa assina (ou deixa) o Equipe Completa.
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 a 9803.
--
-- ═══ Por quê ═══
--
-- O Equipe Completa (migration 9803, `inclui_agentes_arvisx`) é o Premium mais
-- 4 agentes de IA que a equipe cria para a empresa DEPOIS da assinatura. O CRM
-- não cria nem liga agente nenhum: ele só precisa AVISAR a equipe de que há
-- alguém para contatar, e mostrar ao cliente que o contato vem aí.
--
-- ═══ O que muda ═══
--
-- 1. `cobranca_equipe_completa` — a lista "Equipe Completa aguardando contato"
--    de /admin/cobranca, e a fonte da mensagem do cliente. Uma linha por
--    ENTRADA (pagamento confirmado num plano com os agentes) ou SAÍDA (o plano
--    trocou para um sem os agentes). `contatado_em` é marcado pela equipe na
--    tela; `equipe_avisada_em`, pelo handler do e-mail. RLS ligada: quem
--    administra a empresa LÊ as linhas dela (a mensagem "nossa equipe entrará
--    em contato"); só o service_role escreve.
--
-- 2. `fn_cobranca_equipe_completa_marcar()` — gatilho AFTER INSERT OR UPDATE em
--    `cobranca_assinaturas`, em TODO caminho que grava a assinatura (webhook,
--    releitura, troca, painel do dono). "Tem o Equipe Completa" = estado
--    `ativa`, sem `pagamento_inicial_pendente`, num plano com
--    `inclui_agentes_arvisx`. Passar a ter → ENTRADA. Trocar de um plano com os
--    agentes para um sem → SAÍDA. Uma entrada só nasce se a última linha da
--    empresa não for outra entrada (atraso que volta a "ativa" no mesmo plano
--    não avisa de novo); uma saída só nasce depois de uma entrada.
--    Cancelamento e atraso NÃO são saída: a assinatura continua no plano.
--    O gatilho NÃO faz HTTP: grava a linha e emite `cobranca.equipe_completa`
--    no `event_log`; o worker manda o e-mail (lib/cobranca/equipe-completa.ts).
--
-- ═══ Dados ═══
--
-- Tabela nova e vazia; o gatilho só age em gravações futuras. Empresas que já
-- estão num plano com os agentes ao aplicar NÃO geram aviso retroativo (nenhum
-- plano tinha o marcador antes da 9803). Nada é apagado, nem no downgrade: a
-- saída é uma linha a mais. Idempotente: `if not exists`, `create or replace`,
-- `drop ... if exists` antes de recriar policy e gatilho.

create table if not exists public.cobranca_equipe_completa (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tipo text not null check (tipo in ('entrada', 'saida')),
  plano_id uuid references public.cobranca_planos(id) on delete set null,
  -- O nome do plano na hora: a lista segue legível se o plano for renomeado ou apagado.
  plano_nome text not null,
  criado_em timestamptz not null default clock_timestamp(),
  equipe_avisada_em timestamptz,
  contatado_em timestamptz,
  contatado_por uuid references auth.users(id) on delete set null
);

create index if not exists cobranca_equipe_completa_org
  on public.cobranca_equipe_completa (organization_id, criado_em desc);
create index if not exists cobranca_equipe_completa_aguardando
  on public.cobranca_equipe_completa (criado_em) where contatado_em is null;

comment on table public.cobranca_equipe_completa is
  'Entradas e saídas do Equipe Completa (plano com inclui_agentes_arvisx), gravadas por gatilho em cobranca_assinaturas (migration 9804). Lista "aguardando contato" em /admin/cobranca; contatado_em marcado pela equipe. Informativo: não liga nem desliga agente.';

alter table public.cobranca_equipe_completa enable row level security;
drop policy if exists tenant_isolation_cobranca_equipe_completa_select on public.cobranca_equipe_completa;
create policy tenant_isolation_cobranca_equipe_completa_select on public.cobranca_equipe_completa
  for select to authenticated using (public.fn_role_at_least(organization_id, 'admin'));
revoke all on public.cobranca_equipe_completa from anon, authenticated;
grant select on public.cobranca_equipe_completa to authenticated;
grant select, insert, update, delete on public.cobranca_equipe_completa to service_role;

create or replace function public.fn_cobranca_equipe_completa_marcar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tem_agora boolean;
  v_tinha boolean := false;
  v_plano_novo_inclui boolean;
  v_plano_velho_inclui boolean := false;
  v_ultimo text;
  v_tipo text;
  v_plano_id uuid;
  v_nome text;
  v_id uuid;
begin
  select coalesce(p.inclui_agentes_arvisx, false) into v_plano_novo_inclui
    from public.cobranca_planos p where p.id = new.plano_id;
  v_plano_novo_inclui := coalesce(v_plano_novo_inclui, false);
  v_tem_agora := new.estado = 'ativa' and not coalesce(new.pagamento_inicial_pendente, false) and v_plano_novo_inclui;

  if tg_op = 'UPDATE' then
    select coalesce(p.inclui_agentes_arvisx, false) into v_plano_velho_inclui
      from public.cobranca_planos p where p.id = old.plano_id;
    v_plano_velho_inclui := coalesce(v_plano_velho_inclui, false);
    v_tinha := old.estado = 'ativa' and not coalesce(old.pagamento_inicial_pendente, false) and v_plano_velho_inclui;
  end if;

  select e.tipo into v_ultimo
    from public.cobranca_equipe_completa e
   where e.organization_id = new.organization_id
   order by e.criado_em desc, e.id desc
   limit 1;

  if v_tem_agora and not v_tinha and v_ultimo is distinct from 'entrada' then
    v_tipo := 'entrada';
    v_plano_id := new.plano_id;
  elsif tg_op = 'UPDATE' and old.plano_id is distinct from new.plano_id
        and v_plano_velho_inclui and not v_plano_novo_inclui and v_ultimo = 'entrada' then
    v_tipo := 'saida';
    v_plano_id := old.plano_id;
  else
    return null;
  end if;

  select p.nome into v_nome from public.cobranca_planos p where p.id = v_plano_id;

  insert into public.cobranca_equipe_completa (organization_id, tipo, plano_id, plano_nome)
  values (new.organization_id, v_tipo, v_plano_id, coalesce(v_nome, ''))
  returning id into v_id;

  -- O e-mail é do worker (handler `cobranca.equipe_completa`): gatilho não faz HTTP.
  insert into public.event_log (organization_id, event_type, entity_kind, entity_id, payload, metadata)
  values (
    new.organization_id, 'cobranca.equipe_completa', 'organization', new.organization_id,
    jsonb_build_object('aviso_id', v_id, 'tipo', v_tipo),
    jsonb_build_object('origem', 'gatilho_cobranca_assinaturas', 'emitted_at', extract(epoch from now()))
  );
  return null;
end;
$$;

revoke execute on function public.fn_cobranca_equipe_completa_marcar() from public, anon, authenticated;

drop trigger if exists trg_cobranca_equipe_completa on public.cobranca_assinaturas;
create trigger trg_cobranca_equipe_completa
  after insert or update of plano_id, estado, pagamento_inicial_pendente on public.cobranca_assinaturas
  for each row execute function public.fn_cobranca_equipe_completa_marcar();

notify pgrst, 'reload schema';
