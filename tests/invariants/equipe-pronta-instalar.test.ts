import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { GOV_ADMIN, seedGov } from "./gov-helpers";

vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

import { PAPEIS } from "@/lib/ai/equipe-pronta";
import { lerEstadoDaEquipe, type PortasDoEstado } from "@/lib/ai/equipe-pronta/estado";
import { pausarEquipePronta, retomarEquipePronta } from "@/lib/ai/equipe-pronta/modo";
import {
  EquipeProntaError,
  NOME_DA_FONTE,
  NOME_DO_ROTEADOR,
  instalarEquipePronta,
  lerPerfil,
  type PortasDoInstalador,
} from "@/lib/ai/equipe-pronta/instalar";
import {
  NOME_DA_REGRA_DE_PROPOSTA_PARADA,
  NOME_DO_FLUXO_DE_FALTA,
  NOME_DO_FLUXO_DE_PROPOSTA_PARADA,
} from "@/lib/ai/equipe-pronta/gatilhos/fluxos";
import { NOME_DA_REGUA } from "@/lib/ai/equipe-pronta/regua";
import { agenteDaEquipeProntaPodeAgir } from "@/lib/cobranca/equipe-pronta-no-plano";

/**
 * O INSTALADOR DA EQUIPE DE IA PRONTA, CONTRA UM POSTGRES DE VERDADE.
 *
 * O que só o banco prova, e um dublê não:
 *
 *   1. a primeira instalação cria as peças que diz criar, todas na organização
 *      certa, e os agentes são PUBLICADOS pela função de produção
 *      (`fn_publish_ai_agent_version`), que exige roteador e canal conectado;
 *   2. ⭐ instalar DUAS vezes não duplica nada — nem agente, nem versão, nem
 *      membro do roteador, nem fonte, nem régua, nem versão de memória;
 *   3. mudar uma resposta gera UMA versão nova por agente, no mesmo agente;
 *   4. ⭐ agente editado à mão não é sobrescrito sem `forcar`: a instalação
 *      recusa com a lista e NADA é gravado; com `forcar`, sobrescreve;
 *   5. duas organizações não se tocam;
 *   6. a marca em `ai_agents.config.equipe_pronta` é o que a trava de plano lê.
 *
 * As portas (o que em produção fala com storage e PostgREST) são implementadas
 * aqui em SQL sobre o MESMO banco, chamando as MESMAS funções — sem processo
 * HTTP e sem provedor de IA.
 */
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 5,
});

beforeAll(() => seedGov());
afterAll(() => pool.end());

interface Contagem {
  avisos: number;
  memorias: number;
  reguas: number;
  publicacoes: number;
}

function portas(contagem: Contagem): PortasDoInstalador {
  return {
    async guardarTextoDaBase(orgId) {
      return `${orgId}/${randomUUID()}.md`;
    },
    async avisarQueAFonteMudou() {
      contagem.avisos += 1;
    },
    async publicarMemoria(orgId, userId, conteudo) {
      contagem.memorias += 1;
      const versao = await pool.query(
        `insert into org_memory_versions (organization_id, version_number, content, created_by)
         select $1, coalesce(max(version_number), 0) + 1, $2, $3 from org_memory_versions where organization_id=$1
         returning id`,
        [orgId, conteudo, userId],
      );
      await pool.query(
        `insert into org_memory_pointers (organization_id, version_id) values ($1, $2)
         on conflict (organization_id) do update set version_id = excluded.version_id, updated_at = now()`,
        [orgId, versao.rows[0].id],
      );
    },
    async publicarRegua({ orgId, pointerId, grafo, userId }) {
      contagem.reguas += 1;
      await pool.query("select fn_publish_followup_flow_version($1,$2,$3::jsonb,$4)", [
        orgId,
        pointerId,
        JSON.stringify(grafo),
        userId,
      ]);
    },
    async publicarAgente({ orgId, agentId, versionId }) {
      contagem.publicacoes += 1;
      try {
        await pool.query("select * from fn_publish_ai_agent_version($1,$2,$3,$4)", [
          orgId,
          agentId,
          versionId,
          true,
        ]);
        return { ok: true };
      } catch (erro) {
        return { ok: false, code: (erro as Error).message };
      }
    },
    async porCanalEmEnsaio(orgId, canalId, telefones) {
      await pool.query("select fn_configurar_pre_go_live_canal($1,$2,$3,$4::text[])", [
        orgId,
        canalId,
        "pre_go_live",
        telefones,
      ]);
    },
    async escolherModelo(db) {
      const { rows } = await db.query(
        "select model_id from ai_models where provider='openai' and deprecated_at is null and supports_tools order by is_default_for_provider desc, model_id limit 1",
      );
      if (!rows[0]) throw new Error("fixture: o baseline não semeou modelo da openai com ferramentas");
      return { provider: "openai", model: String(rows[0].model_id), credential_id: null };
    },
  };
}

const portasDoEstado: PortasDoEstado = {
  temChaveDeIaDaInstalacao: async () => true,
  temChaveDeEmbedding: async () => true,
  agendaTemHorario: async () => true,
};

const RESPOSTAS = {
  negocio: { nome: "Empresa de Teste", o_que_faz: "Presta um serviço qualquer para pessoas e empresas." },
  atendente: { nome: "Ana", tom: "profissional", como_chamar: "cliente" },
  primeiro_passo: { tipo: "agendar", agenda: { modo: "criar", nome: "Primeira conversa", duracao_minutos: 30 } },
  qualificacao: { perguntas: ["O que você procura?"] },
  regras: { formas_de_pagamento: "Pix e cartão." },
  faq: { texto: "Atendemos de segunda a sexta." },
  onde: { telefones_de_teste: ["+5511999990001"] },
};

async function novaOrganizacao(respostas: unknown = RESPOSTAS) {
  const org = randomUUID();
  const canal = randomUUID();
  await pool.query(
    "insert into organizations (id, slug, legal_name, display_name) values ($1, $2, 'Equipe pronta', 'Equipe pronta')",
    [org, `equipe-pronta-${org}`],
  );
  await pool.query(
    "insert into channel_sessions (id, organization_id, provider, waha_session_name, status, webhook_secret_encrypted) values ($1, $2, 'waha', $3, 'WORKING', decode('00','hex'))",
    [canal, org, `equipe-pronta-${canal}`],
  );
  await pool.query(
    "insert into equipe_pronta_perfis (organization_id, respostas, updated_by) values ($1, $2::jsonb, $3)",
    [org, JSON.stringify(respostas), GOV_ADMIN],
  );
  return { org, canal, ctx: { orgId: org, userId: GOV_ADMIN } };
}

/** Quantas linhas de cada peça a organização tem — o retrato que não pode crescer. */
async function retrato(org: string) {
  const conta = async (sql: string) => Number((await pool.query(sql, [org])).rows[0].n);
  return {
    agentes: await conta("select count(*) n from ai_agents where organization_id=$1 and archived_at is null"),
    versoes: await conta("select count(*) n from ai_agent_versions where organization_id=$1"),
    roteadores: await conta("select count(*) n from ai_routers where organization_id=$1"),
    membros: await conta("select count(*) n from ai_router_members where organization_id=$1"),
    fontes: await conta("select count(*) n from ai_knowledge_sources where organization_id=$1"),
    reguas: await conta("select count(*) n from followup_flow_pointers where organization_id=$1"),
    versoes_da_regua: await conta("select count(*) n from followup_flow_versions where organization_id=$1"),
    tipos_de_agenda: await conta("select count(*) n from calendar_event_types where organization_id=$1"),
    memorias: await conta("select count(*) n from org_memory_versions where organization_id=$1"),
    perfis: await conta("select count(*) n from equipe_pronta_perfis where organization_id=$1"),
    etapas: await conta("select count(*) n from crm_stages where organization_id=$1"),
  };
}

