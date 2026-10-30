#!/bin/sh
# Prepara o banco do CRM (idempotente): extensoes + baseline.sql + primeiro admin.
# Roda dentro do postgres:17-alpine, uma vez por deploy.
set -eu
log() { echo "[init] $*"; }

log "aguardando o banco"
n=0
until pg_isready -d "$SUPABASE_DB_URL" >/dev/null 2>&1; do
  n=$((n + 1)); [ "$n" -gt 60 ] && { log "banco nao respondeu em 3 min"; exit 1; }
  sleep 3
done

if [ "$(psql "$SUPABASE_DB_URL" -tAc "select to_regclass('public.organizations') is not null")" = "t" ]; then
  log "schema ja existe: pulando baseline"
else
  log "aplicando extensoes e baseline.sql (pode levar 1-2 min)"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -c \
    "create extension if not exists vector with schema public; create extension if not exists citext with schema public; create extension if not exists pg_trgm with schema public;"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f /baseline.sql
  log "baseline aplicado"
fi

apk add --no-cache curl >/dev/null 2>&1 || { log "nao consegui instalar curl"; exit 1; }
log "aguardando o Auth"
n=0
until curl -fsS -o /dev/null -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_INTERNAL_URL/auth/v1/health"; do
  n=$((n + 1)); [ "$n" -gt 40 ] && { log "Auth nao respondeu"; exit 1; }
  sleep 3
done

log "criando o admin (se ainda nao existir)"
curl -sS -o /dev/null -X POST "$SUPABASE_INTERNAL_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PASSWORD\",\"email_confirm\":true,\"user_metadata\":{\"locale\":\"pt-BR\"}}" || true

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$
declare v_org uuid; v_uid uuid;
begin
  select id into v_uid from auth.users where email = '$OWNER_EMAIL';
  if v_uid is null then
    raise exception 'usuario % nao encontrado no auth.users', '$OWNER_EMAIL';
  end if;
  select id into v_org from public.organizations where slug = 'minha-empresa';
  if v_org is null then
    insert into public.organizations (slug, display_name, legal_name, locale, created_by)
    values ('minha-empresa', 'Minha Empresa', 'Minha Empresa', 'pt-BR', v_uid)
    returning id into v_org;
  end if;
  insert into public.user_organizations (user_id, organization_id, role, accepted_at)
  values (v_uid, v_org, 'admin', now())
  on conflict (user_id, organization_id) do update set role = 'admin', revoked_at = null;
  if not exists (select 1 from public.platform_admins where user_id = v_uid and revoked_at is null) then
    insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason)
    values (v_uid, v_uid, 'full', false, 'Bootstrap inicial (Arvisx)');
  end if;
end \$\$;
SQL
log "pronto"
