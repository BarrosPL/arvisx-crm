/**
 * POST /api/v1/assistente/acoes/:id/confirmar e /cancelar — as rotas REAIS.
 *
 * O clique do usuário é a única coisa que executa uma escrita do Vix. Aqui se
 * mede, na rota: cartão repetido, expirado, de outro usuário e de outra
 * empresa; viewer; ações desligadas; Vix desligado; empresa suspensa; nível
 * sensível sem a palavra. Em cada recusa, o espião da capacidade prova que
 * NADA executou.
 *
 * O banco é o dublê em memória, com a regra de reserva da migration 9830. A
 * regra de verdade é provada no Postgres em
 * `tests/invariants/assistente-tabelas-e-cartao.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { pagadorDoVix } from "@/lib/assistente/provedor";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { ROLE_RANK, type AuthUser, type Role } from "@/lib/auth/types";
import { moduloLigado } from "@/lib/instalacao/modulos";

import { novoBanco, type EstadoDoBanco } from "../helpers/banco-falso-do-vix";

const estado = vi.hoisted(() => ({ banco: null as unknown, execEscrever: null as unknown, execSensivel: null as unknown }));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ sessao: true })) }));
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso } = await import("../helpers/banco-falso-do-vix");
  return { createAdminClient: () => clienteFalso(estado.banco as never), isServiceRoleConfigured: () => true };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/assistente/provedor", () => ({ pagadorDoVix: vi.fn(), provedorDoVix: vi.fn() }));
vi.mock("@/lib/instalacao/modulos", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  modulosLigados: vi.fn(async () => []),
  moduloLigado: vi.fn(async () => true),
}));
vi.mock("@/lib/organizacao/capacidades", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  capacidadesDaOrganizacao: vi.fn(async () => []),
}));
vi.mock("@/lib/cobranca/trava-do-plano", () => ({ recusaForaDoPlano: vi.fn(async () => null), telaForaDoPlano: vi.fn(async () => false) }));
vi.mock("@/lib/assistente/capacidades", async () => {
  const { z } = await import("zod");
  const { capacidade } = await import("@/lib/assistente/tipos");
  const execEscrever = vi.fn(async (..._a: unknown[]) => ({ feito: true }));
  const execSensivel = vi.fn(async (..._a: unknown[]) => ({ feito: true }));
  estado.execEscrever = execEscrever;
  estado.execSensivel = execSensivel;
  const base = {
    descricao: "altera negócios da empresa",
    papelMinimo: "agent" as const,
    rotaDaTela: { caminho: "/api/v1/leads", metodo: "PATCH" as const },
    entrada: z.object({ ids: z.array(z.string()).min(1).max(50) }),
    temInverso: false as const,
    teste: "x",
    origem: { tipo: "tela" as const, handler: "x" },
    preparar: async ({ ids }: { ids: string[] }) => ({ resumo: "mexer", itens: ids.map((id) => ({ id, rotulo: id })) }),
  };
  const CATALOGO = [
    capacidade({ ...base, nome: "teste_escrever", nivel: "escrever", executar: execEscrever }),
    capacidade({ ...base, nome: "teste_sensivel", nivel: "sensivel", executar: execSensivel }),
  ];
  return { CATALOGO, capacidadePorNome: (n: string) => CATALOGO.find((c) => c.nome === n) };
});

const { POST: confirmar } = await import("@/app/api/v1/assistente/acoes/[id]/confirmar/route");
const { POST: cancelar } = await import("@/app/api/v1/assistente/acoes/[id]/cancelar/route");

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "99999999-9999-4999-8999-999999999999";
const USER = "11111111-1111-4111-8111-111111111111";
const OUTRO_USER = "33333333-3333-4333-8333-333333333333";

let banco: EstadoDoBanco;
let n = 0;
const execEscrever = () => estado.execEscrever as ReturnType<typeof vi.fn>;
const execSensivel = () => estado.execSensivel as ReturnType<typeof vi.fn>;

function sessao(papel: Role = "agent", userId = USER, orgId = ORG) {
  const user = {
    id: userId,
    email: "u@example.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    idioma: "pt-BR" as const,
    organizations: [{ organization_id: orgId, organization_name: "Org", role: papel }],
  } as unknown as AuthUser;
  vi.mocked(requireRole).mockImplementation(async (min: Role) => {
    if (ROLE_RANK[papel] >= ROLE_RANK[min]) return { ok: true, user, org: { orgId, name: "Org", role: papel } } as never;
    return { ok: false, response: fail("forbidden_role", "sem papel", 403, {}) };
  });
}

/** Põe um cartão no banco, como a rota de mensagens o gravaria. */
function cartao(sobre: Record<string, unknown> = {}): string {
  n += 1;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  banco.tabelas.assistente_acoes!.push({
    id,
    organization_id: ORG,
    user_id: USER,
    conversa_id: "c",
    capacidade: "teste_escrever",
    nivel: "escrever",
    entrada: { ids: ["a", "b"] },
    quantidade: 2,
    estado: "proposta",
    expira_em: new Date(Date.now() + 600_000).toISOString(),
    ...sobre,
  });
  return id;
}

