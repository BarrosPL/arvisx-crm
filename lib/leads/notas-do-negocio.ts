/**
 * A NOTA DO NEGÓCIO COM AUTORIA — o que um agente deixa escrito para a equipe
 * (e para outro agente) na linha do tempo do negócio.
 *
 * ═══ NÃO É A FICHA DO AGENTE, e as duas continuam existindo ═══
 *
 * O produto tem DUAS coisas que se chamam "nota", e elas não são a mesma:
 *
 *  - **A ficha do agente** (`lead_notes`, `lib/agent-engine/agent/lead-notes.ts`,
 *    ferramentas `save_lead_note`/`get_lead_note` do motor nativo). É a MEMÓRIA
 *    do agente sobre a pessoa: por CONTATO, com orçamento fixo de tokens (o
 *    índice inteiro entra no prompt de cada turno), consolidada pelo próprio
 *    agente — uma nota substitui e APAGA as anteriores (`supersedes`) — e sem
 *    autor: quem escreve é sempre "o agente daquele contato".
 *
 *  - **A nota do negócio** (este módulo). É um REGISTRO: por NEGÓCIO, com autor,
 *    data e texto inteiro, que ninguém reescreve nem apaga, e que a equipe lê na
 *    linha do tempo do card (`crm_lead_activities`, tipo `note`).
 *
 * Unificar as duas quebraria uma delas: a ficha é podada para caber no prompt
 * (um registro com autoria não pode ser podado), é por contato (uma pessoa com
 * dois negócios teria as notas de um no outro) e não guarda quem escreveu. Por
 * isso ficam separadas, e a leitura das duas é oferecida lado a lado
 * (`fichaDoAgenteDoContato`, só leitura) — quem precisa do que o agente nativo
 * memorizou sobre a pessoa consegue ler, sem que nada escreva na memória dele
 * por fora do motor.
 *
 * ═══ O que é gravado ═══
 *
 * Uma linha em `crm_lead_activities`, pelo mesmo emissor do resto da timeline
 * (`buildLeadActivityRow` — a regra de ator e lastro continua uma só):
 *
 *  - `reason`: o que a pessoa lê no card — o nome de quem escreveu, o
 *    destinatário quando há, e o texto INTEIRO;
 *  - `payload.texto`: o texto, sem nada na frente — é o que a leitura devolve;
 *  - `payload.autor`: tipo, id e nome de quem escreveu, resolvidos do cadastro
 *    por quem chama (nunca dos argumentos da ferramenta);
 *  - `payload.destinatario`: marcador livre ("financeiro") para um agente
 *    deixar recado a outro. É só um campo gravado e filtrável — o CRM não lhe dá
 *    significado nenhum: não notifica, não roteia, não restringe leitura.
 *
 * Sem coluna nova: `payload` já é `jsonb` com índice GIN, e os filtros de
 * autor e destinatário são de contenção (`@>`), que o índice atende.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/lib/api/handlers/types";
import { buildLeadActivityRow } from "@/lib/leads/activity-emitter";
import { decodeCursor, encodeCursor } from "@/lib/leads/timeline-query";

/** `source_module` das notas gravadas por este módulo. */
export const MODULO_DAS_NOTAS = "notas";

/** Teto do texto de uma nota. Generoso de propósito: a nota NÃO é cortada. */
export const NOTA_MAX = 20_000;

export const DESTINATARIO_MAX = 80;

export interface AutorDaNota {
  tipo: string;
  id: string | null;
  nome: string | null;
}

export interface NotaDoNegocio {
  id: string;
  lead_id: string;
  text: string;
  author: { kind: string; id: string | null; name: string | null };
  /** O destinatário como foi escrito. `null` = nota sem destinatário. */
  recipient: string | null;
  created_at: string;
}

const COLUNAS = "id, lead_id, type, source_module, actor_kind, reason, payload, performed_at";

interface LinhaDaNota {
  id: string;
  lead_id: string;
  actor_kind: string | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  performed_at: string;
}

/** A chave de filtro do destinatário: o mesmo texto, sem caixa nem espaço nas pontas. */
export function chaveDoDestinatario(destinatario: string): string {
  return destinatario.trim().toLowerCase();
}