const zero = (): Contagem => ({ avisos: 0, memorias: 0, reguas: 0, publicacoes: 0 });

describe("a primeira instalação", () => {
  it("⭐ cria as peças, publica os quatro agentes e deixa o canal em ensaio", async () => {
    const { org, canal, ctx } = await novaOrganizacao();
    const r = await instalarEquipePronta(pool, portas(zero()), ctx);

    // Os quatro papéis, cada um num agente publicado e marcado.
    expect(r.agentes.map((a) => a.papel)).toEqual(PAPEIS.map((p) => p.id));
    expect(r.agentes.every((a) => a.acao === "criado")).toBe(true);
    expect(r.agentes.map((a) => [a.papel, a.publicado, a.motivo_sem_publicar])).toEqual(
      PAPEIS.map((p) => [p.id, true, null]),
    );
    const agentes = await pool.query(
      `select a.config->'equipe_pronta'->>'papel' as papel, a.paused_at, a.published_version_id is not null as publicado,
              v.channel_session_id, v.pipeline_ids, v.knowledge_source_ids
         from ai_agents a join ai_agent_versions v on v.id = a.published_version_id
        where a.organization_id=$1 order by 1`,
      [org],
    );
    expect(agentes.rows.map((a) => a.papel)).toEqual([...PAPEIS.map((p) => p.id)].sort());
    for (const a of agentes.rows) {
      expect(a.publicado).toBe(true);
      // Nasce pausado e sai da pausa depois de publicado.
      expect(a.paused_at).toBeNull();
      // Sem canal próprio: quem diz o canal é o roteador.
      expect(a.channel_session_id).toBeNull();
      expect(a.pipeline_ids).toEqual([r.instalacao.pipeline_id]);
      expect(a.knowledge_source_ids).toEqual([r.instalacao.knowledge_source_id]);
    }

    // O roteador do canal, com os quatro membros e o SDR de fallback.
    const roteador = await pool.query(
      "select name, channel_session_id, fallback_agent_id, config from ai_routers where organization_id=$1",
      [org],
    );
    expect(roteador.rows).toHaveLength(1);
    expect(roteador.rows[0]).toMatchObject({ name: NOME_DO_ROTEADOR, channel_session_id: canal });
    expect(roteador.rows[0].config.sticky).toBe(true);
    // Os quatro passam a vez um para o outro: a passagem entre colegas nasce ligada.
    expect(roteador.rows[0].config.passagem_entre_colegas).toBe(true);
    expect(roteador.rows[0].fallback_agent_id).toBe(r.agentes.find((a) => a.papel === "sdr")!.agent_id);
    const membros = await pool.query(
      "select intent_name from ai_router_members where organization_id=$1 order by 1",
      [org],
    );
    expect(membros.rows.map((m) => m.intent_name)).toEqual(PAPEIS.map((p) => p.intencao.nome).sort());

    // Base, régua e agenda.
    const fonte = await pool.query(
      "select name, source_type, is_active, source_metadata from ai_knowledge_sources where organization_id=$1",
      [org],
    );
    expect(fonte.rows).toHaveLength(1);
    expect(fonte.rows[0]).toMatchObject({ name: NOME_DA_FONTE, source_type: "documento", is_active: true });
    expect(fonte.rows[0].source_metadata.origem).toBe("equipe_pronta");

    const regua = await pool.query(
      "select name, active_version_id is not null as publicada, trigger_config from followup_flow_pointers where organization_id=$1 and name=$2",
      [org, NOME_DA_REGUA],
    );
    expect(regua.rows).toHaveLength(1);
    expect(regua.rows[0]).toMatchObject({ name: NOME_DA_REGUA, publicada: true });
    expect(regua.rows[0].trigger_config.kind).toBe("silence");

    const tipos = await pool.query(
      "select slug, is_active, default_owner_user_id from calendar_event_types where organization_id=$1 order by slug",
      [org],
    );
    const principal = tipos.rows.find((t) => t.slug === "primeira-conversa");
    expect(principal).toMatchObject({ is_active: true, default_owner_user_id: GOV_ADMIN });
    // Os três de fábrica, sem horário e sem compromisso, saem da lista do agente.
    expect(tipos.rows.filter((t) => t.slug !== "primeira-conversa").map((t) => [t.slug, t.is_active])).toEqual([
      ["atendimento", false],
      ["consulta", false],
      ["reuniao", false],
    ]);
    expect(r.instalacao.tipos_de_agenda_desativados).toHaveLength(3);

    // O agente de Agendamento recebeu o id e o slug REAIS do tipo principal.
    const agendamento = await pool.query(
      `select v.system_prompt from ai_agents a join ai_agent_versions v on v.id = a.published_version_id
        where a.organization_id=$1 and a.config->'equipe_pronta'->>'papel'='agendamento'`,
      [org],
    );
    expect(agendamento.rows[0].system_prompt).toContain(`\`event_type_id\`: \`${r.instalacao.event_type_id}\``);
    expect(agendamento.rows[0].system_prompt).toContain("`event_type_slug`: `primeira-conversa`");

    // Memória da organização, com o bloco delimitado.
    const memoria = await pool.query(
      `select v.content from org_memory_pointers p join org_memory_versions v on v.id = p.version_id
        where p.organization_id=$1`,
      [org],
    );
    expect(memoria.rows[0].content).toContain("Empresa de Teste");

    // Perfil instalado, em ensaio; canal só com o telefone de teste.
    const perfil = await lerPerfil(pool, org);
    expect(perfil).toMatchObject({ estado: "instalado", modo: "ensaio" });
    expect(perfil!.instalado_em).not.toBeNull();
    const meta = await pool.query("select metadata from channel_sessions where id=$1", [canal]);
    expect(meta.rows[0].metadata.ai_gate).toBe("allowlist");
    expect(meta.rows[0].metadata.ai_test_phone_numbers).toEqual(["+5511999990001"]);
  });

  it("depois de instalar, o estado diz que cada agente está em dia", async () => {
    const { org, ctx } = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), ctx);

    const estado = await lerEstadoDaEquipe(pool, portasDoEstado, org);
    expect(estado.estado).toBe("instalado");
    expect(estado.perfil_completo).toBe(true);
    expect(estado.agentes.map((a) => [a.papel, a.situacao, a.publicado])).toEqual(
      PAPEIS.map((p) => [p.id, "em_dia", true]),
    );
    expect(estado.atualizacao_disponivel).toEqual([]);
    expect(estado.checklist.find((i) => i.id === "agentes_publicados")?.ok).toBe(true);
    expect(estado.checklist.find((i) => i.id === "whatsapp_conectado")?.ok).toBe(true);
  });
});

describe("atualização de papel", () => {
  it("versão nova do papel no código aparece como atualização disponível, com a nota — e nada é aplicado sozinho", async () => {
    const { org, ctx } = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), ctx);
    const antes = await retrato(org);

    // A plataforma publica uma versão nova do papel: sobe `versao` no código.
    const sdr = PAPEIS.find((p) => p.id === "sdr")! as { versao: number; notasDaVersao: string };
    const original = { versao: sdr.versao, notas: sdr.notasDaVersao };
    sdr.versao = original.versao + 1;
    sdr.notasDaVersao = "Passa a perguntar o nome antes de qualificar.";
    try {
      const estado = await lerEstadoDaEquipe(pool, portasDoEstado, org);
      expect(estado.atualizacao_disponivel).toEqual([
        {
          papel: "sdr",
          de: original.versao,
          para: original.versao + 1,
          notas: "Passa a perguntar o nome antes de qualificar.",
        },
      ]);
      expect(estado.agentes.find((a) => a.papel === "agendamento")?.atualizacao_disponivel).toBeNull();
      // Ler o estado não muda nada: aplicar é pelo instalador, por decisão de quem usa.
      expect(await retrato(org)).toEqual(antes);

      // Instalar de novo grava a versão atual do papel, e a atualização some.
      await instalarEquipePronta(pool, portas(zero()), ctx);
      expect((await lerEstadoDaEquipe(pool, portasDoEstado, org)).atualizacao_disponivel).toEqual([]);
    } finally {
      sdr.versao = original.versao;
      sdr.notasDaVersao = original.notas;
    }
  });
});

