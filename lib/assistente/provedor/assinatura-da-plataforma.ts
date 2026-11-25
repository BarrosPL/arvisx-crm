/**
 * PAGADOR `assinatura_plataforma`: o Vix roda na assinatura ChatGPT/Codex da
 * própria plataforma.
 *
 * ═══ A EXCEÇÃO QUE ESTE ARQUIVO É ═══
 *
 * A assinatura é "uma conta por empresa" (`lib/ai/credenciais/login-codex.ts`,
 * decisão do PR #1672), e isso NÃO muda: a conta do Vix é a conta de UMA
 * empresa, uma organização designada só para isso, conectada pelo
 * administrador dela na tela de Credenciais. Este é o ÚNICO ponto do sistema
 * em que o token de uma organização é usado numa chamada disparada por
 * usuário de outra.
 *
 * Por isso este arquivo:
 *
 *  - exporta UMA função, que devolve o modelo já montado. O token, o e-mail
 *    da conta e o id da organização designada não saem daqui: não vão para o
 *    prompt, para resultado de ferramenta, para o painel, para a auditoria nem
 *    para o log;
 *  - é o único do assistente que importa de `login-codex`, e o único do
 *    repositório que lê `VIX_ORGANIZACAO_DA_CONTA`
 *    (`tests/unit/assistente-provedor-cerca.test.ts`);
 *  - não recebe organização por parâmetro: ela vem da configuração da
 *    instalação, que só o administrador da plataforma edita. Nunca do modelo,
 *    do cliente, do corpo de uma requisição ou de argumento de capacidade.
 *
 * ═══ RENOVAÇÃO: SÓ REAPROVEITA ═══
 *
 * Antes da chamada, `lerLoginCodexRenovandoSeProxima` renova se a janela abriu
 * (trava no banco). No 401, `renovarAssinaturaNoTurno` renova uma vez pela
 * mesma trava. Nenhum caminho novo: este arquivo não grava token nem fala com
 * o endpoint de renovação.
 *
 * ═══ SEM RESERVA ═══
 *
 * Falhou, o assistente fica indisponível. A política de reserva dos agentes
 * (cair para chave de API) não é chamada daqui.
 */
import { buildModel } from "@/lib/ai/runtime/agent";
import { lerLoginCodexRenovandoSeProxima, renovarAssinaturaNoTurno } from "@/lib/ai/credenciais/login-codex";
import { PROVEDOR_POR_ASSINATURA } from "@/lib/ai/pontos/provedores";
import { classificarFalhaDaAssinatura } from "@/lib/ai/pontos/reserva-da-assinatura";
import { valorDaInstalacao } from "@/lib/instalacao/config";
import { ehOperante } from "@/lib/organizacao/operante";
import type { createAdminClient } from "@/lib/supabase/admin";

import { statusEDetalheDoErro, type MotivoDeIndisponibilidade, type ProvedorDoVix } from "./tipos";

type Admin = ReturnType<typeof createAdminClient>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PAGADOR = "assinatura_plataforma" as const;

function indisponivel(motivo: MotivoDeIndisponibilidade): ProvedorDoVix {
  return { disponivel: false, pagador: PAGADOR, motivo };
}

function classificar(erro: unknown): MotivoDeIndisponibilidade {
  const { status, detalhe } = statusEDetalheDoErro(erro);
  return classificarFalhaDaAssinatura(status, detalhe) ?? "falha_do_provedor";
}

export async function assinaturaDaPlataforma(admin: Admin): Promise<ProvedorDoVix> {
  // A organização dona da conta do assistente: configuração da instalação.
  // (Chave escrita por extenso: `painel-nao-promete-o-que-nao-cumpre` procura o leitor pelo literal.)
  const designada = ((await valorDaInstalacao("VIX_ORGANIZACAO_DA_CONTA")).valor ?? "").trim();
  if (designada === "") return indisponivel("sem_organizacao_designada");
  if (!UUID.test(designada)) return indisponivel("organizacao_designada_invalida");

  const { data: org, error } = await admin.from("organizations").select("id, status").eq("id", designada).maybeSingle();
  if (error || !org || !ehOperante((org as { status?: string | null }).status)) {
    return indisponivel("organizacao_designada_invalida");
  }

  // O modelo, escolhido na lista da conta. Sem padrão: vazio = indisponível.
  const modelo = ((await valorDaInstalacao("VIX_MODELO")).valor ?? "").trim();
  if (modelo === "") return indisponivel("sem_modelo");

  const tokens = await lerLoginCodexRenovandoSeProxima({ admin, orgId: designada });
  if (tokens === null) return indisponivel("sem_conta");

  return {
    disponivel: true,
    pagador: PAGADOR,
    provedor: PROVEDOR_POR_ASSINATURA,
    modelo,
    model: buildModel(PROVEDOR_POR_ASSINATURA, tokens.access_token, modelo),
    // Mensalidade fixa: o custo marginal da chamada é zero. O uso é medido
    // pelos tokens e pela contagem de mensagens.
    custoUsdCents: () => 0,
    classificarFalha: classificar,
    renovarApos401: async () => {
      const r = await renovarAssinaturaNoTurno({ admin, orgId: designada });
      return r.ok ? buildModel(PROVEDOR_POR_ASSINATURA, r.tokens.access_token, modelo) : null;
    },
  };
}
