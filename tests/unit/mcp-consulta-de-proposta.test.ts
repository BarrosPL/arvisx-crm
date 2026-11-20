/**
 * A CONSULTA DE PROPOSTA — `crm_get_proposal`, contra o handler real.
 *
 * O banco é o de `tests/helpers/banco-em-memoria.ts`: duas organizações nas
 * mesmas tabelas, filtros aplicados de verdade. O que se guarda aqui:
 *
 *  - a organização vem do token, e proposta de outra empresa é "não existe";
 *  - num turno de atendimento, só a proposta do cliente da conversa;
 *  - o que volta (status, validade, itens, valor, link) e o que NÃO volta;
 *  - o link só é assinado para o PDF da própria proposta, e só depois do envio;
 *  - a ferramenta aparece pelo pacote dela, e some com propostas desligadas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type BancoEmMemoria } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({ capacidades: ["propostas"] as string[] }));
vi.mock("@/lib/organizacao/capacidades", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  capacidadesDaOrganizacao: vi.fn(async () => h.capacidades),
}));
vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: vi.fn().mockResolvedValue(undefined) }));

const { crmGetProposal, MAXIMO_DE_PROPOSTAS_POR_CONSULTA } = await import(
  "@/lib/mcp/tools/consulta-de-proposta"
);
const { pickToolsFromMcp } = await import("@/lib/ai/runtime/tools");
const { ROLE_RANK } = await import("@/lib/auth/types");
const { MODULOS_OPCIONAIS } = await import("@/lib/instalacao/modulos");
const { ensureRole, ensureScope } = await import("@/lib/mcp/auth");
const { allTools, getToolByName } = await import("@/lib/mcp/tools");
const { catalogEntry, deCapacidadeDesligada, TOOL_CATALOG } = await import("@/lib/mcp/tools/catalog");
const { IDS_DO_HARNESS } = await import("@/lib/mcp/tools/ferramentas-do-harness");
const { PACOTES } = await import("@/lib/mcp/tools/pacotes");
const { TETO_TOOLS_POR_AGENTE, capacidadesAutomaticasDoPacote, ligarPacote, vagasExigidasPeloPacote } =
  await import("@/lib/mcp/tools/selecao-por-pacote");
const { PACOTE_PADRAO_DO_ONBOARDING } = await import("@/lib/ai/agents/capacidades-padrao");
const { VALIDADE_DO_LINK_DE_CONSULTA_DO_PDF_S } = await import("@/lib/propostas/storage");
import type { McpContext } from "@/lib/mcp/types";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const TOKEN_A = "aaaaaaaa-0000-4000-8000-0000000000f1";
const CONTATO_A = "aaaaaaaa-0000-4000-8000-0000000000c1";
const CONTATO_A2 = "aaaaaaaa-0000-4000-8000-0000000000c2";
const CONTATO_PESSOAL = "aaaaaaaa-0000-4000-8000-0000000000c3";
const CONTATO_B = "bbbbbbbb-0000-4000-8000-0000000000c1";
const NEGOCIO_A = "aaaaaaaa-0000-4000-8000-0000000000d1";
const NEGOCIO_A2 = "aaaaaaaa-0000-4000-8000-0000000000d2";
const NEGOCIO_PESSOAL = "aaaaaaaa-0000-4000-8000-0000000000d3";
const NEGOCIO_SEM_PROPOSTA = "aaaaaaaa-0000-4000-8000-0000000000d4";
const NEGOCIO_B = "bbbbbbbb-0000-4000-8000-0000000000d1";
const FUNIL = "aaaaaaaa-0000-4000-8000-000000000011";
const PRODUTO = "aaaaaaaa-0000-4000-8000-000000000021";

const ENVIADA = "aaaaaaaa-0000-4000-8000-0000000000e1";
const SUBSTITUIDA = "aaaaaaaa-0000-4000-8000-0000000000e2";
const RASCUNHO = "aaaaaaaa-0000-4000-8000-0000000000e3";
const DO_OUTRO_CLIENTE = "aaaaaaaa-0000-4000-8000-0000000000e4";
const DO_PESSOAL = "aaaaaaaa-0000-4000-8000-0000000000e5";
const CAMINHO_TROCADO = "aaaaaaaa-0000-4000-8000-0000000000e6";
const DA_B = "bbbbbbbb-0000-4000-8000-0000000000e1";
const INEXISTENTE = "aaaaaaaa-0000-4000-8000-0000000000ee";

let banco: BancoEmMemoria;

function ctx(extra: Partial<McpContext> = {}): McpContext {
  return {
    organizationId: ORG_A,
    role: "agent",
    actor: { type: "api_token", id: TOKEN_A, role: "agent" },
    apiTokenId: TOKEN_A,
    requestId: "req-1",
    supabase: banco.cliente as never,
    ...extra,
  };
}

function proposta(id: string, org: string, extra: Record<string, unknown>) {
  return {
    id,
    organization_id: org,
    lead_id: NEGOCIO_A,
    contact_id: CONTATO_A,
    numero: null,
    ano: null,
    versao: 1,
    substitui_id: null,
    titulo: "Proposta",
    status: "rascunho",
    valid_until: "2026-12-15",
    moeda: "BRL",
    total_cents: 0,
    pricing_status: "manual",
    prazo_dias_uteis: null,
    pagamento: null,
    condicoes: null,
    sent_at: null,
    decided_at: null,
    decision_reason: null,
    pdf_path: null,
    created_at: "2026-11-01T10:00:00.000Z",
    // Colunas internas: existem na linha e NÃO podem sair na resposta.
    briefing_json: { nucleo: { objetivo: "interno" } },
    rendered_snapshot: { html: "<p>interno</p>" },
    template_snapshot: { secoes: [] },
    secoes_editadas: { s1: "interno" },
    drafted_by_agent_id: "aaaaaaaa-0000-4000-8000-0000000000a9",
    sent_by_user_id: "aaaaaaaa-0000-4000-8000-0000000000b9",
    decided_by_user_id: null,
    message_id: "aaaaaaaa-0000-4000-8000-0000000000ab",
    conversation_id: "aaaaaaaa-0000-4000-8000-0000000000ac",
    ultima_falha_envio: null,
    revision: 3,
    ...extra,
  };
}

beforeEach(() => {
  h.capacidades = ["propostas"];
  banco = bancoEmMemoria({
    contacts: [
      { id: CONTATO_A, organization_id: ORG_A, is_personal: false },
      { id: CONTATO_A2, organization_id: ORG_A, is_personal: false },
      { id: CONTATO_PESSOAL, organization_id: ORG_A, is_personal: true },
      { id: CONTATO_B, organization_id: ORG_B, is_personal: false },
    ],
    crm_leads: [
      { id: NEGOCIO_A, organization_id: ORG_A, contact_id: CONTATO_A, pipeline_id: FUNIL, title: "A" },
      { id: NEGOCIO_A2, organization_id: ORG_A, contact_id: CONTATO_A2, pipeline_id: FUNIL, title: "A2" },
      { id: NEGOCIO_PESSOAL, organization_id: ORG_A, contact_id: CONTATO_PESSOAL, pipeline_id: FUNIL, title: "P" },
      { id: NEGOCIO_SEM_PROPOSTA, organization_id: ORG_A, contact_id: CONTATO_A, pipeline_id: FUNIL, title: "S" },
      { id: NEGOCIO_B, organization_id: ORG_B, contact_id: CONTATO_B, pipeline_id: FUNIL, title: "B" },
    ],
    crm_proposals: [
      proposta(SUBSTITUIDA, ORG_A, {
        numero: 12,
        ano: 2026,
        status: "substituida",
        titulo: "Projeto inicial",
        total_cents: 400_000,
        sent_at: "2026-11-02T10:00:00.000Z",
        pdf_path: `${ORG_A}/${SUBSTITUIDA}.pdf`,
        created_at: "2026-11-01T10:00:00.000Z",
      }),
      proposta(ENVIADA, ORG_A, {
        numero: 12,
        ano: 2026,
        versao: 2,
        substitui_id: SUBSTITUIDA,
        status: "enviada",
        titulo: "Projeto revisado",
        valid_until: "2026-12-20",
        total_cents: 345_000,
        pricing_status: "catalog",
        prazo_dias_uteis: 15,
        pagamento: "50% na aprovação, 50% na entrega",
        condicoes: "Valores válidos até a data indicada.",
        sent_at: "2026-11-05T10:00:00.000Z",
        pdf_path: `${ORG_A}/${ENVIADA}.pdf`,
        created_at: "2026-11-04T10:00:00.000Z",
      }),
      proposta(RASCUNHO, ORG_A, {
        titulo: "Complemento",
        // envio que falhou deixa o PDF gravado num rascunho
        pdf_path: `${ORG_A}/${RASCUNHO}.pdf`,
        created_at: "2026-11-10T10:00:00.000Z",
      }),
      proposta(DO_OUTRO_CLIENTE, ORG_A, {
        lead_id: NEGOCIO_A2,
        contact_id: CONTATO_A2,
        status: "aceita",
        titulo: "De outro cliente da mesma empresa",
        total_cents: 99_900,
        decided_at: "2026-11-08T10:00:00.000Z",
      }),
      proposta(DO_PESSOAL, ORG_A, { lead_id: NEGOCIO_PESSOAL, contact_id: CONTATO_PESSOAL, status: "enviada" }),
      proposta(CAMINHO_TROCADO, ORG_A, {
        lead_id: NEGOCIO_A2,
        contact_id: CONTATO_A2,
        status: "enviada",
        // caminho que aponta para o PDF de OUTRA organização
        pdf_path: `${ORG_B}/${DA_B}.pdf`,
        created_at: "2026-11-09T10:00:00.000Z",
      }),
      proposta(DA_B, ORG_B, {
        lead_id: NEGOCIO_B,
        contact_id: CONTATO_B,
        status: "enviada",
        titulo: "Segredo da empresa B",
        total_cents: 777_700,
        pdf_path: `${ORG_B}/${DA_B}.pdf`,
      }),
    ],
    crm_proposal_items: [
      { id: "i2", organization_id: ORG_A, proposal_id: ENVIADA, product_id: null, descricao: "Suporte", quantidade: 3, preco_unitario_cents: null, desconto_cents: 0, position: 2000 },
      { id: "i1", organization_id: ORG_A, proposal_id: ENVIADA, product_id: PRODUTO, descricao: "Implantação", quantidade: "1", preco_unitario_cents: 350_000, desconto_cents: 5_000, position: 1000 },
      { id: "i3", organization_id: ORG_A, proposal_id: SUBSTITUIDA, product_id: null, descricao: "Implantação antiga", quantidade: 1, preco_unitario_cents: 400_000, desconto_cents: 0, position: 1000 },
      { id: "i4", organization_id: ORG_B, proposal_id: DA_B, product_id: null, descricao: "Item secreto da B", quantidade: 1, preco_unitario_cents: 777_700, desconto_cents: 0, position: 1000 },
      // item de outra organização apontando para uma proposta da A: não pode aparecer
      { id: "i5", organization_id: ORG_B, proposal_id: ENVIADA, product_id: null, descricao: "Intruso", quantidade: 1, preco_unitario_cents: 1, desconto_cents: 0, position: 500 },
    ],
  });
});

type Resposta = Record<string, unknown>;
type Vista = Record<string, unknown> & { items: Array<Record<string, unknown>> };

const consultar = (args: Record<string, unknown>, c = ctx()) =>
  crmGetProposal.handler(args as never, c) as Promise<Resposta>;

describe("crm_get_proposal por `proposal_id`", () => {
  it("⭐ devolve status, validade, itens em ordem, valor total e link do PDF", async () => {
    const r = await consultar({ proposal_id: ENVIADA });
    const p = r.proposal as Vista;

    expect(p).toMatchObject({
      id: ENVIADA,
      lead_id: NEGOCIO_A,
      number: 12,
      year: 2026,
      version: 2,
      replaces_proposal_id: SUBSTITUIDA,
      title: "Projeto revisado",
      status: "enviada",
      valid_until: "2026-12-20",
      currency: "BRL",
      total_cents: 345_000,
      pricing_status: "catalog",
      delivery_business_days: 15,
      payment_terms: "50% na aprovação, 50% na entrega",
      conditions: "Valores válidos até a data indicada.",
      sent_at: "2026-11-05T10:00:00.000Z",
      pdf_url_expires_in_seconds: VALIDADE_DO_LINK_DE_CONSULTA_DO_PDF_S,
    });
    expect(p.items).toEqual([
      { description: "Implantação", quantity: 1, unit_price_cents: 350_000, discount_cents: 5_000, product_id: PRODUTO },
      { description: "Suporte", quantity: 3, unit_price_cents: null, discount_cents: 0, product_id: null },
    ]);
    expect(String(p.pdf_url)).toContain(`/propostas/${ORG_A}/${ENVIADA}.pdf`);
  });

  it("não devolve campo interno: briefing, snapshots, autoria, conversa nem a organização", async () => {
    const p = (await consultar({ proposal_id: ENVIADA })).proposal as Vista;
    for (const interno of [
      "organization_id",
      "contact_id",
      "briefing_json",
      "rendered_snapshot",
      "template_snapshot",
      "secoes_editadas",
      "drafted_by_agent_id",
      "sent_by_user_id",
      "decided_by_user_id",
      "message_id",
      "conversation_id",
      "pdf_path",
      "revision",
    ]) {
      expect(p, interno).not.toHaveProperty(interno);
    }
  });

  it("id que não existe: recusa com código legível", async () => {
    const r = await consultar({ proposal_id: INEXISTENTE });
    expect(r).toMatchObject({ permitido: false, motivo: "proposta_nao_encontrada" });
    expect(typeof r.mensagem).toBe("string");
  });

  it("⭐ proposta de OUTRA organização recebe a mesma recusa de inexistente, sem vazar nada", async () => {
    const daOutra = await consultar({ proposal_id: DA_B });
    const inexistente = await consultar({ proposal_id: INEXISTENTE });

    expect(daOutra).toEqual(inexistente);
    expect(JSON.stringify(daOutra)).not.toContain("Segredo");
    expect(JSON.stringify(daOutra)).not.toContain("777700");
  });

  it("a organização é a do token: o token da B lê a dela e não lê a da A", async () => {
    const daB = ctx({ organizationId: ORG_B });
    expect(((await consultar({ proposal_id: DA_B }, daB)).proposal as Vista).title).toBe("Segredo da empresa B");
    expect(await consultar({ proposal_id: ENVIADA }, daB)).toMatchObject({
      permitido: false,
      motivo: "proposta_nao_encontrada",
    });
  });

  it("rascunho não tem link, mesmo com PDF gravado por um envio que falhou", async () => {
    const p = (await consultar({ proposal_id: RASCUNHO })).proposal as Vista;
    expect(p.status).toBe("rascunho");
    expect(p.pdf_url).toBeNull();
    expect(p.pdf_url_expires_in_seconds).toBeNull();
    expect(p.items).toEqual([]);
  });

  it("caminho de PDF que não é o da própria proposta volta sem link, nunca com o de outra", async () => {
    const p = (await consultar({ proposal_id: CAMINHO_TROCADO })).proposal as Vista;
    expect(p.status).toBe("enviada");
    expect(p.pdf_url).toBeNull();
  });

  it("proposta de contato pessoal fica fora da operação", async () => {
    expect(await consultar({ proposal_id: DO_PESSOAL })).toMatchObject({
      permitido: false,
      motivo: "contato_pessoal",
    });
  });
});

describe("crm_get_proposal por `lead_id`", () => {
  it("⭐ devolve as propostas do negócio, da mais recente para a mais antiga, com itens de cada uma", async () => {
    const r = await consultar({ lead_id: NEGOCIO_A });
    const lista = r.proposals as Vista[];

    expect(r.lead_id).toBe(NEGOCIO_A);
    expect(r.has_more).toBe(false);
    expect(lista.map((p) => p.id)).toEqual([RASCUNHO, ENVIADA, SUBSTITUIDA]);
    expect(lista[1]!.items.map((i) => i.description)).toEqual(["Implantação", "Suporte"]);
    expect(lista[2]!.items.map((i) => i.description)).toEqual(["Implantação antiga"]);
    expect(JSON.stringify(r)).not.toContain("Intruso");
  });

  it("negócio sem proposta devolve lista vazia, não recusa", async () => {
    expect(await consultar({ lead_id: NEGOCIO_SEM_PROPOSTA })).toEqual({
      lead_id: NEGOCIO_SEM_PROPOSTA,
      proposals: [],
      has_more: false,
    });
  });

  it("negócio de outra organização é negócio que não existe", async () => {
    const r = await consultar({ lead_id: NEGOCIO_B });
    expect(r).toMatchObject({ permitido: false, motivo: "negocio_nao_encontrado" });
    expect(JSON.stringify(r)).not.toContain("Segredo");
  });

  it("corta no máximo e avisa que ficou proposta de fora", async () => {
    for (let i = 0; i < MAXIMO_DE_PROPOSTAS_POR_CONSULTA; i++) {
      banco.tabelas.crm_proposals!.push(
        proposta(`aaaaaaaa-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, ORG_A, {
          status: "cancelada",
          created_at: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
        }),
      );
    }
    const r = await consultar({ lead_id: NEGOCIO_A });
    expect((r.proposals as Vista[]).length).toBe(MAXIMO_DE_PROPOSTAS_POR_CONSULTA);
    expect(r.has_more).toBe(true);
    expect((r.proposals as Vista[])[0]!.id).toBe(RASCUNHO);
  });
});

describe("⭐ num turno de atendimento, só a proposta do cliente da conversa", () => {
  const noTurno = () => ctx({ contatoDoTurno: CONTATO_A });

  it("a do cliente da conversa é lida, por id e por negócio", async () => {
    expect(((await consultar({ proposal_id: ENVIADA }, noTurno())).proposal as Vista).id).toBe(ENVIADA);
    expect(((await consultar({ lead_id: NEGOCIO_A }, noTurno())).proposals as Vista[]).length).toBe(3);
  });

  it("a de outro cliente, a de outra organização e a inexistente recebem a MESMA recusa", async () => {
    const deOutro = await consultar({ proposal_id: DO_OUTRO_CLIENTE }, noTurno());
    const daOutraOrg = await consultar({ proposal_id: DA_B }, noTurno());
    const inexistente = await consultar({ proposal_id: INEXISTENTE }, noTurno());

    expect(deOutro).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
    expect(daOutraOrg).toEqual(deOutro);
    expect(inexistente).toEqual(deOutro);
    expect(JSON.stringify(deOutro)).not.toContain("outro cliente da mesma empresa");
  });

  it("e com a mesma quantidade de consultas: o id não vira oráculo", async () => {
    const contar = async (id: string) => {
      const antes = { ...banco.consultas };
      await consultar({ proposal_id: id }, noTurno());
      return Object.fromEntries(
        Object.entries(banco.consultas).map(([t, n]) => [t, n - (antes[t] ?? 0)]).filter(([, n]) => n !== 0),
      );
    };
    expect(await contar(DO_OUTRO_CLIENTE)).toEqual(await contar(INEXISTENTE));
  });

  it("por negócio de outro cliente: fora da conversa", async () => {
    expect(await consultar({ lead_id: NEGOCIO_A2 }, noTurno())).toMatchObject({
      permitido: false,
      motivo: "fora_da_conversa",
    });
  });
});

describe("entrada e capacidade", () => {
  it("exige exatamente um alvo", async () => {
    expect(await consultar({})).toMatchObject({ permitido: false, motivo: "alvo_invalido" });
    expect(await consultar({ proposal_id: ENVIADA, lead_id: NEGOCIO_A })).toMatchObject({
      permitido: false,
      motivo: "alvo_invalido",
    });
  });

  it("não aceita a organização como argumento — ela vem do token", () => {
    const campos = Object.keys(crmGetProposal.inputSchema);
    expect(campos.sort()).toEqual(["lead_id", "proposal_id"]);
  });

  it("com propostas desligadas na organização, recusa sem consultar proposta nenhuma", async () => {
    h.capacidades = [];
    expect(await consultar({ proposal_id: ENVIADA })).toMatchObject({
      permitido: false,
      motivo: "propostas_desligadas",
    });
    expect(banco.consultas.crm_proposals ?? 0).toBe(0);
  });

  it("é leitura: nada é gravado em tabela nenhuma", async () => {
    const antes = JSON.stringify(banco.tabelas);
    await consultar({ proposal_id: ENVIADA });
    await consultar({ lead_id: NEGOCIO_A });
    expect(JSON.stringify(banco.tabelas)).toBe(antes);
  });
});

describe("⭐ no catálogo: quem alcança e por qual pacote aparece", () => {
  const NOME = "crm_get_proposal";
  const CATALOGO = TOOL_CATALOG.map((t) => ({ name: t.name, risco: t.risco, pacotes: t.pacotes }));

  it("tem handler, entrada de catálogo, é leitura e não é do harness nem só de pessoa", () => {
    expect(getToolByName(NOME)).toMatchObject({ category: "read", requiresScope: "mcp:read", requiresRole: "agent" });
    expect(catalogEntry(NOME)).toMatchObject({ category: "read", risco: "seguro", capacidade: "propostas" });
    expect(catalogEntry(NOME)!.apenasHumano).toBeFalsy();
    expect(IDS_DO_HARNESS.has(NOME)).toBe(false);
    expect(allTools.map((t) => t.name)).toContain(NOME);
  });

  it("o token de API comum (papel `agent`, escopo `mcp:read`) e o agente nativo alcançam; quem só lê, não", () => {
    const exigido = getToolByName(NOME)!;
    expect(() => ensureRole("agent", exigido.requiresRole)).not.toThrow();
    expect(() => ensureScope(["mcp:read"], exigido.requiresScope!)).not.toThrow();
    expect(ROLE_RANK.ai_operator >= ROLE_RANK[exigido.requiresRole]).toBe(true);
    expect(() => ensureRole("viewer", exigido.requiresRole)).toThrow();
  });

  it("entra pelo pacote `reter`, e só por ele", () => {
    expect(catalogEntry(NOME)!.pacotes).toEqual(["reter"]);
    for (const p of PACOTES) {
      const ligadas = ligarPacote([], CATALOGO as never, p.id);
      expect(ligadas.includes(NOME), `com o pacote ${p.id} ligado`).toBe(p.id === "reter");
    }
    expect(capacidadesAutomaticasDoPacote(CATALOGO as never, "reter")).toContain(NOME);
  });

  it("o agente que nasce no onboarding não a ganha, e `reter` continua cabendo no teto", () => {
    expect(ligarPacote([], CATALOGO as never, PACOTE_PADRAO_DO_ONBOARDING as never)).not.toContain(NOME);
    expect(vagasExigidasPeloPacote([], CATALOGO as never, "reter")).toBeLessThanOrEqual(TETO_TOOLS_POR_AGENTE);
  });

  it("com propostas desligadas na organização, a ferramenta não é oferecida", () => {
    expect(deCapacidadeDesligada(NOME, [])).toBe(true);
    expect(deCapacidadeDesligada(NOME, ["propostas"])).toBe(false);
  });

  describe("a ponte do turno", () => {
    const ator = { type: "ai_agent", id: "run-1", role: "ai_operator" };
    function montar(toolIds: string[], capacidades: string[]) {
      const supabase = { from: () => ({}) };
      return Object.keys(
        pickToolsFromMcp({
          toolIds,
          auth: { organizationId: ORG_A, role: "ai_operator", scopes: ["mcp:read", "mcp:write"], actor: ator, apiTokenId: "tok-1" },
          ctx: { organizationId: ORG_A, role: "ai_operator", actor: ator, apiTokenId: "tok-1", requestId: "req-1", supabase },
          supabase,
          pipelineIds: [],
          modulosLigados: MODULOS_OPCIONAIS,
          capacidadesLigadas: capacidades,
          handoffToolEnabled: false,
          handoffSignal: { triggered: false },
        } as never),
      );
    }

    it("ligada no agente e com propostas ligadas: chega ao modelo", () => {
      expect(montar([NOME], ["propostas"])).toContain(NOME);
    });
    it("sem ligar no agente: não chega", () => {
      expect(montar(["crm_get_lead"], ["propostas"])).not.toContain(NOME);
    });
    it("ligada no agente, propostas desligadas na organização: não chega", () => {
      expect(montar([NOME], [])).not.toContain(NOME);
    });
  });
});
