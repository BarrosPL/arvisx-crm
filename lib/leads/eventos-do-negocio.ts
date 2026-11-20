/**
 * A LINHA DO TEMPO DO NEGÓCIO PARA QUEM NÃO VÊ A TELA — o que aconteceu num
 * negócio, ou em todos os negócios de um funil, num intervalo.
 *
 * ═══ Duas fontes, e por que não uma tabela nova ═══
 *
 * Nada é gravado aqui. A leitura junta o que o produto JÁ guarda:
 *
 *  1. `crm_lead_activities` — a linha do tempo que a pessoa lê no card. Dá
 *     etapa, edição de campo, nota, tarefa e o resto (agenda, retorno,
 *     proposta, passagem para humano), com o ator da linha.
 *  2. `event_log` — os eventos que as automações e os webhooks consomem. Só
 *     três tipos saem daqui: `lead.tag_added`, `lead.tag_removed` e
 *     `lead.assigned`. São os fatos que a linha do tempo não sustenta sozinha:
 *     ela não guarda QUAL tag entrou ou saiu (a linha diz "Alterou as tags",
 *     de propósito — `app/api/v1/leads/_handler.ts`), e a tag posta por
 *     `crm_manage_tags`, em massa ou por automação não gera linha nenhuma. O
 *     `event_log` não é podado pela retenção (é o livro de idempotência dos
 *     gatilhos de tempo).
 *
 * ═══ O que cada fonte NÃO sustenta (e esta leitura não inventa) ═══
 *
 *  - MENSAGEM não é evento de negócio: `messages` é da conversa (do contato), e
 *    um contato com dois negócios teria as mesmas mensagens nos dois. Quem lê
 *    mensagem lê a conversa (`crm_get_conversation_history`).
 *  - `lead.assigned` nasce de um gatilho do banco e não leva quem trocou: o
 *    autor sai `nao_registrado`. Quando a troca veio pela edição do negócio, a
 *    linha de campo vizinha ("Alterou o responsável") tem o autor — inclusive o
 *    agente por token. O gatilho roda dentro do UPDATE de `crm_leads`, sem
 *    contexto de quem chamou, e o produto não tem um jeito de passá-lo a ele.
 *  - Remoção de tag só existe no `event_log` desde que `lead.tag_removed` foi
 *    criado; a remoção anterior a isso aparece só como "Alterou as tags".
 *  - Escrita feita por token de API (o agente externo) sai como `agente`, com o
 *    id e o nome do token: `buildLeadActivityRow` grava `payload.autor` em toda
 *    linha que nasce de um token. A linha gravada ANTES disso não guarda o
 *    token e continua `sistema` (a nota sempre levou o autor). Nada é reescrito.
 *  - Edição de campo traz o NOME dos campos, nunca o valor anterior: o produto
 *    não guarda o antes de título, descrição, tags e campos do funil
 *    (`lib/leads/valores-audit.ts`).
 *
 * ═══ Custo ═══
 *
 * Um negócio: `(organization_id, lead_id, performed_at)` e
 * `(entity_kind, entity_id, created_at)` atendem. Funil inteiro: a consulta
 * filtra por organização, por TIPO (sempre uma lista fechada) e pela janela de
 * tempo, que os índices `(organization_id, type, performed_at)` e
 * `(organization_id, event_type, created_at)` atendem; o pertencimento ao funil
 * é conferido por lote, em `crm_leads`. Por isso o funil exige `desde` e limita
 * a janela (`JANELA_MAXIMA_DO_FUNIL_DIAS`), e cada chamada faz no máximo
 * `RODADAS_POR_CHAMADA` idas ao banco por fonte: a página pode vir menor que o
 * limite com `has_more: true`, e o cursor continua de onde a varredura parou.
 *
 * A ordem é cronológica (o mais antigo primeiro), com o id como desempate. O
 * cursor é o par (instante, id) do último item EXAMINADO, e vale para as duas
 * fontes: nada é pulado nem repetido entre páginas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ACTIVITY_LABELS, type ActivityType } from "@/lib/leads/activity-vocabulary";
import { decodeCursor, encodeCursor } from "@/lib/leads/timeline-query";
import { nomesDosAtendentesCom } from "@/lib/users/nome-do-atendente";

export const TIPOS_DE_EVENTO = ["etapa", "responsavel", "tag", "campo", "nota", "tarefa", "outro"] as const;
export type TipoDeEvento = (typeof TIPOS_DE_EVENTO)[number];

export const AUTORES_DE_EVENTO = ["pessoa", "agente", "sistema", "cliente"] as const;
export type AutorDeEvento = (typeof AUTORES_DE_EVENTO)[number];

/** Janela máxima de uma consulta por funil. */
export const JANELA_MAXIMA_DO_FUNIL_DIAS = 31;

