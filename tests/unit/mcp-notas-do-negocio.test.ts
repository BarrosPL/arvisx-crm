/**
 * A NOTA DO NEGÓCIO COM AUTORIA — `crm_add_lead_note` e `crm_list_lead_notes`,
 * contra os handlers reais e `lib/leads/notas-do-negocio.ts`.
 *
 * O banco é o de `tests/helpers/banco-em-memoria.ts`: duas organizações nas
 * mesmas tabelas, filtros aplicados de verdade.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type BancoEmMemoria } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({ audit: vi.fn(async (..._args: unknown[]) => undefined) }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));

const { crmAddLeadNote, crmListLeadNotes } = await import("@/lib/mcp/tools/notas-do-negocio");
import type { McpContext } from "@/lib/mcp/types";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const TOKEN_VENDAS = "aaaaaaaa-0000-4000-8000-0000000000f1";
const TOKEN_COBRANCA = "aaaaaaaa-0000-4000-8000-0000000000f2";
const TOKEN_B = "bbbbbbbb-0000-4000-8000-0000000000f1";
const AGENTE_NATIVO = "aaaaaaaa-0000-4000-8000-0000000000a9";
const CONTATO_A = "aaaaaaaa-0000-4000-8000-0000000000c1";
const CONTATO_PESSOAL = "aaaaaaaa-0000-4000-8000-0000000000c3";
const CONTATO_B = "bbbbbbbb-0000-4000-8000-0000000000c1";
const NEGOCIO_A = "aaaaaaaa-0000-4000-8000-0000000000d1";
/** Outro negócio do MESMO contato: a nota de um não entra no outro. */
const NEGOCIO_A_IRMAO = "aaaaaaaa-0000-4000-8000-0000000000d2";
const NEGOCIO_PESSOAL = "aaaaaaaa-0000-4000-8000-0000000000d3";
const NEGOCIO_B = "bbbbbbbb-0000-4000-8000-0000000000d1";
const FUNIL = "aaaaaaaa-0000-4000-8000-000000000011";

let banco: BancoEmMemoria;

function ctx(token = TOKEN_VENDAS, extra: Partial<McpContext> = {}): McpContext {
  return {
    organizationId: ORG_A,
    role: "agent",
    actor: { type: "api_token", id: token, role: "agent" },
    apiTokenId: token,
    requestId: "req-1",
    supabase: banco.cliente as never,
    ...extra,
  };
}

beforeEach(() => {
  h.audit.mockClear();
  banco = bancoEmMemoria({
    api_tokens: [
      { id: TOKEN_VENDAS, organization_id: ORG_A, name: "Agente de vendas" },
      { id: TOKEN_COBRANCA, organization_id: ORG_A, name: "Agente de cobrança" },
      { id: TOKEN_B, organization_id: ORG_B, name: "Agente da outra empresa" },
    ],
    ai_agents: [{ id: AGENTE_NATIVO, organization_id: ORG_A, name: "Recuperador de vendas" }],
    contacts: [
      { id: CONTATO_A, organization_id: ORG_A, is_personal: false },
      { id: CONTATO_PESSOAL, organization_id: ORG_A, is_personal: true },
      { id: CONTATO_B, organization_id: ORG_B, is_personal: false },
    ],
    crm_leads: [
      { id: NEGOCIO_A, organization_id: ORG_A, contact_id: CONTATO_A, pipeline_id: FUNIL, title: "A" },
      { id: NEGOCIO_A_IRMAO, organization_id: ORG_A, contact_id: CONTATO_A, pipeline_id: FUNIL, title: "A2" },
      { id: NEGOCIO_PESSOAL, organization_id: ORG_A, contact_id: CONTATO_PESSOAL, pipeline_id: FUNIL, title: "P" },
      { id: NEGOCIO_B, organization_id: ORG_B, contact_id: CONTATO_B, pipeline_id: FUNIL, title: "B" },
    ],
    crm_lead_activities: [
      {
        id: "bbbbbbbb-0000-4000-8000-0000000000e1",
        organization_id: ORG_B,
        lead_id: NEGOCIO_B,
        type: "note",
        source_module: "notas",
        actor_kind: "system",
        reason: "Agente da outra empresa: segredo da empresa B",
        payload: { texto: "segredo da empresa B", autor: { tipo: "token", id: TOKEN_B, nome: "Agente da outra empresa" } },
        performed_at: "2026-11-01T10:00:00.000Z",
      },
    ],
    lead_notes: [
      {
        id: "aaaaaaaa-0000-4000-8000-0000000000n1",
        organization_id: ORG_A,
        contact_id: CONTATO_A,
        headline: "Prefere contato à tarde",
        body: "Disse duas vezes que só atende depois das 14h.",
        created_at: "2026-11-02T10:00:00.000Z",
      },
      {
        id: "bbbbbbbb-0000-4000-8000-0000000000n1",
        organization_id: ORG_B,
        contact_id: CONTATO_B,
        headline: "ficha da outra empresa",
        body: "não pode aparecer",
        created_at: "2026-11-02T10:00:00.000Z",
      },
    ],
  });
});

