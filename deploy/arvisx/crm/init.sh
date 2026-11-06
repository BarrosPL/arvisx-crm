#!/bin/sh
# Prepara o banco do CRM (idempotente): extensoes + baseline.sql + chaves de cifra + primeiro admin.
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

# Migracoes posteriores ao baseline (a imagem stable do upstream e mais nova que o baseline do fork).
# Lista em migracoes-pos-baseline.txt; cada arquivo roda uma vez, em transacao, e fica registrado.
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -c \
  "create table if not exists public.arvisx_migracoes_aplicadas (nome text primary key, aplicada_em timestamptz not null default now());"
pend=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  ja="$(psql "$SUPABASE_DB_URL" -tAc "select 1 from public.arvisx_migracoes_aplicadas where nome = '$f'")"
  [ "$ja" = "1" ] || pend="$pend $f"
done < /migracoes-pos-baseline.txt
if [ -n "$pend" ]; then
  mkdir -p /backup
  bk="/backup/antes-migracoes-$(date +%Y%m%d-%H%M%S).dump"
  log "backup do banco em $bk"
  # Falha aqui NAO derruba o deploy: o CRM sobe no schema atual (cada arquivo roda em transacao unica).
  if pg_dump -Fc -d "$SUPABASE_DB_URL" -f "$bk"; then
    for f in $pend; do
      log "aplicando $f"
      if psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -1 -f "/migrations/$f"; then
        psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -c "insert into public.arvisx_migracoes_aplicadas (nome) values ('$f')"
      else
        log "FALHOU: $f (parei aqui; as seguintes ficam pendentes)"; break
      fi
    done
    log "fim das migracoes"
  else
    log "backup falhou; nao migrei nada"
  fi
else
  log "sem migracoes pendentes"
fi

# Chaves de cifra em private.app_secrets: as funcoes de cifra do banco leem de la
# (fn_encrypt_oauth -> nuvemshop_oauth_key; encrypt_cpf -> cpf_key). O kit original
# semeia no install.sh/update.sh (ensure_encryption_key, hostgator-setup-kit/_common.sh);
# o Easypanel nao roda o kit, entao sem isto salvar SMTP em /admin/email dava "a cifra
# esta indisponivel nesta instalacao". Grava a partir da env SO se a linha nao existir:
# trocar uma chave que ja existe inutiliza todo segredo cifrado com ela.
semear_chave() { # semear_chave <nome no banco> <valor> <nome da env>
  if [ -z "$2" ]; then
    log "AVISO: $3 vazia no init; $1 nao semeada (as funcoes de cifra seguem sem chave)"
    return 0
  fi
  if [ "${#2}" -lt 32 ]; then
    log "AVISO: $3 tem menos de 32 caracteres; $1 nao semeada (fn_encrypt_oauth a recusaria)"
    return 0
  fi
  r="$(psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -qtA -v nome="$1" -v valor="$2" <<'SQL'
with novo as (
  insert into private.app_secrets (name, value) values (:'nome', :'valor')
  on conflict (name) do nothing
  returning 1
)
select case
  when exists (select 1 from novo) then 'gravada'
  when (select value from private.app_secrets where name = :'nome') = :'valor' then 'igual'
  else 'diferente'
end;
SQL
)"
  case "$r" in
    gravada) log "chave $1 gravada a partir de $3" ;;
    igual) log "chave $1 ja existe (igual a $3)" ;;
    diferente) log "AVISO: chave $1 ja existe e DIFERE de $3; mantive a do banco (trocar inutiliza os segredos cifrados)" ;;
    *) log "AVISO: resposta inesperada ao semear $1: $r" ;;
  esac
}
if [ "$(psql "$SUPABASE_DB_URL" -tAc "select to_regclass('private.app_secrets') is not null")" = "t" ]; then
  semear_chave nuvemshop_oauth_key "${NUVEMSHOP_OAUTH_ENCRYPTION_KEY:-}" NUVEMSHOP_OAUTH_ENCRYPTION_KEY
  semear_chave cpf_key "${CPF_ENCRYPTION_KEY:-}" CPF_ENCRYPTION_KEY
else
  log "AVISO: private.app_secrets nao existe; chaves de cifra nao semeadas"
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
