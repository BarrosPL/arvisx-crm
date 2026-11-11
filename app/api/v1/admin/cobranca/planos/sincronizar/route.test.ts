import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoFalso, filtros, type BancoFalso } from "@/tests/helpers/banco-falso-da-cobranca";

const h = vi.hoisted(() => ({
  ator: "aaaaaaaa-0000-4000-8000-000000000001",
  escrita: vi.fn(),
  audit: vi.fn(),
  suporte: null as Response | null,
  ligada: true,
  provedor: "stripe" as "stripe" | "asaas" | null,
  modo: "teste" as "teste" | "producao" | null,
  adaptador: vi.fn(),
  banco: undefined as unknown as BancoFalso,
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => h.suporte }));
vi.mock("@/lib/auth/requirePlatformAdmin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/requirePlatformAdmin")>()),
  requirePlatformAdminEscrita: h.escrita,
}));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: async () => h.ligada }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.banco.cliente }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/cobranca/configuracao", () => ({ provedorDaInstalacao: async () => h.provedor }));
vi.mock("@/lib/cobranca/provedores", () => ({ adaptador: h.adaptador, modoDoProvedor: async () => h.modo }));

import { EscritaDePlatformAdminNegada } from "@/lib/auth/requirePlatformAdmin";
import { criarAdaptadorStripe } from "@/lib/cobranca/provedores/stripe";

import { POST } from "./route";

/**
 * "Sincronizar produtos na Stripe" (Admin › Cobrança › Planos, ArvisX).
 *
 * A rota roda contra o adaptador REAL da Stripe sobre uma conta de mentira COM
 * ESTADO: é o que prova a idempotência de ponta a ponta (rodar duas vezes deixa
 * um produto por plano), não só o status HTTP.
 */
const CHAVE_TESTE = ["sk", "test", "51HfakeKeyForUnitTests00"].join("_");
const ESSENCIAL = { id: "cccccccc-0000-4000-8000-000000000001", nome: "Essencial", preco_cents: 5990, moeda: "EUR", intervalo: "mes", fora_do_managed_payments: false };
const PREMIUM = { id: "cccccccc-0000-4000-8000-000000000002", nome: "Premium", preco_cents: 19990, moeda: "EUR", intervalo: "mes", fora_do_managed_payments: false };
const EQUIPE = { id: "cccccccc-0000-4000-8000-000000000003", nome: "Equipe Completa", preco_cents: 49990, moeda: "EUR", intervalo: "mes", fora_do_managed_payments: true };

let planos: Array<typeof ESSENCIAL>;
let produtos: Map<string, Record<string, string>>;
let chamadas: string[];
/** Ids de produto que a Stripe recusa com 403 (ex.: chave restrita sem permissão). */
let recusados: Set<string>;

