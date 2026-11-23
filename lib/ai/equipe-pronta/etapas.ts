/**
 * AS ETAPAS DA EQUIPE — as nove chaves internas e quem é DONO de cada uma.
 *
 * "Uma equipe, um cliente, uma ficha": os quatro papéis trabalham o MESMO
 * negócio, e cada etapa tem um papel que pode mover o negócio para ela. Um
 * papel não move para a etapa de outro: passa a vez. A tabela mora aqui, num
 * arquivo só, porque três lugares precisam concordar com ela:
 *
 *   • o INSTALADOR, que acha ou cria cada etapa no funil (`instalar.ts`);
 *   • a FERRAMENTA, que recusa o movimento de quem não é dono (`dono-de-etapa.ts`);
 *   • o TEXTO do agente, que diz a cada um quais etapas são dele (`renderizar.ts`).
 *
 * A chave é interna e estável. O NOME da etapa é da empresa: o instalador
 * nunca renomeia nem apaga uma etapa, só cria a que falta. O mapeamento
 * chave → etapa real fica em `equipe_pronta_perfis.instalacao.etapas`.
 *
 * Sem dependência de execução (só tipos): é importado pelo schema do perfil e
 * pelas ferramentas MCP.
 */
import type { LeadStage } from "@/lib/agent-engine/agent/lead-state";

export const ETAPAS_DA_EQUIPE = [
  "novo",
  "em_atendimento",
  "qualificado",
  "agendado",
  "compareceu",
  "proposta_enviada",
  "em_negociacao",
  "ganho",
  "perdido",
] as const;
export type ChaveDeEtapa = (typeof ETAPAS_DA_EQUIPE)[number];

/** Os papéis, repetidos aqui como texto para este arquivo não importar o catálogo. */
type Papel = "sdr" | "agendamento" | "proposta" | "recuperador";

export interface DefinicaoDaEtapa {
  chave: ChaveDeEtapa;
  /** O nome com que a etapa NASCE quando o instalador a cria. */
  nome: string;
  /** O slug da etapa criada (`crm_stages.slug`, único por funil). */
  slug: string;
  /** A marca do motor (`crm_stages.agent_stage_hint`), quando existe uma. */
  hint: LeadStage | null;
  ganho: boolean;
  perda: boolean;
  /**
   * Nomes que a etapa costuma ter num funil que já existe. A comparação ignora
   * caixa, acento e espaço (`nomeNormalizado`).
   */
  nomesAceitos: readonly string[];
  /** Quem pode mover um negócio PARA esta etapa. Vazio = qualquer papel. */
  donos: readonly Papel[];
  /** Quando a etapa faz sentido para a empresa. */
  soSe: "sempre" | "agenda" | "proposta";
  /** Como o texto do agente diz de quem é a etapa. */
  quemMove: string;
}

