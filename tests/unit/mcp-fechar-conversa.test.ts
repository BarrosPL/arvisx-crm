/**
 * FECHAR CONVERSA POR AGENTE — `crm_close_conversation` (Ajustes, PR AJ-1),
 * contra o handler real e `lib/inbox/fechar-conversa.ts`, a mesma regra que a
 * rota `POST /api/v1/conversations/[id]/close` usa.
 *
 * O banco é o de `tests/helpers/banco-em-memoria.ts` (duas organizações nas
 * mesmas tabelas, filtros aplicados de verdade), mais uma `fn_service_status`
 * em memória com o que a função do banco faz e este teste precisa ver: filtro
 * de organização, trava de revisão (`PT409`), fechar o que já está fechado sem
 * escrever, e revisão +1 na transição. O SQL de verdade é coisa de `test:db`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { bancoEmMemoria, type BancoEmMemoria, type Linha } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  audit: vi.fn(async (..._args: unknown[]) => undefined),
  auditDaChamada: vi.fn(async (..._args: unknown[]) => undefined),
  envio: vi.fn(async (..._args: unknown[]) => {
    throw new Error("fechar conversa não pode enviar mensagem");
  }),
}));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: h.auditDaChamada }));
// O ESPIÃO NO ENVIO: a porta por onde toda mensagem sai (tela, API e
// `crm_send_whatsapp_message`). Se o fechamento a alcançar, o teste reprova.
vi.mock("@/app/api/v1/messages/_handler", async (original) => ({
  ...(await original<typeof import("@/app/api/v1/messages/_handler")>()),
  sendMessageHandler: h.envio,
}));

const { crmCloseConversation, MOTIVO_DO_FECHAMENTO_MAX } = await import("@/lib/mcp/tools/fechar-conversa");
const { pickToolsFromMcp } = await import("@/lib/ai/runtime/tools");
const { ESCOPO_DAS_ESCRITAS } = await import("@/lib/ai/runtime/escopo-das-escritas");
const { PACOTE_PADRAO_DO_ONBOARDING } = await import("@/lib/ai/agents/capacidades-padrao");
const { ROLE_RANK } = await import("@/lib/auth/types");
const { MODULOS_OPCIONAIS } = await import("@/lib/instalacao/modulos");
const { ALVO_DE_FUNIL } = await import("@/lib/leads/escopo-de-funil");
const { allTools, getToolByName } = await import("@/lib/mcp/tools");
const { catalogEntry, TOOL_CATALOG } = await import("@/lib/mcp/tools/catalog");
const { IDS_DO_HARNESS } = await import("@/lib/mcp/tools/ferramentas-do-harness");
const { PACOTES } = await import("@/lib/mcp/tools/pacotes");
const {
  TETO_TOOLS_POR_AGENTE,
  capacidadesAutomaticasDoPacote,
  desligarPacote,
  ligarPacote,
  vagasExigidasPeloPacote,
} = await import("@/lib/mcp/tools/selecao-por-pacote");
const { CAPACIDADES_DA_ORGANIZACAO } = await import("@/lib/organizacao/capacidades");
import type { McpContext } from "@/lib/mcp/types";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const TOKEN = "aaaaaaaa-0000-4000-8000-0000000000f1";
const AGENTE_NATIVO = "aaaaaaaa-0000-4000-8000-0000000000a9";
const CONTATO_A = "aaaaaaaa-0000-4000-8000-0000000000c1";
const CONTATO_A2 = "aaaaaaaa-0000-4000-8000-0000000000c2";
const CONTATO_PESSOAL = "aaaaaaaa-0000-4000-8000-0000000000c3";
const CONTATO_B = "bbbbbbbb-0000-4000-8000-0000000000c1";
const CONVERSA_ABERTA = "aaaaaaaa-0000-4000-8000-0000000000e1";
const CONVERSA_FECHADA = "aaaaaaaa-0000-4000-8000-0000000000e2";
const CONVERSA_ARQUIVADA = "aaaaaaaa-0000-4000-8000-0000000000e3";
const CONVERSA_DE_OUTRO_CLIENTE = "aaaaaaaa-0000-4000-8000-0000000000e4";
const CONVERSA_PESSOAL = "aaaaaaaa-0000-4000-8000-0000000000e5";
const CONVERSA_B = "bbbbbbbb-0000-4000-8000-0000000000e1";
const INEXISTENTE = "aaaaaaaa-0000-4000-8000-0000000000ee";

const TERMINAIS = ["closed", "resolved", "archived"];

let banco: BancoEmMemoria;
let rpcs: Array<{ fn: string; args: Record<string, unknown> }>;
/** Roda uma vez, logo antes da função do banco: simula quem mexeu no meio. */
let antesDoBanco: (() => void) | null;
let erroDoBanco: { code: string; message: string } | null;

