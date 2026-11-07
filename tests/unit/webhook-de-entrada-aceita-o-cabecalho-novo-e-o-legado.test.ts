import { createHmac } from "node:crypto";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HEADER_ASSINATURA_DE_ENTRADA,
  HEADER_ASSINATURA_DE_ENTRADA_LEGADO,
  assinaturaDaRequisicao,
} from "@/lib/webhooks/assinatura";

/**
 * O cabeçalho de assinatura do webhook de ENTRADA trocou de nome com DUPLA
 * LEITURA: a tela ensina `x-arvisx-signature`, e o legado `x-deskcomm-signature`
 * segue aceito para quem já integrou. Renomear sem isto daria 401 calado a todo
 * integrador configurado.
 *
 * Os dois nomes valem; assinatura errada é recusada nos dois; quando os dois
 * vêm, vale o novo (e o legado não "salva" uma assinatura nova errada).
 */

const h = vi.hoisted(() => ({
  inseridos: [] as string[],
  registrar: vi.fn(async () => undefined),
  criarLead: vi.fn(),
}));

const FONTE = {
  id: "fonte-1",
  name: "Formulário do site",
  organization_id: "org-1",
  secret_encrypted: "\\xc30d0407",
  default_pipeline_id: "pipe-1",
  default_stage_id: "stage-1",
  field_map: {},
  redirect_to: null,
  is_active: true,
};

/** Cadeia do PostgREST que aceita qualquer método e resolve vazio — só a fonte é lida de verdade. */
function cadeia(tabela: string): unknown {
  const resultado = { data: tabela === "webhook_sources" ? FONTE : null, error: null };
  const proxy: unknown = new Proxy(() => undefined, {
    get(_alvo, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown) => ok(resultado);
      if (prop === "insert") {
        return () => {
          h.inseridos.push(tabela);
          return proxy;
        };
      }
      return () => proxy;
    },
  });
  return proxy;
}

const SEGREDO = "segredo-da-fonte-com-tamanho-real";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (t: string) => cadeia(t), rpc: async () => ({ data: null, error: null }) }),
}));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/webhooks/secrets", () => ({ decryptWebhookSecret: async () => SEGREDO }));
vi.mock("@/lib/audit", () => ({ audit: async () => undefined }));
vi.mock("@/lib/webhooks/captacao", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  registrarCaptacao: h.registrar,
}));
vi.mock("@/app/api/v1/leads/_handler", () => ({ createLeadHandler: h.criarLead }));
vi.mock("@/lib/dev/kick-local-pipeline", () => ({ kickLocalPipeline: async () => undefined }));

import { POST } from "@/app/api/v1/webhooks/in/[token]/route";

const TOKEN = "token-da-fonte-0001";
const CORPO = JSON.stringify({ nome: "Dora", email: "dora@example.com" });
const assinar = (segredo: string) => createHmac("sha256", segredo).update(CORPO).digest("hex");
const CERTA = assinar(SEGREDO);
const ERRADA = assinar("outro-segredo-qualquer-de-mesmo-porte");

async function enviar(cabecalhos: Record<string, string>): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", ...cabecalhos };
  const req = new NextRequest(`http://localhost/api/v1/webhooks/in/${TOKEN}`, { method: "POST", body: CORPO, headers });
  return POST(req, { params: Promise.resolve({ token: TOKEN }) }).catch((e: Error) => e as unknown as Response);
}

function passouDoPortao(): boolean {
  return h.inseridos.includes("webhook_events_log");
}

function recusadaPorAssinaturaInvalida(): boolean {
  return h.registrar.mock.calls.some((chamada) => {
    const args = chamada as unknown[];
    const registro = args[1] as { outcome?: string; rejectReason?: string } | undefined;
    return registro?.outcome === "recusado" && registro.rejectReason === "assinatura_invalida";
  });
}

beforeEach(() => {
  h.inseridos.length = 0;
  h.registrar.mockClear();
  h.criarLead.mockReset().mockRejectedValue(new Error("passou do portão"));
});

describe("os nomes do cabeçalho", () => {
  it("o novo é `x-arvisx-signature` e o legado segue `x-deskcomm-signature`", () => {
    expect(HEADER_ASSINATURA_DE_ENTRADA).toBe("x-arvisx-signature");
    expect(HEADER_ASSINATURA_DE_ENTRADA_LEGADO).toBe("x-deskcomm-signature");
  });

  it("o novo tem precedência; o legado só vale na ausência dele", () => {
    expect(assinaturaDaRequisicao(new Headers({ "X-Arvisx-Signature": "a" }))).toBe("a");
    expect(assinaturaDaRequisicao(new Headers({ "X-Deskcomm-Signature": "b" }))).toBe("b");
    expect(
      assinaturaDaRequisicao(new Headers({ "x-arvisx-signature": "a", "x-deskcomm-signature": "b" })),
    ).toBe("a");
    expect(assinaturaDaRequisicao(new Headers())).toBeNull();
  });
});

describe("a rota de entrada aceita os dois nomes", () => {
  for (const nome of [HEADER_ASSINATURA_DE_ENTRADA, HEADER_ASSINATURA_DE_ENTRADA_LEGADO]) {
    it(`assinatura certa em \`${nome}\` passa do portão`, async () => {
      await enviar({ [nome]: CERTA });
      expect(passouDoPortao(), `${nome} certo foi recusado`).toBe(true);
      expect(recusadaPorAssinaturaInvalida()).toBe(false);
    });

    it(`assinatura errada em \`${nome}\` é recusada com 401`, async () => {
      const res = await enviar({ [nome]: ERRADA });
      expect(res.status).toBe(401);
      expect(passouDoPortao(), `${nome} errado passou`).toBe(false);
      expect(recusadaPorAssinaturaInvalida()).toBe(true);
    });
  }

  it("sem nenhum dos dois, a fonte com segredo recusa", async () => {
    const res = await enviar({});
    expect(res.status).toBe(401);
    expect(passouDoPortao()).toBe(false);
  });

  it("com os dois, vale o novo: novo errado + legado certo é recusado", async () => {
    const res = await enviar({
      [HEADER_ASSINATURA_DE_ENTRADA]: ERRADA,
      [HEADER_ASSINATURA_DE_ENTRADA_LEGADO]: CERTA,
    });
    expect(res.status).toBe(401);
    expect(passouDoPortao()).toBe(false);
  });

  it("com os dois, vale o novo: novo certo + legado errado passa", async () => {
    await enviar({
      [HEADER_ASSINATURA_DE_ENTRADA]: CERTA,
      [HEADER_ASSINATURA_DE_ENTRADA_LEGADO]: ERRADA,
    });
    expect(passouDoPortao()).toBe(true);
  });
});
