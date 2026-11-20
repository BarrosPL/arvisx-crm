/**
 * Um banco em memória, do tamanho do que os testes de comentários precisam.
 *
 * Não é um dublê que devolve o que o teste mandou: ele APLICA os filtros
 * (`eq`, `is`, `in`, `gte`, `not … is null`, o `or` do cursor), a ordem e o
 * limite, e o `update` só muda a linha que casou. É isso que deixa o teste
 * medir o que importa aqui — o filtro por organização e o UPDATE condicional
 * que impede a resposta em dobro. Um `update` que não casa linha nenhuma
 * devolve lista vazia, como o PostgREST.
 *
 * `updated_at` anda a cada `update`, como o gatilho `fn_set_updated_at` do banco.
 */
type Linha = Record<string, unknown>;

export interface BancoFalso {
  tabelas: Record<string, Linha[]>;
  from: (tabela: string) => Consulta;
  rpc: (nome: string, args: unknown) => Promise<{ data: unknown; error: null }>;
  /** Toda chamada feita, para o teste conferir filtro e tabela. */
  chamadas: { tabela: string; operacao: string; filtros: string[] }[];
}

let relogio = Date.parse("2026-11-20T12:00:00.000Z");
let serie = 0;
const novoId = () => `00000000-0000-4000-8000-${String(++serie).padStart(12, "0")}`;

class Consulta {
  private operacao: "select" | "update" | "insert" = "select";
  private filtros: ((l: Linha) => boolean)[] = [];
  private descricao: string[] = [];
  private ordens: { coluna: string; asc: boolean }[] = [];
  private teto: number | null = null;
  private valores: Linha = {};
  private devolve = false;

  constructor(
    private banco: BancoFalso,
    private tabela: string,
  ) {}

  select(_colunas?: string) {
    if (this.operacao !== "select") this.devolve = true;
    return this;
  }
  update(valores: Linha) {
    this.operacao = "update";
    this.valores = valores;
    return this;
  }
  insert(valores: Linha) {
    this.operacao = "insert";
    this.valores = valores;
    return this;
  }
  private filtro(nome: string, f: (l: Linha) => boolean) {
    this.descricao.push(nome);
    this.filtros.push(f);
    return this;
  }
  eq(coluna: string, valor: unknown) {
    return this.filtro(`eq:${coluna}`, (l) => l[coluna] === valor);
  }
  is(coluna: string, valor: null) {
    return this.filtro(`is:${coluna}`, (l) => (l[coluna] ?? null) === valor);
  }
  in(coluna: string, valores: unknown[]) {
    return this.filtro(`in:${coluna}`, (l) => valores.includes(l[coluna]));
  }
  gte(coluna: string, valor: string) {
    return this.filtro(`gte:${coluna}`, (l) => String(l[coluna]) >= valor);
  }
  not(coluna: string, operador: string, valor: null) {
    if (operador !== "is" || valor !== null) throw new Error("banco falso: só `not(coluna, 'is', null)`");
    return this.filtro(`not-null:${coluna}`, (l) => (l[coluna] ?? null) !== null);
  }
  /** Só a forma do cursor: `a.lt.X,and(a.eq.X,id.lt.Y)`. */
  or(expressao: string) {
    const m = /^(\w+)\.lt\.([^,]+),and\(\1\.eq\.\2,id\.lt\.([0-9a-f-]+)\)$/.exec(expressao);
    if (!m) throw new Error(`banco falso: or() fora da forma do cursor: ${expressao}`);
    const [, coluna, quando, id] = m as unknown as [string, string, string, string];
    return this.filtro("or:cursor", (l) => {
      const v = new Date(String(l[coluna])).toISOString();
      return v < quando || (v === quando && String(l.id) < id);
    });
  }
  order(coluna: string, opcoes?: { ascending?: boolean }) {
    this.ordens.push({ coluna, asc: opcoes?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.teto = n;
    return this;
  }
  async maybeSingle() {
    const r = this.executar();
    return { data: r.data[0] ?? null, error: null };
  }
  async single() {
    const r = this.executar();
    return r.data[0]
      ? { data: r.data[0], error: null }
      : { data: null, error: { code: "PGRST116", message: "0 rows" } };
  }
  then<T>(ok: (v: { data: Linha[]; error: null }) => T, falha?: (e: unknown) => T) {
    return Promise.resolve()
      .then(() => this.executar())
      .then(ok, falha);
  }

  private executar(): { data: Linha[]; error: null } {
    const linhas = (this.banco.tabelas[this.tabela] ??= []);
    this.banco.chamadas.push({ tabela: this.tabela, operacao: this.operacao, filtros: [...this.descricao] });
    if (this.operacao === "insert") {
      const agora = new Date((relogio += 1000)).toISOString();
      const nova = { id: novoId(), created_at: agora, updated_at: agora, ...this.valores };
      linhas.push(nova);
      return { data: [{ ...nova }], error: null };
    }
    let casadas = linhas.filter((l) => this.filtros.every((f) => f(l)));
    if (this.operacao === "update") {
      for (const l of casadas) Object.assign(l, this.valores, { updated_at: new Date((relogio += 1000)).toISOString() });
      return { data: this.devolve ? casadas.map((l) => ({ ...l })) : [], error: null };
    }
    for (const { coluna, asc } of [...this.ordens].reverse()) {
      casadas = [...casadas].sort((a, b) => {
        const x = String(a[coluna]);
        const y = String(b[coluna]);
        return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
      });
    }
    if (this.teto !== null) casadas = casadas.slice(0, this.teto);
    return { data: casadas.map((l) => ({ ...l })), error: null };
  }
}

export function criarBancoFalso(tabelas: Record<string, Linha[]> = {}): BancoFalso {
  const banco: BancoFalso = {
    tabelas,
    chamadas: [],
    from: (tabela) => new Consulta(banco, tabela),
    rpc: async () => ({ data: null, error: null }),
  };
  return banco;
}