/** Idas ao banco, por fonte, numa chamada. */
export const RODADAS_POR_CHAMADA = 4;

const EVENTO_TAG_ADICIONADA = "lead.tag_added";
const EVENTO_TAG_REMOVIDA = "lead.tag_removed";
const EVENTO_RESPONSAVEL = "lead.assigned";

/** Os tipos da linha do tempo que têm categoria própria; o resto é `outro`. */
const CATEGORIA_DA_ATIVIDADE: Partial<Record<ActivityType, TipoDeEvento>> = {
  lead_created: "etapa",
  stage_changed: "etapa",
  agent_move_corrected: "etapa",
  moved_from_pipeline: "etapa",
  lead_reopened: "etapa",
  demand_closed: "etapa",
  lead_edited: "campo",
  note: "nota",
  task_created: "tarefa",
  task_completed: "tarefa",
  task_plan_applied: "tarefa",
};

const CATEGORIA_DO_EVENTO: Record<string, TipoDeEvento> = {
  [EVENTO_TAG_ADICIONADA]: "tag",
  [EVENTO_TAG_REMOVIDA]: "tag",
  [EVENTO_RESPONSAVEL]: "responsavel",
};

const ROTULO_DO_EVENTO: Record<string, string> = {
  [EVENTO_TAG_ADICIONADA]: "Tag adicionada",
  [EVENTO_TAG_REMOVIDA]: "Tag removida",
  [EVENTO_RESPONSAVEL]: "Responsável alterado",
};

const TODOS_OS_TIPOS_DE_ATIVIDADE = Object.keys(ACTIVITY_LABELS) as ActivityType[];

export function categoriaDaAtividade(tipo: string): TipoDeEvento {
  return CATEGORIA_DA_ATIVIDADE[tipo as ActivityType] ?? "outro";
}

/** Os tipos de `crm_lead_activities` que respondem pelas categorias pedidas. */
export function tiposDeAtividadeDasCategorias(categorias: readonly TipoDeEvento[]): ActivityType[] {
  const pedidas = new Set(categorias);
  return TODOS_OS_TIPOS_DE_ATIVIDADE.filter((t) => pedidas.has(categoriaDaAtividade(t)));
}

/** Os tipos do `event_log` que respondem pelas categorias pedidas. */
export function tiposDeEventoDasCategorias(categorias: readonly TipoDeEvento[]): string[] {
  const pedidas = new Set(categorias);
  return Object.keys(CATEGORIA_DO_EVENTO).filter((t) => pedidas.has(CATEGORIA_DO_EVENTO[t]!));
}

export interface AutorDoEvento {
  /** `nao_registrado`: a fonte não guarda quem agiu (ver o cabeçalho). */
  kind: AutorDeEvento | "nao_registrado";
  id: string | null;
  name: string | null;
  /** Só em `agente`, e só quando quem lê se identificou: foi ele mesmo. */
  is_self?: boolean;
}

