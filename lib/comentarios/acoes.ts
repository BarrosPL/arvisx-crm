/**
 * Comentários de rede social — ler, responder, ocultar, ignorar e virar contato.
 *
 * A regra mora AQUI, uma vez. As rotas `/api/v1/social-comments/...` e as
 * ferramentas `crm_*_comment` do MCP só autenticam, validam a entrada e chamam
 * estas funções — nenhuma das duas decide nada sozinha. A organização vem
 * sempre de quem chamou (sessão ou linha do token), nunca do corpo, e toda
 * consulta filtra por ela: o cliente usado aqui ignora a RLS.
 *
 * ─── O modo do canal decide se algo sai ─────────────────────────────────────
 *
 *   off        nada é respondido: 409 `comentarios_desligados`;
 *   registrar  tudo é validado e GRAVADO como simulado, sem chamar a rede;
 *   real       a resposta é publicada.
 *
 * ─── Uma resposta por comentário, e nunca duas por acidente ─────────────────
 *
 * Antes de chamar a rede, o servidor RESERVA o comentário: grava a resposta
 * com `situacao: "enviando"` por um UPDATE condicional (só casa se a coluna
 * ainda está vazia). Duas chamadas simultâneas não passam as duas — a segunda
 * não casa linha nenhuma e recebe 409. Depois da chamada:
 *
 *   a rede confirmou   → `situacao: "concluida"`, estado `respondido`;
 *   a rede recusou     → a reserva é DESFEITA. Erro da rede nunca deixa o
 *                        comentário como respondido;
 *   não deu para saber → `situacao: "incerta"`. A resposta pode ter saído, então
 *                        o servidor não repete: a próxima chamada recebe 409
 *                        `resposta_incerta`, e só `confirmar_reenvio: true` —
 *                        decisão de quem chama — manda de novo.
 *
 * ─── Sem regra de conteúdo ──────────────────────────────────────────────────
 *
 * O CRM exige texto não vazio e os limites da própria rede (uma resposta, 7
 * dias, transmissão ao vivo). O que dizer é política de quem responde.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createLeadHandler } from "@/app/api/v1/leads/_handler";
import type { Actor } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit/actions";
import { cardAbertoQueACaptacaoReusa } from "@/lib/automation/captacao-reusa-card-aberto";
import {
  lerModoDeComentarios,
  type EstadoDoComentario,
  type ModoDeComentarios,
} from "@/lib/channels/meta-social/comentarios";
import {
  enviarRespostaPrivada,
  gravarRespostaPrivadaNaConversa,
  identidadeCandidataDoAutor,
  ocultarNaRede,
  publicarRespostaPublica,
  type FalhaDoEnvio,
} from "@/lib/channels/meta-social/comentarios-resposta";
import { sessaoPorId, type SessaoDireta } from "@/lib/channels/meta-social/store";
import { logger } from "@/lib/logger";

import {
  LIMITE_PADRAO_DA_LISTA,
  codificarCursor,
  decodificarCursor,
  lerOcultacao,
  lerRespostaPrivada,
  lerRespostaPublica,
  type AutorDaAcao,
  type Comentario,
  type FiltrosDaLista,
  type Ocultacao,
  type RespostaPrivada,
  type RespostaPublica,
} from "./schemas";

/** Quem está agindo — resolvido pela rota ou pelo servidor MCP, nunca pelo corpo. */
export interface QuemAge {
  actor: Actor;
  apiTokenId?: string | null;
  requestId: string;
  /** Por onde a chamada entrou. Vai para a auditoria. */
  via: "api" | "mcp";
}

/** O prazo da resposta privada: 7 dias a partir do comentário (regra da rede). */
export const JANELA_DA_RESPOSTA_PRIVADA_MS = 7 * 24 * 60 * 60 * 1000;

/** Reserva `enviando` mais velha que isto é de um processo que morreu no meio. */
export const RESERVA_ABANDONADA_MS = 2 * 60 * 1000;

const COLUNAS =
  "id, organization_id, channel_session_id, comment_id, parent_comment_id, media_id, media_product_type, ad_id, ad_title, ao_vivo, author_id, author_username, text, commented_at, estado, public_reply, private_reply, hidden, ignore_reason, contact_id, created_at, updated_at";

