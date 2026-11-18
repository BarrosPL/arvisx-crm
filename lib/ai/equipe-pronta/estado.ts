/**
 * O ESTADO DA EQUIPE PRONTA — o que a tela mostra e o que libera o Ativar.
 *
 * Três coisas, calculadas na hora da leitura (nada disto é coluna):
 *
 *   • como está cada agente em relação ao que o renderizador geraria agora
 *     (`examinarAgentes`, a MESMA conta do instalador);
 *   • se há versão nova de algum papel no código — `atualizacao_disponivel`,
 *     com a nota do que mudou. Aplicar é pelo instalador; nunca sozinho;
 *   • o CHECKLIST de prontidão. Ativar só com ele inteiro verde.
 *
 * Cada item do checklist tem um texto para quem usa e o link da tela que
 * resolve. Item que não se aplica à empresa (ela não agenda, não usa proposta,
 * não informa preço) sai da lista em vez de aparecer verde por nada.
 */
import type pg from "pg";

import { MODELOS_BASE } from "@/lib/propostas/modelos/catalogo-base";
import {
  oQueFaltaNoRascunho,
  type InstalacaoDaEquipe,
  type PerfilDoNegocio,
} from "@/lib/schemas/equipe-pronta";
import { PAPEIS } from "./index";
import {
  contextoDoQueExiste,
  examinarAgentes,
  lerPerfil,
  type AgenteExaminado,
} from "./instalar";
import { PASSOS_DA_EQUIPE, type PapelId } from "./tipos";

/** O slug do modelo genérico em `lib/propostas/modelos/catalogo-base.ts`. */
export const MODELO_DE_PROPOSTA = "proposta_comercial";

/** Quantos dias à frente a agenda principal precisa ter horário livre. */
export const DIAS_DE_AGENDA_NO_CHECKLIST = 14;

export interface ItemDoChecklist {
  id:
    | "credencial_de_ia"
    | "base_indexada"
    | "agenda_com_horario"
    | "catalogo_com_preco"
    | "whatsapp_conectado"
    | "modelo_de_proposta"
    | "funil_marcado"
    | "agentes_publicados";
  ok: boolean;
  /** O que falta, ou o que está pronto — para quem usa, sem termo técnico. */
  texto: string;
  /** A tela que resolve. */
  link: string;
}

export interface AgenteNoEstado extends AgenteExaminado {
  nome: string;
  descricao: string;
  versao_do_papel: number;
  /** O texto que o renderizador geraria agora — a tela de revisão o mostra. */
  atualizacao_disponivel: { de: number; para: number; notas: string } | null;
}

export interface EstadoDaEquipe {
  respostas: unknown;
  estado: "rascunho" | "instalado";
  modo: "ensaio" | "ativo";
  instalado_em: string | null;
  /** O questionário já dá para instalar? */
  perfil_completo: boolean;
  /** Os campos obrigatórios que faltam (`bloco.campo`). */
  faltam: string[];
  agentes: AgenteNoEstado[];
  atualizacao_disponivel: { papel: PapelId; de: number; para: number; notas: string }[];
  checklist: ItemDoChecklist[];
  pode_ativar: boolean;
}

/** O que o estado pergunta ao mundo de fora. */
export interface PortasDoEstado {
  /** A instalação tem chave de IA própria (do `.env`) que serve à organização? */
  temChaveDeIaDaInstalacao(): Promise<boolean>;
  temChaveDeEmbedding(orgId: string): Promise<boolean>;
  /** O tipo de agenda tem ao menos um horário livre nos próximos N dias? */
  agendaTemHorario(orgId: string, eventTypeId: string, dias: number): Promise<boolean>;
}

type Db = pg.PoolClient;

async function itemDaCredencial(db: Db, orgId: string, portas: PortasDoEstado): Promise<ItemDoChecklist> {
  const { rows } = await db.query(
    "select 1 from ai_provider_credentials where organization_id=$1 and is_active and validated_at is not null limit 1",
    [orgId],
  );
  const ok = rows.length > 0 || (await portas.temChaveDeIaDaInstalacao());
  return {
    id: "credencial_de_ia",
    ok,
    texto: ok
      ? "A chave de IA está cadastrada e validada."
      : "Cadastre e valide uma chave de IA. Sem ela os agentes não respondem.",
    link: "/app/ai/providers",
  };
}