type Resposta = Record<string, unknown>;
type Nota = { id: string; text: string; author: { kind: string; id: string; name: string }; recipient: string | null; created_at: string };

const anotar = (args: Record<string, unknown>, c = ctx()) =>
  crmAddLeadNote.handler(args as never, c) as Promise<Resposta>;
const ler = (args: Record<string, unknown>, c = ctx()) =>
  crmListLeadNotes.handler(
    { limit: 50, include_agent_memory: false, ...args } as never,
    c,
  ) as Promise<Resposta>;
const notas = (r: Resposta) => r.notes as Nota[];
const linhasDaA = () => banco.tabelas.crm_lead_activities!.filter((l) => l.organization_id === ORG_A);

describe("crm_add_lead_note", () => {
  it("⭐ texto longo entra e volta INTEIRO, sem corte", async () => {
    const longo = "Linha de contexto do atendimento. ".repeat(500); // 17 mil caracteres
    const texto = longo.trim();

    const r = await anotar({ lead_id: NEGOCIO_A, text: texto });

    expect((r.note as Nota).text).toBe(texto);
    expect((r.note as Nota).text.length).toBeGreaterThan(16_000);
    expect(notas(await ler({ lead_id: NEGOCIO_A }))[0]!.text).toBe(texto);
    // e na linha do tempo, o que a pessoa lê também não é cortado
    expect(String(linhasDaA()[0]!.reason).endsWith(texto)).toBe(true);
  });

  it("⭐ o autor é o do CADASTRO do token, e o nome aparece na linha do tempo", async () => {
    const r = await anotar({ lead_id: NEGOCIO_A, text: "Cliente pediu o boleto" });

    expect((r.note as Nota).author).toEqual({ kind: "token", id: TOKEN_VENDAS, name: "Agente de vendas" });
    expect(linhasDaA()[0]).toMatchObject({
      organization_id: ORG_A,
      lead_id: NEGOCIO_A,
      contact_id: CONTATO_A,
      type: "note",
      reason: "Agente de vendas: Cliente pediu o boleto",
    });
  });

  it("agente NATIVO assina com o nome do agente, e a linha guarda o agente", async () => {
    const nativo = ctx(TOKEN_VENDAS, {
      actor: { type: "ai_agent", id: "run-1", role: "ai_operator", agent_id: AGENTE_NATIVO },
    });

    const r = await anotar({ lead_id: NEGOCIO_A, text: "Retomei o contato" }, nativo);

    expect((r.note as Nota).author).toEqual({ kind: "agente", id: AGENTE_NATIVO, name: "Recuperador de vendas" });
    expect(linhasDaA()[0]).toMatchObject({
      actor_agent_id: AGENTE_NATIVO,
      reason: "Recuperador de vendas: Retomei o contato",
    });
  });

  it("o destinatário é gravado como marcador e aparece na linha", async () => {
    const r = await anotar({ lead_id: NEGOCIO_A, text: "Emitir a segunda via", recipient: "Financeiro" });

    expect((r.note as Nota).recipient).toBe("Financeiro");
    expect(linhasDaA()[0]!.reason).toBe("Agente de vendas → Financeiro: Emitir a segunda via");
  });

  it("⭐ audita com o agente como ator — e SEM o texto da nota", async () => {
    await anotar({ lead_id: NEGOCIO_A, text: "dado sensível do cliente", recipient: "financeiro" });

    expect(h.audit).toHaveBeenCalledTimes(1);
    const linha = h.audit.mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(linha).toMatchObject({
      action: "lead.note_added",
      organizationId: ORG_A,
      actorUserId: null,
      actorApiTokenId: TOKEN_VENDAS,
      resourceType: "crm_leads",
      resourceId: NEGOCIO_A,
    });
    expect(linha.metadata).toMatchObject({ via: "mcp", actor_type: "api_token", text_length: 24, has_recipient: true });
    expect(JSON.stringify(linha)).not.toContain("dado sensível");
    expect(crmAddLeadNote.redigirParaAuditoria!({ lead_id: "x", text: "dado sensível" })).toEqual({
      lead_id: "x",
      text: "[13 caracteres]",
    });
  });

  it("⭐ negócio de OUTRA organização: recusa, nada gravado, nada auditado", async () => {
    const r = await anotar({ lead_id: NEGOCIO_B, text: "vazaria" });

    expect(r).toMatchObject({ permitido: false, motivo: "negocio_nao_encontrado" });
    expect(linhasDaA()).toHaveLength(0);
    expect(banco.tabelas.crm_lead_activities).toHaveLength(1); // só a que já era da B
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("negócio de contato pessoal fica fora da operação", async () => {
    const r = await anotar({ lead_id: NEGOCIO_PESSOAL, text: "x" });
    expect(r).toMatchObject({ permitido: false, motivo: "contato_pessoal" });
    expect(linhasDaA()).toHaveLength(0);
  });

  it("⭐ a mesma Idempotency-Key não grava a nota duas vezes", async () => {
    const comChave = ctx(TOKEN_VENDAS, { idempotencyKey: "11111111-1111-4111-8111-111111111111" });

    const primeira = await anotar({ lead_id: NEGOCIO_A, text: "Uma vez só" }, comChave);
    const segunda = await anotar({ lead_id: NEGOCIO_A, text: "Uma vez só" }, comChave);

    expect(linhasDaA()).toHaveLength(1);
    expect((segunda.note as Nota).id).toBe((primeira.note as Nota).id);
    expect(segunda.idempotent_replay).toBe(true);
    expect(h.audit).toHaveBeenCalledTimes(1);
  });

  it("no turno de atendimento, negócio de outro cliente e inexistente recebem a MESMA recusa", async () => {
    const turno = ctx(TOKEN_VENDAS, { contatoDoTurno: CONTATO_PESSOAL });
    const alheio = await anotar({ lead_id: NEGOCIO_A, text: "x" }, turno);
    const inexistente = await anotar({ lead_id: "99999999-9999-4999-8999-999999999999", text: "x" }, turno);

    expect(alheio).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
    expect(inexistente).toEqual(alheio);
  });
});

describe("crm_list_lead_notes", () => {
  beforeEach(async () => {
    await anotar({ lead_id: NEGOCIO_A, text: "primeira, do agente de vendas" });
    await anotar({ lead_id: NEGOCIO_A, text: "segunda, do agente de cobrança para o financeiro", recipient: "financeiro" }, ctx(TOKEN_COBRANCA));
    await anotar({ lead_id: NEGOCIO_A, text: "terceira, do agente de vendas para o Financeiro", recipient: " Financeiro " });
    await anotar({ lead_id: NEGOCIO_A_IRMAO, text: "nota do negócio irmão" });
  });

  const textos = (r: Resposta) => notas(r).map((n) => n.text);

  it("⭐ ordem cronológica, com autor, data e texto", async () => {
    const r = await ler({ lead_id: NEGOCIO_A });

    expect(textos(r)).toEqual([
      "primeira, do agente de vendas",
      "segunda, do agente de cobrança para o financeiro",
      "terceira, do agente de vendas para o Financeiro",
    ]);
    const datas = notas(r).map((n) => n.created_at);
    expect([...datas].sort()).toEqual(datas);
    expect(notas(r)[1]).toMatchObject({ author: { kind: "token", id: TOKEN_COBRANCA, name: "Agente de cobrança" } });
  });

  it("⭐ só as notas DESTE negócio: nem as do negócio irmão, nem as de outra organização", async () => {
    const todas = textos(await ler({ lead_id: NEGOCIO_A }));
    expect(todas).not.toContain("nota do negócio irmão");
    expect(todas).not.toContain("segredo da empresa B");
  });

  it("⭐ negócio de OUTRA organização: recusa, e o texto de lá não sai", async () => {
    const r = await ler({ lead_id: NEGOCIO_B });
    expect(r).toMatchObject({ permitido: false, motivo: "negocio_nao_encontrado" });
    expect(JSON.stringify(r)).not.toContain("segredo");
  });

  it("filtra por autor, pelo id ou pelo nome", async () => {
    expect(textos(await ler({ lead_id: NEGOCIO_A, author: TOKEN_COBRANCA }))).toEqual([
      "segunda, do agente de cobrança para o financeiro",
    ]);
    expect(textos(await ler({ lead_id: NEGOCIO_A, author: "Agente de vendas" }))).toHaveLength(2);
  });

  it("filtra por destinatário sem depender de caixa nem de espaço nas pontas", async () => {
    expect(textos(await ler({ lead_id: NEGOCIO_A, recipient: "FINANCEIRO" }))).toEqual([
      "segunda, do agente de cobrança para o financeiro",
      "terceira, do agente de vendas para o Financeiro",
    ]);
    expect(textos(await ler({ lead_id: NEGOCIO_A, recipient: "jurídico" }))).toEqual([]);
  });

  it("`since` devolve só o que veio depois", async () => {
    const todas = notas(await ler({ lead_id: NEGOCIO_A }));
    const r = await ler({ lead_id: NEGOCIO_A, since: todas[1]!.created_at });
    expect(textos(r)).toEqual(textos({ notes: todas.slice(1) }));
  });

  it("⭐ paginação: o cursor percorre tudo, sem repetir nem pular", async () => {
    const p1 = await ler({ lead_id: NEGOCIO_A, limit: 2 });
    expect(textos(p1)).toHaveLength(2);
    expect(p1.has_more).toBe(true);

    const p2 = await ler({ lead_id: NEGOCIO_A, limit: 2, cursor: p1.cursor });
    expect(textos(p2)).toEqual(["terceira, do agente de vendas para o Financeiro"]);
    expect(p2.has_more).toBe(false);
    expect(p2.cursor).toBeNull();
  });

  it("cursor inválido é recusa, não lista vazia", async () => {
    expect(await ler({ lead_id: NEGOCIO_A, cursor: "%%%" })).toMatchObject({
      permitido: false,
      motivo: "cursor_invalido",
    });
  });

  it("⭐ a ficha do agente nativo vem À PARTE, só quando pedida, e só a do contato deste negócio", async () => {
    const semFicha = await ler({ lead_id: NEGOCIO_A });
    expect(semFicha).not.toHaveProperty("agent_memory");

    const comFicha = await ler({ lead_id: NEGOCIO_A, include_agent_memory: true });
    expect(comFicha.agent_memory).toEqual([
      expect.objectContaining({
        headline: "Prefere contato à tarde",
        body: "Disse duas vezes que só atende depois das 14h.",
      }),
    ]);
    expect(JSON.stringify(comFicha)).not.toContain("ficha da outra empresa");
    // as duas não se misturam: a ficha não vira nota, a nota não vira ficha
    expect(textos(comFicha)).toHaveLength(3);
  });

  it("a leitura não escreve nada", async () => {
    const antes = banco.tabelas.crm_lead_activities!.length;
    await ler({ lead_id: NEGOCIO_A, include_agent_memory: true });
    expect(banco.tabelas.crm_lead_activities).toHaveLength(antes);
    expect(banco.tabelas.lead_notes).toHaveLength(2);
  });
});

describe("contrato das duas ferramentas", () => {
  it("papel mínimo `agent` e o escopo certo; nenhuma aceita organização nem autor como argumento", () => {
    expect(crmListLeadNotes).toMatchObject({ category: "read", requiresRole: "agent", requiresScope: "mcp:read" });
    expect(crmAddLeadNote).toMatchObject({ category: "write", requiresRole: "agent", requiresScope: "mcp:write" });
    expect(Object.keys(crmAddLeadNote.inputSchema).sort()).toEqual(["lead_id", "recipient", "text"]);
    expect(Object.keys(crmListLeadNotes.inputSchema)).not.toContain("organization_id");
  });
});

// ---------------------------------------------------------------------------
// Revisão de 20/11 — item 2.13
// ---------------------------------------------------------------------------

describe("⭐ a nota não entra em dobro (revisão 20/11, 2.13)", () => {
  it("sem Idempotency-Key, a mesma nota do mesmo autor no mesmo negócio, repetida em seguida, é gravada UMA vez", async () => {
    const primeira = await anotar({ lead_id: NEGOCIO_A, text: "Cliente pediu retorno às 15h" });
    const segunda = await anotar({ lead_id: NEGOCIO_A, text: "Cliente pediu retorno às 15h" });

    expect(linhasDaA()).toHaveLength(1);
    expect((segunda.note as Nota).id).toBe((primeira.note as Nota).id);
    expect(segunda.idempotent_replay).toBe(true);
    expect(String(segunda.idempotent_replay_reason)).toContain("Idempotency-Key nova");
    expect(h.audit).toHaveBeenCalledTimes(1);
  });

  it("texto diferente, outro negócio, outro destinatário ou outro autor são notas novas", async () => {
    await anotar({ lead_id: NEGOCIO_A, text: "Recado" });
    await anotar({ lead_id: NEGOCIO_A, text: "Recado, segunda parte" });
    await anotar({ lead_id: NEGOCIO_A_IRMAO, text: "Recado" });
    await anotar({ lead_id: NEGOCIO_A, text: "Recado", recipient: "financeiro" });
    await anotar({ lead_id: NEGOCIO_A, text: "Recado" }, ctx(TOKEN_COBRANCA));

    expect(linhasDaA()).toHaveLength(5);
  });

  it("a mesma Idempotency-Key com OUTRO texto é recusada — antes devolvia a nota antiga e perdia o texto novo", async () => {
    const comChave = ctx(TOKEN_VENDAS, { idempotencyKey: "22222222-2222-4222-8222-222222222222" });
    await anotar({ lead_id: NEGOCIO_A, text: "Primeiro texto" }, comChave);
    const r = await anotar({ lead_id: NEGOCIO_A, text: "Texto diferente" }, comChave);

    expect(r).toMatchObject({ permitido: false, motivo: "chave_de_idempotencia_em_conflito" });
    expect(linhasDaA()).toHaveLength(1);
  });

  it("corrida que o índice único decide: quem recebe 23505 devolve a nota da outra chamada, sem erro", async () => {
    const { registrarNotaDoNegocio } = await import("@/lib/leads/notas-do-negocio");
    const CHAVE = "33333333-3333-4333-8333-333333333333";
    const vencedora = {
      id: "aaaaaaaa-0000-4000-8000-0000000000e9",
      lead_id: NEGOCIO_A,
      actor_kind: "ai_agent",
      reason: "Agente de vendas: Uma vez só",
      payload: {
        texto: "Uma vez só",
        autor: { tipo: "token", id: TOKEN_VENDAS, nome: "Agente de vendas" },
        idempotency_key: CHAVE,
      },
      performed_at: "2026-11-23T10:00:00.000Z",
    };

    // A leitura ANTES da gravação não vê nada (a outra chamada ainda não
    // gravou); o INSERT bate no índice único; a leitura DEPOIS acha a vencedora.
    let leituras = 0;
    const insercoes: unknown[] = [];
    const leitura = () => {
      const cadeia: Record<string, unknown> = {};
      for (const m of ["select", "eq", "contains", "limit"]) cadeia[m] = () => cadeia;
      cadeia.maybeSingle = () => Promise.resolve({ data: ++leituras === 1 ? null : vencedora, error: null });
      return cadeia;
    };
    const supabase = {
      from: () => ({
        ...leitura(),
        insert: (linha: unknown) => {
          insercoes.push(linha);
          return {
            select: () => ({
              single: () =>
                Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key value" } }),
            }),
          };
        },
      }),
    };

    const desfecho = await registrarNotaDoNegocio({
      supabase: supabase as never,
      organizationId: ORG_A,
      lead: { id: NEGOCIO_A, contact_id: CONTATO_A },
      texto: "Uma vez só",
      autor: { tipo: "token", id: TOKEN_VENDAS, nome: "Agente de vendas" },
      ator: { type: "api_token", id: TOKEN_VENDAS, role: "agent" },
      chaveDeIdempotencia: CHAVE,
    });

    expect(insercoes).toHaveLength(1);
    expect(desfecho).toMatchObject({ ok: true, repetida: true, nota: { id: vencedora.id, text: "Uma vez só" } });
  });
});
