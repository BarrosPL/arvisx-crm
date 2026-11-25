/**
 * O EXECUTOR DO VIX — onde os níveis são aplicados, em código.
 *
 * O modelo nunca decide o que pode. Ele pede uma capacidade pelo nome; este
 * arquivo confere, nesta ordem, e recusa na primeira que falhar:
 *
 *   1. o nome existe no catálogo e não é proibido;
 *   2. o nível é o do caminho por onde veio (ler pelo caminho de leitura,
 *      escrever pelo de proposta);
 *   3. o papel do usuário alcança o mínimo da capacidade;
 *   4. o módulo da instalação e a capacidade da empresa estão ligados;
 *   5. o plano da empresa libera a tela equivalente;
 *   6. a entrada passa no schema (estrito: campo a mais é recusa).
 *
 * LER executa direto. ESCREVER e SENSÍVEL nunca executam aqui: `proporEscrita`
 * só grava o cartão. Quem executa uma escrita é `executarConfirmada`
 * (`./confirmar.ts`), que só a rota de confirmação importa, depois do clique
 * do usuário (cerca: `tests/unit/assistente-catalogo-cerca.test.ts`).
 *
 * A empresa nunca vem de argumento: vem de `ctx.orgId`, que a rota tirou da
 * sessão. Nenhum schema do catálogo aceita campo que nomeie empresa.
 */
import type { ModuloOpcional } from "@/lib/instalacao/modulos";
import type { CapacidadeDaOrganizacao } from "@/lib/organizacao/capacidades";

import { mascararResultado } from "./filtro-de-segredo";
import { FERRAMENTAS_MCP_FORA_DO_VIX, rotaProibida } from "./proibidas";
import {
  RANK_DO_PAPEL,
  VALIDADE_DO_CARTAO_MS,
  type Capacidade,
  type ContextoDoAssistente,
  type Modo,
  type MotivoDeRecusa,
  type RascunhoDoCartao,
  type ResultadoDaLeitura,
  type RotaDaTela,
} from "./tipos";

export interface EventoDoExecutor {
  tipo: "leitura" | "recusa" | "acao_proposta";
  capacidade: string;
  motivo?: MotivoDeRecusa;
  acaoId?: string;
  quantidade?: number;
}

export interface CartaoAGravar {
  conversaId: string;
  capacidade: string;
  nivel: "escrever" | "sensivel";
  entrada: Record<string, unknown>;
  resumo: string;
  itens: RascunhoDoCartao["itens"];
  quantidade: number;
  expiraEm: Date;
}

/**
 * O que o executor precisa do mundo. Tudo resolvido pela ROTA antes do turno,
 * nunca pelo modelo; injetado para os testes medirem cada trava sozinha.
 */
export interface DependenciasDoExecutor {
  catalogo: readonly Capacidade[];
  /** O plano da empresa NÃO libera a tela desta rota? */
  foraDoPlano: (orgId: string, rota: RotaDaTela) => Promise<boolean>;
  modulosLigados: readonly ModuloOpcional[];
  capacidadesDaEmpresa: readonly CapacidadeDaOrganizacao[];
  /** As escritas do assistente estão ligadas na instalação? */
  escritasLigadas: boolean;
  /** Quantos registros um cartão pode alterar. */
  limiteDeLote: number;
  auditar: (evento: EventoDoExecutor, ctx: ContextoDoAssistente) => void;
  /** Grava o cartão (servidor) e devolve o id. */
  gravarCartao: (cartao: CartaoAGravar, ctx: ContextoDoAssistente) => Promise<string>;
}

type Conferencia = { ok: true; cap: Capacidade; entrada: unknown } | { ok: false; motivo: MotivoDeRecusa; detalhe?: string };

function acharCapacidade(catalogo: readonly Capacidade[], nome: string): Capacidade | undefined {
  return catalogo.find((c) => c.nome === nome);
}

/** As conferências comuns a ler, propor e confirmar. Sem efeito nenhum. */
export async function conferirCapacidade(
  nome: string,
  argumentos: unknown,
  ctx: ContextoDoAssistente,
  deps: Pick<DependenciasDoExecutor, "catalogo" | "foraDoPlano" | "modulosLigados" | "capacidadesDaEmpresa">,
): Promise<Conferencia> {
  if ((FERRAMENTAS_MCP_FORA_DO_VIX as readonly string[]).includes(nome)) return { ok: false, motivo: "proibida" };
  const cap = acharCapacidade(deps.catalogo, nome);
  if (!cap) return { ok: false, motivo: "capacidade_inexistente" };
  if (cap.rotaDaTela && rotaProibida(cap.rotaDaTela.caminho, cap.rotaDaTela.metodo)) {
    return { ok: false, motivo: "proibida" };
  }
  if (RANK_DO_PAPEL[ctx.papel] === undefined || RANK_DO_PAPEL[ctx.papel] < RANK_DO_PAPEL[cap.papelMinimo]) {
    return { ok: false, motivo: "papel_insuficiente" };
  }
  if (cap.modulo && !deps.modulosLigados.includes(cap.modulo)) return { ok: false, motivo: "modulo_desligado" };
  if (cap.capacidadeDaEmpresa && !deps.capacidadesDaEmpresa.includes(cap.capacidadeDaEmpresa)) {
    return { ok: false, motivo: "modulo_desligado" };
  }
  if (cap.rotaDaTela && (await deps.foraDoPlano(ctx.orgId, cap.rotaDaTela))) {
    return { ok: false, motivo: "fora_do_plano" };
  }
  const lida = cap.entrada.strict().safeParse(argumentos ?? {});
  if (!lida.success) {
    return {
      ok: false,
      motivo: "entrada_invalida",
      detalhe: lida.error.issues.map((i) => `${i.path.join(".") || "entrada"}: ${i.message}`).join("; ").slice(0, 300),
    };
  }
  return { ok: true, cap, entrada: lida.data };
}

