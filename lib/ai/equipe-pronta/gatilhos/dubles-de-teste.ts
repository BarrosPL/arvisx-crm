/**
 * Dublê mínimo do supabase-js para os testes dos gatilhos.
 *
 * GUARDA as linhas por tabela, FILTRA de verdade (`eq`, `neq`, `in`, `gt`) e
 * APLICA `update`/`insert` nelas: o teste confere o que ficou gravado, não a
 * ordem das chamadas. Só o que os gatilhos usam; nada de ordenação nem join.
 *
 * Só é importado por arquivos `*.test.ts`.
 */
type Linha = Record<string, unknown>;

export interface Escrita {
  tabela: string;
  operacao: "update" | "insert";
  dados: Linha;
  /** As linhas alcançadas pelo `update` (vazio no `insert`). */
  alcancadas: Linha[];
}

export interface DubleDoSupabase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dublê: assume a forma do SupabaseClient
  cliente: any;
  tabelas: Record<string, Linha[]>;
  escritas: Escrita[];
  /** Faz toda leitura desta tabela devolver erro. */
  quebrar(tabela: string): void;
}

export function dublarSupabase(tabelas: Record<string, Linha[]>): DubleDoSupabase {
  const escritas: Escrita[] = [];
  const quebradas = new Set<string>();

  const from = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let patch: Linha | null = null;
    let novas: Linha[] | null = null;
    let contar = false;
    let limite: number | null = null;

    const alvo = () => (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));

    const executar = (): { data: unknown; error: { message: string; code?: string } | null; count?: number } => {
      if (quebradas.has(tabela)) return { data: null, error: { message: `falha em ${tabela}` } };
      if (novas) {
        tabelas[tabela] = [...(tabelas[tabela] ?? []), ...novas];
        for (const dados of novas) escritas.push({ tabela, operacao: "insert", dados, alcancadas: [] });
        return { data: novas, error: null };
      }
      const linhas = alvo();
      if (patch) {
        for (const l of linhas) Object.assign(l, patch);
        escritas.push({ tabela, operacao: "update", dados: patch, alcancadas: linhas });
        return { data: linhas, error: null };
      }
      if (contar) return { data: null, error: null, count: linhas.length };
      return { data: limite === null ? linhas : linhas.slice(0, limite), error: null };
    };

    const q: Record<string, unknown> = {
      select: (_colunas?: string, opcoes?: { count?: string; head?: boolean }) => {
        if (opcoes?.head) contar = true;
        return q;
      },
      update: (dados: Linha) => {
        patch = dados;
        return q;
      },
      insert: (dados: Linha | Linha[]) => {
        novas = (Array.isArray(dados) ? dados : [dados]).map((d, i) => ({ id: `novo-${tabela}-${i + 1}`, ...d }));
        return q;
      },
      eq: (coluna: string, valor: unknown) => {
        filtros.push((l) => l[coluna] === valor);
        return q;
      },
      neq: (coluna: string, valor: unknown) => {
        filtros.push((l) => l[coluna] !== valor);
        return q;
      },
      // `.is(coluna, null)`: nulo e ausente são a mesma coisa, como no banco.
      is: (coluna: string, valor: unknown) => {
        filtros.push((l) => (valor === null ? l[coluna] === null || l[coluna] === undefined : l[coluna] === valor));
        return q;
      },
      in: (coluna: string, valores: unknown[]) => {
        filtros.push((l) => valores.includes(l[coluna]));
        return q;
      },
      gt: (coluna: string, valor: string) => {
        filtros.push((l) => typeof l[coluna] === "string" && (l[coluna] as string) > valor);
        return q;
      },
      order: () => q,
      limit: (n: number) => {
        limite = n;
        return q;
      },
      maybeSingle: async () => {
        const r = executar();
        if (r.error) return r;
        const linhas = r.data as Linha[];
        return { data: linhas[0] ?? null, error: null };
      },
      single: async () => {
        const r = executar();
        if (r.error) return r;
        const linhas = r.data as Linha[];
        return linhas[0] ? { data: linhas[0], error: null } : { data: null, error: { message: "sem linha" } };
      },
      then: (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(executar()).then(resolve, reject),
    };
    return q;
  };

  return {
    cliente: { from },
    tabelas,
    escritas,
    quebrar: (tabela) => quebradas.add(tabela),
  };
}

