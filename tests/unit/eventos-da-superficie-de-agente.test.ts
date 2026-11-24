/**
 * Os eventos da superfície de agente, do emissor à entrega.
 *
 *   1. a fonte única dos gatilhos os conhece, e o motor os assina;
 *   2. o que cada emissor grava no `event_log` (IDs e fatos curtos, sem texto);
 *   3. o que chega ao receptor, campo a campo, com texto LONGO inteiro
 *      (o corte de 280 caracteres não vale para a entrega);
 *   4. assinatura, retentativa e o id que deduplica;
 *   5. o detalhe é lido só da organização do evento;
 *   6. organização parada não entrega nada.
 *
 * A entrega é provada com um receptor HTTP de verdade (o mesmo desenho de
 * `lib/automation/actions/call-webhook.test.ts`); o banco é dublê por tabela.
 */
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { TRIGGER_LABELS } from "@/app/app/webhooks/_components/labels";
import { CURATED_FIELDS } from "@/app/app/webhooks/_components/RuleEditor";
import { executeCallWebhook, idDaEntrega } from "@/lib/automation/actions/call-webhook";
import { detalheDoEvento } from "@/lib/automation/detalhe-do-evento";
import { automationRulesHandler } from "@/lib/automation/engine.handler";
import {
  EVENTO_ANEXO_ADICIONADO,
  EVENTO_CAMPO_ALTERADO,
  EVENTO_NOTA_ADICIONADA,
  EVENTO_TAG_REMOVIDA,
  EVENTO_TAREFA_CONCLUIDA,
  EVENTO_TAREFA_CRIADA,
  emitirEventoDaSuperficie,
  entidadeDoEventoDaSuperficie,
  payloadDoCampoAlterado,
  tagsRemovidas,
} from "@/lib/automation/eventos-de-saida";
import type { ActionCtx } from "@/lib/automation/types";
import { DETALHE_DA_ORG_PARADA, dispatchEvent, registerHandler } from "@/lib/event-log/dispatcher";
import { ENTIDADE_ESPERADA_POR_GATILHO, TRIGGER_EVENTS } from "@/lib/schemas/webhooks";

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "99999999-9999-4999-8999-999999999999";
const LEAD = "22222222-2222-4222-8222-222222222222";
const CONTATO = "33333333-3333-4333-8333-333333333333";
const NOTA = "44444444-4444-4444-8444-444444444444";
const TAREFA = "55555555-5555-4555-8555-555555555555";
const MENSAGEM = "66666666-6666-4666-8666-666666666666";
const CONVERSA = "77777777-7777-4777-8777-777777777777";
const CANAL = "88888888-8888-4888-8888-888888888888";

/** Bem mais que 280 caracteres, com o fim reconhecível. */
const TEXTO_LONGO = `${"palavra ".repeat(700)}FIM-DO-TEXTO`;

const NOVOS = [
  EVENTO_TAG_REMOVIDA,
  EVENTO_CAMPO_ALTERADO,
  EVENTO_NOTA_ADICIONADA,
  EVENTO_TAREFA_CRIADA,
  EVENTO_ANEXO_ADICIONADO,
  EVENTO_TAREFA_CONCLUIDA,
] as const;

// ---------------------------------------------------------------------------
// Banco de mentira: linhas por tabela, e o filtro `.eq` aplicado de verdade.

type Linha = Record<string, unknown>;

function bancoFalso(tabelas: Record<string, Linha[]>) {
  const consultas: Array<{ tabela: string; filtros: Record<string, unknown> }> = [];
  const admin = {
    from(tabela: string) {
      const filtros: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq(coluna: string, valor: unknown) {
          filtros[coluna] = valor;
          return q;
        },
        async maybeSingle() {
          consultas.push({ tabela, filtros: { ...filtros } });
          const achada = (tabelas[tabela] ?? []).find((l) =>
            Object.entries(filtros).every(([c, v]) => l[c] === v),
          );
          return { data: achada ?? null, error: null };
        },
      };
      return q;
    },
  };
  return { admin: admin as unknown as ActionCtx["admin"], consultas };
}

