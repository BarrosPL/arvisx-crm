# Cifra de configurações no deploy Easypanel

## O defeito (medido em 06/11/2026)

Salvar o SMTP em `/admin/email` respondia "a cifra está indisponível nesta instalação".
`public.fn_encrypt_oauth` lê a chave de `private.app_secrets` (linha `nuvemshop_oauth_key`) e lança
`NUVEMSHOP_OAUTH_ENCRYPTION_KEY ausente` quando a linha não existe. O kit original semeia essa linha
(e a `cpf_key`) no `install.sh`/`update.sh` (`ensure_encryption_key`, `hostgator-setup-kit/_common.sh`).
O deploy Easypanel (`deploy/arvisx/crm`) não roda o kit, então a linha nunca nasceu.

Efeito colateral: o Salvar seguinte, sem senha, gravava uma linha em `platform_smtp_settings` com
`smtp_password_encrypted` nulo. Como o banco vence o `.env` em `lerConfiguracao`, o envio passava a
falhar na autenticação.

## O conserto

1. **Semeadura no serviço `init`** (`deploy/arvisx/crm/init.sh`, função `semear_chave`), a cada deploy:
   - linha ausente: grava a partir da env (`NUVEMSHOP_OAUTH_ENCRYPTION_KEY` e `CPF_ENCRYPTION_KEY`);
   - linha igual: não mexe;
   - linha **diferente**: **não sobrescreve** e escreve `AVISO ... DIFERE` no log. Trocar a chave
     inutiliza todo segredo já cifrado com ela. (O kit faz `do update`; aqui não.)
   - env vazia ou com menos de 32 caracteres: não grava e avisa.

   O compose passa as duas envs ao `init` (`${VAR:-}`, as mesmas do `.env` do `crm`).
   Teste: `bash tests/shell/arvisx-init-semeia-chaves.test.sh` (também no `pnpm test:shell`).

2. **Salvar SMTP sem senha é recusado** quando há usuário, nenhuma senha nova e nenhuma senha já
   guardada (`lib/email/config.ts`, `MENSAGEM_DA_SENHA_OBRIGATORIA`). Relé sem autenticação (sem
   usuário), apagar a configuração (endereço vazio) e salvar sem redigitar uma senha já guardada
   continuam aceitos. Teste: `app/actions/settings/smtp.test.ts`.

## Verificação depois do deploy

1. Confirme que o `.env` do projeto tem `NUVEMSHOP_OAUTH_ENCRYPTION_KEY` com 32 caracteres ou mais
   (e, se usar CPF, `CPF_ENCRYPTION_KEY`).
2. Redeploy do `crm`. No log do serviço `init` deve aparecer uma destas linhas:
   - `[init] chave nuvemshop_oauth_key gravada a partir de NUVEMSHOP_OAUTH_ENCRYPTION_KEY` (primeira vez);
   - `[init] chave nuvemshop_oauth_key ja existe (igual a NUVEMSHOP_OAUTH_ENCRYPTION_KEY)` (deploys seguintes).

   Se aparecer `AVISO: chave nuvemshop_oauth_key ja existe e DIFERE`, **pare**: o banco tem outra
   chave. Não apague a linha sem antes saber o que foi cifrado com ela.
3. A cifra responde (service role, pela API do Supabase):

   ```bash
   curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/fn_encrypt_oauth" \
     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"plaintext":"teste"}'
   ```

   Esperado: HTTP 200 com um valor `"\\x..."` (o bytea cifrado). Antes do conserto vinha erro com
   `NUVEMSHOP_OAUTH_ENCRYPTION_KEY ausente`.
4. Se o Salvar antigo deixou uma linha incompleta em `platform_smtp_settings`, abra `/admin/email`,
   preencha a senha e salve de novo (ou apague a configuração para voltar ao `.env`).
5. Salve o SMTP pela tela com a senha: deve dizer salvo, sem erro de cifra, e o "esqueci a senha"
   continua chegando.
