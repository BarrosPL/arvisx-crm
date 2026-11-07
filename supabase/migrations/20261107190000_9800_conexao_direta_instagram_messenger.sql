-- manifest: **Instagram e Messenger conectam DIRETO na Meta, sem parceiro.** Provider novo `meta_social` em `channel_sessions` (CHECK e ref CHECK), com as colunas `meta_social_account_id` (o id da conta que endereça webhook e envio: página no Messenger, conta profissional no Instagram), `meta_social_page_id` e `meta_social_token_encrypted` (token da página, cifrado por fn_encrypt_oauth); índice único entre ativas; a trava do gatilho 9104 passa a cobrir as três colunas; `platform_meta_app.app_id` guarda o identificador público do app da Meta que a instalação já cadastra.
--
-- 9800 — conexão direta do Instagram e do Facebook Messenger.
--
-- Número alto de propósito: este fork (ArvisX CRM) acompanha o upstream, que
-- aloca a faixa 92xx em rodadas. Uma migration só do fork no meio dessa faixa
-- colidiria no próximo merge do upstream.
--
-- ═══ O que entra ═══
--
-- Um provedor de canal de MENSAGEM novo, ao lado de `zernio_social`: as mesmas
-- redes (Instagram e Facebook), sem o intermediário. A organização autoriza as
-- páginas pelo login do Facebook, com o App da Meta que a instalação JÁ cadastra
-- para o canal oficial do WhatsApp (`platform_meta_app`, migration 0257): não há
-- segundo cadastro de app. O que faltava nele era o App ID, que é público (vai
-- na URL do login) e por isso fica em claro.
--
-- Colunas próprias, como o Datafy fez (0387), e não reaproveitar as do canal
-- oficial: o `ref CHECK` é uma união etiquetada — a coluna do provider da vez é
-- obrigatória —, e duas conexões da mesma organização podem conviver.
--
--   meta_social_account_id       o id que a Meta põe em `entry.id` do webhook:
--                                a PÁGINA no Messenger, a CONTA PROFISSIONAL
--                                no Instagram. É o `sessionRef` da sessão e a
--                                chave do roteamento do webhook à organização.
--   meta_social_page_id          a página por onde as duas redes enviam e onde
--                                o app é assinado (no Messenger é igual ao de
--                                cima; no Instagram é a página ligada à conta).
--   meta_social_token_encrypted  o token da página, cifrado por fn_encrypt_oauth.
--
-- ═══ Índice único entre ativas ═══
--
-- O webhook da Meta é UM para a instalação inteira: a organização sai do
-- `entry.id`. Duas sessões ativas com o mesmo id tornariam o roteamento
-- ambíguo (e a mensagem de uma empresa poderia cair na outra). Mesma dedup com
-- sufixo `-conflito-<id>` da 0165/0387, para a primeira passada ser idempotente.
--
-- ═══ A ligação com a Meta é do servidor ═══
--
-- `channel_sessions` tem GRANT ALL para `authenticated`. Sem a trava, o admin de
-- uma organização gravaria pela API do banco uma sessão com o id da página de
-- OUTRA empresa e passaria a receber as mensagens dela. O corpo abaixo é o da
-- 9104 inteiro, mais as três colunas — o gatilho já existe desde a 9093.
--
-- ═══ Reversão ═══
--
--   drop index if exists public.channel_sessions_meta_social_account_ativo_unique;
--   -- arquivar/excluir as sessões `meta_social` antes de estreitar os CHECKs;
--   -- recriar os dois CHECKs sem `meta_social`; reaplicar a função da 9104;
--   alter table public.channel_sessions drop column if exists meta_social_account_id,
--     drop column if exists meta_social_page_id, drop column if exists meta_social_token_encrypted;
--   alter table public.platform_meta_app drop column if exists app_id;
--
-- Alargamento puro nos CHECKs: uma linha que passava continua passando, então
-- não há dado a corrigir antes deles.

alter table public.channel_sessions
  add column if not exists meta_social_account_id text,
  add column if not exists meta_social_page_id text,
  add column if not exists meta_social_token_encrypted bytea;

comment on column public.channel_sessions.meta_social_account_id is
  'Conexão direta com a Meta (provider meta_social): id da página (Messenger) ou da conta profissional (Instagram). É o sessionRef e a chave do roteamento do webhook. Espelhado em lib/channels/session-ref.ts. Migration 9800.';
