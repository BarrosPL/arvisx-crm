/**
 * Um banco EM MEMÓRIA que entende a cadeia do PostgREST — para testar handler
 * que filtra por organização sem subir Postgres.
 *
 * ─── Por que não um dublê que devolve o que o teste manda ──────────────────
 *
 * O dublê comum (`eq: () => chain`) ignora o filtro: ele devolve a linha que o
 * teste preparou, exista ou não um `.eq("organization_id", …)` na consulta. Com
 * ele, um teste de "não vaza para outra organização" passa mesmo se o filtro
 * for apagado — mede o dublê, não o código.
 *
 * Aqui os filtros SÃO APLICADOS sobre linhas de verdade. Duas organizações
 * convivem nas mesmas tabelas, como no banco real sob service role (que ignora
 * RLS), e uma consulta sem o filtro de organização devolve as linhas das duas —
 * e o teste reprova. É o que permite afirmar isolamento em teste unitário.
 *
 * ─── O que ele NÃO prova ───────────────────────────────────────────────────
 *
 * Constraint, chave estrangeira, RLS, trigger e o SQL de verdade continuam
 * sendo coisa de `pnpm test:db` (`tests/invariants/`). Este arquivo entende só
 * o subconjunto da cadeia que as ferramentas de acompanhamento usam.
 */
import { randomUUID } from "node:crypto";

export type Linha = Record<string, unknown>;
type Predicado = (linha: Linha) => boolean;

/** `payload @> filtro`, como o Postgres compara jsonb. */
function contem(valor: unknown, filtro: unknown): boolean {
  if (filtro === null || typeof filtro !== "object") return valor === filtro;
  // Array contém array quando cada elemento pedido aparece em algum lugar.
  if (Array.isArray(filtro)) {
    return Array.isArray(valor) && filtro.every((f) => valor.some((v) => contem(v, f)));
  }
  if (valor === null || typeof valor !== "object") return false;
  return Object.entries(filtro as Linha).every(([k, v]) => contem((valor as Linha)[k], v));
}

/** Divide `a,b,and(c,d)` na vírgula de fora dos parênteses. */
function dividirNoTopo(texto: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const ch of texto) {
    if (ch === "(") nivel++;
    if (ch === ")") nivel--;
    if (ch === "," && nivel === 0) {
      partes.push(atual);
      atual = "";
    } else atual += ch;
  }
  if (atual) partes.push(atual);
  return partes;
}

/**
 * Os elementos de um literal de array do Postgres (`{"a","b c"}`), como o
 * operando de `cs` chega: entre aspas, com `"` e `\` escapados por barra.
 */
function elementosDoArray(literal: string): string[] {
  const miolo = literal.trim().replace(/^\{|\}$/g, "");
  const elementos: string[] = [];
  let atual = "";
  let entreAspas = false;
  for (let i = 0; i < miolo.length; i++) {
    const ch = miolo[i]!;
    if (ch === "\\" && i + 1 < miolo.length) {
      atual += miolo[++i];
    } else if (ch === '"') {
      entreAspas = !entreAspas;
    } else if (ch === "," && !entreAspas) {
      elementos.push(atual);
      atual = "";
    } else atual += ch;
  }
  if (atual !== "" || miolo !== "") elementos.push(atual);
  return elementos;
}

/** O valor de um operando do `or=` que veio entre aspas: tira as aspas e o escape. */
function semAspasDoOr(bruto: string): string {
  if (!(bruto.startsWith('"') && bruto.endsWith('"'))) return bruto;
  return bruto.slice(1, -1).replace(/\\(.)/g, "$1");
}

/** `coluna @> literal`, para coluna `text[]`. */
function contemOArray(valor: unknown, literal: string): boolean {
  return Array.isArray(valor) && elementosDoArray(literal).every((e) => valor.includes(e));
}

/** `coluna && literal`, para coluna `text[]`: tem ALGUM dos elementos. */
function cruzaOArray(valor: unknown, literal: string): boolean {
  return Array.isArray(valor) && elementosDoArray(literal).some((e) => valor.includes(e));
}

