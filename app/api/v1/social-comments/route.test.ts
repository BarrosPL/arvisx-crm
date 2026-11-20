/**
 * AS ROTAS `/api/v1/social-comments/...` — a borda.
 *
 * A regra é de `lib/comentarios/acoes.ts` (medida em `lib/channels/meta-social/comentarios-acoes.test.ts`). Aqui se
 * mede o que é da rota: QUEM passa (sessão de gerente ou token tratado como
 * gerente, com o escopo certo), que a organização e o autor saem da
 * autenticação e nunca do corpo, que a recusa da regra chega com o status e o
 * código dela, e que o proxy deixa o token chegar até aqui.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  teto: vi.fn(),
  suporte: vi.fn(),
  admin: { marca: "cliente-de-servico" },
  acoes: {
    listarComentarios: vi.fn(),
    lerComentario: vi.fn(),
    responderEmPublico: vi.fn(),
    responderEmPrivado: vi.fn(),
    ocultarComentario: vi.fn(),
    ignorarComentario: vi.fn(),
    criarContatoDoComentario: vi.fn(),
  },
}));

vi.mock("@/lib/api/auth-dual", () => ({ resolveAuthDual: h.auth, tetoDeEscritaDoToken: h.teto }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: h.suporte }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin }));
vi.mock("@/lib/comentarios/acoes", () => h.acoes);

import { ApiError } from "@/lib/api/types";
import { fail } from "@/lib/api/wrappers";
import { isPublicPath } from "@/lib/auth/public-paths";

import { POST as criarContato } from "./[id]/criar-contato/route";
import { POST as ocultar } from "./[id]/hide/route";
import { POST as ignorar } from "./[id]/ignore/route";
import { POST as responderEmPrivado } from "./[id]/private-reply/route";
import { POST as responder } from "./[id]/reply/route";
import { GET as ler } from "./[id]/route";
import { GET as listar } from "./route";

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "22222222-2222-4222-8222-222222222222";
const ID = "aaaaaaaa-0000-4000-8000-000000000001";
const BASE = "https://crm.exemplo.test/api/v1/social-comments";

function pedido(caminho: string, corpo?: unknown, metodo = corpo === undefined ? "GET" : "POST") {
  return new NextRequest(`${BASE}${caminho}`, {
    method: metodo,
    ...(corpo !== undefined ? { body: typeof corpo === "string" ? corpo : JSON.stringify(corpo) } : {}),
  });
}
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
type Envelope = { data?: unknown; meta?: unknown; error?: { code: string; message: string; details?: unknown } };
const json = async (r: Response) => (await r.json()) as Envelope;

const ESCRITAS = [
  { nome: "reply", rota: responder, acao: h.acoes.responderEmPublico, corpo: { text: "Olá!" } },
  { nome: "private-reply", rota: responderEmPrivado, acao: h.acoes.responderEmPrivado, corpo: { text: "oi", criar_contato: true } },
  { nome: "hide", rota: ocultar, acao: h.acoes.ocultarComentario, corpo: {} },
  { nome: "ignore", rota: ignorar, acao: h.acoes.ignorarComentario, corpo: { motivo: "elogio" } },
  { nome: "criar-contato", rota: criarContato, acao: h.acoes.criarContatoDoComentario, corpo: {} },
] as const;

beforeEach(() => {
  h.auth.mockReset().mockResolvedValue({
    ok: true,
    organizationId: ORG,
    actor: { type: "api_token", id: "tok-1", role: "manager" },
    apiTokenId: "tok-1",
    via: "token",
    supabase: { marca: "cliente-da-sessao" },
  });
  h.teto.mockReset().mockResolvedValue(null);
  h.suporte.mockReset().mockResolvedValue(null);
  for (const f of Object.values(h.acoes)) f.mockReset().mockResolvedValue({ comment: { id: ID }, simulada: true });
  h.acoes.listarComentarios.mockResolvedValue({ comentarios: [{ id: ID }], cursor: "prox", tem_mais: true });
  h.acoes.lerComentario.mockResolvedValue({ id: ID });
});

describe("quem pode chamar", () => {
  it("⭐ leitura pede gerente e `mcp:read`; escrita pede gerente e `mcp:write` — na sessão E no token", async () => {
    await listar(pedido(""));
    await ler(pedido(`/${ID}`), ctx());
    for (const chamada of h.auth.mock.calls) {
      expect(chamada[1]).toMatchObject({ role: "manager", tokenRole: "manager", scope: "mcp:read", resource: "social_comments" });
    }
    h.auth.mockClear();
    for (const e of ESCRITAS) await e.rota(pedido(`/${ID}/${e.nome}`, e.corpo), ctx());
    expect(h.auth).toHaveBeenCalledTimes(ESCRITAS.length);
    for (const chamada of h.auth.mock.calls) {
      expect(chamada[1]).toMatchObject({ role: "manager", tokenRole: "manager", scope: "mcp:write" });
    }
  });

  it("⭐ quem a autenticação recusa não chega à regra (401/403 voltam como vieram)", async () => {
    h.auth.mockResolvedValue({ ok: false, response: fail("forbidden_role", "Role 'agent' insufficient", 403) });
    const respostas = [
      await listar(pedido("")),
      await ler(pedido(`/${ID}`), ctx()),
      ...(await Promise.all(ESCRITAS.map((e) => e.rota(pedido(`/${ID}/${e.nome}`, e.corpo), ctx())))),
    ];
    for (const r of respostas) expect(r.status).toBe(403);
    for (const f of Object.values(h.acoes)) expect(f).not.toHaveBeenCalled();
  });

  it("toda escrita passa pela guarda do suporte só leitura e pelo teto do token; a leitura, não", async () => {
    for (const e of ESCRITAS) await e.rota(pedido(`/${ID}/${e.nome}`, e.corpo), ctx());
    expect(h.suporte).toHaveBeenCalledTimes(ESCRITAS.length);
    expect(h.teto).toHaveBeenCalledTimes(ESCRITAS.length);
    expect(h.teto.mock.calls[0]![1]).toBe("social-comments");

    h.suporte.mockResolvedValue(fail("forbidden_scope", "só leitura", 403));
    h.teto.mockClear();
    for (const f of Object.values(h.acoes)) f.mockClear();
    for (const e of ESCRITAS) {
      const r = await e.rota(pedido(`/${ID}/${e.nome}`, e.corpo), ctx());
      expect(r.status).toBe(403);
      expect(e.acao).not.toHaveBeenCalled();
    }
    h.suporte.mockResolvedValue(null);
    h.teto.mockClear();
    await listar(pedido(""));
    expect(h.teto).not.toHaveBeenCalled();
  });

  it("teto do token estourado: 429 e a regra não roda", async () => {
    h.teto.mockResolvedValue(fail("rate_limited", "Too many requests.", 429));
    const r = await responder(pedido(`/${ID}/reply`, { text: "x" }), ctx());
    expect(r.status).toBe(429);
    expect(h.acoes.responderEmPublico).not.toHaveBeenCalled();
  });

  it("⭐ o proxy deixa passar só os caminhos exatos: lista, id em forma de UUID e as cinco ações", () => {
    const p = "/api/v1/social-comments";
    for (const caminho of [p, `${p}/${ID}`, ...ESCRITAS.map((e) => `${p}/${ID}/${e.nome}`)]) {
      expect(isPublicPath(caminho), caminho).toBe(true);
    }
    for (const caminho of [`${p}/`, `${p}/qualquer`, `${p}/${ID}/apagar`, `${p}/${ID}/reply/x`, `${p}/export`, `${p}x`]) {
      expect(isPublicPath(caminho), caminho).toBe(false);
    }
  });
});

describe("a organização e o autor saem da autenticação", () => {
  it("⭐ organização no corpo ou na query é ignorada: vale a da sessão ou do token", async () => {
    const quem = { actor: { type: "api_token", id: "tok-1", role: "manager" }, apiTokenId: "tok-1", via: "api" };
    const r = await responder(pedido(`/${ID}/reply`, { text: "Olá!", organization_id: OUTRA_ORG }), ctx());
    // O schema é estrito: campo a mais é recusado, e a regra nem roda.
    expect(r.status).toBe(422);
    expect(h.acoes.responderEmPublico).not.toHaveBeenCalled();

    await responder(pedido(`/${ID}/reply`, { text: "Olá!" }), ctx());
    const [db, org, id, entrada, autor] = h.acoes.responderEmPublico.mock.calls[0]!;
    expect(db).toBe(h.admin);
    expect(org).toBe(ORG);
    expect(id).toBe(ID);
    expect(entrada).toEqual({ text: "Olá!" });
    expect(autor).toMatchObject(quem);
    expect(typeof autor.requestId).toBe("string");

    await listar(pedido(`?organization_id=${OUTRA_ORG}&estado=novo`));
    expect(h.acoes.listarComentarios.mock.calls[0]![1]).toBe(ORG);
    expect(h.acoes.listarComentarios.mock.calls[0]![2]).toEqual({ estado: "novo" });
  });

  it("sessão de gerente: o autor é a pessoa, sem token", async () => {
    h.auth.mockResolvedValue({ ok: true, organizationId: ORG, actor: { type: "user", id: "u-1" }, via: "session", supabase: {} });
    await ignorar(pedido(`/${ID}/ignore`, { motivo: "spam" }), ctx());
    expect(h.acoes.ignorarComentario.mock.calls[0]![4]).toMatchObject({
      actor: { type: "user", id: "u-1" },
      apiTokenId: null,
      via: "api",
    });
  });
});

describe("entrada e saída", () => {
  it("lista: filtros da query, dados no envelope e o cursor em meta", async () => {
    const r = await listar(pedido(`?canal=33333333-3333-4333-8333-333333333333&estado=novo&desde=2026-11-01T00:00:00Z&midia=179&limite=20&cursor=abc`));
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ data: [{ id: ID }], meta: { cursor: "prox", has_more: true } });
    expect(h.acoes.listarComentarios.mock.calls[0]![2]).toEqual({
      canal: "33333333-3333-4333-8333-333333333333",
      estado: "novo",
      desde: "2026-11-01T00:00:00Z",
      midia: "179",
      limite: 20,
      cursor: "abc",
    });
    expect(r.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("filtro inválido: 422 sem consultar", async () => {
    for (const query of ["?estado=arquivado", "?limite=1000", "?canal=nao-e-uuid", "?desde=ontem"]) {
      expect((await listar(pedido(query))).status).toBe(422);
    }
    expect(h.acoes.listarComentarios).not.toHaveBeenCalled();
  });

  it("id que não é UUID: o mesmo 404 de comentário inexistente, sem consultar", async () => {
    expect((await ler(pedido("/x"), ctx("x"))).status).toBe(404);
    expect((await responder(pedido("/x/reply", { text: "a" }), ctx("x"))).status).toBe(404);
    expect(h.acoes.lerComentario).not.toHaveBeenCalled();
    expect(h.acoes.responderEmPublico).not.toHaveBeenCalled();
  });

  it("corpo torto: JSON inválido é 400, texto vazio ou ausente é 422", async () => {
    expect((await responder(pedido(`/${ID}/reply`, "{nao-json"), ctx())).status).toBe(400);
    expect((await responder(pedido(`/${ID}/reply`, { text: "   " }), ctx())).status).toBe(422);
    expect((await responder(pedido(`/${ID}/reply`, {}), ctx())).status).toBe(422);
    expect((await responderEmPrivado(pedido(`/${ID}/private-reply`, { text: "oi", criar_contato: "sim" }), ctx())).status).toBe(422);
    expect((await criarContato(pedido(`/${ID}/criar-contato`, { stage_id: ID }), ctx())).status).toBe(422);
    expect(h.acoes.responderEmPublico).not.toHaveBeenCalled();
  });

  it("ações sem parâmetro obrigatório aceitam corpo vazio", async () => {
    expect((await ocultar(pedido(`/${ID}/hide`, undefined, "POST"), ctx())).status).toBe(200);
    expect((await ignorar(pedido(`/${ID}/ignore`, undefined, "POST"), ctx())).status).toBe(200);
    expect(h.acoes.ignorarComentario.mock.calls[0]![3]).toEqual({});
  });

  it("⭐ a recusa da regra chega com o status, o código e os detalhes dela", async () => {
    h.acoes.responderEmPublico.mockRejectedValue(
      new ApiError(409, "ja_respondido", { resposta: { texto: "primeira" } }, "req", "Este comentário já foi respondido."),
    );
    const r = await responder(pedido(`/${ID}/reply`, { text: "x" }), ctx());
    expect(r.status).toBe(409);
    expect(await json(r)).toEqual({
      error: { code: "ja_respondido", message: "Este comentário já foi respondido.", details: { resposta: { texto: "primeira" } } },
    });

    h.acoes.responderEmPrivado.mockRejectedValue(new ApiError(422, "janela_de_7_dias", undefined, "req", "prazo"));
    const privada = await responderEmPrivado(pedido(`/${ID}/private-reply`, { text: "x" }), ctx());
    expect(privada.status).toBe(422);
    expect((await json(privada)).error?.code).toBe("janela_de_7_dias");
  });

  it("a resposta simulada diz que é simulada", async () => {
    const r = await responder(pedido(`/${ID}/reply`, { text: "x" }), ctx());
    expect(r.status).toBe(200);
    expect((await json(r)).data).toMatchObject({ simulada: true, comment: { id: ID } });
  });
});
