/**
 * `PATCH /api/v1/conversations/[id]` com `status: "closed"` — O COMPORTAMENTO
 * QUE NÃO PODE MUDAR.
 *
 * O fechamento deste caminho passou a chamar a regra compartilhada
 * (`lib/inbox/fechar-conversa.ts`), a mesma da rota `POST [id]/close` e da
 * ferramenta `crm_close_conversation`. Este arquivo prende o que quem chama a
 * API enxerga, medido ANTES da troca e igual DEPOIS dela (os casos passam nas
 * duas versões do `_handler.ts`):
 *
 *  - a chamada ao banco: `fn_service_status` pelo cliente service role, com a
 *    organização da sessão, `closed` e a revisão (a enviada, ou a lida);
 *  - os códigos de recusa: 409 `conflict` (PT409 e 40001), 404 `not_found`
 *    (P0002) e 500 `internal_error` com a mensagem do banco;
 *  - a auditoria: UMA linha `conversation.closed`, com a forma exata de sempre
 *    (`metadata: { actor_type, status }`), escrita DEPOIS da releitura — e por
 *    isso ausente quando a releitura falha —, inclusive sobre conversa que já
 *    estava fechada (este caminho sempre auditou o gesto);
 *  - com marcadores no mesmo pedido: fecha, grava, e só então audita as duas.
 *
 * O que NÃO cobre: o efeito da função no Postgres (`tests/invariants/`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const USUARIO = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const CONVERSA = "44444444-4444-4444-8444-444444444444";
const TOKEN = "55555555-5555-4555-8555-555555555555";

interface Estado {
  /** A linha que as leituras devolvem. */
  linha: Record<string, unknown> | null;
  /** Erro da `fn_service_status`. */
  erroRpc: { code?: string; message: string } | null;
  /** A partir de qual leitura (1 = a primeira) devolver `releitura`. */
  releituraFalha: boolean;
  /** Tudo que aconteceu, na ordem. */
  passos: string[];
  rpcsAdmin: Array<{ fn: string; args: Record<string, unknown> }>;
  rpcsSessao: Array<{ fn: string; args: Record<string, unknown> }>;
  atualizacoes: Array<Record<string, unknown>>;
}

let estado: Estado;

const LINHA = {
  id: CONVERSA,
  organization_id: ORG,
  status: "open",
  assigned_to_user_id: USUARIO,
  service_revision: 7,
  contacts: { is_personal: false },
};

function clienteDaSessao(): SupabaseClient {
  let leituras = 0;
  const cadeia = () => {
    let escreveu = false;
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      update: (patch: Record<string, unknown>) => {
        escreveu = true;
        estado.atualizacoes.push(patch);
        return q;
      },
      eq: () => q,
      maybeSingle: async () => {
        leituras += 1;
        estado.passos.push(escreveu ? "update" : `leitura:${leituras}`);
        if (leituras > 1 && estado.releituraFalha) {
          return { data: null, error: { message: "releitura caiu" } };
        }
        return { data: estado.linha, error: null };
      },
    });
    return q;
  };
  return {
    from: () => cadeia(),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      estado.rpcsSessao.push({ fn, args });
      return { data: true, error: null };
    },
  } as unknown as SupabaseClient;
}

function clienteAdmin() {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      estado.passos.push(`rpc:${fn}`);
      estado.rpcsAdmin.push({ fn, args });
      return { data: estado.erroRpc ? null : estado.linha, error: estado.erroRpc };
    },
  };
}

const params = { params: Promise.resolve({ id: CONVERSA }) };