export const DEFINICOES_DAS_ETAPAS: Readonly<Record<ChaveDeEtapa, DefinicaoDaEtapa>> = {
  novo: {
    chave: "novo",
    nome: "Novo",
    slug: "ep_novo",
    hint: "new",
    ganho: false,
    perda: false,
    nomesAceitos: ["novo", "novos", "novo contato", "novos contatos", "entrada", "lead", "leads"],
    // É a entrada do canal: o negócio NASCE aqui. Só volta para cá quem reabre.
    donos: ["recuperador"],
    soSe: "sempre",
    quemMove: "é onde o negócio nasce",
  },
  em_atendimento: {
    chave: "em_atendimento",
    nome: "Em atendimento",
    slug: "ep_em_atendimento",
    hint: "contacted",
    ganho: false,
    perda: false,
    nomesAceitos: ["em atendimento", "atendimento", "em contato", "contato feito", "contatado"],
    donos: ["sdr"],
    soSe: "sempre",
    quemMove: "quem recebe",
  },
  qualificado: {
    chave: "qualificado",
    nome: "Qualificado",
    slug: "ep_qualificado",
    hint: "qualified",
    ganho: false,
    perda: false,
    nomesAceitos: ["qualificado", "qualificados", "qualificada"],
    donos: ["sdr"],
    soSe: "sempre",
    quemMove: "quem recebe",
  },
  agendado: {
    chave: "agendado",
    nome: "Agendado",
    slug: "ep_agendado",
    hint: null,
    ganho: false,
    perda: false,
    nomesAceitos: ["agendado", "agendada", "agendados", "marcado", "compromisso marcado"],
    donos: ["agendamento"],
    soSe: "agenda",
    quemMove: "quem cuida da agenda",
  },
  compareceu: {
    chave: "compareceu",
    nome: "Compareceu",
    slug: "ep_compareceu",
    hint: null,
    ganho: false,
    perda: false,
    nomesAceitos: ["compareceu", "compareceram", "atendido", "atendida", "realizado"],
    donos: ["agendamento"],
    soSe: "agenda",
    quemMove: "quem cuida da agenda",
  },
  proposta_enviada: {
    chave: "proposta_enviada",
    nome: "Proposta enviada",
    slug: "ep_proposta_enviada",
    hint: "negotiating",
    ganho: false,
    perda: false,
    nomesAceitos: ["proposta enviada", "proposta", "propostas", "orçamento enviado", "orçamento"],
    donos: ["proposta"],
    soSe: "proposta",
    quemMove: "quem cuida da proposta",
  },
  em_negociacao: {
    chave: "em_negociacao",
    nome: "Em negociação",
    slug: "ep_em_negociacao",
    hint: null,
    ganho: false,
    perda: false,
    nomesAceitos: ["em negociação", "negociação", "negociando"],
    donos: ["proposta"],
    soSe: "proposta",
    quemMove: "quem cuida da proposta",
  },
  ganho: {
    chave: "ganho",
    nome: "Ganho",
    slug: "ep_ganho",
    hint: "won",
    ganho: true,
    perda: false,
    nomesAceitos: ["ganho", "ganhos", "ganha", "fechado", "fechada", "venda fechada", "vendido"],
    donos: ["proposta"],
    soSe: "sempre",
    quemMove: "quem cuida da proposta, quando a pessoa aceita",
  },
  perdido: {
    chave: "perdido",
    nome: "Perdido",
    slug: "ep_perdido",
    hint: "lost",
    ganho: false,
    perda: true,
    nomesAceitos: ["perdido", "perdidos", "perdida", "perda", "não fechou", "descartado"],
    // Qualquer papel marca a perda, sempre com o motivo. Reabrir é outra regra.
    donos: [],
    soSe: "sempre",
    quemMove: "qualquer um, sempre com o motivo",
  },
};

/** O papel que REABRE um negócio perdido. Os outros passam a vez. */
export const PAPEL_QUE_REABRE: Papel = "recuperador";

