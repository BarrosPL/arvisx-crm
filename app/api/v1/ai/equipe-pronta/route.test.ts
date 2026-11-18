// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Instalar from "@/lib/ai/equipe-pronta/instalar";

/**
 * AS ROTAS DA EQUIPE DE IA PRONTA — a camada que a rota acrescenta.
 *
 * A regra (instalar, estado, ativar) tem teste próprio. Aqui fica o que é da
 * BORDA: quem pode chamar, de onde vem a organização, o que é validado, como a
 * recusa de negócio chega à tela e o que vai para a trilha de auditoria.
 */
const requireRole = vi.hoisted(() => vi.fn());
const audit = vi.hoisted(() => vi.fn(async () => undefined));
const consulta = vi.hoisted(() => vi.fn());
const instalar = vi.hoisted(() => vi.fn());
const lerEstado = vi.hoisted(() => vi.fn());
const ativar = vi.hoisted(() => vi.fn());
const pausar = vi.hoisted(() => vi.fn());
const retomar = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/require-role", () => ({ requireRole }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: () => ({ query: consulta }) }));
vi.mock("@/lib/ai/equipe-pronta/portas", () => ({ portasDeProducao: () => ({}) }));
vi.mock("@/lib/ai/equipe-pronta/portas-do-estado", () => ({ portasDoEstadoDeProducao: () => ({}) }));
vi.mock("@/lib/ai/equipe-pronta/estado", () => ({ lerEstadoDaEquipe: lerEstado }));
vi.mock("@/lib/ai/equipe-pronta/modo", () => ({
  ativarEquipePronta: ativar,
  pausarEquipePronta: pausar,
  retomarEquipePronta: retomar,
}));
vi.mock("@/lib/ai/equipe-pronta/instalar", async (original) => {
  const real = await original<typeof Instalar>();
  return { ...real, instalarEquipePronta: instalar };
});

const { EquipeProntaError } = await import("@/lib/ai/equipe-pronta/instalar");
const perfil = await import("./route");
const rotaDeInstalar = await import("./instalar/route");
const rotaDeAtivar = await import("./ativar/route");
const rotaDePausar = await import("./pausar/route");
const rotaDeRetomar = await import("./retomar/route");

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function pedido(corpo?: unknown, metodo = "POST"): NextRequest {
  return new NextRequest("http://localhost/api/v1/ai/equipe-pronta", {
    method: metodo,
    ...(corpo === undefined ? {} : { body: typeof corpo === "string" ? corpo : JSON.stringify(corpo) }),
  });
}
interface Corpo {
  data?: Record<string, unknown>;
  error?: { code?: string; details?: Record<string, unknown> };
}
const corpoDe = async (r: Response) => (await r.json()) as Corpo;

beforeEach(() => {
  vi.clearAllMocks();
  requireRole.mockResolvedValue({
    ok: true,
    user: { id: USER, idioma: "pt-BR" },
    org: { orgId: ORG, role: "admin" },
  });
});

