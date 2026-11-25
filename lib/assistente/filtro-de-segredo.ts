/**
 * SEGREDO NUNCA PASSA PELO CHAT DO VIX.
 *
 * Chave de API, senha, token e código de login não são digitados na conversa.
 * Este filtro roda ANTES de a mensagem ir para o modelo e ANTES de ela ser
 * gravada: mensagem que casa não segue para lugar nenhum. O Vix responde que
 * aquilo não deve ser colado ali, aponta a tela de credenciais e recomenda
 * revogar a chave.
 *
 * O mesmo conjunto de padrões MASCARA a saída (`mascararSegredos`): resultado
 * de leitura e texto do modelo passam por ele antes de chegar ao painel.
 *
 * Puro, sem I/O. O que casou nunca é devolvido: só o TIPO do padrão, que é o
 * que vai para a auditoria.
 */

export type TipoDeSegredo =
  | "chave_de_ia"
  | "token_do_crm"
  | "token_de_servico"
  | "chave_de_nuvem"
  | "jwt"
  | "chave_privada"
  | "cabecalho_bearer"
  | "senha_declarada"
  | "codigo_de_login"
  | "sequencia_de_alta_entropia";

interface Padrao {
  tipo: TipoDeSegredo;
  re: RegExp;
}

/**
 * Prefixos de chave conhecidos. A ordem importa só para o TIPO informado: o
 * primeiro que casar nomeia o achado.
 */
