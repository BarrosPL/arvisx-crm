/**
 * Comentários do Instagram, da entrega da Meta até a linha e o aviso.
 *
 * O caminho é o real: o corpo do webhook (no formato que a documentação da
 * Meta publica) passa por `lerWebhookDireto`, a sessão é achada pela conta, e
 * `processarEventosDiretos` entrega a `registrarComentario`. Só o banco é
 * dublado — e o dublê tem a chave única `(organization_id, comment_id)`, que é
 * quem decide o que é repetido.
 *
 * O que se prova:
 *   - payload da doc → uma linha em `social_comments` e um `comment.received`;
 *   - a mesma entrega duas vezes → uma linha, um aviso;
 *   - modo `off` (o padrão) não grava nem avisa;
 *   - comentário da própria conta é ignorado (senão o agente responde a si);
 *   - conta sem sessão é ignorada sem erro;
 *   - a organização vem SÓ da sessão: nada no corpo a escolhe;
 *   - o texto vai inteiro, sem corte.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessaoDireta } from "./store";

const h = vi.hoisted(() => ({
  sessoes: new Map<string, unknown>(),
  ingest: vi.fn(),
  linhas: [] as Record<string, unknown>[],
  avisos: [] as Record<string, unknown>[],
  erroDoInsert: null as { code?: string; message: string } | null,
  erroDoAviso: null as { message: string } | null,
  avisoLanca: false,
}));

vi.mock("./store", () => ({
  sessaoPelaConta: async (_db: unknown, conta: string) => h.sessoes.get(conta) ?? null,
  tokenDaSessao: async () => null,
}));
vi.mock("../zernio/ingest", () => ({ ingestZernioInbound: h.ingest }));
vi.mock("./perfil", () => ({ perfilDoParticipante: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { avisoDoComentario, lerModoDeComentarios, registrarComentario } from "./comentarios";
import { processarEventosDiretos } from "./ingest";
import { lerWebhookDireto } from "./webhook";

/** Banco dublado: `social_comments` com a chave única, e o `emit_event`. */
const db = {
  from: (tabela: string) => {
    if (tabela !== "social_comments") throw new Error(`tabela inesperada: ${tabela}`);
    let linha: Record<string, unknown> | null = null;
    const q = {
      insert: (row: Record<string, unknown>) => ((linha = row), q),
      select: () => q,
      single: async () => {
        if (h.erroDoInsert) return { data: null, error: h.erroDoInsert };
        const repetida = h.linhas.some(
          (l) => l.organization_id === linha!.organization_id && l.comment_id === linha!.comment_id,
        );
        if (repetida) return { data: null, error: { code: "23505", message: "duplicate key value" } };
        const id = `linha-${h.linhas.length + 1}`;
        h.linhas.push({ id, ...linha });
        return { data: { id }, error: null };
      },
    };
    return q;
  },
  rpc: async (nome: string, args: Record<string, unknown>) => {
    if (h.avisoLanca) throw new Error("rede caiu");
    if (h.erroDoAviso) return { data: null, error: h.erroDoAviso };
    h.avisos.push({ nome, ...args });
    return { data: "evento-1", error: null };
  },
} as never;

const IG_A = "17840000000000001";
const IG_B = "17840000000000002";
const CTX = { appId: "555", appSecret: "segredo" };

function sessao(org: string, id: string, conta: string, metadata: Record<string, unknown>): SessaoDireta {
  return {
    id,
    organizationId: org,
    rede: "instagram",
    conta,
    pageId: "111",
    displayName: "instagram · @loja",
    status: "WORKING",
    metadata: { social_platform: "instagram", ...metadata },
  };
}

