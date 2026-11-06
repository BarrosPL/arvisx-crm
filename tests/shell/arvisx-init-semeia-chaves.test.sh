#!/usr/bin/env bash
# Deploy Easypanel do fork (deploy/arvisx/crm): o serviço `init` semeia as
# chaves de cifra em private.app_secrets.
#
# O DEFEITO: o kit original semeia `nuvemshop_oauth_key` e `cpf_key` no
# install.sh/update.sh (`ensure_encryption_key`, hostgator-setup-kit/_common.sh);
# o Easypanel não roda o kit. Sem a linha, `fn_encrypt_oauth` lança
# "NUVEMSHOP_OAUTH_ENCRYPTION_KEY ausente" e salvar o SMTP em /admin/email
# respondia "a cifra está indisponível nesta instalação" (medido em 06/11/2026).
#
# O QUE ESTÁ SOB PROVA: a função `semear_chave` do init.sh, extraída do próprio
# arquivo e rodada contra um `psql` dublê que guarda a tabela em disco.
#   1. linha ausente: grava a partir da env;
#   2. linha igual: não mexe;
#   3. linha DIFERENTE: NÃO sobrescreve (trocar a chave inutiliza tudo o que já
#      foi cifrado com ela) e avisa no log — ao contrário do kit, que faz
#      `do update`, porque lá a env e o banco nascem juntos;
#   4. env vazia ou com menos de 32 caracteres: não grava nada;
#   5. o SQL de verdade usa `on conflict (name) do nothing` e nunca `do update`;
#   6. o compose entrega as duas envs ao serviço `init`.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
INIT="$ROOT_DIR/deploy/arvisx/crm/init.sh"
COMPOSE="$ROOT_DIR/deploy/arvisx/crm/docker-compose.easypanel.yml"
FAILS=0

check() {
  local descricao="$1"
  shift
  if "$@"; then
    printf '  ✓ %s\n' "$descricao"
  else
    printf '  ✗ %s\n' "$descricao"
    FAILS=$((FAILS + 1))
  fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin" "$WORK/db"

# ── Dublê de psql ───────────────────────────────────────────────────────────
# Sem `-c`: é a semeadura (SQL pela entrada). Imita o `insert ... on conflict
# do nothing` + o `case` de resposta, com a tabela em $WORK/db/<nome>.
# Com `-c`: só a pergunta `to_regclass`, respondida por $TABELA_EXISTE.
cat > "$WORK/bin/psql" <<'DUBLE'
#!/usr/bin/env bash
nome=""; valor=""; cmd=""
while [ $# -gt 0 ]; do
  case "$1" in
    -v) case "$2" in nome=*) nome="${2#nome=}" ;; valor=*) valor="${2#valor=}" ;; esac; shift 2 ;;
    -c|-tAc) cmd="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -n "$cmd" ]; then
  echo "${TABELA_EXISTE:-t}"; exit 0
fi
sql="$(cat)"
printf '%s\n' "$sql" > "$DB_DIR/ultimo.sql"
f="$DB_DIR/$nome"
if [ ! -f "$f" ]; then printf '%s' "$valor" > "$f"; echo gravada
elif [ "$(cat "$f")" = "$valor" ]; then echo igual
else echo diferente
fi
DUBLE
chmod +x "$WORK/bin/psql"
export PATH="$WORK/bin:$PATH" DB_DIR="$WORK/db" SUPABASE_DB_URL="postgres://dubl/e"

# A função e o bloco que a chama, tirados do init.sh (do `semear_chave()` até
# antes do `apk add`), para provar o arquivo que vai para produção.
awk '/^semear_chave\(\)/{p=1} /^apk add/{p=0} p' "$INIT" > "$WORK/trecho.sh"
check "o init.sh tem a função semear_chave" grep -q 'semear_chave nuvemshop_oauth_key' "$WORK/trecho.sh"

rodar() { # rodar <NUVEMSHOP> <CPF>
  ( log() { echo "[init] $*"; }
    NUVEMSHOP_OAUTH_ENCRYPTION_KEY="$1" CPF_ENCRYPTION_KEY="$2"
    set -eu
    . "$WORK/trecho.sh" ) 2>&1
}

K1="$(printf 'a%.0s' $(seq 1 64))"
K2="$(printf 'b%.0s' $(seq 1 64))"
CPF="$(printf 'c%.0s' $(seq 1 44))"

echo "1. linha ausente: grava"
out="$(rodar "$K1" "$CPF")"
check "nuvemshop_oauth_key gravada com o valor da env" test "$(cat "$WORK/db/nuvemshop_oauth_key")" = "$K1"
check "cpf_key gravada com o valor da env" test "$(cat "$WORK/db/cpf_key")" = "$CPF"
check "o log diz que gravou" grep -q 'chave nuvemshop_oauth_key gravada' <<<"$out"

echo "2. linha igual: não mexe"
out="$(rodar "$K1" "$CPF")"
check "o log diz que já existe igual" grep -q 'nuvemshop_oauth_key ja existe (igual' <<<"$out"
check "valor segue o mesmo" test "$(cat "$WORK/db/nuvemshop_oauth_key")" = "$K1"

echo "3. linha diferente: NÃO sobrescreve"
out="$(rodar "$K2" "$CPF")"
check "o valor do banco continua o antigo" test "$(cat "$WORK/db/nuvemshop_oauth_key")" = "$K1"
check "o log avisa que difere e manteve o do banco" grep -q 'AVISO: chave nuvemshop_oauth_key ja existe e DIFERE' <<<"$out"

echo "4. env vazia ou curta: não grava"
rm -f "$WORK/db/"*
out="$(rodar "" "curta")"
check "nada gravado" test -z "$(ls "$WORK/db")"
check "avisa a env vazia" grep -q 'AVISO: NUVEMSHOP_OAUTH_ENCRYPTION_KEY vazia' <<<"$out"
check "avisa a env curta" grep -q 'AVISO: CPF_ENCRYPTION_KEY tem menos de 32' <<<"$out"

echo "   tabela ausente: avisa e segue"
out="$(TABELA_EXISTE=f rodar "$K1" "$CPF")"
check "não grava e avisa" bash -c "test -z \"\$(ls '$WORK/db')\" && grep -q 'app_secrets nao existe' <<<'$out'"

echo "5. o SQL de verdade"
rodar "$K1" "$CPF" >/dev/null
check "usa on conflict (name) do nothing" grep -q 'on conflict (name) do nothing' "$WORK/db/ultimo.sql"
check "nunca do update" bash -c "! grep -qi 'do update' '$WORK/db/ultimo.sql'"
check "valor vai por variável do psql, não interpolado" grep -q ":'valor'" "$WORK/db/ultimo.sql"

echo "6. o compose entrega as envs ao init"
bloco_init="$(awk '/^  init:/{p=1;print;next} p&&/^  [a-z][a-z0-9-]*:$/{exit} p' "$COMPOSE")"
check "NUVEMSHOP_OAUTH_ENCRYPTION_KEY no init" grep -q 'NUVEMSHOP_OAUTH_ENCRYPTION_KEY: \${NUVEMSHOP_OAUTH_ENCRYPTION_KEY:-}' <<<"$bloco_init"
check "CPF_ENCRYPTION_KEY no init" grep -q 'CPF_ENCRYPTION_KEY: \${CPF_ENCRYPTION_KEY:-}' <<<"$bloco_init"

if [ "$FAILS" -gt 0 ]; then
  echo "FALHOU: $FAILS verificação(ões)"
  exit 1
fi
echo "ok"
