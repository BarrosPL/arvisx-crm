/**
 * ENSAIO ↔ ATIVO — quem pode falar com a equipe pronta.
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
  return { modo: "ativo", channel_session_id: canalId };
}

export async function pausarEquipePronta(
  pool: pg.Pool,
  admin: SupabaseClient,
  ctx: { orgId: string; userId: string },
): Promise<{ modo: "ensaio"; channel_session_id: string | null }> {
  const linha = await lerPerfil(pool, ctx.orgId);
  if (!linha || linha.estado !== "instalado") {
    throw new EquipeProntaError("nao_instalada", "A equipe ainda não foi instalada.", 409);
  }
  const canalId = linha.instalacao.channel_session_id;
  if (canalId) {
    const perfil = perfilSchema.safeParse(linha.respostas);
    await configurarCanal(
      admin,
      ctx.orgId,
      canalId,
      "pre_go_live",
      perfil.success ? perfil.data.onde.telefones_de_teste : [],
    );
  }
  await gravarModo(pool, ctx.orgId, ctx.userId, "ensaio");
  return { modo: "ensaio", channel_session_id: canalId };
}