/**
 * As capacidades que ESTE usuário pode ver agora: é daqui que sai o conjunto de
 * ferramentas entregue ao modelo. Escrita só entra com as escritas ligadas.
 */
export async function capacidadesOferecidas(
  ctx: ContextoDoAssistente,
  deps: Pick<
    DependenciasDoExecutor,
    "catalogo" | "foraDoPlano" | "modulosLigados" | "capacidadesDaEmpresa" | "escritasLigadas"
  >,
  modo: Modo,
): Promise<Capacidade[]> {
  const saida: Capacidade[] = [];
  for (const cap of deps.catalogo) {
    if (cap.modos && !cap.modos.includes(modo)) continue;
    if (cap.nivel !== "ler" && !deps.escritasLigadas && cap.origem.tipo !== "propria") continue;
    if (RANK_DO_PAPEL[ctx.papel] < RANK_DO_PAPEL[cap.papelMinimo]) continue;
    if (cap.modulo && !deps.modulosLigados.includes(cap.modulo)) continue;
    if (cap.capacidadeDaEmpresa && !deps.capacidadesDaEmpresa.includes(cap.capacidadeDaEmpresa)) continue;
    if (cap.rotaDaTela && rotaProibida(cap.rotaDaTela.caminho, cap.rotaDaTela.metodo)) continue;
    if (cap.rotaDaTela && (await deps.foraDoPlano(ctx.orgId, cap.rotaDaTela))) continue;
    saida.push(cap);
  }
  return saida;
}

/** LER: confere e executa. O resultado volta já mascarado de segredos. */
export async function executarLeitura(
  nome: string,
  argumentos: unknown,
  ctx: ContextoDoAssistente,
  deps: DependenciasDoExecutor,
): Promise<ResultadoDaLeitura> {
  const c = await conferirCapacidade(nome, argumentos, ctx, deps);
  if (!c.ok) {
    deps.auditar({ tipo: "recusa", capacidade: nome, motivo: c.motivo }, ctx);
    return c;
  }
  if (c.cap.nivel !== "ler") {
    deps.auditar({ tipo: "recusa", capacidade: nome, motivo: "nivel_errado" }, ctx);
    return { ok: false, motivo: "nivel_errado" };
  }
  try {
    const dados = mascararResultado(await c.cap.executar(c.entrada as never, ctx));
    deps.auditar({ tipo: "leitura", capacidade: nome }, ctx);
    return { ok: true, dados };
  } catch {
    // O detalhe técnico não volta: nem para o modelo, nem para o usuário.
    deps.auditar({ tipo: "recusa", capacidade: nome, motivo: "falha_ao_executar" }, ctx);
    return { ok: false, motivo: "falha_ao_executar" };
  }
}

export type ResultadoDaProposta =
  | { ok: true; acaoId: string; resumo: string; itens: RascunhoDoCartao["itens"]; nivel: "escrever" | "sensivel"; expiraEm: string }
  | { ok: false; motivo: MotivoDeRecusa; detalhe?: string };

/**
 * ESCREVER: confere, monta o cartão e o GRAVA. Não altera mais nada. A
 * capacidade `propria` (só mexe em tabela do próprio assistente, como abrir
 * chamado) é oferecida mesmo com as escritas do CRM desligadas; as demais, não.
 */
export async function proporEscrita(
  nome: string,
  argumentos: unknown,
  conversaId: string,
  ctx: ContextoDoAssistente,
  deps: DependenciasDoExecutor,
): Promise<ResultadoDaProposta> {
  const recusar = (motivo: MotivoDeRecusa, detalhe?: string): ResultadoDaProposta => {
    deps.auditar({ tipo: "recusa", capacidade: nome, motivo }, ctx);
    return { ok: false, motivo, ...(detalhe ? { detalhe } : {}) };
  };
  const c = await conferirCapacidade(nome, argumentos, ctx, deps);
  if (!c.ok) return recusar(c.motivo, c.detalhe);
  if (c.cap.nivel === "ler" || !c.cap.preparar) return recusar("nivel_errado");
  if (!deps.escritasLigadas && c.cap.origem.tipo !== "propria") return recusar("escritas_desligadas");

  let rascunho: RascunhoDoCartao;
  try {
    rascunho = await c.cap.preparar(c.entrada as never, ctx);
  } catch {
    return recusar("falha_ao_executar");
  }
  const quantidade = Math.max(1, rascunho.itens.length);
  if (quantidade > deps.limiteDeLote) {
    return recusar("lote_acima_do_limite", `${quantidade} > ${deps.limiteDeLote}`);
  }
  const expiraEm = new Date(Date.now() + VALIDADE_DO_CARTAO_MS);
  const acaoId = await deps.gravarCartao(
    {
      conversaId,
      capacidade: c.cap.nome,
      nivel: c.cap.nivel,
      entrada: c.entrada as Record<string, unknown>,
      resumo: rascunho.resumo,
      itens: rascunho.itens,
      quantidade,
      expiraEm,
    },
    ctx,
  );
  deps.auditar({ tipo: "acao_proposta", capacidade: nome, acaoId, quantidade }, ctx);
  return {
    ok: true,
    acaoId,
    resumo: rascunho.resumo,
    itens: rascunho.itens,
    nivel: c.cap.nivel,
    expiraEm: expiraEm.toISOString(),
  };
}
