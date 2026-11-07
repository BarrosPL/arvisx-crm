/**
 * "Atualizar pela UI" (`/app/settings/atualizacao`) ligado ou não nesta instalação.
 *
 * Fork ArvisX: aqui a atualização é o merge mensal do upstream + a imagem do CI
 * + o deploy no Easypanel (`ATUALIZACOES.md`), sem o kit nem o `agent.sh` no
 * host. O painel herdado consulta e puxa do upstream (DeskcommCRM), então fica
 * DESLIGADO por padrão: só `ATUALIZACAO_PELA_TELA=on` o liga. Desligado, a
 * página dá `notFound()`, `POST /api/v1/system/update` e
 * `POST /api/v1/system/agent` respondem 404, `GET /api/v1/system/version`
 * entrega só a versão (sem o aviso "Nova versão disponível" do rodapé) e a
 * Ajuda esconde o atalho.
 *
 * Lido de `process.env` a cada chamada (e declarado em `lib/env.ts`): o valor é
 * de servidor, e ler na hora deixa os testes ligarem e desligarem sem
 * reimportar a rota.
 */
export function atualizacaoPelaTelaLigada(
  valor: string | undefined = process.env.ATUALIZACAO_PELA_TELA,
): boolean {
  return valor?.trim().toLowerCase() === "on";
}

/** Mensagem do 404 das rotas quando o painel está desligado. */
export const ATUALIZACAO_PELA_TELA_DESLIGADA =
  "A atualização pela tela está desligada nesta instalação.";