describe("instalar de novo", () => {
  it("⭐ duas vezes, sem mudar nada: nenhuma peça é duplicada e nada é publicado de novo", async () => {
    const { org, ctx } = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), ctx);
    const antes = await retrato(org);

    const contagem = zero();
    const r = await instalarEquipePronta(pool, portas(contagem), ctx);
    const depois = await retrato(org);

    expect(depois).toEqual(antes);
    // Três fluxos: a régua de silêncio e os dois dos gatilhos (a empresa do fixture agenda e usa proposta).
    expect(depois).toMatchObject({ agentes: 4, versoes: 4, roteadores: 1, membros: 4, fontes: 1, reguas: 3, perfis: 1 });
    expect(r.criados).toEqual([]);
    expect(r.agentes.every((a) => a.acao === "sem_mudanca" && a.publicado)).toBe(true);
    // Nem memória nova, nem régua republicada, nem agente republicado, nem aviso ao indexador.
    expect(contagem).toEqual({ avisos: 0, memorias: 0, reguas: 0, publicacoes: 0 });
  });

  it("mudar uma resposta gera UMA versão nova por agente, no MESMO agente", async () => {
    const { org, ctx } = await novaOrganizacao();
    const primeira = await instalarEquipePronta(pool, portas(zero()), ctx);
    const antes = await retrato(org);

    await pool.query(
      "update equipe_pronta_perfis set respostas = jsonb_set(respostas, '{atendente,nome}', '\"Bia\"') where organization_id=$1",
      [org],
    );
    const segunda = await instalarEquipePronta(pool, portas(zero()), ctx);
    const depois = await retrato(org);

    expect(depois.agentes).toBe(4);
    expect(depois.versoes).toBe(antes.versoes + 4);
    expect(depois).toMatchObject({ roteadores: 1, membros: 4, fontes: 1, reguas: 3 });
    expect(segunda.agentes.map((a) => a.agent_id)).toEqual(primeira.agentes.map((a) => a.agent_id));
    expect(segunda.agentes.every((a) => a.acao === "atualizado" && a.publicado)).toBe(true);
    const sdr = await pool.query(
      `select v.system_prompt, v.version_number from ai_agents a join ai_agent_versions v on v.id = a.published_version_id
        where a.organization_id=$1 and a.config->'equipe_pronta'->>'papel'='sdr'`,
      [org],
    );
    expect(sdr.rows[0].version_number).toBe(2);
    expect(sdr.rows[0].system_prompt).toContain("Você se apresenta como Bia");
  });

  it("mudar o texto da base troca o arquivo da MESMA fonte e avisa o indexador", async () => {
    const { org, ctx } = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), ctx);
    const caminhoAntes = (
      await pool.query("select source_metadata->>'blob_path' p from ai_knowledge_sources where organization_id=$1", [org])
    ).rows[0].p;

    await pool.query(
      "update equipe_pronta_perfis set respostas = jsonb_set(respostas, '{faq,texto}', '\"Atendemos também aos sábados.\"') where organization_id=$1",
      [org],
    );
    const contagem = zero();
    await instalarEquipePronta(pool, portas(contagem), ctx);

    const fontes = await pool.query(
      "select source_metadata->>'blob_path' p from ai_knowledge_sources where organization_id=$1",
      [org],
    );
    expect(fontes.rows).toHaveLength(1);
    expect(fontes.rows[0].p).not.toBe(caminhoAntes);
    expect(contagem.avisos).toBe(1);
    // A fonte é a mesma (mesmo id), então os agentes não mudam por causa dela.
    expect(contagem.publicacoes).toBe(0);
  });
});

describe("agente editado à mão", () => {
  /**
   * O cliente abre o editor do agente, muda algo e publica.
   *
   * ⚠️ Versão publicada é IMUTÁVEL no banco ("mudança de conteúdo = versão
   * draft nova"): o caminho real de uma edição é uma versão nova, publicada
   * pela função de produção. É esse caminho que o teste percorre.
   */
  async function publicarVersaoDoCliente(
    org: string,
    papel: string,
    mudanca: { prompt?: string; token_budget?: number },
  ): Promise<string> {
    const agente = await pool.query(
      "select id, published_version_id from ai_agents where organization_id=$1 and config->'equipe_pronta'->>'papel'=$2",
      [org, papel],
    );
    const nova = await pool.query(
      `insert into ai_agent_versions
         (organization_id, agent_id, version_number, status, created_by, system_prompt, provider, model,
          credential_id, channel_session_id, tool_ids, handoff_keywords, followup, pipeline_ids,
          knowledge_source_ids, proposal_ai_draft_enabled, token_budget)
       select organization_id, agent_id, version_number + 1, 'draft', created_by,
              system_prompt || $3, provider, model,
              credential_id, channel_session_id, tool_ids, handoff_keywords, followup, pipeline_ids,
              knowledge_source_ids, proposal_ai_draft_enabled, coalesce($4, token_budget)
         from ai_agent_versions where organization_id=$1 and id=$2
       returning id`,
      [org, agente.rows[0].published_version_id, mudanca.prompt ?? "", mudanca.token_budget ?? null],
    );
    await pool.query("select * from fn_publish_ai_agent_version($1,$2,$3,$4)", [
      org,
      agente.rows[0].id,
      nova.rows[0].id,
      true,
    ]);
    return String(agente.rows[0].id);
  }

  const editarOSdr = (org: string) =>
    publicarVersaoDoCliente(org, "sdr", { prompt: "\nSempre ofereça um brinde." });

  it("⭐ sem `forcar`: recusa com a lista, e NADA é gravado", async () => {
    const { org, ctx } = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), ctx);
    const sdrId = await editarOSdr(org);
    const antes = await retrato(org);

    const contagem = zero();
    const erro = await instalarEquipePronta(pool, portas(contagem), ctx).catch((e) => e);

    expect(erro).toBeInstanceOf(EquipeProntaError);
    expect(erro).toMatchObject({ codigo: "agentes_editados_a_mao", status: 409 });
    expect((erro as EquipeProntaError).detalhes).toEqual({ agentes: [{ papel: "sdr", agent_id: sdrId }] });
    expect(await retrato(org)).toEqual(antes);
    expect(contagem).toEqual(zero());
    // A edição do cliente continua lá.
    const sdr = await pool.query(
      "select v.system_prompt from ai_agents a join ai_agent_versions v on v.id = a.published_version_id where a.id=$1",
      [sdrId],
    );
    expect(sdr.rows[0].system_prompt).toContain("Sempre ofereça um brinde.");

    // E o estado diz o mesmo que o instalador: editado à mão.
    const estado = await lerEstadoDaEquipe(pool, portasDoEstado, org);
    expect(estado.agentes.find((a) => a.papel === "sdr")?.situacao).toBe("editado_a_mao");
    expect(estado.agentes.filter((a) => a.papel !== "sdr").every((a) => a.situacao === "em_dia")).toBe(true);
  });

  it("com `forcar`: sobrescreve só o agente editado, com uma versão nova", async () => {
    const { org, ctx } = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), ctx);
    const sdrId = await editarOSdr(org);
    const antes = await retrato(org);

    const r = await instalarEquipePronta(pool, portas(zero()), ctx, { forcar: true });

    expect(r.agentes.map((a) => [a.papel, a.acao])).toEqual([
      ["sdr", "atualizado"],
      ["agendamento", "sem_mudanca"],
      ["proposta", "sem_mudanca"],
      ["recuperador", "sem_mudanca"],
    ]);
    expect((await retrato(org)).versoes).toBe(antes.versoes + 1);
    const sdr = await pool.query(
      "select v.system_prompt from ai_agents a join ai_agent_versions v on v.id = a.published_version_id where a.id=$1",
      [sdrId],
    );
    expect(sdr.rows[0].system_prompt).not.toContain("Sempre ofereça um brinde.");
  });

  it("trocar o MODELO do agente não é editar à mão", async () => {
    const { org, ctx } = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), ctx);
    // Uma versão nova publicada pelo cliente, que só muda o orçamento de tokens.
    await publicarVersaoDoCliente(org, "sdr", { token_budget: 77777 });
    const antes = await retrato(org);

    const r = await instalarEquipePronta(pool, portas(zero()), ctx);

    expect(r.agentes.every((a) => a.acao === "sem_mudanca")).toBe(true);
    expect(await retrato(org)).toEqual(antes);
    // A escolha do cliente continua publicada.
    const sdr = await pool.query(
      `select v.token_budget from ai_agents a join ai_agent_versions v on v.id = a.published_version_id
        where a.organization_id=$1 and a.config->'equipe_pronta'->>'papel'='sdr'`,
      [org],
    );
    expect(sdr.rows[0].token_budget).toBe(77777);
  });
});

