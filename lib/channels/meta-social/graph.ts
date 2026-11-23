/**
 * A Graph API da Meta para a CONEXÃO DIRETA do Instagram e do Messenger.
 *
 * Um lugar só para três coisas que o resto do módulo não pode repetir:
 *
 *   - o host e a versão (`graphBaseUrl`, o mesmo do canal oficial — `META_GRAPH_BASE_URL`
 *     aponta os dois para o receptor de prova, e `META_GRAPH_VERSION` muda os dois);
 *   - o token vai no cabeçalho `Authorization`, NUNCA na query: a URL vai para log
 *     de proxy, e token em query string é a regra 12 dos anti-patterns;
 *   - o erro da Graph vira uma frase que o operador entende (`ErroDaGraph`), com o
 *     código cru guardado para o log — o "código 10" sozinho já custou um
 *     diagnóstico inteiro no canal por parceiro.
 *
 * Sem redirect: credencial não segue redirecionamento para outro host.
 */
import { createHmac } from "node:crypto";

import { graphBaseUrl } from "../meta/graph-base";

export interface DetalheDoErroDaGraph {
  status: number;
  code: number | null;
  subcode: number | null;
  mensagem: string | null;
}

export class ErroDaGraph extends Error {
  readonly detalhe: DetalheDoErroDaGraph;
  constructor(frase: string, detalhe: DetalheDoErroDaGraph) {
    super(frase);
    this.name = "ErroDaGraph";
    this.detalhe = detalhe;
  }
  /** A janela de 24 h fechou (Messenger 10/2018278, Instagram 10/2534022). */
  get foraDaJanela(): boolean {
    return (
      this.detalhe.code === 10 &&
      (this.detalhe.subcode === 2018278 || this.detalhe.subcode === 2534022)
    );
  }
  /** Token inválido, expirado ou revogado: só reconectar resolve. */
  get tokenInvalido(): boolean {
    return this.detalhe.code === 190 || this.detalhe.code === 102;
  }
  /** A Meta limitou as chamadas: a operação NÃO foi feita, e tentar depois é seguro. */
  get limiteDeTaxa(): boolean {
    return CODIGOS_DE_LIMITE.has(this.detalhe.code ?? -1);
  }
  /** Falta a permissão de comentários na conexão: só reautorizar resolve. */
  get escopoDeComentariosAusente(): boolean {
    return faltaEscopoDeComentarios(this.detalhe);
  }
  /**
   * Não dá para saber se a Meta executou o pedido: a resposta não chegou
   * (`status` 0: rede ou tempo esgotado), o servidor dela falhou (5xx) ou ela
   * devolveu o erro genérico de serviço (1 e 2). Quem publica NÃO repete
   * sozinho depois disto — a publicação pode ter saído.
   */
  get desfechoIncerto(): boolean {
    const { status, code } = this.detalhe;
    return status === 0 || status >= 500 || code === 1 || code === 2;
  }
}

/** Os códigos com que a Graph diz "chamadas demais" (app, usuário, página e conta). */
const CODIGOS_DE_LIMITE: ReadonlySet<number> = new Set([4, 17, 32, 613]);

/** A frase de quando a conexão não tem a permissão de comentários. */
export const FRASE_SEM_ESCOPO_DE_COMENTARIOS =
  "Esta conexão não tem a permissão de comentários do Instagram. Reautorize a conexão em Conexões › Facebook / Instagram e aceite a permissão de comentários.";

/**
 * A recusa é por falta do escopo de comentários? A Graph responde com o código
 * de permissão (10, 200 a 299, ou 3) e NOMEIA a permissão na mensagem — é o
 * nome que separa esta recusa das outras de permissão.
 */
function faltaEscopoDeComentarios(d: DetalheDoErroDaGraph): boolean {
  const { code } = d;
  const dePermissao = code === 10 || code === 3 || (code !== null && code >= 200 && code < 300);
  return dePermissao && /instagram_manage_comments|pages_read_engagement/i.test(d.mensagem ?? "");
}

