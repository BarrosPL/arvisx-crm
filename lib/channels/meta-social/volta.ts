import { FORMATO_DO_ESTADO } from "../estado-da-volta";

/**
 * Para onde a ponte da volta do login do Facebook manda o navegador.
 *
 * Só repassa, à tela autenticada, o que a Meta trouxe — e cada valor passa por
 * um formato fixo antes, porque vai parar numa URL nossa. Nenhum efeito aqui:
 * quem troca o código é a rota autenticada, depois de conferir o estado contra
 * a sessão.
 */
const BASE = "/app/connections?aba=sociais";
const CODIGO_DA_META = /^[A-Za-z0-9_\-#.]{10,2000}$/;
const ERRO = /^[a-z_]{1,60}$/;

export function destinoDaVolta(params: URLSearchParams): string {
  const estado = params.get("state") ?? "";
  if (!FORMATO_DO_ESTADO.test(estado)) return BASE;
  const q = new URLSearchParams({ meta_estado: estado });
  const erro = params.get("error");
  const code = params.get("code");
  if (erro !== null) {
    // `access_denied` é o "Cancelar" da Meta; qualquer outro vira genérico.
    q.set("meta_erro", ERRO.test(erro) ? erro : "erro_da_meta");
  } else if (code && CODIGO_DA_META.test(code)) {
    q.set("meta_code", code);
  } else {
    return BASE;
  }
  return `${BASE}&${q.toString()}`;
}