const LINHA_DA_NOTA: Linha = {
  id: NOTA,
  organization_id: ORG,
  lead_id: LEAD,
  type: "note",
  source_module: "leads/notas",
  actor_kind: "ai_agent",
  reason: "resumo",
  payload: {
    texto: TEXTO_LONGO,
    autor: { tipo: "token", id: "token-1", nome: "Integração de fora" },
    destinatario: "financeiro",
  },
  performed_at: "2026-11-20T12:00:00.000Z",
};

const LINHA_DA_TAREFA: Linha = {
  id: TAREFA,
  organization_id: ORG,
  title: "Ligar para confirmar",
  description: TEXTO_LONGO,
  due_date: "2026-11-25T15:00:00.000Z",
  priority: "high",
  status: "done",
  kind: "retorno",
  result: TEXTO_LONGO,
  lead_id: LEAD,
  contact_id: CONTATO,
  assigned_to: "usuario-interno",
  created_at: "2026-11-20T10:00:00.000Z",
  updated_at: "2026-11-20T12:00:00.000Z",
};

const LINHA_DA_MENSAGEM: Linha = {
  id: MENSAGEM,
  organization_id: ORG,
  conversation_id: CONVERSA,
  channel_session_id: CANAL,
  contact_id: CONTATO,
  direction: "inbound",
  type: "text",
  status: "received",
  body: TEXTO_LONGO,
  media_mime: null,
  sent_at: "2026-11-20T11:59:00.000Z",
  created_at: "2026-11-20T11:59:01.000Z",
};

const LEAD_DO_CONTEXTO = {
  id: LEAD,
  organization_id: ORG,
  title: "Negócio de exemplo",
  status: "open",
  pipeline_id: "funil-1",
  stage_id: "etapa-2",
  value_cents: 150000,
  currency: "BRL",
  tags: ["quente"],
  custom_fields: { origem_do_pedido: "indicação" },
  owner_user_id: "usuario-interno",
  created_at: "2026-11-01T00:00:00.000Z",
};

function ctxDo(
  eventType: string,
  payload: Record<string, unknown>,
  admin: ActionCtx["admin"],
  entidade: "crm_lead" | "crm_task" | "message" = "crm_lead",
): ActionCtx {
  return {
    admin,
    organizationId: ORG,
    ruleId: "regra-1",
    ruleName: "Avisar o sistema de fora",
    requestId: "req-1",
    actionIndex: 0,
    ruleActions: [{ type: "call_webhook", config: { url: "https://exemplo.invalid/hook" } }],
    event: {
      id: "evento-1",
      organization_id: ORG,
      event_type: eventType,
      entity_kind: entidade,
      entity_id: entidade === "crm_task" ? TAREFA : entidade === "message" ? MENSAGEM : LEAD,
      payload,
      metadata: {},
      consumed_by: [],
      attempts: 0,
      created_at: "2026-11-20T12:00:00.000Z",
    },
    context: { lead: LEAD_DO_CONTEXTO, contact: { id: CONTATO, name: "Pessoa de Exemplo", cpf_hash: "nao-sai" } },
  };
}

interface Recebido {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let servidor: Server | undefined;
afterEach(async () => {
  if (servidor) {
    await new Promise<void>((resolve) => servidor!.close(() => resolve()));
    servidor = undefined;
  }
});

/** Sobe um receptor que responde com os status dados, em ordem (o último se repete). */
async function receptor(status: number[] = [200]): Promise<{ url: string; recebidos: Recebido[] }> {
  const recebidos: Recebido[] = [];
  servidor = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on("data", (c) => partes.push(c));
    req.on("end", () => {
      recebidos.push({ headers: req.headers, body: Buffer.concat(partes).toString("utf8") });
      res.statusCode = status[Math.min(recebidos.length - 1, status.length - 1)]!;
      res.end();
    });
  });
  await new Promise<void>((resolve) => servidor!.listen(0, "127.0.0.1", resolve));
  const endereco = servidor.address();
  const porta = typeof endereco === "object" && endereco ? endereco.port : 0;
  return { url: `http://127.0.0.1:${porta}/hook`, recebidos };
}

