/**
 * PAGADOR `hermes`: o Vix raciocina no Hermes (perfil `vix-crm`, Claude, pela
 * assinatura da plataforma) e executa tudo no CRM.
 *
 * Duas chaves da instalação, as duas lidas SÓ aqui (cerca em
 * `tests/unit/assistente-provedor-cerca.test.ts`):
 *   `VIX_HERMES_URL`      a base do perfil, ex.: `https://hermes.exemplo/p/vix-crm`
 *   `VIX_HERMES_SEGREDO`  a chave desse perfil no Hermes (só abre ESSE perfil)
 *
 * Falta uma das duas, ou a URL não é https (ou http local): indisponível
 * (`sem_hermes`), sem tentar nada. O custo é zero (mensalidade fixa da
 * assinatura); os tokens são os que o Hermes devolve, e quando ele não devolve
 * o registro mostra zero e a medição fica marcada como incompleta, nunca com
 * número inventado.
 *
 * Não há queda para outro pagador.
 */
import { valorDaInstalacao } from "@/lib/instalacao/config";

import { criarModeloHermes, ErroDoHermes, MODELO_DO_HERMES, RespostaInvalidaDoHermes, urlDoHermesValida } from "./modelo-hermes";
import { statusEDetalheDoErro, type MotivoDeIndisponibilidade, type ProvedorDoVix } from "./tipos";

const PAGADOR = "hermes" as const;

function classificar(erro: unknown): MotivoDeIndisponibilidade {
  if (erro instanceof RespostaInvalidaDoHermes) return "resposta_invalida";
  const { status } = statusEDetalheDoErro(erro);
  if (status === null) return "rede";
  if (status === 429 || status === 402) return "limite_de_uso";
  if (status === 401 || status === 403) return "sem_autorizacao";
  if (status >= 500) return "falha_do_provedor";
  return "erro_de_pedido";
}

export async function hermesDaPlataforma(): Promise<ProvedorDoVix> {
  const [urlBruta, segredo] = await Promise.all([valorDaInstalacao("VIX_HERMES_URL"), valorDaInstalacao("VIX_HERMES_SEGREDO")]);
  const url = urlDoHermesValida(urlBruta.valor ?? "");
  const chave = (segredo.valor ?? "").trim();
  if (url === null || chave.length < 16) return { disponivel: false, pagador: PAGADOR, motivo: "sem_hermes" };
  return {
    disponivel: true,
    pagador: PAGADOR,
    provedor: "hermes",
    modelo: MODELO_DO_HERMES,
    model: criarModeloHermes({ url, chave }),
    custoUsdCents: () => 0,
    classificarFalha: classificar,
  };
}

export { ErroDoHermes };
