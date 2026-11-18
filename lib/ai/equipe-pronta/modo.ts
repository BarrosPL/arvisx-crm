/**
 * ENSAIO ↔ ATIVO — quem pode falar com a equipe pronta — e a PAUSA.
 *
 * A pausa é outra coisa: para os quatro agentes (`paused_at`) e não toca o
 * acesso da IA no canal. Ver `pausarEquipePronta`.
 *
 *   • ENSAIO: o canal fica em pré-lançamento, e só os telefones de teste do
 *     questionário chegam aos agentes. É como toda instalação nasce.
 *   • ATIVO: o canal abre para todos — com os filtros normais do produto
 *     (grupo, o próprio número, contato da equipe) valendo como sempre.
 *
 * O mecanismo é o acesso da IA no canal que já existe
 * (`fn_configurar_pre_go_live_canal`, a mesma função de
 * `PATCH /api/v1/channel-sessions/:id/ai-access`). Esse acesso é só por
 * telefone: não há etiqueta de teste no canal, e a equipe pronta não inventa uma.
 *
 * Ativar exige o checklist inteiro verde — quem decide é `lerEstadoDaEquipe`,
 * e a conferência é refeita AQUI, no servidor, na hora de ativar: o botão da
 * tela não é a trava.
 */
import type pg from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";

import { perfilSchema } from "@/lib/schemas/equipe-pronta";
import { lerEstadoDaEquipe, type ItemDoChecklist, type PortasDoEstado } from "./estado";
import { EquipeProntaError, lerPerfil } from "./instalar";

type ModoDoCanal = "open" | "pre_go_live";

async function configurarCanal(
  admin: SupabaseClient,
  orgId: string,
  canalId: string,
  modo: ModoDoCanal,
  telefones: string[],
): Promise<void> {
  const { data, error } = await admin.rpc("fn_configurar_pre_go_live_canal", {
    p_org: orgId,
    p_canal: canalId,
    p_modo: modo,
    p_numeros: telefones,
  });
  if (error || data !== 1) {
    throw new EquipeProntaError(
      "canal_nao_configurado",
      "Não foi possível mudar o acesso da IA no canal. Confira a conexão em Conexões.",
      error ? 500 : 404,
    );
  }
}

async function gravarModo(pool: pg.Pool, orgId: string, userId: string, modo: "ensaio" | "ativo"): Promise<void> {
  await pool.query(
    "update equipe_pronta_perfis set modo=$2, updated_by=$3 where organization_id=$1",
    [orgId, modo, userId],
  );
}

export async function ativarEquipePronta(
  pool: pg.Pool,
  admin: SupabaseClient,
  portas: PortasDoEstado,
  ctx: { orgId: string; userId: string },
): Promise<{ modo: "ativo"; channel_session_id: string }> {
  const estado = await lerEstadoDaEquipe(pool, portas, ctx.orgId);
  if (estado.estado !== "instalado") {
    throw new EquipeProntaError("nao_instalada", "Instale a equipe antes de ativar.", 409);
  }
  if (!estado.pode_ativar) {
    const pendentes: ItemDoChecklist[] = estado.checklist.filter((i) => !i.ok);
    throw new EquipeProntaError(
      "checklist_pendente",
      "Ainda há itens pendentes. Resolva todos antes de ativar.",
      409,
      { pendentes: pendentes.map((i) => ({ id: i.id, texto: i.texto, link: i.link })) },
    );
  }
  const linha = await lerPerfil(pool, ctx.orgId);
  const canalId = linha?.instalacao.channel_session_id;
  if (!canalId) {
    throw new EquipeProntaError("sem_canal", "Conecte o WhatsApp e instale de novo antes de ativar.", 409);
  }
  // Abrir o canal preserva a lista de teste guardada: voltar ao ensaio não a perde.
  const perfil = perfilSchema.safeParse(linha.respostas);
  await configurarCanal(
    admin,
    ctx.orgId,
    canalId,
    "open",
    perfil.success ? perfil.data.onde.telefones_de_teste : [],
  );
  await gravarModo(pool, ctx.orgId, ctx.userId, "ativo");
  // Ativar uma equipe pausada também a religa: "ativo" com os agentes parados
  // seria um estado que a tela não saberia explicar.
  if (linha.instalacao.pausa !== null) {
    await emTransacao(pool, (db) => religarAgentes(db, ctx.orgId));
  }
  return { modo: "ativo", channel_session_id: canalId };
}