/** A frase do operador para um erro da Graph. Pura, para ser testada sem rede. */
export function fraseDoErroDaGraph(d: DetalheDoErroDaGraph): string {
  const { code, subcode } = d;
  if (code === 10 && (subcode === 2018278 || subcode === 2534022)) {
    return "Fora da janela de 24 horas: a Meta só aceita resposta a quem escreveu nas últimas 24 horas. Aguarde o cliente escrever de novo.";
  }
  if (code === 190 || code === 102) {
    return "A autorização da Meta expirou ou foi removida. Reconecte a página em Conexões › Facebook / Instagram.";
  }
  if (faltaEscopoDeComentarios(d)) return FRASE_SEM_ESCOPO_DE_COMENTARIOS;
  if (code === 10 || (code !== null && code >= 200 && code < 300)) {
    return "A Meta recusou por falta de permissão. Reconecte a página e aceite todas as permissões pedidas.";
  }
  if (code === 551 || subcode === 1545041) {
    return "Esta pessoa não está disponível para receber mensagens agora.";
  }
  if (CODIGOS_DE_LIMITE.has(code ?? -1)) {
    return "A Meta limitou as chamadas desta página por agora. Tente de novo em alguns minutos.";
  }
  if (code === 100) {
    return "A Meta recusou o pedido por um dado inválido. Confira a conversa e o anexo antes de tentar de novo.";
  }
  return `A Meta recusou a operação${code !== null ? ` (código ${code})` : ` (HTTP ${d.status})`}.`;
}

function numero(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export interface OpcoesDaChamada {
  token?: string | null;
  metodo?: "GET" | "POST" | "DELETE";
  query?: Record<string, string>;
  corpo?: unknown;
  /**
   * Corpo `application/x-www-form-urlencoded` — para a troca do código e do
   * token, que levam o App Secret: no corpo, nunca na URL.
   */
  formulario?: Record<string, string>;
  /**
   * O App Secret, para assinar a chamada com `appsecret_proof` (HMAC do token).
   * A prova vai na query porque é o lugar que a Meta lê; ela é derivada e não
   * revela o segredo. Com "Exigir App Secret" ligado no app, chamada sem prova
   * é recusada — então ela vai sempre que houver token e segredo.
   */
  appSecret?: string | null;
  timeoutMs?: number;
}

/** `appsecret_proof` da Meta: HMAC-SHA256 do token com o App Secret, em hex. */
export function provaDoApp(token: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(token, "utf8").digest("hex");
}

/**
 * Chama a Graph e devolve o JSON — ou lança `ErroDaGraph` com a frase pronta.
 *
 * `caminho` é relativo à versão (`me/accounts`, `123/messages`) e nunca leva
 * query: os parâmetros entram por `query`, que é codificada aqui.
 */
export async function chamarGraph<T = unknown>(
  caminho: string,
  opcoes: OpcoesDaChamada = {},
): Promise<T> {
  const url = new URL(`${graphBaseUrl()}/${caminho.replace(/^\/+/, "")}`);
  for (const [chave, valor] of Object.entries(opcoes.query ?? {})) url.searchParams.set(chave, valor);
  if (opcoes.token && opcoes.appSecret) {
    url.searchParams.set("appsecret_proof", provaDoApp(opcoes.token, opcoes.appSecret));
  }
  const temCorpo = opcoes.corpo !== undefined || opcoes.formulario !== undefined;
  const metodo = opcoes.metodo ?? (temCorpo ? "POST" : "GET");
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: metodo,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? 15_000),
      headers: {
        ...(opcoes.token ? { Authorization: `Bearer ${opcoes.token}` } : {}),
        ...(opcoes.formulario !== undefined
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : opcoes.corpo !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
      },
      ...(opcoes.formulario !== undefined
        ? { body: new URLSearchParams(opcoes.formulario).toString() }
        : opcoes.corpo !== undefined
          ? { body: JSON.stringify(opcoes.corpo) }
          : {}),
    });
  } catch (erro) {
    throw new ErroDaGraph("Não foi possível falar com a Meta agora. Tente de novo em instantes.", {
      status: 0,
      code: null,
      subcode: null,
      mensagem: erro instanceof Error ? erro.message : String(erro),
    });
  }
  const corpo = (await resposta.json().catch(() => null)) as Record<string, unknown> | null;
  if (!resposta.ok || (corpo && typeof corpo.error === "object" && corpo.error !== null)) {
    const e = (corpo?.error ?? {}) as Record<string, unknown>;
    const detalhe: DetalheDoErroDaGraph = {
      status: resposta.status,
      code: numero(e.code),
      subcode: numero(e.error_subcode),
      mensagem: typeof e.message === "string" ? e.message.slice(0, 300) : null,
    };
    throw new ErroDaGraph(fraseDoErroDaGraph(detalhe), detalhe);
  }
  return (corpo ?? {}) as T;
}
