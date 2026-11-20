/**
 * AS SEIS FERRAMENTAS DE COMENTÁRIOS NO MCP.
 *
 * A regra é de `lib/comentarios/acoes.ts` (medida em `lib/channels/meta-social/comentarios-acoes.test.ts`). Aqui se
 * mede o que é do MCP: que as ferramentas existem com o papel e o escopo
 * certos, que a organização e o autor vêm do CONTEXTO (nunca dos argumentos),
 * que a recusa volta como dado, e que as duas que falam com a pessoa são
 * críticas — nunca ligadas por pacote.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const acoes = vi.hoisted(() => ({
  listarComentarios: vi.fn(),
  lerComentario: vi.fn(),
  responderEmPublico: vi.fn(),
  responderEmPrivado: vi.fn(),
  ignorarComentario: vi.fn(),
  criarContatoDoComentario: vi.fn(),
}));
vi.mock("@/lib/comentarios/acoes", () => acoes);

import { ApiError } from "@/lib/api/types";
import { ROLE_RANK } from "@/lib/auth/types";
import { ensureRole, McpAuthError } from "@/lib/mcp/auth";
import { allTools, getToolByName } from "@/lib/mcp/tools";
import { catalogEntry, TOOL_CATALOG } from "@/lib/mcp/tools/catalog";
import { entraPorPacote } from "@/lib/mcp/tools/pacotes";
import { capacidadesAutomaticasDoPacote, capacidadesCriticasDoPacote } from "@/lib/mcp/tools/selecao-por-pacote";
import type { McpContext } from "@/lib/mcp/types";

const LEITURAS = ["crm_list_comments", "crm_get_comment"];
const ESCRITAS = ["crm_reply_comment", "crm_private_reply_comment", "crm_ignore_comment", "crm_create_contact_from_comment"];
const CRITICAS = ["crm_reply_comment", "crm_private_reply_comment"];
const TODAS = [...LEITURAS, ...ESCRITAS];

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "aaaaaaaa-0000-4000-8000-000000000001";
const banco = { marca: "banco-do-contexto" };

function ctx(extra: Partial<McpContext> = {}): McpContext {
  return {
    organizationId: ORG,
    role: "manager",
    actor: { type: "api_token", id: "tok-1", role: "manager" },
    apiTokenId: "tok-1",
    requestId: "req-1",
    supabase: banco as never,
    ...extra,
  };
}

const chamar = (nome: string, args: Record<string, unknown>, c = ctx()) =>
  getToolByName(nome)!.handler(args as never, c) as Promise<Record<string, unknown>>;

beforeEach(() => {
  for (const f of Object.values(acoes)) f.mockReset().mockResolvedValue({ ok: true });
});

describe("catálogo e registro", () => {
  it("as seis existem, com handler e entrada no catálogo", () => {
    for (const nome of TODAS) {
      expect(getToolByName(nome), `${nome} sem handler`).toBeDefined();
      expect(catalogEntry(nome), `${nome} fora do catálogo`).toBeDefined();
    }
  });

  it("⭐ papel mínimo de gerente e escopo por categoria: token comum (papel de atendente) não alcança", () => {
    for (const nome of TODAS) {
      const t = getToolByName(nome)!;
      expect(t.requiresRole, nome).toBe("manager");
      expect(t.requiresScope, nome).toBe(LEITURAS.includes(nome) ? "mcp:read" : "mcp:write");
      expect(t.category, nome).toBe(LEITURAS.includes(nome) ? "read" : "write");
      // O papel de um token sem `role:` é `agent`; o do agente publicado, `ai_operator`.
      for (const papel of ["agent", "ai_operator"] as const) {
        expect(() => ensureRole(papel, t.requiresRole), `${nome} alcançável por ${papel}`).toThrow(McpAuthError);
      }
      expect(() => ensureRole("manager", t.requiresRole)).not.toThrow();
      expect(ROLE_RANK[t.requiresRole]).toBeGreaterThan(ROLE_RANK.ai_operator);
      expect(catalogEntry(nome)!.apenasHumano, `${nome} sem a marca de fora do atendimento`).toBe(true);
    }
  });

  it("⭐ as duas de resposta são críticas e NUNCA entram por pacote; as outras quatro não são críticas", () => {
    for (const nome of TODAS) {
      const risco = catalogEntry(nome)!.risco;
      expect(risco === "critico", nome).toBe(CRITICAS.includes(nome));
      expect(entraPorPacote(risco), nome).toBe(!CRITICAS.includes(nome));
    }
    const catalogo = TOOL_CATALOG.map((t) => ({ name: t.name, risco: t.risco, pacotes: t.pacotes }));
    const pacotes = [...new Set(TODAS.flatMap((n) => [...catalogEntry(n)!.pacotes]))];
    expect(pacotes.length).toBeGreaterThan(0);
    for (const pacote of pacotes) {
      const automaticas = capacidadesAutomaticasDoPacote(catalogo as never, pacote as never).map(String);
      const criticas = capacidadesCriticasDoPacote(catalogo as never, pacote as never).map(String);
      for (const nome of CRITICAS) {
        expect(JSON.stringify(automaticas), `${nome} entra ligada pelo pacote ${pacote}`).not.toContain(`"${nome}"`);
        expect(JSON.stringify(criticas), `${nome} não é listada como crítica de ${pacote}`).toContain(nome);
      }
    }
  });

  it("nenhuma aceita `organization_id` nos argumentos", () => {
    for (const nome of TODAS) {
      expect(Object.keys(getToolByName(nome)!.inputSchema), nome).not.toContain("organization_id");
    }
    expect(allTools.filter((t) => TODAS.includes(t.name))).toHaveLength(6);
  });
});

describe("o handler entrega à regra o que é do CONTEXTO", () => {
  const quem = { actor: { type: "api_token", id: "tok-1", role: "manager" }, apiTokenId: "tok-1", requestId: "req-1", via: "mcp" };

  it("⭐ organização, banco e autor vêm do contexto em todas as seis", async () => {
    await chamar("crm_list_comments", { estado: "novo", limite: 10 });
    expect(acoes.listarComentarios).toHaveBeenCalledWith(banco, ORG, { estado: "novo", limite: 10 }, quem);

    await chamar("crm_get_comment", { id: ID });
    expect(acoes.lerComentario).toHaveBeenCalledWith(banco, ORG, ID, quem);

    await chamar("crm_reply_comment", { id: ID, text: "Olá!" });
    expect(acoes.responderEmPublico).toHaveBeenCalledWith(banco, ORG, ID, { text: "Olá!", confirmar_reenvio: undefined }, quem);

    await chamar("crm_private_reply_comment", { id: ID, text: "oi", criar_contato: true });
    expect(acoes.responderEmPrivado).toHaveBeenCalledWith(
      banco,
      ORG,
      ID,
      { text: "oi", criar_contato: true, confirmar_reenvio: undefined },
      quem,
    );

    await chamar("crm_ignore_comment", { id: ID, motivo: "elogio" });
    expect(acoes.ignorarComentario).toHaveBeenCalledWith(banco, ORG, ID, { motivo: "elogio" }, quem);

    const funil = "ffffffff-0000-4000-8000-000000000001";
    await chamar("crm_create_contact_from_comment", { id: ID, pipeline_id: funil });
    expect(acoes.criarContatoDoComentario).toHaveBeenCalledWith(
      banco,
      ORG,
      ID,
      { pipeline_id: funil, stage_id: undefined, title: undefined },
      quem,
    );
  });

  it("⭐ recusa de negócio volta como dado legível, com o código e os detalhes", async () => {
    acoes.responderEmPublico.mockRejectedValueOnce(
      new ApiError(409, "ja_respondido", { resposta: { texto: "primeira" } }, "req-1", "Este comentário já foi respondido."),
    );
    expect(await chamar("crm_reply_comment", { id: ID, text: "x" })).toEqual({
      permitido: false,
      motivo: "ja_respondido",
      mensagem: "Este comentário já foi respondido.",
      detalhes: { resposta: { texto: "primeira" } },
    });
    acoes.responderEmPrivado.mockRejectedValueOnce(new ApiError(422, "janela_de_7_dias", undefined, "req-1", "prazo"));
    expect(await chamar("crm_private_reply_comment", { id: ID, text: "x" })).toMatchObject({
      permitido: false,
      motivo: "janela_de_7_dias",
    });
  });

  it("defeito não vira recusa: erro inesperado e erro interno sobem", async () => {
    acoes.lerComentario.mockRejectedValueOnce(new Error("banco fora"));
    await expect(chamar("crm_get_comment", { id: ID })).rejects.toThrow("banco fora");
    acoes.lerComentario.mockRejectedValueOnce(new ApiError(500, "internal_error", undefined, "req-1", "x"));
    await expect(chamar("crm_get_comment", { id: ID })).rejects.toBeInstanceOf(ApiError);
  });

  it("⭐ dentro de um atendimento (contato do turno) as seis recusam sem tocar na regra", async () => {
    const turno = ctx({ contatoDoTurno: "22222222-2222-4222-8222-222222222222" });
    for (const nome of TODAS) {
      expect(await chamar(nome, { id: ID, text: "x" }, turno)).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
    }
    for (const f of Object.values(acoes)) expect(f).not.toHaveBeenCalled();
  });

  it("entradas tortas são recusadas antes da regra", async () => {
    expect(await chamar("crm_list_comments", { desde: "ontem" })).toMatchObject({ permitido: false, motivo: "validation_error" });
    expect(acoes.listarComentarios).not.toHaveBeenCalled();
    expect(
      await chamar("crm_create_contact_from_comment", { id: ID, stage_id: "ffffffff-0000-4000-8000-000000000002" }),
    ).toMatchObject({ permitido: false, motivo: "validation_error" });
    expect(acoes.criarContatoDoComentario).not.toHaveBeenCalled();
  });
});
