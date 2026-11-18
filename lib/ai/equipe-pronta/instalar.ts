/**
 * O INSTALADOR DA EQUIPE PRONTA — do perfil do negócio às peças na organização.
 *
 * Cria OU ATUALIZA; rodar duas vezes não duplica nada. Cada passo procura o que
 * já existe (pelo id guardado em `equipe_pronta_perfis.instalacao`, e na falta
 * dele por um nome ou marca estável) antes de criar.
 *
 * Os passos, na ordem:
 *
 *   0. EDIÇÃO À MÃO — antes de escrever qualquer coisa. Agente que o cliente
 *      mudou fora da equipe pronta só é sobrescrito com `forcar`; sem ele, a
 *      instalação para aqui, com a lista, e NADA foi gravado.
 *   1. memória da organização (o resumo do negócio, num bloco delimitado);
 *   2. fonte de conhecimento "Política comercial e perguntas frequentes";
 *   3. tipo de agenda principal, e os de fábrica vazios desativados;
 *   4. etapas do funil marcadas por passo (`agent_stage_hint`);
 *   5. régua de follow-up do Recuperador;
 *   6. os 4 agentes (rascunho novo, ou versão nova do que já existe);
 *   7. roteador do canal com os 4 membros, fallback = SDR;
 *   8. publicação dos agentes — precisa do roteador, porque é dele que a
 *      publicação tira o canal;
 *   9. canal em ensaio (só os telefones de teste);
 *  10. o que foi criado, de volta em `equipe_pronta_perfis.instalacao`.
 *
 * ⚠️ TUDO POR `organization_id`. O pool é de serviço e ignora a RLS: toda
 * consulta e toda escrita aqui filtra a organização, que vem de quem chama
 * (a sessão), nunca do perfil.
 *
 * ⚠️ O QUE TOCA O MUNDO DE FORA É INJETADO (`PortasDoInstalador`): guardar o
 * texto da base no storage, publicar agente e fluxo, publicar a memória,
 * configurar o ensaio do canal, escolher o modelo de IA. A regra do instalador
 * roda igual com as portas de produção (`portas.ts`) e com as do teste de
 * banco, que é onde "instalar duas vezes não duplica" é provado num Postgres
 * de verdade.
 *
 * ⚠️ PUBLICAR PODE NÃO DAR, E ISSO NÃO É FALHA DA INSTALAÇÃO. Sem chave de IA
 * válida ou sem WhatsApp conectado a publicação é recusada pelo banco. O
 * agente fica em rascunho, a instalação termina, e o checklist da tela diz o
 * que falta; instalar de novo, depois de resolver, publica.
 */
import { createHash } from "node:crypto";
import type pg from "pg";

import { createMcpAgentDraft } from "@/lib/ai/agents/create-draft";
import { writeRouterMembers, type RouterMemberInput } from "@/lib/ai/agents/router-members";
import { versionCreateSchema } from "@/lib/ai/agents/validation";
import { NEW_ROUTER_CONTEXT_MESSAGES } from "@/lib/ai/classifier-context";
import { PROVIDERS_DE_MENSAGEM } from "@/lib/channels/capabilities";
import type { FlowGraph } from "@/lib/followup/graph-schema";
import type { TriggerConfig } from "@/lib/followup/api-schemas";
import {
  instalacaoSchema,
  perfilSchema,
  type InstalacaoDaEquipe,
  type PerfilDoNegocio,
} from "@/lib/schemas/equipe-pronta";
import { CHAVE_DE_CONFIG, PAPEIS, PAPEL_DE_ENTRADA } from "./index";
import { NOME_DA_REGUA, gatilhoDaRegua, grafoDaRegua } from "./regua";
import { hashDosCampos, renderizarAgente, situacaoDoAgente, type SituacaoDoAgente } from "./renderizar";
import {
  PASSOS_DA_EQUIPE,
  type CamposDoAgente,
  type ContextoDaInstalacao,
  type EtapaDoFunil,
  type PapelDaEquipe,
  type PapelId,
  type PassoDaEquipe,
} from "./tipos";

export const NOME_DA_FONTE = "Política comercial e perguntas frequentes";
export const NOME_DO_ROTEADOR = "Equipe pronta";
/** Os tipos que `fn_semear_tipos_de_agendamento` cria em toda organização nova. */
export const SLUGS_DE_FABRICA = ["consulta", "reuniao", "atendimento"] as const;

const INICIO_DA_MEMORIA = "<!-- equipe-pronta:inicio -->";
const FIM_DA_MEMORIA = "<!-- equipe-pronta:fim -->";

export class EquipeProntaError extends Error {
  constructor(
    public codigo: string,
    message: string,
    public status = 422,
    public detalhes?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface ModeloEscolhido {
  provider: string;
  model: string;
  credential_id: string | null;
}

export type ResultadoDaPublicacaoDoAgente = { ok: true } | { ok: false; code: string };

/** O que o instalador pede ao mundo de fora. Ver `portas.ts` para a produção. */
export interface PortasDoInstalador {
  /** Guarda o texto da base como arquivo e devolve o caminho dele. */
  guardarTextoDaBase(orgId: string, texto: string): Promise<string>;
  /** Avisa o indexador de que a fonte mudou. Melhor-esforço. */
  avisarQueAFonteMudou(orgId: string, fonteId: string): Promise<void>;
  publicarMemoria(orgId: string, userId: string, conteudo: string): Promise<void>;
  publicarRegua(p: { orgId: string; pointerId: string; grafo: FlowGraph; userId: string }): Promise<void>;
  publicarAgente(p: { orgId: string; agentId: string; versionId: string }): Promise<ResultadoDaPublicacaoDoAgente>;
  /** Canal em ensaio: só os telefones da lista falam com a IA. */
  porCanalEmEnsaio(orgId: string, canalId: string, telefones: string[]): Promise<void>;
  /** Lança `EquipeProntaError` quando não há chave de IA nem modelo com ferramentas. */
  escolherModelo(db: pg.PoolClient, orgId: string, canalId: string | null): Promise<ModeloEscolhido>;
}

export interface AgenteNoResultado {
  papel: PapelId;
  agent_id: string;
  version_id: string;
  /** O que aconteceu com ele nesta rodada. */
  acao: "criado" | "atualizado" | "sem_mudanca";
  publicado: boolean;
  /** Por que a publicação foi recusada, quando foi. */
  motivo_sem_publicar: string | null;
}

export interface ResultadoDaInstalacao {
  instalacao: InstalacaoDaEquipe;
  agentes: AgenteNoResultado[];
  /** O que nasceu NESTA rodada — vazio na segunda instalação igual. */
  criados: string[];
}

interface ContextoDeQuemChama {
  orgId: string;
  userId: string;
}

const hash = (valor: unknown) => createHash("sha256").update(JSON.stringify(valor)).digest("hex");

/**
 * O mesmo valor com as chaves de todo objeto em ordem alfabética.
 *
 * ⚠️ O `jsonb` do Postgres NÃO conserva a ordem das chaves: o que foi gravado
 * como `{ nodes, edges }` volta como `{ edges, nodes }`. Comparar o que está no
 * banco com o que seria gravado por `JSON.stringify` direto acusa diferença
 * onde não há nenhuma — medido no teste de banco: a régua era republicada a
 * cada instalação, uma versão nova por vez.
 */
export function emOrdem(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(emOrdem);
  if (valor !== null && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, emOrdem(v)]),
    );
  }
  return valor;
}