/** O exemplo da referência do campo `comments` (comentário em publicação de anúncio). */
function entregaDaDoc(conta: string, extra: Record<string, unknown> = {}, campo = "comments") {
  return {
    object: "instagram",
    entry: [
      {
        id: conta,
        time: 1_763_640_000,
        changes: [
          {
            field: campo,
            value: {
              id: "17865799348089039",
              from: { id: "232323232", username: "cliente.exemplo" },
              text: "Qual o valor?",
              media: { id: "17900000000000123", media_product_type: "FEED" },
              ...extra,
            },
          },
        ],
      },
    ],
  };
}

const receber = (corpo: unknown) => processarEventosDiretos(db, lerWebhookDireto(corpo), CTX);

beforeEach(() => {
  vi.clearAllMocks();
  h.sessoes.clear();
  h.linhas = [];
  h.avisos = [];
  h.erroDoInsert = null;
  h.erroDoAviso = null;
  h.avisoLanca = false;
  h.sessoes.set(IG_A, sessao("org-a", "sessao-a", IG_A, { comentarios_modo: "registrar" }));
  h.sessoes.set(IG_B, sessao("org-b", "sessao-b", IG_B, { comentarios_modo: "real" }));
});

describe("o modo do canal", () => {
  it("ausente, nulo ou desconhecido é `off`: na dúvida, não grava", () => {
    expect(lerModoDeComentarios({})).toBe("off");
    expect(lerModoDeComentarios(null)).toBe("off");
    expect(lerModoDeComentarios({ comentarios_modo: "ligado" })).toBe("off");
    expect(lerModoDeComentarios({ comentarios_modo: true })).toBe("off");
    expect(lerModoDeComentarios({ comentarios_modo: "registrar" })).toBe("registrar");
    expect(lerModoDeComentarios({ comentarios_modo: "real" })).toBe("real");
  });

  it("⭐ `off` (o padrão de todo canal): 200 para a Meta, nada gravado, nenhum aviso", async () => {
    h.sessoes.set(IG_A, sessao("org-a", "sessao-a", IG_A, {}));
    expect(await receber(entregaDaDoc(IG_A))).toEqual(["comentarios_desligados"]);
    expect(h.linhas).toEqual([]);
    expect(h.avisos).toEqual([]);
  });
});

