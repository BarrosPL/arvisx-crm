/**
 * AS NOVE FERRAMENTAS DA SUPERFÍCIE DE AGENTE (PR 1) NO CATÁLOGO — quem as
 * alcança, por qual pacote elas entram, e que a ponte do turno as monta só para
 * quem as ligou.
 *
 * Os comportamentos de cada uma estão nos arquivos `mcp-*-do-agente.test.ts` e
 * `mcp-*-do-negocio.test.ts`. Aqui fica o que é do conjunto: é o mesmo catálogo
 * para o agente externo (token de API) e para o nativo, e nenhuma delas fala
 * com o cliente.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: vi.fn().mockResolvedValue(undefined) }));

const { pickToolsFromMcp } = await import("@/lib/ai/runtime/tools");
const { ESCOPO_DAS_ESCRITAS } = await import("@/lib/ai/runtime/escopo-das-escritas");
const { ROLE_RANK } = await import("@/lib/auth/types");
const { MODULOS_OPCIONAIS } = await import("@/lib/instalacao/modulos");
const { ALVO_DE_FUNIL } = await import("@/lib/leads/escopo-de-funil");
const { allTools, getToolByName } = await import("@/lib/mcp/tools");
const { catalogEntry, TOOL_CATALOG } = await import("@/lib/mcp/tools/catalog");
const { IDS_DO_HARNESS } = await import("@/lib/mcp/tools/ferramentas-do-harness");
const { PACOTES } = await import("@/lib/mcp/tools/pacotes");
const {
  TETO_TOOLS_POR_AGENTE,
  capacidadesAutomaticasDoPacote,
  desligarPacote,
  ligarPacote,
  vagasExigidasPeloPacote,
} = await import("@/lib/mcp/tools/selecao-por-pacote");
const { CAPACIDADES_DA_ORGANIZACAO } = await import("@/lib/organizacao/capacidades");
const { PACOTE_PADRAO_DO_ONBOARDING } = await import("@/lib/ai/agents/capacidades-padrao");

/** Ferramenta → o pacote em que ela entra. */
const NOVAS = {
  crm_list_tasks: "organizar",
  crm_create_task: "organizar",
  crm_complete_task: "organizar",
  crm_update_task: "organizar",
  crm_list_lead_notes: "escalar",
  crm_add_lead_note: "escalar",
  crm_list_lead_attachments: "reter",
  crm_attach_to_lead: "reter",
  crm_set_next_action: "reter",
} as const;

const NOMES = Object.keys(NOVAS) as Array<keyof typeof NOVAS>;
const LEITURAS = ["crm_list_tasks", "crm_list_lead_notes", "crm_list_lead_attachments"];
const ESCRITAS = NOMES.filter((n) => !LEITURAS.includes(n));

const CATALOGO = TOOL_CATALOG.map((t) => ({ name: t.name, risco: t.risco, pacotes: t.pacotes }));

describe("as nove estão no catálogo, com handler", () => {
  it.each(NOMES)("%s tem handler e entrada de catálogo", (nome) => {
    expect(getToolByName(nome), `${nome} sem handler`).toBeDefined();
    expect(catalogEntry(nome), `${nome} sem entrada no catálogo`).toBeDefined();
  });

  it("leitura é leitura, escrita é escrita — e o risco anunciado acompanha", () => {
    for (const nome of LEITURAS) {
      expect(getToolByName(nome)).toMatchObject({ category: "read", requiresScope: "mcp:read" });
      expect(catalogEntry(nome)!.risco).toBe("seguro");
    }
    for (const nome of ESCRITAS) {
      expect(getToolByName(nome)).toMatchObject({ category: "write", requiresScope: "mcp:write" });
      expect(catalogEntry(nome)!.risco).toBe("atencao");
    }
  });

  it("nenhuma é do harness nem operada só por pessoa: o agente as alcança", () => {
    for (const nome of NOMES) {
      expect(IDS_DO_HARNESS.has(nome), `${nome} é do harness`).toBe(false);
      expect(catalogEntry(nome)!.apenasHumano, `${nome} é apenasHumano`).toBeFalsy();
    }
  });
});