describe("quem pode chamar", () => {
  it("ler e salvar o perfil: manager; instalar, ativar, pausar e retomar: admin", async () => {
    lerEstado.mockResolvedValue({});
    consulta.mockResolvedValue({ rows: [{ respostas: {}, estado: "rascunho", modo: "ensaio" }] });
    instalar.mockResolvedValue({ instalacao: {}, agentes: [], criados: [] });
    ativar.mockResolvedValue({ modo: "ativo", channel_session_id: "c" });
    pausar.mockResolvedValue({ pausada: true, modo: "ensaio", agentes_pausados: [] });
    retomar.mockResolvedValue({ pausada: false, modo: "ensaio", agentes_religados: [] });

    await perfil.GET();
    await perfil.PUT(pedido({ respostas: {} }, "PUT"));
    await rotaDeInstalar.POST(pedido({}));
    await rotaDeAtivar.POST();
    await rotaDePausar.POST();
    await rotaDeRetomar.POST();

    expect(requireRole.mock.calls.map((c) => c[0])).toEqual([
      "manager",
      "manager",
      "admin",
      "admin",
      "admin",
      "admin",
    ]);
  });

  it("a recusa do guarda (papel ou plano) sai como veio, e nada roda", async () => {
    const recusa = new Response(JSON.stringify({ error: { code: "fora_do_plano:/app/ai/equipe-pronta" } }), {
      status: 403,
    });
    requireRole.mockResolvedValue({ ok: false, response: recusa });

    const r = await rotaDeInstalar.POST(pedido({}));

    expect(r.status).toBe(403);
    expect(instalar).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("PUT — salvar o rascunho", () => {
  it("grava na organização da SESSÃO, juntando por bloco, e audita só os nomes dos blocos", async () => {
    consulta.mockResolvedValue({ rows: [{ respostas: { negocio: { nome: "A" } }, estado: "rascunho", modo: "ensaio" }] });

    const r = await perfil.PUT(pedido({ respostas: { negocio: { nome: "A" }, atendente: { nome: "Ana" } } }, "PUT"));

    expect(r.status).toBe(200);
    const [sql, params] = consulta.mock.calls[0]!;
    expect(params[0]).toBe(ORG);
    expect(params[2]).toBe(USER);
    // Junta por bloco no banco: um passo salvo não apaga os anteriores.
    expect(String(sql)).toContain("equipe_pronta_perfis.respostas || excluded.respostas");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai.equipe_pronta_perfil_salvo",
        organizationId: ORG,
        actorUserId: USER,
        metadata: { blocos: ["atendente", "negocio"] },
      }),
    );
    // As respostas descrevem o negócio do cliente: não vão para a auditoria.
    expect(JSON.stringify(audit.mock.calls)).not.toContain("Ana");
  });

  it.each([
    ["corpo que não é JSON", "{"],
    ["sem `respostas`", {}],
    ["organização no corpo", { respostas: {}, organization_id: "33333333-3333-4333-8333-333333333333" }],
    ["bloco desconhecido", { respostas: { segredo: {} } }],
    ["valor fora do vocabulário", { respostas: { atendente: { tom: "agressivo" } } }],
  ])("%s: 422, e nada é gravado", async (_nome, corpo) => {
    const r = await perfil.PUT(pedido(corpo, "PUT"));

    expect(r.status).toBe(422);
    expect(consulta).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("POST instalar", () => {
  it("instala na organização da sessão e audita o que foi criado", async () => {
    instalar.mockResolvedValue({
      instalacao: { router_id: "r1", channel_session_id: "c1" },
      agentes: [{ papel: "sdr", agent_id: "a1", version_id: "v1", acao: "criado", publicado: true, motivo_sem_publicar: null }],
      criados: ["agente_sdr", "roteador"],
    });

    const r = await rotaDeInstalar.POST(pedido({}));

    expect(r.status).toBe(200);
    expect(instalar.mock.calls[0]![2]).toEqual({ orgId: ORG, userId: USER });
    expect(instalar.mock.calls[0]![3]).toEqual({ forcar: false });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai.equipe_pronta_instalada",
        organizationId: ORG,
        metadata: expect.objectContaining({ forcar: false, criados: ["agente_sdr", "roteador"], router_id: "r1" }),
      }),
    );
  });

  it("sem corpo nenhum também instala (o caso comum), e `forcar` chega quando vem", async () => {
    instalar.mockResolvedValue({ instalacao: {}, agentes: [], criados: [] });

    expect((await rotaDeInstalar.POST(pedido())).status).toBe(200);
    await rotaDeInstalar.POST(pedido({ forcar: true }));

    expect(instalar.mock.calls.map((c) => c[3])).toEqual([{ forcar: false }, { forcar: true }]);
  });

  it("⭐ agente editado à mão: 409 com a lista, e a instalação recusada NÃO é auditada como feita", async () => {
    instalar.mockRejectedValue(
      new EquipeProntaError("agentes_editados_a_mao", "Há agentes alterados fora da equipe pronta.", 409, {
        agentes: [{ papel: "sdr", agent_id: "a1" }],
      }),
    );

    const r = await rotaDeInstalar.POST(pedido({}));

    expect(r.status).toBe(409);
    expect(await corpoDe(r)).toMatchObject({
      error: {
        code: "equipe_pronta_agentes_editados_a_mao",
        details: { agentes: [{ papel: "sdr", agent_id: "a1" }] },
      },
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it("falha inesperada: 500 genérico, sem ecoar a mensagem do banco", async () => {
    instalar.mockRejectedValue(new Error('relation "ai_agents" does not exist'));

    const r = await rotaDeInstalar.POST(pedido({}));

    expect(r.status).toBe(500);
    const texto = JSON.stringify(await corpoDe(r));
    expect(texto).toContain("internal_error");
    expect(texto).not.toContain("relation");
  });

  it("`forcar` que não é booleano: 422", async () => {
    expect((await rotaDeInstalar.POST(pedido({ forcar: "sim" }))).status).toBe(422);
    expect(instalar).not.toHaveBeenCalled();
  });
});

describe("POST ativar e pausar", () => {
  it("⭐ ativar com checklist pendente: 409 com os itens, sem auditar", async () => {
    ativar.mockRejectedValue(
      new EquipeProntaError("checklist_pendente", "Ainda há itens pendentes.", 409, {
        pendentes: [{ id: "whatsapp_conectado", texto: "Conecte o WhatsApp.", link: "/app/connections" }],
      }),
    );

    const r = await rotaDeAtivar.POST();

    expect(r.status).toBe(409);
    expect((await corpoDe(r)).error).toMatchObject({
      code: "equipe_pronta_checklist_pendente",
      details: { pendentes: [{ id: "whatsapp_conectado", link: "/app/connections" }] },
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it("ativar, pausar e retomar auditam o que mudou", async () => {
    ativar.mockResolvedValue({ modo: "ativo", channel_session_id: "c1" });
    pausar.mockResolvedValue({ pausada: true, modo: "ativo", agentes_pausados: ["a1", "a2"] });
    retomar.mockResolvedValue({ pausada: false, modo: "ativo", agentes_religados: ["a1", "a2"] });

    expect((await rotaDeAtivar.POST()).status).toBe(200);
    expect((await rotaDePausar.POST()).status).toBe(200);
    expect((await rotaDeRetomar.POST()).status).toBe(200);

    expect(audit.mock.calls.map((c) => (c as unknown as [{ action: string; metadata: unknown }])[0])).toEqual([
      expect.objectContaining({ action: "ai.equipe_pronta_ativada", metadata: { channel_session_id: "c1" } }),
      // A pausa é dos AGENTES: o canal não aparece porque não é tocado.
      expect.objectContaining({
        action: "ai.equipe_pronta_pausada",
        metadata: { modo: "ativo", agentes_pausados: ["a1", "a2"] },
      }),
      expect.objectContaining({
        action: "ai.equipe_pronta_retomada",
        metadata: { modo: "ativo", agentes_religados: ["a1", "a2"] },
      }),
    ]);
    expect(ativar.mock.calls[0]![3]).toEqual({ orgId: ORG, userId: USER });
    expect(pausar.mock.calls[0]![1]).toEqual({ orgId: ORG, userId: USER });
    expect(retomar.mock.calls[0]![1]).toEqual({ orgId: ORG, userId: USER });
  });

  it("⭐ instalar num canal que já tem roteador: 409 com a lista, sem auditar", async () => {
    instalar.mockRejectedValue(
      new EquipeProntaError("canal_com_roteador", "Este WhatsApp já tem um roteador.", 409, {
        roteador: { id: "r1", nome: "Atendimento", de_fora: true, fallback: null, membros: [] },
      }),
    );

    const r = await rotaDeInstalar.POST(pedido({}));

    expect(r.status).toBe(409);
    expect((await corpoDe(r)).error).toMatchObject({
      code: "equipe_pronta_canal_com_roteador",
      details: { roteador: { id: "r1", nome: "Atendimento" } },
    });
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("GET — o estado", () => {
  it("lê o estado da organização da sessão, sem cache", async () => {
    lerEstado.mockResolvedValue({ estado: "instalado", modo: "ensaio", checklist: [], pode_ativar: false });

    const r = await perfil.GET();

    expect(r.status).toBe(200);
    expect(lerEstado.mock.calls[0]![2]).toBe(ORG);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect((await corpoDe(r)).data).toMatchObject({ estado: "instalado", modo: "ensaio" });
  });
});