describe("do payload da Meta à linha e ao aviso", () => {
  it("⭐ o comentário da doc vira UMA linha, na organização e no canal da sessão", async () => {
    expect(await receber(entregaDaDoc(IG_A, { parent_id: "17860000000000777" }))).toEqual(["comentario_registrado"]);
    expect(h.linhas).toEqual([
      {
        id: "linha-1",
        organization_id: "org-a",
        channel_session_id: "sessao-a",
        comment_id: "17865799348089039",
        parent_comment_id: "17860000000000777",
        media_id: "17900000000000123",
        media_product_type: "FEED",
        ad_id: null,
        ad_title: null,
        ao_vivo: false,
        author_id: "232323232",
        author_username: "cliente.exemplo",
        text: "Qual o valor?",
        commented_at: new Date(1_763_640_000_000).toISOString(),
        estado: "novo",
      },
    ]);
    // Nenhum contato, conversa ou negócio nasce do comentário.
    expect(h.ingest).not.toHaveBeenCalled();
  });

  it("⭐ o aviso `comment.received` leva comentário, mídia, autor, pai, canal e modo", async () => {
    await receber(entregaDaDoc(IG_A, { parent_id: "17860000000000777" }));
    expect(h.avisos).toEqual([
      {
        nome: "emit_event",
        p_event_type: "comment.received",
        p_entity_kind: "social_comment",
        p_entity_id: "linha-1",
        p_organization_id: "org-a",
        p_metadata: { source: "webhook_da_conexao_direta" },
        p_payload: {
          comment_id: "17865799348089039",
          social_comment_id: "linha-1",
          parent_comment_id: "17860000000000777",
          media_id: "17900000000000123",
          media_product_type: "FEED",
          ad_id: null,
          ad_title: null,
          ao_vivo: false,
          author: { id: "232323232", username: "cliente.exemplo" },
          text: "Qual o valor?",
          commented_at: new Date(1_763_640_000_000).toISOString(),
          channel_session_id: "sessao-a",
          canal: { id: "sessao-a", rede: "instagram", conta: IG_A, nome: "instagram · @loja" },
          modo: "registrar",
        },
      },
    ]);
  });

  it("⭐ o texto vai INTEIRO, na linha e no aviso (o corte em 280 é defeito que não se repete)", async () => {
    const longo = "Quero saber tudo sobre o produto. ".repeat(60).trim();
    expect(longo.length).toBeGreaterThan(1900);
    await receber(entregaDaDoc(IG_A, { text: longo }));
    expect(h.linhas[0]!.text).toBe(longo);
    expect((h.avisos[0]!.p_payload as { text: string }).text).toBe(longo);
  });

  it("anúncio: `ad_id` e `ad_title` entram nos dois formatos que a doc publica", async () => {
    await receber(entregaDaDoc(IG_A, { ad_id: "120200000000001", ad_title: "Campanha de inverno" }));
    await receber(
      entregaDaDoc(IG_A, {
        id: undefined,
        comment_id: "17865799348089040",
        media: { id: "17900000000000123", media_product_type: "AD", ad_id: "120200000000002", ad_title: "Outra" },
      }),
    );
    expect(h.linhas.map((l) => [l.comment_id, l.ad_id, l.ad_title, l.media_product_type])).toEqual([
      ["17865799348089039", "120200000000001", "Campanha de inverno", "FEED"],
      ["17865799348089040", "120200000000002", "Outra", "AD"],
    ]);
  });

  it("`live_comments` é comentário de transmissão ao vivo", async () => {
    await receber(entregaDaDoc(IG_A, {}, "live_comments"));
    expect(h.linhas[0]!.ao_vivo).toBe(true);
    expect((h.avisos[0]!.p_payload as { ao_vivo: boolean }).ao_vivo).toBe(true);
  });

  it("o modo `real` do canal vai no aviso", async () => {
    await receber(entregaDaDoc(IG_B));
    expect((h.avisos[0]!.p_payload as { modo: string }).modo).toBe("real");
  });
});

describe("o que NÃO vira linha", () => {
  it("⭐ a mesma entrega duas vezes: uma linha, um aviso (idempotência pela chave única)", async () => {
    expect(await receber(entregaDaDoc(IG_A))).toEqual(["comentario_registrado"]);
    expect(await receber(entregaDaDoc(IG_A))).toEqual(["comentario_repetido"]);
    expect(h.linhas).toHaveLength(1);
    expect(h.avisos).toHaveLength(1);
  });

  it("o mesmo comentário duas vezes NA MESMA entrega (duplicação de anúncio): uma linha", async () => {
    const corpo = entregaDaDoc(IG_A);
    corpo.entry[0]!.changes.push(corpo.entry[0]!.changes[0]!);
    expect(await receber(corpo)).toEqual(["comentario_registrado", "comentario_repetido"]);
    expect(h.linhas).toHaveLength(1);
  });

  it("⭐ comentário da PRÓPRIA conta (a resposta publicada volta assim) é ignorado", async () => {
    expect(await receber(entregaDaDoc(IG_A, { from: { id: IG_A, username: "loja" } }))).toEqual(["comentario_proprio"]);
    expect(h.linhas).toEqual([]);
    expect(h.avisos).toEqual([]);
  });

  it("⭐ conta sem sessão ativa: ignorado, sem erro e sem gravar", async () => {
    expect(await receber(entregaDaDoc("17840000000000999"))).toEqual(["conta_desconhecida"]);
    expect(h.linhas).toEqual([]);
  });

  it("comentário em sessão do Messenger com o mesmo id de conta não entra", async () => {
    h.sessoes.set(IG_A, { ...(h.sessoes.get(IG_A) as SessaoDireta), rede: "facebook" });
    expect(await receber(entregaDaDoc(IG_A))).toEqual(["rede_diferente_da_sessao"]);
    expect(h.linhas).toEqual([]);
  });
});