function paraNota(linha: LinhaDaNota): NotaDoNegocio {
  const payload = linha.payload ?? {};
  const autor = (payload.autor ?? null) as Partial<AutorDaNota> | null;
  const texto = typeof payload.texto === "string" ? payload.texto : (linha.reason ?? "");
  const destinatario = typeof payload.destinatario === "string" ? payload.destinatario : null;
  return {
    id: linha.id,
    lead_id: linha.lead_id,
    text: texto,
    author: {
      // Linha `note` que não nasceu deste módulo (a captação por formulário, por
      // exemplo) não tem autor no payload: sobra o tipo de ator da timeline.
      kind: typeof autor?.tipo === "string" ? autor.tipo : (linha.actor_kind ?? "desconhecido"),
      id: typeof autor?.id === "string" ? autor.id : null,
      name: typeof autor?.nome === "string" ? autor.nome : null,
    },
    recipient: destinatario,
    created_at: linha.performed_at,
  };
}

/** O que a pessoa lê na linha do tempo: quem escreveu, para quem, e o texto inteiro. */
export function linhaLegivelDaNota(autorNome: string, destinatario: string | null, texto: string): string {
  return destinatario ? `${autorNome} → ${destinatario}: ${texto}` : `${autorNome}: ${texto}`;
}

export type DesfechoDaNota =
  | { ok: true; nota: NotaDoNegocio; repetida: boolean }
  | { ok: false; erro: string };

/**
 * Grava a nota. Quem chama já conferiu o negócio (organização de fonte
 * confiável) e resolveu o autor do cadastro.
 *
 * `chaveDeIdempotencia`: a mesma chave no mesmo negócio devolve a nota já
 * gravada em vez de gravar outra — o agente externo que repete a chamada depois
 * de um timeout não duplica o recado.
 *
 * Quem garante é o BANCO, não a leitura abaixo: o índice único
 * `uq_crm_lead_activities_nota_idempotencia` (migration 9818) recusa a segunda
 * linha com a mesma chave no mesmo negócio. A leitura é só o atalho do caso
 * comum; duas chamadas simultâneas passam as duas por ela, e a que perde a
 * corrida recebe `23505` e devolve a nota que a outra gravou (revisão de 20/11,
 * item 2.13).
 */
export async function registrarNotaDoNegocio(entrada: {
  supabase: SupabaseClient;
  organizationId: string;
  lead: { id: string; contact_id: string | null };
  texto: string;
  destinatario?: string | null;
  autor: { tipo: string; id: string; nome: string };
  ator: Actor;
  chaveDeIdempotencia?: string | null;
}): Promise<DesfechoDaNota> {
  const { supabase, organizationId, lead, texto, autor } = entrada;
  const destinatario = entrada.destinatario?.trim() || null;
  const chave = entrada.chaveDeIdempotencia ?? null;

  const jaGravada = async (chaveDaNota: string) =>
    supabase
      .from("crm_lead_activities")
      .select(COLUNAS)
      .eq("organization_id", organizationId)
      .eq("lead_id", lead.id)
      .eq("type", "note")
      .eq("source_module", MODULO_DAS_NOTAS)
      .contains("payload", { idempotency_key: chaveDaNota })
      .limit(1)
      .maybeSingle();

  if (chave) {
    const { data: anterior, error } = await jaGravada(chave);
    if (error) return { ok: false, erro: error.message };
    if (anterior) return { ok: true, nota: paraNota(anterior as LinhaDaNota), repetida: true };
  }

  const linha = buildLeadActivityRow({
    organizationId,
    leadId: lead.id,
    contactId: lead.contact_id,
    type: "note",
    sourceModule: MODULO_DAS_NOTAS,
    actor: entrada.ator,
    reason: linhaLegivelDaNota(autor.nome, destinatario, texto),
    payload: {
      texto,
      autor,
      ...(destinatario
        ? { destinatario, destinatario_chave: chaveDoDestinatario(destinatario) }
        : {}),
      ...(chave ? { idempotency_key: chave } : {}),
    },
  });

  const { data, error } = await supabase
    .from("crm_lead_activities")
    .insert(linha)
    .select(COLUNAS)
    .single();
  if (error && (error as { code?: string }).code === "23505" && chave) {
    // Perdeu a corrida para outra chamada com a mesma chave: a nota existe.
    const { data: vencedora, error: erroDaLeitura } = await jaGravada(chave);
    if (erroDaLeitura || !vencedora) {
      return { ok: false, erro: erroDaLeitura?.message ?? error.message };
    }
    return { ok: true, nota: paraNota(vencedora as LinhaDaNota), repetida: true };
  }
  if (error || !data) return { ok: false, erro: error?.message ?? "a nota não foi gravada" };

  return { ok: true, nota: paraNota(data as LinhaDaNota), repetida: false };
}

