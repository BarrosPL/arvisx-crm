// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LeituraDoPlano } from "@/lib/cobranca/telas-do-plano";
import { interfaceDoPlanoSchema } from "@/lib/schemas/cobranca-plano";
import { PLANOS, type NomeDoPlano } from "../helpers/distribuicao-dos-planos";

/**
 * OS PREFIXOS QUE A AUDITORIA DE 11/11/2026 ACHOU ABERTOS (ArvisX).
 *
 * Doze prefixos de `/api/v1` estavam livres "por dúvida". No Essencial dava
 * para criar Comanda (POST /api/v1/financeiro/comandas) e ler
 * /settings/routing, /webhook-sources e /ai/agents. Aqui cada um é medido no
 * Essencial e no Premium, pela mesma trava que as rotas atravessam.
 *
 * Três regras, e cada uma tem caso:
 *  - escrita (criar, editar, apagar) só com a tela dona no plano;
 *  - leitura mínima que uma tela de TODO plano precisa (Funis, Conexões,
 *    Equipe) continua livre;
 *  - webhook de ENTRADA nunca consulta o plano.
 */

const leitura = vi.hoisted(() => ({ atual: { tipo: "isenta" } as LeituraDoPlano, chamadas: 0 }));
vi.mock("@/lib/cobranca/leitura-do-plano", () => ({
  leituraDoPlanoDaOrg: async () => {
    leitura.chamadas++;
    return leitura.atual;
  },
}));

function leituraDe(plano: NomeDoPlano): LeituraDoPlano {
  return { tipo: "plano", interface: interfaceDoPlanoSchema.parse({ preset: "completa", destinos: PLANOS[plano] }) };
}

async function resposta(plano: NomeDoPlano, metodo: string, caminho: string) {
  const { recusaForaDoPlano } = await import("@/lib/cobranca/trava-do-plano");
  leitura.atual = leituraDe(plano);
  const r = await recusaForaDoPlano("org-1", { caminho, metodo });
  if (!r) return { status: 200, codigo: null as string | null };
  return { status: r.status, codigo: ((await r.json()) as { error: { code: string } }).error.code };
}

beforeEach(() => {
  leitura.atual = { tipo: "isenta" };
  leitura.chamadas = 0;
});

/** [método, caminho, tela dona, primeiro plano que abre] */
const FECHADAS: ReadonlyArray<readonly [string, string, string, "Standard" | "Premium"]> = [
  // Agentes (Standard)
  ["GET", "/api/v1/ai/agents", "/app/ai/agents", "Standard"],
  ["POST", "/api/v1/ai/agents", "/app/ai/agents", "Standard"],
  ["GET", "/api/v1/ai/agents/abc", "/app/ai/agents", "Standard"],
  ["PATCH", "/api/v1/ai/agents/abc", "/app/ai/agents", "Standard"],
  ["DELETE", "/api/v1/ai/agents/abc", "/app/ai/agents", "Standard"],
  ["POST", "/api/v1/ai/agents/abc/publish", "/app/ai/agents", "Standard"],
  ["POST", "/api/v1/ai/agents/assignable", "/app/ai/agents", "Standard"],
  ["GET", "/api/v1/ai/voz", "/app/ai/agents", "Standard"],
  ["PATCH", "/api/v1/ai/voz", "/app/ai/agents", "Standard"],
  ["POST", "/api/v1/ai/voz/preview", "/app/ai/agents", "Standard"],
  // Credenciais (Standard)
  ["GET", "/api/v1/ai/credentials", "/app/ai/credentials", "Standard"],
  ["POST", "/api/v1/ai/credentials", "/app/ai/credentials", "Standard"],
  ["PATCH", "/api/v1/ai/credentials/abc", "/app/ai/credentials", "Standard"],
  ["DELETE", "/api/v1/ai/credentials/abc", "/app/ai/credentials", "Standard"],
  ["POST", "/api/v1/ai/credentials/test", "/app/ai/credentials", "Standard"],
  // Distribuição de atendimento (Standard): só a escrita
  ["PATCH", "/api/v1/settings/routing", "/app/settings/atendimento", "Standard"],
  ["PATCH", "/api/v1/settings/routing/channels", "/app/settings/atendimento", "Standard"],
  // Chamadas (Premium)
  ["GET", "/api/v1/calls", "/app/calls", "Premium"],
  ["POST", "/api/v1/calls", "/app/calls", "Premium"],
  // Financeiro (Premium), por sub-rota
  ["GET", "/api/v1/financeiro/comandas", "/app/comandas", "Premium"],
  ["POST", "/api/v1/financeiro/comandas", "/app/comandas", "Premium"],
  ["POST", "/api/v1/financeiro/comandas/abc/finalizar", "/app/comandas", "Premium"],
  ["POST", "/api/v1/financeiro/comandas/faturar-lote", "/app/comandas", "Premium"],
  ["GET", "/api/v1/financeiro/fidelidade", "/app/comandas", "Premium"],
  ["POST", "/api/v1/financeiro/fidelidade", "/app/comandas", "Premium"],
  ["GET", "/api/v1/financeiro/lancamentos", "/app/faturamento", "Premium"],
  ["POST", "/api/v1/financeiro/lancamentos", "/app/faturamento", "Premium"],
  ["DELETE", "/api/v1/financeiro/lancamentos/abc", "/app/faturamento", "Premium"],
  ["GET", "/api/v1/financeiro/catalogo/formas", "/app/settings/tenant/financeiro", "Premium"],
  ["POST", "/api/v1/financeiro/catalogo/formas", "/app/settings/tenant/financeiro", "Premium"],
  ["DELETE", "/api/v1/financeiro/catalogo/contas", "/app/settings/tenant/financeiro", "Premium"],
  ["GET", "/api/v1/financeiro/sub-rota-que-nascer-depois", "/app/settings/tenant/financeiro", "Premium"],
  // Propostas (Premium)
  ["POST", "/api/v1/proposals", "/app/proposals", "Premium"],
  ["GET", "/api/v1/proposals/abc", "/app/proposals", "Premium"],
  ["PATCH", "/api/v1/proposals/abc", "/app/proposals", "Premium"],
  ["DELETE", "/api/v1/proposals/abc", "/app/proposals", "Premium"],
  ["POST", "/api/v1/proposals/abc/send", "/app/proposals", "Premium"],
  ["GET", "/api/v1/settings/proposals", "/app/proposals", "Premium"],
  ["PATCH", "/api/v1/settings/proposals", "/app/proposals", "Premium"],
  ["GET", "/api/v1/settings/proposal-templates", "/app/proposals", "Premium"],
  ["POST", "/api/v1/settings/proposal-templates", "/app/proposals", "Premium"],
  ["DELETE", "/api/v1/settings/proposal-templates/padrao", "/app/proposals", "Premium"],
  // Webhooks (Premium): a gestão
  ["GET", "/api/v1/webhook-sources", "/app/webhooks", "Premium"],
  ["POST", "/api/v1/webhook-sources", "/app/webhooks", "Premium"],
  ["PATCH", "/api/v1/webhook-sources/abc", "/app/webhooks", "Premium"],
  ["DELETE", "/api/v1/webhook-sources/abc", "/app/webhooks", "Premium"],
  ["GET", "/api/v1/webhook-sources/abc/events", "/app/webhooks", "Premium"],
];

