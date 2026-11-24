/**
 * AS QUATRO FERRAMENTAS DE TAREFA, contra os handlers REAIS e o serviço REAL
 * (`lib/tarefas/servico.ts` — o mesmo que a rota da tela usa).
 *
 * O banco é o de `tests/helpers/banco-em-memoria.ts`: os filtros são aplicados
 * de verdade sobre linhas de DUAS organizações, então um `.eq("organization_id")`
 * apagado faz o teste de isolamento reprovar. Constraint, RLS e o SQL real ficam
 * com `pnpm test:db` (`tests/invariants/superficie-de-agente-9809.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, portaEmMemoria, type BancoEmMemoria } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  audit: vi.fn(async (..._args: unknown[]) => undefined),
  porta: { atual: null as unknown },
}));

vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/db", () => ({ portaDaAplicacao: () => h.porta.atual }));

const { crmCompleteTask, crmCreateTask, crmListTasks, crmUpdateTask } = await import(
  "@/lib/mcp/tools/tarefas"
);
import type { McpContext } from "@/lib/mcp/types";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const TOKEN_A = "aaaaaaaa-0000-4000-8000-0000000000f1";
const ANA = "aaaaaaaa-0000-4000-8000-0000000000a1"; // atendente da A
const LEITOR = "aaaaaaaa-0000-4000-8000-0000000000a2"; // viewer da A
const BIA = "bbbbbbbb-0000-4000-8000-0000000000b1"; // atendente da B
const CONTATO_A = "aaaaaaaa-0000-4000-8000-0000000000c1";
const CONTATO_A2 = "aaaaaaaa-0000-4000-8000-0000000000c2";
const CONTATO_B = "bbbbbbbb-0000-4000-8000-0000000000c1";
const NEGOCIO_A = "aaaaaaaa-0000-4000-8000-0000000000d1";
const NEGOCIO_A2 = "aaaaaaaa-0000-4000-8000-0000000000d2";
const NEGOCIO_B = "bbbbbbbb-0000-4000-8000-0000000000d1";
const TAREFA_B = "bbbbbbbb-0000-4000-8000-0000000000e1";
const FUNIL = "aaaaaaaa-0000-4000-8000-000000000011";

let banco: BancoEmMemoria;

function ctx(extra: Partial<McpContext> = {}): McpContext {
  return {
    organizationId: ORG_A,
    role: "agent",
    actor: { type: "api_token", id: TOKEN_A, role: "agent" },
    apiTokenId: TOKEN_A,
    requestId: "req-1",
    supabase: banco.cliente as never,
    ...extra,
  };
}

beforeEach(() => {
  h.audit.mockClear();
  banco = bancoEmMemoria({
    user_organizations: [
      { organization_id: ORG_A, user_id: ANA, role: "agent", revoked_at: null },
      { organization_id: ORG_A, user_id: LEITOR, role: "viewer", revoked_at: null },
      { organization_id: ORG_B, user_id: BIA, role: "agent", revoked_at: null },
    ],
    contacts: [
      { id: CONTATO_A, organization_id: ORG_A, is_personal: false },
      { id: CONTATO_A2, organization_id: ORG_A, is_personal: false },
      { id: CONTATO_B, organization_id: ORG_B, is_personal: false },
    ],
    crm_leads: [
      { id: NEGOCIO_A, organization_id: ORG_A, contact_id: CONTATO_A, pipeline_id: FUNIL, title: "Negócio A" },
      { id: NEGOCIO_A2, organization_id: ORG_A, contact_id: CONTATO_A2, pipeline_id: FUNIL, title: "Negócio A2" },
      { id: NEGOCIO_B, organization_id: ORG_B, contact_id: CONTATO_B, pipeline_id: FUNIL, title: "Negócio B" },
    ],
    crm_tasks: [
      {
        id: TAREFA_B,
        organization_id: ORG_B,
        title: "Tarefa da outra empresa",
        description: null,
        due_date: null,
        priority: "medium",
        status: "pending",
        lead_id: NEGOCIO_B,
        contact_id: CONTATO_B,
        assigned_to: null,
        created_at: "2026-11-01T10:00:00.000Z",
        updated_at: "2026-11-01T10:00:00.000Z",
      },
    ],
  });
  h.porta.atual = portaEmMemoria(banco);
});

type Resposta = Record<string, unknown>;
const criar = (args: Record<string, unknown>, c = ctx()) =>
  crmCreateTask.handler(args as never, c) as Promise<Resposta>;
const listar = (args: Record<string, unknown>, c = ctx()) =>
  crmListTasks.handler({ state: "open", limit: 25, ...args } as never, c) as Promise<Resposta>;
const concluir = (args: Record<string, unknown>, c = ctx()) =>
  crmCompleteTask.handler(args as never, c) as Promise<Resposta>;
const editar = (args: Record<string, unknown>, c = ctx()) =>
  crmUpdateTask.handler(args as never, c) as Promise<Resposta>;

const tarefasDaA = () => banco.tabelas.crm_tasks!.filter((t) => t.organization_id === ORG_A);
const atividades = () => banco.tabelas.crm_lead_activities ?? [];

describe("crm_create_task", () => {
  it("⭐ grava na organização do TOKEN, com tipo, prazo, prioridade e responsável", async () => {
    const r = await criar({
      title: "Ligar de volta",
      description: "Confirmar os documentos",
      due_date: "2026-11-25T15:00:00-03:00",
      priority: "high",
      kind: "ligação",
      assigned_to: ANA,
      lead_id: NEGOCIO_A,
    });

    expect(r.task).toMatchObject({
      title: "Ligar de volta",
      kind: "ligação",
      priority: "high",
      assigned_to: ANA,
      lead_id: NEGOCIO_A,
      // herdado do negócio: a tarefa aparece também nas tarefas da pessoa
      contact_id: CONTATO_A,
      status: "pending",
    });
    const [gravada] = tarefasDaA();
    expect(gravada).toMatchObject({ organization_id: ORG_A, created_by: null, kind: "ligação" });
  });

  it("⭐ audita com o AGENTE como ator: o token, nunca um usuário", async () => {
    await criar({ title: "Conferir contrato", lead_id: NEGOCIO_A });

    expect(h.audit).toHaveBeenCalledTimes(1);
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "crm_task.created",
        organizationId: ORG_A,
        actorUserId: null,
        actorApiTokenId: TOKEN_A,
        resourceType: "crm_tasks",
        metadata: expect.objectContaining({ via: "mcp", actor_type: "api_token", actor_id: TOKEN_A }),
      }),
    );
  });

  it("tarefa presa a um negócio deixa a linha 'tarefa combinada' na timeline dele", async () => {
    await criar({ title: "Enviar proposta", lead_id: NEGOCIO_A });

    expect(atividades()).toHaveLength(1);
    expect(atividades()[0]).toMatchObject({
      organization_id: ORG_A,
      lead_id: NEGOCIO_A,
      type: "task_created",
      // token de API não é pessoa nem agente cadastrado: assina como sistema
      actor_kind: "system",
      performed_by_user_id: null,
    });
  });

  it("'equipe' (e a omissão) gravam sem responsável", async () => {
    const explicita = await criar({ title: "Uma", assigned_to: "equipe" });
    const omitida = await criar({ title: "Outra" });
    expect((explicita.task as Resposta).assigned_to).toBeNull();
    expect((omitida.task as Resposta).assigned_to).toBeNull();
  });

  it("⭐ negócio de OUTRA organização é recusado e nada é gravado", async () => {
    const r = await criar({ title: "Vazaria", lead_id: NEGOCIO_B });

    expect(r).toMatchObject({ permitido: false, motivo: "negocio_nao_encontrado" });
    expect(tarefasDaA()).toHaveLength(0);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("⭐ contato de OUTRA organização é recusado e nada é gravado", async () => {
    const r = await criar({ title: "Vazaria", contact_id: CONTATO_B });

    expect(r).toMatchObject({ permitido: false, motivo: "contato_nao_encontrado" });
    expect(tarefasDaA()).toHaveLength(0);
  });

  it("⭐ responsável de OUTRA organização é recusado — a chave estrangeira não olha empresa", async () => {
    const r = await criar({ title: "Vazaria", assigned_to: BIA });

    expect(r).toMatchObject({ permitido: false, motivo: "responsavel_fora_da_equipe" });
    expect(tarefasDaA()).toHaveLength(0);
  });

  it("quem só lê (viewer) não recebe tarefa — a mesma régua da tela", async () => {
    const r = await criar({ title: "Não cumpre", assigned_to: LEITOR });
    expect(r).toMatchObject({ permitido: false, motivo: "responsavel_fora_da_equipe" });
  });

  it("prazo fora do formato e responsável que não é id nem 'equipe' são recusas que ensinam, e nada é gravado", async () => {
    const prazo = await criar({ title: "x", due_date: "amanhã às 15h" });
    expect(prazo).toMatchObject({ permitido: false, motivo: "data_invalida" });
    expect(String(prazo.mensagem)).toMatch(/ISO-8601/);

    const semFuso = await criar({ title: "x", due_date: "2026-11-25T15:00:00" });
    expect(semFuso).toMatchObject({ permitido: false, motivo: "data_invalida" });

    const dono = await criar({ title: "x", assigned_to: "a Ana do financeiro" });
    expect(dono).toMatchObject({ permitido: false, motivo: "responsavel_invalido" });

    expect(tarefasDaA()).toHaveLength(0);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("descrição longa entra INTEIRA", async () => {
    const longa = "x".repeat(5000);
    const r = await criar({ title: "Com detalhe", description: longa });
    expect((r.task as Resposta).description).toBe(longa);
  });

  it("⭐ a mesma Idempotency-Key não cria a tarefa duas vezes", async () => {
    const chave = "11111111-1111-4111-8111-111111111111";
    const pedido = { title: "Uma vez só", lead_id: NEGOCIO_A };

    const primeira = await criar(pedido, ctx({ idempotencyKey: chave }));
    const segunda = await criar(pedido, ctx({ idempotencyKey: chave }));

    expect(tarefasDaA()).toHaveLength(1);
    expect((segunda.task as Resposta).id).toBe((primeira.task as Resposta).id);
    expect(segunda.idempotent_replay).toBe(true);
    expect(h.audit).toHaveBeenCalledTimes(1);
  });

  it("a mesma chave com OUTROS dados é recusada, e não cria nada", async () => {
    const chave = "22222222-2222-4222-8222-222222222222";
    await criar({ title: "Primeiro pedido" }, ctx({ idempotencyKey: chave }));
    const r = await criar({ title: "Pedido diferente" }, ctx({ idempotencyKey: chave }));

    expect(r).toMatchObject({ permitido: false, motivo: "chave_de_idempotencia_em_conflito" });
    expect(tarefasDaA()).toHaveLength(1);
  });

  it("recusa não vira recibo: resolvido o motivo, o MESMO pedido com a MESMA chave é atendido", async () => {
    const chave = "33333333-3333-4333-8333-333333333333";
    const pedido = { title: "Para o novato", assigned_to: LEITOR };

    const recusado = await criar(pedido, ctx({ idempotencyKey: chave }));
    expect(recusado).toMatchObject({ permitido: false, motivo: "responsavel_fora_da_equipe" });

    // O administrador promove quem só lia: a recusa de antes deixou de valer.
    banco.tabelas.user_organizations!.find((u) => u.user_id === LEITOR)!.role = "agent";

    const aceito = await criar(pedido, ctx({ idempotencyKey: chave }));
    expect(aceito.task).toMatchObject({ assigned_to: LEITOR });
    expect(tarefasDaA()).toHaveLength(1);
  });

  it("no turno de atendimento, negócio de outro cliente e negócio inexistente recebem a MESMA recusa", async () => {
    const turno = ctx({ contatoDoTurno: CONTATO_A });
    const alheio = await criar({ title: "x", lead_id: NEGOCIO_A2 }, turno);
    const inexistente = await criar({ title: "x", lead_id: "99999999-9999-4999-8999-999999999999" }, turno);

    expect(alheio).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
    expect(inexistente).toEqual(alheio);
    expect(tarefasDaA()).toHaveLength(0);
  });
});

describe("crm_complete_task", () => {
  async function tarefaAberta(extra: Record<string, unknown> = {}) {
    const r = await criar({ title: "A cumprir", lead_id: NEGOCIO_A, ...extra });
    h.audit.mockClear();
    return (r.task as Resposta).id as string;
  }

  it("⭐ conclui, guarda o resultado INTEIRO e deixa UMA linha de conclusão na timeline", async () => {
    const id = await tarefaAberta();
    const resultado = "Cliente confirmou. Segue o combinado.".repeat(500); // ~18 mil caracteres

    const r = await concluir({ task_id: id, result: resultado });

    expect(r).toMatchObject({ completed: true, already_completed: false });
    expect((r.task as Resposta).status).toBe("done");
    expect((r.task as Resposta).result).toBe(resultado);
    expect(tarefasDaA()[0]!.result).toBe(resultado);
    expect(atividades().filter((a) => a.type === "task_completed")).toHaveLength(1);
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "crm_task.updated",
        actorUserId: null,
        actorApiTokenId: TOKEN_A,
        metadata: expect.objectContaining({ via: "mcp" }),
      }),
    );
  });

  it("⭐ idempotente: concluir de novo não grava, não audita e não repete a linha da timeline", async () => {
    const id = await tarefaAberta();
    await concluir({ task_id: id, result: "Feito na primeira vez" });
    h.audit.mockClear();

    const r = await concluir({ task_id: id, result: "Tentando sobrescrever" });

    expect(r).toMatchObject({ completed: true, already_completed: true });
    expect(tarefasDaA()[0]!.result).toBe("Feito na primeira vez");
    expect(atividades().filter((a) => a.type === "task_completed")).toHaveLength(1);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("⭐ tarefa de OUTRA organização: recusa, e a tarefa da outra empresa fica como estava", async () => {
    const r = await concluir({ task_id: TAREFA_B, result: "não é minha" });

    expect(r).toMatchObject({ permitido: false, motivo: "tarefa_nao_encontrada" });
    expect(banco.tabelas.crm_tasks!.find((t) => t.id === TAREFA_B)).toMatchObject({ status: "pending" });
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("tarefa cancelada não é concluída", async () => {
    const id = await tarefaAberta();
    tarefasDaA()[0]!.status = "cancelled";

    const r = await concluir({ task_id: id });

    expect(r).toMatchObject({ permitido: false, motivo: "tarefa_cancelada" });
    expect(tarefasDaA()[0]!.status).toBe("cancelled");
  });

  it("o resultado não vai para a auditoria: só o tamanho", () => {
    const limpo = crmCompleteTask.redigirParaAuditoria!({ task_id: "t", result: "dado do cliente" });
    expect(limpo).toEqual({ task_id: "t", result: "[15 caracteres]" });
  });
});

describe("crm_update_task", () => {
  it("muda o prazo e o responsável, e audita com o token", async () => {
    const criada = await criar({ title: "Reagendar" });
    h.audit.mockClear();
    const id = (criada.task as Resposta).id as string;

    const r = await editar({ task_id: id, due_date: "2026-12-01T12:00:00Z", assigned_to: ANA });

    expect(r.task).toMatchObject({ due_date: "2026-12-01T12:00:00Z", assigned_to: ANA, status: "pending" });
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "crm_task.updated", actorApiTokenId: TOKEN_A, actorUserId: null }),
    );
  });

  it("'equipe' tira o responsável; null tira o prazo", async () => {
    const criada = await criar({ title: "Soltar", assigned_to: ANA, due_date: "2026-12-01T12:00:00Z" });
    const r = await editar({ task_id: (criada.task as Resposta).id, assigned_to: "equipe", due_date: null });
    expect(r.task).toMatchObject({ assigned_to: null, due_date: null });
  });

  it("⭐ responsável de OUTRA organização é recusado e a tarefa não muda", async () => {
    const criada = await criar({ title: "Fica com a Ana", assigned_to: ANA });
    const r = await editar({ task_id: (criada.task as Resposta).id, assigned_to: BIA });

    expect(r).toMatchObject({ permitido: false, motivo: "responsavel_fora_da_equipe" });
    expect(tarefasDaA()[0]!.assigned_to).toBe(ANA);
  });

  it("⭐ tarefa de OUTRA organização: recusa, e ela não muda", async () => {
    const r = await editar({ task_id: TAREFA_B, assigned_to: ANA });

    expect(r).toMatchObject({ permitido: false, motivo: "tarefa_nao_encontrada" });
    expect(banco.tabelas.crm_tasks!.find((t) => t.id === TAREFA_B)!.assigned_to).toBeNull();
  });

  it("sem nada para mudar é recusa, não um 'atualizada' vazio", async () => {
    const r = await editar({ task_id: TAREFA_B });
    expect(r).toMatchObject({ permitido: false, motivo: "nada_para_alterar" });
  });
});

describe("crm_list_tasks", () => {
  beforeEach(async () => {
    // Três da A, em ordem de criação: uma vencida da Ana, uma futura da equipe, uma concluída.
    await criar({ title: "Vencida", lead_id: NEGOCIO_A, due_date: "2020-01-01T00:00:00Z", assigned_to: ANA });
    await criar({ title: "Futura", lead_id: NEGOCIO_A2, due_date: "2099-01-01T00:00:00Z" });
    const feita = await criar({ title: "Feita", contact_id: CONTATO_A });
    await concluir({ task_id: (feita.task as Resposta).id, result: "ok" });
  });

  const titulos = (r: Resposta) => (r.tasks as Resposta[]).map((t) => t.title);

  it("⭐ só as tarefas da organização do token — a da outra empresa nunca aparece", async () => {
    const r = await listar({ state: "all" });
    expect(titulos(r)).toEqual(["Vencida", "Futura", "Feita"]);
    expect(titulos(r)).not.toContain("Tarefa da outra empresa");
  });

  it("abertas por padrão; concluídas e todas sob pedido", async () => {
    expect(titulos(await listar({}))).toEqual(["Vencida", "Futura"]);
    expect(titulos(await listar({ state: "completed" }))).toEqual(["Feita"]);
  });

  it("filtra por negócio, por contato e por responsável (um atendente, ou a equipe)", async () => {
    expect(titulos(await listar({ lead_id: NEGOCIO_A2 }))).toEqual(["Futura"]);
    expect(titulos(await listar({ state: "all", contact_id: CONTATO_A }))).toEqual(["Vencida", "Feita"]);
    expect(titulos(await listar({ assigned_to: ANA }))).toEqual(["Vencida"]);
    expect(titulos(await listar({ assigned_to: "equipe" }))).toEqual(["Futura"]);
  });

  it("vencidas: só as abertas com prazo passado, marcadas `overdue`", async () => {
    const r = await listar({ overdue: true });
    expect(titulos(r)).toEqual(["Vencida"]);
    expect((r.tasks as Resposta[])[0]!.overdue).toBe(true);
  });

  it("`since` corta pelo instante da última alteração", async () => {
    const todas = (await listar({ state: "all" })).tasks as Resposta[];
    const corte = todas[2]!.updated_at as string;
    expect(titulos(await listar({ state: "all", since: corte }))).toEqual(["Feita"]);
  });

  it("⭐ paginação: o cursor percorre tudo, sem repetir nem pular", async () => {
    const p1 = await listar({ state: "all", limit: 2 });
    expect(titulos(p1)).toEqual(["Vencida", "Futura"]);
    expect(p1.has_more).toBe(true);

    const p2 = await listar({ state: "all", limit: 2, cursor: p1.cursor });
    expect(titulos(p2)).toEqual(["Feita"]);
    expect(p2.has_more).toBe(false);
    expect(p2.cursor).toBeNull();
  });

  it("cursor que não é desta ferramenta é recusa, não lista vazia", async () => {
    const r = await listar({ cursor: "isto-nao-e-um-cursor" });
    expect(r).toMatchObject({ permitido: false, motivo: "cursor_invalido" });
  });

  it("⭐ no turno de atendimento, só as tarefas do cliente atendido", async () => {
    const turno = ctx({ contatoDoTurno: CONTATO_A });
    expect(titulos(await listar({ state: "all" }, turno))).toEqual(["Vencida", "Feita"]);
    expect(await listar({ lead_id: NEGOCIO_A2 }, turno)).toMatchObject({
      permitido: false,
      motivo: "fora_da_conversa",
    });
    expect(await listar({ contact_id: CONTATO_A2 }, turno)).toMatchObject({
      permitido: false,
      motivo: "fora_da_conversa",
    });
  });
});

describe("contrato das quatro ferramentas", () => {
  it("papel mínimo `agent` (o de um token de API por padrão) e o escopo certo", () => {
    expect(crmListTasks).toMatchObject({ category: "read", requiresRole: "agent", requiresScope: "mcp:read" });
    for (const escrita of [crmCreateTask, crmCompleteTask, crmUpdateTask]) {
      expect(escrita).toMatchObject({ category: "write", requiresRole: "agent", requiresScope: "mcp:write" });
    }
  });

  it("nenhuma aceita organização como argumento", () => {
    for (const t of [crmListTasks, crmCreateTask, crmCompleteTask, crmUpdateTask]) {
      expect(Object.keys(t.inputSchema)).not.toContain("organization_id");
    }
  });
});

// ---------------------------------------------------------------------------
// Revisão de 20/11 — itens 2.13, 2.14, 2.16 e 2.17
// ---------------------------------------------------------------------------

describe("⭐ sem Idempotency-Key: a chave sai do conteúdo do pedido (revisão 20/11, 2.13)", () => {
  const pedido = { title: "Ligar para confirmar", lead_id: NEGOCIO_A, kind: "ligação" };

  it("o mesmo pedido, do mesmo autor, repetido em seguida NÃO cria a segunda tarefa", async () => {
    const primeira = await criar(pedido);
    const segunda = await criar(pedido);

    expect(tarefasDaA()).toHaveLength(1);
    expect((segunda.task as Resposta).id).toBe((primeira.task as Resposta).id);
    expect(segunda.idempotent_replay).toBe(true);
    expect(String(segunda.idempotent_replay_reason)).toContain("Idempotency-Key nova");
    expect(h.audit).toHaveBeenCalledTimes(1);
    expect(atividades().filter((a) => a.type === "task_created")).toHaveLength(1);
  });

  it("pedido DIFERENTE (outro título) é outra tarefa", async () => {
    await criar(pedido);
    await criar({ ...pedido, title: "Ligar de novo amanhã" });
    expect(tarefasDaA()).toHaveLength(2);
  });

  it("OUTRO autor com o mesmo conteúdo não é repetição: cria a dele", async () => {
    const OUTRO_TOKEN = "aaaaaaaa-0000-4000-8000-0000000000f2";
    await criar(pedido);
    const r = await criar(
      pedido,
      ctx({ apiTokenId: OUTRO_TOKEN, actor: { type: "api_token", id: OUTRO_TOKEN, role: "agent" } }),
    );
    expect(r.idempotent_replay).toBeUndefined();
    expect(tarefasDaA()).toHaveLength(2);
  });

  it("o agente nativo é reconhecido pelo AGENTE, não pelo run: o replay do mesmo job não duplica", async () => {
    const AGENTE = "aaaaaaaa-0000-4000-8000-0000000000a9";
    const turno = (run: string) =>
      ctx({ actor: { type: "ai_agent", id: run, role: "agent", agent_id: AGENTE }, contatoDoTurno: CONTATO_A });

    await criar(pedido, turno("run-1"));
    const replay = await criar(pedido, turno("run-2"));

    expect(replay.idempotent_replay).toBe(true);
    expect(tarefasDaA()).toHaveLength(1);
  });

  it("passada a janela, o mesmo pedido é uma tarefa nova — a chave derivada não vale 24 horas", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-23T10:00:00.000Z"));
      await criar(pedido);
      vi.setSystemTime(new Date("2026-11-23T10:11:00.000Z"));
      const r = await criar(pedido);
      expect(r.idempotent_replay).toBeUndefined();
      expect(tarefasDaA()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recusa não vira recibo: corrigido o motivo, o mesmo pedido é atendido", async () => {
    const paraONovato = { title: "Para o novato", assigned_to: LEITOR };
    expect(await criar(paraONovato)).toMatchObject({ permitido: false, motivo: "responsavel_fora_da_equipe" });
    banco.tabelas.user_organizations!.find((u) => u.user_id === LEITOR)!.role = "agent";
    expect((await criar(paraONovato)).task).toMatchObject({ assigned_to: LEITOR });
  });
});

describe("⭐ concluir decide no UPDATE, não na leitura (revisão 20/11, 2.13)", () => {
  async function tarefaAberta() {
    const r = await criar({ title: "A cumprir", lead_id: NEGOCIO_A });
    h.audit.mockClear();
    return (r.task as Resposta).id as string;
  }

  /**
   * Um cliente que deixa a LEITURA do handler ver a tarefa aberta e, antes do
   * UPDATE, aplica o que a chamada concorrente gravou. A leitura é a 1ª consulta
   * a `crm_tasks`; o UPDATE condicionado é a 2ª.
   */
  function comConcorrente(id: string, concorrente: Record<string, unknown>) {
    let consultas = 0;
    const cliente = {
      ...banco.cliente,
      from: (tabela: string) => {
        if (tabela === "crm_tasks" && ++consultas === 2) {
          Object.assign(banco.tabelas.crm_tasks!.find((t) => t.id === id)!, concorrente);
        }
        return banco.cliente.from(tabela);
      },
    };
    return ctx({ supabase: cliente as never });
  }

  it("outra chamada concluiu entre a leitura e a gravação: o resultado dela fica, sem 2ª auditoria nem 2ª linha", async () => {
    const id = await tarefaAberta();

    const r = await concluir(
      { task_id: id, result: "resultado da segunda chamada" },
      comConcorrente(id, { status: "done", result: "resultado da primeira chamada" }),
    );

    expect(r).toMatchObject({ completed: true, already_completed: true });
    expect((r.task as Resposta).result).toBe("resultado da primeira chamada");
    expect(tarefasDaA()[0]!.result).toBe("resultado da primeira chamada");
    expect(h.audit).not.toHaveBeenCalled();
    expect(atividades().filter((a) => a.type === "task_completed")).toHaveLength(0);
  });

  it("um cancelamento chegou entre a leitura e a gravação: a tarefa continua cancelada", async () => {
    const id = await tarefaAberta();

    const r = await concluir({ task_id: id, result: "feito" }, comConcorrente(id, { status: "cancelled" }));

    expect(r).toMatchObject({ permitido: false, motivo: "tarefa_cancelada" });
    expect(tarefasDaA()[0]).toMatchObject({ status: "cancelled" });
    expect(tarefasDaA()[0]!.result ?? null).toBeNull();
    expect(h.audit).not.toHaveBeenCalled();
    expect(atividades().filter((a) => a.type === "task_completed")).toHaveLength(0);
  });
});

