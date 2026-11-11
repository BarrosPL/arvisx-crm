/**
 * SEM E-MAIL CONFIRMADO NÃO HÁ EMPRESA (auditoria de 11/11/2026).
 *
 * `POST /auth/v1/signup` é público para quem tem a chave do navegador. Com a
 * confirmação automática do GoTrue ligada (`ENABLE_EMAIL_AUTOCONFIRM=true`),
 * quem chamasse o provedor direto saía com sessão e abria empresa em teste sem
 * nunca ter recebido um e-mail. A chave do GoTrue é configuração de quem
 * hospeda; a recusa aqui é do código, e vale com qualquer configuração.
 *
 * O dado é `auth.users.email_confirmed_at`, lido do usuário que o PRÓPRIO
 * provedor devolveu (`getUser`, `verifyOtp`, `admin.getUserById`,
 * `admin.listUsers`) — nunca de formulário, nunca do `user_metadata` (que a
 * pessoa edita). Este módulo não confirma e-mail de ninguém; só confere.
 *
 * Mora fora de `lib/auth/provision.ts` para que tela, action e rota perguntem
 * sem carregar o provisionamento inteiro.
 */

/** O provedor de auth confirmou o e-mail desta conta? Ausente vale como NÃO. */
export function emailConfirmado(user: { email_confirmed_at?: string | null } | null | undefined): boolean {
  return typeof user?.email_confirmed_at === "string" && user.email_confirmed_at.trim() !== "";
}

/** A conta ainda não provou o e-mail, então não ganha empresa (nem teste grátis). */
export class EmailNaoConfirmadoError extends Error {
  constructor() {
    super("email_nao_confirmado");
    this.name = "EmailNaoConfirmadoError";
  }
}
