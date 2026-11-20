/**
 * A PODA DOS COMENTÁRIOS (`social_comments`, migration 9810) NASCE NA RÉGUA DAS
 * IRMÃS.
 *
 * As duas podas que rodam no mesmo cron (`webhook_events_log` e
 * `webhook_lead_captures`) pagaram, cada uma, os mesmos dois defeitos antes de
 * serem consertadas (#1721, #1769):
 *
 *   1. `limit` sem `order` no DELETE — o PostgREST 12.2 recusa com 400
 *      PGRST109, e a poda não apaga nada em clone novo;
 *   2. o erro do DELETE engolido, virando `apagadas: 0` — que na resposta do
 *      cron é a mesma linha de "não havia nada vencido".
 *
 * Este arquivo cobra as duas propriedades da terceira poda desde o primeiro
 * dia, e mais uma: a falha dela NÃO pode esconder o que as duas de cima já
 * fizeram na mesma rodada.
 *
 * O dublê LANÇA no `limit` sem `order`, como o PostgREST faz: tirar o
 * `.order()` do código reprova também os casos de sucesso.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DIAS_DE_GUARDA_DOS_COMENTARIOS,
  podarComentariosAntigos,
} from "@/lib/channels/retencao-dos-comentarios";

vi.mock("@/lib/env", () => ({
  env: {
    INTERNAL_CRON_SECRET: "segredo",
    INTERNAL_SECRET: "",
    WEBHOOK_LOG_BODY_RETENTION_DAYS: "",
    WEBHOOK_LOG_ROW_RETENTION_DAYS: "",
    LEAD_CAPTURE_RETENTION_DAYS: "",
  },
}));

const auditou = vi.fn();
vi.mock("@/lib/audit", () => ({ audit: (...args: unknown[]) => auditou(...args) }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

/** O que o DELETE dos comentários devolve nesta rodada. */
let respostaDosComentarios: { data: { id: string }[] | null; error: { message: string } | null };
/** O que o DELETE da captação (a poda irmã, que roda antes) devolve. */
let respostaDaCaptacao: { data: { id: string }[]; error: { message: string } | null };
/** O que a poda dos comentários pediu ao banco. */
let pedido: { coluna: string; corte: string; ordem: string; lote: number; tabela: string }[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      let apagando = false;
      let ordenado = false;
      const registro = { tabela, coluna: "", corte: "", ordem: "", lote: 0 };
      const cadeia: Record<string, unknown> = {
        delete: () => {
          apagando = true;
          return cadeia;
        },
        lt: (coluna: string, corte: string) => {
          registro.coluna = coluna;
          registro.corte = corte;
          return cadeia;
        },
        lte: () => cadeia,
        is: () => cadeia,
        in: () => cadeia,
        update: () => cadeia,
        select: () => cadeia,
        order: (coluna: string) => {
          ordenado = true;
          registro.ordem = coluna;
          return cadeia;
        },
        limit: (n: number) => {
          if (!ordenado) throw new Error("PGRST109: A 'limit' was applied without an explicit 'order'");
          registro.lote = n;
          if (apagando && tabela === "social_comments") pedido.push({ ...registro });
          return cadeia;
        },
        then: (r: (v: unknown) => unknown) => {
          const resposta = !apagando
            ? { data: [], error: null }
            : tabela === "social_comments"
              ? respostaDosComentarios
              : tabela === "webhook_lead_captures"
                ? respostaDaCaptacao
                : { data: [], error: null };
          return Promise.resolve(resposta).then(r);
        },
      };
      return cadeia;
    },
  }),
}));

async function banco() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as never;
}

beforeEach(() => {
  respostaDosComentarios = { data: [], error: null };
  respostaDaCaptacao = { data: [], error: null };
  pedido = [];
  auditou.mockClear();
});