describe("prefixo a prefixo: o Essencial recebe 403 fora_do_plano, o Premium passa", () => {
  it.each(FECHADAS)("%s %s", async (metodo, caminho, tela, abreNo) => {
    expect(await resposta("Essencial", metodo, caminho)).toEqual({ status: 403, codigo: `fora_do_plano:${tela}` });
    expect(await resposta("Premium", metodo, caminho)).toEqual({ status: 200, codigo: null });
    expect(await resposta("Equipe Completa", metodo, caminho)).toEqual({ status: 200, codigo: null });
    // O degrau do meio: Agentes, Credenciais e Distribuição são do Standard; o resto, não.
    expect((await resposta("Standard", metodo, caminho)).status).toBe(abreNo === "Standard" ? 200 : 403);
  });
});

describe("MCP: o catálogo de ferramentas é do editor do agente; o resto é integração (Premium)", () => {
  it("GET /api/v1/mcp/tools: Essencial 403, Standard (tem Agentes) e Premium passam", async () => {
    expect(await resposta("Essencial", "GET", "/api/v1/mcp/tools")).toEqual({
      status: 403,
      codigo: "fora_do_plano:/app/settings/api-tokens",
    });
    expect((await resposta("Standard", "GET", "/api/v1/mcp/tools")).status).toBe(200);
    expect((await resposta("Premium", "GET", "/api/v1/mcp/tools")).status).toBe(200);
  });

  it("qualquer outra chamada de /api/v1/mcp só passa com API Tokens no plano (Premium)", async () => {
    for (const [metodo, caminho] of [["POST", "/api/v1/mcp/tools"], ["GET", "/api/v1/mcp/outra"]] as const) {
      expect((await resposta("Essencial", metodo, caminho)).status).toBe(403);
      expect((await resposta("Standard", metodo, caminho)).status).toBe(403);
      expect((await resposta("Premium", metodo, caminho)).status).toBe(200);
    }
  });
});