const estadoDe = (id: string) => banco.tabelas.assistente_acoes!.find((a) => a.id === id)!.estado;

function chamar(rota: typeof confirmar, id: string, corpo: Record<string, unknown> = {}): Promise<Response> {
  return rota(
    new NextRequest(`http://localhost/api/v1/assistente/acoes/${id}/confirmar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }),
    { params: Promise.resolve({ id }) },
  );
}

const codigo = async (r: Response) => ((await r.json()) as { error?: { code: string } }).error?.code;

beforeEach(() => {
  vi.clearAllMocks();
  banco = novoBanco();
  estado.banco = banco;
  sessao("agent");
  vi.mocked(pagadorDoVix).mockResolvedValue("assinatura_plataforma");
  vi.mocked(moduloLigado).mockResolvedValue(true);
});

describe("confirmar", () => {
  it("o dono confirma: executa UMA vez, com a organização e o usuário da sessão, e audita (controle positivo)", async () => {
    const id = cartao();
    const r = await chamar(confirmar, id);
    expect(r.status).toBe(200);
    expect(execEscrever()).toHaveBeenCalledTimes(1);
    expect(execEscrever().mock.calls[0]![1]).toMatchObject({ orgId: ORG, userId: USER, papel: "agent" });
    expect(estadoDe(id)).toBe("executada");
    const acoes = vi.mocked(audit).mock.calls.map((c) => c[0].action);
    expect(acoes).toEqual(["assistente.acao_confirmada", "assistente.acao_executada"]);
    expect(vi.mocked(audit).mock.calls[1]![0]).toMatchObject({ actorUserId: USER, organizationId: ORG, resourceId: id });
  });

  it("cartão repetido: o segundo clique é 409 e não executa de novo", async () => {
    const id = cartao();
    await chamar(confirmar, id);
    const r = await chamar(confirmar, id);
    expect(r.status).toBe(409);
    expect(await codigo(r)).toBe("assistente_acao_indisponivel");
    expect(execEscrever()).toHaveBeenCalledTimes(1);
  });

  it("cartão expirado: 409, não executa, e o estado não muda", async () => {
    const id = cartao({ expira_em: new Date(Date.now() - 1000).toISOString() });
    const r = await chamar(confirmar, id);
    expect(r.status).toBe(409);
    expect(execEscrever()).not.toHaveBeenCalled();
    expect(estadoDe(id)).toBe("proposta");
  });

  it("cartão de outro usuário da mesma empresa: 409, não executa", async () => {
    const id = cartao({ user_id: OUTRO_USER });
    const r = await chamar(confirmar, id);
    expect(r.status).toBe(409);
    expect(execEscrever()).not.toHaveBeenCalled();
    expect(estadoDe(id)).toBe("proposta");
  });

  it("cartão de outra empresa: 409, não executa (mesmo que o usuário seja o mesmo)", async () => {
    const id = cartao({ organization_id: OUTRA_ORG });
    const r = await chamar(confirmar, id);
    expect(r.status).toBe(409);
    expect(execEscrever()).not.toHaveBeenCalled();
  });

  it("os quatro motivos acima respondem IGUAL: a rota não confirma que o cartão existe", async () => {
    const respostas = [];
    for (const sobre of [
      { expira_em: new Date(Date.now() - 1000).toISOString() },
      { user_id: OUTRO_USER },
      { organization_id: OUTRA_ORG },
      { estado: "cancelada" },
    ]) {
      const r = await chamar(confirmar, cartao(sobre));
      respostas.push(`${r.status}:${await codigo(r)}`);
    }
    const inexistente = await chamar(confirmar, "77777777-7777-4777-8777-777777777777");
    respostas.push(`${inexistente.status}:${await codigo(inexistente)}`);
    expect(new Set(respostas)).toEqual(new Set(["409:assistente_acao_indisponivel"]));
  });

  it("a reserva é pedida ao banco com o usuário e a organização da SESSÃO, nunca do corpo", async () => {
    const id = cartao();
    const r = await chamar(confirmar, id, { organization_id: OUTRA_ORG, user_id: OUTRO_USER });
    // Corpo com campo a mais é recusado antes de tudo.
    expect(r.status).toBe(422);
    expect(banco.rpcs.find((x) => x.nome === "fn_assistente_reservar_acao")).toBeUndefined();
    await chamar(confirmar, id);
    expect(banco.rpcs.find((x) => x.nome === "fn_assistente_reservar_acao")!.args).toEqual({ p_org: ORG, p_user: USER, p_acao: id });
  });

  it("viewer com um cartão que era dele: 403 e não executa", async () => {
    sessao("viewer");
    const id = cartao();
    const r = await chamar(confirmar, id);
    expect(r.status).toBe(403);
    expect(execEscrever()).not.toHaveBeenCalled();
    expect(estadoDe(id)).toBe("falhou");
  });

  it("ações desligadas na instalação depois da proposta: 403 e não executa", async () => {
    vi.mocked(moduloLigado).mockResolvedValue(false);
    const id = cartao();
    const r = await chamar(confirmar, id);
    expect(r.status).toBe(403);
    expect(await codigo(r)).toBe("assistente_escritas_desligadas");
    expect(execEscrever()).not.toHaveBeenCalled();
  });

  it("estouro de lote num cartão adulterado: 422 e não executa", async () => {
    const id = cartao({ entrada: { ids: ["1", "2", "3", "4", "5", "6"] } });
    const r = await chamar(confirmar, id);
    expect(r.status).toBe(422);
    expect(await codigo(r)).toBe("assistente_lote_acima_do_limite");
    expect(execEscrever()).not.toHaveBeenCalled();
  });

  it("nível sensível: sem digitar a palavra, 422 e não executa; com a palavra, executa", async () => {
    const sem = await chamar(confirmar, cartao({ capacidade: "teste_sensivel", nivel: "sensivel" }));
    expect(sem.status).toBe(422);
    expect(await codigo(sem)).toBe("assistente_confirmacao_ausente");
    expect(execSensivel()).not.toHaveBeenCalled();
    const com = await chamar(confirmar, cartao({ capacidade: "teste_sensivel", nivel: "sensivel" }), { confirmacao: "confirmar" });
    expect(com.status).toBe(200);
    expect(execSensivel()).toHaveBeenCalledTimes(1);
  });

  it("Vix desligado na instalação ou na empresa: 403, e o cartão nem é reservado", async () => {
    const id = cartao();
    vi.mocked(pagadorDoVix).mockResolvedValue("desligado");
    expect((await chamar(confirmar, id)).status).toBe(403);
    vi.mocked(pagadorDoVix).mockResolvedValue("assinatura_plataforma");
    banco.ligadoNaEmpresa = false;
    expect((await chamar(confirmar, id)).status).toBe(403);
    expect(execEscrever()).not.toHaveBeenCalled();
    expect(estadoDe(id)).toBe("proposta");
  });

  it("organização sem plano nem marca: 403, não executa", async () => {
    banco.config = null;
    const id = cartao();
    const r = await chamar(confirmar, id);
    expect(r.status).toBe(403);
    expect(await codigo(r)).toBe("assistente_fora_do_plano");
    expect(execEscrever()).not.toHaveBeenCalled();
  });

  it("empresa suspensa: o 403 do portão passa adiante e nada roda", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: fail("org_suspended", "suspensa", 403, {}) });
    const id = cartao();
    const r = await chamar(confirmar, id);
    expect(await codigo(r)).toBe("org_suspended");
    expect(execEscrever()).not.toHaveBeenCalled();
    expect(banco.rpcs).toEqual([]);
  });

  it("a recusa nunca devolve detalhe técnico", async () => {
    execEscrever().mockRejectedValueOnce(new Error("violates foreign key constraint crm_leads_fk at 10.0.0.3"));
    const r = await chamar(confirmar, cartao());
    const texto = await r.text();
    expect(r.status).toBe(500);
    expect(texto).not.toContain("10.0.0.3");
    expect(texto).not.toContain("crm_leads");
  });
});

describe("cancelar", () => {
  it("o dono cancela o próprio cartão; cancelado, não confirma mais", async () => {
    const id = cartao();
    expect((await chamar(cancelar, id)).status).toBe(200);
    expect(estadoDe(id)).toBe("cancelada");
    expect((await chamar(confirmar, id)).status).toBe(409);
    expect(execEscrever()).not.toHaveBeenCalled();
  });

  it("cartão de outro usuário ou de outra empresa não é cancelado", async () => {
    for (const sobre of [{ user_id: OUTRO_USER }, { organization_id: OUTRA_ORG }]) {
      const id = cartao(sobre);
      expect((await chamar(cancelar, id)).status).toBe(409);
      expect(estadoDe(id)).toBe("proposta");
    }
  });
});