async function entregar(ctx: ActionCtx, config: Record<string, unknown> = {}, status: number[] = [200]) {
  const { url, recebidos } = await receptor(status);
  const resultado = await executeCallWebhook(ctx, { url, ...config }, { skipUrlCheck: true, retryDelaysMs: [1, 1] });
  return { resultado, recebidos, corpo: () => JSON.parse(recebidos[recebidos.length - 1]!.body) };
}

// ---------------------------------------------------------------------------

describe("1. a fonte única conhece os eventos novos", () => {
  it.each(NOVOS)("%s é gatilho, com a entidade que o emissor grava", (evento) => {
    expect(TRIGGER_EVENTS as readonly string[]).toContain(evento);
    expect(ENTIDADE_ESPERADA_POR_GATILHO[evento]).toBe(entidadeDoEventoDaSuperficie(evento));
  });

  it.each(NOVOS)("%s é assinado pelo motor e tem frase e campos na tela", (evento) => {
    expect(automationRulesHandler.events).toContain(evento);
    expect(TRIGGER_LABELS[evento].length).toBeGreaterThan(10);
    expect(Array.isArray(CURATED_FIELDS[evento])).toBe(true);
  });

  it("trocar o responsável e perder o negócio continuam com o gatilho que já tinham", () => {
    expect(TRIGGER_EVENTS as readonly string[]).toContain("lead.assigned");
    expect(TRIGGER_EVENTS as readonly string[]).toContain("lead.lost");
    expect(TRIGGER_EVENTS as readonly string[]).not.toContain("lead.owner_changed");
  });
});

