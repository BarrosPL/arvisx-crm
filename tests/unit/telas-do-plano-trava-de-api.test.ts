// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { destinoDaRotaDeApi } from "@/lib/cobranca/rotas-do-plano";
import type { LeituraDoPlano } from "@/lib/cobranca/telas-do-plano";

/**
 * A TRAVA DE API das telas do plano (migration 9802): rota ligada a tela fora
 * do plano → 403 `fora_do_plano:<destino>`; rota livre nem consulta o plano.
 */

const leitura = vi.hoisted(() => ({ atual: { tipo: "isenta" } as LeituraDoPlano, chamadas: 0 }));
vi.mock("@/lib/cobranca/leitura-do-plano", () => ({
  leituraDoPlanoDaOrg: async () => {
    leitura.chamadas++;
    return leitura.atual;
  },
}));

const ESSENCIAL: LeituraDoPlano = { tipo: "plano", interface: { preset: "simplificada" } };

beforeEach(() => {
  leitura.atual = { tipo: "isenta" };
  leitura.chamadas = 0;
});

describe("classificação das rotas", () => {
  it("prefixo mais longo decide; o Inbox é livre", () => {
    expect(destinoDaRotaDeApi("/api/v1/campaigns/123/start")).toBe("/app/campaigns");
    expect(destinoDaRotaDeApi("/api/v1/ai/routers/9")).toBe("/app/ai/routers");
    expect(destinoDaRotaDeApi("/api/v1/ai/replies")).toBeNull();
    expect(destinoDaRotaDeApi("/api/v1/messages")).toBeNull();
    expect(destinoDaRotaDeApi("/api/v1/conversations/1/claim")).toBeNull();
    expect(destinoDaRotaDeApi("/api/v1/webhooks/waha")).toBeNull();
    expect(destinoDaRotaDeApi("/api/v1/settings/campanhas")).toBe("/app/campaigns");
    expect(destinoDaRotaDeApi("/app/campaigns")).toBeNull();
    expect(destinoDaRotaDeApi(null)).toBeNull();
  });
});

describe("recusaForaDoPlano", () => {
  it("rota ligada a tela fora do plano: 403 com o código fora_do_plano:<destino>", async () => {
    const { recusaForaDoPlano } = await import("@/lib/cobranca/trava-do-plano");
    leitura.atual = ESSENCIAL;
    const r = await recusaForaDoPlano("org-1", { caminho: "/api/v1/campaigns", requestId: "req-1" });
    expect(r?.status).toBe(403);
    const corpo = (await r!.json()) as { error: { code: string; details: { destino: string; grupo: string } } };
    expect(corpo.error.code).toBe("fora_do_plano:/app/campaigns");
    expect(corpo.error.details).toEqual({ destino: "/app/campaigns", grupo: "crm" });
    expect(r!.headers.get("X-Request-Id")).toBe("req-1");
  });

  it("a mesma rota passa no plano que a libera e na empresa isenta", async () => {
    const { recusaForaDoPlano } = await import("@/lib/cobranca/trava-do-plano");
    leitura.atual = { tipo: "plano", interface: { preset: "completa" } };
    expect(await recusaForaDoPlano("org-1", { caminho: "/api/v1/campaigns" })).toBeNull();
    leitura.atual = { tipo: "isenta" };
    expect(await recusaForaDoPlano("org-1", { caminho: "/api/v1/campaigns" })).toBeNull();
  });

  it("rota livre (mensagens do Inbox) nunca consulta o plano, nem no Essencial", async () => {
    const { recusaForaDoPlano } = await import("@/lib/cobranca/trava-do-plano");
    leitura.atual = ESSENCIAL;
    expect(await recusaForaDoPlano("org-1", { caminho: "/api/v1/messages" })).toBeNull();
    expect(await recusaForaDoPlano("org-1", { caminho: null })).toBeNull();
    expect(leitura.chamadas).toBe(0);
  });

  it("o caminho vem do x-pathname que o proxy grava", async () => {
    vi.doMock("next/headers", () => ({ headers: async () => new Headers({ "x-pathname": "/api/v1/ai/memory" }) }));
    vi.resetModules();
    const { recusaForaDoPlano } = await import("@/lib/cobranca/trava-do-plano");
    leitura.atual = ESSENCIAL;
    const r = await recusaForaDoPlano("org-1");
    expect(r?.status).toBe(403);
    expect(((await r!.json()) as { error: { code: string } }).error.code).toBe("fora_do_plano:/app/ai/memory");
    vi.doUnmock("next/headers");
  });
});