/**
 * AS ETAPAS DA EQUIPE (v2, decisão do dono): o instalador acha cada etapa no
 * funil e CRIA a que falta. Nunca renomeia nem apaga etapa da empresa.
 */
describe("as etapas da equipe no funil", () => {
  const etapasDe = async (org: string) =>
    (
      await pool.query(
        "select id, name, slug, position, is_won, is_lost, agent_stage_hint from crm_stages where organization_id=$1 and not is_archived order by position",
        [org],
      )
    ).rows;

  it("⭐ cria as que faltam, mapeia as que existem e grava o mapeamento — sem tocar no que era da empresa", async () => {
    const { org, ctx } = await novaOrganizacao();
    const antes = await etapasDe(org);
    expect(antes.length).toBeGreaterThan(0);

    const r = await instalarEquipePronta(pool, portas(zero()), ctx);
    const depois = await etapasDe(org);

    // A empresa agenda e usa proposta: as nove chaves têm etapa.
    expect(Object.keys(r.instalacao.etapas).sort()).toEqual(
      ["agendado", "compareceu", "em_atendimento", "em_negociacao", "ganho", "novo", "perdido", "proposta_enviada", "qualificado"],
    );
    // Cada chave aponta para uma etapa viva do funil da equipe, e nenhuma etapa serve a duas chaves.
    const ids = Object.values(r.instalacao.etapas);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(depois.some((e) => e.id === id)).toBe(true);
    // Ganho numa etapa de ganho, perdido numa etapa de perda.
    expect(depois.find((e) => e.id === r.instalacao.etapas.ganho)?.is_won).toBe(true);
    expect(depois.find((e) => e.id === r.instalacao.etapas.perdido)?.is_lost).toBe(true);

    // ⭐ Nenhuma etapa da empresa foi renomeada, reposicionada nem apagada.
    for (const e of antes) {
      expect(depois.find((d) => d.id === e.id)).toMatchObject({ name: e.name, slug: e.slug, position: e.position });
    }
    // O que nasceu é exatamente o que a instalação diz ter criado.
    const novas = depois.filter((d) => !antes.some((e) => e.id === d.id)).map((d) => d.id);
    expect(novas.sort()).toEqual([...r.instalacao.etapas_criadas].sort());
    expect(r.criados.filter((c) => c.startsWith("etapa_")).length).toBe(novas.length);

    // O texto dos agentes cita as etapas pelo id real.
    const sdr = await pool.query(
      `select v.system_prompt from ai_agents a join ai_agent_versions v on v.id = a.published_version_id
        where a.organization_id=$1 and a.config->'equipe_pronta'->>'papel'='sdr'`,
      [org],
    );
    expect(sdr.rows[0].system_prompt).toContain(`\`to_stage_id\`: \`${r.instalacao.etapas.em_atendimento}\``);
  });

  it("⭐ idempotente: instalar de novo não cria etapa nem muda o mapeamento", async () => {
    const { org, ctx } = await novaOrganizacao();
    const primeira = await instalarEquipePronta(pool, portas(zero()), ctx);
    const antes = await etapasDe(org);

    const segunda = await instalarEquipePronta(pool, portas(zero()), ctx);

    expect(segunda.criados).toEqual([]);
    expect(segunda.instalacao.etapas).toEqual(primeira.instalacao.etapas);
    expect(segunda.instalacao.etapas_criadas).toEqual(primeira.instalacao.etapas_criadas);
    expect(await etapasDe(org)).toEqual(antes);
  });

  it("etapa que já existe com o nome da equipe é reaproveitada, não duplicada", async () => {
    const { org, ctx } = await novaOrganizacao();
    const funil = await pool.query("select id from crm_pipelines where organization_id=$1 order by position, created_at limit 1", [org]);
    const existente = await pool.query(
      `insert into crm_stages (organization_id, pipeline_id, name, slug, position)
       values ($1, $2, 'AGENDADO', 'ja-tinha-agendado', 2.5) returning id`,
      [org, funil.rows[0].id],
    );

    const r = await instalarEquipePronta(pool, portas(zero()), ctx);

    expect(r.instalacao.etapas.agendado).toBe(String(existente.rows[0].id));
    expect(r.criados).not.toContain("etapa_agendado");
    const nome = await pool.query("select name from crm_stages where id=$1", [existente.rows[0].id]);
    expect(nome.rows[0].name).toBe("AGENDADO");
  });

  it("empresa que não agenda nem usa proposta: essas etapas não são criadas", async () => {
    const { ctx } = await novaOrganizacao({
      ...RESPOSTAS,
      primeiro_passo: { tipo: "humano" },
      proposta: { usa: false },
    });
    const r = await instalarEquipePronta(pool, portas(zero()), ctx);
    for (const chave of ["agendado", "compareceu", "em_negociacao"]) {
      expect(r.criados, chave).not.toContain(`etapa_${chave}`);
    }
  });

  it("quem desligou a passagem entre colegas na tela do roteador continua com ela desligada", async () => {
    const { org, ctx } = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), ctx);
    await pool.query(
      `update ai_routers set config = config || '{"passagem_entre_colegas":false}'::jsonb where organization_id=$1`,
      [org],
    );
    await instalarEquipePronta(pool, portas(zero()), ctx);
    const roteador = await pool.query("select config from ai_routers where organization_id=$1", [org]);
    expect(roteador.rows[0].config.passagem_entre_colegas).toBe(false);
  });
});