/** O slug sai do nome, como em `app/api/v1/agenda/tipos/route.ts`. */
function slugDe(nome: string): string {
  return (
    nome
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "tipo"
  );
}

/** O resumo do negócio que vai para a memória da organização. */
export function resumoDoNegocio(perfil: PerfilDoNegocio): string {
  return [
    `Empresa: ${perfil.negocio.nome}.`,
    `O que faz: ${perfil.negocio.o_que_faz}`,
    ...(perfil.negocio.cidade ? [`Onde: ${perfil.negocio.cidade}.`] : []),
    `Fuso: ${perfil.negocio.fuso}.`,
  ].join("\n");
}

/** O texto da fonte de conhecimento. Vazio = a empresa não respondeu os blocos 7 e 10. */
export function textoDaBase(perfil: PerfilDoNegocio): string {
  const partes: string[] = [];
  const pagamento = perfil.regras.formas_de_pagamento.trim();
  if (pagamento) partes.push(`## Formas de pagamento\n\n${pagamento}`);
  const faq = perfil.faq.texto.trim();
  if (faq) partes.push(`## Perguntas frequentes e políticas\n\n${faq}`);
  return partes.join("\n\n");
}

/**
 * A memória com o bloco da equipe pronta trocado — o resto do texto, que é da
 * empresa, fica como estava. Sem bloco anterior, o novo entra no fim.
 */
export function memoriaComOBloco(atual: string, resumo: string): string {
  const bloco = `${INICIO_DA_MEMORIA}\n${resumo}\n${FIM_DA_MEMORIA}`;
  const inicio = atual.indexOf(INICIO_DA_MEMORIA);
  const fim = atual.indexOf(FIM_DA_MEMORIA);
  if (inicio !== -1 && fim > inicio) {
    return (atual.slice(0, inicio) + bloco + atual.slice(fim + FIM_DA_MEMORIA.length)).trim();
  }
  return atual.trim() === "" ? bloco : `${atual.trim()}\n\n${bloco}`;
}

// ───────────────────────────────────────────────────────────────────────────
// LEITURAS
// ───────────────────────────────────────────────────────────────────────────

/** A linha do perfil, com a instalação já lida (vazia quando nunca instalou). */
export async function lerPerfil(
  db: pg.PoolClient | pg.Pool,
  orgId: string,
): Promise<{
  respostas: unknown;
  estado: string;
  modo: string;
  instalado_em: string | null;
  instalacao: InstalacaoDaEquipe;
} | null> {
  const { rows } = await db.query(
    "select respostas, estado, modo, instalado_em, instalacao from equipe_pronta_perfis where organization_id=$1",
    [orgId],
  );
  if (!rows[0]) return null;
  const lida = instalacaoSchema.safeParse(rows[0].instalacao ?? {});
  return {
    respostas: rows[0].respostas,
    estado: rows[0].estado,
    modo: rows[0].modo,
    instalado_em: rows[0].instalado_em ? new Date(rows[0].instalado_em).toISOString() : null,
    instalacao: lida.success ? lida.data : instalacaoSchema.parse({ agentes: {} }),
  };
}

/** O canal: o escolhido, ou o único que existe. Mais de um sem escolha = recusa. */
async function resolverCanal(
  db: pg.PoolClient,
  orgId: string,
  escolhido: string | undefined,
): Promise<string | null> {
  const { rows } = await db.query(
    `select id from channel_sessions
      where organization_id=$1 and archived_at is null and provider = any($2::text[])
      order by created_at`,
    [orgId, [...PROVIDERS_DE_MENSAGEM]],
  );
  const ids = rows.map((r) => String(r.id));
  if (escolhido !== undefined) {
    if (!ids.includes(escolhido)) {
      throw new EquipeProntaError("canal_invalido", "O canal escolhido não existe nesta empresa.");
    }
    return escolhido;
  }
  if (ids.length > 1) {
    throw new EquipeProntaError(
      "escolha_o_canal",
      "Esta empresa tem mais de um canal. Escolha por qual deles a equipe de IA vai atender.",
    );
  }
  return ids[0] ?? null;
}

/** O funil: o escolhido, o único, ou o padrão. Mais de um sem padrão = recusa. */
async function resolverFunil(
  db: pg.PoolClient,
  orgId: string,
  escolhido: string | undefined,
): Promise<{ id: string; nome: string } | null> {
  const { rows } = await db.query(
    "select id, name, is_default from crm_pipelines where organization_id=$1 and not is_archived order by position, created_at",
    [orgId],
  );
  const funis = rows.map((r) => ({ id: String(r.id), nome: String(r.name), padrao: r.is_default === true }));
  if (escolhido !== undefined) {
    const achado = funis.find((f) => f.id === escolhido);
    if (!achado) throw new EquipeProntaError("funil_invalido", "O funil escolhido não existe nesta empresa.");
    return achado;
  }
  if (funis.length <= 1) return funis[0] ?? null;
  const padrao = funis.filter((f) => f.padrao);
  if (padrao.length === 1) return padrao[0]!;
  throw new EquipeProntaError(
    "escolha_o_funil",
    "Esta empresa tem mais de um funil. Escolha em qual deles a equipe de IA vai trabalhar.",
  );
}

/** As etapas do funil que já estão marcadas com o passo da equipe. */
async function etapasMarcadas(
  db: pg.PoolClient,
  orgId: string,
  funilId: string,
): Promise<Partial<Record<PassoDaEquipe, EtapaDoFunil>>> {
  const { rows } = await db.query(
    `select id, name, agent_stage_hint from crm_stages
      where organization_id=$1 and pipeline_id=$2 and not is_archived and agent_stage_hint = any($3::text[])`,
    [orgId, funilId, Object.values(PASSOS_DA_EQUIPE)],
  );
  const etapas: Partial<Record<PassoDaEquipe, { id: string; nome: string }>> = {};
  for (const passo of Object.keys(PASSOS_DA_EQUIPE) as PassoDaEquipe[]) {
    const linha = rows.find((r) => r.agent_stage_hint === PASSOS_DA_EQUIPE[passo]);
    if (linha) etapas[passo] = { id: String(linha.id), nome: String(linha.name) };
  }
  return etapas;
}