const PADROES: readonly Padrao[] = [
  // Anthropic, OpenAI (inclusive `sk-proj-`), OpenRouter (`sk-or-`).
  { tipo: "chave_de_ia", re: /\bsk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{16,}/g },
  // Google (Gemini, Maps).
  { tipo: "chave_de_ia", re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  // Token de API do próprio CRM (`lib/mcp/auth.ts`).
  { tipo: "token_do_crm", re: /\bdsk_[A-Za-z0-9_-]{16,}/g },
  // GitHub, Slack, Stripe, Supabase.
  { tipo: "token_de_servico", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g },
  { tipo: "token_de_servico", re: /\bgithub_pat_[A-Za-z0-9_]{30,}/g },
  { tipo: "token_de_servico", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { tipo: "token_de_servico", re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { tipo: "token_de_servico", re: /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}/g },
  // AWS.
  { tipo: "chave_de_nuvem", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  // JWT: três partes em base64url, as duas primeiras começando por `eyJ`.
  { tipo: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { tipo: "chave_privada", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { tipo: "cabecalho_bearer", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g },
];

/**
 * "minha senha é X", "password: X", "token = X". O valor precisa ter cara de
 * credencial (6+ caracteres sem espaço, com pelo menos um dígito ou um de `!@#$%&*_+=`):
 * "esqueci minha senha" e "onde troco a senha?" não casam.
 */
const SENHA_DECLARADA =
  /\b(?:senha|password|passwd|contrase[nñ]a|clave|token|api[ _-]?key|chave(?:\s+(?:de|da)\s+(?:api|acesso))?|secret|segredo)\b\s*(?:é|es|is|:|=|->)\s*["'`]?((?=[^\s"'`]*[\d!@#$%&*_+=])[^\s"'`]{6,})/gi;

/**
 * "o código é 123456", "código de verificação: 482913". Só com a palavra por
 * perto, e não quando ela nomeia outra coisa do CRM ("código do produto",
 * "código de barras", "código do pedido"): esses são dado de trabalho.
 */
const CODIGO_DE_LOGIN =
  /\b(?:c[oó]digo|code|otp|2fa|verifica[cç][aã]o|verification|autentica[cç][aã]o)\b(?!\s+(?:d[oae]s?\s+)?(?:produto|pedido|barras|rastreio|cliente|contato|lead|neg[oó]cio|cupom|postal|[aá]rea|pa[ií]s|item|sku)\b)[^\d\n]{0,40}\b(\d{6,8})\b/gi;

/** Sequência longa sem espaço, com letras e dígitos misturados e muita variedade. */
const CANDIDATO_A_ENTROPIA = /[A-Za-z0-9+/_=-]{32,}/g;

function entropiaDeShannon(s: string): number {
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** UUID e hash em hexadecimal puro são identificadores do CRM, não segredo. */
function ehIdentificadorComum(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) || /^[0-9a-f]+$/i.test(s) || /^\d+$/.test(s);
}

function pareceSegredoPorEntropia(s: string): boolean {
  if (ehIdentificadorComum(s)) return false;
  const temLetra = /[A-Za-z]/.test(s);
  const temDigito = /\d/.test(s);
  const temMaiusculaEMinuscula = /[a-z]/.test(s) && /[A-Z]/.test(s);
  return temLetra && temDigito && temMaiusculaEMinuscula && entropiaDeShannon(s) >= 4.2;
}

interface Achado {
  tipo: TipoDeSegredo;
  inicio: number;
  fim: number;
}

function acharSegredos(texto: string): Achado[] {
  const achados: Achado[] = [];
  for (const { tipo, re } of PADROES) {
    for (const m of texto.matchAll(re)) {
      achados.push({ tipo, inicio: m.index, fim: m.index + m[0].length });
    }
  }
  for (const m of texto.matchAll(SENHA_DECLARADA)) {
    const valor = m[1] ?? "";
    const inicio = m.index + m[0].length - valor.length;
    achados.push({ tipo: "senha_declarada", inicio, fim: inicio + valor.length });
  }
  for (const m of texto.matchAll(CODIGO_DE_LOGIN)) {
    const valor = m[1] ?? "";
    const inicio = m.index + m[0].lastIndexOf(valor);
    achados.push({ tipo: "codigo_de_login", inicio, fim: inicio + valor.length });
  }
  for (const m of texto.matchAll(CANDIDATO_A_ENTROPIA)) {
    if (pareceSegredoPorEntropia(m[0])) {
      achados.push({ tipo: "sequencia_de_alta_entropia", inicio: m.index, fim: m.index + m[0].length });
    }
  }
  return achados.sort((a, b) => a.inicio - b.inicio);
}

/** O tipo do primeiro segredo achado no texto, ou `null`. Nunca devolve o segredo. */
export function detectarSegredo(texto: string): TipoDeSegredo | null {
  return acharSegredos(texto)[0]?.tipo ?? null;
}

export const MARCA_DE_SEGREDO = "[segredo ocultado]";

/** Troca todo trecho com cara de segredo pela marca. Texto sem segredo volta igual. */
export function mascararSegredos(texto: string): string {
  const achados = acharSegredos(texto);
  if (achados.length === 0) return texto;
  let saida = "";
  let cursor = 0;
  for (const a of achados) {
    if (a.inicio < cursor) {
      cursor = Math.max(cursor, a.fim);
      continue;
    }
    saida += texto.slice(cursor, a.inicio) + MARCA_DE_SEGREDO;
    cursor = a.fim;
  }
  return saida + texto.slice(cursor);
}

/** Nomes de campo cujo VALOR nunca sai numa leitura, seja qual for o conteúdo. */
const CAMPO_SECRETO =
  /(^|_)(senha|password|passwd|secret|segredo|token|api_?key|apikey|chave_?(de_?)?(api|acesso)|private_?key|ciphertext|encrypted|access_?token|refresh_?token|webhook_?secret|authorization|credential|credencial)($|_)/i;

/**
 * Mascara um resultado de leitura inteiro: todo texto passa por
 * `mascararSegredos`, e campo com nome de segredo perde o valor.
 */
export function mascararResultado(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 12) return null;
  if (typeof valor === "string") return mascararSegredos(valor);
  if (Array.isArray(valor)) return valor.map((v) => mascararResultado(v, profundidade + 1));
  if (valor && typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      saida[k] = CAMPO_SECRETO.test(k) && v !== null && v !== undefined ? MARCA_DE_SEGREDO : mascararResultado(v, profundidade + 1);
    }
    return saida;
  }
  return valor;
}
