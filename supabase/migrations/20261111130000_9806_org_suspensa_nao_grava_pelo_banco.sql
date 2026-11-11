-- manifest: **Empresa suspensa não grava mais pelo banco.** Toda tabela de `public` com `organization_id` que a sessão pode gravar ganha policies RESTRICTIVE para `authenticated` (`org_suspensa_nao_grava_ins`/`_upd`/`_del`, uma por verbo que a tabela abre): INSERT, UPDATE e DELETE pela sessão exigem que a empresa da linha não esteja suspensa. Service role, funções `security definer` e o dono da instalação com acesso total não são alcançados; `lgpd_requests` fica de fora (o direito do titular nunca é bloqueado). Nenhuma linha existente muda.
--
-- 9806 — a suspensão vale também para a escrita direta no banco.
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 a 9805.
--
-- ═══ Por quê (auditoria de 11/11/2026, reproduzido em produção) ═══
--
-- Com `organizations.status = 'suspended'` a API do CRM recusa tudo com 403
-- `org_suspended` (`lib/auth/require-role.ts`). Mas a suspensão não chegava à
-- API do banco: com a chave pública e a sessão de um membro, um INSERT em
-- `contacts` passava. As policies de escrita perguntam "é da sua empresa?" e
-- "seu papel alcança?", nunca "a empresa opera?". A empresa suspensa por falta
-- de pagamento seguia alimentando o cadastro por fora da tela. O upstream
-- registrou isso como decisão em aberto (D-12, `lib/organizacao/operante.ts`);
-- a decisão do dono desta instalação é fechar.
--
-- ═══ O que muda ═══
--
-- 1. `fn_orgs_que_a_sessao_nao_grava()` — as empresas SUSPENSAS de que a pessoa
--    é membro, ou nenhuma quando quem pergunta é o dono da instalação com
--    acesso total (`fn_is_platform_admin_full()`). `stable`, `security definer`.
--    EXECUTE para `authenticated` (a policy roda como ele) e `service_role`.
--    Só as da própria pessoa, de propósito: a função fica exposta como RPC, e
--    não pode listar as empresas suspensas da instalação. Quem não é membro da
--    empresa já é recusado pela policy de isolamento de cada tabela.
--
-- 2. `fn_aplicar_trava_de_org_suspensa()` — percorre as tabelas de `public` que
--    têm a coluna `organization_id` e cria nelas, onde faltar, até três
--    policies RESTRICTIVE para `authenticated` — uma por verbo que a tabela ABRE
--    à sessão com policy permissiva (a tabela que só o servidor grava não tem
--    policy de escrita, e continua sem):
--
--      org_suspensa_nao_grava_ins  for insert  with check (…)
--      org_suspensa_nao_grava_upd  for update  using (…) with check (…)
--      org_suspensa_nao_grava_del  for delete  using (…)
--
--    com `(organization_id in (select public.fn_orgs_que_a_sessao_nao_grava())) is not true`.
--    RESTRICTIVE soma por E às policies que já existem: nada que era recusado
--    passa a ser aceito. `is not true` deixa passar a linha sem empresa (coluna
--    nula, onde a tabela a permite), que não é de empresa suspensa nenhuma. A
--    subconsulta é avaliada uma vez por comando, não por linha — o mesmo molde
--    de `organization_id in (select public.fn_user_org_ids())`.
--
--    É função, e não um bloco solto, porque tabela nova nasce sem as policies.
--    Ela só cria a que FALTA (não derruba nem recria a que existe), então
--    chamá-la de novo num banco em dia não toca tabela nenhuma: o `init.sh` do
--    deploy a chama a cada subida, e a cerca
--    `tests/invariants/arvisx-org-suspensa-nao-grava-pelo-banco.test.ts`
--    reprova a tabela que ficar de fora.
--
-- ═══ O que NÃO muda ═══
--
--  · LEITURA: nenhuma policy de SELECT. O hub /account-suspended e o painel
--    de Plano e cobrança continuam lendo.
--  · Service role: ignora RLS. Webhooks de ENTRADA (WhatsApp, Meta, cobrança),
--    workers, crons e as rotas do servidor seguem gravando — a mensagem que
--    chega numa empresa suspensa continua guardada, como sempre.
--  · Funções `security definer` (LGPD, reserva, aceite de convite): rodam como
--    o dono, que não é alcançado por policy.
--  · `lgpd_requests`: fora da trava. O pedido do titular é gravado pela sessão
--    em `POST /api/v1/lgpd/requests`, rota que atende empresa suspensa de
--    propósito (`permiteOrgSuspensa`).
--  · Só `suspended`. `redacted` e `archived` têm fluxo próprio e não são
--    suspensão (`lib/organizacao/operante.ts`, `estaSuspensa`).
--  · A reativação: `fn_reativar_organizacao` troca o status e a escrita volta
--    na hora, sem nada a refazer.
--
-- Idempotente: `create or replace`, e cada policy só é criada se não existir.
-- Sem BEGIN/COMMIT.

