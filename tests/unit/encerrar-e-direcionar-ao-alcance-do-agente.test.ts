/**
 * ENCERRAR O NEGÓCIO e DIRECIONAR A CONVERSA ao alcance do token de agente —
 * `crm_close_demand` e `crm_assign_conversation`.
 *
 * As duas já existiam. O que este arquivo prova é o conjunto que deixa um
 * agente usá-las de verdade: handler registrado, entrada de catálogo, papel
 * mínimo `agent` (o de um token de API sem escopo `role:`), escopo `mcp:write`
 * e pacote por onde a tela as oferece.
 *
 * O comportamento de cada uma está nos arquivos próprios
 * (`mcp-retencao-tools.test.ts`, `mcp-governance-tools.test.ts`,
 * `lib/leads/encerramento.test.ts`); aqui não se repete.
 *
 * ⚠️ `crm_close_demand` é `critico` de propósito (encerrar tira o negócio do
 * quadro): aparece no pacote `reter`, mas o toggle do pacote NÃO a liga — quem
 * configura marca à mão. Este teste guarda as duas metades.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: vi.fn().mockResolvedValue(undefined) }));

const { pickToolsFromMcp } = await import("@/lib/ai/runtime/tools");
const { ESCOPO_DAS_ESCRITAS } = await import("@/lib/ai/runtime/escopo-das-escritas");
const { ROLE_RANK } = await import("@/lib/auth/types");
const { MODULOS_OPCIONAIS } = await import("@/lib/instalacao/modulos");
const { ensureRole, ensureScope } = await import("@/lib/mcp/auth");
const { allTools, getToolByName } = await import("@/lib/mcp/tools");
const { catalogEntry, TOOL_CATALOG } = await import("@/lib/mcp/tools/catalog");
const { IDS_DO_HARNESS } = await import("@/lib/mcp/tools/ferramentas-do-harness");
const { capacidadesAutomaticasDoPacote, capacidadesCriticasDoPacote, ligarPacote } = await import(
  "@/lib/mcp/tools/selecao-por-pacote"
);
const { CAPACIDADES_DA_ORGANIZACAO } = await import("@/lib/organizacao/capacidades");

const ENCERRAR = "crm_close_demand";
const DIRECIONAR = "crm_assign_conversation";
const AS_DUAS = [ENCERRAR, DIRECIONAR];

const CATALOGO = TOOL_CATALOG.map((t) => ({ name: t.name, risco: t.risco, pacotes: t.pacotes }));

/** O que `lib/mcp/auth.ts` resolve para um token de API de agente: sem `role:`, papel `agent`. */
const TOKEN_DE_AGENTE = { role: "agent" as const, scopes: ["mcp:read", "mcp:write"] };

describe("as duas estão registradas e no catálogo", () => {
  it.each(AS_DUAS)("%s tem handler, entrada de catálogo e é servida ao cliente MCP externo", (nome) => {
    expect(getToolByName(nome), `${nome} sem handler`).toBeDefined();
    expect(catalogEntry(nome), `${nome} sem entrada no catálogo`).toBeDefined();
    expect(allTools.map((t) => t.name)).toContain(nome);
  });

  it.each(AS_DUAS)("%s não é do harness nem operada só por pessoa", (nome) => {
    expect(IDS_DO_HARNESS.has(nome)).toBe(false);
    expect(catalogEntry(nome)!.apenasHumano).toBeFalsy();
  });
});