describe("os gatilhos: os fluxos e a regra que a instalação cria", () => {
  async function pecas(org: string) {
    const fluxos = await pool.query(
      "select id, name, status, active_version_id is not null as publicado, trigger_config from followup_flow_pointers where organization_id=$1 order by name",
      [org],
    );
    const regras = await pool.query(
      "select id, name, trigger_event, trigger_config, actions, is_active from automation_rules where organization_id=$1",
      [org],
    );
    const recuperador = await pool.query(
      `select v.followup from ai_agents a
         join ai_agent_versions v on v.id = a.published_version_id and v.organization_id = a.organization_id
        where a.organization_id=$1 and a.config->'equipe_pronta'->>'papel' = 'recuperador'`,
      [org],
    );
    const proposta = await pool.query(
      `select v.cases_enabled from ai_agents a
         join ai_agent_versions v on v.id = a.published_version_id and v.organization_id = a.organization_id
        where a.organization_id=$1 and a.config->'equipe_pronta'->>'papel' = 'proposta'`,
      [org],
    );
    return { fluxos: fluxos.rows, regras: regras.rows, recuperador: recuperador.rows[0], proposta: proposta.rows[0] };
  }

  it("⭐ empresa que agenda e usa proposta: dois fluxos publicados, armados pela Recuperação, e a regra de proposta parada", async () => {
    const { org, ctx } = await novaOrganizacao();
    const r = await instalarEquipePronta(pool, portas(zero()), ctx);
    const p = await pecas(org);

    const falta = p.fluxos.find((f) => f.name === NOME_DO_FLUXO_DE_FALTA);
    const parada = p.fluxos.find((f) => f.name === NOME_DO_FLUXO_DE_PROPOSTA_PARADA);
    expect(falta).toMatchObject({ publicado: true });
    expect(falta.trigger_config.kind).toBe("appointment_no_show");
    expect(parada).toMatchObject({ publicado: true });
    expect(parada.trigger_config.kind).toBe("manual");
    expect(r.instalacao.gatilhos).toMatchObject({
      fluxo_de_falta_id: falta.id,
      fluxo_de_proposta_parada_id: parada.id,
    });
    expect(r.criados).toEqual(expect.arrayContaining(["fluxo_de_falta", "fluxo_de_proposta_parada", "regra_de_proposta_parada"]));

    // A Recuperação arma os três fluxos: é o que `fn_appointment_recover` e o
    // portão de follow-up exigem para inscrever alguém.
    expect([...p.recuperador.followup.flow_pointer_ids].sort()).toEqual(
      [r.instalacao.followup_flow_pointer_id, falta.id, parada.id].sort(),
    );
    expect(p.recuperador.followup.enabled).toBe(true);
    // Propostas abre caso para a equipe (o pedido de desconto).
    expect(p.proposta.cases_enabled).toBe(true);

    // A regra: N dias na etapa de proposta enviada inscrevem no fluxo de proposta parada.
    expect(p.regras).toHaveLength(1);
    expect(p.regras[0]).toMatchObject({
      name: NOME_DA_REGRA_DE_PROPOSTA_PARADA,
      trigger_event: "lead.stage_stale",
      is_active: true,
      actions: [{ type: "start_message_flow", config: { flow_pointer_id: parada.id } }],
    });
    expect(p.regras[0].trigger_config).toMatchObject({
      dias: 5,
      pipeline_id: r.instalacao.pipeline_id,
      stage_id: r.instalacao.etapas.proposta_enviada,
      proteger_pela_agenda: true,
    });
    expect(r.instalacao.gatilhos.regra_de_proposta_parada_id).toBe(p.regras[0].id);
  });

  it("⭐ idempotente: instalar de novo não cria fluxo nem regra, e não republica", async () => {
    const { org, ctx } = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), ctx);
    const antes = await pecas(org);
    const contagem = zero();
    const r = await instalarEquipePronta(pool, portas(contagem), ctx);
    const depois = await pecas(org);
    expect(depois.fluxos.map((f) => f.id)).toEqual(antes.fluxos.map((f) => f.id));
    expect(depois.regras.map((x) => x.id)).toEqual(antes.regras.map((x) => x.id));
    expect(contagem.reguas).toBe(0);
    expect(r.criados).toEqual([]);
  });

  it("os dias da proposta parada vêm do perfil: mudar no banco atualiza a MESMA regra", async () => {
    const { org, ctx } = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), ctx);
    const antes = await pecas(org);
    await pool.query(
      "update equipe_pronta_perfis set respostas = jsonb_set(respostas, '{recuperacao}', '{\"dias_proposta_parada\": 9}') where organization_id=$1",
      [org],
    );
    await instalarEquipePronta(pool, portas(zero()), ctx);
    const depois = await pecas(org);
    expect(depois.regras).toHaveLength(1);
    expect(depois.regras[0].id).toBe(antes.regras[0].id);
    expect(depois.regras[0].trigger_config.dias).toBe(9);
  });

  it("a regra que o cliente desligou continua desligada depois de instalar de novo", async () => {
    const { org, ctx } = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), ctx);
    await pool.query("update automation_rules set is_active=false where organization_id=$1", [org]);
    await instalarEquipePronta(pool, portas(zero()), ctx);
    expect((await pecas(org)).regras[0].is_active).toBe(false);
  });

  it("empresa que não agenda nem usa proposta: nenhum fluxo de gatilho, nenhuma regra, e a Recuperação leva só a régua", async () => {
    const { org, ctx } = await novaOrganizacao({
      ...RESPOSTAS,
      primeiro_passo: { tipo: "humano" },
      proposta: { usa: false },
    });
    const r = await instalarEquipePronta(pool, portas(zero()), ctx);
    const p = await pecas(org);
    expect(p.fluxos.map((f) => f.name)).toEqual([NOME_DA_REGUA]);
    expect(p.regras).toEqual([]);
    expect(r.instalacao.gatilhos).toEqual({
      fluxo_de_falta_id: null,
      fluxo_de_proposta_parada_id: null,
      regra_de_proposta_parada_id: null,
    });
    expect(p.recuperador.followup.flow_pointer_ids).toEqual([r.instalacao.followup_flow_pointer_id]);
  });

  it("a empresa deixa de usar proposta: a regra é desligada e o fluxo sai da lista da Recuperação, sem apagar nada", async () => {
    const { org, ctx } = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), ctx);
    await pool.query(
      "update equipe_pronta_perfis set respostas = jsonb_set(respostas, '{proposta}', '{\"usa\": false}') where organization_id=$1",
      [org],
    );
    const r = await instalarEquipePronta(pool, portas(zero()), ctx);
    const p = await pecas(org);
    expect(p.regras).toHaveLength(1);
    expect(p.regras[0].is_active).toBe(false);
    expect(p.fluxos).toHaveLength(3);
    expect(r.instalacao.gatilhos.fluxo_de_proposta_parada_id).toBeNull();
    expect(p.recuperador.followup.flow_pointer_ids).not.toContain(
      p.fluxos.find((f) => f.name === NOME_DO_FLUXO_DE_PROPOSTA_PARADA).id,
    );
  });

  it("os gatilhos de uma organização não aparecem na outra", async () => {
    const a = await novaOrganizacao();
    const b = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), a.ctx);
    expect((await pecas(b.org)).fluxos).toEqual([]);
    expect((await pecas(b.org)).regras).toEqual([]);
  });
});