describe("de quem é o comentário", () => {
  it("⭐ a organização vem SÓ da sessão: um `organization_id` no corpo não muda nada", async () => {
    const corpo = entregaDaDoc(IG_A, { organization_id: "org-b", channel_session_id: "sessao-b" });
    (corpo.entry[0] as Record<string, unknown>).organization_id = "org-b";
    await receber(corpo);
    expect(h.linhas[0]).toMatchObject({ organization_id: "org-a", channel_session_id: "sessao-a" });
    expect(h.avisos[0]).toMatchObject({ p_organization_id: "org-a" });
  });

  it("⭐ cada conta cai na SUA organização — sem vazar para a outra", async () => {
    const corpo = entregaDaDoc(IG_A);
    corpo.entry.push(entregaDaDoc(IG_B, { id: "17865799348089050" }).entry[0]!);
    expect(await receber(corpo)).toEqual(["comentario_registrado", "comentario_registrado"]);
    expect(h.linhas.map((l) => [l.organization_id, l.channel_session_id, l.comment_id])).toEqual([
      ["org-a", "sessao-a", "17865799348089039"],
      ["org-b", "sessao-b", "17865799348089050"],
    ]);
  });

  it("o mesmo id de comentário em DUAS organizações são duas linhas (a chave é por organização)", async () => {
    await receber(entregaDaDoc(IG_A));
    await receber(entregaDaDoc(IG_B));
    expect(h.linhas).toHaveLength(2);
  });
});

describe("falhas", () => {
  it("o banco recusa a gravação: o evento sai `falhou`, sem aviso, e os outros do lote seguem", async () => {
    h.erroDoInsert = { message: "permission denied for table social_comments" };
    const corpo = entregaDaDoc(IG_A);
    corpo.entry.push({ id: "17840000000000999", time: 1, changes: corpo.entry[0]!.changes });
    expect(await receber(corpo)).toEqual(["falhou", "conta_desconhecida"]);
    expect(h.avisos).toEqual([]);
  });

  it("o aviso falha (erro ou exceção): o comentário JÁ está gravado e o desfecho é registrado", async () => {
    h.erroDoAviso = { message: "emit_event indisponível" };
    expect(await receber(entregaDaDoc(IG_A))).toEqual(["comentario_registrado"]);
    h.erroDoAviso = null;
    h.avisoLanca = true;
    expect(await receber(entregaDaDoc(IG_A, { id: "17865799348089060" }))).toEqual(["comentario_registrado"]);
    expect(h.linhas).toHaveLength(2);
  });

  it("`registrarComentario` lança com o nome da tabela quando o erro não é a chave única", async () => {
    h.erroDoInsert = { message: "connection reset" };
    const [evento] = lerWebhookDireto(entregaDaDoc(IG_A));
    await expect(
      registrarComentario(db, h.sessoes.get(IG_A) as SessaoDireta, evento as never),
    ).rejects.toThrow(/social_comments: connection reset/);
  });
});

describe("avisoDoComentario", () => {
  it("é o que os sistemas de fora recebem, em snake_case", () => {
    const [evento] = lerWebhookDireto(entregaDaDoc(IG_A));
    const aviso = avisoDoComentario(h.sessoes.get(IG_A) as SessaoDireta, evento as never, "linha-9", "real");
    expect(Object.keys(aviso).sort()).toEqual(
      [
        "ad_id",
        "ad_title",
        "ao_vivo",
        "author",
        "canal",
        "channel_session_id",
        "comment_id",
        "commented_at",
        "media_id",
        "media_product_type",
        "modo",
        "parent_comment_id",
        "social_comment_id",
        "text",
      ].sort(),
    );
  });
});
