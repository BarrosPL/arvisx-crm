import type { MarcaDeSaida } from "@/lib/branding/saida";
import { estruturaDeEmail } from "./estrutura";

/**
 * Os dois e-mails de ACESSO — confirmar conta e redefinir senha — no formato
 * que o GoTrue renderiza.
 *
 * ─── POR QUE ISTO É DIFERENTE DE `invite.ts` ────────────────────────────────
 *
 * O convite de time é montado e ENVIADO por nós. Estes dois não: quem os
 * renderiza e envia é o GoTrue, um processo de terceiro. Nós só entregamos o
 * MOLDE, e ele preenche `{{ .RedirectTo }}` e `{{ .TokenHash }}` na hora do
 * envio. Por isso a saída aqui é uma string de template Go, não um e-mail
 * pronto — e por isso as chaves duplas NÃO passam por escape: elas são sintaxe
 * do renderizador, não dado.
 *
 * ─── POR QUE `token_hash` E NÃO `{{ .ConfirmationURL }}` ────────────────────
 *
 * O modelo PADRÃO do GoTrue linka para `/auth/v1/verify`, que devolve um `code`
 * PKCE. O verificador desse code vive num cookie `SameSite=Strict`
 * (`lib/supabase/server.ts`), e clique vindo de webmail é navegação
 * cross-site: o cookie não viaja, `exchangeCodeForSession` falha, e a conta é
 * confirmada sem que a sessão feche. `token_hash` não depende de cookie nenhum.
 *
 * Medido numa instalação self-hosted em 2026-09-10: com o modelo padrão, o
 * `api_audit_log` registrava `auth.email_link_rejected` com
 * `"PKCE code verifier not found in storage"`; com estes moldes, o mesmo fluxo
 * fecha a sessão.
 *
 * ─── `&`, NUNCA `?` ────────────────────────────────────────────────────────
 *
 * `.RedirectTo` já chega com `?type=` embutido — `signUp.ts` e
 * `requestPasswordReset.ts` o anexam de propósito, porque é o único jeito de o
 * `type` sobreviver ao hop pelo GoTrue no outro formato. Um `?` aqui duplicaria
 * o separador e o parser de URL do browser pararia de reconhecer `token_hash`.
 */

export type ModeloDeAcesso = "confirmation" | "recovery";

export const MODELOS_DE_ACESSO: readonly ModeloDeAcesso[] = ["confirmation", "recovery"];

/** O texto de cada modelo. Assunto entra no `GOTRUE_MAILER_SUBJECTS_*`. */
const COPIA: Record<
  ModeloDeAcesso,
  {
    assunto: (marca: string) => string;
    preheader: (marca: string) => string;
    etiqueta: string;
    titulo: string;
    corpo: (marca: string) => string;
    botao: string;
    nota: string;
    rodape: string;
  }
> = {
  confirmation: {
    assunto: (marca) => `Confirme seu e-mail · ${marca}`,
    preheader: (marca) => `Confirme seu e-mail para ativar sua conta no ${marca}.`,
    etiqueta: "Bem-vindo",
    titulo: "Confirme seu e-mail",
    corpo: (marca) =>
      `Sua conta no ${marca} está quase pronta. Clique no botão abaixo para confirmar seu e-mail e ativar o acesso.`,
    botao: "Confirmar e-mail",
    nota: "Depois de confirmar, é só entrar e começar a atender.",
    rodape: "Não criou esta conta? Pode ignorar este e-mail com tranquilidade.",
  },
  recovery: {
    assunto: (marca) => `Redefinir sua senha · ${marca}`,
    preheader: (marca) => `Defina uma nova senha para acessar o ${marca}.`,
    etiqueta: "Segurança da conta",
    titulo: "Vamos redefinir sua senha",
    corpo: (marca) =>
      `Recebemos um pedido para redefinir a senha da sua conta no ${marca}. Clique no botão abaixo para escolher uma nova senha.`,
    botao: "Definir nova senha",
    nota: "Por segurança, este link é de uso único e expira em pouco tempo.",
    rodape: "Não foi você quem pediu? Pode ignorar este e-mail: sua senha continua a mesma.",
  },
};

export function assuntoDoModelo(modelo: ModeloDeAcesso, marca: MarcaDeSaida): string {
  return COPIA[modelo].assunto(marca.nome);
}

/**
 * O molde, com a marca da INSTALAÇÃO já aplicada, na casca de `estrutura.ts`
 * (tabelas, estilo inline, zero asset externo além do logo).
 */
export function montarTemplateDeAcesso(modelo: ModeloDeAcesso, marca: MarcaDeSaida): string {
  const t = COPIA[modelo];

  // As chaves duplas ficam CRUAS de propósito: o GoTrue as substitui.
  const destino = "{{ .RedirectTo }}&token_hash={{ .TokenHash }}";

  return estruturaDeEmail(marca, {
    preheader: t.preheader(marca.nome),
    etiqueta: t.etiqueta,
    titulo: t.titulo,
    corpo: `<p style="margin:0">${escapeHtml(t.corpo(marca.nome))}</p>`,
    botao: { rotulo: t.botao, href: destino },
    // No texto (nunca no `href`), um ponto de quebra antes do token: o endereço
    // fica em duas linhas inteiras, em vez de uma sobra de dois caracteres.
    link: destino.replace("&token_hash=", "<wbr>&token_hash="),
    nota: t.nota,
    rodape: t.rodape,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