const conversa = (id: string): Linha => banco.tabelas.conversations!.find((c) => c.id === id)!;

/** O que a `fn_service_status` do baseline faz, no que este teste mede. */
async function rpc(fn: string, args: Record<string, unknown>) {
  rpcs.push({ fn, args });
  if (fn !== "fn_service_status") throw new Error(`rpc não prevista: ${fn}`);
  antesDoBanco?.();
  antesDoBanco = null;
  if (erroDoBanco) return { data: null, error: erroDoBanco };

  const c = banco.tabelas.conversations!.find(
    (l) => l.id === args.p_conversation && l.organization_id === args.p_org,
  );
  if (!c) return { data: null, error: { code: "P0002", message: "service_not_found" } };
  if (args.p_expected != null && c.service_revision !== args.p_expected) {
    return { data: null, error: { code: "PT409", message: "service_stale" } };
  }
  if (c.status === args.p_status) return { data: { ...c }, error: null };
  const terminal = TERMINAIS.includes(String(args.p_status));
  if (terminal || TERMINAIS.includes(String(c.status))) c.service_revision = Number(c.service_revision) + 1;
  c.status = args.p_status;
  if (terminal) c.service_closed_at = "2026-11-20T12:00:00.000Z";
  return { data: { ...c }, error: null };
}

function ctx(extra: Partial<McpContext> = {}): McpContext {
  return {
    organizationId: ORG_A,
    role: "agent",
    actor: { type: "api_token", id: TOKEN, role: "agent" },
    apiTokenId: TOKEN,
    requestId: "req-1",
    supabase: { ...banco.cliente, rpc } as never,
    ...extra,
  };
}

type Resposta = Record<string, unknown>;
const fechar = (args: Record<string, unknown>, c = ctx()) =>
  crmCloseConversation.handler(args as never, c) as Promise<Resposta>;

beforeEach(() => {
  h.audit.mockClear();
  h.envio.mockClear();
  rpcs = [];
  antesDoBanco = null;
  erroDoBanco = null;
  const linha = (id: string, org: string, contato: string, status: string, revisao: number): Linha => ({
    id,
    organization_id: org,
    contact_id: contato,
    status,
    assigned_to_user_id: null,
    service_revision: revisao,
    service_closed_at: TERMINAIS.includes(status) ? "2026-11-01T10:00:00.000Z" : null,
  });
  banco = bancoEmMemoria({
    contacts: [
      { id: CONTATO_A, organization_id: ORG_A, is_personal: false },
      { id: CONTATO_A2, organization_id: ORG_A, is_personal: false },
      { id: CONTATO_PESSOAL, organization_id: ORG_A, is_personal: true },
      { id: CONTATO_B, organization_id: ORG_B, is_personal: false },
    ],
    conversations: [
      linha(CONVERSA_ABERTA, ORG_A, CONTATO_A, "open", 3),
      linha(CONVERSA_FECHADA, ORG_A, CONTATO_A, "closed", 8),
      linha(CONVERSA_ARQUIVADA, ORG_A, CONTATO_A, "archived", 5),
      linha(CONVERSA_DE_OUTRO_CLIENTE, ORG_A, CONTATO_A2, "open", 1),
      linha(CONVERSA_PESSOAL, ORG_A, CONTATO_PESSOAL, "open", 1),
      linha(CONVERSA_B, ORG_B, CONTATO_B, "open", 4),
    ],
  });
});