describe("quando publicar não dá", () => {
  it("sem WhatsApp conectado: a instalação termina, os agentes ficam em rascunho, e instalar de novo publica", async () => {
    const { org, canal, ctx } = await novaOrganizacao();
    await pool.query("update channel_sessions set status='STOPPED' where id=$1", [canal]);

    const r = await instalarEquipePronta(pool, portas(zero()), ctx);
    expect(r.agentes.every((a) => !a.publicado && a.motivo_sem_publicar !== null)).toBe(true);
    expect((await lerPerfil(pool, org))?.estado).toBe("instalado");
    const estado = await lerEstadoDaEquipe(pool, portasDoEstado, org);
    expect(estado.pode_ativar).toBe(false);
    expect(estado.checklist.find((i) => i.id === "agentes_publicados")?.ok).toBe(false);
    expect(estado.checklist.find((i) => i.id === "whatsapp_conectado")?.ok).toBe(false);
    const antes = await retrato(org);

    await pool.query("update channel_sessions set status='WORKING' where id=$1", [canal]);
    const de_novo = await instalarEquipePronta(pool, portas(zero()), ctx);
    expect(de_novo.agentes.every((a) => a.publicado)).toBe(true);
    // Publicou o que já existia: nenhum agente e nenhuma versão a mais.
    expect(await retrato(org)).toEqual(antes);
  });

  it("questionário incompleto: recusa dizendo o que falta, sem criar nada", async () => {
    const { org, ctx } = await novaOrganizacao({ negocio: { nome: "Só o nome" } });
    const antes = await retrato(org);

    const erro = await instalarEquipePronta(pool, portas(zero()), ctx).catch((e) => e);
    expect(erro).toMatchObject({ codigo: "perfil_incompleto", status: 422 });
    expect((erro as EquipeProntaError).detalhes?.faltam).toEqual(
      expect.arrayContaining(["atendente", "negocio.o_que_faz", "primeiro_passo"]),
    );
    expect(await retrato(org)).toEqual(antes);
  });
});

describe("isolamento e trava de plano", () => {
  it("instalar numa organização não toca a outra", async () => {
    const a = await novaOrganizacao();
    const b = await novaOrganizacao();
    const antesDeB = await retrato(b.org);

    await instalarEquipePronta(pool, portas(zero()), a.ctx);

    expect(await retrato(b.org)).toEqual(antesDeB);
    expect((await lerPerfil(pool, b.org))?.estado).toBe("rascunho");
  });

  it("a marca do agente é o que a trava de plano lê; sem cobrança ligada, o agente pode agir", async () => {
    const { org, ctx } = await novaOrganizacao();
    const r = await instalarEquipePronta(pool, portas(zero()), ctx);

    // Empresa sem assinatura é isenta (`fn_telas_do_plano` devolve restrito:false).
    for (const a of r.agentes) {
      expect(await agenteDaEquipeProntaPodeAgir(pool, org, a.agent_id)).toBe(true);
    }
    // Um agente comum, sem a marca, nunca é barrado por esta trava.
    const comum = await pool.query(
      "insert into ai_agents (organization_id, name, system_prompt, operation_mode) values ($1, 'Agente do cliente', 'x', 'automatic') returning id",
      [org],
    );
    expect(await agenteDaEquipeProntaPodeAgir(pool, org, String(comum.rows[0].id))).toBe(true);
  });
});

/**
 * O ENSAIO VEM ANTES DO ROTEADOR E DA PUBLICAÇÃO (revisão do PR #8).
 *
 * Num canal aberto, com clientes, ligar o roteador e publicar primeiro poria a
 * equipe nova na frente de todos eles — e, se o ensaio falhasse depois, o
 * canal ficaria aberto com ela.
 */
describe("o ensaio vem antes de ligar a equipe", () => {
  it("⭐ na hora em que o roteador e a publicação acontecem, o canal JÁ está em ensaio", async () => {
    const { org, canal, ctx } = await novaOrganizacao();
    const base = portas(zero());
    const naPublicacao: unknown[] = [];
    const r = await instalarEquipePronta(
      pool,
      {
        ...base,
        async publicarAgente(args) {
          const meta = await pool.query("select metadata->>'ai_gate' as gate from channel_sessions where id=$1", [
            canal,
          ]);
          naPublicacao.push(meta.rows[0].gate);
          return base.publicarAgente(args);
        },
      },
      ctx,
    );

    expect(r.agentes.every((a) => a.publicado)).toBe(true);
    expect(naPublicacao).toEqual(["allowlist", "allowlist", "allowlist", "allowlist"]);
    expect(org).toBeTruthy();
  });

  it("⭐ ensaio que falha: aborta SEM roteador, sem agente e sem publicar — e instalar de novo retoma", async () => {
    const { org, ctx } = await novaOrganizacao();
    const contagem = zero();
    const erro = await instalarEquipePronta(
      pool,
      {
        ...portas(contagem),
        async porCanalEmEnsaio() {
          throw new EquipeProntaError("ensaio_nao_configurado", "não deu", 500);
        },
      },
      ctx,
    ).catch((e) => e);

    expect(erro).toMatchObject({ codigo: "ensaio_nao_configurado" });
    expect(contagem.publicacoes).toBe(0);
    const depois = await retrato(org);
    expect(depois.roteadores).toBe(0);
    expect(depois.membros).toBe(0);
    expect(depois.agentes).toBe(0);
    expect((await lerPerfil(pool, org))?.estado).toBe("rascunho");

    // Resolvido o ensaio, a mesma instalação termina.
    const r = await instalarEquipePronta(pool, portas(zero()), ctx);
    expect(r.agentes.every((a) => a.publicado)).toBe(true);
  });
});

/** CANAL QUE JÁ TEM ROTEADOR DO CLIENTE (revisão do PR #8). */
describe("canal que já tem roteador", () => {
  async function comRoteadorDoCliente() {
    const o = await novaOrganizacao();
    const agente = await pool.query(
      "insert into ai_agents (organization_id, name, system_prompt, operation_mode) values ($1, 'Agente do cliente', 'x', 'automatic') returning id",
      [o.org],
    );
    const agenteId = String(agente.rows[0].id);
    const roteador = await pool.query(
      `insert into ai_routers (organization_id, name, channel_session_id, fallback_agent_id, config, created_by)
       values ($1, 'Roteador do cliente', $2, $3, '{"sticky":false}'::jsonb, $4) returning id`,
      [o.org, o.canal, agenteId, GOV_ADMIN],
    );
    return { ...o, agenteId, roteadorId: String(roteador.rows[0].id) };
  }

  it("⭐ sem `forcar`: 409 com o roteador e o destino padrão dele, e NADA é gravado", async () => {
    const { org, canal, ctx, agenteId, roteadorId } = await comRoteadorDoCliente();
    const antes = await retrato(org);
    const contagem = zero();

    const erro = await instalarEquipePronta(pool, portas(contagem), ctx).catch((e) => e);

    expect(erro).toBeInstanceOf(EquipeProntaError);
    expect(erro).toMatchObject({ codigo: "canal_com_roteador", status: 409 });
    expect((erro as EquipeProntaError).detalhes).toEqual({
      roteador: {
        id: roteadorId,
        nome: "Roteador do cliente",
        de_fora: true,
        fallback: { agent_id: agenteId, nome: "Agente do cliente" },
        membros: [],
      },
    });
    expect(await retrato(org)).toEqual(antes);
    expect(contagem).toEqual(zero());
    // O destino padrão do cliente continua sendo o agente dele, e o canal não mudou.
    const r = await pool.query("select fallback_agent_id, config from ai_routers where id=$1", [roteadorId]);
    expect(String(r.rows[0].fallback_agent_id)).toBe(agenteId);
    expect(r.rows[0].config.sticky).toBe(false);
    const meta = await pool.query("select metadata->>'ai_gate' as gate from channel_sessions where id=$1", [canal]);
    expect(meta.rows[0].gate).not.toBe("allowlist");
  });

  it("com `forcar`: adota o roteador, e instalar de novo NÃO pergunta outra vez", async () => {
    const { org, ctx, roteadorId } = await comRoteadorDoCliente();

    const r = await instalarEquipePronta(pool, portas(zero()), ctx, { forcar: true });

    expect(r.instalacao.router_id).toBe(roteadorId);
    const sdr = r.agentes.find((a) => a.papel === "sdr")!;
    const roteador = await pool.query("select fallback_agent_id from ai_routers where id=$1", [roteadorId]);
    expect(String(roteador.rows[0].fallback_agent_id)).toBe(sdr.agent_id);
    expect((await retrato(org)).roteadores).toBe(1);

    // Nada de alheio sobrou no roteador: a segunda instalação passa sem `forcar`.
    const antes = await retrato(org);
    await instalarEquipePronta(pool, portas(zero()), ctx);
    expect(await retrato(org)).toEqual(antes);
  });

  it("membro do cliente no roteador da equipe: pergunta uma vez; aceito, fica; mudou, pergunta de novo", async () => {
    const { org, ctx } = await novaOrganizacao();
    const primeira = await instalarEquipePronta(pool, portas(zero()), ctx);
    const novoMembro = async (nome: string) => {
      const a = await pool.query(
        "insert into ai_agents (organization_id, name, system_prompt, operation_mode) values ($1, $2, 'x', 'automatic') returning id",
        [org, nome],
      );
      await pool.query(
        `insert into ai_router_members (organization_id, router_id, agent_id, intent_name, intent_description, examples)
         values ($1, $2, $3, $4, 'Assunto do cliente', '{}')`,
        [org, primeira.instalacao.router_id, a.rows[0].id, nome],
      );
      return String(a.rows[0].id);
    };
    const financeiro = await novoMembro("Financeiro");

    const erro = await instalarEquipePronta(pool, portas(zero()), ctx).catch((e) => e);
    expect(erro).toMatchObject({ codigo: "canal_com_roteador", status: 409 });
    expect((erro as EquipeProntaError).detalhes).toMatchObject({
      roteador: { de_fora: false, fallback: null, membros: [{ agent_id: financeiro, nome: "Financeiro" }] },
    });

    // Aceito: o membro do cliente continua no roteador.
    await instalarEquipePronta(pool, portas(zero()), ctx, { forcar: true });
    const membros = await pool.query("select agent_id from ai_router_members where router_id=$1", [
      primeira.instalacao.router_id,
    ]);
    expect(membros.rows.map((m) => String(m.agent_id))).toContain(financeiro);
    expect(membros.rows).toHaveLength(PAPEIS.length + 1);

    // Sem mudança no roteador, não pergunta de novo.
    await instalarEquipePronta(pool, portas(zero()), ctx);

    // Entrou outro membro alheio: pergunta de novo.
    await novoMembro("Suporte");
    const outra = await instalarEquipePronta(pool, portas(zero()), ctx).catch((e) => e);
    expect(outra).toMatchObject({ codigo: "canal_com_roteador" });
  });
});

