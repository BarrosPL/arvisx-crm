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
vi.mock("./oauth", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  assinarAppNaPagina: h.assinar,
  desassinarAppDaPagina: vi.fn(),
}));
vi.mock("@/lib/channels/health", () => ({ resolverSaudeDaConexaoRemovida: vi.fn() }));
vi.mock("@/lib/channels/central-de-pausa", () => ({ fecharAvisoDePausaDoCanalArquivado: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import {
  conectarPagina,
  definirModoDeComentarios,
  ErroDaConexaoDireta,
  estadoDosComentarios,
} from "./store";

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

describe("comentários: permissões gravadas e modo preservado ao conectar", () => {
  const TODAS = [
    "pages_show_list",
    "pages_messaging",
    "pages_manage_metadata",
    "instagram_basic",
    "instagram_manage_messages",
    "business_management",
    "instagram_manage_comments",
    "pages_read_engagement",
  ];

  it("conexão nova guarda o que a pessoa concedeu e nasce SEM modo (que é `off`)", async () => {
    await conectarPagina(banco(), { ...PEDIDO, redes: ["instagram"], escoposConcedidos: TODAS });
    const metadata = h.inserts[0]!.metadata as Record<string, unknown>;
    expect(metadata.meta_escopos_concedidos).toEqual(TODAS);
    expect(metadata).not.toHaveProperty("comentarios_modo");
    expect(estadoDosComentarios({ rede: "instagram", metadata })).toEqual({
      modo: "off",
      escopo_concedido: true,
      disponivel: true,
    });
  });

  it("⭐ reautorizar NÃO muda o modo: o `comentarios_modo` gravado atravessa a reconexão", async () => {
    h.existentes = [
      {
        id: "sessao-ig",
        organization_id: "org-a",
        meta_social_account_id: "178",
        metadata: { social_platform: "instagram", comentarios_modo: "real", meta_escopos_concedidos: ["instagram_basic"] },
      },
    ];
    const r = await conectarPagina(banco(), { ...PEDIDO, redes: ["instagram"], escoposConcedidos: TODAS });
    expect(r[0]).toMatchObject({ jaExistia: true });
    const metadata = (h.updates[0] as { metadata: Record<string, unknown> }).metadata;
    expect(metadata.comentarios_modo).toBe("real");
    // E o que foi concedido NESTE login substitui o que estava gravado.
    expect(metadata.meta_escopos_concedidos).toEqual(TODAS);
  });

  it("sem saber o que foi concedido (a Meta não respondeu), o que estava gravado fica", async () => {
    h.existentes = [
      {
        id: "sessao-ig",
        organization_id: "org-a",
        meta_social_account_id: "178",
        metadata: { social_platform: "instagram", meta_escopos_concedidos: TODAS },
      },
    ];
    await conectarPagina(banco(), { ...PEDIDO, redes: ["instagram"], escoposConcedidos: null });
    expect((h.updates[0] as { metadata: Record<string, unknown> }).metadata.meta_escopos_concedidos).toEqual(TODAS);
  });
});

describe("estadoDosComentarios", () => {
  it("⭐ conexão antiga (sem permissões gravadas): mensagens seguem, comentários indisponíveis", () => {
    expect(estadoDosComentarios({ rede: "instagram", metadata: { social_platform: "instagram" } })).toEqual({
      modo: "off",
      escopo_concedido: false,
      disponivel: false,
    });
  });

  it("faltando UMA das duas permissões de comentários, não está disponível", () => {
    const metadata = { meta_escopos_concedidos: ["instagram_basic", "instagram_manage_comments"], comentarios_modo: "registrar" };
    expect(estadoDosComentarios({ rede: "instagram", metadata })).toEqual({
      modo: "registrar",
      escopo_concedido: false,
      disponivel: false,
    });
  });

  it("no Messenger nunca está disponível, mesmo com as permissões", () => {
    const metadata = { meta_escopos_concedidos: ["instagram_manage_comments", "pages_read_engagement"] };
    expect(estadoDosComentarios({ rede: "facebook", metadata }).disponivel).toBe(false);
    expect(estadoDosComentarios({ rede: "instagram", metadata }).disponivel).toBe(true);
  });
});

describe("definirModoDeComentarios", () => {
  /** Banco dublado: UMA sessão, achada só pela organização e pelo id certos. */
  function bancoDoModo(linha: Record<string, unknown> | null) {
    const gravado: { metadata?: Record<string, unknown>; filtros?: Record<string, unknown> } = {};
    const db = {
      from: () => {
        const filtros: Record<string, unknown> = {};
        const q: Record<string, unknown> = {
          select: () => q,
          eq: (c: string, v: unknown) => ((filtros[c] = v), q),
          is: () => q,
          maybeSingle: async () => ({
            data: linha && linha.organization_id === filtros.organization_id && linha.id === filtros.id ? linha : null,
            error: null,
          }),
          update: (row: { metadata: Record<string, unknown> }) => {
            gravado.metadata = row.metadata;
            const filtrosDoUpdate: Record<string, unknown> = {};
            const u = {
              eq: (c: string, v: unknown) => {
                filtrosDoUpdate[c] = v;
                gravado.filtros = filtrosDoUpdate;
                return Object.assign(Promise.resolve({ error: null }), u);
              },
            };
            return u;
          },
        };
        return q;
      },
    } as never;
    return { db, gravado };
  }

  const IG = {
    id: "sessao-ig",
    organization_id: "org-a",
    meta_social_account_id: "178",
    meta_social_page_id: "111",
    display_name: "instagram · @loja",
    status: "WORKING",
    metadata: { social_platform: "instagram", ai_gate: "allowlist", meta_page_name: "Loja" },
  };

  it("grava o modo SEM tocar nas outras chaves do metadata, filtrando pela organização", async () => {
    const { db, gravado } = bancoDoModo(IG);
    expect(await definirModoDeComentarios(db, "org-a", "sessao-ig", "registrar")).toEqual({
      anterior: "off",
      atual: "registrar",
    });
    expect(gravado.metadata).toEqual({ ...IG.metadata, comentarios_modo: "registrar" });
    expect(gravado.filtros).toEqual({ organization_id: "org-a", id: "sessao-ig" });
  });

  it("⭐ conexão de OUTRA organização não é achada: 404, nada gravado", async () => {
    const { db, gravado } = bancoDoModo(IG);
    await expect(definirModoDeComentarios(db, "org-b", "sessao-ig", "real")).rejects.toMatchObject({ status: 404 });
    expect(gravado.metadata).toBeUndefined();
  });

  it("conexão do Messenger recusa: comentários são só do Instagram", async () => {
    const { db, gravado } = bancoDoModo({ ...IG, metadata: { social_platform: "facebook" } });
    await expect(definirModoDeComentarios(db, "org-a", "sessao-ig", "real")).rejects.toMatchObject({ status: 422 });
    expect(gravado.metadata).toBeUndefined();
  });

  it("pedir o modo que já está não grava nada", async () => {
    const { db, gravado } = bancoDoModo({ ...IG, metadata: { ...IG.metadata, comentarios_modo: "real" } });
    expect(await definirModoDeComentarios(db, "org-a", "sessao-ig", "real")).toEqual({ anterior: "real", atual: "real" });
    expect(gravado.metadata).toBeUndefined();
  });
});
