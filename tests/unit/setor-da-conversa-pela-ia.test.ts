import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAction } from "@/lib/automation/actions";
import "@/lib/automation/actions/define-sector";
import type { ActionCtx } from "@/lib/automation/types";
import { audit } from "@/lib/audit";
import {
  CHAVE_DA_ORIGEM_DO_SETOR,
  definirSetorDaConversa,
  origemGravada,
  podeSobrescreverSetorManual,
} from "@/lib/atendimento/setor-da-conversa";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { allTools } from "@/lib/mcp/tools";
import { TOOL_CATALOG } from "@/lib/mcp/tools/catalogo";
import { crmSetConversationSector } from "@/lib/mcp/tools/governance";
import type { McpContext } from "@/lib/mcp/types";
import {
  ENTIDADE_ESPERADA_POR_GATILHO,
  GATILHOS_DO_TRIGGER_DE_CONVERSA,
  acoesQueFechamLaco,
  actionSchema,
  createAutomationRuleSchema,
} from "@/lib/schemas/webhooks";

/**
 * #3881 — o SETOR da conversa escolhido pela IA e pela automação.
 *
 * O que este arquivo prova, um por um dos lados opostos do pedido:
 *
 *   1. a ferramenta da IA e a ação de automação GRAVAM `conversations.sector_id`
 *      (a recusa de hoje está no RED medido contra `origin/main`, no corpo do PR);
 *   2. setor inexistente é RECUSADO, e nada é gravado (nem `null`);
 *   3. setor de outra ORGANIZAÇÃO é recusado — provado pelo filtro que a régua
 *      manda para o banco, não pela FK (que só falharia como 500 opaco);
 *   4. setor definido à MÃO não é sobrescrito sem opção explícita;
 *   5. a automação não entra em laço: mudar setor não é gatilho de automação e a
 *      ação não grava evento nenhum;
 *   6. conversa ENCERRADA recusa;
 *   7. a auditoria diz quem, de qual setor para qual.
 *
 * O cliente falso HONRA os filtros `eq` (é isso que torna o caso da outra
 * organização uma prova de verdade: se a régua parar de filtrar por
 * `organization_id`, o teste acha a linha e passa a gravar).
 */

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: vi.fn(async () => true) }));

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUTRA_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONVERSA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SETOR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SETOR_ANTIGO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

type Linha = Record<string, unknown>;

interface Fake {
  client: Record<string, unknown>;
  updates: Array<{ table: string; patch: Linha }>;
  rpcs: Array<{ fn: string; args: Linha }>;
  tabelasTocadas: string[];
}

/** Cliente Supabase mínimo: cadeia `from().select/update().eq().select().maybeSingle()`. */
function clienteFake(
  tabelas: Record<string, Linha[]>,
  opcoes: { erroNoUpdate?: string; updateSemLinha?: boolean } = {},
): Fake {
  const updates: Fake["updates"] = [];
  const rpcs: Fake["rpcs"] = [];
  const tabelasTocadas: string[] = [];

  function consulta(table: string) {
    if (table === "event_log") {
      // A ação NÃO pode emitir evento: é isso que garante que mudar setor não
      // redispara a regra que muda setor.
      throw new Error("a ação de setor não pode tocar event_log");
    }
    const filtros: Array<[string, unknown]> = [];
    let patch: Linha | null = null;
    const api = {
      select: () => api,
      update: (p: Linha) => {
        patch = p;
        return api;
      },
      eq: (coluna: string, valor: unknown) => {
        filtros.push([coluna, valor]);
        return api;
      },
      not: () => api,
      order: () => api,
      limit: () => api,
      maybeSingle: async () => {
        const linhas = (tabelas[table] ?? []).filter((linha) =>
          filtros.every(([coluna, valor]) => linha[coluna] === valor),
        );
        if (!linhas.length) return { data: null, error: null };
        if (!patch) return { data: linhas[0], error: null };
        updates.push({ table, patch });
        if (opcoes.erroNoUpdate) return { data: null, error: { message: opcoes.erroNoUpdate } };
        if (opcoes.updateSemLinha) return { data: null, error: null };
        return { data: { ...linhas[0], ...patch }, error: null };
      },
    };
    return api;
  }

  const client = {
    from: (table: string) => {
      tabelasTocadas.push(table);
      return consulta(table);
    },
    rpc: async (fn: string, args: Linha) => {
      rpcs.push({ fn, args });
      return { data: null, error: null };
    },
  };

  return { client, updates, rpcs, tabelasTocadas };
}

