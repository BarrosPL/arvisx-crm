/**
 * Um cliente de serviço DE MENTIRA para os testes de rota do Vix, com as
 * tabelas `assistente_*` em memória e as funções do banco reimplementadas com
 * a MESMA regra da migration 9830 (reserva do cartão, contagem do mês).
 *
 * Serve para medir a ROTA: o que ela grava, com qual organização e usuário, em
 * que ordem, e o que deixa de gravar quando recusa. As regras do banco em si
 * são provadas contra Postgres de verdade em
 * `tests/invariants/assistente-tabelas-e-cartao.test.ts`; aqui elas são dublê.
 *
 * Método de consulta não implementado ESTOURA: silêncio viraria teste verde
 * medindo nada.
 */
import { randomUUID } from "node:crypto";

type Linha = Record<string, unknown>;

export interface EstadoDoBanco {
  /** A configuração do Vix para a organização (marca ou plano), ou `null` = sem Vix. */
  config: Linha | null;
  /** `ligado` da empresa. `null` = sem linha (ligado). */
  ligadoNaEmpresa: boolean | null;
  usadasNoMes: number;
  tabelas: Record<string, Linha[]>;
  /** Toda tabela que recebeu insert ou update, na ordem. */
  escritas: { tabela: string; operacao: "insert" | "update"; linha: Linha }[];
  rpcs: { nome: string; args: Linha }[];
}

export function novoBanco(sobre: Partial<EstadoDoBanco> = {}): EstadoDoBanco {
  return {
    config: { origem: "plano", mensagens_por_mes: 100, limite_de_lote: 5, mensagens_por_minuto: 6, ferramentas_por_turno: 8 },
    ligadoNaEmpresa: null,
    usadasNoMes: 0,
    tabelas: { assistente_conversas: [], assistente_mensagens: [], assistente_acoes: [], assistente_usos: [] },
    escritas: [],
    rpcs: [],
    ...sobre,
  };
}

const TABELAS = ["assistente_conversas", "assistente_mensagens", "assistente_acoes", "assistente_usos", "assistente_estado_da_empresa"];