function stripeDeMentira() {
  return criarAdaptadorStripe({
    lerChave: async () => CHAVE_TESTE,
    esperar: async () => undefined,
    marca: "a1b2c3d4e5f60718",
    fetch: async (entrada, init) => {
      const caminho = new URL(String(entrada)).pathname.replace(/^\/v1/, "");
      const corpo = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
      chamadas.push(`${init?.method} ${caminho}`);
      const id = caminho === "/products" ? (corpo.get("id") ?? "") : (caminho.split("/")[2] ?? "");
      if (recusados.has(id)) return Response.json({ error: { code: "permission_error", message: `sem permissão ${CHAVE_TESTE}` } }, { status: 403 });
      if (caminho === "/products" && produtos.has(id)) return Response.json({ error: { code: "resource_already_exists" } }, { status: 400 });
      produtos.set(id, { ...produtos.get(id), ...Object.fromEntries(corpo) });
      return Response.json({ id });
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.suporte = null;
  h.ligada = true;
  h.provedor = "stripe";
  h.modo = "teste";
  h.escrita.mockResolvedValue({ user: { id: h.ator }, platformAdmin: { user_id: h.ator, scope: "full", mfa_required: false } });
  planos = [ESSENCIAL, PREMIUM, EQUIPE];
  produtos = new Map();
  chamadas = [];
  recusados = new Set();
  h.banco = bancoFalso(() => ({ data: planos }));
  h.adaptador.mockImplementation(() => stripeDeMentira());
});

const corpoDe = async (res: Response) => (await res.json()) as { data: { modo: string; criados: number; atualizados: number; erros: number; resultados: Array<Record<string, string>> }; error?: { code: string } };

describe("POST /api/v1/admin/cobranca/planos/sincronizar", () => {
  it("⭐ cria o produto de cada plano ATIVO na conta conectada, com o código fiscal, e diz o resultado por plano", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const { data } = await corpoDe(res);
    expect(data).toMatchObject({ modo: "teste", criados: 3, atualizados: 0, erros: 0 });
    expect(data.resultados).toEqual([
      { plano_id: ESSENCIAL.id, nome: "Essencial", resultado: "criado" },
      { plano_id: PREMIUM.id, nome: "Premium", resultado: "criado" },
      { plano_id: EQUIPE.id, nome: "Equipe Completa", resultado: "criado" },
    ]);
    expect([...produtos.keys()]).toEqual([`dc_plano_${ESSENCIAL.id}`, `dc_plano_${PREMIUM.id}`, `dc_plano_${EQUIPE.id}`]);
    for (const p of produtos.values()) expect(p.tax_code).toBe("txcd_10103001");
    // Só os planos ativos: o arquivado não entra na leitura.
    const leitura = h.banco.cadeias.find((c) => c.tabela === "cobranca_planos")!;
    expect(filtros(leitura)).toContainEqual(["is", "arquivado_em", null]);
    expect(h.adaptador).toHaveBeenCalledWith("stripe");
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "cobranca.produtos_sincronizados", actorUserId: h.ator, actingAsPlatformAdmin: true,
      metadata: { modo: "teste", criados: 3, atualizados: 0, erros: 0 },
    }));
  });

  it("⭐ é idempotente: a segunda rodada só ATUALIZA, e a conta segue com um produto por plano", async () => {
    await POST();
    const segunda = await corpoDe(await POST());
    expect(segunda.data).toMatchObject({ criados: 0, atualizados: 3, erros: 0 });
    expect(segunda.data.resultados.map((r) => r.resultado)).toEqual(["atualizado", "atualizado", "atualizado"]);
    const terceira = await corpoDe(await POST());
    expect(terceira.data).toMatchObject({ criados: 0, atualizados: 3, erros: 0 });
    expect(produtos.size).toBe(3);
  });

  it("produto que já existia sem código fiscal recebe o código no update; plano novo é criado", async () => {
    produtos.set(`dc_plano_${ESSENCIAL.id}`, { id: `dc_plano_${ESSENCIAL.id}`, name: "Essencial velho" });
    const { data } = await corpoDe(await POST());
    expect(data).toMatchObject({ criados: 2, atualizados: 1 });
    expect(produtos.get(`dc_plano_${ESSENCIAL.id}`)).toMatchObject({ name: "Essencial", tax_code: "txcd_10103001" });
  });

  it("⭐ conta real: a mesma rota, com a chave salva de produção", async () => {
    h.modo = "producao";
    expect((await corpoDe(await POST())).data.modo).toBe("producao");
  });

  it("⭐ um plano que a Stripe recusa vira `erro` com o CÓDIGO (nunca a mensagem dela) e não impede os outros", async () => {
    recusados.add(`dc_plano_${PREMIUM.id}`);
    const res = await POST();
    expect(res.status).toBe(200);
    const texto = JSON.stringify(await res.clone().json());
    expect(texto).not.toContain(CHAVE_TESTE);
    const { data } = await corpoDe(res);
    expect(data).toMatchObject({ criados: 2, atualizados: 0, erros: 1 });
    expect(data.resultados[1]).toEqual({ plano_id: PREMIUM.id, nome: "Premium", resultado: "erro", erro: "permission_error" });
    expect(data.resultados[2]).toMatchObject({ resultado: "criado" });
  });

  it("⭐ só o dono da instalação: sem escrita de platform admin, 403 e NADA vai à Stripe", async () => {
    h.escrita.mockRejectedValueOnce(new EscritaDePlatformAdminNegada("forbidden_scope", "somente leitura"));
    const res = await POST();
    expect(res.status).toBe(403);
    expect(h.adaptador).not.toHaveBeenCalled();
    expect(chamadas).toEqual([]);
    expect(h.banco.cadeias).toHaveLength(0);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("sessão de suporte (só leitura): recusada antes de tudo", async () => {
    h.suporte = Response.json({ error: { code: "support_read_only" } }, { status: 403 });
    expect((await POST()).status).toBe(403);
    expect(h.escrita).not.toHaveBeenCalled();
    expect(chamadas).toEqual([]);
  });

  it("cobrança desligada: 404", async () => {
    h.ligada = false;
    expect((await POST()).status).toBe(404);
    expect(chamadas).toEqual([]);
  });

  it.each([
    ["outro provedor conectado", "asaas" as const, "producao" as const],
    ["nenhum provedor", null, null],
    ["Stripe escolhida mas sem chave salva", "stripe" as const, null],
  ])("%s: 409 stripe_nao_conectada, nada vai à Stripe", async (_nome, provedor, modo) => {
    h.provedor = provedor;
    h.modo = modo;
    const res = await POST();
    expect(res.status).toBe(409);
    expect((await corpoDe(res)).error?.code).toBe("stripe_nao_conectada");
    expect(h.adaptador).not.toHaveBeenCalled();
  });

  it("sem plano ativo: 200 com a lista vazia, sem audit (não houve efeito)", async () => {
    planos = [];
    const { data } = await corpoDe(await POST());
    expect(data).toMatchObject({ criados: 0, atualizados: 0, erros: 0, resultados: [] });
    expect(h.audit).not.toHaveBeenCalled();
  });
});