/**
 * Religa os agentes que a PAUSA DA EQUIPE parou, e só eles. Quem o cliente
 * pausou à mão antes da pausa continua pausado; agente sem versão publicada
 * também (é a pausa de nascimento, que só a publicação desfaz).
 */
async function religarAgentes(db: pg.PoolClient, orgId: string): Promise<string[]> {
  const linha = await lerPerfil(db, orgId);
  const pausados = linha?.instalacao.pausa?.agentes ?? [];
  const { rows } = await db.query(
    `update ai_agents set paused_at=null, updated_at=now()
      where organization_id=$1 and id = any($2::uuid[]) and published_version_id is not null
      returning id`,
    [orgId, pausados],
  );
  await db.query(
    "update equipe_pronta_perfis set instalacao = instalacao || '{\"pausa\":null}'::jsonb where organization_id=$1",
    [orgId],
  );
  return rows.map((r) => String(r.id));
}

async function emTransacao<T>(pool: pg.Pool, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("begin");
    const r = await fn(db);
    await db.query("commit");
    return r;
  } catch (e) {
    await db.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    db.release();
  }
}

/**
 * PAUSAR — para os quatro agentes da equipe, e SÓ eles.
 *
 * ⚠️ O acesso da IA no canal NÃO muda. A primeira versão punha o canal inteiro
 * em pré-lançamento, e isso calava todo outro agente do mesmo número — pausar
 * a equipe pronta não pode parar o que não é dela. Escolha registrada na
 * revisão do PR #8: `paused_at` nos agentes da equipe, canal como estava.
 *
 * O modo (ensaio ou ativo) também não muda: ele diz QUEM pode falar com a
 * equipe; a pausa diz se ela responde. Retomar volta ao modo em que estava.
 *
 * Quem já estava pausado à mão não entra na lista da pausa — retomar não o
 * religa.
 */
export async function pausarEquipePronta(
  pool: pg.Pool,
  ctx: { orgId: string; userId: string },
): Promise<{ pausada: true; modo: "ensaio" | "ativo"; agentes_pausados: string[] }> {
  return emTransacao(pool, async (db) => {
    const linha = await lerPerfil(db, ctx.orgId);
    if (!linha || linha.estado !== "instalado") {
      throw new EquipeProntaError("nao_instalada", "A equipe ainda não foi instalada.", 409);
    }
    const daEquipe = Object.values(linha.instalacao.agentes).map((a) => a.agent_id);
    const { rows } = await db.query(
      `update ai_agents set paused_at=now(), updated_at=now()
        where organization_id=$1 and id = any($2::uuid[]) and paused_at is null
        returning id`,
      [ctx.orgId, daEquipe],
    );
    // Pausar duas vezes soma, não troca: a segunda não acha ninguém para
    // pausar, e a lista da primeira é a que retomar precisa.
    const anteriores = linha.instalacao.pausa?.agentes ?? [];
    const agentes = [...new Set([...anteriores, ...rows.map((r) => String(r.id))])].sort();
    const pausa = { em: linha.instalacao.pausa?.em ?? new Date().toISOString(), agentes };
    await db.query(
      `update equipe_pronta_perfis
          set instalacao = instalacao || jsonb_build_object('pausa', $2::jsonb), updated_by=$3
        where organization_id=$1`,
      [ctx.orgId, JSON.stringify(pausa), ctx.userId],
    );
    return { pausada: true as const, modo: linha.modo === "ativo" ? "ativo" : "ensaio", agentes_pausados: agentes };
  });
}

/** RETOMAR — desfaz a pausa da equipe. O canal e o modo ficam como estão. */
export async function retomarEquipePronta(
  pool: pg.Pool,
  ctx: { orgId: string; userId: string },
): Promise<{ pausada: false; modo: "ensaio" | "ativo"; agentes_religados: string[] }> {
  return emTransacao(pool, async (db) => {
    const linha = await lerPerfil(db, ctx.orgId);
    if (!linha || linha.estado !== "instalado") {
      throw new EquipeProntaError("nao_instalada", "A equipe ainda não foi instalada.", 409);
    }
    const religados = await religarAgentes(db, ctx.orgId);
    await db.query("update equipe_pronta_perfis set updated_by=$2 where organization_id=$1", [
      ctx.orgId,
      ctx.userId,
    ]);
    return { pausada: false as const, modo: linha.modo === "ativo" ? "ativo" : "ensaio", agentes_religados: religados };
  });
}
