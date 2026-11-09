// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { classeDaPagina, paginaLiberada } from "@/lib/cobranca/rotas-do-plano";
import { destinosDoPlano } from "@/lib/cobranca/telas-do-plano";

/**
 * A TRAVA DE PÁGINA das telas do plano (migration 9802) mora no `proxy.ts`, que
 * roda em TODA requisição de página — inclusive a de RSC da navegação pelo
 * cliente, que não passa pelo layout. Fora do plano: rewrite para
 * `/app/fora-do-plano`, com a URL pedida intacta; nunca 404.
 */

const rpc = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } }, error: null }) },
    rpc,
  }),
}));

const ESSENCIAL = { restrito: true, interface: { preset: "simplificada" } };

async function pedir(url: string, cookie?: string) {
  const { proxy } = await import("@/proxy");
  const { NextRequest } = await import("next/server");
  return proxy(new NextRequest(url, { headers: cookie ? { cookie } : undefined }));
}

const reescritaPara = (r: Response) => r.headers.get("x-middleware-rewrite");

beforeEach(() => {
  rpc.mockReset();
});

describe("classificação das páginas", () => {
  it("filha herda o destino do prefixo mais longo do catálogo", () => {
    expect(classeDaPagina("/app/ai/agents/123")).toEqual({ tipo: "destino", destino: "/app/ai/agents" });
    expect(classeDaPagina("/app/ai/followups/enrollments/9")).toEqual({ tipo: "destino", destino: "/app/ai/followups" });
    expect(classeDaPagina("/app/agenda/avisos")).toEqual({ tipo: "destino", destino: "/app/agenda/avisos" });
    expect(classeDaPagina("/app/settings/tenant/whatsapp")).toEqual({ tipo: "destino", destino: "/app/settings/tenant" });
  });

  it("hub vale pelo grupo; alias e livres vêm das listas explícitas", () => {
    expect(classeDaPagina("/app/ai")).toEqual({ tipo: "grupo", grupo: "ia" });
    expect(classeDaPagina("/app/leads/abc")).toEqual({ tipo: "destino", destino: "/app/kanban" });
    expect(classeDaPagina("/app")).toEqual({ tipo: "livre" });
    expect(classeDaPagina("/app/fora-do-plano")).toEqual({ tipo: "livre" });
    expect(classeDaPagina("/app/coisa-nova")).toEqual({ tipo: "desconhecida" });
  });

  it("liberada pelo plano: Essencial abre o Inbox e o Guia, fecha IA e o hub de IA", () => {
    const essencial = destinosDoPlano({ tipo: "plano", interface: { preset: "simplificada" } });
    expect(paginaLiberada("/app/inbox/123", essencial)).toBe(true);
    expect(paginaLiberada("/app/ajuda/treinamento/inbox", essencial)).toBe(true);
    expect(paginaLiberada("/app/ai/agents/1", essencial)).toBe(false);
    expect(paginaLiberada("/app/ai", essencial)).toBe(false);
    expect(paginaLiberada("/app/settings", essencial)).toBe(true);
    expect(paginaLiberada("/app/ai/agents/1", null)).toBe(true);
  });
});

describe("proxy: a trava de página", () => {
  it("página fora do plano é REESCRITA para /app/fora-do-plano, com o caminho pedido no x-pathname", async () => {
    rpc.mockResolvedValue({ data: ESSENCIAL, error: null });
    const r = await pedir("https://crm.exemplo/app/ai/agents/42");
    expect(r.status).toBe(200);
    expect(new URL(reescritaPara(r)!).pathname).toBe("/app/fora-do-plano");
    expect(r.headers.get("x-middleware-request-x-pathname")).toBe("/app/ai/agents/42");
    expect(rpc).toHaveBeenCalledWith("fn_telas_do_plano_da_sessao", { p_org: null });
  });

  it("página do plano passa sem reescrita", async () => {
    rpc.mockResolvedValue({ data: ESSENCIAL, error: null });
    const r = await pedir("https://crm.exemplo/app/inbox");
    expect(reescritaPara(r)).toBeNull();
  });

  it("empresa isenta: tudo passa", async () => {
    rpc.mockResolvedValue({ data: { restrito: false }, error: null });
    expect(reescritaPara(await pedir("https://crm.exemplo/app/ai/agents"))).toBeNull();
  });

  it("página livre e essencial nem consultam o plano", async () => {
    await pedir("https://crm.exemplo/app/fora-do-plano");
    await pedir("https://crm.exemplo/app/settings/canal-oficial");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("o cookie active_org só vai à função se for um uuid (a função ainda confere o vínculo)", async () => {
    rpc.mockResolvedValue({ data: { restrito: false }, error: null });
    const org = "11111111-1111-4111-8111-111111111111";
    await pedir("https://crm.exemplo/app/metrics", `active_org=${org}`);
    expect(rpc).toHaveBeenLastCalledWith("fn_telas_do_plano_da_sessao", { p_org: org });
    await pedir("https://crm.exemplo/app/metrics", "active_org=lixo");
    expect(rpc).toHaveBeenLastCalledWith("fn_telas_do_plano_da_sessao", { p_org: null });
  });

  it("erro de leitura: Atendimento abre, o resto vai para a tela do plano", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "fora do ar" } });
    expect(reescritaPara(await pedir("https://crm.exemplo/app/inbox"))).toBeNull();
    expect(reescritaPara(await pedir("https://crm.exemplo/app/campaigns"))).not.toBeNull();
  });
});