/** Compara nomes de etapa sem depender de caixa, acento nem espaço sobrando. */
export function nomeNormalizado(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** A etapa faz sentido para esta empresa? Agenda e proposta são opcionais. */
export function etapaSeAplica(
  chave: ChaveDeEtapa,
  empresa: { agenda: boolean; proposta: boolean },
): boolean {
  const { soSe } = DEFINICOES_DAS_ETAPAS[chave];
  if (soSe === "agenda") return empresa.agenda;
  if (soSe === "proposta") return empresa.proposta;
  return true;
}

export type MapaDeEtapas = Partial<Record<ChaveDeEtapa, string>>;

/** A chave de uma etapa real, pelo mapeamento gravado. `null` = etapa da empresa. */
export function chaveDaEtapa(mapa: MapaDeEtapas, stageId: string | null | undefined): ChaveDeEtapa | null {
  if (!stageId) return null;
  const alvo = stageId.toLowerCase();
  for (const chave of ETAPAS_DA_EQUIPE) {
    if (mapa[chave]?.toLowerCase() === alvo) return chave;
  }
  return null;
}

export type VereditoDoMovimento =
  | { ok: true }
  | {
      ok: false;
      motivo: "etapa_de_outro_papel" | "reabrir_e_da_retomada" | "perda_sem_motivo";
      /** Os papéis que podem fazer este movimento — para a recusa dizer a quem passar. */
      donos: readonly Papel[];
    };

/**
 * UM PAPEL PODE FAZER ESTE MOVIMENTO? — pura, para ser medida sem banco.
 *
 * `destino`/`origem` nulos são etapas que a empresa criou por conta própria e
 * que não estão no mapeamento: não têm dono, e a equipe não as vigia.
 *
 * A ordem das regras:
 *   1. negócio perdido só sai da perda pelas mãos de quem retoma;
 *   2. perder é de qualquer papel, e exige o motivo;
 *   3. cada outra etapa da equipe é de quem é dono dela.
 */
export function papelPodeMover(m: {
  papel: Papel;
  destino: ChaveDeEtapa | null;
  origem: ChaveDeEtapa | null;
  /** O negócio está fechado como perdido (`crm_leads.status = 'lost'`). */
  negocioPerdido: boolean;
  temMotivoDaPerda: boolean;
}): VereditoDoMovimento {
  const saindoDaPerda = (m.negocioPerdido || m.origem === "perdido") && m.destino !== "perdido";
  if (saindoDaPerda && m.papel !== PAPEL_QUE_REABRE) {
    return { ok: false, motivo: "reabrir_e_da_retomada", donos: [PAPEL_QUE_REABRE] };
  }
  if (m.destino === null) return { ok: true };
  if (m.destino === "perdido") {
    return m.temMotivoDaPerda ? { ok: true } : { ok: false, motivo: "perda_sem_motivo", donos: [] };
  }
  // Quem reabre devolve o negócio a qualquer etapa aberta; o ganho segue sendo de quem fecha.
  if (saindoDaPerda && m.destino !== "ganho") return { ok: true };
  const { donos } = DEFINICOES_DAS_ETAPAS[m.destino];
  if (donos.length === 0 || donos.includes(m.papel)) return { ok: true };
  return { ok: false, motivo: "etapa_de_outro_papel", donos };
}

/**
 * EM QUE ETAPA UM PAPEL PODE CRIAR UM NEGÓCIO: na entrada (`novo`), numa etapa
 * dele, ou numa etapa que não é da equipe.
 */
export function papelPodeCriarEm(papel: Papel, destino: ChaveDeEtapa | null): VereditoDoMovimento {
  if (destino === null || destino === "novo") return { ok: true };
  const { donos } = DEFINICOES_DAS_ETAPAS[destino];
  if (destino !== "perdido" && destino !== "ganho" && donos.includes(papel)) return { ok: true };
  return { ok: false, motivo: "etapa_de_outro_papel", donos: destino === "perdido" ? [] : donos };
}

/** Uma etapa do funil, como o banco a guarda — o que o mapeamento precisa ler. */
export interface EtapaLida {
  id: string;
  name: string;
  agent_stage_hint: string | null;
  is_won: boolean;
  is_lost: boolean;
}

/**
 * O mapeamento que as MARCAS do funil já dizem (`agent_stage_hint`, ganho e
 * perda). É a leitura de uma instalação feita antes de o mapeamento ser
 * gravado: ela não tem `instalacao.etapas`, mas o funil dela já tem as marcas.
 */
export function mapaPelasMarcas(etapas: readonly EtapaLida[]): MapaDeEtapas {
  const mapa: MapaDeEtapas = {};
  for (const chave of ETAPAS_DA_EQUIPE) {
    const def = DEFINICOES_DAS_ETAPAS[chave];
    const achada = etapas.find((e) =>
      def.ganho ? e.is_won : def.perda ? e.is_lost : def.hint !== null && e.agent_stage_hint === def.hint,
    );
    if (achada) mapa[chave] = achada.id;
  }
  return mapa;
}