describe("crm_close_conversation fecha a conversa", () => {
  it("⭐ fecha pela função do banco, com a organização do TOKEN e a revisão lida", async () => {
    const r = await fechar({ conversation_id: CONVERSA_ABERTA });

    expect(r).toMatchObject({ conversation_id: CONVERSA_ABERTA, status: "closed", already_closed: false });
    expect(rpcs).toEqual([
      {
        fn: "fn_service_status",
        args: { p_org: ORG_A, p_conversation: CONVERSA_ABERTA, p_status: "closed", p_expected: 3 },
      },
    ]);
    expect(conversa(CONVERSA_ABERTA)).toMatchObject({ status: "closed", service_revision: 4 });
  });

  it("o motivo é opcional, tem teto, e a ferramenta não aceita organização como argumento", () => {
    const esquema = z.object(crmCloseConversation.inputSchema);
    expect(esquema.safeParse({ conversation_id: CONVERSA_ABERTA }).success).toBe(true);
    expect(esquema.safeParse({ conversation_id: CONVERSA_ABERTA, reason: "sem resposta há 5 dias" }).success).toBe(true);
    expect(
      esquema.safeParse({ conversation_id: CONVERSA_ABERTA, reason: "x".repeat(MOTIVO_DO_FECHAMENTO_MAX + 1) }).success,
    ).toBe(false);
    expect(esquema.safeParse({ conversation_id: "não é uuid" }).success).toBe(false);
    const campos = Object.keys(crmCloseConversation.inputSchema);
    expect(campos).not.toContain("organization_id");
    expect(campos).not.toContain("org_id");
  });
});

describe("conversa assumida por uma pessoa (revisão 20/11, item 2.31)", () => {
  // Decisão do dono registrada no PR #14 (20/11): a ferramenta segue fechando
  // qualquer conversa aberta da organização, sem trava por atendente humano
  // responsável. Este teste FIXA a decisão; se ela mudar, ele muda junto com a
  // descrição e com `docs/arvisx/SUPERFICIE-DE-AGENTE.md`.
  it("token comum fecha a conversa que tem atendente humano responsável", async () => {
    conversa(CONVERSA_ABERTA).assigned_to_user_id = "aaaaaaaa-0000-4000-8000-0000000000f1";

    const r = await fechar({ conversation_id: CONVERSA_ABERTA });

    expect(r).toMatchObject({ conversation_id: CONVERSA_ABERTA, status: "closed", already_closed: false });
    expect(conversa(CONVERSA_ABERTA).status).toBe("closed");
    expect(h.audit).toHaveBeenCalledTimes(1);
  });

  it("a descrição avisa o modelo de que a ferramenta não respeita o dono humano", () => {
    expect(crmCloseConversation.description).toMatch(/pessoa da equipe assumiu/);
  });
});