export interface FiltrosDasNotas {
  /** ISO-8601: só as notas a partir deste instante. */
  desde?: string;
  /** Id (do agente ou do token) ou nome exato de quem escreveu. */
  autor?: string;
  destinatario?: string;
  limite: number;
  cursor?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ListaDeNotas =
  | { ok: true; notas: NotaDoNegocio[]; cursor: string | null; has_more: boolean }
  | { ok: false; recusa: "cursor_invalido" }
  | { ok: false; recusa: "falha"; erro: string };

/**
 * As notas de UM negócio, em ordem cronológica (a mais antiga primeiro).
 *
 * Só o que tem `lead_id` igual: a nota do negócio irmão do mesmo contato não
 * entra — é a diferença para a ficha do agente, que é por contato.
 */
export async function listarNotasDoNegocio(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
  filtros: FiltrosDasNotas,
): Promise<ListaDeNotas> {
  const cursor = filtros.cursor ? decodeCursor(filtros.cursor) : null;
  if (filtros.cursor && !cursor) return { ok: false, recusa: "cursor_invalido" };

  let q = supabase
    .from("crm_lead_activities")
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .eq("type", "note");

  if (filtros.desde) q = q.gte("performed_at", filtros.desde);
  if (filtros.autor) {
    const autor = filtros.autor.trim();
    q = q.contains("payload", { autor: UUID.test(autor) ? { id: autor } : { nome: autor } });
  }
  if (filtros.destinatario) {
    q = q.contains("payload", { destinatario_chave: chaveDoDestinatario(filtros.destinatario) });
  }
  if (cursor) {
    q = q.or(
      `performed_at.gt.${cursor.performed_at},and(performed_at.eq.${cursor.performed_at},id.gt.${cursor.id})`,
    );
  }

  const { data, error } = await q
    .order("performed_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(filtros.limite + 1);
  if (error) return { ok: false, recusa: "falha", erro: error.message };

  const linhas = (data ?? []) as LinhaDaNota[];
  const temMais = linhas.length > filtros.limite;
  const pagina = temMais ? linhas.slice(0, filtros.limite) : linhas;
  const ultima = pagina[pagina.length - 1];

  return {
    ok: true,
    notas: pagina.map(paraNota),
    has_more: temMais,
    cursor: temMais && ultima ? encodeCursor({ performed_at: ultima.performed_at, id: ultima.id }) : null,
  };
}

/** Uma nota da FICHA do agente nativo — a memória dele sobre o contato. */
export interface NotaDaFichaDoAgente {
  id: string;
  headline: string;
  body: string;
  created_at: string;
}

/**
 * A ficha que o agente nativo mantém sobre o CONTATO (`lead_notes`). Só leitura.
 *
 * Por contato, não por negócio: todos os negócios da mesma pessoa compartilham
 * esta ficha. Quem escreve nela é só o motor (`save_lead_note`), que controla o
 * orçamento do índice — por isso não existe escrita por aqui.
 */
export async function fichaDoAgenteDoContato(
  supabase: SupabaseClient,
  organizationId: string,
  contactId: string,
): Promise<{ ok: true; notas: NotaDaFichaDoAgente[] } | { ok: false; erro: string }> {
  const { data, error } = await supabase
    .from("lead_notes")
    .select("id, headline, body, created_at")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(200);
  if (error) return { ok: false, erro: error.message };
  return { ok: true, notas: (data ?? []) as NotaDaFichaDoAgente[] };
}