comment on column public.channel_sessions.meta_social_page_id is
  'Página do Facebook por onde a conexão direta envia e onde o app da instalação é assinado. Migration 9800.';
comment on column public.channel_sessions.meta_social_token_encrypted is
  'Token da página (conexão direta com a Meta), cifrado por fn_encrypt_oauth. Nunca volta à tela. Apagado ao desconectar. Migration 9800.';

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_check
    check (provider in ('waha', 'meta_cloud', 'zernio', 'zernio_social', 'wacalls', 'datafy', 'meta_social'));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_ref_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_ref_check check (
    (provider = 'waha' and waha_session_name is not null) or
    (provider = 'meta_cloud' and meta_phone_number_id is not null) or
    (provider in ('zernio', 'zernio_social') and zernio_account_id is not null) or
    (provider = 'wacalls' and wacalls_session_id is not null) or
    (provider = 'datafy' and datafy_phone_number_id is not null) or
    (provider = 'meta_social' and meta_social_account_id is not null)
  );

with ativos as (
  select id,
         row_number() over (
           partition by meta_social_account_id
           order by created_at desc nulls last, id desc
         ) as posicao
    from public.channel_sessions
   where archived_at is null
     and meta_social_account_id is not null
)
update public.channel_sessions s
   set meta_social_account_id = s.meta_social_account_id || '-conflito-' || s.id::text
  from ativos a
 where a.id = s.id
   and a.posicao > 1;

create unique index if not exists channel_sessions_meta_social_account_ativo_unique
  on public.channel_sessions (meta_social_account_id)
  where archived_at is null and meta_social_account_id is not null;

alter table public.platform_meta_app
  add column if not exists app_id text;

comment on column public.platform_meta_app.app_id is
  'App ID do app da Meta da instalação. Público (vai na URL do login do Facebook); usado pela conexão direta do Instagram e do Messenger. Migration 9800.';

create or replace function public.fn_channel_sessions_ligacao_ao_provedor_e_do_servidor()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user not in ('authenticated', 'anon') then
    -- `new` é nulo no DELETE: devolvê-lo cancelaria a exclusão do servidor.
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.zernio_credencial_da_instalacao then
      raise exception 'canal_ligacao_ao_provedor_e_do_servidor' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.zernio_credencial_da_instalacao
       or new.zernio_account_id is not null
       or new.zernio_profile_id is not null
       or new.zernio_webhook_id is not null
       -- 9104: a credencial do número oficial também é do servidor.
       or new.meta_token_encrypted is not null
       or new.meta_phone_number_id is not null
       or new.meta_waba_id is not null
       -- 9800: a conexão direta do Instagram e do Messenger também.
       or new.meta_social_account_id is not null
       or new.meta_social_page_id is not null
       or new.meta_social_token_encrypted is not null then
      raise exception 'canal_ligacao_ao_provedor_e_do_servidor' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.zernio_credencial_da_instalacao, new.zernio_account_id, new.zernio_profile_id, new.zernio_webhook_id)
       is distinct from
     (old.zernio_credencial_da_instalacao, old.zernio_account_id, old.zernio_profile_id, old.zernio_webhook_id)
     -- 9104: a credencial do número oficial também é do servidor.
     or (new.meta_token_encrypted, new.meta_phone_number_id, new.meta_waba_id)
       is distinct from
     (old.meta_token_encrypted, old.meta_phone_number_id, old.meta_waba_id)
     -- 9800: a conexão direta do Instagram e do Messenger também.
     or (new.meta_social_account_id, new.meta_social_page_id, new.meta_social_token_encrypted)
       is distinct from
     (old.meta_social_account_id, old.meta_social_page_id, old.meta_social_token_encrypted)
     or (old.zernio_credencial_da_instalacao and
         (new.archived_at, new.provider, new.organization_id, new.phone_number)
           is distinct from
         (old.archived_at, old.provider, old.organization_id, old.phone_number)) then
    raise exception 'canal_ligacao_ao_provedor_e_do_servidor' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_channel_sessions_ligacao_ao_provedor_e_do_servidor() from public, anon, authenticated;

notify pgrst, 'reload schema';
