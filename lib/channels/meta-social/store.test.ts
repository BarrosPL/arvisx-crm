/**
 * Gravar a conexão: o que vai para a linha (token cifrado, segredo NOT NULL,
 * rede no metadata), a recusa de conta ativa em OUTRA organização e a ordem
 * (sessão antes da assinatura; assinatura falhando deixa FAILED).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  existentes: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  assinar: vi.fn(),
}));

vi.mock("@/lib/webhooks/secrets", () => ({
  encryptWebhookSecret: async (_db: unknown, v: string) => `cifrado(${v.length})`,
  decryptWebhookSecret: async () => "token",
}));
vi.mock("./oauth", () => ({ assinarAppNaPagina: h.assinar, desassinarAppDaPagina: vi.fn() }));
vi.mock("@/lib/channels/health", () => ({ resolverSaudeDaConexaoRemovida: vi.fn() }));
vi.mock("@/lib/channels/central-de-pausa", () => ({ fecharAvisoDePausaDoCanalArquivado: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { conectarPagina, ErroDaConexaoDireta } from "./store";

/** Banco dublado: lê `existentes` filtrando por conta; grava em `inserts`/`updates`. */
function banco() {
  return {
    from: () => {
      const filtros: Record<string, unknown> = {};
      let insert: Record<string, unknown> | null = null;
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => ((filtros[c] = v), q),
        is: () => q,
        limit: async () => ({
          data: h.existentes.filter((e) => e.meta_social_account_id === filtros.meta_social_account_id),
          error: null,
        }),
        insert: (row: Record<string, unknown>) => ((insert = row), q),
        update: (row: Record<string, unknown>) => {
          h.updates.push(row);
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
        single: async () => {
          if (insert) h.inserts.push(insert);
          return { data: { id: `nova-${h.inserts.length}` }, error: null };
        },
      };
      return q;
    },
  } as never;
}

const PAGINA = { id: "111", nome: "Loja", token: "page-token", instagram: { id: "178", username: "loja" }, podeMensagens: true };
const PEDIDO = { organizationId: "org-a", pagina: PAGINA, appSecret: "s", metaUserId: "777", conectadoPor: "u1" };

beforeEach(() => {
  h.existentes = [];
  h.inserts = [];
  h.updates = [];
  h.assinar.mockReset().mockResolvedValue(undefined);
});

describe("conectarPagina", () => {
  it("cria uma sessão por rede, com token cifrado, segredo e a rede no metadata, e assina a página", async () => {
    const r = await conectarPagina(banco(), { ...PEDIDO, redes: ["facebook", "instagram"] });
    expect(r.map((g) => [g.rede, g.conta])).toEqual([["facebook", "111"], ["instagram", "178"]]);
    expect(h.inserts).toHaveLength(2);
    for (const row of h.inserts) {
      expect(row).toMatchObject({
        organization_id: "org-a",
        provider: "meta_social",
        meta_social_page_id: "111",
        meta_social_token_encrypted: "cifrado(10)",
        webhook_secret_encrypted: expect.stringMatching(/^cifrado\(64\)$/),
        status: "STARTING",
      });
      expect(row).not.toHaveProperty("meta_social_token", "page-token");
    }
    expect((h.inserts[1]!.metadata as Record<string, unknown>).social_platform).toBe("instagram");
    expect((h.inserts[0]!.metadata as Record<string, unknown>).meta_user_id).toBe("777");
    expect(h.assinar).toHaveBeenCalledWith("111", "page-token", "s");
    expect(h.updates.at(-1)).toMatchObject({ status: "WORKING" });
  });

  it("conta ativa em OUTRA organização: recusa antes de qualquer gravação", async () => {
    h.existentes = [{ id: "x", organization_id: "org-b", meta_social_account_id: "111", metadata: { social_platform: "facebook" } }];
    await expect(conectarPagina(banco(), { ...PEDIDO, redes: ["facebook"] })).rejects.toBeInstanceOf(ErroDaConexaoDireta);
    expect(h.inserts).toHaveLength(0);
    expect(h.assinar).not.toHaveBeenCalled();
  });

  it("página sem Instagram ligado: pedir Instagram recusa com a frase", async () => {
    await expect(
      conectarPagina(banco(), { ...PEDIDO, pagina: { ...PAGINA, instagram: null }, redes: ["instagram"] }),
    ).rejects.toThrow(/conta profissional do Instagram/);
  });

  it("assinatura da página falhou: as sessões ficam FAILED e o erro sobe", async () => {
    h.assinar.mockRejectedValue(new Error("x"));
    await expect(conectarPagina(banco(), { ...PEDIDO, redes: ["facebook"] })).rejects.toThrow(/não confirmou/);
    expect(h.updates.at(-1)).toMatchObject({ status: "FAILED" });
  });
});