/** Uma condição do `.or(...)`: `col.eq.x`, `col.gt.x`, `col.lt.x`, `col.in.(a,b)`, `and(...)`. */
function condicao(texto: string): Predicado {
  if (texto.startsWith("and(") && texto.endsWith(")")) {
    const todas = dividirNoTopo(texto.slice(4, -1)).map(condicao);
    return (l) => todas.every((p) => p(l));
  }
  const m = /^([a-z_]+)\.(eq|gt|lt|in|is|cs)\.(.*)$/s.exec(texto);
  if (!m) throw new Error(`banco em memória: condição não entendida em or(): ${texto}`);
  const [, coluna, op, bruto] = m as unknown as [string, string, string, string];
  switch (op) {
    case "eq":
      return (l) => String(l[coluna]) === bruto;
    case "gt":
      return (l) => String(l[coluna]) > bruto;
    case "lt":
      return (l) => String(l[coluna]) < bruto;
    case "is":
      return (l) => (bruto === "null" ? l[coluna] === null || l[coluna] === undefined : false);
    case "cs":
      return (l) => contemOArray(l[coluna], semAspasDoOr(bruto));
    default: {
      const valores = bruto.replace(/^\(|\)$/g, "").split(",");
      return (l) => valores.includes(String(l[coluna]));
    }
  }
}

export interface ArquivoNoStorage {
  bytes: Uint8Array;
  tipo: string;
}

export interface BancoEmMemoria {
  /** As tabelas, vivas: o teste lê aqui o que foi gravado. */
  tabelas: Record<string, Linha[]>;
  /** `bucket/caminho` → arquivo. */
  arquivos: Map<string, ArquivoNoStorage>;
  /** Os caminhos pedidos ao Storage, na ordem: prova que nada foi buscado fora dele. */
  downloads: string[];
  /** O cliente, com a forma do `SupabaseClient` que os handlers usam. */
  cliente: { from: (tabela: string) => unknown; storage: { from: (bucket: string) => unknown } };
  /** Quantas consultas chegaram a cada tabela. */
  consultas: Record<string, number>;
}

/** Embutidos que os handlers pedem: `crm_tasks.lead` → `crm_leads(id, title)`. */
const EMBUTIDOS: Record<string, { campo: string; tabela: string; fk: string; colunas: string[] }> = {
  crm_tasks: { campo: "lead", tabela: "crm_leads", fk: "lead_id", colunas: ["id", "title"] },
};

/** Chaves únicas que o teste precisa ver respeitadas. */
const UNICOS: Record<string, string[]> = {
  idempotency_keys: ["organization_id", "key", "endpoint"],
};