/** PAUSAR É DOS QUATRO AGENTES, NÃO DO CANAL (revisão do PR #8). */
describe("pausar e retomar", () => {
  const pausados = async (org: string) =>
    (
      await pool.query(
        "select config->'equipe_pronta'->>'papel' as papel from ai_agents where organization_id=$1 and paused_at is not null order by 1",
        [org],
      )
    ).rows.map((r) => r.papel);

  it("⭐ pausar para os quatro agentes e NÃO toca o acesso da IA no canal nem o modo", async () => {
    const { org, canal, ctx } = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), ctx);
    // Canal aberto, como depois de ativar: é o caso em que pausar o canal calaria os outros agentes.
    await pool.query("select fn_configurar_pre_go_live_canal($1,$2,'open',$3::text[])", [org, canal, []]);
    await pool.query("update equipe_pronta_perfis set modo='ativo' where organization_id=$1", [org]);
    const outro = await pool.query(
      "insert into ai_agents (organization_id, name, system_prompt, operation_mode) values ($1, 'Agente do cliente', 'x', 'automatic') returning id",
      [org],
    );
    const canalAntes = await pool.query("select metadata from channel_sessions where id=$1", [canal]);

    const r = await pausarEquipePronta(pool, ctx);

    expect(r).toMatchObject({ pausada: true, modo: "ativo" });
    expect(r.agentes_pausados).toHaveLength(PAPEIS.length);
    expect(await pausados(org)).toEqual([...PAPEIS.map((p) => p.id)].sort());
    const canalDepois = await pool.query("select metadata from channel_sessions where id=$1", [canal]);
    expect(canalDepois.rows[0].metadata).toEqual(canalAntes.rows[0].metadata);
    const cliente = await pool.query("select paused_at from ai_agents where id=$1", [outro.rows[0].id]);
    expect(cliente.rows[0].paused_at).toBeNull();
    expect((await lerPerfil(pool, org))?.modo).toBe("ativo");
    const estado = await lerEstadoDaEquipe(pool, portasDoEstado, org);
    expect(estado).toMatchObject({ pausada: true, modo: "ativo" });
  });

  it("retomar religa só o que a pausa parou: quem o cliente pausou à mão continua pausado", async () => {
    const { org, ctx } = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), ctx);
    await pool.query(
      "update ai_agents set paused_at=now() where organization_id=$1 and config->'equipe_pronta'->>'papel'='proposta'",
      [org],
    );

    const pausa = await pausarEquipePronta(pool, ctx);
    expect(pausa.agentes_pausados).toHaveLength(PAPEIS.length - 1);
    // Pausar duas vezes não perde a lista da primeira.
    expect((await pausarEquipePronta(pool, ctx)).agentes_pausados).toEqual(pausa.agentes_pausados);

    const r = await retomarEquipePronta(pool, ctx);

    expect(r).toMatchObject({ pausada: false, modo: "ensaio" });
    expect(r.agentes_religados).toHaveLength(PAPEIS.length - 1);
    expect(await pausados(org)).toEqual(["proposta"]);
    expect((await lerEstadoDaEquipe(pool, portasDoEstado, org)).pausada).toBe(false);
  });

  it("instalar de novo não desfaz a pausa", async () => {
    const { org, ctx } = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), ctx);
    await pausarEquipePronta(pool, ctx);

    await instalarEquipePronta(pool, portas(zero()), ctx);

    expect(await pausados(org)).toHaveLength(PAPEIS.length);
    expect((await lerEstadoDaEquipe(pool, portasDoEstado, org)).pausada).toBe(true);
  });

  it("sem equipe instalada: recusa", async () => {
    const { ctx } = await novaOrganizacao();
    await expect(pausarEquipePronta(pool, ctx)).rejects.toMatchObject({ codigo: "nao_instalada", status: 409 });
    await expect(retomarEquipePronta(pool, ctx)).rejects.toMatchObject({ codigo: "nao_instalada", status: 409 });
  });
});

/**
 * CANAL QUE JÁ ATENDE CLIENTES, SEM ROTEADOR (revisão do PR #8, rodada 3).
 *
 * O agente do cliente está publicado direto no canal. Instalar em ensaio
 * fecharia o número inteiro e ele pararia de atender, sem aviso.
 */