describe("2. o que o emissor grava no event_log", () => {
  it("emite pela `emit_event`, com a entidade do evento e a organização de quem escreveu", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    await emitirEventoDaSuperficie({ rpc } as never, {
      tipo: EVENTO_TAREFA_CONCLUIDA,
      organizationId: ORG,
      entidadeId: TAREFA,
      payload: { task_id: TAREFA, lead_id: LEAD },
      requestId: "req-9",
      ator: { via: "mcp" },
    });
    expect(rpc).toHaveBeenCalledWith("emit_event", {
      p_event_type: "task.completed",
      p_entity_kind: "crm_task",
      p_entity_id: TAREFA,
      p_payload: { task_id: TAREFA, lead_id: LEAD },
      p_metadata: { request_id: "req-9", via: "mcp" },
      p_organization_id: ORG,
    });
  });

  it("nunca lança: erro do banco e cliente quebrado viram log, não exceção", async () => {
    const base = { tipo: EVENTO_NOTA_ADICIONADA, organizationId: ORG, entidadeId: LEAD, payload: {} } as const;
    await expect(
      emitirEventoDaSuperficie({ rpc: async () => ({ error: { message: "fora do ar" } }) } as never, base),
    ).resolves.toBeUndefined();
    await expect(
      emitirEventoDaSuperficie({ rpc: () => { throw new Error("quebrou"); } } as never, base),
    ).resolves.toBeUndefined();
    await expect(emitirEventoDaSuperficie({} as never, base)).resolves.toBeUndefined();
  });

  it("tags removidas: só as que saíram; reordenar não é remover", () => {
    expect(tagsRemovidas(["a", "b", "c"], ["c", "a"])).toEqual(["b"]);
    expect(tagsRemovidas(["a", "b"], ["b", "a"])).toEqual([]);
    expect(tagsRemovidas(null, ["a"])).toEqual([]);
  });

  describe("lead.field_changed", () => {
    const anterior = {
      title: "Nome antigo",
      description: "texto antigo",
      value_cents: 1000,
      currency: "BRL",
      expected_close_date: null,
      owner_user_id: "usuario-a",
      tags: ["a"],
      custom_fields: { destino: "norte", pessoas: 2, observacao: "x" },
    };

    it("campo tipado leva antes e depois; texto e campo do funil saem só pelo nome", () => {
      const payload = payloadDoCampoAlterado({
        leadId: LEAD,
        contactId: CONTATO,
        fields: ["title", "value_cents", "custom_fields"],
        anterior,
        enviados: {
          title: "Nome novo",
          value_cents: 2500,
          custom_fields: { destino: "sul", pessoas: 2, observacao: "x", novo: true },
        },
      });
      expect(payload).toEqual({
        lead_id: LEAD,
        contact_id: CONTATO,
        fields: ["title", "value_cents", "custom_fields.destino", "custom_fields.novo"],
        changes: [
          { field: "title" },
          { field: "value_cents", old: 1000, new: 2500 },
          { field: "custom_fields.destino" },
          { field: "custom_fields.novo" },
        ],
      });
      // O valor do título e o do campo do funil não entram no event_log.
      const gravado = JSON.stringify(payload);
      expect(gravado).not.toContain("Nome antigo");
      expect(gravado).not.toContain("Nome novo");
      expect(gravado).not.toContain("norte");
      expect(gravado).not.toContain("sul");
    });

    it("dono e tags têm evento próprio: edição só deles não emite este", () => {
      expect(
        payloadDoCampoAlterado({
          leadId: LEAD,
          contactId: null,
          fields: ["tags", "owner_user_id"],
          anterior,
          enviados: { tags: ["b"], owner_user_id: "usuario-b" },
        }),
      ).toBeNull();
    });

    it("quem é o dono nunca sai por aqui, nem junto de outro campo", () => {
      const payload = payloadDoCampoAlterado({
        leadId: LEAD,
        contactId: null,
        fields: ["owner_user_id", "currency"],
        anterior,
        enviados: { owner_user_id: "usuario-b", currency: "EUR" },
      });
      expect(payload?.fields).toEqual(["currency"]);
      expect(JSON.stringify(payload)).not.toContain("usuario-");
    });

    it("edição que não mudou nada não emite", () => {
      expect(
        payloadDoCampoAlterado({ leadId: LEAD, contactId: null, fields: [], anterior, enviados: {} }),
      ).toBeNull();
    });
  });
});