describe("podarComentariosAntigos", () => {
  it("⭐ apaga pelo `commented_at`, com o corte de 365 dias, ordenando pela chave primária ANTES do limite", async () => {
    respostaDosComentarios = { data: [{ id: "c1" }, { id: "c2" }], error: null };
    const agora = new Date("2026-11-20T12:00:00.000Z");
    const r = await podarComentariosAntigos(await banco(), { agora });
    expect(DIAS_DE_GUARDA_DOS_COMENTARIOS).toBe(365);
    expect(pedido).toEqual([
      {
        tabela: "social_comments",
        coluna: "commented_at",
        corte: "2025-11-20T12:00:00.000Z",
        ordem: "id",
        lote: 500,
      },
    ]);
    expect(r).toEqual({ apagadas: 2, temMais: false, diasAplicados: 365 });
  });

  it("lote cheio avisa que ainda há fila", async () => {
    respostaDosComentarios = { data: [{ id: "c1" }, { id: "c2" }], error: null };
    const r = await podarComentariosAntigos(await banco(), { lote: 2 });
    expect(pedido[0]!.lote).toBe(2);
    expect(r.temMais).toBe(true);
  });

  it("⭐ a falha do DELETE SOBE, com o nome da tabela — não vira `apagadas: 0`", async () => {
    respostaDosComentarios = { data: null, error: { message: "permission denied for table social_comments" } };
    await expect(podarComentariosAntigos(await banco())).rejects.toThrow(/^social_comments: permission denied/);
  });
});

describe("o cron `webhook-log-retention` com a terceira poda", () => {
  async function chamarCron(): Promise<Response> {
    const { GET } = await import("@/app/api/v1/cron/webhook-log-retention/route");
    return GET({
      url: "http://localhost/api/v1/cron/webhook-log-retention",
      headers: new Headers({ authorization: "Bearer segredo" }),
    } as never);
  }

  it("rodada em dia: 200, e o relatório traz os comentários ao lado das irmãs", async () => {
    respostaDosComentarios = { data: [{ id: "c1" }], error: null };
    respostaDaCaptacao = { data: [{ id: "l1" }, { id: "l2" }], error: null };
    const resposta = await chamarCron();
    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as {
      data: { captacao: { apagadas: number }; comentarios: { apagadas: number; diasAplicados: number } };
    };
    expect(corpo.data.captacao.apagadas).toBe(2);
    expect(corpo.data.comentarios).toMatchObject({ apagadas: 1, diasAplicados: 365 });
    // Rodada sem falha não audita: cron que só fez o esperado não é mutação a registrar.
    expect(auditou).not.toHaveBeenCalled();
  });

  it("⭐ a poda dos comentários falha: 500, linha de trilha com a tabela, e o trabalho das irmãs em `details`", async () => {
    respostaDosComentarios = { data: null, error: { message: "connection reset by peer" } };
    respostaDaCaptacao = { data: [{ id: "l1" }], error: null };
    const resposta = await chamarCron();
    expect(resposta.status).toBe(500);
    const corpo = (await resposta.json()) as {
      error: { message: string; details: { erro: string; captacao: { apagadas: number }; arquivo_forense: unknown } };
    };
    expect(corpo.error.message).toBe("social_comments_retention_failed");
    expect(corpo.error.details.erro).toMatch(/social_comments: connection reset/);
    expect(corpo.error.details.captacao.apagadas).toBe(1);
    expect(corpo.error.details.arquivo_forense).toBeDefined();
    expect(auditou).toHaveBeenCalledTimes(1);
    expect(auditou).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "retention.sweep_run",
        metadata: expect.objectContaining({ poda: "social_comments", falhou: true }),
      }),
    );
  });

  it("a captação falha: a rodada encerra ali, e a poda dos comentários nem é tentada", async () => {
    respostaDaCaptacao = { data: [], error: { message: "boom" } };
    const resposta = await chamarCron();
    expect(resposta.status).toBe(500);
    expect(pedido).toEqual([]);
  });
});