async function itemDaBase(
  db: Db,
  orgId: string,
  instalacao: InstalacaoDaEquipe,
  portas: PortasDoEstado,
): Promise<ItemDoChecklist> {
  const link = "/app/ai/knowledge/sources";
  if (!instalacao.knowledge_source_id) {
    return {
      id: "base_indexada",
      ok: false,
      texto:
        "Preencha as perguntas frequentes e as formas de pagamento no questionário e instale de novo: sem elas os agentes não têm de onde responder.",
      link: "/app/ai/equipe-pronta",
    };
  }
  const { rows } = await db.query(
    "select last_index_status, chunks_count from ai_knowledge_sources where organization_id=$1 and id=$2 and status <> 'archived'",
    [orgId, instalacao.knowledge_source_id],
  );
  const fonte = rows[0];
  const ok = fonte?.last_index_status === "success" && Number(fonte?.chunks_count ?? 0) > 0;
  if (ok) return { id: "base_indexada", ok, texto: "A base de conhecimento está preparada.", link };
  if (!(await portas.temChaveDeEmbedding(orgId))) {
    return {
      id: "base_indexada",
      ok: false,
      texto:
        "Falta uma chave para preparar a base de conhecimento (OpenAI, OpenRouter ou Google). Cadastre a chave e a base é preparada sozinha.",
      link: "/app/ai/providers",
    };
  }
  return {
    id: "base_indexada",
    ok: false,
    texto:
      fonte?.last_index_status === "failed"
        ? "A base de conhecimento não pôde ser preparada. Abra a base e tente preparar de novo."
        : "A base de conhecimento ainda está sendo preparada. Aguarde alguns instantes e atualize.",
    link,
  };
}

async function itemDaAgenda(
  orgId: string,
  instalacao: InstalacaoDaEquipe,
  portas: PortasDoEstado,
): Promise<ItemDoChecklist | null> {
  if (!instalacao.event_type_id) return null;
  const ok = await portas.agendaTemHorario(orgId, instalacao.event_type_id, DIAS_DE_AGENDA_NO_CHECKLIST);
  return {
    id: "agenda_com_horario",
    ok,
    texto: ok
      ? `A agenda tem horário livre nos próximos ${DIAS_DE_AGENDA_NO_CHECKLIST} dias.`
      : `A agenda não tem horário livre nos próximos ${DIAS_DE_AGENDA_NO_CHECKLIST} dias. Defina o responsável e os dias de atendimento.`,
    link: "/app/agenda",
  };
}

async function itemDoCatalogo(db: Db, orgId: string, perfil: PerfilDoNegocio): Promise<ItemDoChecklist | null> {
  if (!perfil.oferta.informa_preco_por_mensagem) return null;
  const { rows } = await db.query(
    "select 1 from catalog_products where organization_id=$1 and ativo and preco_cents > 0 limit 1",
    [orgId],
  );
  const ok = rows.length > 0;
  return {
    id: "catalogo_com_preco",
    ok,
    texto: ok
      ? "O catálogo tem item com preço."
      : "Você escolheu informar preço por mensagem, mas o catálogo não tem nenhum item com preço. Cadastre ao menos um.",
    link: "/app/products",
  };
}

async function itemDoWhatsapp(db: Db, orgId: string, instalacao: InstalacaoDaEquipe): Promise<ItemDoChecklist> {
  const link = "/app/connections";
  if (!instalacao.channel_session_id) {
    return {
      id: "whatsapp_conectado",
      ok: false,
      texto: "Conecte o WhatsApp da empresa e instale de novo.",
      link,
    };
  }
  const { rows } = await db.query(
    "select status from channel_sessions where organization_id=$1 and id=$2 and archived_at is null",
    [orgId, instalacao.channel_session_id],
  );
  const ok = rows[0]?.status === "WORKING";
  return {
    id: "whatsapp_conectado",
    ok,
    texto: ok ? "O WhatsApp está conectado." : "O WhatsApp não está conectado. Reconecte o número em Conexões.",
    link,
  };
}

async function itemDaProposta(db: Db, orgId: string, perfil: PerfilDoNegocio): Promise<ItemDoChecklist | null> {
  if (!perfil.proposta.usa) return null;
  // O modelo genérico mora no código (catálogo base). Só deixa de valer se a
  // empresa tiver uma cópia dele DESATIVADA.
  const { rows } = await db.query(
    "select is_active from proposal_templates where organization_id=$1 and slug=$2 order by version desc limit 1",
    [orgId, MODELO_DE_PROPOSTA],
  );
  const ok = Object.hasOwn(MODELOS_BASE, MODELO_DE_PROPOSTA) && rows[0]?.is_active !== false;
  return {
    id: "modelo_de_proposta",
    ok,
    texto: ok
      ? 'O modelo "Proposta comercial" está disponível.'
      : 'O modelo "Proposta comercial" está desativado nesta empresa. Reative-o nos modelos de proposta.',
    link: "/app/settings/tenant/proposals/modelos",
  };
}