describe("⭐ negócio e contato da tarefa têm de ser da mesma pessoa (revisão 20/11, 2.14)", () => {
  it("negócio de um contato com `contact_id` de OUTRO, na mesma organização, é recusado e nada é gravado", async () => {
    const r = await criar({ title: "Cruzada", lead_id: NEGOCIO_A, contact_id: CONTATO_A2 });

    expect(r).toMatchObject({ permitido: false, motivo: "negocio_de_outro_contato" });
    expect(tarefasDaA()).toHaveLength(0);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("o par certo é aceito", async () => {
    const r = await criar({ title: "Par certo", lead_id: NEGOCIO_A, contact_id: CONTATO_A });
    expect(r.task).toMatchObject({ lead_id: NEGOCIO_A, contact_id: CONTATO_A });
    expect(tarefasDaA()).toHaveLength(1);
  });

  it("negócio SEM contato não diverge de nada: aceita o contato informado", async () => {
    banco.tabelas.crm_leads!.find((l) => l.id === NEGOCIO_A)!.contact_id = null;
    const r = await criar({ title: "Negócio sem contato", lead_id: NEGOCIO_A, contact_id: CONTATO_A2 });
    expect(r.task).toMatchObject({ lead_id: NEGOCIO_A, contact_id: CONTATO_A2 });
  });

  it("no turno, o contato do turno em MAIÚSCULAS ainda reconhece o negócio dele", async () => {
    const turno = ctx({ contatoDoTurno: CONTATO_A.toUpperCase() });
    const r = await criar({ title: "No turno", lead_id: NEGOCIO_A }, turno);
    expect(r.task).toMatchObject({ lead_id: NEGOCIO_A });
  });
});

describe("a descrição da tarefa não vai para a auditoria (revisão 20/11, 2.16)", () => {
  it("só o tamanho — como o resultado e a nota", () => {
    const descricao = "Cliente Maria, CPF 123, pediu segunda via.";
    const limpo = crmCreateTask.redigirParaAuditoria!({ title: "Segunda via", description: descricao });
    expect(limpo).toEqual({ title: "Segunda via", description: `[${descricao.length} caracteres]` });
    expect(JSON.stringify(limpo)).not.toContain("Maria");
  });

  it("sem descrição, os argumentos passam como estão", () => {
    expect(crmCreateTask.redigirParaAuditoria!({ title: "x" })).toEqual({ title: "x" });
  });
});

describe("⭐ contato FORA do turno, no handler de verdade (revisão 20/11, 2.17)", () => {
  const TAREFA_DO_A2 = "aaaaaaaa-0000-4000-8000-0000000000e2";
  const TAREFA_DO_NEGOCIO_A2 = "aaaaaaaa-0000-4000-8000-0000000000e3";
  const TAREFA_DO_A = "aaaaaaaa-0000-4000-8000-0000000000e4";
  const INEXISTENTE = "99999999-9999-4999-8999-999999999999";
  const turno = () => ctx({ contatoDoTurno: CONTATO_A });

  const linha = (id: string, extra: Record<string, unknown>) => ({
    id,
    organization_id: ORG_A,
    title: "Tarefa",
    description: null,
    due_date: null,
    priority: "medium",
    status: "pending",
    lead_id: null,
    contact_id: null,
    assigned_to: null,
    created_at: "2026-11-02T10:00:00.000Z",
    updated_at: "2026-11-02T10:00:00.000Z",
    ...extra,
  });

  beforeEach(() => {
    banco.tabelas.crm_tasks!.push(
      linha(TAREFA_DO_A2, { contact_id: CONTATO_A2 }),
      linha(TAREFA_DO_NEGOCIO_A2, { lead_id: NEGOCIO_A2 }),
      linha(TAREFA_DO_A, { contact_id: CONTATO_A }),
    );
  });

  const daA = (id: string) => banco.tabelas.crm_tasks!.find((t) => t.id === id)!;

  it("crm_create_task: `contact_id` de outro cliente da MESMA organização é recusado e nada é gravado", async () => {
    const antes = tarefasDaA().length;
    const r = await criar({ title: "Para o outro", contact_id: CONTATO_A2 }, turno());

    expect(r).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
    expect(tarefasDaA()).toHaveLength(antes);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("crm_complete_task: tarefa de outro cliente (pelo contato ou pelo negócio) e tarefa inexistente recebem a MESMA recusa", async () => {
    const peloContato = await concluir({ task_id: TAREFA_DO_A2, result: "x" }, turno());
    const peloNegocio = await concluir({ task_id: TAREFA_DO_NEGOCIO_A2, result: "x" }, turno());
    const inexistente = await concluir({ task_id: INEXISTENTE, result: "x" }, turno());

    expect(peloContato).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
    expect(peloNegocio).toEqual(peloContato);
    expect(inexistente).toEqual(peloContato);
    expect(daA(TAREFA_DO_A2)).toMatchObject({ status: "pending" });
    expect(daA(TAREFA_DO_NEGOCIO_A2)).toMatchObject({ status: "pending" });
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("crm_update_task: tarefa de outro cliente não muda, e a recusa é a mesma da inexistente", async () => {
    const alheia = await editar({ task_id: TAREFA_DO_A2, assigned_to: ANA }, turno());
    const inexistente = await editar({ task_id: INEXISTENTE, assigned_to: ANA }, turno());

    expect(alheia).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
    expect(inexistente).toEqual(alheia);
    expect(daA(TAREFA_DO_A2).assigned_to).toBeNull();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("a tarefa do próprio cliente do turno segue alcançável", async () => {
    expect(await editar({ task_id: TAREFA_DO_A, assigned_to: ANA }, turno())).toMatchObject({
      task: { assigned_to: ANA },
    });
    expect(await concluir({ task_id: TAREFA_DO_A, result: "feito" }, turno())).toMatchObject({
      completed: true,
      already_completed: false,
    });
  });
});