/** O agente de um papel: pelo id guardado, e na falta dele pela marca em `config`. */
async function acharAgente(
  db: pg.PoolClient,
  orgId: string,
  papel: PapelId,
  idGuardado: string | undefined,
): Promise<{ id: string; published_version_id: string | null } | null> {
  const { rows } = await db.query(
    `select id, published_version_id from ai_agents
      where organization_id=$1 and archived_at is null
        and (id = $2::uuid or config->$3->>'papel' = $4)
      order by (id = $2::uuid) desc, created_at
      limit 1`,
    [orgId, idGuardado ?? null, CHAVE_DE_CONFIG, papel],
  );
  return rows[0]
    ? {
        id: String(rows[0].id),
        published_version_id: rows[0].published_version_id ? String(rows[0].published_version_id) : null,
      }
    : null;
}

/** A versão que vale para comparar: a publicada, e na falta dela a mais nova. */
async function versaoVigente(
  db: pg.PoolClient,
  orgId: string,
  agente: { id: string; published_version_id: string | null },
): Promise<Record<string, unknown> | null> {
  const { rows } = await db.query(
    `select * from ai_agent_versions
      where organization_id=$1 and agent_id=$2
      order by (id = $3::uuid) desc, version_number desc
      limit 1`,
    [orgId, agente.id, agente.published_version_id],
  );
  return rows[0] ?? null;
}

export interface AgenteExaminado {
  papel: PapelId;
  agent_id: string | null;
  situacao: SituacaoDoAgente | "nao_instalado";
  publicado: boolean;
  versao_do_papel_instalada: number | null;
}

/**
 * Como cada agente está em relação ao que o renderizador geraria AGORA.
 *
 * É a mesma conta do passo 0 do instalador e do estado que a tela mostra — uma
 * função só, para os dois nunca discordarem sobre o que é "editado à mão".
 */
export async function examinarAgentes(
  db: pg.PoolClient,
  orgId: string,
  perfil: PerfilDoNegocio,
  instalacao: InstalacaoDaEquipe,
  contexto: ContextoDaInstalacao,
): Promise<AgenteExaminado[]> {
  const exame: AgenteExaminado[] = [];
  for (const papel of PAPEIS) {
    const guardado = instalacao.agentes[papel.id];
    const agente = await acharAgente(db, orgId, papel.id, guardado?.agent_id);
    if (!agente) {
      exame.push({ papel: papel.id, agent_id: null, situacao: "nao_instalado", publicado: false, versao_do_papel_instalada: null });
      continue;
    }
    const versao = await versaoVigente(db, orgId, agente);
    exame.push({
      papel: papel.id,
      agent_id: agente.id,
      situacao: situacaoDoAgente({
        publicado: hashDosCampos(versao ?? {}),
        gerado: hashDosCampos(renderizarAgente(papel, perfil, contexto)),
        instalado: guardado?.hash ?? null,
      }),
      publicado: agente.published_version_id !== null,
      versao_do_papel_instalada: guardado?.versao_do_papel ?? null,
    });
  }
  return exame;
}

/**
 * O contexto a partir do que JÁ está instalado — só leitura. Serve ao passo 0
 * (decidir edição à mão sem escrever nada) e ao estado da tela.
 */
