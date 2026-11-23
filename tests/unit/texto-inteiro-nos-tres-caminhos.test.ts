/**
 * A MENSAGEM DE MAIS DE 280 CARACTERES CHEGA INTEIRA — nos três caminhos por
 * onde o texto sai do banco para quem age sobre ele (revisão de 20/11, item
 * 2.10).
 *
 * O `event_log` guarda só a PRÉVIA (`body_preview`, os primeiros 280 caracteres
 * — `fn_emit_message_event`, e `lib/channels/pos-entrada.ts` na recuperação). A
 * prévia continua existindo: é o que o aviso de mensagem nova lê, e é o que
 * mantém o corpo da conversa fora do `event_log`. O que não pode acontecer é
 * ela ser TUDO o que alguém recebe.
 *
 *   1. o corpo entregue ao WEBHOOK: `data.message.text`, lido da linha na hora
 *      de enviar (`lib/automation/detalhe-do-evento.ts`);
 *   2. o PAYLOAD DA AUTOMAÇÃO: o contexto que as condições e as ações da regra
 *      enxergam (`buildContext`). Aqui o corte existia — a condição "Texto da
 *      mensagem contém" (`event.body_preview`) só via os 280 primeiros, e a
 *      palavra dita depois disso nunca disparava a regra;
 *   3. a LINHA DO TEMPO do negócio: a nota entra e volta inteira.
 */
import { describe, expect, it, vi } from "vitest";

import { bancoEmMemoria } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({ audit: vi.fn(async (..._args: unknown[]) => undefined) }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));

import { executeCallWebhook } from "@/lib/automation/actions/call-webhook";
import { evaluateConditions } from "@/lib/automation/conditions";
import { buildContext } from "@/lib/automation/engine";
import type { ActionCtx } from "@/lib/automation/types";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { lerNotaDoNegocio, registrarNotaDoNegocio } from "@/lib/leads/notas-do-negocio";

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "99999999-9999-4999-8999-999999999999";
const CONTATO = "33333333-3333-4333-8333-333333333333";
const MENSAGEM = "66666666-6666-4666-8666-666666666666";
const CONVERSA = "77777777-7777-4777-8777-777777777777";
const CANAL = "88888888-8888-4888-8888-888888888888";
const LEAD = "22222222-2222-4222-8222-222222222222";

/** ~600 caracteres; a palavra que importa está DEPOIS do caractere 280. */
const INICIO = "Bom dia, tudo bem? Estou escrevendo porque ".padEnd(300, "x ");
const TEXTO_LONGO = `${INICIO} preciso mesmo é da segunda via do boleto, por favor. ${"y ".repeat(120)}FIM-DO-TEXTO`;
const PREVIA = TEXTO_LONGO.slice(0, 280);

type Linha = Record<string, unknown>;

/** Banco de mentira com o `.eq` aplicado de verdade — o filtro de organização conta. */
function bancoFalso(tabelas: Record<string, Linha[]>) {
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
          const achada = (tabelas[tabela] ?? []).find((l) =>
            Object.entries(filtros).every(([c, v]) => l[c] === v),
          );
          return { data: achada ?? null, error: null };
        },
      };
      return q;
    },
  };
  return admin as unknown as ActionCtx["admin"];
}

const linhaDaMensagem = (extra: Linha = {}): Linha => ({
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
  ...extra,
});

/** O evento como o banco o grava: só a prévia. */
function eventoDeMensagem(organizationId = ORG): EventRow {
  return {
    id: "evento-1",
    organization_id: organizationId,
    event_type: "message.received",
    entity_kind: "message",
    entity_id: MENSAGEM,
    payload: {
      message_id: MENSAGEM,
      conversation_id: CONVERSA,
      contact_id: CONTATO,
      direction: "inbound",
      type: "text",
      channel_session_id: CANAL,
      body_preview: PREVIA,
    },
    metadata: {},
    consumed_by: [],
    attempts: 0,
    created_at: "2026-11-20T12:00:00.000Z",
  };
}

describe("o ponto de partida: o evento gravado só tem a prévia", () => {
  it("a prévia tem 280 caracteres e NÃO contém o que o cliente pediu", () => {
    expect(TEXTO_LONGO.length).toBeGreaterThan(280);
    expect(PREVIA).toHaveLength(280);
    expect(PREVIA).not.toContain("segunda via");
    expect(PREVIA).not.toContain("FIM-DO-TEXTO");
  });
});