interface Linha {
  id: string;
  organization_id: string;
  channel_session_id: string;
  comment_id: string;
  parent_comment_id: string | null;
  media_id: string | null;
  media_product_type: string | null;
  ad_id: string | null;
  ad_title: string | null;
  ao_vivo: boolean;
  author_id: string | null;
  author_username: string | null;
  text: string | null;
  commented_at: string;
  estado: EstadoDoComentario;
  public_reply: unknown;
  private_reply: unknown;
  hidden: unknown;
  ignore_reason: string | null;
  contact_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * O comentário como a API e o MCP o devolvem. A forma mora em `./schemas`, o
 * módulo que a tela já importa: pegá-la DESTE arquivo punha as ações de
 * servidor inteiras (845 arquivos) no grafo de imports da tela, por um tipo.
 * Sai daqui também para quem já a pegava deste arquivo.
 */
export type { Comentario };

function apresentar(l: Linha): Comentario {
  return {
    id: l.id,
    comment_id: l.comment_id,
    channel_session_id: l.channel_session_id,
    parent_comment_id: l.parent_comment_id,
    media_id: l.media_id,
    media_product_type: l.media_product_type,
    ad_id: l.ad_id,
    ad_title: l.ad_title,
    ao_vivo: l.ao_vivo,
    author: { id: l.author_id, username: l.author_username },
    text: l.text,
    commented_at: l.commented_at,
    private_reply_deadline: new Date(Date.parse(l.commented_at) + JANELA_DA_RESPOSTA_PRIVADA_MS).toISOString(),
    estado: l.estado,
    public_reply: lerRespostaPublica(l.public_reply),
    private_reply: lerRespostaPrivada(l.private_reply),
    hidden: lerOcultacao(l.hidden),
    ignore_reason: l.ignore_reason,
    contact_id: l.contact_id,
    created_at: l.created_at,
    updated_at: l.updated_at,
  };
}

function recusa(
  quem: Pick<QuemAge, "requestId">,
  status: number,
  codigo: string,
  mensagem: string,
  detalhes?: Record<string, unknown>,
): ApiError {
  return new ApiError(status, codigo, detalhes, quem.requestId, mensagem);
}

function autorDe(quem: QuemAge): AutorDaAcao {
  return {
    tipo: quem.actor.type,
    id: quem.actor.id,
    ...(quem.apiTokenId ? { api_token_id: quem.apiTokenId } : {}),
  };
}

async function auditar(
  quem: QuemAge,
  org: string,
  acao: AuditAction,
  linha: Pick<Linha, "id" | "comment_id" | "channel_session_id">,
  metadata: Record<string, unknown>,
): Promise<void> {
  await audit({
    action: acao,
    actorUserId: quem.actor.type === "user" ? quem.actor.id : null,
    actorApiTokenId: quem.apiTokenId ?? null,
    organizationId: org,
    resourceType: "social_comment",
    resourceId: linha.id,
    requestId: quem.requestId,
    bypassedRls: true,
    metadata: {
      via: quem.via,
      actor_type: quem.actor.type,
      ...(quem.actor.type === "ai_agent" && quem.actor.agent_id ? { agent_id: quem.actor.agent_id } : {}),
      comment_id: linha.comment_id,
      channel_session_id: linha.channel_session_id,
      ...metadata,
    },
  });
}

// ─── leitura ────────────────────────────────────────────────────────────────

export interface PaginaDeComentarios {
  comentarios: Comentario[];
  cursor: string | null;
  tem_mais: boolean;
}

/** Lista os comentários da organização, do mais recente para o mais antigo. */
export async function listarComentarios(
  db: SupabaseClient,
  org: string,
  filtros: FiltrosDaLista,
  quem: Pick<QuemAge, "requestId">,
): Promise<PaginaDeComentarios> {
  const limite = filtros.limite ?? LIMITE_PADRAO_DA_LISTA;
  let q = db.from("social_comments").select(COLUNAS).eq("organization_id", org);
  if (filtros.canal) q = q.eq("channel_session_id", filtros.canal);
  if (filtros.estado) q = q.eq("estado", filtros.estado);
  if (filtros.midia) q = q.eq("media_id", filtros.midia);
  if (filtros.desde) q = q.gte("commented_at", new Date(filtros.desde).toISOString());
  if (filtros.cursor) {
    const c = decodificarCursor(filtros.cursor);
    if (!c) throw recusa(quem, 400, "invalid_cursor", "Cursor inválido.");
    // Os dois valores passaram por schema (data ISO e UUID) antes de entrar no
    // filtro: nada do que o cliente mandou chega cru a esta expressão.
    const quando = new Date(c.quando).toISOString();
    q = q.or(`commented_at.lt.${quando},and(commented_at.eq.${quando},id.lt.${c.id})`);
  }
  const { data, error } = await q
    .order("commented_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limite + 1);
  if (error) throw recusa(quem, 500, "internal_error", "Não foi possível ler os comentários.");
  const linhas = (data ?? []) as unknown as Linha[];
  const pagina = linhas.slice(0, limite);
  const ultima = pagina[pagina.length - 1];
  const temMais = linhas.length > limite;
  return {
    comentarios: pagina.map(apresentar),
    cursor: temMais && ultima ? codificarCursor({ quando: new Date(ultima.commented_at).toISOString(), id: ultima.id }) : null,
    tem_mais: temMais,
  };
}

async function carregar(db: SupabaseClient, org: string, id: string, quem: Pick<QuemAge, "requestId">): Promise<Linha> {
  const { data, error } = await db
    .from("social_comments")
    .select(COLUNAS)
    .eq("organization_id", org)
    .eq("id", id)
    .maybeSingle();
  if (error) throw recusa(quem, 500, "internal_error", "Não foi possível ler o comentário.");
  // Comentário de outra organização e comentário que não existe recebem a
  // MESMA resposta: o id não vira oráculo de existência.
  if (!data) throw recusa(quem, 404, "not_found", "Comentário não encontrado.");
  return data as unknown as Linha;
}

/** UM comentário da organização. 404 quando não existe (ou é de outra organização). */
export async function lerComentario(
  db: SupabaseClient,
  org: string,
  id: string,
  quem: Pick<QuemAge, "requestId">,
): Promise<Comentario> {
  return apresentar(await carregar(db, org, id, quem));
}

// ─── o que as respostas têm em comum ────────────────────────────────────────

async function canalAtivo(
  db: SupabaseClient,
  linha: Linha,
  quem: QuemAge,
): Promise<{ sessao: SessaoDireta; modo: Exclude<ModoDeComentarios, "off"> }> {
  const sessao = await sessaoPorId(db, linha.organization_id, linha.channel_session_id);
  if (!sessao || sessao.rede !== "instagram") {
    throw recusa(
      quem,
      409,
      "canal_indisponivel",
      "A conexão que recebeu este comentário foi desconectada. Conecte a conta de novo para responder.",
    );
  }
  const modo = lerModoDeComentarios(sessao.metadata);
  if (modo === "off") {
    throw recusa(
      quem,
      409,
      "comentarios_desligados",
      "Os comentários desta conexão estão desligados. Ligue em modo de registro ou real para responder.",
    );
  }
  return { sessao, modo };
}

type Coluna = "public_reply" | "private_reply";

/**
 * Confere a resposta que já está na coluna. Devolve o que o UPDATE condicional
 * tem de casar: a coluna vazia (`null`) ou a linha exatamente como foi lida
 * (`updated_at`), quando quem chama decidiu repetir uma resposta incerta.
 */
function conferirRespostaExistente(
  quem: QuemAge,
  cru: unknown,
  lida: RespostaPublica | RespostaPrivada | null,
  confirmarReenvio: boolean,
  codigoJaRespondido: string,
): "vazia" | "repetir" {
  if (cru === null || cru === undefined) return "vazia";
  if (!lida || lida.situacao === "concluida") {
    throw recusa(quem, 409, codigoJaRespondido, "Este comentário já foi respondido.", { resposta: lida ?? cru });
  }
  const abandonada = Date.now() - Date.parse(lida.quando) > RESERVA_ABANDONADA_MS;
  if (lida.situacao === "enviando" && !abandonada) {
    throw recusa(quem, 409, "resposta_em_andamento", "Outra resposta a este comentário está sendo enviada agora.");
  }
  if (!confirmarReenvio) {
    throw recusa(
      quem,
      409,
      "resposta_incerta",
      "A tentativa anterior não foi confirmada pela rede e pode ter sido publicada. Confira na rede; para enviar de novo assim mesmo, repita com confirmar_reenvio.",
      { resposta: lida },
    );
  }
  return "repetir";
}

/** O UPDATE condicional. `false` = outra chamada chegou antes. */
async function reservar(
  db: SupabaseClient,
  linha: Linha,
  campos: Record<string, unknown>,
  coluna: Coluna | "hidden",
  condicao: "vazia" | "repetir",
): Promise<boolean> {
  let q = db.from("social_comments").update(campos).eq("organization_id", linha.organization_id).eq("id", linha.id);
  q = condicao === "vazia" ? q.is(coluna, null) : q.eq("updated_at", linha.updated_at);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`social_comments: ${error.message}`);
  return ((data as { id: string }[] | null) ?? []).length > 0;
}

async function gravar(db: SupabaseClient, linha: Linha, campos: Record<string, unknown>): Promise<void> {
  const { error } = await db
    .from("social_comments")
    .update(campos)
    .eq("organization_id", linha.organization_id)
    .eq("id", linha.id);
  if (error) throw new Error(`social_comments: ${error.message}`);
}

/** A recusa da rede vira a recusa da API — com a frase que a rede justificou. */
function recusaDaRede(quem: QuemAge, falha: Exclude<FalhaDoEnvio, { tipo: "incerta" }>): ApiError {
  if (falha.tipo === "limite") return recusa(quem, 429, "rate_limited", falha.frase, { origem: "rede" });
  if (falha.tipo === "sem_credencial") return recusa(quem, 409, "canal_indisponivel", falha.frase);
  if (falha.escopoAusente) return recusa(quem, 422, "escopo_ausente", falha.frase);
  return recusa(quem, 502, "upstream_unavailable", falha.frase, { origem: "rede" });
}

/** A única regra de conteúdo do CRM: o texto não pode ser vazio. */
function textoNaoVazio(quem: QuemAge, texto: string): void {
  if (!texto.trim()) throw recusa(quem, 422, "validation_error", "O texto da resposta não pode ser vazio.");
}

function simuladaOuConcluida(base: { texto: string; quando: string; quem: AutorDaAcao }, simulada: boolean, id: string | null) {
  return { ...base, id, simulada, situacao: "concluida" as const };
}

// ─── responder em público ───────────────────────────────────────────────────

export interface ResultadoDaResposta {
  comment: Comentario;
  simulada: boolean;
}

/**
 * Responde ao comentário EM PÚBLICO. Uma por comentário: a segunda chamada
 * recebe 409 `ja_respondido` com a resposta que já existe.
 */
export async function responderEmPublico(
  db: SupabaseClient,
  org: string,
  id: string,
  entrada: { text: string; confirmar_reenvio?: boolean },
  quem: QuemAge,
): Promise<ResultadoDaResposta> {
  textoNaoVazio(quem, entrada.text);
  const linha = await carregar(db, org, id, quem);
  const condicao = conferirRespostaExistente(
    quem,
    linha.public_reply,
    lerRespostaPublica(linha.public_reply),
    entrada.confirmar_reenvio === true,
    "ja_respondido",
  );
  const { sessao, modo } = await canalAtivo(db, linha, quem);
  if (linha.ao_vivo) {
    throw recusa(
      quem,
      422,
      "comentario_ao_vivo",
      "A rede não aceita resposta pública a comentário de transmissão ao vivo. Responda em privado, durante a transmissão.",
    );
  }
  const oculto = lerOcultacao(linha.hidden);
  if (oculto && !oculto.simulada) {
    throw recusa(quem, 422, "comentario_oculto", "A rede não aceita resposta pública a comentário oculto.");
  }

  const base = { texto: entrada.text, quando: new Date().toISOString(), quem: autorDe(quem) };
  const simulada = modo === "registrar";
  const semConcorrente = (ok: boolean) => {
    if (!ok) throw recusa(quem, 409, "ja_respondido", "Este comentário já foi respondido.");
  };

  if (simulada) {
    const resposta = simuladaOuConcluida(base, true, null);
    semConcorrente(await reservar(db, linha, { public_reply: resposta, estado: "respondido" }, "public_reply", condicao));
    await auditar(quem, org, "social_comment.respondido", linha, { simulada: true });
    return { comment: apresentar(await carregar(db, org, id, quem)), simulada: true };
  }

  const reserva: RespostaPublica = { ...base, id: null, simulada: false, situacao: "enviando" };
  semConcorrente(await reservar(db, linha, { public_reply: reserva }, "public_reply", condicao));

  const r = await publicarRespostaPublica(db, sessao, linha.comment_id, entrada.text);
  if (!r.ok) {
    if (r.falha.tipo === "incerta") {
      await gravar(db, linha, { public_reply: { ...reserva, situacao: "incerta" } });
      throw recusa(quem, 502, "resposta_incerta", r.falha.frase);
    }
    // A rede disse "não": a reserva sai, e o comentário volta a como estava.
    await gravar(db, linha, { public_reply: null });
    throw recusaDaRede(quem, r.falha);
  }

  await gravarDepoisDeSair(db, linha, { public_reply: simuladaOuConcluida(base, false, r.id), estado: "respondido" });
  await auditar(quem, org, "social_comment.respondido", linha, { simulada: false, reply_id: r.id });
  return { comment: apresentar(await carregar(db, org, id, quem)), simulada: false };
}

/**
 * Grava o desfecho de algo que JÁ SAIU. Se o banco falhar aqui, a reserva
 * `enviando` fica — e passa a valer como incerta, que é a verdade: saiu e o
 * registro não fechou. Nunca vira uma segunda publicação.
 */
async function gravarDepoisDeSair(db: SupabaseClient, linha: Linha, campos: Record<string, unknown>): Promise<void> {
  try {
    await gravar(db, linha, campos);
  } catch (primeira) {
    try {
      await gravar(db, linha, campos);
    } catch {
      logger.error("[comentarios] a resposta saiu, mas o registro não foi gravado", {
        organization_id: linha.organization_id,
        social_comment_id: linha.id,
        erro: primeira instanceof Error ? primeira.message : String(primeira),
      });
    }
  }
}

// ─── responder em privado ───────────────────────────────────────────────────

interface FichaDoContato {
  id: string;
  is_blocked: boolean;
  is_personal: boolean;
  is_anonymized: boolean;
}

/** O contato vivo por trás de um id (segue UMA fusão). `null` = não existe mais. */
async function contatoVivo(db: SupabaseClient, org: string, id: string): Promise<FichaDoContato | null> {
  const ler = async (alvo: string) => {
    const { data, error } = await db
      .from("contacts")
      .select("id, is_blocked, is_personal, is_anonymized, is_merged_into")
      .eq("organization_id", org)
      .eq("id", alvo)
      .maybeSingle();
    if (error) throw new Error(`contacts: ${error.message}`);
    return data as (FichaDoContato & { is_merged_into: string | null }) | null;
  };
  const ficha = await ler(id);
  if (!ficha) return null;
  return ficha.is_merged_into ? ler(ficha.is_merged_into) : ficha;
}

/**
 * Quem comentou pediu para não ser procurado? Olha o contato ligado ao
 * comentário e, por prudência, o contato que tem a identidade que o autor
 * TERIA nas mensagens diretas. Usar essa identidade só para RECUSAR é seguro:
 * no pior caso deixa de mandar uma mensagem, nunca manda a quem não devia.
 */
async function conferirQueNaoEstaBloqueado(
  db: SupabaseClient,
  linha: Linha,
  sessao: SessaoDireta,
  quem: QuemAge,
): Promise<void> {
  const fichas: FichaDoContato[] = [];
  if (linha.contact_id) {
    const f = await contatoVivo(db, linha.organization_id, linha.contact_id);
    if (f) fichas.push(f);
  }
  if (linha.author_id) {
    const { data, error } = await db
      .from("contacts")
      .select("id, is_blocked, is_personal, is_anonymized")
      .eq("organization_id", linha.organization_id)
      .eq("social_identity", identidadeCandidataDoAutor(sessao, linha.author_id))
      .is("is_merged_into", null)
      .maybeSingle();
    if (error) throw new Error(`contacts: ${error.message}`);
    if (data) fichas.push(data as FichaDoContato);
  }
  if (fichas.some((f) => f.is_blocked || f.is_personal)) {
    throw recusa(
      quem,
      422,
      "contato_bloqueado",
      "Esta pessoa pediu para não receber mensagens (ou foi marcada como contato pessoal). Nada foi enviado.",
    );
  }
}

export interface ResultadoDaRespostaPrivada extends ResultadoDaResposta {
  /** O contato onde a resposta ficou gravada. `null` = não foi gravada em conversa. */
  contact_id: string | null;
  conversation_id: string | null;
  /** Por que não há conversa, quando não há. */
  sem_conversa: "simulada" | "sem_contato" | "identidade_nao_confirmada" | "falha_ao_gravar" | null;
}

/**
 * Responde ao comentário EM PRIVADO (mensagem direta a quem comentou).
 *
 * Uma por comentário, dentro de 7 dias do comentário — os dois limites são da
 * rede. A resposta enviada é gravada na conversa do contato, para a
 * continuação cair no fluxo normal de mensagens; sem contato, só é gravada
 * quando `criar_contato`.
 */
export async function responderEmPrivado(
  db: SupabaseClient,
  org: string,
  id: string,
  entrada: { text: string; criar_contato?: boolean; confirmar_reenvio?: boolean },
  quem: QuemAge,
): Promise<ResultadoDaRespostaPrivada> {
  textoNaoVazio(quem, entrada.text);
  const linha = await carregar(db, org, id, quem);
  const condicao = conferirRespostaExistente(
    quem,
    linha.private_reply,
    lerRespostaPrivada(linha.private_reply),
    entrada.confirmar_reenvio === true,
    "ja_respondido_em_privado",
  );
  if (Date.now() - Date.parse(linha.commented_at) > JANELA_DA_RESPOSTA_PRIVADA_MS) {
    throw recusa(
      quem,
      422,
      "janela_de_7_dias",
      "A rede só aceita resposta privada até 7 dias depois do comentário, e este prazo já passou.",
      { commented_at: linha.commented_at },
    );
  }
  const { sessao, modo } = await canalAtivo(db, linha, quem);
  await conferirQueNaoEstaBloqueado(db, linha, sessao, quem);

  const base = { texto: entrada.text, quando: new Date().toISOString(), quem: autorDe(quem) };
  const simulada = modo === "registrar";
  const semConcorrente = (ok: boolean) => {
    if (!ok) throw recusa(quem, 409, "ja_respondido_em_privado", "Este comentário já foi respondido em privado.");
  };

  if (simulada) {
    // Em modo de registro NADA sai — e por isso nada entra na caixa de
    // entrada: gravar ali uma mensagem que ninguém recebeu seria mentir para
    // quem atende. O contato também não nasce: a prova da identidade é a
    // resposta da rede, e a rede não foi chamada.
    const resposta: RespostaPrivada = { ...simuladaOuConcluida(base, true, null), message_id: null, conversation_id: null };
    semConcorrente(
      await reservar(db, linha, { private_reply: resposta, estado: "respondido" }, "private_reply", condicao),
    );
    await auditar(quem, org, "social_comment.respondido_em_privado", linha, {
      simulada: true,
      criar_contato: entrada.criar_contato === true,
    });
    return {
      comment: apresentar(await carregar(db, org, id, quem)),
      simulada: true,
      contact_id: linha.contact_id,
      conversation_id: null,
      sem_conversa: "simulada",
    };
  }

  const reserva: RespostaPrivada = {
    ...base,
    id: null,
    simulada: false,
    situacao: "enviando",
    message_id: null,
    conversation_id: null,
  };
  semConcorrente(await reservar(db, linha, { private_reply: reserva }, "private_reply", condicao));

  const r = await enviarRespostaPrivada(db, sessao, linha.comment_id, entrada.text);
  if (!r.ok) {
    if (r.falha.tipo === "incerta") {
      await gravar(db, linha, { private_reply: { ...reserva, situacao: "incerta" } });
      throw recusa(quem, 502, "resposta_incerta", r.falha.frase);
    }
    await gravar(db, linha, { private_reply: null });
    throw recusaDaRede(quem, r.falha);
  }

  // A mensagem JÁ SAIU. Daqui em diante nada pode virar erro para quem chamou:
  // um erro o faria tentar de novo, e a rede só aceita uma.
  let conversa: Awaited<ReturnType<typeof gravarRespostaPrivadaNaConversa>> = null;
  let semConversa: ResultadoDaRespostaPrivada["sem_conversa"] = null;
  if (!r.recipientId) {
    semConversa = "identidade_nao_confirmada";
  } else {
    try {
      const contatoDoComentario = linha.contact_id
        ? ((await contatoVivo(db, org, linha.contact_id))?.id ?? null)
        : null;
      conversa = await gravarRespostaPrivadaNaConversa(db, sessao, {
        recipientId: r.recipientId,
        messageId: r.messageId,
        texto: entrada.text,
        quando: base.quando,
        usuario: linha.author_username,
        contatoDoComentario,
        criarContato: entrada.criar_contato === true,
        origem: { social_comment_id: linha.id, comment_id: linha.comment_id },
      });
      if (!conversa) semConversa = "sem_contato";
    } catch (erro) {
      semConversa = "falha_ao_gravar";
      logger.error("[comentarios] a resposta privada saiu, mas a conversa não foi gravada", {
        organization_id: org,
        social_comment_id: linha.id,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }

  const final: RespostaPrivada = {
    ...simuladaOuConcluida(base, false, r.messageId),
    message_id: conversa?.messageId ?? null,
    conversation_id: conversa?.conversationId ?? null,
  };
  await gravarDepoisDeSair(db, linha, {
    private_reply: final,
    estado: "respondido",
    ...(conversa ? { contact_id: conversa.contactId } : {}),
  });
  await auditar(quem, org, "social_comment.respondido_em_privado", linha, {
    simulada: false,
    message_id: r.messageId,
    contact_id: conversa?.contactId ?? null,
    conversation_id: conversa?.conversationId ?? null,
    sem_conversa: semConversa,
  });
  return {
    comment: apresentar(await carregar(db, org, id, quem)),
    simulada: false,
    contact_id: conversa?.contactId ?? linha.contact_id,
    conversation_id: conversa?.conversationId ?? null,
    sem_conversa: semConversa,
  };
}

// ─── ocultar ────────────────────────────────────────────────────────────────

/** Oculta o comentário na rede. Ocultar de novo devolve o que já está gravado. */
export async function ocultarComentario(
  db: SupabaseClient,
  org: string,
  id: string,
  quem: QuemAge,
): Promise<ResultadoDaResposta & { ja_estava_oculto: boolean }> {
  const linha = await carregar(db, org, id, quem);
  const existente = lerOcultacao(linha.hidden);
  if (existente) return { comment: apresentar(linha), simulada: existente.simulada, ja_estava_oculto: true };
  const { sessao, modo } = await canalAtivo(db, linha, quem);
  if (linha.ao_vivo) {
    throw recusa(quem, 422, "comentario_ao_vivo", "A rede não oculta comentário de transmissão ao vivo.");
  }
  const simulada = modo === "registrar";
  if (!simulada) {
    // Ocultar é idempotente na rede: não há reserva, e repetir não duplica nada.
    const r = await ocultarNaRede(db, sessao, linha.comment_id);
    if (!r.ok) {
      if (r.falha.tipo === "incerta") throw recusa(quem, 502, "upstream_unavailable", r.falha.frase, { origem: "rede" });
      throw recusaDaRede(quem, r.falha);
    }
  }
  const ocultacao: Ocultacao = { quando: new Date().toISOString(), quem: autorDe(quem), simulada };
  await gravar(db, linha, { hidden: ocultacao });
  await auditar(quem, org, "social_comment.ocultado", linha, { simulada });
  return { comment: apresentar(await carregar(db, org, id, quem)), simulada, ja_estava_oculto: false };
}

// ─── ignorar ────────────────────────────────────────────────────────────────

/**
 * Marca o comentário como sem ação, com o motivo. Não fala com a rede, então
 * vale em qualquer modo do canal. Comentário já respondido não é ignorado.
 */
export async function ignorarComentario(
  db: SupabaseClient,
  org: string,
  id: string,
  entrada: { motivo?: string },
  quem: QuemAge,
): Promise<{ comment: Comentario }> {
  const linha = await carregar(db, org, id, quem);
  if (linha.estado === "respondido") {
    throw recusa(quem, 409, "ja_respondido", "Este comentário já foi respondido e não pode ser marcado como sem ação.");
  }
  const motivo = entrada.motivo?.trim() || null;
  if (linha.estado === "sem_acao" && (motivo === null || motivo === linha.ignore_reason)) {
    return { comment: apresentar(linha) };
  }
  await gravar(db, linha, { estado: "sem_acao", ignore_reason: motivo ?? linha.ignore_reason });
  await auditar(quem, org, "social_comment.ignorado", linha, { motivo });
  return { comment: apresentar(await carregar(db, org, id, quem)) };
}

// ─── criar contato (e negócio) ──────────────────────────────────────────────

export interface ResultadoDoContato {
  comment: Comentario;
  contact_id: string;
  contato_ja_existia: boolean;
  /** O negócio, quando um funil foi informado. */
  lead: { id: string; ja_existia: boolean } | null;
}

/**
 * Cria o contato de quem comentou e, quando um funil é informado, o negócio.
 *
 * O contato nasce SEM identidade social: o id do autor no comentário não é
 * prova do id dele nas mensagens diretas. Ele ganha a identidade quando uma
 * resposta privada a este comentário for confirmada pela rede. Chamar de novo
 * devolve o mesmo contato; comentários do mesmo autor reaproveitam o contato.
 *
 * O negócio reaproveita o card ABERTO do contato naquele funil, pela mesma
 * regra da captação — um comentário a mais não abre um segundo card.
 */
export async function criarContatoDoComentario(
  db: SupabaseClient,
  org: string,
  id: string,
  entrada: { pipeline_id?: string; stage_id?: string; title?: string },
  quem: QuemAge,
): Promise<ResultadoDoContato> {
  const linha = await carregar(db, org, id, quem);

  let contato: FichaDoContato | null = linha.contact_id ? await contatoVivo(db, org, linha.contact_id) : null;
  if (!contato && linha.author_id) {
    // Outro comentário do MESMO autor (mesmo espaço de ids) já virou contato.
    const { data, error } = await db
      .from("social_comments")
      .select("contact_id")
      .eq("organization_id", org)
      .eq("channel_session_id", linha.channel_session_id)
      .eq("author_id", linha.author_id)
      .not("contact_id", "is", null)
      .order("commented_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(`social_comments: ${error.message}`);
    const irmao = ((data as { contact_id: string | null }[] | null) ?? [])[0]?.contact_id;
    if (irmao) contato = await contatoVivo(db, org, irmao);
  }
  if (contato?.is_anonymized) {
    throw recusa(
      quem,
      409,
      "contato_anonimizado",
      "O contato desta pessoa foi anonimizado a pedido dela. Não é possível criar outro a partir deste comentário.",
    );
  }

  const jaExistia = contato !== null;
  let contactId = contato?.id ?? null;
  if (!contactId) {
    const nome = linha.author_username ? `@${linha.author_username}` : null;
    const { data, error } = await db
      .from("contacts")
      .insert({
        organization_id: org,
        name: nome,
        display_name: nome,
        source: "social",
        source_metadata: {
          origem: "comentario_de_rede_social",
          social_comment_id: linha.id,
          comment_id: linha.comment_id,
          channel_session_id: linha.channel_session_id,
          author_username: linha.author_username,
        },
        ...(quem.actor.type === "user" ? { created_by_user_id: quem.actor.id } : {}),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`contacts: ${error?.message ?? "a linha não voltou"}`);
    contactId = (data as { id: string }).id;
  }
  if (linha.contact_id !== contactId) await gravar(db, linha, { contact_id: contactId });

  let lead: ResultadoDoContato["lead"] = null;
  if (entrada.pipeline_id) {
    const aberto = await cardAbertoQueACaptacaoReusa(db, {
      opcaoDaFonteLigada: true,
      organizationId: org,
      contactId,
      pipelineId: entrada.pipeline_id,
    });
    if (aberto) {
      lead = { id: aberto.id, ja_existia: true };
    } else {
      const stageId = entrada.stage_id ?? (await primeiraEtapa(db, org, entrada.pipeline_id, quem));
      const criado = await createLeadHandler(
        db,
        { organization_id: org, actor: quem.actor, requestId: quem.requestId },
        {
          pipeline_id: entrada.pipeline_id,
          stage_id: stageId,
          title: entrada.title ?? (linha.author_username ? `@${linha.author_username}` : "Comentário"),
          contact_id: contactId,
          source: "social",
          tags: [],
          source_metadata: { origem: "comentario_de_rede_social", social_comment_id: linha.id },
        },
      );
      lead = { id: String(criado.id), ja_existia: false };
    }
  }

  await auditar(quem, org, "social_comment.contato_criado", linha, {
    contact_id: contactId,
    contato_ja_existia: jaExistia,
    lead_id: lead?.id ?? null,
    lead_ja_existia: lead?.ja_existia ?? null,
  });
  return {
    comment: apresentar(await carregar(db, org, id, quem)),
    contact_id: contactId,
    contato_ja_existia: jaExistia,
    lead,
  };
}

async function primeiraEtapa(db: SupabaseClient, org: string, pipelineId: string, quem: QuemAge): Promise<string> {
  const { data, error } = await db
    .from("crm_stages")
    .select("id")
    .eq("organization_id", org)
    .eq("pipeline_id", pipelineId)
    .eq("is_archived", false)
    .order("position", { ascending: true })
    .limit(1);
  if (error) throw new Error(`crm_stages: ${error.message}`);
  const etapa = ((data as { id: string }[] | null) ?? [])[0]?.id;
  if (!etapa) throw recusa(quem, 404, "not_found", "Funil não encontrado ou sem etapa ativa.");
  return etapa;
}
