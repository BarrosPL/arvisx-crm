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
import { gatilhosQueFaltam, type GatilhoQueFalta } from "./gatilhos/fluxos";
import { renderizarAgente } from "./renderizar";
import { mapaPelasMarcas, type ChaveDeEtapa } from "./etapas";
import type { PapelId } from "./tipos";

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
  /**
   * O texto que o renderizador geraria AGORA para este agente — é o que a tela
   * de revisão mostra antes de instalar. `null` enquanto o questionário não
   * tem o mínimo. Antes da primeira instalação o bloco "Esta empresa" ainda não
   * traz agenda, funil nem base: eles são criados pelo instalador.
   */
  texto_gerado: string | null;
  atualizacao_disponivel: { de: number; para: number; notas: string } | null;
}

export interface EstadoDaEquipe {
  respostas: unknown;
  estado: "rascunho" | "instalado";
  modo: "ensaio" | "ativo";
  /**
   * A equipe foi pausada pela tela: os quatro agentes estão parados, e o
   * acesso da IA no canal ficou como estava (outros agentes do mesmo número
   * seguem atendendo). Independe do modo.
   */
  pausada: boolean;
  instalado_em: string | null;
  /** O questionário já dá para instalar? */
  perfil_completo: boolean;
  /** Os campos obrigatórios que faltam (`bloco.campo`). */
  faltam: string[];
  agentes: AgenteNoEstado[];
  atualizacao_disponivel: { papel: PapelId; de: number; para: number; notas: string }[];
  /**
   * Os gatilhos que a instalação criaria agora e ainda não existem (equipe
   * instalada antes deles, ou uma peça que sumiu). Vazio = nada a fazer, e
   * sempre vazio enquanto a equipe não está instalada. Não entra no checklist:
   * a falta deles não impede ativar, só pede instalar de novo.
   */
  gatilhos_que_faltam: GatilhoQueFalta[];
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
  // As etapas que a equipe precisa para trabalhar. Depois de instalar com a
  // versão que cria etapas, todas existem; a instalação anterior tem só as
  // marcas do funil, e por isso é lida por elas.
  const exigidas: ChaveDeEtapa[] = [
    "qualificado",
    "perdido",
    ...(perfil.proposta.usa ? (["proposta_enviada"] as const) : []),
  ];
  const { rows } = await db.query(
    `select id, name, agent_stage_hint, is_won, is_lost from crm_stages
      where organization_id=$1 and pipeline_id=$2 and not is_archived`,
    [orgId, instalacao.pipeline_id],
  );
  const vivas = rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    agent_stage_hint: r.agent_stage_hint === null ? null : String(r.agent_stage_hint),
    is_won: r.is_won === true,
    is_lost: r.is_lost === true,
  }));
  const mapa = Object.keys(instalacao.etapas).length > 0 ? instalacao.etapas : mapaPelasMarcas(vivas);
  const ok = exigidas.every((chave) => vivas.some((e) => e.id === mapa[chave]));
  return {
    id: "funil_marcado",
    ok,
    texto: ok
      ? "O funil tem as etapas da equipe."
      : "Faltam etapas da equipe no funil. Instale de novo: a instalação cria as que faltam, sem mexer nas suas.",
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
      etapas: {},
      etapas_criadas: [],
      tipos_de_agenda_desativados: [],
      agentes: {},
      gatilhos: { fluxo_de_falta_id: null, fluxo_de_proposta_parada_id: null, regra_de_proposta_parada_id: null },
      roteador_confirmado: null,
      pausa: null,
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
    const textos = new Map<PapelId, string>();

    if (lido.ok) {
      const contexto = await contextoDoQueExiste(db, orgId, instalacao);
      exame = await examinarAgentes(db, orgId, lido.perfil, instalacao, contexto);
      for (const papel of PAPEIS) {
        textos.set(papel.id, renderizarAgente(papel, lido.perfil, contexto).system_prompt);
      }
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
        texto_gerado: textos.get(papel.id) ?? null,
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
      pausada: estado === "instalado" && instalacao.pausa !== null,
      instalado_em: linha?.instalado_em ?? null,
      perfil_completo: lido.ok,
      faltam: lido.ok ? [] : lido.faltam,
      agentes,
      atualizacao_disponivel: agentes.flatMap((a) =>
        a.atualizacao_disponivel ? [{ papel: a.papel, ...a.atualizacao_disponivel }] : [],
      ),
      gatilhos_que_faltam: estado === "instalado" && lido.ok ? gatilhosQueFaltam(lido.perfil, instalacao) : [],
      checklist,
      pode_ativar: estado === "instalado" && checklist.length > 0 && checklist.every((i) => i.ok),
    };
  } finally {
    db.release();
  }
}
