// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LeituraDoPlano } from "@/lib/cobranca/telas-do-plano";
import { interfaceDoPlanoSchema } from "@/lib/schemas/cobranca-plano";
import { PLANOS, type NomeDoPlano } from "../helpers/distribuicao-dos-planos";

/**
 * A LISTA DE PROPOSTAS DO DOSSIÊ DO LEAD (auditoria de 11/11/2026).
 *
 * O dossiê do lead, em Funis, lê `GET /api/v1/proposals?lead_id=` em todo
 * plano. A leitura é aberta no portão para o dossiê não quebrar; quem não tem
 * Propostas no plano recebe a lista VAZIA, sem erro e sem ir ao banco — o que
 * foi criado num plano maior não aparece depois do downgrade.
 */

const leitura = vi.hoisted(() => ({ atual: { tipo: "isenta" } as LeituraDoPlano }));
const banco = vi.hoisted(() => ({ consultas: 0 }));

vi.mock("@/lib/cobranca/leitura-do-plano", () => ({ leituraDoPlanoDaOrg: async () => leitura.atual }));
vi.mock("@/lib/propostas/porta", () => ({ sePropostasDesligadas: async () => null }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/audit", () => ({ audit: async () => undefined }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, user: { id: "u-1", idioma: "pt-BR" }, org: { orgId: "org-1" } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const consulta = {
      select: () => consulta,
      eq: () => consulta,
      order: () => consulta,
      limit: () => consulta,
      then: (resolver: (v: unknown) => unknown) => {
        banco.consultas++;
        return Promise.resolve({ data: [{ id: "p-1", lead_id: "lead-1", status: "enviada" }], error: null }).then(resolver);
      },
    };
    return { from: () => consulta };
  },
}));

function leituraDe(plano: NomeDoPlano): LeituraDoPlano {
  return { tipo: "plano", interface: interfaceDoPlanoSchema.parse({ preset: "completa", destinos: PLANOS[plano] }) };
}

async function listar() {
  const { GET } = await import("@/app/api/v1/proposals/route");
  const r = await GET(new NextRequest("http://localhost/api/v1/proposals?lead_id=lead-1"));
  return { status: r.status, corpo: (await r.json()) as { data: unknown[] } };
}

beforeEach(() => {
  banco.consultas = 0;
});

describe("GET /api/v1/proposals", () => {
  it.each(["Essencial", "Standard"] as const)("%s (sem Propostas): 200 com lista vazia, sem consultar o banco", async (plano) => {
    leitura.atual = leituraDe(plano);
    const r = await listar();
    expect(r.status).toBe(200);
    expect(r.corpo.data).toEqual([]);
    expect(banco.consultas).toBe(0);
  });

  it.each(["Premium", "Equipe Completa"] as const)("%s: devolve as propostas do lead", async (plano) => {
    leitura.atual = leituraDe(plano);
    const r = await listar();
    expect(r.status).toBe(200);
    expect(r.corpo.data).toHaveLength(1);
    expect(banco.consultas).toBe(1);
  });

  it("empresa isenta (sem assinatura): devolve as propostas, como sempre", async () => {
    leitura.atual = { tipo: "isenta" };
    const r = await listar();
    expect(r.corpo.data).toHaveLength(1);
  });
});