describe("3. o que chega ao receptor, campo a campo", () => {
  it("lead.note_added: a nota inteira, com autor e destinatário", async () => {
    const { admin } = bancoFalso({ crm_lead_activities: [LINHA_DA_NOTA] });
    const { corpo } = await entregar(
      ctxDo(EVENTO_NOTA_ADICIONADA, { lead_id: LEAD, note_id: NOTA, contact_id: CONTATO, recipient: "financeiro" }, admin),
    );
    const c = corpo();
    expect(c.event).toBe("lead.note_added");
    expect(c.happened_at).toBe("2026-11-20T12:00:00.000Z");
    expect(c.data.lead_id).toBe(LEAD);
    expect(c.data.note_id).toBe(NOTA);
    expect(c.data.recipient).toBe("financeiro");
    expect(c.data.note).toEqual({
      id: NOTA,
      lead_id: LEAD,
      text: TEXTO_LONGO,
      author: { kind: "token", id: "token-1", name: "Integração de fora" },
      recipient: "financeiro",
      created_at: "2026-11-20T12:00:00.000Z",
    });
    expect(c.data.note.text.endsWith("FIM-DO-TEXTO")).toBe(true);
    // O negócio vai junto: funil, etapa, valor, tags atuais e campos do funil.
    expect(c.data.lead).toMatchObject({
      id: LEAD,
      pipeline_id: "funil-1",
      stage_id: "etapa-2",
      value_cents: 150000,
      tags: ["quente"],
      custom_fields: { origem_do_pedido: "indicação" },
    });
    expect(c.data.contact).toEqual({ id: CONTATO, name: "Pessoa de Exemplo" });
  });

  it.each([EVENTO_TAREFA_CRIADA, EVENTO_TAREFA_CONCLUIDA])(
    "%s: a tarefa inteira, sem o responsável (identidade interna)",
    async (evento) => {
      const { admin } = bancoFalso({ crm_tasks: [LINHA_DA_TAREFA] });
      const { corpo, recebidos } = await entregar(
        ctxDo(evento, { task_id: TAREFA, lead_id: LEAD, contact_id: CONTATO }, admin,
          evento === EVENTO_TAREFA_CONCLUIDA ? "crm_task" : "crm_lead"),
      );
      const c = corpo();
      expect(c.event).toBe(evento);
      expect(c.data.task).toEqual({
        id: TAREFA,
        title: "Ligar para confirmar",
        description: TEXTO_LONGO,
        due_date: "2026-11-25T15:00:00.000Z",
        priority: "high",
        status: "done",
        kind: "retorno",
        result: TEXTO_LONGO,
        lead_id: LEAD,
        contact_id: CONTATO,
        created_at: "2026-11-20T10:00:00.000Z",
        updated_at: "2026-11-20T12:00:00.000Z",
      });
      expect(recebidos[0]!.body).not.toContain("usuario-interno");
      expect(recebidos[0]!.body).not.toContain(ORG);
    },
  );

  it("lead.attachment_added: nome, tipo, tamanho e campo do arquivo", async () => {
    const { admin } = bancoFalso({});
    const { corpo } = await entregar(
      ctxDo(EVENTO_ANEXO_ADICIONADO, {
        lead_id: LEAD,
        attachment_id: "anexo-1",
        field_key: "documentos",
        file_name: "comprovante.pdf",
        mime_type: "application/pdf",
        file_size: 123456,
      }, admin),
    );
    expect(corpo().data).toMatchObject({
      lead_id: LEAD,
      attachment_id: "anexo-1",
      field_key: "documentos",
      file_name: "comprovante.pdf",
      mime_type: "application/pdf",
      file_size: 123456,
      lead: { id: LEAD },
    });
  });

  it("lead.tag_removed: o que saiu e as tags que ficaram", async () => {
    const { admin } = bancoFalso({});
    const { corpo } = await entregar(
      ctxDo(EVENTO_TAG_REMOVIDA, { lead_id: LEAD, removed_tags: ["frio"], tags: ["quente"] }, admin),
    );
    const c = corpo();
    expect(c.data.removed_tags).toEqual(["frio"]);
    expect(c.data.tags).toEqual(["quente"]);
    expect(c.data.lead.tags).toEqual(["quente"]);
  });

  it("lead.field_changed: os campos, o antes-e-depois tipado e o negócio como está agora", async () => {
    const { admin } = bancoFalso({});
    const { corpo } = await entregar(
      ctxDo(EVENTO_CAMPO_ALTERADO, {
        lead_id: LEAD,
        fields: ["title", "value_cents"],
        changes: [{ field: "title" }, { field: "value_cents", old: 1000, new: 150000 }],
      }, admin),
    );
    const c = corpo();
    expect(c.data.fields).toEqual(["title", "value_cents"]);
    expect(c.data.changes).toEqual([{ field: "title" }, { field: "value_cents", old: 1000, new: 150000 }]);
    expect(c.data.lead.title).toBe("Negócio de exemplo");
    expect(c.data.lead.value_cents).toBe(150000);
  });

  it("message.received: o texto INTEIRO, a conversa e o canal (a prévia de 280 não é mais tudo o que sai)", async () => {
    const { admin } = bancoFalso({ messages: [LINHA_DA_MENSAGEM] });
    const { corpo } = await entregar(
      ctxDo("message.received", {
        message_id: MENSAGEM,
        conversation_id: CONVERSA,
        contact_id: CONTATO,
        direction: "inbound",
        type: "text",
        channel_session_id: CANAL,
        body_preview: TEXTO_LONGO.slice(0, 280),
      }, admin, "message"),
    );
    const c = corpo();
    expect(c.data.body_preview).toHaveLength(280);
    expect(c.data.message).toEqual({
      id: MENSAGEM,
      conversation_id: CONVERSA,
      channel_session_id: CANAL,
      direction: "inbound",
      type: "text",
      status: "received",
      text: TEXTO_LONGO,
      media_mime: null,
      sent_at: "2026-11-20T11:59:00.000Z",
    });
    expect(c.data.message.text.length).toBeGreaterThan(5000);
  });

  it("o responsável da tarefa só sai com o opt-in da regra", async () => {
    const { admin } = bancoFalso({ crm_tasks: [LINHA_DA_TAREFA] });
    const semOptIn = await detalheDoEvento(admin, ORG,
      { event_type: EVENTO_TAREFA_CRIADA, payload: { task_id: TAREFA } }, { incluirResponsavel: false });
    expect((semOptIn.task as Record<string, unknown>).assigned_to).toBeUndefined();
  });

  it("detalhe que não pôde ser lido não derruba a entrega", async () => {
    const quebrado = { from: () => { throw new Error("banco fora do ar"); } } as unknown as ActionCtx["admin"];
    const { resultado, corpo } = await entregar(
      ctxDo(EVENTO_NOTA_ADICIONADA, { lead_id: LEAD, note_id: NOTA }, quebrado),
    );
    expect(resultado.status).toBe("success");
    expect(corpo().data.note).toBeUndefined();
    expect(corpo().data.note_id).toBe(NOTA);
  });
});