export async function contextoDoQueExiste(
  db: pg.PoolClient,
  orgId: string,
  instalacao: InstalacaoDaEquipe,
): Promise<ContextoDaInstalacao> {
  let agenda: ContextoDaInstalacao["agenda"] = null;
  if (instalacao.event_type_id) {
    const { rows } = await db.query(
      "select id, slug, name from calendar_event_types where organization_id=$1 and id=$2",
      [orgId, instalacao.event_type_id],
    );
    if (rows[0]) agenda = { id: String(rows[0].id), slug: String(rows[0].slug), nome: String(rows[0].name) };
  }
  let funil: ContextoDaInstalacao["funil"] = null;
  if (instalacao.pipeline_id) {
    const { rows } = await db.query(
      "select id, name from crm_pipelines where organization_id=$1 and id=$2",
      [orgId, instalacao.pipeline_id],
    );
    if (rows[0]) {
      funil = {
        id: String(rows[0].id),
        nome: String(rows[0].name),
        etapas: await etapasMarcadas(db, orgId, String(rows[0].id)),
      };
    }
  }
  return {
    agenda,
    funil,
    knowledgeSourceIds: instalacao.knowledge_source_id ? [instalacao.knowledge_source_id] : [],
    reguaDeFollowupId: instalacao.followup_flow_pointer_id,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// PASSOS
// ───────────────────────────────────────────────────────────────────────────

async function passoDaMemoria(
  db: pg.PoolClient,
  portas: PortasDoInstalador,
  ctx: ContextoDeQuemChama,
  perfil: PerfilDoNegocio,
): Promise<void> {
  const { rows } = await db.query(
    `select v.content from org_memory_pointers p
       join org_memory_versions v on v.id = p.version_id and v.organization_id = p.organization_id
      where p.organization_id=$1`,
    [ctx.orgId],
  );
  const atual = rows[0] ? String(rows[0].content) : "";
  const nova = memoriaComOBloco(atual, resumoDoNegocio(perfil));
  // Mesmo texto = nenhuma versão nova. É o que impede uma versão por instalação.
  if (nova === atual.trim()) return;
  await portas.publicarMemoria(ctx.orgId, ctx.userId, nova);
}

async function passoDaBase(
  db: pg.PoolClient,
  portas: PortasDoInstalador,
  ctx: ContextoDeQuemChama,
  perfil: PerfilDoNegocio,
  instalacao: InstalacaoDaEquipe,
  criados: string[],
): Promise<string | null> {
  const texto = textoDaBase(perfil);
  const { rows } = await db.query(
    `select id, source_metadata from ai_knowledge_sources
      where organization_id=$1 and status <> 'archived' and (id = $2::uuid or name = $3)
      order by (id = $2::uuid) desc, created_at
      limit 1`,
    [ctx.orgId, instalacao.knowledge_source_id, NOME_DA_FONTE],
  );
  const existente = rows[0] as { id: string; source_metadata: Record<string, unknown> | null } | undefined;

  // Sem texto não há o que indexar: a fonte não nasce vazia. O checklist da
  // tela acusa a falta, com o link para o passo do questionário.
  if (texto === "") return existente ? String(existente.id) : null;

  const hashDoTexto = hash(texto);
  if (existente && existente.source_metadata?.equipe_pronta_hash === hashDoTexto) {
    return String(existente.id);
  }

  const caminho = await portas.guardarTextoDaBase(ctx.orgId, texto);
  const metadata = {
    ...(existente?.source_metadata ?? {}),
    blob_path: caminho,
    ext: "md",
    origem: "equipe_pronta",
    equipe_pronta_hash: hashDoTexto,
  };

  let fonteId: string;
  if (existente) {
    fonteId = String(existente.id);
    await db.query(
      `update ai_knowledge_sources
          set source_metadata=$3::jsonb, is_active=true, last_index_error=null, ingested_at=now()
        where organization_id=$1 and id=$2`,
      [ctx.orgId, fonteId, JSON.stringify(metadata)],
    );
  } else {
    const inserida = await db.query(
      `insert into ai_knowledge_sources
         (organization_id, source_type, name, status, is_active, source_metadata, ingested_at)
       values ($1, 'documento', $2, 'ready', true, $3::jsonb, now())
       returning id`,
      [ctx.orgId, NOME_DA_FONTE, JSON.stringify(metadata)],
    );
    fonteId = String(inserida.rows[0].id);
    criados.push("fonte_de_conhecimento");
  }
  await portas.avisarQueAFonteMudou(ctx.orgId, fonteId).catch(() => undefined);
  return fonteId;
}

async function passoDaAgenda(
  db: pg.PoolClient,
  ctx: ContextoDeQuemChama,
  perfil: PerfilDoNegocio,
  instalacao: InstalacaoDaEquipe,
  criados: string[],
): Promise<{ agenda: ContextoDaInstalacao["agenda"]; desativados: string[] }> {
  const pedido = perfil.primeiro_passo.agenda;
  let agenda: ContextoDaInstalacao["agenda"] = null;

  if (pedido?.modo === "existente") {
    const { rows } = await db.query(
      "select id, slug, name, is_active from calendar_event_types where organization_id=$1 and id=$2",
      [ctx.orgId, pedido.event_type_id],
    );
    if (!rows[0]) {
      throw new EquipeProntaError("agenda_invalida", "O tipo de agenda escolhido não existe nesta empresa.");
    }
    if (!rows[0].is_active) {
      throw new EquipeProntaError(
        "agenda_desativada",
        `O tipo de agenda "${rows[0].name}" está desativado. Ative-o na Agenda ou escolha outro.`,
      );
    }
    agenda = { id: String(rows[0].id), slug: String(rows[0].slug), nome: String(rows[0].name) };
  } else if (pedido?.modo === "criar") {
    const slug = slugDe(pedido.nome);
    const achado = await db.query(
      `select id, slug, name from calendar_event_types
        where organization_id=$1 and (id = $2::uuid or slug = $3)
        order by (id = $2::uuid) desc
        limit 1`,
      [ctx.orgId, instalacao.event_type_id, slug],
    );
    if (achado.rows[0]) {
      // Reativa o que já existe em vez de criar um segundo com outro slug.
      await db.query(
        "update calendar_event_types set is_active=true where organization_id=$1 and id=$2 and not is_active",
        [ctx.orgId, achado.rows[0].id],
      );
      agenda = {
        id: String(achado.rows[0].id),
        slug: String(achado.rows[0].slug),
        nome: String(achado.rows[0].name),
      };
    } else {
      const novo = await db.query(
        `insert into calendar_event_types
           (organization_id, name, slug, category, duration_minutes, description, default_owner_user_id)
         values ($1, $2, $3, 'outro', $4, $5, $6)
         returning id, slug, name`,
        [
          ctx.orgId,
          pedido.nome,
          slug,
          pedido.duracao_minutos,
          pedido.pago ? "Atendimento pago." : "Atendimento sem custo.",
          // Sem responsável não há jornada, e sem jornada não há horário: nasce
          // com quem instalou, que troca na Agenda se for outra pessoa.
          ctx.userId,
        ],
      );
      agenda = { id: String(novo.rows[0].id), slug: String(novo.rows[0].slug), nome: String(novo.rows[0].name) };
      criados.push("tipo_de_agenda");
    }
  }

  // Os tipos de fábrica que ninguém usa saem da lista do agente: ativo, sem
  // horário publicado e sem nenhum compromisso. O principal nunca é tocado.
  const desativados = [...instalacao.tipos_de_agenda_desativados];
  if (agenda !== null) {
    const { rows } = await db.query(
      `update calendar_event_types t set is_active=false
        where t.organization_id=$1 and t.is_active and t.id <> $2 and t.slug = any($3::text[])
          and not t.service_enabled
          and not exists (
            select 1 from calendar_appointments a
             where a.organization_id = t.organization_id and a.event_type_id = t.id)
          and not exists (
            select 1 from attendant_availability d
             where d.organization_id = t.organization_id and d.user_id = t.default_owner_user_id
               and jsonb_array_length(coalesce(d.schedule->'windows', '[]'::jsonb)) > 0)
        returning t.id`,
      [ctx.orgId, agenda.id, [...SLUGS_DE_FABRICA]],
    );
    for (const r of rows) if (!desativados.includes(String(r.id))) desativados.push(String(r.id));
  }
  return { agenda, desativados };
}

async function passoDoFunil(
  db: pg.PoolClient,
  ctx: ContextoDeQuemChama,
  perfil: PerfilDoNegocio,
  funil: { id: string; nome: string } | null,
): Promise<ContextoDaInstalacao["funil"]> {
  if (funil === null) return null;
  for (const passo of Object.keys(PASSOS_DA_EQUIPE) as PassoDaEquipe[]) {
    const etapaId = perfil.onde.etapas[passo];
    if (etapaId === undefined) continue;
    const { rows } = await db.query(
      "select id, name, is_won, is_lost, agent_stage_hint from crm_stages where organization_id=$1 and pipeline_id=$2 and id=$3 and not is_archived",
      [ctx.orgId, funil.id, etapaId],
    );
    const etapa = rows[0];
    if (!etapa) {
      throw new EquipeProntaError("etapa_invalida", "Uma das etapas escolhidas não existe neste funil.");
    }
    const hint = PASSOS_DA_EQUIPE[passo];
    // O banco exige coerência entre a marca e o desfecho da etapa: "perdido" só
    // numa etapa de perda, e nenhuma outra marca numa etapa de ganho ou perda.
    if ((hint === "lost") !== (etapa.is_lost === true) || etapa.is_won === true) {
      throw new EquipeProntaError(
        "etapa_incoerente",
        passo === "perdido"
          ? `A etapa "${etapa.name}" não é uma etapa de perda. Escolha, para "perdido", uma etapa de perda do funil.`
          : `A etapa "${etapa.name}" é de ganho ou de perda, e não serve para "${passo}".`,
      );
    }
    if (etapa.agent_stage_hint === hint) continue;
    // A marca é única por funil: sai de onde estava antes de entrar na nova.
    await db.query(
      "update crm_stages set agent_stage_hint=null where organization_id=$1 and pipeline_id=$2 and agent_stage_hint=$3 and id<>$4",
      [ctx.orgId, funil.id, hint, etapaId],
    );
    await db.query(
      "update crm_stages set agent_stage_hint=$4 where organization_id=$1 and pipeline_id=$2 and id=$3",
      [ctx.orgId, funil.id, etapaId, hint],
    );
  }
  return { ...funil, etapas: await etapasMarcadas(db, ctx.orgId, funil.id) };
}

async function passoDaRegua(
  db: pg.PoolClient,
  portas: PortasDoInstalador,
  ctx: ContextoDeQuemChama,
  perfil: PerfilDoNegocio,
  instalacao: InstalacaoDaEquipe,
  criados: string[],
): Promise<string> {
  const grafo = grafoDaRegua(perfil);
  const gatilho: TriggerConfig = gatilhoDaRegua(perfil);
  // Em ordem de chave: é contra o que o `jsonb` devolve que isto é comparado.
  const assinatura = hash(emOrdem({ grafo, gatilho }));

  const { rows } = await db.query(
    `select id, active_version_id, trigger_config, draft_graph from followup_flow_pointers
      where organization_id=$1 and (id = $2::uuid or name = $3)
      order by (id = $2::uuid) desc
      limit 1`,
    [ctx.orgId, instalacao.followup_flow_pointer_id, NOME_DA_REGUA],
  );
  let pointerId: string;
  let precisaPublicar: boolean;
  if (rows[0]) {
    pointerId = String(rows[0].id);
    const atual = hash(emOrdem({ grafo: rows[0].draft_graph, gatilho: rows[0].trigger_config }));
    const mudou = atual !== assinatura;
    if (mudou) {
      await db.query(
        "update followup_flow_pointers set draft_graph=$3::jsonb, trigger_config=$4::jsonb where organization_id=$1 and id=$2",
        [ctx.orgId, pointerId, JSON.stringify(grafo), JSON.stringify(gatilho)],
      );
    }
    precisaPublicar = mudou || rows[0].active_version_id === null;
  } else {
    const novo = await db.query(
      `insert into followup_flow_pointers (organization_id, name, draft_graph, trigger_config, handoff_policy)
       values ($1, $2, $3::jsonb, $4::jsonb, 'pause')
       returning id`,
      [ctx.orgId, NOME_DA_REGUA, JSON.stringify(grafo), JSON.stringify(gatilho)],
    );
    pointerId = String(novo.rows[0].id);
    precisaPublicar = true;
    criados.push("regua_de_followup");
  }
  if (precisaPublicar) {
    await portas.publicarRegua({ orgId: ctx.orgId, pointerId, grafo, userId: ctx.userId });
  }
  return pointerId;
}

/** As colunas de versão que o schema conhece — é delas que sai a versão nova. */
const COLUNAS_DA_VERSAO = Object.keys(versionCreateSchema.shape);
const COLUNAS_JSON = new Set(["followup", "trigger_config"]);
/** Nulo nestas colunas é "ausente": o schema as tem como opcionais, não nuláveis. */
const NULO_E_AUSENTE = new Set(["trigger_config", "inbound_debounce_ms", "reply_min_interval_ms"]);

/** Uma versão nova (rascunho) do agente: a vigente, com os campos da equipe pronta trocados. */
async function novaVersaoDoAgente(
  db: pg.PoolClient,
  ctx: ContextoDeQuemChama,
  agentId: string,
  base: Record<string, unknown>,
  campos: CamposDoAgente,
): Promise<string> {
  const daBase = Object.fromEntries(
    COLUNAS_DA_VERSAO.filter(
      (c) => base[c] !== undefined && !(NULO_E_AUSENTE.has(c) && base[c] === null),
    ).map((c) => [c, base[c]]),
  );
  const versao = versionCreateSchema.parse({
    ...daBase,
    ...campos,
    // A régua da equipe entra; a janela de envio e as outras escolhas do
    // follow-up que o cliente fez no agente são preservadas.
    followup: { ...((daBase.followup as Record<string, unknown> | undefined) ?? {}), ...campos.followup },
  });
  const entradas = Object.entries(versao).filter(([, v]) => v !== undefined);
  const colunas = entradas.map(([c]) => c);
  const valores = entradas.map(([c, v]) => (COLUNAS_JSON.has(c) ? JSON.stringify(v) : v));
  const { rows } = await db.query(
    `insert into ai_agent_versions (organization_id, agent_id, version_number, status, created_by, ${colunas.join(",")})
     select $1, $2, coalesce(max(version_number), 0) + 1, 'draft', $3, ${entradas.map((_, i) => `$${i + 4}`).join(",")}
       from ai_agent_versions where organization_id=$1 and agent_id=$2
     returning id`,
    [ctx.orgId, agentId, ctx.userId, ...valores],
  );
  return String(rows[0].id);
}

interface AgentePreparado {
  papel: PapelDaEquipe;
  agentId: string;
  versionId: string;
  hash: string;
  acao: AgenteNoResultado["acao"];
  /** A versão a publicar; `null` = a vigente já está publicada e em dia. */
  aPublicar: string | null;
}

async function passoDosAgentes(
  db: pg.PoolClient,
  portas: PortasDoInstalador,
  ctx: ContextoDeQuemChama,
  perfil: PerfilDoNegocio,
  instalacao: InstalacaoDaEquipe,
  contexto: ContextoDaInstalacao,
  canalId: string | null,
  criados: string[],
): Promise<AgentePreparado[]> {
  const preparados: AgentePreparado[] = [];
  let modelo: ModeloEscolhido | null = null;

  for (const papel of PAPEIS) {
    const campos = renderizarAgente(papel, perfil, contexto);
    const gerado = hashDosCampos(campos);
    const marca = { [CHAVE_DE_CONFIG]: { papel: papel.id, versao: papel.versao, hash: gerado } };
    const agente = await acharAgente(db, ctx.orgId, papel.id, instalacao.agentes[papel.id]?.agent_id);

    if (!agente) {
      modelo ??= await portas.escolherModelo(db, ctx.orgId, canalId);
      // Nome repetido na organização é recusado pelo banco: o nome padrão do
      // papel ganha um sufixo em vez de derrubar a instalação.
      const usados = await db.query(
        "select name from ai_agents where organization_id=$1 and archived_at is null",
        [ctx.orgId],
      );
      const nomes = new Set(usados.rows.map((r) => String(r.name).toLowerCase()));
      const nome = nomes.has(papel.nomePadrao.toLowerCase())
        ? `${papel.nomePadrao} (Equipe pronta)`
        : papel.nomePadrao;
      const { agent, version } = await createMcpAgentDraft(
        db,
        ctx,
        {
          name: nome,
          description: papel.descricao,
          version: {
            ...campos,
            provider: modelo.provider,
            model: modelo.model,
            credential_id: modelo.credential_id,
            // Sem canal próprio: quem diz o canal é o roteador da equipe.
            channel_session_id: null,
            handoff_tool_enabled: true,
          },
        },
        // Nasce pausado: só responde depois de publicado e posto no roteador.
        { pausedAt: new Date(), config: marca },
      );
      preparados.push({
        papel,
        agentId: String(agent.id),
        versionId: String(version.id),
        hash: gerado,
        acao: "criado",
        aPublicar: String(version.id),
      });
      criados.push(`agente_${papel.id}`);
      continue;
    }

    const vigente = await versaoVigente(db, ctx.orgId, agente);
    const emDia = vigente !== null && hashDosCampos(vigente) === gerado;
    await db.query(
      "update ai_agents set config = config || $3::jsonb where organization_id=$1 and id=$2",
      [ctx.orgId, agente.id, JSON.stringify(marca)],
    );
    if (emDia && vigente) {
      preparados.push({
        papel,
        agentId: agente.id,
        versionId: String(vigente.id),
        hash: gerado,
        acao: "sem_mudanca",
        // Em dia mas nunca publicado (a publicação foi recusada da outra vez).
        aPublicar: agente.published_version_id === String(vigente.id) ? null : String(vigente.id),
      });
      continue;
    }
    if (!vigente) {
      throw new EquipeProntaError(
        "agente_sem_versao",
        `O agente de ${papel.nomePadrao} não tem nenhuma versão. Abra o editor do agente e salve.`,
      );
    }
    const versionId = await novaVersaoDoAgente(db, ctx, agente.id, vigente, campos);
    preparados.push({
      papel,
      agentId: agente.id,
      versionId,
      hash: gerado,
      acao: "atualizado",
      aPublicar: versionId,
    });
  }
  return preparados;
}

/** O que há de ALHEIO no roteador que já atende o canal. */
export interface RoteadorDoCanal {
  id: string;
  nome: string;
  /** O roteador não é o que a equipe pronta criou ou adotou. */
  de_fora: boolean;
  /** O agente que hoje recebe o que ninguém pegou, quando não é da equipe. */
  fallback_de_fora: { agent_id: string; nome: string } | null;
  /** Agentes que o cliente pôs no roteador e não são da equipe. */
  membros_de_fora: { agent_id: string; nome: string; intencao: string }[];
}

/** O roteador ATIVO do canal, lido contra os agentes da equipe. `null` = não há. */
async function roteadorDoCanal(
  db: pg.PoolClient,
  orgId: string,
  canalId: string,
  instalacao: Pick<InstalacaoDaEquipe, "router_id" | "agentes">,
): Promise<RoteadorDoCanal | null> {
  const daEquipe = Object.values(instalacao.agentes).map((a) => a.agent_id);
  const { rows } = await db.query(
    `select r.id, r.name, r.fallback_agent_id, a.name as fallback_nome
       from ai_routers r
       left join ai_agents a on a.organization_id = r.organization_id and a.id = r.fallback_agent_id
      where r.organization_id=$1 and r.channel_session_id=$2 and r.is_active`,
    [orgId, canalId],
  );
  const r = rows[0];
  if (!r) return null;
  const membros = await db.query(
    `select m.agent_id, m.intent_name, a.name
       from ai_router_members m
       left join ai_agents a on a.organization_id = m.organization_id and a.id = m.agent_id
      where m.organization_id=$1 and m.router_id=$2 and not (m.agent_id = any($3::uuid[]))
      order by m.agent_id`,
    [orgId, r.id, daEquipe],
  );
  const fallback = r.fallback_agent_id === null ? null : String(r.fallback_agent_id);
  return {
    id: String(r.id),
    nome: String(r.name ?? ""),
    de_fora: instalacao.router_id !== String(r.id),
    fallback_de_fora:
      fallback !== null && !daEquipe.includes(fallback)
        ? { agent_id: fallback, nome: String(r.fallback_nome ?? "") }
        : null,
    membros_de_fora: membros.rows.map((m) => ({
      agent_id: String(m.agent_id),
      nome: String(m.name ?? ""),
      intencao: String(m.intent_name ?? ""),
    })),
  };
}

/** Tem algo do cliente neste roteador que a instalação tocaria ou passaria a dividir? */
function temAlgoDeFora(r: RoteadorDoCanal): boolean {
  return r.de_fora || r.fallback_de_fora !== null || r.membros_de_fora.length > 0;
}

/** O que a pessoa confirmou: o roteador, o fallback alheio e os membros alheios. */
function assinaturaDoRoteador(r: RoteadorDoCanal): string {
  return hash([r.id, r.fallback_de_fora?.agent_id ?? null, r.membros_de_fora.map((m) => m.agent_id).sort()]);
}

/** O canal que JÁ ATENDE clientes — o que o ensaio interromperia. */
export interface CanalEmProducao {
  /** Agentes publicados direto neste canal que não são da equipe pronta. */
  agentes: { agent_id: string; nome: string }[];
  /** Conversas deste canal com resposta da IA nos últimos 7 dias. */
  conversas_recentes: number;
}

export const DIAS_DE_CONVERSA_RECENTE = 7;

/**
 * O canal está ABERTO e em uso pela IA?
 *
 * O ensaio é o pré-lançamento do canal, e ele vale para o número inteiro: um
 * agente publicado direto no canal (`ai_agent_versions.channel_session_id`,
 * sem roteador nenhum) para de atender clientes no instante em que a equipe é
 * instalada. O roteador alheio já tinha a própria recusa; este caso não tinha
 * aviso nenhum.
 *
 * `null` = não há o que avisar: o canal já está em pré-lançamento (a lista de
 * teste só é trocada), ou está aberto e a IA não atende ninguém por ele.
 */
async function canalEmProducao(
  db: pg.PoolClient,
  orgId: string,
  canalId: string,
  instalacao: Pick<InstalacaoDaEquipe, "agentes">,
): Promise<CanalEmProducao | null> {
  const canal = await db.query(
    "select metadata->>'ai_gate' as gate from channel_sessions where organization_id=$1 and id=$2",
    [orgId, canalId],
  );
  if (canal.rows[0]?.gate === "allowlist") return null;

  const daEquipe = Object.values(instalacao.agentes).map((a) => a.agent_id);
  const [agentes, conversas] = await Promise.all([
    db.query(
      `select a.id, a.name
         from ai_agents a
         join ai_agent_versions v on v.organization_id = a.organization_id and v.id = a.published_version_id
        where a.organization_id=$1 and v.channel_session_id=$2
          and a.archived_at is null and a.paused_at is null
          and not (a.id = any($3::uuid[]))
          and not (a.config ? $4)
        order by a.name, a.id`,
      [orgId, canalId, daEquipe, CHAVE_DE_CONFIG],
    ),
    db.query(
      `select count(distinct conversation_id)::int as n
         from messages
        where organization_id=$1 and channel_session_id=$2
          and direction='outbound' and sent_via='ai'
          and sent_at > now() - make_interval(days => $3)`,
      [orgId, canalId, DIAS_DE_CONVERSA_RECENTE],
    ),
  ]);
  const achado: CanalEmProducao = {
    agentes: agentes.rows.map((a) => ({ agent_id: String(a.id), nome: String(a.name ?? "") })),
    conversas_recentes: Number(conversas.rows[0]?.n ?? 0),
  };
  return canalEstaEmProducao(achado) ? achado : null;
}

/** Tem agente próprio no canal, ou a IA respondeu alguém por ele há pouco. */
export function canalEstaEmProducao(c: CanalEmProducao): boolean {
  return c.agentes.length > 0 || c.conversas_recentes > 0;
}

/**
 * A RECUSA de antes da instalação — pura, para ser medida sem banco.
 *
 * Uma recusa só, com tudo o que a pessoa precisa confirmar: `details` leva
 * `agentes`, `roteador` e `canal`, cada um quando existe. O código é o do
 * primeiro que existe, nesta ordem. Com `forcar`, não há recusa.
 */
export function recusaAntesDeInstalar(c: {
  forcar: boolean;
  editados: { papel: string; agent_id: string | null }[];
  roteador: RoteadorDoCanal | null;
  canal: CanalEmProducao | null;
}): EquipeProntaError | null {
  if (c.forcar) return null;
  const canal = c.canal !== null && canalEstaEmProducao(c.canal) ? c.canal : null;
  const detalhes = {
    ...(c.editados.length > 0 ? { agentes: c.editados } : {}),
    ...(c.roteador
      ? {
          roteador: {
            id: c.roteador.id,
            nome: c.roteador.nome,
            de_fora: c.roteador.de_fora,
            fallback: c.roteador.fallback_de_fora,
            membros: c.roteador.membros_de_fora,
          },
        }
      : {}),
    ...(canal ? { canal } : {}),
  };
  if (c.editados.length > 0) {
    return new EquipeProntaError(
      "agentes_editados_a_mao",
      "Há agentes que foram alterados fora da equipe pronta. Instalar de novo substitui essas alterações.",
      409,
      detalhes,
    );
  }
  if (c.roteador) {
    return new EquipeProntaError(
      "canal_com_roteador",
      "Este WhatsApp já tem um roteador com agentes que não são da equipe pronta. Instalar passa a entrada das conversas para a equipe.",
      409,
      detalhes,
    );
  }
  if (canal) {
    return new EquipeProntaError(
      "canal_em_producao",
      "Este WhatsApp já atende clientes. Durante o ensaio, a IA só responde os números de teste. Recomendamos instalar em outro número ou ativar logo depois de testar.",
      409,
      detalhes,
    );
  }
  return null;
}

async function passoDoRoteador(
  db: pg.PoolClient,
  ctx: ContextoDeQuemChama,
  canalId: string,
  preparados: AgentePreparado[],
  criados: string[],
): Promise<string> {
  const sdr = preparados.find((p) => p.papel.id === PAPEL_DE_ENTRADA)!;
  const { rows } = await db.query(
    "select id, fallback_agent_id, config from ai_routers where organization_id=$1 and channel_session_id=$2 and is_active",
    [ctx.orgId, canalId],
  );
  let routerId: string;
  if (rows[0]) {
    routerId = String(rows[0].id);
    // O roteador que já atende o canal é reaproveitado. O fallback passa a ser
    // o SDR e a continuidade fica ligada: sem ela, cada mensagem reclassifica e
    // a conversa pula de agente no meio.
    //
    // ⚠️ Só se chega aqui com roteador alheio depois da confirmação: quem
    // recusa sem ela é `instalarEquipePronta`, antes de qualquer escrita
    // (`canal_com_roteador`).
    await db.query(
      `update ai_routers set fallback_agent_id=$3, config = config || '{"sticky":true}'::jsonb
        where organization_id=$1 and id=$2 and (fallback_agent_id is distinct from $3 or coalesce(config->>'sticky','true') = 'false')`,
      [ctx.orgId, routerId, sdr.agentId],
    );
  } else {
    const novo = await db.query(
      `insert into ai_routers (organization_id, name, channel_session_id, fallback_agent_id, config, created_by)
       values ($1, $2, $3, $4, $5::jsonb, $6)
       returning id`,
      [
        ctx.orgId,
        NOME_DO_ROTEADOR,
        canalId,
        sdr.agentId,
        JSON.stringify({ sticky: true, context_message_count: NEW_ROUTER_CONTEXT_MESSAGES }),
        ctx.userId,
      ],
    );
    routerId = String(novo.rows[0].id);
    criados.push("roteador");
  }

  // Os membros DA EQUIPE são trocados inteiros; os que o cliente pôs à mão no
  // mesmo roteador (outros agentes) ficam como estão.
  const ids = preparados.map((p) => p.agentId);
  const atuais = await db.query(
    "select agent_id, intent_name, intent_description, examples from ai_router_members where organization_id=$1 and router_id=$2 and agent_id = any($3::uuid[])",
    [ctx.orgId, routerId, ids],
  );
  const desejados: RouterMemberInput[] = preparados.map((p) => ({
    agent_id: p.agentId,
    intent_name: p.papel.intencao.nome,
    intent_description: p.papel.intencao.descricao,
    examples: [...p.papel.intencao.exemplos],
  }));
  const forma = (m: { agent_id: unknown; intent_name: unknown; intent_description: unknown; examples: unknown }) =>
    hash([String(m.agent_id), m.intent_name, m.intent_description, m.examples]);
  const iguais =
    atuais.rows.length === desejados.length &&
    desejados.every((d) => atuais.rows.some((a) => forma(a) === forma(d)));
  if (!iguais) {
    await db.query(
      "delete from ai_router_members where organization_id=$1 and router_id=$2 and agent_id = any($3::uuid[])",
      [ctx.orgId, routerId, ids],
    );
    await writeRouterMembers(db, ctx.orgId, routerId, desejados, "append");
  }
  return routerId;
}

// ───────────────────────────────────────────────────────────────────────────
// A INSTALAÇÃO
// ───────────────────────────────────────────────────────────────────────────

export async function instalarEquipePronta(
  pool: pg.Pool,
  portas: PortasDoInstalador,
  ctx: ContextoDeQuemChama,
  opcoes: { forcar?: boolean } = {},
): Promise<ResultadoDaInstalacao> {
  const db = await pool.connect();
  const trava = `equipe-pronta:${ctx.orgId}`;
  let travado = false;
  let emTransacao = false;
  let erro: Error | undefined;
  try {
    // Uma instalação por organização de cada vez: duas juntas criariam dois
    // agentes do mesmo papel antes de uma enxergar o que a outra fez.
    await db.query("select pg_advisory_lock(hashtextextended($1,0))", [trava]);
    travado = true;

    const linha = await lerPerfil(db, ctx.orgId);
    if (!linha) {
      throw new EquipeProntaError("perfil_ausente", "Responda o questionário antes de instalar.");
    }
    const lido = perfilSchema.safeParse(linha.respostas);
    if (!lido.success) {
      throw new EquipeProntaError(
        "perfil_incompleto",
        "Faltam respostas obrigatórias no questionário.",
        422,
        { faltam: [...new Set(lido.error.issues.map((i) => i.path.slice(0, 2).join(".")))].sort() },
      );
    }
    const perfil = lido.data;
    const instalacao = linha.instalacao;

    const canalId = await resolverCanal(db, ctx.orgId, perfil.onde.channel_session_id);

    // ── 0. o que a instalação muda no que é do cliente, antes de qualquer escrita ──
    // Três coisas: agente alterado à mão, o roteador que já atende o canal, e
    // o canal que já atende clientes (o ensaio fecha o número inteiro). As
    // três saem na MESMA recusa, para a confirmação da tela mostrar tudo de
    // uma vez — `forcar` vale para as três.
    const roteadorAntes = canalId ? await roteadorDoCanal(db, ctx.orgId, canalId, instalacao) : null;
    const roteadorEmConflito =
      roteadorAntes !== null &&
      temAlgoDeFora(roteadorAntes) &&
      assinaturaDoRoteador(roteadorAntes) !== instalacao.roteador_confirmado
        ? roteadorAntes
        : null;
    if (opcoes.forcar !== true) {
      const exame = await examinarAgentes(
        db,
        ctx.orgId,
        perfil,
        instalacao,
        await contextoDoQueExiste(db, ctx.orgId, instalacao),
      );
      const recusa = recusaAntesDeInstalar({
        forcar: false,
        editados: exame
          .filter((a) => a.situacao === "editado_a_mao")
          .map((a) => ({ papel: a.papel, agent_id: a.agent_id })),
        roteador: roteadorEmConflito,
        // Só quando esta instalação vai pôr o canal em ensaio: com a equipe
        // já ativa, instalar de novo não fecha o canal.
        canal: canalId && linha.modo === "ensaio" ? await canalEmProducao(db, ctx.orgId, canalId, instalacao) : null,
      });
      if (recusa) throw recusa;
    }

    const funilEscolhido = await resolverFunil(db, ctx.orgId, perfil.onde.pipeline_id);
    const criados: string[] = [];

    // ── 1. memória (fora da transação: a porta grava por conta própria) ─────
    await passoDaMemoria(db, portas, ctx, perfil);

    await db.query("begin");
    emTransacao = true;

    // ── 2 a 5. base, agenda, funil e régua ─────────────────────────────────
    const fonteId = await passoDaBase(db, portas, ctx, perfil, instalacao, criados);
    const { agenda, desativados } = await passoDaAgenda(db, ctx, perfil, instalacao, criados);
    const funil = await passoDoFunil(db, ctx, perfil, funilEscolhido);
    await db.query("commit");
    emTransacao = false;

    // A régua é publicada por função do banco, que precisa enxergar o ponteiro:
    // o ponteiro é gravado e confirmado antes da publicação.
    const reguaId = await passoDaRegua(db, portas, ctx, perfil, instalacao, criados);

    const contexto: ContextoDaInstalacao = {
      agenda,
      funil,
      knowledgeSourceIds: fonteId ? [fonteId] : [],
      reguaDeFollowupId: reguaId,
    };

    // ── 6. ensaio, ANTES do roteador e da publicação ───────────────────────
    // Num canal que já atende clientes, ligar o roteador e publicar primeiro
    // poria a equipe nova na frente de todos eles antes do ensaio existir — e,
    // se o ensaio falhasse depois, o canal ficaria aberto com ela. Aqui a
    // falha LANÇA: nada é ligado nem publicado, e instalar de novo retoma.
    // Só enquanto a equipe não foi ativada: instalar de novo com ela ativa não
    // fecha o canal.
    if (canalId && linha.modo === "ensaio") {
      await portas.porCanalEmEnsaio(ctx.orgId, canalId, perfil.onde.telefones_de_teste);
    }

    // ── 7. agentes e roteador, juntos ──────────────────────────────────────
    await db.query("begin");
    emTransacao = true;
    const preparados = await passoDosAgentes(db, portas, ctx, perfil, instalacao, contexto, canalId, criados);
    const routerId = canalId ? await passoDoRoteador(db, ctx, canalId, preparados, criados) : null;
    // O que ficou de alheio no roteador DEPOIS desta instalação é o que a
    // pessoa aceitou: enquanto não mudar, instalar de novo não pergunta outra vez.
    const agentesDaRodada = Object.fromEntries(
      preparados.map((p) => [
        p.papel.id,
        { agent_id: p.agentId, version_id: p.versionId, versao_do_papel: p.papel.versao, hash: p.hash },
      ]),
    );
    const roteadorDepois =
      canalId && routerId
        ? await roteadorDoCanal(db, ctx.orgId, canalId, { router_id: routerId, agentes: agentesDaRodada })
        : null;

    // O que foi criado fica gravado ANTES de publicar: se a publicação falhar
    // no meio, a próxima instalação reencontra tudo pelo id.
    const novaInstalacao: InstalacaoDaEquipe = {
      channel_session_id: canalId,
      router_id: routerId,
      pipeline_id: funil?.id ?? null,
      event_type_id: agenda?.id ?? null,
      knowledge_source_id: fonteId,
      followup_flow_pointer_id: reguaId,
      proposal_template_id: null,
      tipos_de_agenda_desativados: desativados,
      agentes: agentesDaRodada,
      roteador_confirmado:
        roteadorDepois !== null && temAlgoDeFora(roteadorDepois) ? assinaturaDoRoteador(roteadorDepois) : null,
      // A pausa é da tela, não da instalação: instalar de novo não a desfaz.
      pausa: instalacao.pausa,
    };
    await db.query(
      `update equipe_pronta_perfis
          set estado='instalado', instalado_em=now(), instalacao=$2::jsonb, updated_by=$3
        where organization_id=$1`,
      [ctx.orgId, JSON.stringify(novaInstalacao), ctx.userId],
    );
    await db.query("commit");
    emTransacao = false;

    // ── 8. publicação — recusa não derruba a instalação ────────────────────
    const agentes: AgenteNoResultado[] = [];
    for (const p of preparados) {
      let publicado = p.aPublicar === null;
      let motivo: string | null = null;
      if (p.aPublicar !== null) {
        const r = await portas.publicarAgente({ orgId: ctx.orgId, agentId: p.agentId, versionId: p.aPublicar });
        publicado = r.ok;
        if (!r.ok) motivo = r.code;
      }
      if (publicado) {
        // Sai da pausa de nascimento. Quem o cliente pausou à mão depois de
        // publicado não é religado aqui: só o que nasceu nesta rodada — e nem
        // ele, se a equipe está pausada pela tela.
        if (p.acao === "criado" && instalacao.pausa === null) {
          await db.query(
            "update ai_agents set paused_at=null where organization_id=$1 and id=$2 and published_version_id is not null",
            [ctx.orgId, p.agentId],
          );
        }
      }
      agentes.push({
        papel: p.papel.id,
        agent_id: p.agentId,
        version_id: p.versionId,
        acao: p.acao,
        publicado,
        motivo_sem_publicar: motivo,
      });
    }


    return { instalacao: novaInstalacao, agentes, criados };
  } catch (e) {
    erro = e instanceof Error ? e : new Error(String(e));
    if (emTransacao) await db.query("rollback").catch(() => undefined);
    throw erro;
  } finally {
    let descartar = false;
    if (travado) {
      try {
        await db.query("select pg_advisory_unlock(hashtextextended($1,0))", [trava]);
      } catch {
        descartar = true;
      }
    }
    // Quem falhou no meio de uma transação sai com erro, e o pool descarta a conexão.
    db.release(emTransacao || descartar ? (erro ?? true) : undefined);
  }
}
