/**
 * EQUIPE PRONTA — as OPÇÕES do passo "Onde instalar" e da agenda principal.
 *
 * O que a empresa JÁ tem e pode escolher: os canais de mensagem, os funis com
 * as etapas, e os tipos de agenda ativos. Só leitura, sempre filtrada pela
 * organização da sessão. A lista de canais usa o MESMO recorte do instalador
 * (`PROVIDERS_DE_MENSAGEM`, não arquivados): o que a tela oferece é o que o
 * instalador aceita.
 */
import type pg from "pg";

import { PROVIDERS_DE_MENSAGEM } from "@/lib/channels/capabilities";
import { nomeDoCanal } from "@/lib/channels/estado";

export interface OpcoesDaInstalacao {
  canais: { id: string; nome: string; conectado: boolean }[];
  funis: { id: string; nome: string; etapas: { id: string; nome: string; perdida: boolean }[] }[];
  tiposDeAgenda: { id: string; nome: string; duracao_minutos: number }[];
}

type ComQuery = Pick<pg.Pool, "query">;

export async function lerOpcoesDaInstalacao(pool: ComQuery, orgId: string): Promise<OpcoesDaInstalacao> {
  const [canais, funis, etapas, tipos] = await Promise.all([
    pool.query(
      // O nome é o de `nomeDoCanal`, o mesmo de Conexões: apelido, depois o
      // número. O identificador da sessão no provedor não é nome de nada e
      // não sai da camada de canais.
      `select id, display_name, phone_number, status
         from channel_sessions
        where organization_id=$1 and archived_at is null and provider = any($2::text[])
        order by created_at`,
      [orgId, [...PROVIDERS_DE_MENSAGEM]],
    ),
    pool.query(
      "select id, name from crm_pipelines where organization_id=$1 and not is_archived order by position, created_at",
      [orgId],
    ),
    pool.query(
      `select id, pipeline_id, name, is_lost from crm_stages
        where organization_id=$1 and not is_archived order by position`,
      [orgId],
    ),
    pool.query(
      `select id, name, duration_minutes from calendar_event_types
        where organization_id=$1 and is_active order by position, created_at`,
      [orgId],
    ),
  ]);
  return {
    canais: canais.rows.map((c) => ({
      id: String(c.id),
      nome: nomeDoCanal({ display_name: c.display_name, phone_number: c.phone_number }),
      conectado: c.status === "WORKING",
    })),
    funis: funis.rows.map((f) => ({
      id: String(f.id),
      nome: String(f.name),
      etapas: etapas.rows
        .filter((e) => e.pipeline_id === f.id)
        .map((e) => ({ id: String(e.id), nome: String(e.name), perdida: e.is_lost === true })),
    })),
    tiposDeAgenda: tipos.rows.map((t) => ({
      id: String(t.id),
      nome: String(t.name),
      duracao_minutos: Number(t.duration_minutes),
    })),
  };
}
