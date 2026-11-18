import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { GOV_ADMIN, seedGov } from "./gov-helpers";

vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

import { PAPEIS } from "@/lib/ai/equipe-pronta";
import { lerEstadoDaEquipe, type PortasDoEstado } from "@/lib/ai/equipe-pronta/estado";
import {
  EquipeProntaError,
  NOME_DA_FONTE,
  NOME_DO_ROTEADOR,
  instalarEquipePronta,
  lerPerfil,
  type PortasDoInstalador,
} from "@/lib/ai/equipe-pronta/instalar";
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
      "select name, active_version_id is not null as publicada, trigger_config from followup_flow_pointers where organization_id=$1",
      [org],
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
    // Como se a instalação tivesse sido feita com uma versão ANTERIOR do papel.
    await pool.query(
      "update equipe_pronta_perfis set instalacao = jsonb_set(instalacao, '{agentes,sdr,versao_do_papel}', '0') where organization_id=$1",
      [org],
    );
    const antes = await retrato(org);

    const estado = await lerEstadoDaEquipe(pool, portasDoEstado, org);

    const sdr = PAPEIS.find((p) => p.id === "sdr")!;
    expect(estado.atualizacao_disponivel).toEqual([
      { papel: "sdr", de: 0, para: sdr.versao, notas: sdr.notasDaVersao },
    ]);
    expect(estado.agentes.find((a) => a.papel === "agendamento")?.atualizacao_disponivel).toBeNull();
    // Ler o estado não muda nada: aplicar é pelo instalador, por decisão de quem usa.
    expect(await retrato(org)).toEqual(antes);

    // Instalar de novo grava a versão atual do papel, e a atualização some.
    await instalarEquipePronta(pool, portas(zero()), ctx);
    expect((await lerEstadoDaEquipe(pool, portasDoEstado, org)).atualizacao_disponivel).toEqual([]);
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
    expect(depois).toMatchObject({ agentes: 4, versoes: 4, roteadores: 1, membros: 4, fontes: 1, reguas: 1, perfis: 1 });
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
    expect(depois).toMatchObject({ roteadores: 1, membros: 4, fontes: 1, reguas: 1 });
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
  async function editarOSdr(org: string): Promise<string> {
    const sdr = await pool.query(
      "select id, published_version_id from ai_agents where organization_id=$1 and config->'equipe_pronta'->>'papel'='sdr'",
      [org],
    );
    // O cliente abriu o editor e mudou o texto da versão publicada.
    await pool.query(
      "update ai_agent_versions set system_prompt = system_prompt || E'\\nSempre ofereça um brinde.' where organization_id=$1 and id=$2",
      [org, sdr.rows[0].published_version_id],
    );
    return String(sdr.rows[0].id);
  }

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
    await pool.query("update ai_agent_versions set token_budget = 77777, max_steps = 7 where organization_id=$1", [org]);

    const r = await instalarEquipePronta(pool, portas(zero()), ctx);
    expect(r.agentes.every((a) => a.acao === "sem_mudanca")).toBe(true);
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