describe("4. assinatura, retentativa e idempotência", () => {
  const SEGREDO = "segredo-de-teste-da-superficie";
  const payload = { lead_id: LEAD, note_id: NOTA };

  it("a entrega de um evento novo sai assinada: HMAC de '<t>.<entrega>.<corpo cru>'", async () => {
    const { admin } = bancoFalso({ crm_lead_activities: [LINHA_DA_NOTA] });
    const { recebidos } = await entregar(ctxDo(EVENTO_NOTA_ADICIONADA, payload, admin), { secret: SEGREDO });
    const { headers, body } = recebidos[0]!;
    const entrega = headers["x-webhook-delivery"] as string;
    const [t, v1] = (headers["x-webhook-signature"] as string).split(",").map((p) => p.split("=")[1]!);
    expect(v1).toBe(createHmac("sha256", SEGREDO).update(`${t}.${entrega}.${body}`).digest("hex"));
    expect(headers["x-webhook-event"]).toBe("lead.note_added");
    expect(JSON.parse(body).delivery_id).toBe(entrega);
  });

  it("falhou, tenta de novo: mesmo id de entrega e mesmo corpo, tentativa contando", async () => {
    const { admin } = bancoFalso({ crm_lead_activities: [LINHA_DA_NOTA] });
    const { resultado, recebidos } = await entregar(
      ctxDo(EVENTO_NOTA_ADICIONADA, payload, admin), { secret: SEGREDO }, [500, 503, 200],
    );
    expect(resultado).toMatchObject({ status: "success", detail: { attempt: 3 } });
    expect(recebidos).toHaveLength(3);
    expect(recebidos.map((r) => r.headers["x-webhook-attempt"])).toEqual(["1", "2", "3"]);
    expect(new Set(recebidos.map((r) => r.headers["x-webhook-delivery"])).size).toBe(1);
    expect(new Set(recebidos.map((r) => r.body)).size).toBe(1);
  });

  it("receptor fora do ar: três tentativas e a entrega fica como falha, com o id para o Reenviar", async () => {
    const { admin } = bancoFalso({});
    const { resultado, recebidos } = await entregar(ctxDo(EVENTO_NOTA_ADICIONADA, payload, admin), {}, [500]);
    expect(recebidos).toHaveLength(3);
    expect(resultado).toMatchObject({ status: "failed", error: "http_500", detail: { attempts: 3, attempt: 3 } });
    expect(typeof resultado.detail?.delivery_id).toBe("string");
  });

  it("o id é um por evento e regra: o mesmo evento repete o id, outro evento tem outro", () => {
    const acoes = [{ type: "call_webhook", config: { url: "https://exemplo.invalid/hook" } }];
    expect(idDaEntrega("evento-1", "regra-1", 0, acoes)).toBe(idDaEntrega("evento-1", "regra-1", 0, acoes));
    expect(idDaEntrega("evento-2", "regra-1", 0, acoes)).not.toBe(idDaEntrega("evento-1", "regra-1", 0, acoes));
    expect(idDaEntrega("evento-1", "regra-2", 0, acoes)).not.toBe(idDaEntrega("evento-1", "regra-1", 0, acoes));
  });
});