export const ORG = "11111111-1111-4111-8111-111111111111";
export const CANAL = "22222222-2222-4222-8222-222222222222";
export const FUNIL = "33333333-3333-4333-8333-333333333333";
export const CONTATO = "44444444-4444-4444-8444-444444444444";
export const CONVERSA = "55555555-5555-4555-8555-555555555555";
export const NEGOCIO = "66666666-6666-4666-8666-666666666666";
export const TIPO_DE_AGENDA = "77777777-7777-4777-8777-777777777777";
export const ETAPA_PROPOSTA_ENVIADA = "88888888-8888-4888-8888-888888888881";
export const ETAPA_EM_NEGOCIACAO = "88888888-8888-4888-8888-888888888882";
export const ETAPA_QUALIFICADO = "88888888-8888-4888-8888-888888888883";
export const AGENTES = {
  sdr: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  agendamento: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  proposta: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  recuperador: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
} as const;
export const FLUXOS = {
  regua: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  falta: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
  proposta: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
} as const;

const VERSAO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HASH = "0".repeat(64);

/** A linha de `equipe_pronta_perfis` de uma equipe instalada, com os quatro agentes e os três fluxos. */
export function perfilInstalado(mudancas: { modo?: string; pausa?: unknown; estado?: string; instalacao?: Linha } = {}): Linha {
  const agente = (id: string) => ({ agent_id: id, version_id: VERSAO, versao_do_papel: 2, hash: HASH });
  return {
    organization_id: ORG,
    estado: mudancas.estado ?? "instalado",
    modo: mudancas.modo ?? "ativo",
    respostas: { negocio: { idioma: "pt-BR" } },
    instalacao: {
      channel_session_id: CANAL,
      pipeline_id: FUNIL,
      event_type_id: TIPO_DE_AGENDA,
      followup_flow_pointer_id: FLUXOS.regua,
      etapas: {
        qualificado: ETAPA_QUALIFICADO,
        proposta_enviada: ETAPA_PROPOSTA_ENVIADA,
        em_negociacao: ETAPA_EM_NEGOCIACAO,
      },
      agentes: {
        sdr: agente(AGENTES.sdr),
        agendamento: agente(AGENTES.agendamento),
        proposta: agente(AGENTES.proposta),
        recuperador: agente(AGENTES.recuperador),
      },
      gatilhos: {
        fluxo_de_falta_id: FLUXOS.falta,
        fluxo_de_proposta_parada_id: FLUXOS.proposta,
        regra_de_proposta_parada_id: null,
      },
      pausa: mudancas.pausa ?? null,
      ...(mudancas.instalacao ?? {}),
    },
  };
}

/** Um banco com a equipe instalada e um cliente com quem se pode falar. */
export function bancoPadrao(mudancas: Record<string, Linha[]> = {}): Record<string, Linha[]> {
  return {
    equipe_pronta_perfis: [perfilInstalado()],
    ai_agents: Object.values(AGENTES).map((id) => ({
      id,
      organization_id: ORG,
      paused_at: null,
      archived_at: null,
      config: { equipe_pronta: { papel: "x", versao: 2 } },
    })),
    contacts: [
      {
        id: CONTATO,
        organization_id: ORG,
        is_blocked: false,
        is_personal: false,
        force_human: false,
        ai_opt_out: false,
        phone_number: "+5511999990000",
      },
    ],
    conversations: [
      {
        id: CONVERSA,
        organization_id: ORG,
        contact_id: CONTATO,
        channel_session_id: CANAL,
        bot_silenced_until: null,
        last_inbound_at: "2026-11-10T12:00:00.000Z",
        active_ai_agent_id: null,
        active_intent: null,
      },
    ],
    channel_sessions: [{ id: CANAL, organization_id: ORG, status: "WORKING", archived_at: null, metadata: {} }],
    ...mudancas,
  };
}
