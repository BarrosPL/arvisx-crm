/**
 * /api/v1/channels/meta-social — as guardas da conexão direta.
 *
 * O que se prova: a organização vem da SESSÃO (o estado e o lacre de outra
 * organização ou pessoa não abrem nada), o app não configurado na instalação
 * recusa com a frase para o admin, e o corpo só ESCOLHE dentre as páginas que a
 * própria pessoa autorizou na Meta.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { emitirEstadoDaVolta } from "@/lib/channels/estado-da-volta";
import { lacrarSelecao } from "@/lib/channels/meta-social/selecao";

const SEGREDO = "segredo-interno-com-mais-de-16-caracteres";

const h = vi.hoisted(() => ({
  role: vi.fn(),
  mfa: vi.fn(),
  support: vi.fn(),
  audit: vi.fn(),
  limit: vi.fn(),
  app: { appId: "555", appSecret: "app-secret", verifyToken: "v" } as {
    appId: string | null;
    appSecret: string | null;
    verifyToken: string | null;
  },
  troca: vi.fn(),
  paginas: vi.fn(),
  negadas: vi.fn(),
  conectar: vi.fn(),
  conexoes: vi.fn(),
  desconectar: vi.fn(),
  concedidos: vi.fn(),
  modo: vi.fn(),
}));

vi.mock("@/lib/env", async (original) => {
  const { env: real } = await original<{ env: Record<string, unknown> }>();
  return {
    env: new Proxy(real, {
      get: (alvo, chave) =>
        chave === "NEXT_PUBLIC_APP_URL"
          ? "https://crm.exemplo.com"
          : chave === "INTERNAL_SECRET"
            ? "segredo-interno-com-mais-de-16-caracteres"
            : alvo[chave as string],
    }),
  };
});
vi.mock("@/lib/auth/require-role", () => ({ requireRole: h.role }));
vi.mock("@/lib/auth/server", () => ({ mfaEmDivida: h.mfa }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: h.support }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: h.limit }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/channels/meta-social/app", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  appDaConexaoDireta: async () => h.app,
}));
vi.mock("@/lib/channels/meta-social/oauth", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  tokenDeUsuarioDeLongaDuracao: h.troca,
  paginasDoUsuario: h.paginas,
  permissoesNegadas: h.negadas,
  escoposConcedidos: h.concedidos,
  idDoUsuarioNoApp: async () => "777",
}));
vi.mock("@/lib/channels/meta-social/store", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  conectarPagina: h.conectar,
  conexoesDiretas: h.conexoes,
  desconectarSessao: h.desconectar,
  definirModoDeComentarios: h.modo,
}));

import { GET, POST } from "./route";

const chamar = (corpo: unknown) =>
  POST(new Request("https://crm.test/api/v1/channels/meta-social", { method: "POST", body: JSON.stringify(corpo) }) as never);

const PAGINA = { id: "111", nome: "Loja", token: "page-token", instagram: { id: "17840", username: "loja" }, podeMensagens: true };

function estado(org = "org-1", user = "admin-1") {
  return emitirEstadoDaVolta({ organizationId: org, userId: user, profileId: "meta-social" }, { segredo: SEGREDO, agora: new Date() });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.app = { appId: "555", appSecret: "app-secret", verifyToken: "v" };
  h.role.mockResolvedValue({ ok: true, org: { orgId: "org-1", name: "Loja" }, user: { id: "admin-1", idioma: "pt-BR" } });
  h.mfa.mockResolvedValue(false);
  h.support.mockResolvedValue(null);
  h.limit.mockResolvedValue({ allowed: true });
  h.troca.mockResolvedValue("user-token");
  h.paginas.mockResolvedValue([PAGINA]);
  h.negadas.mockResolvedValue([]);
  h.concedidos.mockResolvedValue(["instagram_basic", "instagram_manage_comments", "pages_read_engagement"]);
  h.modo.mockResolvedValue({ anterior: "off", atual: "registrar" });
  h.conexoes.mockResolvedValue([]);
  h.conectar.mockResolvedValue([{ channelSessionId: "s1", rede: "facebook", conta: "111", nome: "Loja", jaExistia: false }]);
});

describe("guardas", () => {
  it("quem não é admin da organização não passa", async () => {
    h.role.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await chamar({ acao: "iniciar" })).status).toBe(403);
  });

  it("app da Meta não configurado na instalação: 503 com a frase para o admin, e o GET diz o que falta", async () => {
    h.app = { appId: null, appSecret: "app-secret", verifyToken: "v" };
    const r = await chamar({ acao: "iniciar" });
    expect(r.status).toBe(503);
    const corpo = (await r.json()) as { error: { code: string; message: string; details: { falta: string[] } } };
    expect(corpo.error.code).toBe("meta_app_nao_configurado");
    expect(corpo.error.message).toMatch(/App ID/);
    expect(corpo.error.details.falta).toContain("sem_app_id");
    const g = (await (await GET()).json()) as { data: { disponivel: boolean; falta: string[] } };
    expect(g.data).toMatchObject({ disponivel: false, falta: ["sem_app_id"] });
  });
});

describe("iniciar", () => {
  it("devolve o login do Facebook com o app, a volta cadastrada, as permissões e o estado", async () => {
    const r = await chamar({ acao: "iniciar" });
    const url = new URL(((await r.json()) as { data: { url: string } }).data.url);
    expect(url.hostname).toBe("www.facebook.com");
    expect(url.searchParams.get("client_id")).toBe("555");
    expect(url.searchParams.get("redirect_uri")).toBe("https://crm.exemplo.com/auth/meta-social-return");
    expect(url.searchParams.get("scope")).toBe(
      "pages_show_list,pages_messaging,pages_manage_metadata,instagram_basic,instagram_manage_messages,business_management",
    );
    expect(url.searchParams.get("auth_type")).toBe("rerequest");
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
  });

  // Revisão de 20/11, item 2.20: login em duas fases.
  it("⭐ o login normal NÃO pede as permissões de comentários (nem com `para_comentarios: false`)", async () => {
    for (const corpo of [{ acao: "iniciar" }, { acao: "iniciar", para_comentarios: false }]) {
      const r = await chamar(corpo);
      const escopos = new URL(((await r.json()) as { data: { url: string } }).data.url).searchParams.get("scope")!;
      expect(escopos).not.toContain("instagram_manage_comments");
      expect(escopos).not.toContain("pages_read_engagement");
    }
  });

  it("⭐ a reautorização para comentários é um login próprio: pede as do login normal mais as duas", async () => {
    const r = await chamar({ acao: "iniciar", para_comentarios: true });
    expect(r.status).toBe(200);
    const url = new URL(((await r.json()) as { data: { url: string } }).data.url);
    expect(url.searchParams.get("scope")).toBe(
      "pages_show_list,pages_messaging,pages_manage_metadata,instagram_basic,instagram_manage_messages,business_management,instagram_manage_comments,pages_read_engagement",
    );
    expect(url.searchParams.get("auth_type")).toBe("rerequest");
    expect(url.searchParams.get("redirect_uri")).toBe("https://crm.exemplo.com/auth/meta-social-return");
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
  });

  it("`para_comentarios` que não é booleano é recusado na validação", async () => {
    expect((await chamar({ acao: "iniciar", para_comentarios: "sim" })).status).toBe(400);
  });
});

describe("concluir", () => {
  it("estado de OUTRA organização ou de OUTRA pessoa não abre (e o código não é trocado)", async () => {
    for (const e of [estado("org-2"), estado("org-1", "outra-pessoa")]) {
      const r = await chamar({ acao: "concluir", estado: e, code: "codigo-da-meta-123" });
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe("state_invalid");
    }
    expect(h.troca).not.toHaveBeenCalled();
  });

  it("cancelado na Meta: recusa com a frase, sem trocar código", async () => {
    const r = await chamar({ acao: "concluir", estado: estado(), erro: "access_denied" });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("permissao_negada");
    expect(h.troca).not.toHaveBeenCalled();
  });

  it("permissão obrigatória negada: recusa nomeando o problema", async () => {
    h.negadas.mockResolvedValue(["pages_messaging"]);
    const r = await chamar({ acao: "concluir", estado: estado(), code: "codigo-da-meta-123" });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { message: string } }).error.message).toMatch(/permiss/);
  });

  it("⭐ negar SÓ as permissões de comentários não barra a conexão nem tira o Instagram", async () => {
    h.negadas.mockResolvedValue(["instagram_manage_comments", "pages_read_engagement"]);
    const r = await chamar({ acao: "concluir", estado: estado(), code: "codigo-da-meta-123" });
    expect(r.status).toBe(200);
    const { data } = (await r.json()) as { data: { instagram_permitido: boolean; paginas: { instagram: unknown }[] } };
    expect(data.instagram_permitido).toBe(true);
    expect(data.paginas[0]!.instagram).toEqual({ id: "17840", username: "loja" });
  });

  it("sucesso: lista as páginas SEM o token e devolve a seleção lacrada", async () => {
    const r = await chamar({ acao: "concluir", estado: estado(), code: "codigo-da-meta-123" });
    expect(r.status).toBe(200);
    const texto = await r.text();
    expect(texto).not.toContain("page-token");
    expect(texto).not.toContain("user-token");
    const { data } = JSON.parse(texto) as { data: { paginas: unknown[]; selecao: string } };
    expect(data.paginas).toEqual([{ id: "111", nome: "Loja", pode_mensagens: true, instagram: { id: "17840", username: "loja" } }]);
    expect(h.troca).toHaveBeenCalledWith(
      expect.objectContaining({ code: "codigo-da-meta-123", redirectUri: "https://crm.exemplo.com/auth/meta-social-return" }),
    );
  });
});

describe("conectar", () => {
  const lacre = (org = "org-1", user = "admin-1") =>
    lacrarSelecao({ organizationId: org, userId: user, tokenDoUsuario: "user-token", metaUserId: "777" }, { segredo: SEGREDO, agora: new Date() });

  it("grava na organização da SESSÃO a página escolhida", async () => {
    const r = await chamar({ acao: "conectar", selecao: lacre(), page_id: "111", redes: ["facebook", "instagram"] });
    expect(r.status).toBe(200);
    expect(h.conectar).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ organizationId: "org-1", pagina: PAGINA, redes: ["facebook", "instagram"], metaUserId: "777" }),
    );
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "channel.connected", organizationId: "org-1" }));
  });

  it("guarda na conexão o que a pessoa concedeu; não conseguir perguntar à Meta não impede conectar", async () => {
    await chamar({ acao: "conectar", selecao: lacre(), page_id: "111", redes: ["instagram"] });
    expect(h.concedidos).toHaveBeenCalledWith("user-token", "app-secret");
    expect(h.conectar).toHaveBeenLastCalledWith(
      {},
      expect.objectContaining({
        escoposConcedidos: ["instagram_basic", "instagram_manage_comments", "pages_read_engagement"],
      }),
    );
    h.concedidos.mockRejectedValue(new Error("a Meta não respondeu"));
    const r = await chamar({ acao: "conectar", selecao: lacre(), page_id: "111", redes: ["instagram"] });
    expect(r.status).toBe(200);
    expect(h.conectar).toHaveBeenLastCalledWith({}, expect.objectContaining({ escoposConcedidos: null }));
  });

  it("lacre de outra organização não abre — isolamento entre organizações", async () => {
    const r = await chamar({ acao: "conectar", selecao: lacre("org-2"), page_id: "111", redes: ["facebook"] });
    expect(r.status).toBe(400);
    expect(h.conectar).not.toHaveBeenCalled();
  });

  it("página que a pessoa não autorizou: 404, nada gravado", async () => {
    const r = await chamar({ acao: "conectar", selecao: lacre(), page_id: "999", redes: ["facebook"] });
    expect(r.status).toBe(404);
    expect(h.conectar).not.toHaveBeenCalled();
  });
});

describe("desconectar", () => {
  it("desconecta na organização da sessão e audita", async () => {
    h.desconectar.mockResolvedValue({ desassinada: "sim", avisos: "resolvido" });
    const id = "6a0f6a1e-5d7b-4c55-9f4d-6f7a3c1e2b10";
    const r = await chamar({ acao: "desconectar", channel_session_id: id });
    expect(r.status).toBe(200);
    expect(h.desconectar).toHaveBeenCalledWith({}, "org-1", id, "app-secret");
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "channel.social_disconnected" }));
  });
});

describe("comentários do Instagram", () => {
  const ID = "6a0f6a1e-5d7b-4c55-9f4d-6f7a3c1e2b10";

  it("o GET diz o estado dos comentários de cada conexão do Instagram, e só delas", async () => {
    h.conexoes.mockResolvedValue([
      { id: "s-fb", rede: "facebook", conta: "111", displayName: "facebook · Loja", status: "WORKING", metadata: {} },
      {
        id: "s-antiga",
        rede: "instagram",
        conta: "17840",
        displayName: "instagram · @loja",
        status: "WORKING",
        metadata: { social_platform: "instagram" },
      },
      {
        id: "s-nova",
        rede: "instagram",
        conta: "17841",
        displayName: "instagram · @outra",
        status: "WORKING",
        metadata: {
          comentarios_modo: "registrar",
          meta_escopos_concedidos: ["instagram_manage_comments", "pages_read_engagement"],
        },
      },
    ]);
    const { data } = (await (await GET()).json()) as { data: { conexoes: Record<string, unknown>[] } };
    expect(data.conexoes[0]).not.toHaveProperty("comentarios");
    // Conexão antiga: segue ativa para mensagens, e diz que falta a permissão.
    expect(data.conexoes[1]).toMatchObject({
      status: "WORKING",
      comentarios: { modo: "off", escopo_concedido: false, disponivel: false },
    });
    expect(data.conexoes[2]).toMatchObject({
      comentarios: { modo: "registrar", escopo_concedido: true, disponivel: true },
    });
  });

  it("⭐ mudar o modo: na organização da SESSÃO, e auditado com o antes e o depois", async () => {
    const r = await chamar({ acao: "comentarios_modo", channel_session_id: ID, modo: "registrar" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: unknown }).data).toEqual({ modo: "registrar", alterado: true });
    expect(h.modo).toHaveBeenCalledWith({}, "org-1", ID, "registrar");
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "channel.comentarios_modo_alterado",
        actorUserId: "admin-1",
        organizationId: "org-1",
        resourceType: "channel_session",
        resourceId: ID,
        metadata: expect.objectContaining({ de: "off", para: "registrar" }),
      }),
    );
  });

  it("pedir o modo que já está não audita (não houve mudança)", async () => {
    h.modo.mockResolvedValue({ anterior: "real", atual: "real" });
    const r = await chamar({ acao: "comentarios_modo", channel_session_id: ID, modo: "real" });
    expect(((await r.json()) as { data: unknown }).data).toEqual({ modo: "real", alterado: false });
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("modo fora do vocabulário é recusado na porta; organização no corpo também", async () => {
    expect((await chamar({ acao: "comentarios_modo", channel_session_id: ID, modo: "ligado" })).status).toBe(400);
    expect(
      (await chamar({ acao: "comentarios_modo", channel_session_id: ID, modo: "real", organization_id: "org-2" })).status,
    ).toBe(400);
    expect(h.modo).not.toHaveBeenCalled();
  });

  it("quem não é admin não muda o modo; e funciona mesmo com o app da Meta sem configurar", async () => {
    h.role.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await chamar({ acao: "comentarios_modo", channel_session_id: ID, modo: "off" })).status).toBe(403);
    expect(h.modo).not.toHaveBeenCalled();
    h.role.mockResolvedValue({ ok: true, org: { orgId: "org-1", name: "Loja" }, user: { id: "admin-1", idioma: "pt-BR" } });
    h.app = { appId: null, appSecret: null, verifyToken: null };
    h.modo.mockResolvedValue({ anterior: "real", atual: "off" });
    expect((await chamar({ acao: "comentarios_modo", channel_session_id: ID, modo: "off" })).status).toBe(200);
  });
});