/** Quem está lendo, para a linha dizer "foi você": o token e, no agente do CRM, o agente. */
export interface LeitorDosEventos {
  tokenId?: string | null;
  agentId?: string | null;
}

export interface EventoDoNegocio {
  id: string;
  /** De onde a linha veio: a linha do tempo do card ou a fila de eventos. */
  source: "timeline" | "event_log";
  kind: TipoDeEvento;
  /** O tipo cru: o de `crm_lead_activities.type` ou o `event_type`. */
  type: string;
  label: string;
  happened_at: string;
  lead_id: string;
  /** Só na consulta por funil. */
  lead_title?: string | null;
  /** O texto inteiro, como está gravado. */
  text: string;
  author: AutorDoEvento;
  details?: Record<string, unknown>;
}

export type AlvoDosEventos =
  | { leadId: string }
  | {
      pipelineId: string;
      /** Num turno de atendimento, só os negócios deste contato. */
      contatoDoTurno?: string | null;
    };

export interface FiltrosDosEventos {
  /** ISO-8601: a partir deste instante (inclusive). */
  desde?: string;
  /** ISO-8601: antes deste instante (exclusive). */
  ate?: string;
  tipos?: readonly TipoDeEvento[];
  autores?: readonly AutorDeEvento[];
  limite: number;
  cursor?: string;
  leitor?: LeitorDosEventos;
}

export type ListaDeEventos =
  | { ok: true; eventos: EventoDoNegocio[]; cursor: string | null; has_more: boolean }
  | { ok: false; recusa: "cursor_invalido" }
  | { ok: false; recusa: "falha"; erro: string };

interface Posicao {
  performed_at: string;
  id: string;
}

interface LinhaDeAtividade {
  id: string;
  lead_id: string;
  type: string;
  source_id: string | null;
  actor_kind: string | null;
  actor_agent_id: string | null;
  performed_by_user_id: string | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  performed_at: string;
}

