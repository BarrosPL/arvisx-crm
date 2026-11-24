/**
 * `comment.received` SAI PELO MESMO CAMINHO DOS OUTROS GATILHOS — E SAI INTEIRO.
 *
 * O comentário do Instagram é gravado e vira evento em
 * `lib/channels/meta-social/comentarios.ts`. Daqui para a frente não existe
 * mecanismo novo: o motor de automações consome o evento e a ação "Avisar outro
 * sistema (webhook)" entrega o corpo. Este arquivo prova as duas pontas que só
 * o gatilho novo tem:
 *
 *   1. as três listas concordam (a fonte única, a assinatura do handler e o
 *      rótulo da tela, com espanhol) — o defeito mudo de esquecer uma delas é
 *      "a regra aparece, o evento acontece e nada roda";
 *   2. o corpo que chega ao sistema de fora tem o texto INTEIRO, o comentário,
 *      a mídia, o autor, o pai, o canal e o modo. O aviso de mensagem corta o
 *      texto em 280 caracteres (`body_preview`); para quem decide a resposta a
 *      partir do aviso, corte é defeito, e aqui ele não pode voltar.
 *
 * O receptor é um servidor HTTP de verdade, em 127.0.0.1: o que se confere é o
 * corpo cru que saiu, não um objeto montado em memória.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({ audit: vi.fn(), criarClientAdmin: vi.fn() }));

vi.mock("@/lib/audit", () => ({ audit: deps.audit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => deps.criarClientAdmin() }));
// O receptor é 127.0.0.1, que os guardas anti-SSRF recusam — e devem. Aqui
// eles não são o assunto.
vi.mock("@/lib/automation/outbound-url", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertSafeOutboundUrl: () => undefined,
}));
vi.mock("@/lib/automation/outbound-ip", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertDestinoResolvidoSeguro: async () => undefined,
}));

import { CURATED_FIELDS } from "@/app/app/webhooks/_components/RuleEditor";
import { TRIGGER_LABELS } from "@/app/app/webhooks/_components/labels";
import { runAutomationForEvent } from "@/lib/automation/engine";
import { automationRulesHandler } from "@/lib/automation/engine.handler";
import { ENTIDADE_DO_COMENTARIO, avisoDoComentario } from "@/lib/channels/meta-social/comentarios";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { DICIONARIO } from "@/lib/i18n/dicionario";
import { ENTIDADE_ESPERADA_POR_GATILHO, TRIGGER_EVENTS } from "@/lib/schemas/webhooks";

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "22222222-2222-4222-8222-222222222222";
const LINHA = "55555555-5555-4555-8555-555555555555";
const CANAL = "44444444-4444-4444-8444-444444444444";

type Linha = Record<string, unknown>;

/** Supabase em memória, no desenho de `gatilhos-de-encerramento-webhook.test.ts`. */
function bancoFalso(tabelas: Record<string, Linha[]>): SupabaseClient {
  return {
    from(tabela: string) {
      const filtros: Array<(l: Linha) => boolean> = [];
      let inserida: Linha | null = null;
      const linhas = (): Linha[] =>
        inserida ? [inserida] : (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
      const consulta = {
        select: () => consulta,
        order: () => consulta,
        update: () => consulta,
        limit: () => consulta,
        gte: () => consulta,
        eq: (coluna: string, valor: unknown) => {
          filtros.push((l) => l[coluna] === valor);
          return consulta;
        },
        in: (coluna: string, valores: unknown[]) => {
          filtros.push((l) => valores.includes(l[coluna]));
          return consulta;
        },
        insert: (payload: Linha) => {
          inserida = { id: randomUUID(), ...payload };
          (tabelas[tabela] ??= []).push(inserida);
          return consulta;
        },
        maybeSingle: async () => ({ data: linhas()[0] ?? null, error: null }),
        single: async () => ({ data: linhas()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
          Promise.resolve({ data: linhas(), error: null }).then(ok, erro),
      };
      return consulta;
    },
  } as unknown as SupabaseClient;
}

const TEXTO_LONGO =
  "Oi! Vi a publicação e fiquei com várias dúvidas, vou escrever tudo aqui de uma vez. ".repeat(24).trim() +
  " FIM-DO-COMENTARIO";

/** O payload é o que `comentarios.ts` emite — montado pela MESMA função, não copiado. */
function payloadDoComentario(texto: string): Linha {
  return {
    ...avisoDoComentario(
      { id: CANAL, rede: "instagram", conta: "17840000000000001", displayName: "instagram · @loja" },
      {
        tipo: "comentario",
        rede: "instagram",
        conta: "17840000000000001",
        commentId: "17865799348089039",
        parentId: "17860000000000777",
        mediaId: "17900000000000123",
        mediaProductType: "REELS",
        adId: null,
        adTitle: null,
        autorId: "232323232",
        autorUsuario: "cliente.exemplo",
        texto,
        aoVivo: false,
        proprio: false,
        quando: "2026-11-20T12:00:00.000Z",
      },
      LINHA,
      "registrar",
    ),
  };
}

function evento(payload: Linha, organizationId = ORG): EventRow {
  return {
    id: randomUUID(),
    organization_id: organizationId,
    event_type: "comment.received",
    entity_kind: ENTIDADE_DO_COMENTARIO,
    entity_id: LINHA,
    payload,
    metadata: { source: "webhook_da_conexao_direta" },
    consumed_by: [],
    attempts: 0,
    created_at: "2026-11-20T12:00:01.000Z",
  };
}

type Corpo = { event: string; delivery_id: string; happened_at: string; data: Record<string, unknown> };
const corpos: Corpo[] = [];
let url = "";
let fecharReceptor: () => Promise<void> = async () => undefined;

beforeAll(async () => {
  const server = createServer((req, res) => {
    const pedacos: Buffer[] = [];
    req.on("data", (c: Buffer) => pedacos.push(c));
    req.on("end", () => {
      corpos.push(JSON.parse(Buffer.concat(pedacos).toString("utf8")) as Corpo);
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/hook`;
  fecharReceptor = () => new Promise((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await fecharReceptor();
});

beforeEach(() => {
  corpos.length = 0;
});

function cenario(regras: Linha[]): SupabaseClient {
  const banco = bancoFalso({ automation_rules: regras, automation_rule_runs: [] });
  deps.criarClientAdmin.mockReturnValue(banco);
  return banco;
}

const regra = (extra: Linha = {}): Linha => ({
  id: randomUUID(),
  organization_id: ORG,
  trigger_event: "comment.received",
  is_active: true,
  name: "Avisa o agente quando chega comentário",
  conditions: [],
  actions: [{ type: "call_webhook", config: { url } }],
  ...extra,
});

describe("comment.received é gatilho de verdade", () => {
  it("a fonte única declara, o handler assina, a tela rotula — e a entidade é a que o emissor grava", () => {
    expect(TRIGGER_EVENTS as readonly string[]).toContain("comment.received");
    expect(ENTIDADE_ESPERADA_POR_GATILHO["comment.received"]).toBe(ENTIDADE_DO_COMENTARIO);
    expect([...automationRulesHandler.events]).toContain("comment.received");
    const rotulo = TRIGGER_LABELS["comment.received"];
    expect(rotulo).toBe("Quando chegar um comentário no Instagram");
    // Espanhol é coluna do dicionário; inglês é catálogo (ainda em construção,
    // por isso lido do arquivo e não por `traduzir`).
    const ingles = JSON.parse(
      readFileSync(join(process.cwd(), "lib/i18n/traducoes/en.json"), "utf8"),
    ) as Record<string, string>;
    expect(DICIONARIO[rotulo]?.es).toBeTruthy();
    expect(ingles[rotulo]).toBeTruthy();
    for (const campo of CURATED_FIELDS["comment.received"]) {
      expect(DICIONARIO[campo.label]?.es, campo.label).toBeTruthy();
      expect(ingles[campo.label], campo.label).toBeTruthy();
    }
  });
});

describe("o aviso que chega ao sistema de fora", () => {
  it("⭐ leva o texto INTEIRO — nenhum corte entre o comentário e o corpo do webhook", async () => {
    expect(TEXTO_LONGO.length).toBeGreaterThan(1800);
    const banco = cenario([regra()]);
    const r = await runAutomationForEvent(banco, evento(payloadDoComentario(TEXTO_LONGO)));
    expect(r.status).toBe("ok");
    expect(corpos).toHaveLength(1);
    expect(corpos[0]!.data.text).toBe(TEXTO_LONGO);
    expect(String(corpos[0]!.data.text).endsWith("FIM-DO-COMENTARIO")).toBe(true);
    // O corte de 280 do aviso de mensagem não existe aqui, nem com outro nome.
    expect(corpos[0]!.data).not.toHaveProperty("body_preview");
  });

  it("⭐ leva comentário, mídia, autor, pai, canal e modo, e a hora do fato", async () => {
    const banco = cenario([regra()]);
    await runAutomationForEvent(banco, evento(payloadDoComentario("Qual o valor?")));
    expect(corpos[0]!.event).toBe("comment.received");
    expect(corpos[0]!.happened_at).toBe("2026-11-20T12:00:01.000Z");
    expect(corpos[0]!.data).toEqual({
      comment_id: "17865799348089039",
      social_comment_id: LINHA,
      parent_comment_id: "17860000000000777",
      media_id: "17900000000000123",
      media_product_type: "REELS",
      ad_id: null,
      ad_title: null,
      ao_vivo: false,
      author: { id: "232323232", username: "cliente.exemplo" },
      text: "Qual o valor?",
      commented_at: "2026-11-20T12:00:00.000Z",
      channel_session_id: CANAL,
      canal: { id: CANAL, rede: "instagram", conta: "17840000000000001", nome: "instagram · @loja" },
      modo: "registrar",
    });
  });

  it("a condição da regra lê o texto do comentário (`event.text`)", async () => {
    const banco = cenario([
      regra({ conditions: [{ field: "event.text", op: "contains", value: "valor" }] }),
    ]);
    await runAutomationForEvent(banco, evento(payloadDoComentario("Que lindo!")));
    expect(corpos).toHaveLength(0);
    await runAutomationForEvent(banco, evento(payloadDoComentario("Qual o valor?")));
    expect(corpos).toHaveLength(1);
  });

  it("⭐ a regra de UMA organização não roda com o comentário de outra", async () => {
    const banco = cenario([regra()]);
    const r = await runAutomationForEvent(banco, evento(payloadDoComentario("Oi"), OUTRA_ORG));
    expect(r).toMatchObject({ status: "ok", detail: "no_rules" });
    expect(corpos).toHaveLength(0);
  });

  it("evento com a entidade errada é descartado pelo guard do motor", async () => {
    const banco = cenario([regra()]);
    const errado = { ...evento(payloadDoComentario("Oi")), entity_kind: "comment" };
    expect(await runAutomationForEvent(banco, errado)).toMatchObject({
      status: "skipped",
      detail: "entity_kind_mismatch",
    });
    expect(corpos).toHaveLength(0);
  });
});