describe("⭐ organização errada", () => {
  it("conversa de OUTRA organização: recusa, sem tocar no banco e sem auditoria", async () => {
    const antes = { ...conversa(CONVERSA_B) };

    const r = await fechar({ conversation_id: CONVERSA_B });

    expect(r).toMatchObject({ permitido: false, motivo: "conversa_nao_encontrada" });
    expect(rpcs).toEqual([]);
    expect(conversa(CONVERSA_B)).toEqual(antes);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("`organization_id` nos argumentos não muda nada: vale a do token", async () => {
    const r = await fechar({ conversation_id: CONVERSA_B, organization_id: ORG_B });

    expect(r).toMatchObject({ permitido: false, motivo: "conversa_nao_encontrada" });
    expect(conversa(CONVERSA_B).status).toBe("open");
    expect(rpcs).toEqual([]);
  });

  it("a mesma resposta para a conversa de outra organização e para a que não existe", async () => {
    const deOutra = await fechar({ conversation_id: CONVERSA_B });
    const inexistente = await fechar({ conversation_id: INEXISTENTE });
    expect(deOutra).toEqual(inexistente);
  });

  it("controle: o token da organização B fecha a conversa dela", async () => {
    const r = await fechar({ conversation_id: CONVERSA_B }, ctx({ organizationId: ORG_B }));
    expect(r).toMatchObject({ status: "closed", already_closed: false });
    expect(conversa(CONVERSA_B).status).toBe("closed");
  });
});

describe("⭐ idempotência", () => {
  it("conversa já fechada: sucesso, sem escrita e sem nova linha de auditoria", async () => {
    const antes = { ...conversa(CONVERSA_FECHADA) };

    const r = await fechar({ conversation_id: CONVERSA_FECHADA, reason: "de novo" });

    expect(r).toMatchObject({ conversation_id: CONVERSA_FECHADA, status: "closed", already_closed: true });
    expect(r.permitido).toBeUndefined();
    expect(rpcs).toEqual([]);
    expect(conversa(CONVERSA_FECHADA)).toEqual(antes);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("repetir o mesmo pedido: uma transição, uma auditoria", async () => {
    const primeira = await fechar({ conversation_id: CONVERSA_ABERTA });
    const segunda = await fechar({ conversation_id: CONVERSA_ABERTA });
    const terceira = await fechar({ conversation_id: CONVERSA_ABERTA });

    expect(primeira.already_closed).toBe(false);
    expect(segunda).toMatchObject({ status: "closed", already_closed: true });
    expect(terceira).toMatchObject({ status: "closed", already_closed: true });
    expect(rpcs).toHaveLength(1);
    expect(conversa(CONVERSA_ABERTA).service_revision).toBe(4);
    expect(h.audit).toHaveBeenCalledTimes(1);
  });

  it("conversa arquivada continua arquivada: a ferramenta não a traz de volta", async () => {
    const r = await fechar({ conversation_id: CONVERSA_ARQUIVADA });

    expect(r).toMatchObject({ status: "archived", already_closed: true });
    expect(conversa(CONVERSA_ARQUIVADA)).toMatchObject({ status: "archived", service_revision: 5 });
    expect(rpcs).toEqual([]);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("dois pedidos juntos: quem perde a corrida recebe sucesso, e só o outro audita", async () => {
    antesDoBanco = () => {
      const c = conversa(CONVERSA_ABERTA);
      c.status = "closed";
      c.service_revision = 4;
    };

    const r = await fechar({ conversation_id: CONVERSA_ABERTA });

    expect(r).toMatchObject({ status: "closed", already_closed: true });
    expect(conversa(CONVERSA_ABERTA).service_revision).toBe(4);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("o atendimento mudou no meio (não foi fechamento): recusa e NÃO fecha por cima", async () => {
    antesDoBanco = () => {
      conversa(CONVERSA_ABERTA).service_revision = 9;
    };

    const r = await fechar({ conversation_id: CONVERSA_ABERTA });

    expect(r).toMatchObject({ permitido: false, motivo: "conversa_mudou" });
    expect(conversa(CONVERSA_ABERTA).status).toBe("open");
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("falha do banco não vira sucesso nem auditoria", async () => {
    erroDoBanco = { code: "XX000", message: "boom" };

    const r = await fechar({ conversation_id: CONVERSA_ABERTA });

    expect(r).toMatchObject({ permitido: false, motivo: "indisponivel" });
    expect(JSON.stringify(r)).not.toContain("boom");
    expect(h.audit).not.toHaveBeenCalled();
  });
});

describe("⭐ auditoria com o agente como ator", () => {
  it("token de API: `conversation.closed`, com o token, sem pessoa, e o motivo", async () => {
    await fechar({ conversation_id: CONVERSA_ABERTA, reason: "cliente não respondeu há 5 dias" });

    expect(h.audit).toHaveBeenCalledTimes(1);
    expect(h.audit.mock.calls[0]![0]).toEqual({
      action: "conversation.closed",
      actorUserId: null,
      actorApiTokenId: TOKEN,
      organizationId: ORG_A,
      resourceType: "conversation",
      resourceId: CONVERSA_ABERTA,
      requestId: "req-1",
      metadata: {
        via: "mcp",
        actor_type: "api_token",
        actor_id: TOKEN,
        previous_status: "open",
        reason: "cliente não respondeu há 5 dias",
      },
    });
  });

  it("agente nativo: a auditoria guarda QUAL agente fechou", async () => {
    const nativo = ctx({
      role: "ai_operator",
      actor: { type: "ai_agent", id: "run-1", role: "ai_operator", agent_id: AGENTE_NATIVO },
      contatoDoTurno: CONTATO_A,
    });

    await fechar({ conversation_id: CONVERSA_ABERTA }, nativo);

    const entrada = h.audit.mock.calls[0]![0] as { actorUserId: unknown; metadata: Record<string, unknown> };
    expect(entrada.actorUserId).toBeNull();
    expect(entrada.metadata).toMatchObject({ via: "mcp", actor_type: "ai_agent", actor_id: "run-1", agent_id: AGENTE_NATIVO });
    expect(entrada.metadata).not.toHaveProperty("reason");
  });
});

describe("⭐ o cliente não recebe mensagem", () => {
  it("fechar não alcança o envio, não fala com a rede e não escreve fora da conversa", async () => {
    const rede = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("rede não é usada aqui"));
    try {
      await fechar({ conversation_id: CONVERSA_ABERTA, reason: "sem resposta" });

      expect(h.envio).not.toHaveBeenCalled();
      expect(rede).not.toHaveBeenCalled();
    } finally {
      rede.mockRestore();
    }
    // Só duas tabelas são LIDAS (a conversa e o contato), e a única escrita é a
    // função de estado do atendimento: nenhuma mensagem, evento ou fila nasce.
    expect(Object.keys(banco.consultas).sort()).toEqual(["contacts", "conversations"]);
    expect(rpcs.map((c) => c.fn)).toEqual(["fn_service_status"]);
    for (const tabela of ["messages", "event_log", "cron_jobs", "conversation_drafts"]) {
      expect(banco.tabelas[tabela] ?? [], tabela).toEqual([]);
    }
  });

  it("a trava de atendimento humano do contato fica como estava", async () => {
    const contato = banco.tabelas.contacts!.find((c) => c.id === CONTATO_A)!;
    contato.force_human = true;

    await fechar({ conversation_id: CONVERSA_ABERTA });

    expect(contato.force_human).toBe(true);
  });
});

describe("as travas desta porta", () => {
  it("num turno, a conversa de OUTRO cliente e a inexistente recebem a mesma recusa", async () => {
    const turno = ctx({ contatoDoTurno: CONTATO_A });

    const deOutro = await fechar({ conversation_id: CONVERSA_DE_OUTRO_CLIENTE }, turno);
    const inexistente = await fechar({ conversation_id: INEXISTENTE }, turno);

    expect(deOutro).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
    expect(inexistente).toEqual(deOutro);
    expect(conversa(CONVERSA_DE_OUTRO_CLIENTE).status).toBe("open");
    expect(rpcs).toEqual([]);
  });

  it("num turno, a conversa do próprio cliente fecha", async () => {
    const r = await fechar({ conversation_id: CONVERSA_ABERTA }, ctx({ contatoDoTurno: CONTATO_A }));
    expect(r).toMatchObject({ status: "closed", already_closed: false });
  });

  it("conversa de contato pessoal fica fora da operação", async () => {
    const r = await fechar({ conversation_id: CONVERSA_PESSOAL });

    expect(r).toMatchObject({ permitido: false, motivo: "contato_pessoal" });
    expect(conversa(CONVERSA_PESSOAL).status).toBe("open");
    expect(rpcs).toEqual([]);
  });
});

describe("⭐ no catálogo: aparece / não aparece conforme o pacote", () => {
  const NOME = "crm_close_conversation";
  const PACOTE = "reter";
  const CATALOGO = TOOL_CATALOG.map((t) => ({ name: t.name, risco: t.risco, pacotes: t.pacotes }));

  it("tem handler e entrada de catálogo, é escrita e não é do harness nem só de pessoa", () => {
    expect(getToolByName(NOME)).toMatchObject({ category: "write", requiresScope: "mcp:write" });
    expect(catalogEntry(NOME)).toBeDefined();
    expect(IDS_DO_HARNESS.has(NOME)).toBe(false);
    expect(catalogEntry(NOME)!.apenasHumano).toBeFalsy();
    expect(allTools.map((t) => t.name)).toContain(NOME);
  });

  it("papel mínimo `agent`: token comum e agente nativo alcançam; quem só lê, não", () => {
    const exigido = getToolByName(NOME)!.requiresRole;
    expect(exigido).toBe("agent");
    expect(ROLE_RANK.ai_operator >= ROLE_RANK[exigido]).toBe(true);
    expect(ROLE_RANK.viewer >= ROLE_RANK[exigido]).toBe(false);
  });

  it("tem dono declarado no turno (a conversa) e alvo de funil decidido", () => {
    expect(ESCOPO_DAS_ESCRITAS[NOME]).toEqual({ conversation_id: "conversa" });
    expect(ALVO_DE_FUNIL[NOME]).toBe("sem_funil");
  });

  it("entra pelo pacote dela, e só por ele", () => {
    expect(catalogEntry(NOME)!.pacotes).toEqual([PACOTE]);
    for (const p of PACOTES) {
      const ligadas = ligarPacote([], CATALOGO as never, p.id);
      expect(ligadas.includes(NOME), `com o pacote ${p.id} ligado`).toBe(p.id === PACOTE);
    }
  });

  it("não fala com o cliente: não é `critico`, então o toggle do pacote a liga — e desligar a tira", () => {
    expect(catalogEntry(NOME)!.risco).toBe("atencao");
    expect(capacidadesAutomaticasDoPacote(CATALOGO as never, PACOTE)).toContain(NOME);

    const ligadas = ligarPacote([], CATALOGO as never, PACOTE);
    const todos = PACOTES.map((p) => p.id);
    expect(desligarPacote(ligadas, CATALOGO as never, PACOTE, todos)).not.toContain(NOME);
  });

  it("o agente que nasce no onboarding não a ganha sem alguém ligar", () => {
    const doOnboarding = ligarPacote([], CATALOGO as never, PACOTE_PADRAO_DO_ONBOARDING as never);
    expect(doOnboarding).not.toContain(NOME);
  });

  it("o pacote continua cabendo sozinho no teto por agente", () => {
    expect(vagasExigidasPeloPacote([], CATALOGO as never, PACOTE)).toBeLessThanOrEqual(TETO_TOOLS_POR_AGENTE);
  });

  describe("a ponte do turno monta só para quem ligou", () => {
    const ator = { type: "ai_agent", id: "run-1", role: "ai_operator" };

    function montar(toolIds: string[]) {
      const supabase = { from: () => ({}) };
      return pickToolsFromMcp({
        toolIds,
        auth: { organizationId: ORG_A, role: "ai_operator", scopes: ["mcp:read", "mcp:write"], actor: ator, apiTokenId: "tok-1" },
        ctx: { organizationId: ORG_A, role: "ai_operator", actor: ator, apiTokenId: "tok-1", requestId: "req-1", supabase },
        supabase,
        pipelineIds: [],
        modulosLigados: MODULOS_OPCIONAIS,
        capacidadesLigadas: CAPACIDADES_DA_ORGANIZACAO,
        handoffToolEnabled: true,
        proposalAiDraftEnabled: true,
        handoffSignal: { triggered: false },
      } as never);
    }

    it("ligada, chega ao modelo; sem ligar, não chega", () => {
      expect(Object.keys(montar([NOME]))).toContain(NOME);
      expect(Object.keys(montar(["crm_get_lead"]))).not.toContain(NOME);
    });
  });
});