describe("canal em produção", () => {
  /** Um agente do cliente publicado DIRETO no canal, sem roteador. */
  async function comAgenteNoCanal() {
    const o = await novaOrganizacao();
    const agente = await pool.query(
      "insert into ai_agents (organization_id, name, system_prompt, operation_mode) values ($1, 'Agente do cliente', 'x', 'automatic') returning id",
      [o.org],
    );
    const agenteId = String(agente.rows[0].id);
    const modelo = await pool.query(
      "select model_id from ai_models where provider='openai' and deprecated_at is null and supports_tools order by is_default_for_provider desc, model_id limit 1",
    );
    const versao = await pool.query(
      `insert into ai_agent_versions
         (organization_id, agent_id, version_number, status, created_by, system_prompt, provider, model, channel_session_id)
       values ($1, $2, 1, 'draft', $3, 'x', 'openai', $4, $5) returning id`,
      [o.org, agenteId, GOV_ADMIN, modelo.rows[0].model_id, o.canal],
    );
    // O ponteiro direto: o que a leitura do canal olha é a versão publicada.
    await pool.query("update ai_agents set published_version_id=$2 where id=$1", [agenteId, versao.rows[0].id]);
    return { ...o, agenteId };
  }

  const gate = async (canal: string) =>
    (await pool.query("select metadata->>'ai_gate' as gate from channel_sessions where id=$1", [canal])).rows[0].gate;

  it("⭐ canal aberto com agente próprio: 409 com o agente e a contagem, e NADA é gravado", async () => {
    const { org, canal, ctx, agenteId } = await comAgenteNoCanal();
    const antes = await retrato(org);
    const contagem = zero();

    const erro = await instalarEquipePronta(pool, portas(contagem), ctx).catch((e) => e);

    expect(erro).toBeInstanceOf(EquipeProntaError);
    expect(erro).toMatchObject({ codigo: "canal_em_producao", status: 409 });
    expect((erro as EquipeProntaError).detalhes).toEqual({
      canal: { agentes: [{ agent_id: agenteId, nome: "Agente do cliente" }], conversas_recentes: 0 },
    });
    expect(await retrato(org)).toEqual(antes);
    expect(contagem).toEqual(zero());
    // O número continua aberto: o agente do cliente segue atendendo.
    expect(await gate(canal)).not.toBe("allowlist");
  });

  it("⭐ com `forcar`: instala e põe o canal em ensaio; instalar de novo não pergunta outra vez", async () => {
    const { org, canal, ctx } = await comAgenteNoCanal();

    const r = await instalarEquipePronta(pool, portas(zero()), ctx, { forcar: true });

    expect(r.agentes.every((a) => a.publicado)).toBe(true);
    expect(await gate(canal)).toBe("allowlist");
    // O canal já está em ensaio: não há mais o que avisar.
    const antes = await retrato(org);
    await instalarEquipePronta(pool, portas(zero()), ctx);
    expect(await retrato(org)).toEqual(antes);
  });

  it("⭐ canal novo: instala sem perguntar", async () => {
    const { canal, ctx } = await novaOrganizacao();

    const r = await instalarEquipePronta(pool, portas(zero()), ctx);

    expect(r.agentes.every((a) => a.publicado)).toBe(true);
    expect(await gate(canal)).toBe("allowlist");
  });

  it("agente pausado ou arquivado no canal não conta como produção", async () => {
    const { ctx, agenteId } = await comAgenteNoCanal();
    await pool.query("update ai_agents set paused_at=now() where id=$1", [agenteId]);

    const r = await instalarEquipePronta(pool, portas(zero()), ctx);

    expect(r.agentes.every((a) => a.publicado)).toBe(true);
  });

  it("equipe já ATIVA: instalar de novo não fecha o canal, então não pergunta", async () => {
    const { org, canal, ctx } = await comAgenteNoCanal();
    await instalarEquipePronta(pool, portas(zero()), ctx, { forcar: true });
    await pool.query("select fn_configurar_pre_go_live_canal($1,$2,'open',$3::text[])", [org, canal, []]);
    await pool.query("update equipe_pronta_perfis set modo='ativo' where organization_id=$1", [org]);

    await instalarEquipePronta(pool, portas(zero()), ctx);

    expect(await gate(canal)).not.toBe("allowlist");
  });
});

/**
 * A PAUSA DE NASCIMENTO (correção A6, bug real na conta de teste em 19/11/2026).
 *
 * O agente nasce pausado e sai da pausa quando é publicado. Antes, só saía se
 * tivesse sido CRIADO na mesma rodada: instalar com o WhatsApp desconectado
 * criava os quatro pausados e em rascunho; conectar e instalar de novo
 * publicava os quatro, o checklist ficava todo verde, e eles continuavam
 * pausados, sem responder ninguém.
 */
describe("a pausa de nascimento sai na rodada em que o agente é publicado", () => {
  const pausados = async (org: string) =>
    (
      await pool.query(
        "select config->'equipe_pronta'->>'papel' as papel from ai_agents where organization_id=$1 and paused_at is not null order by 1",
        [org],
      )
    ).rows.map((r) => r.papel);

  it("⭐ instalar offline → conectar → reinstalar: os quatro publicados e SEM pausa", async () => {
    const { org, canal, ctx } = await novaOrganizacao();
    await pool.query("update channel_sessions set status='STOPPED' where id=$1", [canal]);

    const offline = await instalarEquipePronta(pool, portas(zero()), ctx);
    expect(offline.agentes.every((a) => !a.publicado)).toBe(true);
    // Em rascunho, a pausa de nascimento continua: nada responde ainda.
    expect(await pausados(org)).toHaveLength(PAPEIS.length);

    await pool.query("update channel_sessions set status='WORKING' where id=$1", [canal]);
    const conectado = await instalarEquipePronta(pool, portas(zero()), ctx);

    expect(conectado.agentes.every((a) => a.publicado)).toBe(true);
    // Reaproveitados, não criados: era aqui que a pausa ficava para trás.
    expect(conectado.agentes.every((a) => a.acao !== "criado")).toBe(true);
    expect(await pausados(org)).toEqual([]);
    const estado = await lerEstadoDaEquipe(pool, portasDoEstado, org);
    expect(estado.checklist.find((i) => i.id === "agentes_publicados")?.ok).toBe(true);
  });

  it("⭐ pausa feita pelo cliente num agente já publicado continua intocada", async () => {
    const { org, ctx } = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), ctx);
    // O cliente pausa o agente de Propostas à mão, bem depois de ele nascer.
    await pool.query(
      `update ai_agents set paused_at = created_at + interval '2 hours'
        where organization_id=$1 and config->'equipe_pronta'->>'papel'='proposta'`,
      [org],
    );

    // Reinstalar, inclusive com uma resposta mudada (gera versão nova e publica de novo).
    await instalarEquipePronta(pool, portas(zero()), ctx);
    await pool.query(
      "update equipe_pronta_perfis set respostas = jsonb_set(respostas, '{atendente,nome}', '\"Bia\"') where organization_id=$1",
      [org],
    );
    const r = await instalarEquipePronta(pool, portas(zero()), ctx);

    expect(r.agentes.every((a) => a.publicado)).toBe(true);
    expect(await pausados(org)).toEqual(["proposta"]);
  });

  it("quem já ficou preso (publicado, com a pausa com que nasceu) é solto ao reinstalar", async () => {
    const { org, ctx } = await novaOrganizacao();
    await instalarEquipePronta(pool, portas(zero()), ctx);
    // O estado que o defeito deixava: publicado, e ainda com a pausa de nascimento.
    await pool.query("update ai_agents set paused_at = created_at where organization_id=$1", [org]);
    expect(await pausados(org)).toHaveLength(PAPEIS.length);

    await instalarEquipePronta(pool, portas(zero()), ctx);

    expect(await pausados(org)).toEqual([]);
  });

  it("a equipe pausada pela tela não é religada pela reinstalação, nem na primeira publicação", async () => {
    const { org, canal, ctx } = await novaOrganizacao();
    await pool.query("update channel_sessions set status='STOPPED' where id=$1", [canal]);
    await instalarEquipePronta(pool, portas(zero()), ctx);
    await pausarEquipePronta(pool, ctx);
    await pool.query("update channel_sessions set status='WORKING' where id=$1", [canal]);

    const r = await instalarEquipePronta(pool, portas(zero()), ctx);

    expect(r.agentes.every((a) => a.publicado)).toBe(true);
    expect(await pausados(org)).toHaveLength(PAPEIS.length);
  });
});