export function bancoEmMemoria(
  inicial: Record<string, Linha[]> = {},
  arquivosIniciais: Record<string, ArquivoNoStorage> = {},
): BancoEmMemoria {
  const tabelas: Record<string, Linha[]> = {};
  for (const [nome, linhas] of Object.entries(inicial)) tabelas[nome] = linhas.map((l) => ({ ...l }));
  const arquivos = new Map(Object.entries(arquivosIniciais));
  const downloads: string[] = [];
  const consultas: Record<string, number> = {};

  // Relógio monotônico: cada linha gravada nasce 1s depois da anterior, para a
  // ordem cronológica e o cursor serem determinísticos.
  let relogio = Date.parse("2026-11-20T12:00:00.000Z");
  const agora = () => new Date((relogio += 1000)).toISOString();

  const from = (tabela: string) => {
    consultas[tabela] = (consultas[tabela] ?? 0) + 1;
    const linhasDaTabela = (tabelas[tabela] ??= []);

    let operacao: "select" | "insert" | "update" = "select";
    let dados: Linha | Linha[] | null = null;
    const predicados: Predicado[] = [];
    const ordens: Array<{ coluna: string; asc: boolean }> = [];
    let limite: number | null = null;

    const comEmbutido = (linha: Linha): Linha => {
      const e = EMBUTIDOS[tabela];
      if (!e) return { ...linha };
      const alvo = (tabelas[e.tabela] ?? []).find((l) => l.id === linha[e.fk]);
      return {
        ...linha,
        [e.campo]: alvo ? Object.fromEntries(e.colunas.map((c) => [c, alvo[c]])) : null,
      };
    };

    const executar = (): { data: Linha[] | null; error: { code?: string; message: string } | null } => {
      if (operacao === "insert") {
        const novas: Linha[] = (Array.isArray(dados) ? dados : [dados!]).map((d) => {
          const carimbo = agora();
          return {
            id: randomUUID(),
            created_at: carimbo,
            updated_at: carimbo,
            ...(tabela === "crm_lead_activities" ? { performed_at: carimbo } : {}),
            ...d,
          };
        });
        const unico = UNICOS[tabela];
        if (unico) {
          const repetida = novas.some((n) => linhasDaTabela.some((l) => unico.every((c) => l[c] === n[c])));
          if (repetida) return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        linhasDaTabela.push(...novas);
        return { data: novas.map(comEmbutido), error: null };
      }

      let achadas = linhasDaTabela.filter((l) => predicados.every((p) => p(l)));
      if (operacao === "update") {
        for (const l of achadas) Object.assign(l, dados as Linha, { updated_at: agora() });
        return { data: achadas.map(comEmbutido), error: null };
      }

      for (const { coluna, asc } of [...ordens].reverse()) {
        achadas = [...achadas].sort((a, b) => {
          const x = String(a[coluna] ?? "");
          const y = String(b[coluna] ?? "");
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      if (limite !== null) achadas = achadas.slice(0, limite);
      return { data: achadas.map(comEmbutido), error: null };
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cadeia: any = {
      select: () => cadeia,
      insert: (linha: Linha | Linha[]) => {
        operacao = "insert";
        dados = linha;
        return cadeia;
      },
      update: (patch: Linha) => {
        operacao = "update";
        dados = patch;
        return cadeia;
      },
      eq: (coluna: string, valor: unknown) => {
        predicados.push((l) => l[coluna] === valor);
        return cadeia;
      },
      is: (coluna: string, valor: null) => {
        predicados.push((l) => (l[coluna] ?? null) === valor);
        return cadeia;
      },
      in: (coluna: string, valores: unknown[]) => {
        predicados.push((l) => valores.includes(l[coluna]));
        return cadeia;
      },
      gt: (coluna: string, valor: string) => {
        predicados.push((l) => l[coluna] != null && String(l[coluna]) > valor);
        return cadeia;
      },
      gte: (coluna: string, valor: string) => {
        predicados.push((l) => l[coluna] != null && String(l[coluna]) >= valor);
        return cadeia;
      },
      lt: (coluna: string, valor: string) => {
        predicados.push((l) => l[coluna] != null && String(l[coluna]) < valor);
        return cadeia;
      },
      lte: (coluna: string, valor: string) => {
        predicados.push((l) => l[coluna] != null && String(l[coluna]) <= valor);
        return cadeia;
      },
      contains: (coluna: string, filtro: unknown) => {
        predicados.push((l) => contem(l[coluna], filtro));
        return cadeia;
      },
      // `.filter(col, "cs", '{"a"}')` e `.not(col, "cs" | "in", …)`: só os
      // operadores que os handlers usam. Outro operador lança, para o teste não
      // ficar verde porque um filtro foi ignorado.
      filter: (coluna: string, op: string, valor: string) => {
        if (op === "cs") predicados.push((l) => contemOArray(l[coluna], valor));
        else if (op === "ov") predicados.push((l) => cruzaOArray(l[coluna], valor));
        else throw new Error(`banco em memória: filter(${op}) não previsto`);
        return cadeia;
      },
      not: (coluna: string, op: string, valor: string) => {
        if (op === "cs") predicados.push((l) => !contemOArray(l[coluna], valor));
        else if (op === "ov") predicados.push((l) => !cruzaOArray(l[coluna], valor));
        else if (op === "in") {
          // Como no Postgres: `not (null in (...))` é nulo, e a linha não passa.
          const fora = valor.replace(/^\(|\)$/g, "").split(",");
          predicados.push((l) => l[coluna] != null && !fora.includes(String(l[coluna])));
        } else throw new Error(`banco em memória: not(${op}) não previsto`);
        return cadeia;
      },
      or: (texto: string) => {
        const alternativas = dividirNoTopo(texto).map(condicao);
        predicados.push((l) => alternativas.some((p) => p(l)));
        return cadeia;
      },
      order: (coluna: string, opcoes?: { ascending?: boolean }) => {
        ordens.push({ coluna, asc: opcoes?.ascending !== false });
        return cadeia;
      },
      limit: (n: number) => {
        limite = n;
        return cadeia;
      },
      maybeSingle: () => {
        const r = executar();
        return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error });
      },
      single: () => {
        const r = executar();
        if (r.error) return Promise.resolve({ data: null, error: r.error });
        if ((r.data ?? []).length !== 1) {
          return Promise.resolve({ data: null, error: { code: "PGRST116", message: "0 rows" } });
        }
        return Promise.resolve({ data: r.data![0], error: null });
      },
      then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
        Promise.resolve(executar()).then(ok, falha),
    };
    return cadeia;
  };

  const storage = {
    from: (bucket: string) => ({
      download: (caminho: string) => {
        downloads.push(`${bucket}/${caminho}`);
        const arquivo = arquivos.get(`${bucket}/${caminho}`);
        if (!arquivo) return Promise.resolve({ data: null, error: { message: "not found" } });
        return Promise.resolve({
          data: new Blob([arquivo.bytes as BlobPart], { type: arquivo.tipo }),
          error: null,
        });
      },
      upload: (caminho: string, bytes: Uint8Array, opcoes?: { contentType?: string }) => {
        arquivos.set(`${bucket}/${caminho}`, { bytes, tipo: opcoes?.contentType ?? "" });
        return Promise.resolve({ data: { path: caminho }, error: null });
      },
      remove: (caminhos: string[]) => {
        for (const c of caminhos) arquivos.delete(`${bucket}/${c}`);
        return Promise.resolve({ data: null, error: null });
      },
      createSignedUrl: (caminho: string, segundos: number) =>
        Promise.resolve({
          data: {
            signedUrl: `https://storage.exemplo.test/storage/v1/object/sign/${bucket}/${caminho}?token=t&exp=${segundos}`,
          },
          error: null,
        }),
    }),
  };

  return { tabelas, arquivos, downloads, cliente: { from, storage }, consultas };
}

/**
 * A porta de SQL (`lib/db`) sobre as MESMAS tabelas — só as três consultas que
 * o serviço de tarefas faz por ela. SQL desconhecido lança: o teste não pode
 * ficar verde porque uma consulta nova foi ignorada.
 */
export function portaEmMemoria(banco: BancoEmMemoria) {
  const queryOne = async (sql: string, p: readonly unknown[] = []): Promise<unknown> => {
    if (sql.includes("from user_organizations")) {
      return (
        (banco.tabelas.user_organizations ?? []).find(
          (l) =>
            l.organization_id === p[0] &&
            l.user_id === p[1] &&
            (l.revoked_at ?? null) === null &&
            l.role !== "viewer",
        ) ?? null
      );
    }
    if (sql.includes("from demandas")) {
      return (
        (banco.tabelas.demandas ?? []).find((l) => l.organization_id === p[0] && l.id === p[1]) ?? null
      );
    }
    throw new Error(`porta em memória: SQL não previsto: ${sql.slice(0, 80)}`);
  };
  const query = async (sql: string, p: readonly unknown[] = []): Promise<unknown[]> => {
    if (sql.includes("insert into crm_lead_activities")) {
      (banco.tabelas.crm_lead_activities ??= []).push({
        id: randomUUID(),
        organization_id: p[0],
        lead_id: p[1],
        contact_id: p[2],
        type: p[3],
        source_module: p[4],
        source_id: p[5],
        actor_kind: p[6],
        actor_agent_id: p[7],
        performed_by_user_id: p[8],
        reason: p[9],
        evidence: p[10],
        payload: p[11],
        performed_at: new Date().toISOString(),
      });
      return [];
    }
    const uma = await queryOne(sql, p);
    return uma ? [uma] : [];
  };
  return { query, queryOne };
}