describe("⭐ o token de agente (papel `agent`, escopo `mcp:write`) as alcança", () => {
  it.each(AS_DUAS)("%s: papel mínimo `agent` e escopo `mcp:write`", (nome) => {
    const t = getToolByName(nome)!;
    expect(t).toMatchObject({ category: "write", requiresRole: "agent", requiresScope: "mcp:write" });
    expect(() => ensureRole(TOKEN_DE_AGENTE.role, t.requiresRole)).not.toThrow();
    expect(() => ensureScope(TOKEN_DE_AGENTE.scopes, t.requiresScope!)).not.toThrow();
    // o agente nativo roda como `ai_operator`
    expect(ROLE_RANK.ai_operator >= ROLE_RANK[t.requiresRole]).toBe(true);
  });

  it.each(AS_DUAS)("%s: quem só lê não alcança, nem pelo papel nem pelo escopo", (nome) => {
    const t = getToolByName(nome)!;
    expect(() => ensureRole("viewer", t.requiresRole)).toThrow();
    expect(() => ensureScope(["mcp:read"], t.requiresScope!)).toThrow();
  });

  it.each(AS_DUAS)("%s: a organização não é argumento, e o alvo tem dono declarado no turno", (nome) => {
    const campos = Object.keys(getToolByName(nome)!.inputSchema);
    expect(campos).not.toContain("organization_id");
    expect(Object.hasOwn(ESCOPO_DAS_ESCRITAS, nome)).toBe(true);
  });

  it("crm_close_demand aceita ganho e perdido, com motivo", () => {
    const esquema = getToolByName(ENCERRAR)!.inputSchema as unknown as Record<
      string,
      { safeParse: (v: unknown) => { success: boolean } }
    >;
    expect(Object.keys(esquema).sort()).toEqual(["lead_id", "outcome", "reason"]);
    expect(esquema.outcome!.safeParse("won").success).toBe(true);
    expect(esquema.outcome!.safeParse("lost").success).toBe(true);
    expect(esquema.outcome!.safeParse("open").success).toBe(false);
    expect(esquema.reason!.safeParse("fechou com o concorrente").success).toBe(true);
  });
});

describe("⭐ aparecem no pacote", () => {
  it("crm_assign_conversation entra ligada por `escalar` e por `atender`", () => {
    expect([...catalogEntry(DIRECIONAR)!.pacotes].sort()).toEqual(["atender", "escalar"]);
    expect(catalogEntry(DIRECIONAR)!.risco).toBe("atencao");
    for (const pacote of ["escalar", "atender"] as const) {
      expect(capacidadesAutomaticasDoPacote(CATALOGO as never, pacote)).toContain(DIRECIONAR);
      expect(ligarPacote([], CATALOGO as never, pacote)).toContain(DIRECIONAR);
    }
  });

  it("crm_close_demand aparece em `reter` como crítica: o toggle não a liga, a marcação à mão sim", () => {
    expect(catalogEntry(ENCERRAR)!.pacotes).toEqual(["reter"]);
    expect(catalogEntry(ENCERRAR)!.risco).toBe("critico");
    expect(capacidadesCriticasDoPacote(CATALOGO as never, "reter")).toContain(ENCERRAR);
    expect(ligarPacote([], CATALOGO as never, "reter")).not.toContain(ENCERRAR);
  });
});

describe("a ponte do turno entrega as duas ao agente que as tem ligadas", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const ator = { type: "ai_agent", id: "run-1", role: "ai_operator" };

  function montar(toolIds: string[]) {
    const supabase = { from: () => ({}) };
    return Object.keys(
      pickToolsFromMcp({
        toolIds,
        auth: { organizationId: ORG, role: "ai_operator", scopes: ["mcp:read", "mcp:write"], actor: ator, apiTokenId: "tok-1" },
        ctx: { organizationId: ORG, role: "ai_operator", actor: ator, apiTokenId: "tok-1", requestId: "req-1", supabase },
        supabase,
        pipelineIds: [],
        modulosLigados: MODULOS_OPCIONAIS,
        capacidadesLigadas: CAPACIDADES_DA_ORGANIZACAO,
        handoffToolEnabled: false,
        handoffSignal: { triggered: false },
      } as never),
    );
  }

  it("ligadas: chegam ao modelo", () => {
    const montadas = montar(AS_DUAS);
    for (const nome of AS_DUAS) expect(montadas, nome).toContain(nome);
  });

  it("sem ligar: não chegam", () => {
    const montadas = montar(["crm_get_lead"]);
    for (const nome of AS_DUAS) expect(montadas, nome).not.toContain(nome);
  });
});