export function clienteFalso(banco: EstadoDoBanco) {
  const from = (tabela: string) => {
    if (!TABELAS.includes(tabela)) {
      throw new Error(`[banco-falso-do-vix] tabela "${tabela}" não é do assistente: a rota não devia tocá-la`);
    }
    const filtros: ((l: Linha) => boolean)[] = [];
    let operacao: "select" | "insert" | "update" = "select";
    let carga: Linha = {};
    let ordem: { coluna: string; asc: boolean } | null = null;
    let limite: number | null = null;

    const linhas = (): Linha[] => {
      if (tabela === "assistente_estado_da_empresa") {
        return banco.ligadoNaEmpresa === null ? [] : [{ ligado: banco.ligadoNaEmpresa }];
      }
      return banco.tabelas[tabela] ?? [];
    };

    const executar = (): { data: Linha[] | null; error: { code?: string; message: string } | null } => {
      if (operacao === "insert") {
        if (tabela === "assistente_mensagens") {
          const repetida = linhas().some(
            (l) => l.conversa_id === carga.conversa_id && l.turn_id === carga.turn_id && l.autor === carga.autor,
          );
          if (repetida) return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        const nova = { id: randomUUID(), created_at: new Date().toISOString(), estado: "proposta", ...carga };
        (banco.tabelas[tabela] ??= []).push(nova);
        banco.escritas.push({ tabela, operacao: "insert", linha: nova });
        return { data: [nova], error: null };
      }
      // O estado da empresa é uma linha só, a da organização da sessão: o filtro por organização já está "aplicado".
      let achadas = tabela === "assistente_estado_da_empresa" ? linhas() : linhas().filter((l) => filtros.every((f) => f(l)));
      if (operacao === "update") {
        for (const l of achadas) Object.assign(l, carga);
        banco.escritas.push({ tabela, operacao: "update", linha: { ...carga } });
        return { data: achadas, error: null };
      }
      if (ordem) {
        const { coluna, asc } = ordem;
        achadas = [...achadas].sort((a, b) => String(a[coluna]).localeCompare(String(b[coluna])) * (asc ? 1 : -1));
      }
      if (limite !== null) achadas = achadas.slice(0, limite);
      return { data: achadas, error: null };
    };

    const construtor: Record<string, unknown> = {
      select: () => construtor,
      insert: (linha: Linha) => {
        operacao = "insert";
        carga = linha;
        return construtor;
      },
      update: (campos: Linha) => {
        operacao = "update";
        carga = campos;
        return construtor;
      },
      eq: (coluna: string, valor: unknown) => {
        filtros.push((l) => l[coluna] === valor);
        return construtor;
      },
      is: (coluna: string, valor: unknown) => {
        filtros.push((l) => (l[coluna] ?? null) === valor);
        return construtor;
      },
      not: (coluna: string, _op: string, valor: unknown) => {
        filtros.push((l) => (l[coluna] ?? null) !== valor);
        return construtor;
      },
      order: (coluna: string, opcoes?: { ascending?: boolean }) => {
        ordem = { coluna, asc: opcoes?.ascending !== false };
        return construtor;
      },
      limit: (n: number) => {
        limite = n;
        return construtor;
      },
      maybeSingle: async () => {
        const r = executar();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      single: async () => {
        const r = executar();
        return { data: r.data?.[0] ?? null, error: r.error ?? (r.data?.[0] ? null : { message: "sem linha" }) };
      },
      then: (resolver: (v: unknown) => unknown, rejeitar?: (e: unknown) => unknown) =>
        Promise.resolve(executar()).then(resolver, rejeitar),
    };
    return new Proxy(construtor, {
      get(alvo, prop) {
        if (prop in alvo || typeof prop === "symbol") return alvo[prop as string];
        throw new Error(`[banco-falso-do-vix] método '${String(prop)}' não implementado`);
      },
    });
  };

  const rpc = async (nome: string, args: Linha) => {
    banco.rpcs.push({ nome, args });
    switch (nome) {
      case "fn_assistente_config_da_org":
        return { data: banco.config ? [banco.config] : [], error: null };
      case "fn_assistente_mensagens_do_mes":
        return { data: banco.usadasNoMes, error: null };
      case "fn_assistente_registrar_mensagem": {
        const limite = args.p_limite as number | null;
        if (limite !== null && banco.usadasNoMes >= limite) return { data: null, error: null };
        banco.usadasNoMes += 1;
        const uso = { id: randomUUID(), organization_id: args.p_org, user_id: args.p_user, pagador: args.p_pagador };
        banco.tabelas.assistente_usos!.push(uso);
        banco.escritas.push({ tabela: "assistente_usos", operacao: "insert", linha: uso });
        return { data: uso.id, error: null };
      }
      case "fn_assistente_reservar_acao": {
        const acao = banco.tabelas.assistente_acoes!.find(
          (a) =>
            a.id === args.p_acao &&
            a.organization_id === args.p_org &&
            a.user_id === args.p_user &&
            a.estado === "proposta" &&
            new Date(String(a.expira_em)).getTime() > Date.now(),
        );
        if (!acao) return { data: [], error: null };
        acao.estado = "confirmada";
        return { data: [acao], error: null };
      }
      default:
        throw new Error(`[banco-falso-do-vix] função "${nome}" não é do assistente: a rota não devia chamá-la`);
    }
  };

  return { from, rpc } as never;
}

/** Lê um corpo `text/event-stream` inteiro e devolve os eventos. */
export async function eventosDoStream(resposta: Response): Promise<Record<string, unknown>[]> {
  const texto = await resposta.text();
  return texto
    .split("\n\n")
    .map((bloco) => bloco.trim())
    .filter((bloco) => bloco.startsWith("data: "))
    .map((bloco) => JSON.parse(bloco.slice(6)) as Record<string, unknown>);
}