function conversa(extra: Linha = {}): Linha {
  return {
    id: CONVERSA,
    organization_id: ORG,
    status: "open",
    assigned_to_user_id: null,
    sector_id: null,
    metadata: {},
    ...extra,
  };
}

function setores(): Linha[] {
  return [
    { id: SETOR, organization_id: ORG, name: "Internacional" },
    { id: SETOR_ANTIGO, organization_id: ORG, name: "Recepção" },
    // Mesmo id pedido, mas de OUTRA organização: quem recusa é o filtro por
    // organização da régua, não a FK.
    { id: SETOR, organization_id: OUTRA_ORG, name: "Setor alheio" },
  ];
}

const atorDaIA = { tipo: "ai_agent" as const, id: "run-1", userId: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(moduloLigado).mockResolvedValue(true);
});

describe("a régua do setor: o que ela grava e o que ela recusa", () => {
  it("grava o setor, marca a origem e audita de qual para qual", async () => {
    const fake = clienteFake({
      conversations: [conversa({ sector_id: SETOR_ANTIGO, metadata: { setor_origem: "ia" } })],
      attendant_sectors: setores(),
    });

    const r = await definirSetorDaConversa({
      db: fake.client as never,
      organizationId: ORG,
      conversationId: CONVERSA,
      sectorId: SETOR,
      origem: "ia",
      ator: atorDaIA,
      requestId: "req-1",
    });

    expect(r).toMatchObject({ ok: true, de: SETOR_ANTIGO, para: SETOR, mudou: true });
    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0]).toMatchObject({
      table: "conversations",
      patch: { sector_id: SETOR, metadata: { [CHAVE_DA_ORIGEM_DO_SETOR]: "ia" } },
    });
    // Conversa sem dono e aberta: o vínculo novo pede distribuição, pela MESMA
    // RPC do trigger de atribuição.
    expect(fake.rpcs).toEqual([
      { fn: "fn_request_channel_routing", args: { p_org: ORG, p_conversation: CONVERSA } },
    ]);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "conversation.sector_changed",
        organizationId: ORG,
        resourceId: CONVERSA,
        metadata: expect.objectContaining({
          de: SETOR_ANTIGO,
          para: SETOR,
          origem: "ia",
          actor_type: "ai_agent",
          actor_id: "run-1",
        }),
      }),
    );
  });

  it("conversa COM dono não é redistribuída: mudar de setor não é transferência", async () => {
    const fake = clienteFake({
      conversations: [conversa({ assigned_to_user_id: "user-1", status: "claimed" })],
      attendant_sectors: setores(),
    });
    const r = await definirSetorDaConversa({
      db: fake.client as never,
      organizationId: ORG,
      conversationId: CONVERSA,
      sectorId: SETOR,
      origem: "automacao",
      ator: { tipo: "automacao", id: "rule-1" },
    });
    expect(r).toMatchObject({ ok: true, redistribuiu: false });
    expect(fake.rpcs).toEqual([]);
  });

  it("setor INEXISTENTE é recusado e nada é gravado (nem nulo)", async () => {
    const fake = clienteFake({ conversations: [conversa()], attendant_sectors: setores() });
    const r = await definirSetorDaConversa({
      db: fake.client as never,
      organizationId: ORG,
      conversationId: CONVERSA,
      sectorId: "99999999-9999-4999-8999-999999999999",
      origem: "ia",
      ator: atorDaIA,
    });
    expect(r).toMatchObject({ ok: false, motivo: "setor_inexistente" });
    expect(fake.updates).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("setor de OUTRA organização é recusado — pelo filtro da régua, não pela FK", async () => {
    // O setor existe (com esse id) na outra organização; para esta, não existe.
    const fake = clienteFake({ conversations: [conversa()], attendant_sectors: setores() });
    const r = await definirSetorDaConversa({
      db: fake.client as never,
      organizationId: ORG,
      conversationId: CONVERSA,
      sectorId: SETOR,
      origem: "ia",
      ator: atorDaIA,
    });
    expect(r).toMatchObject({ ok: true, para: SETOR });

    // E a conversa da OUTRA organização não é alcançável: a leitura filtra por
    // `organization_id`, então a régua nem a encontra.
    const alheio = clienteFake({
      conversations: [conversa({ organization_id: OUTRA_ORG })],
      attendant_sectors: setores(),
    });
    const negado = await definirSetorDaConversa({
      db: alheio.client as never,
      organizationId: ORG,
      conversationId: CONVERSA,
      sectorId: SETOR,
      origem: "ia",
      ator: atorDaIA,
    });
    expect(negado).toMatchObject({ ok: false, motivo: "conversa_nao_encontrada" });
    expect(alheio.updates).toEqual([]);
  });

  it("conversa ENCERRADA recusa", async () => {
    for (const status of ["closed", "archived"]) {
      const fake = clienteFake({
        conversations: [conversa({ status })],
        attendant_sectors: setores(),
      });
      const r = await definirSetorDaConversa({
        db: fake.client as never,
        organizationId: ORG,
        conversationId: CONVERSA,
        sectorId: SETOR,
        origem: "ia",
        ator: atorDaIA,
      });
      expect(r).toMatchObject({ ok: false, motivo: "conversa_encerrada" });
      expect(fake.updates).toEqual([]);
    }
  });

  it("setor escolhido por uma PESSOA não é sobrescrito pela IA sem opção explícita", async () => {
    const fake = clienteFake({
      conversations: [
        conversa({ sector_id: SETOR_ANTIGO, metadata: { [CHAVE_DA_ORIGEM_DO_SETOR]: "manual" } }),
      ],
      attendant_sectors: setores(),
    });
    const r = await definirSetorDaConversa({
      db: fake.client as never,
      organizationId: ORG,
      conversationId: CONVERSA,
      sectorId: SETOR,
      origem: "ia",
      ator: atorDaIA,
    });
    expect(r).toMatchObject({ ok: false, motivo: "setor_manual_preservado" });
    expect(fake.updates).toEqual([]);
  });

  it("com a opção explícita, a IA sobrescreve o setor manual e a marca vira `ia`", async () => {
    const fake = clienteFake({
      conversations: [
        conversa({ sector_id: SETOR_ANTIGO, metadata: { [CHAVE_DA_ORIGEM_DO_SETOR]: "manual" } }),
      ],
      attendant_sectors: setores(),
    });
    const r = await definirSetorDaConversa({
      db: fake.client as never,
      organizationId: ORG,
      conversationId: CONVERSA,
      sectorId: SETOR,
      origem: "ia",
      sobrescreverSetorManual: true,
      ator: atorDaIA,
    });
    expect(r).toMatchObject({ ok: true, de: SETOR_ANTIGO, para: SETOR });
    expect(fake.updates[0]?.patch).toMatchObject({
      metadata: { [CHAVE_DA_ORIGEM_DO_SETOR]: "ia" },
    });
  });

  it("setor SEM marca (gravado antes desta fatia) conta como manual", async () => {
    // A conversa já tinha setor e não tem a marca: a origem é DESCONHECIDA, e o
    // desconhecido conta como escolha de pessoa — errar por preservar custa uma
    // classificação; errar por sobrescrever apaga a escolha de alguém, calado.
    const fake = clienteFake({
      conversations: [conversa({ sector_id: SETOR_ANTIGO })],
      attendant_sectors: setores(),
    });
    const r = await definirSetorDaConversa({
      db: fake.client as never,
      organizationId: ORG,
      conversationId: CONVERSA,
      sectorId: SETOR,
      origem: "automacao",
      ator: { tipo: "automacao", id: "rule-1" },
    });
    expect(r).toMatchObject({ ok: false, motivo: "setor_manual_preservado" });
  });

  it("a IA reclassifica o que ELA MESMA gravou (a triagem erra e volta atrás)", async () => {
    const fake = clienteFake({
      conversations: [
        conversa({ sector_id: SETOR_ANTIGO, metadata: { [CHAVE_DA_ORIGEM_DO_SETOR]: "ia" } }),
      ],
      attendant_sectors: setores(),
    });
    const r = await definirSetorDaConversa({
      db: fake.client as never,
      organizationId: ORG,
      conversationId: CONVERSA,
      sectorId: SETOR,
      origem: "ia",
      ator: atorDaIA,
    });
    expect(r).toMatchObject({ ok: true, mudou: true });
  });

  it("é idempotente: repetir o mesmo setor não grava nem audita de novo", async () => {
    const fake = clienteFake({
      conversations: [conversa({ sector_id: SETOR, metadata: { [CHAVE_DA_ORIGEM_DO_SETOR]: "ia" } })],
      attendant_sectors: setores(),
    });
    const r = await definirSetorDaConversa({
      db: fake.client as never,
      organizationId: ORG,
      conversationId: CONVERSA,
      sectorId: SETOR,
      origem: "ia",
      ator: atorDaIA,
    });
    expect(r).toMatchObject({ ok: true, mudou: false });
    expect(fake.updates).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("a IA não LIMPA o setor: nulo pela IA é recusado, não gravado", async () => {
    const fake = clienteFake({
      conversations: [conversa({ sector_id: SETOR_ANTIGO })],
      attendant_sectors: setores(),
    });
    const r = await definirSetorDaConversa({
      db: fake.client as never,
      organizationId: ORG,
      conversationId: CONVERSA,
      sectorId: null,
      origem: "ia",
      ator: atorDaIA,
    });
    expect(r).toMatchObject({ ok: false, motivo: "limpeza_nao_permitida" });
    expect(fake.updates).toEqual([]);
  });

  it("módulo `setores` desligado recusa antes de tocar na conversa", async () => {
    vi.mocked(moduloLigado).mockResolvedValue(false);
    const fake = clienteFake({ conversations: [conversa()], attendant_sectors: setores() });
    const r = await definirSetorDaConversa({
      db: fake.client as never,
      organizationId: ORG,
      conversationId: CONVERSA,
      sectorId: SETOR,
      origem: "ia",
      ator: atorDaIA,
    });
    expect(r).toMatchObject({ ok: false, motivo: "setores_desligados" });
    expect(fake.tabelasTocadas).toEqual([]);
  });

  it("a rota humana (origem manual) audita mesmo quando o setor não mudou", async () => {
    const fake = clienteFake({
      conversations: [conversa({ sector_id: SETOR })],
      attendant_sectors: setores(),
    });
    const r = await definirSetorDaConversa({
      db: fake.client as never,
      organizationId: ORG,
      conversationId: CONVERSA,
      sectorId: SETOR,
      origem: "manual",
      ator: { tipo: "user", userId: "user-1" },
    });
    expect(r).toMatchObject({ ok: true, mudou: false });
    expect(audit).toHaveBeenCalledTimes(1);
  });
});

describe("a precedência, como função pura", () => {
  it("origem gravada: marca manda; setor sem marca conta como manual; sem setor é livre", () => {
    expect(origemGravada({ sector_id: SETOR, metadata: { [CHAVE_DA_ORIGEM_DO_SETOR]: "ia" } })).toBe("ia");
    expect(origemGravada({ sector_id: SETOR, metadata: {} })).toBe("manual");
    expect(origemGravada({ sector_id: null, metadata: {} })).toBeNull();
    // Marca desconhecida não vira passe livre.
    expect(origemGravada({ sector_id: SETOR, metadata: { [CHAVE_DA_ORIGEM_DO_SETOR]: "outro" } })).toBe(
      "manual",
    );
  });

  it("gente sempre sobrescreve; a IA só com a opção ligada ou sobre o que ela mesma gravou", () => {
    const manual = { sector_id: SETOR_ANTIGO, metadata: { [CHAVE_DA_ORIGEM_DO_SETOR]: "manual" } };
    expect(podeSobrescreverSetorManual(manual, "manual", false)).toBe(true);
    expect(podeSobrescreverSetorManual(manual, "ia", false)).toBe(false);
    expect(podeSobrescreverSetorManual(manual, "ia", true)).toBe(true);
    expect(
      podeSobrescreverSetorManual({ sector_id: SETOR_ANTIGO, metadata: { [CHAVE_DA_ORIGEM_DO_SETOR]: "ia" } }, "automacao", false),
    ).toBe(true);
    expect(podeSobrescreverSetorManual({ sector_id: null, metadata: {} }, "ia", false)).toBe(true);
  });
});

describe("GREEN na borda: o caminho existe e está registrado", () => {
  it("a ferramenta da IA aparece na lista de ferramentas do servidor", () => {
    // Espelho do RED medido contra `origin/main`: lá o nome não está na lista.
    expect(allTools.map((t) => t.name)).toContain("crm_set_conversation_sector");
  });

  it("o schema das regras aceita `define_sector` — e exige um setor", () => {
    // Espelho do RED: em `origin/main` o mesmo parse devolve `success: false`.
    expect(actionSchema.safeParse({ type: "define_sector", config: { sector_id: SETOR } }).success).toBe(
      true,
    );
    expect(actionSchema.safeParse({ type: "define_sector", config: {} }).success).toBe(false);
    // Sem setor não existe destino: a regra não pode ser salva apontando para nada.
    expect(actionSchema.safeParse({ type: "define_sector", config: { sector_id: "nao-e-uuid" } }).success).toBe(
      false,
    );
  });

  it("o catálogo descreve a ferramenta e a prende ao módulo `setores`", () => {
    // Módulo opcional desligado ⇒ a capacidade não é oferecida (doc 213). Sem
    // esta linha, uma instalação sem setores veria a ferramenta no catálogo e
    // receberia 404/recusa em toda chamada.
    const entrada = TOOL_CATALOG.find((t) => t.name === "crm_set_conversation_sector");
    expect(entrada).toMatchObject({ modulo: "setores", category: "write" });
  });
});

function ctxDaTool(fake: Fake): McpContext {
  return {
    organizationId: ORG,
    role: "agent",
    actor: { type: "ai_agent", id: "run-1", role: "agent" },
    apiTokenId: "00000000-0000-4000-8000-000000000000",
    requestId: "req-mcp",
    supabase: fake.client as never,
  };
}

describe("ferramenta da IA: crm_set_conversation_sector", () => {
  it("grava a fila e devolve de onde para onde", async () => {
    const fake = clienteFake({
      conversations: [conversa({ sector_id: null })],
      attendant_sectors: setores(),
    });
    const r = (await crmSetConversationSector.handler(
      { conversation_id: CONVERSA, sector_id: SETOR },
      ctxDaTool(fake),
    )) as Record<string, unknown>;

    expect(r).toMatchObject({
      conversation_id: CONVERSA,
      sector_id: SETOR,
      previous_sector_id: null,
      changed: true,
      requeued: true,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "conversation.sector_changed",
        metadata: expect.objectContaining({ origem: "ia", actor_type: "ai_agent" }),
      }),
    );
  });

  it("recusa com CÓDIGO nomeado — nunca 200 mudo", async () => {
    const semSetor = clienteFake({ conversations: [conversa()], attendant_sectors: setores() });
    await expect(
      crmSetConversationSector.handler(
        { conversation_id: CONVERSA, sector_id: "99999999-9999-4999-8999-999999999999" },
        ctxDaTool(semSetor),
      ),
    ).rejects.toThrow("sector_not_found");

    const encerrada = clienteFake({
      conversations: [conversa({ status: "closed" })],
      attendant_sectors: setores(),
    });
    await expect(
      crmSetConversationSector.handler({ conversation_id: CONVERSA, sector_id: SETOR }, ctxDaTool(encerrada)),
    ).rejects.toThrow("conversation_closed");

    const manual = clienteFake({
      conversations: [
        conversa({ sector_id: SETOR_ANTIGO, metadata: { [CHAVE_DA_ORIGEM_DO_SETOR]: "manual" } }),
      ],
      attendant_sectors: setores(),
    });
    await expect(
      crmSetConversationSector.handler({ conversation_id: CONVERSA, sector_id: SETOR }, ctxDaTool(manual)),
    ).rejects.toThrow("sector_set_manually");

    const alheia = clienteFake({
      conversations: [conversa({ organization_id: OUTRA_ORG })],
      attendant_sectors: setores(),
    });
    await expect(
      crmSetConversationSector.handler({ conversation_id: CONVERSA, sector_id: SETOR }, ctxDaTool(alheia)),
    ).rejects.toThrow("conversation_not_found");
  });

  it("a ferramenta exige papel `agent` e escopo de escrita", () => {
    // A recusa por papel é do servidor MCP (`ensureRole`), e ela só existe se a
    // ferramenta declarar a exigência. Sem estas duas linhas a IA de um papel
    // menor chamaria a escrita.
    expect(crmSetConversationSector.requiresRole).toBe("agent");
    expect(crmSetConversationSector.requiresScope).toBe("mcp:write");
  });
});

function ctxDaAcao(
  fake: Fake,
  opcoes: { conversationId?: string; contactId?: string } = {},
): ActionCtx {
  return {
    admin: fake.client as never,
    organizationId: ORG,
    ruleId: "regra-1",
    ruleName: "Triagem por assunto",
    requestId: "req-automacao",
    event: {
      id: "evt-1",
      organization_id: ORG,
      event_type: "message.received",
      entity_kind: "message",
      entity_id: "msg-1",
      payload: {
        ...(opcoes.conversationId ? { conversation_id: opcoes.conversationId } : {}),
        ...(opcoes.contactId ? { contact_id: opcoes.contactId } : {}),
      },
      metadata: {},
      consumed_by: [],
      attempts: 0,
    },
    context: opcoes.contactId ? { contact: { id: opcoes.contactId } } : {},
  };
}

describe("ação de automação: define_sector", () => {
  it("classifica a conversa do EVENTO e audita como automação", async () => {
    const fake = clienteFake({ conversations: [conversa()], attendant_sectors: setores() });
    const r = await getAction("define_sector")!.execute(
      ctxDaAcao(fake, { conversationId: CONVERSA, contactId: "contato-1" }),
      { sector_id: SETOR },
    );

    expect(r).toMatchObject({
      type: "define_sector",
      status: "success",
      detail: expect.objectContaining({ conversa_id: CONVERSA, conversa_de: "evento", para: SETOR }),
    });
    expect(fake.updates[0]?.patch).toMatchObject({ sector_id: SETOR });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ origem: "automacao", actor_type: "automacao", actor_id: "regra-1" }),
      }),
    );
  });

  it("evento sem conversa (negócio) usa a conversa aberta do contato", async () => {
    const fake = clienteFake({
      conversations: [conversa({ contact_id: "contato-1", last_message_at: "2026-11-05T10:00:00Z" })],
      attendant_sectors: setores(),
    });
    const r = await getAction("define_sector")!.execute(ctxDaAcao(fake, { contactId: "contato-1" }), {
      sector_id: SETOR,
    });
    expect(r).toMatchObject({ status: "success", detail: expect.objectContaining({ conversa_de: "contato" }) });
    expect(fake.updates).toHaveLength(1);
  });

  it("não entra em laço: a segunda execução do mesmo evento não grava nem audita", async () => {
    const fake = clienteFake({
      conversations: [conversa({ sector_id: SETOR, metadata: { [CHAVE_DA_ORIGEM_DO_SETOR]: "automacao" } })],
      attendant_sectors: setores(),
    });
    const r = await getAction("define_sector")!.execute(ctxDaAcao(fake, { conversationId: CONVERSA }), {
      sector_id: SETOR,
    });
    expect(r).toMatchObject({ status: "success", detail: expect.objectContaining({ mudou: false }) });
    expect(fake.updates).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
    // E nenhuma linha de `event_log` foi tocada: o fake estoura se alguém tentar.
    expect(fake.tabelasTocadas).not.toContain("event_log");
  });

  it("mudar setor não é gatilho de automação", () => {
    // A prova estrutural do laço: o motor só escuta os eventos deste mapa, e
    // nenhum deles nasce de uma mudança de setor. Sem isso, a regra que muda
    // setor poderia redisparar a si mesma.
    //
    // Os ÚNICOS gatilhos de conversa são os dois da pausa da IA (migration
    // 9811), e eles não nascem do setor: o gatilho do banco só dispara quando
    // muda o silêncio ou o dono da conversa (ver o caso seguinte). Um terceiro
    // `conversation.*` reprova aqui até alguém provar que ele não fecha laço.
    const gatilhos = Object.keys(ENTIDADE_ESPERADA_POR_GATILHO);
    const deConversa = gatilhos.filter((gatilho) => gatilho.startsWith("conversation."));
    expect(deConversa).toEqual(["conversation.ai_paused", "conversation.ai_resumed"]);
    expect(deConversa).toEqual([...GATILHOS_DO_TRIGGER_DE_CONVERSA]);
    expect(gatilhos).not.toContain("conversation.sector_changed");
  });

  it("gravar só o setor não emite a pausa da IA: o gatilho do banco não olha `sector_id`", () => {
    // `definirSetorDaConversa` grava `sector_id` e `metadata`. O gatilho da 9811
    // só acorda quando muda o silêncio, o tipo de dono ou o dono. Se alguém
    // acrescentar `sector_id` à cláusula `when`, toda mudança de setor passa a
    // ser gatilho de automação pela porta dos fundos.
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20261120150000_9811_ia_pausada_e_retomada_viram_evento.sql"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const gatilho = migration.slice(migration.indexOf("create trigger trg_anunciar_pausa_da_ia"));
    const quando = gatilho.slice(gatilho.indexOf("when ("), gatilho.indexOf("execute function"));
    const colunas = [...quando.matchAll(/old\.([a-z_]+) is distinct from new\.\1/g)].map((m) => m[1]);
    expect(colunas).toEqual(["bot_silenced_until", "assignee_kind", "assigned_to_user_id"]);
    expect(migration.slice(migration.indexOf("create or replace function"))).not.toMatch(/sector_id/);
  });

  it("nos gatilhos de conversa, a regra não pode mudar setor nem dono (o laço que sobrou está vetado)", () => {
    // O caminho indireto: mudar o setor de uma conversa sem dono pede
    // distribuição, a distribuição dá um dono, e o dono novo grava
    // `conversation.ai_paused`. Uma regra desse gatilho que mudasse setor ou
    // dono realimentaria o próprio gatilho. O veto é por tipo, alcança a ação
    // escondida dentro de `ai_decide`, e vale na porta da API.
    for (const gatilho of GATILHOS_DO_TRIGGER_DE_CONVERSA) {
      expect(acoesQueFechamLaco(gatilho, [{ type: "define_sector" }])).toEqual(["define_sector"]);
      expect(acoesQueFechamLaco(gatilho, [{ type: "assign_owner" }])).toEqual(["assign_owner"]);
      expect(
        acoesQueFechamLaco(gatilho, [
          { type: "ai_decide", config: { opcoes: [{ acao: { type: "define_sector" } }] } },
        ]),
      ).toEqual(["define_sector"]);

      const regra = { name: "Regra de teste", trigger_event: gatilho, conditions: [] };
      expect(
        createAutomationRuleSchema.safeParse({
          ...regra,
          actions: [{ type: "define_sector", config: { sector_id: SETOR } }],
        }).success,
      ).toBe(false);
      expect(
        createAutomationRuleSchema.safeParse({
          ...regra,
          actions: [{ type: "call_webhook", config: { url: "https://exemplo.test/hook" } }],
        }).success,
      ).toBe(true);
    }
    // Fora deles, mudar setor segue livre: é o uso normal da ação.
    expect(acoesQueFechamLaco("message.received", [{ type: "define_sector" }])).toEqual([]);
  });

  it("sem setor configurado, falha nomeada (regra quebrada não passa calada)", async () => {
    const fake = clienteFake({ conversations: [conversa()], attendant_sectors: setores() });
    const r = await getAction("define_sector")!.execute(ctxDaAcao(fake, { conversationId: CONVERSA }), {});
    expect(r).toMatchObject({ status: "failed", error: "sector_id_ausente" });
    expect(fake.updates).toEqual([]);
  });

  it("sem conversa para classificar, é ignorada com motivo — não inventa alvo", async () => {
    const fake = clienteFake({ conversations: [], attendant_sectors: setores() });
    const r = await getAction("define_sector")!.execute(ctxDaAcao(fake, { contactId: "contato-1" }), {
      sector_id: SETOR,
    });
    expect(r).toMatchObject({ status: "skipped", detail: { reason: "sem_conversa" } });
    expect(fake.updates).toEqual([]);
  });

  it("setor inexistente e conversa encerrada chegam como recusa nomeada, e a frase é a do mapa traduzido", async () => {
    const semSetor = clienteFake({ conversations: [conversa()], attendant_sectors: setores() });
    const r1 = await getAction("define_sector")!.execute(ctxDaAcao(semSetor, { conversationId: CONVERSA }), {
      sector_id: "99999999-9999-4999-8999-999999999999",
    });
    expect(r1).toMatchObject({ status: "failed", error: "setor_inexistente" });
    // Sem `explicacao`: na Atividade ela venceria MOTIVO_DA_PARADA, e a frase da
    // régua não tem tradução — a tela em espanhol mostraria português.
    expect((r1.detail as { explicacao?: unknown }).explicacao).toBeUndefined();

    const encerrada = clienteFake({
      conversations: [conversa({ status: "closed" })],
      attendant_sectors: setores(),
    });
    const r2 = await getAction("define_sector")!.execute(ctxDaAcao(encerrada, { conversationId: CONVERSA }), {
      sector_id: SETOR,
    });
    expect(r2).toMatchObject({ status: "failed", error: "conversa_encerrada" });
    expect(encerrada.updates).toEqual([]);
  });

  it("com `sobrescrever_setor_manual` desligado, o setor de uma pessoa fica", async () => {
    const fake = clienteFake({
      conversations: [
        conversa({ sector_id: SETOR_ANTIGO, metadata: { [CHAVE_DA_ORIGEM_DO_SETOR]: "manual" } }),
      ],
      attendant_sectors: setores(),
    });
    const r = await getAction("define_sector")!.execute(ctxDaAcao(fake, { conversationId: CONVERSA }), {
      sector_id: SETOR,
    });
    expect(r).toMatchObject({ status: "failed", error: "setor_manual_preservado" });
    expect(fake.updates).toEqual([]);
  });
});