describe("⭐ o mesmo catálogo serve o agente externo e o nativo", () => {
  it("papel mínimo `agent`: o token de API comum (sem `role:`) e o agente nativo alcançam as nove", () => {
    for (const nome of NOMES) {
      const exigido = getToolByName(nome)!.requiresRole;
      expect(exigido, nome).toBe("agent");
      // token de API sem escopo de papel resolve para `agent` (lib/mcp/auth.ts)
      expect(ROLE_RANK.agent >= ROLE_RANK[exigido]).toBe(true);
      // o agente nativo roda como `ai_operator`
      expect(ROLE_RANK.ai_operator >= ROLE_RANK[exigido]).toBe(true);
    }
  });

  it("quem só lê (viewer) não alcança nenhuma", () => {
    for (const nome of NOMES) {
      expect(ROLE_RANK.viewer >= ROLE_RANK[getToolByName(nome)!.requiresRole], nome).toBe(false);
    }
  });

  it("nenhuma aceita a organização como argumento — ela vem do token", () => {
    for (const nome of NOMES) {
      const campos = Object.keys(getToolByName(nome)!.inputSchema);
      expect(campos, nome).not.toContain("organization_id");
      expect(campos, nome).not.toContain("org_id");
    }
  });

  it("toda escrita tem dono declarado no turno e alvo de funil decidido", () => {
    for (const nome of ESCRITAS) {
      expect(Object.hasOwn(ESCOPO_DAS_ESCRITAS, nome), `${nome} sem ESCOPO_DAS_ESCRITAS`).toBe(true);
      expect(ALVO_DE_FUNIL[nome], `${nome} sem ALVO_DE_FUNIL`).toBeDefined();
    }
  });
});

describe("⭐ aparece / não aparece conforme o pacote", () => {
  it.each(NOMES)("%s entra pelo pacote dela, e só por ele", (nome) => {
    const pacote = NOVAS[nome];
    expect(catalogEntry(nome)!.pacotes).toEqual([pacote]);

    for (const p of PACOTES) {
      const ligadas = ligarPacote([], CATALOGO as never, p.id);
      expect(ligadas.includes(nome), `${nome} com o pacote ${p.id} ligado`).toBe(p.id === pacote);
    }
  });

  it("não falam com o cliente: nenhuma é `critico`, então o toggle do pacote as liga", () => {
    for (const nome of NOMES) {
      expect(capacidadesAutomaticasDoPacote(CATALOGO as never, NOVAS[nome])).toContain(nome);
    }
  });

  it("desligar o pacote tira as dele", () => {
    const comOrganizar = ligarPacote([], CATALOGO as never, "organizar");
    expect(comOrganizar).toContain("crm_create_task");
    const todos = PACOTES.map((p) => p.id);
    expect(desligarPacote(comOrganizar, CATALOGO as never, "organizar", todos)).not.toContain(
      "crm_create_task",
    );
  });

  it("o agente que nasce no onboarding NÃO ganha nenhuma das nove sem alguém ligar", () => {
    const doOnboarding = ligarPacote([], CATALOGO as never, PACOTE_PADRAO_DO_ONBOARDING as never);
    for (const nome of NOMES) expect(doOnboarding, nome).not.toContain(nome);
  });

  it("cada pacote que recebeu ferramenta continua cabendo sozinho no teto por agente", () => {
    for (const pacote of new Set(Object.values(NOVAS))) {
      expect(
        vagasExigidasPeloPacote([], CATALOGO as never, pacote),
        `o pacote ${pacote} deixou de caber em ${TETO_TOOLS_POR_AGENTE}`,
      ).toBeLessThanOrEqual(TETO_TOOLS_POR_AGENTE);
    }
  });
});

describe("⭐ a ponte do turno monta só o que o agente tem ligado", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const ator = { type: "ai_agent", id: "run-1", role: "ai_operator" };

  function montar(toolIds: string[]) {
    const supabase = { from: () => ({}) };
    return pickToolsFromMcp({
      toolIds,
      auth: { organizationId: ORG, role: "ai_operator", scopes: ["mcp:read", "mcp:write"], actor: ator, apiTokenId: "tok-1" },
      ctx: { organizationId: ORG, role: "ai_operator", actor: ator, apiTokenId: "tok-1", requestId: "req-1", supabase },
      supabase,
      pipelineIds: [],
      modulosLigados: MODULOS_OPCIONAIS,
      capacidadesLigadas: CAPACIDADES_DA_ORGANIZACAO,
      handoffToolEnabled: true,
      proposalAiDraftEnabled: true,
      handoffSignal: { triggered: false },
    } as never);
  }

  it("com as nove ligadas, as nove chegam ao modelo", () => {
    // A ponte pode somar as que ela mesma entrega (a passagem para humano, por
    // exemplo): o que se afirma é que NENHUMA das nove fica de fora.
    const montadas = Object.keys(montar([...NOMES]));
    for (const nome of NOMES) expect(montadas, nome).toContain(nome);
  });

  it("sem ligar, nenhuma chega — mesmo existindo no catálogo", () => {
    const montadas = Object.keys(montar(["crm_get_lead"]));
    for (const nome of NOMES) expect(montadas, nome).not.toContain(nome);
  });

  it("o catálogo servido ao cliente MCP externo é este mesmo: as nove estão em allTools", () => {
    const nomes = allTools.map((t) => t.name);
    for (const nome of NOMES) expect(nomes).toContain(nome);
  });
});