async function itemDoFunil(
  db: Db,
  orgId: string,
  perfil: PerfilDoNegocio,
  instalacao: InstalacaoDaEquipe,
): Promise<ItemDoChecklist> {
  const link = "/app/settings/tenant/pipelines";
  if (!instalacao.pipeline_id) {
    return { id: "funil_marcado", ok: false, texto: "Escolha o funil da equipe e instale de novo.", link };
  }
  const exigidos = [
    PASSOS_DA_EQUIPE.qualificado,
    PASSOS_DA_EQUIPE.perdido,
    ...(perfil.proposta.usa ? [PASSOS_DA_EQUIPE.proposta] : []),
  ];
  const { rows } = await db.query(
    `select agent_stage_hint from crm_stages
      where organization_id=$1 and pipeline_id=$2 and not is_archived and agent_stage_hint = any($3::text[])`,
    [orgId, instalacao.pipeline_id, exigidos],
  );
  const marcados = new Set(rows.map((r) => String(r.agent_stage_hint)));
  const ok = exigidos.every((h) => marcados.has(h));
  return {
    id: "funil_marcado",
    ok,
    texto: ok
      ? "O funil tem as etapas da equipe marcadas."
      : "Marque no funil qual etapa é a de qualificado, a de proposta e a de perdido, para os agentes moverem os negócios.",
    link,
  };
}

function itemDosAgentes(agentes: readonly AgenteExaminado[]): ItemDoChecklist {
  const ok = agentes.length === PAPEIS.length && agentes.every((a) => a.publicado);
  return {
    id: "agentes_publicados",
    ok,
    texto: ok
      ? "Os quatro agentes estão publicados."
      : "Há agente que ainda não foi publicado. Resolva os itens acima e instale de novo.",
    link: "/app/ai/agents",
  };
}

export async function lerEstadoDaEquipe(
  pool: pg.Pool,
  portas: PortasDoEstado,
  orgId: string,
): Promise<EstadoDaEquipe> {
  const db = await pool.connect();
  try {
    const linha = await lerPerfil(db, orgId);
    const respostas = linha?.respostas ?? {};
    const lido = oQueFaltaNoRascunho(respostas);
    const instalacao = linha?.instalacao ?? {
      channel_session_id: null,
      router_id: null,
      pipeline_id: null,
      event_type_id: null,
      knowledge_source_id: null,
      followup_flow_pointer_id: null,
      proposal_template_id: null,
      tipos_de_agenda_desativados: [],
      agentes: {},
    };
    const estado = linha?.estado === "instalado" ? "instalado" : "rascunho";

    // Sem perfil completo não há o que comparar: os agentes saem como "não
    // instalados" e o checklist só diz o que já dá para dizer.
    let exame: AgenteExaminado[] = PAPEIS.map((p) => ({
      papel: p.id,
      agent_id: instalacao.agentes[p.id]?.agent_id ?? null,
      situacao: "nao_instalado" as const,
      publicado: false,
      versao_do_papel_instalada: instalacao.agentes[p.id]?.versao_do_papel ?? null,
    }));
    const checklist: ItemDoChecklist[] = [];

    if (lido.ok) {
      exame = await examinarAgentes(
        db,
        orgId,
        lido.perfil,
        instalacao,
        await contextoDoQueExiste(db, orgId, instalacao),
      );
      const itens = await Promise.all([
        itemDaCredencial(db, orgId, portas),
        itemDaBase(db, orgId, instalacao, portas),
        itemDaAgenda(orgId, instalacao, portas),
        itemDoCatalogo(db, orgId, lido.perfil),
        itemDoWhatsapp(db, orgId, instalacao),
        itemDaProposta(db, orgId, lido.perfil),
        itemDoFunil(db, orgId, lido.perfil, instalacao),
      ]);
      for (const item of itens) if (item !== null) checklist.push(item);
      checklist.push(itemDosAgentes(exame));
    }

    const agentes: AgenteNoEstado[] = PAPEIS.map((papel) => {
      const a = exame.find((x) => x.papel === papel.id)!;
      const instalada = a.versao_do_papel_instalada;
      return {
        ...a,
        nome: papel.nomePadrao,
        descricao: papel.descricao,
        versao_do_papel: papel.versao,
        atualizacao_disponivel:
          instalada !== null && instalada < papel.versao
            ? { de: instalada, para: papel.versao, notas: papel.notasDaVersao }
            : null,
      };
    });

    return {
      respostas,
      estado,
      modo: linha?.modo === "ativo" ? "ativo" : "ensaio",
      instalado_em: linha?.instalado_em ?? null,
      perfil_completo: lido.ok,
      faltam: lido.ok ? [] : lido.faltam,
      agentes,
      atualizacao_disponivel: agentes.flatMap((a) =>
        a.atualizacao_disponivel ? [{ papel: a.papel, ...a.atualizacao_disponivel }] : [],
      ),
      checklist,
      pode_ativar: estado === "instalado" && checklist.length > 0 && checklist.every((i) => i.ok),
    };
  } finally {
    db.release();
  }
}