describe("1. webhook: o corpo entregue leva o texto inteiro", () => {
  it("`data.message.text` é a mensagem inteira; a prévia segue ao lado, com o nome dela", async () => {
    const { createServer } = await import("node:http");
    const recebidos: string[] = [];
    const servidor = createServer((req, res) => {
      const partes: Buffer[] = [];
      req.on("data", (c) => partes.push(c));
      req.on("end", () => {
        recebidos.push(Buffer.concat(partes).toString("utf8"));
        res.statusCode = 200;
        res.end();
      });
    });
    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    try {
      const endereco = servidor.address();
      const porta = typeof endereco === "object" && endereco ? endereco.port : 0;
      const admin = bancoFalso({ messages: [linhaDaMensagem()] });
      const ctx: ActionCtx = {
        admin,
        organizationId: ORG,
        ruleId: "regra-1",
        ruleName: "Avisar o sistema de fora",
        requestId: "req-1",
        actionIndex: 0,
        ruleActions: [{ type: "call_webhook", config: { url: "https://exemplo.invalid/hook" } }],
        event: eventoDeMensagem(),
        context: { contact: { id: CONTATO, name: "Pessoa de Exemplo" } },
      };

      await executeCallWebhook(
        ctx,
        { url: `http://127.0.0.1:${porta}/hook` },
        { skipUrlCheck: true, retryDelaysMs: [1, 1] },
      );

      const corpo = JSON.parse(recebidos[0]!);
      expect(corpo.data.message.text).toBe(TEXTO_LONGO);
      expect(corpo.data.message.text).toContain("FIM-DO-TEXTO");
      expect(corpo.data.body_preview).toBe(PREVIA);
    } finally {
      await new Promise<void>((resolve) => servidor.close(() => resolve()));
    }
  });
});

describe("2. automação: o contexto da regra enxerga o texto inteiro", () => {
  const contem = (palavra: string) => [{ field: "event.body_preview", op: "contains" as const, value: palavra }];

  it("⭐ a condição 'Texto da mensagem contém' casa a palavra dita DEPOIS do caractere 280", async () => {
    const contexto = await buildContext(bancoFalso({ messages: [linhaDaMensagem()] }), eventoDeMensagem());

    expect(evaluateConditions(contem("segunda via"), contexto)).toBe(true);
    expect(evaluateConditions(contem("FIM-DO-TEXTO"), contexto)).toBe(true);
    expect(evaluateConditions(contem("palavra que não foi dita"), contexto)).toBe(false);
  });

  it("o texto inteiro também sai como `message.text`, para a regra que quiser o nome certo", async () => {
    const contexto = await buildContext(bancoFalso({ messages: [linhaDaMensagem()] }), eventoDeMensagem());
    expect((contexto.message as { text?: string }).text).toBe(TEXTO_LONGO);
  });

  it("a linha do evento NÃO é alterada: a prévia gravada continua a prévia", async () => {
    const evento = eventoDeMensagem();
    await buildContext(bancoFalso({ messages: [linhaDaMensagem()] }), evento);
    expect(evento.payload.body_preview).toBe(PREVIA);
  });

  it("⭐ só lê a mensagem da organização DO EVENTO: a de outra empresa não entra no contexto", async () => {
    const contexto = await buildContext(
      bancoFalso({ messages: [linhaDaMensagem({ organization_id: OUTRA_ORG })] }),
      eventoDeMensagem(),
    );
    expect(evaluateConditions(contem("segunda via"), contexto)).toBe(false);
    expect((contexto.event as { body_preview?: string }).body_preview).toBe(PREVIA);
    expect(contexto.message).toBeUndefined();
  });

  it("mensagem que a anonimização já limpou (sem texto): o contexto não inventa texto", async () => {
    const contexto = await buildContext(
      bancoFalso({ messages: [linhaDaMensagem({ body: null })] }),
      eventoDeMensagem(),
    );
    expect(contexto.message).toBeUndefined();
    expect(evaluateConditions(contem("segunda via"), contexto)).toBe(false);
  });

  it("mensagem curta: nada muda", async () => {
    const curta = "quero a segunda via";
    const evento = eventoDeMensagem();
    evento.payload = { ...evento.payload, body_preview: curta };
    const contexto = await buildContext(bancoFalso({ messages: [linhaDaMensagem({ body: curta })] }), evento);
    expect(evaluateConditions(contem("segunda via"), contexto)).toBe(true);
  });
});

describe("3. linha do tempo: a nota entra e volta inteira", () => {
  it("o texto gravado, o que a pessoa lê no card e o que a leitura devolve têm o texto inteiro", async () => {
    const banco = bancoEmMemoria({
      crm_leads: [{ id: LEAD, organization_id: ORG, contact_id: CONTATO, pipeline_id: "funil-1", title: "Negócio" }],
    });
    const supabase = Object.assign(banco.cliente, {
      rpc: async () => ({ data: null, error: null }),
    }) as never;

    const desfecho = await registrarNotaDoNegocio({
      supabase,
      organizationId: ORG,
      lead: { id: LEAD, contact_id: CONTATO },
      texto: TEXTO_LONGO,
      autor: { tipo: "token", id: "token-1", nome: "Integração de fora" },
      ator: { type: "api_token", id: "token-1", role: "agent" },
    });

    expect(desfecho.ok).toBe(true);
    if (!desfecho.ok) return;
    expect(desfecho.nota.text).toBe(TEXTO_LONGO);

    const [linha] = banco.tabelas.crm_lead_activities!;
    expect((linha!.payload as { texto: string }).texto).toBe(TEXTO_LONGO);
    expect(String(linha!.reason)).toContain("FIM-DO-TEXTO");

    const lida = await lerNotaDoNegocio(supabase, ORG, LEAD, desfecho.nota.id);
    expect(lida?.text).toBe(TEXTO_LONGO);
  });
});