function pedido(corpo: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/v1/conversations/${CONVERSA}`, {
    method: "PATCH",
    body: JSON.stringify(corpo),
  });
}

async function patch(corpo: Record<string, unknown>) {
  const { PATCH } = await import("@/app/api/v1/conversations/[id]/route");
  return PATCH(pedido(corpo), params);
}

const auditorias = () => vi.mocked(audit).mock.calls.map(([e]) => e);

beforeEach(() => {
  vi.clearAllMocks();
  estado = {
    linha: { ...LINHA },
    erroRpc: null,
    releituraFalha: false,
    passos: [],
    rpcsAdmin: [],
    rpcsSessao: [],
    atualizacoes: [],
  };
  vi.mocked(audit).mockImplementation(async (e) => {
    estado.passos.push(`audit:${(e as { action: string }).action}`);
  });
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USUARIO, idioma: "pt-BR" },
    org: { orgId: ORG, name: "Org", role: "agent" },
  } as Awaited<ReturnType<typeof requireRole>>);
  vi.mocked(createClient).mockImplementation(async () => clienteDaSessao() as never);
  vi.mocked(createAdminClient).mockImplementation(() => clienteAdmin() as never);
});

describe("PATCH status=closed: a chamada ao banco", () => {
  it("fecha pela fn_service_status do service role, com a revisão LIDA quando o cliente não manda", async () => {
    const res = await patch({ status: "closed" });

    expect(res.status).toBe(200);
    expect(estado.rpcsAdmin).toEqual([
      {
        fn: "fn_service_status",
        args: { p_org: ORG, p_conversation: CONVERSA, p_status: "closed", p_expected: 7 },
      },
    ]);
    // O estado de atendimento nunca passa pelo cliente da sessão.
    expect(estado.rpcsSessao).toEqual([]);
    expect(estado.atualizacoes).toEqual([]);
  });

  it("a revisão enviada pelo cliente é a que viaja, mesmo diferente da lida", async () => {
    // Diferença deliberada contra `POST [id]/close`, que recusa antes de
    // escrever: aqui quem decide o 409 é só o banco.
    await patch({ status: "closed", expected_revision: 3 });

    expect(estado.rpcsAdmin[0]?.args).toEqual({
      p_org: ORG,
      p_conversation: CONVERSA,
      p_status: "closed",
      p_expected: 3,
    });
  });

  it("responde a conversa relida, no envelope de sempre", async () => {
    const res = await patch({ status: "closed" });
    const corpo = (await res.json()) as { data: Record<string, unknown> };
    expect(corpo.data).toEqual(LINHA);
  });
});

describe("PATCH status=closed: a auditoria", () => {
  it("uma linha conversation.closed, com a forma exata, depois da releitura", async () => {
    await patch({ status: "closed" });

    expect(auditorias()).toEqual([
      {
        action: "conversation.closed",
        actorUserId: USUARIO,
        organizationId: ORG,
        resourceType: "conversation",
        resourceId: CONVERSA,
        requestId: expect.any(String),
        metadata: { actor_type: "user", status: "closed" },
      },
    ]);
    expect(estado.passos).toEqual([
      "leitura:1",
      "rpc:fn_service_status",
      "leitura:2",
      "audit:conversation.closed",
    ]);
  });

  it("audita o gesto mesmo quando a conversa já estava fechada", async () => {
    estado.linha = { ...LINHA, status: "closed" };

    const res = await patch({ status: "closed" });

    expect(res.status).toBe(200);
    expect(estado.rpcsAdmin).toHaveLength(1);
    expect(auditorias().map((e) => e.action)).toEqual(["conversation.closed"]);
  });

  it("releitura que falha: 500 e NENHUMA linha de auditoria", async () => {
    estado.releituraFalha = true;

    const res = await patch({ status: "closed" });

    expect(res.status).toBe(500);
    expect(estado.rpcsAdmin).toHaveLength(1);
    expect(audit).not.toHaveBeenCalled();
  });

  it("com marcadores no mesmo pedido: fecha, grava, e só então audita as duas", async () => {
    const res = await patch({ status: "closed", tags: ["vip"] });

    expect(res.status).toBe(200);
    expect(estado.atualizacoes).toEqual([{ tags: ["vip"] }]);
    expect(estado.passos).toEqual([
      "leitura:1",
      "rpc:fn_service_status",
      "update",
      "audit:conversation.closed",
      "audit:conversation.tags_changed",
    ]);
  });

  it("ator que não é pessoa: actorUserId nulo e o token no metadata, como sempre", async () => {
    const { patchConversationHandler } = await import("@/app/api/v1/conversations/_handler");
    // Conversa SEM responsável humano: a assumida este ator não fecha (bloco abaixo).
    estado.linha = { ...LINHA, assigned_to_user_id: null };

    await patchConversationHandler(
      clienteDaSessao(),
      {
        organization_id: ORG,
        actor: { type: "ai_agent", id: "run-1", role: "agent", api_token_id: TOKEN },
        requestId: "req-1",
      },
      CONVERSA,
      { status: "closed" },
    );

    expect(auditorias()).toEqual([
      {
        action: "conversation.closed",
        actorUserId: null,
        organizationId: ORG,
        resourceType: "conversation",
        resourceId: CONVERSA,
        requestId: "req-1",
        metadata: {
          actor_type: "ai_agent",
          actor_id: "run-1",
          actor_api_token_id: TOKEN,
          status: "closed",
        },
      },
    ]);
  });
});

// Revisão 20/11, item 2.31 — decisão do dono em 23/11/2026: agente não fecha
// conversa que uma pessoa assumiu. A régua da tela (`exigirControleDaConversa`)
// só olha o ator "user"; este caminho também fecha conversa e aceita outros
// atores, então a mesma recusa da ferramenta `crm_close_conversation` vale aqui.
describe("PATCH status=closed: ator que não é pessoa × conversa assumida", () => {
  const AGENTE = {
    organization_id: ORG,
    actor: { type: "ai_agent" as const, id: "run-1", role: "agent" as const, api_token_id: TOKEN },
    requestId: "req-1",
  };

  it("⭐ conversa assumida por uma pessoa: 403, sem chamar o banco e sem auditar", async () => {
    const { patchConversationHandler } = await import("@/app/api/v1/conversations/_handler");

    const erro = await patchConversationHandler(clienteDaSessao(), AGENTE, CONVERSA, { status: "closed" }).then(
      () => null,
      (e: unknown) => e as { status: number; code: string; message: string },
    );

    expect(erro).toMatchObject({ status: 403, code: "forbidden" });
    expect(erro!.message).toMatch(/pessoa da equipe assumiu/);
    expect(estado.rpcsAdmin).toEqual([]);
    expect(estado.atualizacoes).toEqual([]);
    expect(auditorias()).toEqual([]);
  });

  it("controle: a mesma conversa sem responsável fecha", async () => {
    const { patchConversationHandler } = await import("@/app/api/v1/conversations/_handler");
    estado.linha = { ...LINHA, assigned_to_user_id: null };

    await patchConversationHandler(clienteDaSessao(), AGENTE, CONVERSA, { status: "closed" });

    expect(estado.rpcsAdmin.map((r) => r.fn)).toEqual(["fn_service_status"]);
    expect(auditorias().map((a) => a.action)).toEqual(["conversation.closed"]);
  });

  it("controle: a PESSOA responsável continua fechando a conversa que assumiu, pela rota", async () => {
    const res = await patch({ status: "closed" });
    expect(res.status).toBe(200);
    expect(estado.rpcsAdmin.map((r) => r.fn)).toEqual(["fn_service_status"]);
  });
});

describe("PATCH status=closed: os códigos de recusa", () => {
  it.each(["PT409", "40001"])("%s do banco → 409 conflict, sem auditoria", async (code) => {
    estado.erroRpc = { code, message: "service_stale" };

    const res = await patch({ status: "closed", expected_revision: 3 });

    expect(res.status).toBe(409);
    const corpo = (await res.json()) as { error: { code: string; message: string } };
    expect(corpo.error.code).toBe("conflict");
    expect(corpo.error.message).toBe("O atendimento mudou. Atualize e tente novamente.");
    expect(audit).not.toHaveBeenCalled();
  });

  it("P0002 (a conversa sumiu entre a leitura e o fechamento) → 404 not_found", async () => {
    estado.erroRpc = { code: "P0002", message: "service_not_found" };

    const res = await patch({ status: "closed" });

    expect(res.status).toBe(404);
    const corpo = (await res.json()) as { error: { code: string; message: string } };
    expect(corpo.error.code).toBe("not_found");
    expect(corpo.error.message).toBe("service_not_found");
    expect(audit).not.toHaveBeenCalled();
  });

  it("qualquer outro erro do banco → 500 internal_error com a mensagem dele", async () => {
    estado.erroRpc = { code: "XX000", message: "banco fora" };

    const res = await patch({ status: "closed" });

    expect(res.status).toBe(500);
    const corpo = (await res.json()) as { error: { code: string; message: string } };
    expect(corpo.error.code).toBe("internal_error");
    expect(corpo.error.message).toBe("banco fora");
    expect(audit).not.toHaveBeenCalled();
  });

  it("conversa de contato pessoal → 404 antes de qualquer efeito", async () => {
    estado.linha = { ...LINHA, contacts: { is_personal: true } };

    const res = await patch({ status: "closed" });

    expect(res.status).toBe(404);
    expect(estado.rpcsAdmin).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("PATCH com outro status: nada mudou", () => {
  it("arquivar continua na chamada direta, com a auditoria própria", async () => {
    const res = await patch({ status: "archived", expected_revision: 7 });

    expect(res.status).toBe(200);
    expect(estado.rpcsAdmin).toEqual([
      {
        fn: "fn_service_status",
        args: { p_org: ORG, p_conversation: CONVERSA, p_status: "archived", p_expected: 7 },
      },
    ]);
    expect(auditorias()).toEqual([
      {
        action: "conversation.archived",
        actorUserId: USUARIO,
        organizationId: ORG,
        resourceType: "conversation",
        resourceId: CONVERSA,
        requestId: expect.any(String),
        metadata: { actor_type: "user", status: "archived" },
      },
    ]);
  });
});