describe("a leitura mínima que Inbox, Funis, Conexões e Equipe usam continua livre no Essencial", () => {
  const LIVRES: ReadonlyArray<readonly [string, string]> = [
    ["GET", "/api/v1/ai/agents/assignable"], // Funis e Conexões › Telefonia
    ["GET", "/api/v1/settings/routing"], // Equipe
    ["GET", "/api/v1/settings/routing/channels"], // Conexões
    ["GET", "/api/v1/proposals"], // dossiê do lead (a rota devolve vazio sem Propostas)
    ["GET", "/api/v1/proposals?lead_id=abc"],
    ["HEAD", "/api/v1/settings/routing"],
  ];

  it.each(LIVRES)("%s %s nem consulta o plano", async (metodo, caminho) => {
    expect(await resposta("Essencial", metodo, caminho)).toEqual({ status: 200, codigo: null });
    expect(leitura.chamadas).toBe(0);
  });

  it("sem método conhecido a mesma rota vale como escrita: a leitura aberta não abre", async () => {
    const { recusaForaDoPlano } = await import("@/lib/cobranca/trava-do-plano");
    leitura.atual = leituraDe("Essencial");
    for (const caminho of ["/api/v1/ai/agents/assignable", "/api/v1/settings/routing", "/api/v1/proposals"]) {
      expect((await recusaForaDoPlano("org-1", { caminho, metodo: null }))?.status, caminho).toBe(403);
    }
  });

  it("a leitura aberta é o caminho exato: uma filha dela não herda", async () => {
    expect((await resposta("Essencial", "GET", "/api/v1/ai/agents/assignable/outra")).status).toBe(403);
    expect((await resposta("Essencial", "GET", "/api/v1/settings/routing/outra")).status).toBe(403);
  });
});

describe("leitura que só abre para quem tem a tela que a usa", () => {
  const padrao = (destinos: string[]): LeituraDoPlano => ({
    tipo: "plano",
    interface: interfaceDoPlanoSchema.parse({ preset: "completa", destinos }),
  });

  async function status(l: LeituraDoPlano, metodo: string, caminho: string) {
    const { recusaForaDoPlano } = await import("@/lib/cobranca/trava-do-plano");
    leitura.atual = l;
    return (await recusaForaDoPlano("org-1", { caminho, metodo }))?.status ?? 200;
  }

  it("a lista de agentes abre para Campanhas e Webhooks, só para ler", async () => {
    const soCampanhas = padrao([...PLANOS.Essencial, "/app/campaigns"]);
    expect(await status(soCampanhas, "GET", "/api/v1/ai/agents")).toBe(200);
    expect(await status(soCampanhas, "POST", "/api/v1/ai/agents")).toBe(403);
    expect(await status(soCampanhas, "GET", "/api/v1/ai/agents/abc")).toBe(403);
  });

  it("a lista de credenciais abre para o editor do agente, só para ler", async () => {
    const soAgentes = padrao([...PLANOS.Essencial, "/app/ai/agents"]);
    expect(await status(soAgentes, "GET", "/api/v1/ai/credentials")).toBe(200);
    expect(await status(soAgentes, "POST", "/api/v1/ai/credentials")).toBe(403);
    expect(await status(soAgentes, "DELETE", "/api/v1/ai/credentials/abc")).toBe(403);
  });

  it("formas de pagamento e contas abrem para Comandas, Faturamento e Honorários, só para ler", async () => {
    for (const tela of ["/app/comandas", "/app/faturamento", "/app/honorarios"]) {
      const plano = padrao([...PLANOS.Essencial, tela]);
      expect(await status(plano, "GET", "/api/v1/financeiro/catalogo/formas")).toBe(200);
      expect(await status(plano, "GET", "/api/v1/financeiro/catalogo/contas")).toBe(200);
      expect(await status(plano, "POST", "/api/v1/financeiro/catalogo/formas")).toBe(403);
    }
  });

  it("a voz do agente também é da tela Provedores; os modelos de proposta, da tela de modelos", async () => {
    expect(await status(padrao([...PLANOS.Essencial, "/app/ai/providers"]), "PATCH", "/api/v1/ai/voz")).toBe(200);
    const soModelos = padrao([...PLANOS.Essencial, "/app/settings/tenant/proposals/modelos"]);
    expect(await status(soModelos, "POST", "/api/v1/settings/proposal-templates")).toBe(200);
    expect(await status(soModelos, "PATCH", "/api/v1/settings/proposals")).toBe(403);
  });
});

describe("webhook de ENTRADA nunca consulta o plano", () => {
  const ENTRADAS = [
    "/api/v1/webhooks/waha",
    "/api/v1/webhooks/waha/tok",
    "/api/v1/webhooks/channel/tok",
    "/api/v1/webhooks/in/tok",
    "/api/v1/webhooks/meta/tok",
    "/api/v1/webhooks/meta-social",
    "/api/v1/webhooks/cobranca/stripe",
    "/api/v1/webhooks/nuvemshop/order-created",
    "/api/v1/webhooks/canal-da-instalacao",
  ];

  it.each(ENTRADAS)("POST %s", async (caminho) => {
    expect(await resposta("Essencial", "POST", caminho)).toEqual({ status: 200, codigo: null });
    expect(leitura.chamadas).toBe(0);
  });
});

describe("a empresa isenta (sem assinatura) segue com tudo", () => {
  it("nenhum dos prefixos fechados recusa a isenta", async () => {
    const { recusaForaDoPlano } = await import("@/lib/cobranca/trava-do-plano");
    for (const [metodo, caminho] of FECHADAS) {
      leitura.atual = { tipo: "isenta" };
      expect(await recusaForaDoPlano("org-1", { caminho, metodo }), `${metodo} ${caminho}`).toBeNull();
    }
  });
});
