/**
 * A ESCOLHA DA PÁGINA, entre a volta do login e o "Conectar".
 *
 * Entre listar as páginas e a pessoa clicar numa, o servidor precisa do token
 * de usuário de novo (é dele que saem os tokens das páginas). Guardá-lo numa
 * tabela criaria um segredo de vida longa só para atravessar um clique; deixá-lo
 * no navegador em claro entregaria o token a qualquer script da página.
 *
 * Então ele viaja LACRADO: AES-256-GCM com chave derivada do `INTERNAL_SECRET`,
 * amarrado à organização e à pessoa, com prazo de 15 minutos. O navegador só
 * carrega um blob opaco que ele não lê e não consegue alterar (o GCM autentica),
 * e que de nada serve em outra organização ou nas mãos de outra pessoa.
 *
 * `null` para tudo o que não for um lacre nosso, íntegro, no prazo e do mesmo
 * dono. Nunca lança por entrada ruim.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const VALIDADE_DA_SELECAO_MS = 15 * 60 * 1000;
export const FORMATO_DA_SELECAO = /^[A-Za-z0-9_-]{40,4000}$/;

interface ConteudoDaSelecao {
  org: string;
  user: string;
  token: string;
  /** O id da pessoa no app — vai para a sessão, para o pedido de exclusão achá-la. */
  metaUser: string | null;
  exp: number;
}

function chave(segredo: string): Buffer {
  const s = segredo?.trim() ?? "";
  if (s.length < 16) throw new Error("INTERNAL_SECRET ausente ou curto demais para lacrar a escolha");
  // Rótulo próprio: a mesma chave mestra não serve a dois usos com a mesma derivação.
  return createHash("sha256").update(`meta-social/selecao\u0000${s}`, "utf8").digest();
}

export function lacrarSelecao(
  dados: { organizationId: string; userId: string; tokenDoUsuario: string; metaUserId: string | null },
  opcoes: { segredo: string; agora: Date; validadeMs?: number },
): string {
  const conteudo: ConteudoDaSelecao = {
    org: dados.organizationId,
    user: dados.userId,
    token: dados.tokenDoUsuario,
    metaUser: dados.metaUserId,
    exp: opcoes.agora.getTime() + (opcoes.validadeMs ?? VALIDADE_DA_SELECAO_MS),
  };
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave(opcoes.segredo), iv);
  const corpo = Buffer.concat([cifra.update(JSON.stringify(conteudo), "utf8"), cifra.final()]);
  return Buffer.concat([iv, cifra.getAuthTag(), corpo]).toString("base64url");
}

export function abrirSelecao(
  lacre: string | null | undefined,
  esperado: { organizationId: string; userId: string },
  opcoes: { segredo: string; agora: Date },
): { tokenDoUsuario: string; metaUserId: string | null } | null {
  if (!lacre || !FORMATO_DA_SELECAO.test(lacre)) return null;
  const k = chave(opcoes.segredo);
  try {
    const bruto = Buffer.from(lacre, "base64url");
    if (bruto.length < 12 + 16 + 2) return null;
    const decifra = createDecipheriv("aes-256-gcm", k, bruto.subarray(0, 12));
    decifra.setAuthTag(bruto.subarray(12, 28));
    const texto = Buffer.concat([decifra.update(bruto.subarray(28)), decifra.final()]).toString("utf8");
    const c = JSON.parse(texto) as Partial<ConteudoDaSelecao>;
    if (c.org !== esperado.organizationId || c.user !== esperado.userId) return null;
    if (typeof c.exp !== "number" || c.exp <= opcoes.agora.getTime()) return null;
    if (typeof c.token !== "string" || !c.token) return null;
    return { tokenDoUsuario: c.token, metaUserId: typeof c.metaUser === "string" ? c.metaUser : null };
  } catch {
    return null;
  }
}
