-- manifest: **Telas do plano.** `cobranca_planos.interface_settings` guarda as telas que o plano libera (`preset` + `destinos`, o MESMO formato do `InterfaceEditor` de /admin/tenants/new; default = completa) e duas funções de leitura, `fn_telas_do_plano(org)` (servidor) e `fn_telas_do_plano_da_sessao(org)` (sessão), alimentam a trava de páginas, API e motor de IA. Nenhuma linha muda de valor.
--
-- 9802 — as telas que cada plano libera, e a leitura única delas.
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 e da 9801.
--
-- ═══ O que muda ═══
--
-- 1. `cobranca_planos.interface_settings jsonb not null default '{"preset":"completa"}'`.
--    É o recorte de telas do PLANO, no formato de `organizations.interface_settings`
--    e `user_organizations.interface_settings` — só `preset` e `destinos` valem aqui
--    (`bloquearAteAssumir` e `compras_campos` são preferência da empresa, não do
--    plano). Quem valida o conteúdo é o TypeScript (`interfaceDoPlanoSchema`, em
--    lib/schemas/cobranca-plano.ts, montado do mesmo `interfaceSettingsSchema`);
--    o banco só garante que é um objeto. Todo plano existente nasce `completa`:
--    nenhuma empresa perde tela ao aplicar esta migration.
--
-- 2. `fn_telas_do_plano(p_org)` — a LEITURA ÚNICA: `{"restrito": false}` quando a
--    cobrança está desligada na instalação (`fn_cobranca_ligada`) ou a empresa não
--    tem linha em `cobranca_assinaturas` (isenta — a mesma régua de
--    `fn_limite_do_plano`); `{"restrito": true, "interface": <do plano>}` quando
--    tem. Quem transforma isso em lista de telas é
--    lib/cobranca/telas-do-plano.ts (`destinosDoPlano`), num lugar só. Só o
--    service_role a chama (layout, rotas de API, motor de IA, crons).
--
-- 3. `fn_telas_do_plano_da_sessao(p_org)` — a mesma resposta para a SESSÃO, usada
--    pelo `proxy.ts` (que só tem o cliente da sessão). `p_org` vem do cookie
--    `active_org` e por isso NÃO é confiável: a função só o aceita se a pessoa é
--    membro ativo dele; senão escolhe a organização como `escolherMembroAtivo`
--    (lib/auth/server.ts): a primeira OPERANTE por `accepted_at` (nulos
--    primeiro) e `organization_id`, e a primeira de todas quando nenhuma opera.
--    Em acompanhamento ativo (`fn_support_context`), vale a organização
--    acompanhada. Sem usuário ou sem organização: `null` (o app decide).
--
-- ═══ Dados ═══
--
-- Nenhuma linha é apagada nem alterada (só ganha o default). Trocar o plano de uma
-- empresa para um com menos telas NÃO apaga dado nenhum: as telas somem e as rotas
-- respondem `fora_do_plano`, e ao voltar para um plano maior tudo reaparece.
--
-- Idempotente: `add column if not exists`, `create or replace function`, e os
-- constraints com `drop ... if exists` antes do `add`.

alter table public.cobranca_planos
  add column if not exists interface_settings jsonb not null default '{"preset":"completa"}'::jsonb;

alter table public.cobranca_planos
  drop constraint if exists cobranca_planos_interface_settings_objeto;

alter table public.cobranca_planos
  add constraint cobranca_planos_interface_settings_objeto
  check (jsonb_typeof(interface_settings) = 'object');

comment on column public.cobranca_planos.interface_settings is
  'Telas que o plano libera (migration 9802): preset completa|simplificada e, opcional, destinos (hrefs do catálogo lib/navigation/catalogo.ts). Mesmo formato do InterfaceEditor. As portas essenciais (perfil, segurança, equipe, plano e cobrança, ajuda) valem em todo plano. Validado em lib/schemas/cobranca-plano.ts; lido por fn_telas_do_plano.';

create or replace function public.fn_telas_do_plano(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_org is null or not public.fn_cobranca_ligada() then jsonb_build_object('restrito', false)
    else coalesce(
      (select jsonb_build_object('restrito', true, 'interface', p.interface_settings)
         from public.cobranca_assinaturas a
         join public.cobranca_planos p on p.id = a.plano_id
        where a.organization_id = p_org),
      jsonb_build_object('restrito', false)
    )
  end;
$$;

revoke execute on function public.fn_telas_do_plano(uuid) from public, anon, authenticated;
grant execute on function public.fn_telas_do_plano(uuid) to service_role;

create or replace function public.fn_telas_do_plano_da_sessao(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_suporte jsonb;
  v_org uuid;
begin
  if v_uid is null then
    return null;
  end if;
  v_suporte := public.fn_support_context();
  if v_suporte is not null then
    -- Acompanhamento encerrado: o app manda para /support-ended; aqui não se decide.
    if v_suporte->>'status' is distinct from 'active' then
      return null;
    end if;
    return public.fn_telas_do_plano((v_suporte->>'organization_id')::uuid);
  end if;
  if p_org is not null then
    select uo.organization_id into v_org
      from public.user_organizations uo
     where uo.user_id = v_uid and uo.revoked_at is null and uo.organization_id = p_org;
  end if;
  if v_org is null then
    select uo.organization_id into v_org
      from public.user_organizations uo
      join public.organizations o on o.id = uo.organization_id
     where uo.user_id = v_uid and uo.revoked_at is null
     order by (o.status = 'active') desc, uo.accepted_at asc nulls first, uo.organization_id asc
     limit 1;
  end if;
  if v_org is null then
    return null;
  end if;
  return public.fn_telas_do_plano(v_org);
end;
$$;

revoke execute on function public.fn_telas_do_plano_da_sessao(uuid) from public, anon;
grant execute on function public.fn_telas_do_plano_da_sessao(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