interface LinhaDeEvento {
  id: string;
  event_type: string;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Um item ainda sem nomes: a varredura decide com isto, e só a página é enriquecida. */
interface Candidato {
  posicao: Posicao;
  leadId: string;
  evento: EventoDoNegocio;
  /** Ids a resolver em nome, depois de a página estar escolhida. */
  usuarios: string[];
  agentes: string[];
  tokens: string[];
}

const COLUNAS_DA_ATIVIDADE =
  "id, lead_id, type, source_id, actor_kind, actor_agent_id, performed_by_user_id, reason, payload, performed_at";
const COLUNAS_DO_EVENTO = "id, event_type, entity_id, payload, metadata, created_at";

/** O instante numa forma só (UTC com `Z`), para a janela valer igual nas duas fontes. */
function instanteUtc(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? iso : t.toISOString();
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor !== "" ? valor : null;
}

function listaDeTextos(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string") : [];
}

/** Ordem total das duas fontes: instante, depois id. */
function compara(a: Posicao, b: Posicao): number {
  const ta = Date.parse(a.performed_at);
  const tb = Date.parse(b.performed_at);
  if (ta !== tb && !Number.isNaN(ta) && !Number.isNaN(tb)) return ta < tb ? -1 : 1;
  // Mesmo milissegundo: o texto ISO do banco desempata os microssegundos.
  if (a.performed_at !== b.performed_at) return a.performed_at < b.performed_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function depoisDe(coluna: string, c: Posicao): string {
  return `${coluna}.gt.${c.performed_at},and(${coluna}.eq.${c.performed_at},id.gt.${c.id})`;
}

function autorDaAtividade(linha: LinhaDeAtividade): Pick<Candidato, "usuarios" | "agentes" | "tokens"> & {
  autor: AutorDoEvento;
} {
  const gravado = (linha.payload?.autor ?? null) as { tipo?: unknown; id?: unknown; nome?: unknown } | null;
  if (linha.actor_kind === "user") {
    return {
      autor: { kind: "pessoa", id: linha.performed_by_user_id, name: null },
      usuarios: linha.performed_by_user_id ? [linha.performed_by_user_id] : [],
      agentes: [],
      tokens: [],
    };
  }
  if (linha.actor_kind === "contact") {
    return { autor: { kind: "cliente", id: null, name: null }, usuarios: [], agentes: [], tokens: [] };
  }
  if (linha.actor_agent_id) {
    return {
      autor: { kind: "agente", id: linha.actor_agent_id, name: texto(gravado?.nome) },
      usuarios: [],
      agentes: [linha.actor_agent_id],
      tokens: [],
    };
  }
  // A escrita por token (agente externo): a linha é de sistema para a tela, e o
  // autor está no payload. A nota grava também o nome; as outras linhas só o id
  // (`buildLeadActivityRow`), e o nome sai do cadastro, com a organização.
  if (gravado && (gravado.tipo === "agente" || gravado.tipo === "token")) {
    const id = texto(gravado.id);
    const nome = texto(gravado.nome);
    const semNome = id !== null && nome === null;
    return {
      autor: { kind: "agente", id, name: nome },
      usuarios: [],
      agentes: semNome && gravado.tipo === "agente" ? [id] : [],
      tokens: semNome && gravado.tipo === "token" ? [id] : [],
    };
  }
  if (linha.actor_kind === "ai") {
    return { autor: { kind: "agente", id: null, name: null }, usuarios: [], agentes: [], tokens: [] };
  }
  return { autor: { kind: "sistema", id: null, name: null }, usuarios: [], agentes: [], tokens: [] };
}

function detalhesDaAtividade(categoria: TipoDeEvento, linha: LinhaDeAtividade): Record<string, unknown> | undefined {
  const p = linha.payload ?? {};
  const escolhe = (chaves: readonly string[]) => {
    const saida: Record<string, unknown> = {};
    for (const chave of chaves) if (p[chave] !== undefined && p[chave] !== null) saida[chave] = p[chave];
    return saida;
  };
  let detalhes: Record<string, unknown> = {};
  if (categoria === "etapa") detalhes = escolhe(["from_stage_id", "to_stage_id", "pipeline_id", "desfecho"]);
  else if (categoria === "campo") detalhes = escolhe(["fields"]);
  else if (categoria === "nota") detalhes = texto(p.destinatario) ? { recipient: p.destinatario } : {};
  else if (categoria === "tarefa") {
    detalhes = { ...(linha.source_id ? { task_id: linha.source_id } : {}), ...escolhe(["due_date", "priority"]) };
  }
  return Object.keys(detalhes).length > 0 ? detalhes : undefined;
}

function candidatoDaAtividade(linha: LinhaDeAtividade): Candidato {
  const categoria = categoriaDaAtividade(linha.type);
  const { autor, usuarios, agentes, tokens } = autorDaAtividade(linha);
  // A nota devolve o texto sem o nome na frente; o resto, o que a pessoa lê no card.
  const textoDaNota = categoria === "nota" ? texto(linha.payload?.texto) : null;
  const detalhes = detalhesDaAtividade(categoria, linha);
  return {
    posicao: { performed_at: linha.performed_at, id: linha.id },
    leadId: linha.lead_id,
    usuarios,
    agentes,
    tokens,
    evento: {
      id: linha.id,
      source: "timeline",
      kind: categoria,
      type: linha.type,
      label: ACTIVITY_LABELS[linha.type as ActivityType] ?? linha.type,
      happened_at: linha.performed_at,
      lead_id: linha.lead_id,
      text: textoDaNota ?? linha.reason ?? "",
      author: autor,
      ...(detalhes ? { details: detalhes } : {}),
    },
  };
}

function autorDoEvento(metadata: Record<string, unknown> | null): Pick<Candidato, "tokens" | "agentes"> & {
  autor: AutorDoEvento;
} {
  const tipo = texto(metadata?.actor_type);
  if (tipo === "user") return { autor: { kind: "pessoa", id: null, name: null }, tokens: [], agentes: [] };
  if (tipo === "ai_agent" || tipo === "api_token") {
    // O agente do CRM é identificado pelo agente: o token dele é o efêmero da
    // rodada e o `actor_id` é o id da execução, e nenhum dos dois nomeia alguém.
    const agente = tipo === "ai_agent" ? texto(metadata?.agent_id) : null;
    if (agente) return { autor: { kind: "agente", id: agente, name: null }, tokens: [], agentes: [agente] };
    // O token é o que identifica o agente de fora.
    const token = texto(metadata?.actor_api_token_id) ?? (tipo === "api_token" ? texto(metadata?.actor_id) : null);
    return { autor: { kind: "agente", id: token, name: null }, tokens: token ? [token] : [], agentes: [] };
  }
  if (tipo) return { autor: { kind: "sistema", id: null, name: null }, tokens: [], agentes: [] };
  return { autor: { kind: "nao_registrado", id: null, name: null }, tokens: [], agentes: [] };
}

function candidatoDoEvento(linha: LinhaDeEvento): Candidato | null {
  const leadId = linha.entity_id ?? texto(linha.payload?.lead_id);
  const categoria = CATEGORIA_DO_EVENTO[linha.event_type];
  if (!leadId || !categoria) return null;
  const p = linha.payload ?? {};
  const { autor, tokens, agentes: agentesDoAutor } = autorDoEvento(linha.metadata);

  let textoDoEvento = ROTULO_DO_EVENTO[linha.event_type]!;
  let detalhes: Record<string, unknown> = {};
  const usuarios: string[] = [];
  const agentes: string[] = [...agentesDoAutor];

  if (linha.event_type === EVENTO_TAG_ADICIONADA) {
    const tags = listaDeTextos(p.added_tags);
    detalhes = { added_tags: tags };
    textoDoEvento = `Tag adicionada: ${tags.join(", ")}`;
  } else if (linha.event_type === EVENTO_TAG_REMOVIDA) {
    const tags = listaDeTextos(p.removed_tags);
    detalhes = { removed_tags: tags };
    textoDoEvento = `Tag removida: ${tags.join(", ")}`;
  } else {
    for (const chave of ["from_user_id", "to_user_id", "from_agent_id", "to_agent_id"] as const) {
      const id = texto(p[chave]);
      if (!id) continue;
      detalhes[chave] = id;
      (chave.endsWith("user_id") ? usuarios : agentes).push(id);
    }
  }

  return {
    posicao: { performed_at: linha.created_at, id: linha.id },
    leadId,
    usuarios,
    agentes,
    tokens,
    evento: {
      id: linha.id,
      source: "event_log",
      kind: categoria,
      type: linha.event_type,
      label: ROTULO_DO_EVENTO[linha.event_type]!,
      happened_at: linha.created_at,
      lead_id: leadId,
      text: textoDoEvento,
      author: autor,
      details: detalhes,
    },
  };
}

function emLotes<T>(itens: readonly T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/** Ids que cabem numa URL do PostgREST sem estourar o teto do proxy. */
const IDS_POR_CONSULTA = 80;

async function nomesPorId(
  supabase: SupabaseClient,
  tabela: "ai_agents" | "api_tokens",
  organizationId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const nomes = new Map<string, string>();
  const unicos = [...new Set(ids)];
  for (const lote of emLotes(unicos, IDS_POR_CONSULTA)) {
    const { data } = await supabase
      .from(tabela)
      .select("id, name")
      .eq("organization_id", organizationId)
      .in("id", lote);
    for (const linha of (data ?? []) as Array<{ id: string; name: string | null }>) {
      if (typeof linha.name === "string" && linha.name.trim() !== "") nomes.set(linha.id, linha.name.trim());
    }
  }
  return nomes;
}

/** Ids em formato de uuid: o que não é nem vai ao banco (a coluna é uuid). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Põe os nomes na página escolhida. Um nome que falta sai `null`, nunca derruba a leitura. */
async function comNomes(
  supabase: SupabaseClient,
  organizationId: string,
  pagina: Candidato[],
  leitor: LeitorDosEventos | undefined,
): Promise<EventoDoNegocio[]> {
  const usuarios = pagina.flatMap((c) => c.usuarios);
  const agentes = pagina.flatMap((c) => c.agentes).filter((id) => UUID.test(id));
  const tokens = pagina.flatMap((c) => c.tokens).filter((id) => UUID.test(id));

  const [nomeDoUsuario, nomeDoAgente, nomeDoToken] = await Promise.all([
    usuarios.length > 0
      ? nomesDosAtendentesCom(supabase, organizationId, usuarios).catch(() => new Map<string, string | null>())
      : new Map<string, string | null>(),
    agentes.length > 0 ? nomesPorId(supabase, "ai_agents", organizationId, agentes) : new Map<string, string>(),
    tokens.length > 0 ? nomesPorId(supabase, "api_tokens", organizationId, tokens) : new Map<string, string>(),
  ]);

  return pagina.map(({ evento, tokens: tokensDaLinha }) => {
    const autor = { ...evento.author };
    if (autor.id && !autor.name) {
      if (autor.kind === "pessoa") autor.name = nomeDoUsuario.get(autor.id) ?? null;
      else if (autor.kind === "agente") {
        // Cada linha diz em qual cadastro o id mora: token (agente de fora) ou agente do CRM.
        autor.name = (tokensDaLinha.includes(autor.id) ? nomeDoToken : nomeDoAgente).get(autor.id) ?? null;
      }
    }
    if (autor.kind === "agente" && leitor) {
      autor.is_self = autor.id !== null && (autor.id === leitor.tokenId || autor.id === leitor.agentId);
    }
    if (evento.type !== EVENTO_RESPONSAVEL) return { ...evento, author: autor };

    // Só o NOME de quem saiu e de quem entrou: nunca e-mail nem telefone.
    const d = evento.details ?? {};
    const nome = (id: unknown, mapa: ReadonlyMap<string, string | null>) =>
      typeof id === "string" ? (mapa.get(id) ?? null) : null;
    const de = nome(d.from_user_id, nomeDoUsuario) ?? nome(d.from_agent_id, nomeDoAgente);
    const para = nome(d.to_user_id, nomeDoUsuario) ?? nome(d.to_agent_id, nomeDoAgente);
    const semDonoAntes = !d.from_user_id && !d.from_agent_id;
    const semDonoDepois = !d.to_user_id && !d.to_agent_id;
    return {
      ...evento,
      author: autor,
      text: `Responsável: ${semDonoAntes ? "ninguém" : (de ?? "sem nome")} → ${semDonoDepois ? "ninguém" : (para ?? "sem nome")}`,
      details: { ...d, from_name: de, to_name: para },
    };
  });
}

/**
 * Os eventos de UM negócio, ou dos negócios de UM funil, em ordem cronológica.
 *
 * Quem chama já conferiu o alvo (negócio ou funil da organização do contexto) e
 * a janela. A organização é filtrada em toda consulta: o cliente é de serviço.
 */
export async function listarEventosDoNegocio(
  supabase: SupabaseClient,
  organizationId: string,
  alvo: AlvoDosEventos,
  filtros: FiltrosDosEventos,
): Promise<ListaDeEventos> {
  let cursor: Posicao | null = filtros.cursor ? decodeCursor(filtros.cursor) : null;
  if (filtros.cursor && !cursor) return { ok: false, recusa: "cursor_invalido" };

  const funil = "pipelineId" in alvo ? alvo : null;
  const leadId = "leadId" in alvo ? alvo.leadId : null;
  const porFunil = funil !== null;
  const categorias = filtros.tipos && filtros.tipos.length > 0 ? [...new Set(filtros.tipos)] : null;
  const autores = filtros.autores && filtros.autores.length > 0 ? new Set<string>(filtros.autores) : null;
  const desde = filtros.desde ? instanteUtc(filtros.desde) : null;
  const ate = filtros.ate ? instanteUtc(filtros.ate) : null;

  // Por funil o tipo é SEMPRE uma lista fechada: é o que deixa o índice por
  // (organização, tipo, data) atender. Num negócio só, sem filtro de categoria,
  // entra tudo — inclusive tipo legado que o vocabulário não conhece.
  const tiposDeAtividade = categorias
    ? tiposDeAtividadeDasCategorias(categorias)
    : porFunil
      ? TODOS_OS_TIPOS_DE_ATIVIDADE
      : null;
  const tiposDeEvento = tiposDeEventoDasCategorias(categorias ?? TIPOS_DE_EVENTO);
  // Fonte que não responde por nenhuma categoria pedida não é consultada.
  const semAtividades = tiposDeAtividade !== null && tiposDeAtividade.length === 0;
  const semEventos = tiposDeEvento.length === 0;

  const lote = filtros.limite + 1;
  /** Por funil: negócio → título, ou `null` quando não é do funil (ou é de contato fora do alcance). */
  const negocios = new Map<string, { title: string | null } | null>();
  const pagina: Candidato[] = [];
  let haMais = false;

  try {
    for (let rodada = 0; rodada < RODADAS_POR_CHAMADA; rodada++) {
      // "Esgotada" vale só para ESTA rodada: a fonte que acabou pode ter trazido
      // linha depois do horizonte da outra, que fica para a rodada seguinte e
      // precisa ser lida de novo a partir do cursor.
      let atividadesEsgotadas = true;
      let eventosEsgotados = true;

      let atividades: LinhaDeAtividade[] = [];
      if (!semAtividades) {
        let q = supabase.from("crm_lead_activities").select(COLUNAS_DA_ATIVIDADE).eq("organization_id", organizationId);
        if (leadId) q = q.eq("lead_id", leadId);
        if (tiposDeAtividade) q = q.in("type", tiposDeAtividade);
        if (desde) q = q.gte("performed_at", desde);
        if (ate) q = q.lt("performed_at", ate);
        if (cursor) q = q.or(depoisDe("performed_at", cursor));
        const { data, error } = await q
          .order("performed_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(lote);
        if (error) return { ok: false, recusa: "falha", erro: error.message };
        atividades = (data ?? []) as LinhaDeAtividade[];
        atividadesEsgotadas = atividades.length < lote;
      }

      let eventos: LinhaDeEvento[] = [];
      if (!semEventos) {
        let q = supabase
          .from("event_log")
          .select(COLUNAS_DO_EVENTO)
          .eq("organization_id", organizationId)
          .in("event_type", tiposDeEvento);
        // O gatilho do banco grava `lead`; os emissores do app, `crm_lead`.
        if (leadId) q = q.in("entity_kind", ["crm_lead", "lead"]).eq("entity_id", leadId);
        if (desde) q = q.gte("created_at", desde);
        if (ate) q = q.lt("created_at", ate);
        if (cursor) q = q.or(depoisDe("created_at", cursor));
        const { data, error } = await q
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(lote);
        if (error) return { ok: false, recusa: "falha", erro: error.message };
        eventos = (data ?? []) as LinhaDeEvento[];
        eventosEsgotados = eventos.length < lote;
      }

      // Só é seguro emitir até onde TODA fonte ainda aberta já foi lida: depois
      // desse ponto pode haver linha não buscada da outra fonte que vem antes.
      const fimDasAtividades = atividades.length > 0 ? atividades[atividades.length - 1]! : null;
      const fimDosEventos = eventos.length > 0 ? eventos[eventos.length - 1]! : null;
      const horizontes: Posicao[] = [];
      if (!atividadesEsgotadas && fimDasAtividades) {
        horizontes.push({ performed_at: fimDasAtividades.performed_at, id: fimDasAtividades.id });
      }
      if (!eventosEsgotados && fimDosEventos) {
        horizontes.push({ performed_at: fimDosEventos.created_at, id: fimDosEventos.id });
      }
      const horizonte = horizontes.sort(compara)[0] ?? null;

      const candidatos = [
        ...atividades.map(candidatoDaAtividade),
        ...eventos.map(candidatoDoEvento).filter((c): c is Candidato => c !== null),
      ]
        .sort((a, b) => compara(a.posicao, b.posicao))
        .filter((c) => !horizonte || compara(c.posicao, horizonte) <= 0);

      if (funil) {
        const novos = [...new Set(candidatos.map((c) => c.leadId))].filter((id) => !negocios.has(id));
        for (const ids of emLotes(novos, IDS_POR_CONSULTA)) {
          let q = supabase
            .from("crm_leads")
            .select("id, contact_id, title")
            .eq("organization_id", organizationId)
            .eq("pipeline_id", funil.pipelineId)
            .in("id", ids);
          if (funil.contatoDoTurno) q = q.eq("contact_id", funil.contatoDoTurno);
          const { data, error } = await q;
          if (error) return { ok: false, recusa: "falha", erro: error.message };
          const achados = new Map(
            ((data ?? []) as Array<{ id: string; contact_id: string | null; title: string | null }>).map((l) => [l.id, l]),
          );
          // Negócio de contato marcado como pessoal fica fora da operação, como
          // nas outras leituras de negócio. Conferido no lote, sem lista na URL.
          const contatos = [...new Set([...achados.values()].map((l) => l.contact_id).filter((c): c is string => !!c))];
          const pessoais = new Set<string>();
          if (contatos.length > 0) {
            const { data: marcados, error: erroDosContatos } = await supabase
              .from("contacts")
              .select("id")
              .eq("organization_id", organizationId)
              .eq("is_personal", true)
              .in("id", contatos);
            if (erroDosContatos) return { ok: false, recusa: "falha", erro: erroDosContatos.message };
            for (const c of (marcados ?? []) as Array<{ id: string }>) pessoais.add(c.id);
          }
          for (const id of ids) {
            const lead = achados.get(id);
            negocios.set(id, lead && !(lead.contact_id && pessoais.has(lead.contact_id)) ? { title: lead.title } : null);
          }
        }
      }

      let cheia = false;
      for (const candidato of candidatos) {
        if (pagina.length >= filtros.limite) {
          cheia = true;
          break;
        }
        cursor = candidato.posicao;
        if (categorias && !categorias.includes(candidato.evento.kind)) continue;
        if (autores && !autores.has(candidato.evento.author.kind)) continue;
        if (porFunil) {
          const negocio = negocios.get(candidato.leadId);
          if (!negocio) continue;
          candidato.evento.lead_title = negocio.title;
        }
        pagina.push(candidato);
      }

      if (cheia) {
        haMais = true;
        break;
      }
      haMais = !(atividadesEsgotadas && eventosEsgotados);
      if (!haMais || pagina.length >= filtros.limite) break;
      // Fonte aberta que não trouxe nada dentro do horizonte não anda: parar
      // aqui evita repetir a mesma consulta até o fim das rodadas.
      if (candidatos.length === 0) break;
    }
  } catch (err) {
    return { ok: false, recusa: "falha", erro: err instanceof Error ? err.message : String(err) };
  }

  return {
    ok: true,
    eventos: await comNomes(supabase, organizationId, pagina, filtros.leitor),
    has_more: haMais,
    cursor: haMais && cursor ? encodeCursor(cursor) : null,
  };
}