describe("5. o detalhe é lido só da organização do evento", () => {
  it.each([
    ["nota", EVENTO_NOTA_ADICIONADA, { lead_id: LEAD, note_id: NOTA }, "crm_lead_activities", LINHA_DA_NOTA, "note"],
    ["tarefa", EVENTO_TAREFA_CONCLUIDA, { task_id: TAREFA }, "crm_tasks", LINHA_DA_TAREFA, "task"],
    ["mensagem", "message.received", { message_id: MENSAGEM }, "messages", LINHA_DA_MENSAGEM, "message"],
  ] as const)("%s de outra organização não entra na entrega", async (_caso, evento, payload, tabela, linha, chave) => {
    const { admin, consultas } = bancoFalso({ [tabela]: [{ ...linha, organization_id: OUTRA_ORG }] });
    const detalhe = await detalheDoEvento(admin, ORG, { event_type: evento, payload }, { incluirResponsavel: true });
    expect(detalhe[chave]).toBeUndefined();
    expect(consultas).toHaveLength(1);
    expect(consultas[0]!.filtros.organization_id).toBe(ORG);

    // CONTROLE: a mesma linha, na organização do evento, entra.
    const { admin: daOrg } = bancoFalso({ [tabela]: [linha] });
    const lido = await detalheDoEvento(daOrg, ORG, { event_type: evento, payload }, { incluirResponsavel: false });
    expect(lido[chave]).toBeDefined();
  });

  it("evento sem detalhe a buscar não consulta o banco", async () => {
    const { admin, consultas } = bancoFalso({});
    expect(
      await detalheDoEvento(admin, ORG, { event_type: EVENTO_TAG_REMOVIDA, payload: { lead_id: LEAD } }, { incluirResponsavel: false }),
    ).toEqual({});
    expect(consultas).toEqual([]);
  });
});

describe("6. organização parada não entrega nada", () => {
  it.each([...NOVOS, "message.received", "lead.lost", "lead.assigned"])(
    "%s de organização parada é pulado antes de o motor rodar",
    async (evento) => {
      const handle = vi.spyOn(automationRulesHandler, "handle");
      registerHandler(automationRulesHandler);
      const fetchEspiao = vi.spyOn(globalThis, "fetch");
      try {
        const resultados = await dispatchEvent(
          {
            id: "evento-parado",
            organization_id: ORG,
            event_type: evento,
            entity_kind: "crm_lead",
            entity_id: LEAD,
            payload: { lead_id: LEAD },
            metadata: {},
            consumed_by: [],
            attempts: 0,
          },
          { orgParada: true, soHandlers: [automationRulesHandler.key] },
        );
        expect(resultados).toEqual([
          { consumer_key: automationRulesHandler.key, status: "skipped", detail: DETALHE_DA_ORG_PARADA },
        ]);
        expect(handle).not.toHaveBeenCalled();
        expect(fetchEspiao).not.toHaveBeenCalled();
      } finally {
        handle.mockRestore();
        fetchEspiao.mockRestore();
      }
    },
  );

  it("o motor de automações declara que PULA na organização parada", () => {
    expect(automationRulesHandler.naOrgParada).toBe("pula");
  });
});