create or replace function public.fn_orgs_que_a_sessao_nao_grava()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
    from public.organizations o
   where o.status = 'suspended'
     -- Só as de quem pergunta: a função é RPC de quem está logado, e não pode
     -- virar lista das empresas suspensas da instalação. Quem não é membro já
     -- é recusado pelas policies de isolamento de cada tabela.
     and o.id in (select public.fn_user_org_ids())
     -- Subconsulta sem correlação: avaliada no máximo uma vez, e só quando a
     -- pessoa tem alguma empresa suspensa.
     and not (select public.fn_is_platform_admin_full());
$$;

revoke all on function public.fn_orgs_que_a_sessao_nao_grava() from public, anon;
grant execute on function public.fn_orgs_que_a_sessao_nao_grava() to authenticated, service_role;

comment on function public.fn_orgs_que_a_sessao_nao_grava() is
  'As empresas SUSPENSAS de quem pergunta (nenhuma para o dono da instalação com acesso total). Lida pelas policies RESTRICTIVE org_suspensa_nao_grava_* de toda tabela com organization_id. Migration 9806.';

create or replace function public.fn_aplicar_trava_de_org_suspensa()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  t record;
  v_criadas integer := 0;
  v_regra constant text :=
    '(organization_id in (select public.fn_orgs_que_a_sessao_nao_grava())) is not true';
  v_tem_ins boolean;
  v_tem_upd boolean;
  v_tem_del boolean;
  v_abre_ins boolean;
  v_abre_upd boolean;
  v_abre_del boolean;
begin
  for t in
    select c.oid as id, c.oid::regclass as tabela
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and a.attname = 'organization_id'
       and a.attnum > 0
       and not a.attisdropped
       -- O direito do titular nunca é bloqueado: o pedido de LGPD é gravado
       -- pela sessão mesmo com a empresa suspensa.
       and c.relname <> 'lgpd_requests'
     order by c.relname
  loop
    -- Só a que falta: criar policy pede trava exclusiva na tabela, e num banco
    -- em dia esta função não deve tocar tabela nenhuma.
    --
    -- E só no verbo que a tabela ABRE à sessão: uma RESTRICTIVE só restringe o
    -- que alguma policy permissiva liberou. Tabela sem policy de escrita já não
    -- é gravável pela sessão (é do servidor), e várias delas têm por contrato
    -- "nenhuma policy" ou "nenhuma policy de escrita" — pôr uma ali não fecharia
    -- nada e quebraria esse contrato.
    select coalesce(bool_or(p.polname = 'org_suspensa_nao_grava_ins'), false),
           coalesce(bool_or(p.polname = 'org_suspensa_nao_grava_upd'), false),
           coalesce(bool_or(p.polname = 'org_suspensa_nao_grava_del'), false),
           coalesce(bool_or(p.polpermissive and p.polcmd in ('a', '*')), false),
           coalesce(bool_or(p.polpermissive and p.polcmd in ('w', '*')), false),
           coalesce(bool_or(p.polpermissive and p.polcmd in ('d', '*')), false)
      into v_tem_ins, v_tem_upd, v_tem_del, v_abre_ins, v_abre_upd, v_abre_del
      from pg_catalog.pg_policy p
     where p.polrelid = t.id;
    if v_abre_ins and not v_tem_ins then
      execute format(
        'create policy org_suspensa_nao_grava_ins on %s as restrictive for insert to authenticated with check (%s)',
        t.tabela, v_regra);
      v_criadas := v_criadas + 1;
    end if;
    if v_abre_upd and not v_tem_upd then
      execute format(
        'create policy org_suspensa_nao_grava_upd on %s as restrictive for update to authenticated using (%s) with check (%s)',
        t.tabela, v_regra, v_regra);
      v_criadas := v_criadas + 1;
    end if;
    if v_abre_del and not v_tem_del then
      execute format(
        'create policy org_suspensa_nao_grava_del on %s as restrictive for delete to authenticated using (%s)',
        t.tabela, v_regra);
      v_criadas := v_criadas + 1;
    end if;
  end loop;
  return v_criadas;
end;
$$;

-- Criar policy é do dono das tabelas: quem chama é a migração e o `init.sh` do
-- deploy, nunca um papel da API.
revoke all on function public.fn_aplicar_trava_de_org_suspensa() from public, anon, authenticated, service_role;

comment on function public.fn_aplicar_trava_de_org_suspensa() is
  'Cria, onde faltar, as policies RESTRICTIVE org_suspensa_nao_grava_ins/_upd/_del nas tabelas de public com organization_id (menos lgpd_requests), em cada verbo que a tabela abre à sessão por policy permissiva. Idempotente; devolve quantas policies criou (0 num banco em dia). Chamar de novo depois de criar tabela ou policy de escrita nova. Migration 9806.';

select public.fn_aplicar_trava_de_org_suspensa();

notify pgrst, 'reload schema';
