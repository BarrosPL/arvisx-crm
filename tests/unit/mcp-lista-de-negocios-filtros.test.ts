/**
 * OS FILTROS NOVOS DE `crm_list_leads` — criação, entrada na etapa, último
 * movimento, tag e sem tag —, contra o handler real e `listLeadsHandler`.
 *
 * O banco é o de `tests/helpers/banco-em-memoria.ts`: os filtros são aplicados
 * sobre linhas de verdade, com duas organizações nas mesmas tabelas. O que ele
 * não prova (o SQL do PostgREST para `cs` e `not.cs`) fica para `pnpm test:db`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type BancoEmMemoria, type Linha } from "../helpers/banco-em-memoria";

vi.mock("@/lib/users/nome-do-atendente", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  nomesDosAtendentesCom: vi.fn(
    async (_admin: unknown, _org: string, ids: Array<string | null | undefined>) =>
      new Map(ids.filter((id): id is string => Boolean(id)).map((id) => [id, "Andreia Lima"])),
  ),
}));

const { crmListLeads } = await import("@/lib/mcp/tools/leads");
import type { McpContext } from "@/lib/mcp/types";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const TOKEN = "aaaaaaaa-0000-4000-8000-0000000000f1";
const DONA = "aaaaaaaa-0000-4000-8000-0000000000b1";
const FUNIL = "aaaaaaaa-0000-4000-8000-000000000011";
const OUTRO_FUNIL = "aaaaaaaa-0000-4000-8000-000000000012";
const ETAPA = "aaaaaaaa-0000-4000-8000-000000000021";
const CONTATO = "aaaaaaaa-0000-4000-8000-0000000000c1";
const OUTRO_CONTATO = "aaaaaaaa-0000-4000-8000-0000000000c2";
const CONTATO_PESSOAL = "aaaaaaaa-0000-4000-8000-0000000000c3";
const CONTATO_B = "bbbbbbbb-0000-4000-8000-0000000000c1";

const L1 = "aaaaaaaa-0000-4000-8000-0000000000d1";
const L2 = "aaaaaaaa-0000-4000-8000-0000000000d2";
const L3 = "aaaaaaaa-0000-4000-8000-0000000000d3";
const L4 = "aaaaaaaa-0000-4000-8000-0000000000d4";
const L5 = "aaaaaaaa-0000-4000-8000-0000000000d5";
const L_PESSOAL = "aaaaaaaa-0000-4000-8000-0000000000d6";
const L_B = "bbbbbbbb-0000-4000-8000-0000000000d1";

const dia = (d: string) => `2026-11-${d}T12:00:00.000Z`;
const em = (d: string) => `2026-11-${d}T00:00:00+00:00`;

let banco: BancoEmMemoria;

function negocio(extra: Linha): Linha {
  return {
    organization_id: ORG_A,
    pipeline_id: FUNIL,
    stage_id: ETAPA,
    contact_id: CONTATO,
    status: "open",
    owner_user_id: null,
    tags: [],
    last_activity_at: null,
    title: "Negócio",
    ...extra,
  };
}

function ctx(extra: Partial<McpContext> = {}): McpContext {
  return {
    organizationId: ORG_A,
    role: "agent",
    actor: { type: "api_token", id: TOKEN, role: "agent" },
    apiTokenId: TOKEN,
    requestId: "req-1",
    supabase: banco.cliente as never,
    ...extra,
  };
}

beforeEach(() => {
  banco = bancoEmMemoria({
    contacts: [
      { id: CONTATO, organization_id: ORG_A, is_personal: false },
      { id: OUTRO_CONTATO, organization_id: ORG_A, is_personal: false },
      { id: CONTATO_PESSOAL, organization_id: ORG_A, is_personal: true },
      { id: CONTATO_B, organization_id: ORG_B, is_personal: false },
    ],
    crm_stages: [{ id: ETAPA, organization_id: ORG_A, name: "Proposta" }],
    crm_leads: [
      negocio({ id: L1, created_at: dia("01"), stage_changed_at: dia("01"), last_activity_at: dia("02"), tags: ["vip"], owner_user_id: DONA }),
      // Tag em caixa mista: é como a tela grava no negócio.
      negocio({ id: L2, created_at: dia("05"), stage_changed_at: dia("12"), last_activity_at: dia("15"), tags: ["VIP", "frio"] }),
      // Nunca teve atividade.
      negocio({ id: L3, created_at: dia("06"), stage_changed_at: dia("06"), contact_id: OUTRO_CONTATO }),
      negocio({ id: L4, created_at: dia("14"), stage_changed_at: dia("16"), last_activity_at: dia("18"), tags: ["frio"], status: "won" }),
      negocio({ id: L5, created_at: dia("16"), stage_changed_at: dia("16"), tags: ["a, b"], pipeline_id: OUTRO_FUNIL }),
      negocio({ id: L_PESSOAL, created_at: dia("17"), stage_changed_at: dia("17"), tags: ["vip"], contact_id: CONTATO_PESSOAL }),
      negocio({ id: L_B, organization_id: ORG_B, contact_id: CONTATO_B, created_at: dia("17"), stage_changed_at: dia("17"), tags: ["vip"] }),
    ],
  });
});

type Resposta = Record<string, unknown>;
const listar = (args: Record<string, unknown>, c = ctx()) =>
  crmListLeads.handler({ limit: 20, ...args } as never, c) as Promise<Resposta>;
const ids = (r: Resposta) => (r.leads as Linha[]).map((l) => l.id);

describe("crm_list_leads: filtros de tempo", () => {
  it("sem filtro novo, a listagem é a de antes: da organização, do mais novo para o mais antigo", async () => {
    expect(ids(await listar({}))).toEqual([L5, L4, L3, L2, L1]);
  });

  it("`created_since`: criados a partir do instante", async () => {
    expect(ids(await listar({ created_since: em("10") }))).toEqual([L5, L4]);
  });

  it("`moved_since`: entraram na etapa atual a partir do instante (o recém-criado conta)", async () => {
    expect(ids(await listar({ moved_since: em("11") }))).toEqual([L5, L4, L2]);
  });

  it("⭐ `last_activity_before`: sem movimento desde o instante, inclusive quem NUNCA teve atividade", async () => {
    // L1 parou no dia 02; L3 nunca teve atividade e foi criado antes do dia 10.
    // L5 também nunca teve, mas nasceu depois: não está parado desde o dia 10.
    expect(ids(await listar({ last_activity_before: em("10") }))).toEqual([L3, L1]);
  });

  it("o instante com fuso é convertido antes de comparar", async () => {
    // 09:00 em São Paulo do dia 14 é 12:00 UTC: o instante exato em que L4 nasceu.
    expect(ids(await listar({ created_since: "2026-11-14T09:00:00-03:00" }))).toEqual([L5, L4]);
    expect(ids(await listar({ created_since: "2026-11-14T09:00:01-03:00" }))).toEqual([L5]);
  });

  it("data sem fuso é recusada com o formato certo, sem consultar nada", async () => {
    for (const campo of ["created_since", "moved_since", "last_activity_before"]) {
      const r = await listar({ [campo]: "2026-11-10" });
      expect(r, campo).toMatchObject({ permitido: false, motivo: "data_invalida" });
      expect(String(r.mensagem)).toContain(campo);
    }
    expect(banco.consultas.crm_leads ?? 0).toBe(0);
  });
});

describe("crm_list_leads: filtros de tag", () => {
  it("`tag`: não diferencia caixa nas grafias comuns (revisão 20/11, item 2.27)", async () => {
    expect(ids(await listar({ tag: "VIP" }))).toEqual([L2, L1]);
    expect(ids(await listar({ tag: "vip" }))).toEqual([L2, L1]);
    expect(ids(await listar({ tag: "Vip" }))).toEqual([L2, L1]);
    expect(ids(await listar({ tag: " frio " }))).toEqual([L4, L2]);
  });

  it("`sem_tag`: fora os que têm a tag, em qualquer das duas grafias", async () => {
    expect(ids(await listar({ sem_tag: "VIP" }))).toEqual([L5, L4, L3]);
    expect(ids(await listar({ sem_tag: "frio" }))).toEqual([L5, L3, L1]);
  });

  it("⭐ `sem_tag` em minúsculas não devolve quem tem a tag em MAIÚSCULAS (revisão 20/11, item 2.27)", async () => {
    // O pior caso da revisão: `sem_tag: "vip"` devolvia o negócio com "VIP"
    // como se ele não tivesse a tag.
    expect(ids(await listar({ sem_tag: "vip" }))).toEqual([L5, L4, L3]);
    expect(ids(await listar({ sem_tag: "Vip" }))).toEqual([L5, L4, L3]);
    expect(ids(await listar({ sem_tag: "FRIO" }))).toEqual([L5, L3, L1]);
  });

  it("tag de mais de uma palavra: minúsculas, MAIÚSCULAS, Inicial maiúscula e Iniciais Maiúsculas", async () => {
    const leads = banco.tabelas.crm_leads!;
    leads.find((l) => l.id === L3)!.tags = ["Cliente Vip"];
    leads.find((l) => l.id === L4)!.tags = ["Cliente vip"];
    leads.find((l) => l.id === L5)!.tags = ["CLIENTE VIP"];
    expect(ids(await listar({ tag: "cliente vip" }))).toEqual([L5, L4, L3]);
    expect(ids(await listar({ sem_tag: "cliente vip" }))).toEqual([L2, L1]);
  });

  it("LIMITE documentado: grafia de caixa misturada fora dessas formas só casa se pedida igual", async () => {
    banco.tabelas.crm_leads!.find((l) => l.id === L3)!.tags = ["viP"];
    expect(ids(await listar({ tag: "vip" }))).toEqual([L2, L1]);
    expect(ids(await listar({ tag: "viP" }))).toEqual([L3, L2, L1]);
  });

  it("tag com vírgula é um nome só, não uma lista", async () => {
    expect(ids(await listar({ tag: "a, b" }))).toEqual([L5]);
    expect(ids(await listar({ tag: "a" }))).toEqual([]);
  });

  it("tag em branco é recusada", async () => {
    expect(await listar({ tag: "   " })).toMatchObject({ permitido: false, motivo: "tag_invalida" });
    expect(await listar({ sem_tag: " " })).toMatchObject({ permitido: false, motivo: "tag_invalida" });
  });
});

describe("⭐ filtros combinados, entre si e com os que já existiam", () => {
  it("tempo + tag", async () => {
    expect(ids(await listar({ moved_since: em("11"), sem_tag: "frio" }))).toEqual([L5]);
    expect(ids(await listar({ moved_since: em("11"), tag: "frio" }))).toEqual([L4, L2]);
  });

  it("tempo + tag + status + funil", async () => {
    expect(ids(await listar({ pipeline_id: FUNIL, status: "open", moved_since: em("11"), tag: "frio" }))).toEqual([L2]);
    expect(ids(await listar({ pipeline_id: FUNIL, status: "won", created_since: em("10") }))).toEqual([L4]);
  });

  it("os três de tempo juntos", async () => {
    // criado depois do dia 03, na etapa desde antes de qualquer corte útil, parado desde o dia 16
    expect(
      ids(await listar({ created_since: em("03"), moved_since: em("04"), last_activity_before: em("16") })),
    ).toEqual([L3, L2]);
  });

  it("`tag` e `sem_tag` juntos", async () => {
    expect(ids(await listar({ tag: "frio", sem_tag: "VIP" }))).toEqual([L4]);
  });

  it("dono: filtra por responsável e devolve só o NOME dele", async () => {
    const r = await listar({ owner_user_id: DONA, tag: "vip" });
    expect(ids(r)).toEqual([L1]);
    const lead = (r.leads as Linha[])[0]!;
    expect(lead.owner_user_name).toBe("Andreia Lima");
    expect(lead.stage).toEqual({ id: ETAPA, name: "Proposta" });
    expect(Object.keys(lead).filter((k) => /email|phone|telefone/i.test(k))).toEqual([]);
  });
});

describe("⭐ o cursor continua valendo com os filtros", () => {
  it("página a página, o conjunto filtrado sai inteiro, na ordem, sem repetir", async () => {
    const vistos: unknown[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const r = await listar({ moved_since: em("11"), limit: 1, ...(cursor ? { cursor } : {}) });
      vistos.push(...ids(r));
      if (!r.has_more) {
        expect(r.cursor).toBeNull();
        break;
      }
      cursor = r.cursor as string;
    }
    expect(vistos).toEqual([L5, L4, L2]);
  });

  it("`has_more` descreve o conjunto filtrado, não a organização", async () => {
    const r = await listar({ last_activity_before: em("10"), limit: 2 });
    expect(ids(r)).toEqual([L3, L1]);
    expect(r.has_more).toBe(false);
  });

  it("cursor + parado + sem tag (dois `or` na mesma consulta)", async () => {
    const primeira = await listar({ last_activity_before: em("20"), sem_tag: "nada", limit: 2 });
    expect(ids(primeira)).toEqual([L5, L4]);
    const segunda = await listar({ last_activity_before: em("20"), sem_tag: "nada", limit: 2, cursor: primeira.cursor });
    expect(ids(segunda)).toEqual([L3, L2]);
  });
});

describe("⭐ isolamento", () => {
  it("negócio de outra organização e de contato pessoal não saem por filtro nenhum", async () => {
    for (const filtro of [{ tag: "vip" }, { created_since: em("17") }, { moved_since: em("17") }, { sem_tag: "x" }]) {
      const vistos = ids(await listar(filtro));
      expect(vistos, JSON.stringify(filtro)).not.toContain(L_B);
      expect(vistos, JSON.stringify(filtro)).not.toContain(L_PESSOAL);
    }
  });

  it("no turno de atendimento, os filtros valem dentro dos negócios do cliente da conversa", async () => {
    const turno = ctx({ contatoDoTurno: OUTRO_CONTATO });
    expect(ids(await listar({ last_activity_before: em("20") }, turno))).toEqual([L3]);
    expect(ids(await listar({ tag: "vip" }, turno))).toEqual([]);
  });

  it("não aceita a organização como argumento", () => {
    expect(Object.keys(crmListLeads.inputSchema)).not.toContain("organization_id");
    expect(Object.keys(crmListLeads.inputSchema)).toEqual(
      expect.arrayContaining(["created_since", "moved_since", "last_activity_before", "tag", "sem_tag", "cursor"]),
    );
  });
});
