/**
 * CONTATOS DUPLICADOS POR MCP — `crm_find_duplicate_contacts`,
 * `crm_merge_contacts` e `crm_undo_contact_merge`, contra os handlers reais.
 *
 * O banco é o de `tests/helpers/banco-em-memoria.ts`: duas organizações nas
 * mesmas tabelas, com os filtros aplicados de verdade. A detecção é a REAL
 * (`lib/contacts/duplicados.ts`, pela varredura que a tela também usa).
 *
 * ─── O que este arquivo NÃO mede ────────────────────────────────────────────
 * A junção e o desfazer moram no banco (`fn_mesclar_contatos_com_registro` e
 * `fn_desfazer_fusao_de_contatos`, migration 9813). Aqui as duas RPCs são um
 * dublê que só troca a lápide e o registro: o que se mede é a FERRAMENTA (quem
 * pode, o que recusa, o que audita, o que repete sem refazer). O que as funções
 * movem e devolvem de verdade é medido com Postgres em
 * `tests/invariants/fusao-de-contatos-registro-e-desfazer.test.ts`.
 *
 * ─── SABOTAGEM ──────────────────────────────────────────────────────────────
 * - Tirar o `.eq("organization_id", …)` de `varrerContatosDuplicados`: os
 *   contatos da outra organização entram nos grupos e o caso de vazamento cai.
 * - Tirar `soDaOperacao`: o contato pessoal volta à lista.
 * - Tirar `semPapelDeGerente` do handler: a junção roda com papel `agent`.
 * - Tirar o filtro de organização de `lerContatosDaFusao`: o contato da outra
 *   organização chega à RPC.
 */
import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type BancoEmMemoria, type Linha } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({ auditorias: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (entrada: Record<string, unknown>) => {
    h.auditorias.push(entrada);
  }),
}));

const { crmFindDuplicateContacts, crmMergeContacts, crmUndoContactMerge } = await import(
  "@/lib/mcp/tools/contatos-duplicados"
);
const { desfechoDaFusao } = await import("@/lib/contacts/fusao-de-contatos");
const { ensureRole } = await import("@/lib/mcp/auth");
const { ACTIVITY_LABELS, ACTIVITY_LABEL_FALLBACK } = await import("@/lib/leads/activity-vocabulary");
const { AUDIT_ACTIONS } = await import("@/lib/audit/actions");
const { allTools, getToolByName } = await import("@/lib/mcp/tools");
const { catalogEntry, TOOL_CATALOG } = await import("@/lib/mcp/tools/catalog");
const { IDS_DO_HARNESS } = await import("@/lib/mcp/tools/ferramentas-do-harness");
const { PACOTES, entraPorPacote } = await import("@/lib/mcp/tools/pacotes");
const { TETO_TOOLS_POR_AGENTE, ligarPacote, vagasExigidasPeloPacote } = await import(
  "@/lib/mcp/tools/selecao-por-pacote"
);
const { pickToolsFromMcp } = await import("@/lib/ai/runtime/tools");
const { ROLE_RANK } = await import("@/lib/auth/types");
import type { McpContext } from "@/lib/mcp/types";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const TOKEN = "aaaaaaaa-0000-4000-8000-0000000000f1";
const AGENTE = "aaaaaaaa-0000-4000-8000-0000000000a9";

// Organização A
const ANA_13 = "aaaaaaaa-0000-4000-8000-0000000000c1"; // telefone com o nono dígito
const ANA_12 = "aaaaaaaa-0000-4000-8000-0000000000c2"; // o mesmo, sem o nono
const BRUNO = "aaaaaaaa-0000-4000-8000-0000000000c3"; // e-mail igual ao de um contato da B
const CLINICA_1 = "aaaaaaaa-0000-4000-8000-0000000000c4"; // nome parecido
const CLINICA_2 = "aaaaaaaa-0000-4000-8000-0000000000c5";
const PESSOAL = "aaaaaaaa-0000-4000-8000-0000000000c6"; // mesmo e-mail de BRUNO, marcado pessoal
const GRUPO = "aaaaaaaa-0000-4000-8000-0000000000c7";
const JA_JUNTADO = "aaaaaaaa-0000-4000-8000-0000000000c8"; // lápide, juntado pela tela em ANA_13
const ANONIMO = "aaaaaaaa-0000-4000-8000-0000000000c9";
// Organização B
const DE_B_TELEFONE = "bbbbbbbb-0000-4000-8000-0000000000c1"; // o MESMO telefone de ANA_13
const DE_B_EMAIL = "bbbbbbbb-0000-4000-8000-0000000000c2"; // o MESMO e-mail de BRUNO
const DE_B_PAR = "bbbbbbbb-0000-4000-8000-0000000000c3"; // duplicado de DE_B_EMAIL, dentro da B
const INEXISTENTE = "cccccccc-0000-4000-8000-0000000000c1";

const FUNIL_1 = "aaaaaaaa-0000-4000-8000-000000000011";
const FUNIL_2 = "aaaaaaaa-0000-4000-8000-000000000012";

function contato(id: string, org: string, extra: Linha = {}): Linha {
  return {
    id,
    organization_id: org,
    name: null,
    display_name: null,
    address_book_name: null,
    email: null,
    email_normalized: null,
    phone_number: null,
    cpf_hash: "hash-que-nunca-sai",
    cpf_encrypted: "cifra-que-nunca-sai",
    is_merged_into: null,
    is_anonymized: false,
    is_personal: false,
    kind: "person",
    source_metadata: { waha_lid: "123@lid" },
    created_at: "2026-10-01T10:00:00.000Z",
    last_activity_at: null,
    ...extra,
  };
}

let banco: BancoEmMemoria;
let rpc: ReturnType<typeof vi.fn>;
let erroDaRpc: { message: string } | null;

function semear(): BancoEmMemoria {
  return bancoEmMemoria({
    contacts: [
      contato(ANA_13, ORG_A, {
        name: "Ana Souza",
        phone_number: "+5531998966398",
        created_at: "2026-10-01T10:00:00.000Z",
        last_activity_at: "2026-11-10T10:00:00.000Z",
      }),
      contato(ANA_12, ORG_A, {
        display_name: "Ana",
        phone_number: "+553198966398",
        created_at: "2026-10-02T10:00:00.000Z",
      }),
      contato(BRUNO, ORG_A, {
        name: "Bruno Lima",
        email: "bruno@exemplo.com",
        email_normalized: "bruno@exemplo.com",
        created_at: "2026-10-03T10:00:00.000Z",
      }),
      contato(CLINICA_1, ORG_A, { name: "Sorriso Perfeito Pampulha", created_at: "2026-10-04T10:00:00.000Z" }),
      contato(CLINICA_2, ORG_A, { name: "Sorriso Perfeito Pampulha Filial", created_at: "2026-10-05T10:00:00.000Z" }),
      contato(PESSOAL, ORG_A, {
        name: "Mãe",
        email: "bruno@exemplo.com",
        email_normalized: "bruno@exemplo.com",
        is_personal: true,
        created_at: "2026-10-06T10:00:00.000Z",
      }),
      contato(GRUPO, ORG_A, {
        name: "Grupo da família",
        phone_number: "+5531998966398",
        kind: "whatsapp_group",
        created_at: "2026-10-07T10:00:00.000Z",
      }),
      contato(JA_JUNTADO, ORG_A, {
        name: "Ana S.",
        phone_number: "+5531998966398",
        is_merged_into: ANA_13,
        created_at: "2026-09-01T10:00:00.000Z",
      }),
      contato(ANONIMO, ORG_A, { name: "Cliente Anonimizado #1", is_anonymized: true }),
      contato(DE_B_TELEFONE, ORG_B, { name: "Ana Externa", phone_number: "+5531998966398" }),
      contato(DE_B_EMAIL, ORG_B, {
        name: "Bruno de outra empresa",
        email: "bruno@exemplo.com",
        email_normalized: "bruno@exemplo.com",
      }),
      contato(DE_B_PAR, ORG_B, {
        name: "Bruno B.",
        email: "bruno@exemplo.com",
        email_normalized: "bruno@exemplo.com",
        created_at: "2026-10-09T10:00:00.000Z",
      }),
    ],
    crm_leads: [
      { id: "l1", organization_id: ORG_A, contact_id: ANA_13, pipeline_id: FUNIL_1 },
      { id: "l2", organization_id: ORG_A, contact_id: ANA_13, pipeline_id: FUNIL_2 },
      { id: "l3", organization_id: ORG_A, contact_id: ANA_12, pipeline_id: FUNIL_2 },
      // Negócio da outra organização apontando para um id da A: não pode contar.
      { id: "l4", organization_id: ORG_B, contact_id: ANA_12, pipeline_id: FUNIL_1 },
    ],
    merge_queue: [],
    fusoes_de_contatos: [],
    api_tokens: [{ id: TOKEN, organization_id: ORG_A, name: "Sophia" }],
    ai_agents: [{ id: AGENTE, organization_id: ORG_A, name: "Pedro" }],
  });
}

/** Dublê das duas RPCs da 9813: só a lápide e o registro. */
function rpcDeMentira(nome: string, args: Record<string, string>) {
  if (erroDaRpc) return Promise.resolve({ data: null, error: erroDaRpc });
  const contatos = banco.tabelas.contacts!;
  const registros = banco.tabelas.fusoes_de_contatos!;
  if (nome === "fn_mesclar_contatos_com_registro") {
    const sai = contatos.find((c) => c.id === args.p_contato_absorvido)!;
    sai.is_merged_into = args.p_contato_principal;
    const registro = {
      id: `registro-${registros.length + 1}`,
      organization_id: args.p_organization_id,
      contato_principal_id: args.p_contato_principal,
      contato_absorvido_id: args.p_contato_absorvido,
      created_at: `2026-11-20T12:00:0${registros.length}.000Z`,
      desfeito_em: null,
    };
    registros.push(registro);
    return Promise.resolve({
      data: {
        contato_id: args.p_contato_principal,
        contatos_mesclados: [args.p_contato_absorvido],
        nomes_absorvidos: [],
        repontado: { "conversations.contact_id": 1, "crm_leads.contact_id": 1 },
        nao_repontado: {},
        atividades_emitidas: 3,
        registro_id: registro.id,
        sem_registro: {},
        telefones_extras_repetidos_apagados: 0,
      },
      error: null,
    });
  }
  if (nome === "fn_desfazer_fusao_de_contatos") {
    const registro = registros.find(
      (r) => r.id === args.p_registro_id && r.organization_id === args.p_organization_id,
    );
    if (!registro) return Promise.resolve({ data: null, error: { message: "registro_de_fusao_nao_encontrado" } });
    const base = {
      registro_id: registro.id,
      contato_principal_id: registro.contato_principal_id,
      contato_restaurado_id: registro.contato_absorvido_id,
      voltou: { "conversations.contact_id": 1, "crm_leads.contact_id": 1 },
      nao_voltou: {},
      campos_devolvidos: ["email"],
      campos_mantidos: [],
    };
    if (registro.desfeito_em) return Promise.resolve({ data: { ...base, ja_desfeita: true }, error: null });
    registro.desfeito_em = "2026-11-20T13:00:00.000Z";
    contatos.find((c) => c.id === registro.contato_absorvido_id)!.is_merged_into = null;
    return Promise.resolve({ data: { ...base, ja_desfeita: false }, error: null });
  }
  throw new Error(`rpc não prevista: ${nome}`);
}

function ctx(extra: Partial<McpContext> = {}): McpContext {
  return {
    organizationId: ORG_A,
    role: "manager",
    actor: { type: "api_token", id: TOKEN, role: "manager" },
    apiTokenId: TOKEN,
    requestId: "req-1",
    supabase: { ...banco.cliente, rpc },
    ...extra,
  } as unknown as McpContext;
}

type Recusa = { permitido: false; motivo: string; mensagem: string; [k: string]: unknown };
type Grupo = {
  key: string;
  reasons: string[];
  suggested_primary_id: string;
  contacts: Array<Record<string, unknown> & { id: string }>;
};
type Achados = {
  groups: Grupo[];
  total_groups: number;
  has_more: boolean;
  scanned_all: boolean;
  contacts_scanned: number;
};

const buscar = (args: Record<string, unknown> = {}, c: McpContext = ctx()) =>
  crmFindDuplicateContacts.handler({ limit: 20, offset: 0, ...args } as never, c) as Promise<Achados & Recusa>;
const juntar = (args: Record<string, unknown>, c: McpContext = ctx()) =>
  crmMergeContacts.handler(
    { reason: "mesmo telefone, com e sem o nono dígito", ...args } as never,
    c,
  ) as Promise<Record<string, unknown> & Recusa>;
const desfazer = (args: Record<string, unknown>, c: McpContext = ctx()) =>
  crmUndoContactMerge.handler(
    { reason: "juntei a pessoa errada, eram irmãs", ...args } as never,
    c,
  ) as Promise<Record<string, unknown> & Recusa>;

const idsDe = (r: Achados) => r.groups.flatMap((g) => g.contacts.map((c) => c.id));

beforeEach(() => {
  banco = semear();
  erroDaRpc = null;
  rpc = vi.fn(rpcDeMentira);
  h.auditorias.length = 0;
});

describe("crm_find_duplicate_contacts — o que acha", () => {
  it("acha o par do mesmo telefone com e sem o nono dígito, e o par de nome parecido", async () => {
    const r = await buscar();
    const porTelefone = r.groups.find((g) => g.reasons.includes("telefone"))!;
    expect(porTelefone.contacts.map((c) => c.id).sort()).toEqual([ANA_12, ANA_13].sort());
    const porNome = r.groups.find((g) => g.reasons.includes("nome_parecido"))!;
    expect(porNome.contacts.map((c) => c.id).sort()).toEqual([CLINICA_1, CLINICA_2].sort());
    expect(r.total_groups).toBe(2);
    expect(r.scanned_all).toBe(true);
  });

  it("sugere como principal o de atividade mais recente", async () => {
    const r = await buscar({ reason: ["telefone"] });
    expect(r.groups[0]!.suggested_primary_id).toBe(ANA_13);
  });

  it("conta os negócios de cada contato em todos os funis, só os desta organização", async () => {
    const r = await buscar({ reason: ["telefone"] });
    const porId = new Map(r.groups[0]!.contacts.map((c) => [c.id, c.leads_count]));
    expect(porId.get(ANA_13)).toBe(2);
    // l4 é da organização B e aponta para ANA_12: não entra na conta.
    expect(porId.get(ANA_12)).toBe(1);
  });

  it("filtra por motivo e pagina", async () => {
    const soNome = await buscar({ reason: ["nome_parecido"] });
    expect(soNome.groups.map((g) => g.reasons)).toEqual([["nome_parecido"]]);

    const primeira = await buscar({ limit: 1 });
    expect(primeira.groups).toHaveLength(1);
    expect(primeira.has_more).toBe(true);
    const segunda = await buscar({ limit: 1, offset: 1 });
    expect(segunda.groups).toHaveLength(1);
    expect(segunda.has_more).toBe(false);
    expect(segunda.groups[0]!.key).not.toBe(primeira.groups[0]!.key);
  });

  it("lápide e anonimizado não entram", async () => {
    const ids = idsDe(await buscar());
    expect(ids).not.toContain(JA_JUNTADO);
    expect(ids).not.toContain(ANONIMO);
  });

  it("não escreve nada", async () => {
    const antes = JSON.stringify(banco.tabelas);
    await buscar();
    expect(JSON.stringify(banco.tabelas)).toBe(antes);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("⭐ crm_find_duplicate_contacts — duplicado entre organizações nunca aparece", () => {
  it("o contato da outra organização com o MESMO telefone e o MESMO e-mail não entra em grupo nenhum", async () => {
    const r = await buscar();
    const ids = idsDe(r);
    for (const deB of [DE_B_TELEFONE, DE_B_EMAIL, DE_B_PAR]) expect(ids).not.toContain(deB);
    // BRUNO só tem "duplicado" na organização B (e num contato pessoal): não vira grupo.
    expect(ids).not.toContain(BRUNO);
    expect(JSON.stringify(r)).not.toContain("outra empresa");
    expect(JSON.stringify(r)).not.toContain("Externa");
  });

  it("controle: a organização B enxerga o próprio par, e nada da A", async () => {
    const r = await buscar({}, ctx({ organizationId: ORG_B }));
    expect(idsDe(r).sort()).toEqual([DE_B_EMAIL, DE_B_PAR].sort());
    expect(JSON.stringify(r)).not.toContain("Ana Souza");
  });

  it("a ferramenta não tem argumento de organização", () => {
    for (const nome of ["crm_find_duplicate_contacts", "crm_merge_contacts", "crm_undo_contact_merge"]) {
      const campos = Object.keys(getToolByName(nome)!.inputSchema);
      expect(campos.filter((c) => /org/i.test(c)), nome).toEqual([]);
    }
  });
});

describe("crm_find_duplicate_contacts — o que não sai", () => {
  it("contato pessoal e contato de grupo ficam de fora, mesmo com o mesmo e-mail ou telefone", async () => {
    const ids = idsDe(await buscar());
    expect(ids).not.toContain(PESSOAL);
    expect(ids).not.toContain(GRUPO);
  });

  it("cada contato sai só com os campos da busca de contatos: sem CPF e sem o que a ingestão guardou", async () => {
    const r = await buscar();
    for (const c of r.groups.flatMap((g) => g.contacts)) {
      expect(Object.keys(c).sort()).toEqual(
        ["created_at", "email", "id", "last_activity_at", "leads_count", "name", "phone"].sort(),
      );
    }
    const texto = JSON.stringify(r);
    expect(texto).not.toContain("nunca-sai");
    expect(texto).not.toContain("@lid");
  });

  it("num turno de atendimento recusa, sem ler a base", async () => {
    const r = await buscar({}, ctx({ contatoDoTurno: ANA_13 }));
    expect(r).toMatchObject({ permitido: false, motivo: "fora_do_atendimento" });
    expect(banco.consultas.contacts ?? 0).toBe(0);
  });
});

describe("⭐ crm_merge_contacts — recusado sem o papel", () => {
  it.each(["viewer", "agent", "ai_operator"] as const)("papel %s: recusa com código, e nada roda", async (papel) => {
    const r = await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: ANA_12 }, ctx({ role: papel }));
    expect(r).toMatchObject({ permitido: false, motivo: "papel_insuficiente" });
    expect(rpc).not.toHaveBeenCalled();
    expect(h.auditorias).toEqual([]);
    expect(banco.tabelas.contacts!.find((c) => c.id === ANA_12)!.is_merged_into).toBeNull();
  });

  it("o servidor MCP barra antes do handler: a ferramenta declara `manager`", () => {
    const def = getToolByName("crm_merge_contacts")!;
    expect(def.requiresRole).toBe("manager");
    expect(() => ensureRole("agent", def.requiresRole)).toThrow(/insufficient/);
    expect(() => ensureRole("ai_operator", def.requiresRole)).toThrow(/insufficient/);
    expect(() => ensureRole("manager", def.requiresRole)).not.toThrow();
  });

  it("desfazer pede o mesmo papel", async () => {
    expect(getToolByName("crm_undo_contact_merge")!.requiresRole).toBe("manager");
    const r = await desfazer({ merge_record_id: INEXISTENTE }, ctx({ role: "agent" }));
    expect(r).toMatchObject({ permitido: false, motivo: "papel_insuficiente" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("crm_merge_contacts — recusas com código", () => {
  it("⭐ contato de outra organização e contato inexistente recebem a MESMA recusa, e a junção não roda", async () => {
    const deOutra = await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: DE_B_TELEFONE });
    const inexistente = await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: INEXISTENTE });
    expect(deOutra).toMatchObject({ permitido: false, motivo: "contato_nao_encontrado" });
    expect(inexistente).toEqual(deOutra);
    const principalDeOutra = await juntar({ primary_contact_id: DE_B_TELEFONE, duplicate_contact_id: ANA_12 });
    expect(principalDeOutra).toEqual(deOutra);
    expect(rpc).not.toHaveBeenCalled();
    expect(banco.tabelas.contacts!.find((c) => c.id === DE_B_TELEFONE)!.is_merged_into).toBeNull();
  });

  it("contato consigo mesmo", async () => {
    const r = await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: ANA_13.toUpperCase() });
    expect(r).toMatchObject({ permitido: false, motivo: "mesmo_contato" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("contato pessoal, nas duas posições", async () => {
    for (const args of [
      { primary_contact_id: BRUNO, duplicate_contact_id: PESSOAL },
      { primary_contact_id: PESSOAL, duplicate_contact_id: BRUNO },
    ]) {
      expect(await juntar(args)).toMatchObject({ permitido: false, motivo: "contato_pessoal" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("contato de grupo e contato anonimizado", async () => {
    expect(await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: GRUPO })).toMatchObject({
      permitido: false,
      motivo: "contato_de_grupo",
    });
    expect(await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: ANONIMO })).toMatchObject({
      permitido: false,
      motivo: "contato_anonimizado",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("contato já juntado em OUTRO: recusa e diz em qual", async () => {
    const r = await juntar({ primary_contact_id: BRUNO, duplicate_contact_id: JA_JUNTADO });
    expect(r).toMatchObject({ permitido: false, motivo: "contato_ja_unificado", merged_into: ANA_13 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("principal que já é lápide: recusa e aponta o contato vivo", async () => {
    const r = await juntar({ primary_contact_id: JA_JUNTADO, duplicate_contact_id: ANA_12 });
    expect(r).toMatchObject({ permitido: false, motivo: "principal_ja_unificado", merged_into: ANA_13 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("num turno de atendimento recusa", async () => {
    const r = await juntar(
      { primary_contact_id: ANA_13, duplicate_contact_id: ANA_12 },
      ctx({ contatoDoTurno: ANA_13 }),
    );
    expect(r).toMatchObject({ permitido: false, motivo: "fora_do_atendimento" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["fusao_de_contato_pessoal", "contato_pessoal"],
    ["fusao_de_contato_de_grupo", "contato_de_grupo"],
    ["contato_secundario_indisponivel", "contato_indisponivel"],
    ["support_readonly", "somente_leitura"],
  ])("o que o banco levanta (%s) vira recusa legível (%s), sem auditoria de junção", async (doBanco, motivo) => {
    erroDaRpc = { message: `P0001: ${doBanco}` };
    const r = await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: ANA_12 });
    expect(r).toMatchObject({ permitido: false, motivo });
    expect(h.auditorias).toEqual([]);
  });

  it("falha que não é recusa prevista vira `indisponivel`, sem vazar a mensagem do banco", async () => {
    erroDaRpc = { message: 'relation "x" does not exist' };
    const r = await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: ANA_12 });
    expect(r).toMatchObject({ permitido: false, motivo: "indisponivel" });
    expect(JSON.stringify(r)).not.toContain("relation");
  });
});

describe("⭐ crm_merge_contacts — junta, registra e audita com agente e motivo", () => {
  it("chama a função que guarda o registro, com a organização e o token do contexto", async () => {
    const r = await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: ANA_12 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("fn_mesclar_contatos_com_registro", {
      p_organization_id: ORG_A,
      p_contato_principal: ANA_13,
      p_contato_absorvido: ANA_12,
      p_token_id: TOKEN,
    });
    expect(r).toMatchObject({
      merged: true,
      already_merged: false,
      contact_id: ANA_13,
      merged_contact_id: ANA_12,
      merge_record_id: "registro-1",
      moved: { "conversations.contact_id": 1, "crm_leads.contact_id": 1 },
    });
  });

  it("a resposta diz como desfazer e o que o desfazer não devolve", async () => {
    const r = await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: ANA_12 });
    expect(String(r.undo)).toContain("crm_undo_contact_merge");
    expect((r.undo_does_not_restore as string[]).join(" ")).toContain("etiquetas");
  });

  it("audita `contact.merged` com o token como ator, o nome de quem agiu, o motivo e o registro", async () => {
    await juntar({
      primary_contact_id: ANA_13,
      duplicate_contact_id: ANA_12,
      reason: "mesma pessoa: o cliente confirmou os dois números",
    });
    expect(h.auditorias).toHaveLength(1);
    expect(h.auditorias[0]).toMatchObject({
      action: "contact.merged",
      organizationId: ORG_A,
      actorUserId: null,
      actorApiTokenId: TOKEN,
      resourceType: "contact",
      resourceId: ANA_13,
      requestId: "req-1",
      metadata: {
        via: "mcp",
        actor_type: "api_token",
        actor_name: "Sophia",
        reason: "mesma pessoa: o cliente confirmou os dois números",
        merged_contact_ids: [ANA_12],
        merge_record_id: "registro-1",
      },
    });
  });

  it("quando o turno sabe qual agente é, a auditoria leva o agente", async () => {
    await juntar(
      { primary_contact_id: ANA_13, duplicate_contact_id: ANA_12 },
      ctx({ actor: { type: "ai_agent", id: "run-1", agent_id: AGENTE, role: "manager" } as never }),
    );
    expect(h.auditorias[0]!.metadata).toMatchObject({ agent_id: AGENTE, actor_name: "Pedro", actor_type: "ai_agent" });
  });

  it("o motivo é obrigatório no esquema", () => {
    type Conferivel = { safeParse: (valor: unknown) => { success: boolean } };
    const motivoDe = (nome: string) => getToolByName(nome)!.inputSchema.reason as unknown as Conferivel;
    const esquema = motivoDe("crm_merge_contacts");
    expect(esquema.safeParse(undefined).success).toBe(false);
    expect(esquema.safeParse("ok").success).toBe(false);
    expect(esquema.safeParse("mesmo telefone e mesmo e-mail").success).toBe(true);
    expect(motivoDe("crm_undo_contact_merge").safeParse(undefined).success).toBe(false);
  });

  it("repetir o MESMO pedido não junta de novo, não audita de novo e devolve o registro", async () => {
    await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: ANA_12 });
    const repetido = await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: ANA_12 });
    expect(repetido).toMatchObject({ merged: true, already_merged: true, merge_record_id: "registro-1" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(h.auditorias).toHaveLength(1);
  });

  it("repetir sobre uma junção feita pela tela responde que já está junto, sem registro", async () => {
    const r = await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: JA_JUNTADO });
    expect(r).toMatchObject({ merged: true, already_merged: true, merge_record_id: null });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("⭐ crm_undo_contact_merge — a reversão", () => {
  it("desfaz pelo registro: o contato absorvido volta, e a resposta diz o que voltou e o que não volta", async () => {
    const junto = await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: ANA_12 });
    const r = await desfazer({ merge_record_id: junto.merge_record_id });
    expect(rpc).toHaveBeenLastCalledWith("fn_desfazer_fusao_de_contatos", {
      p_organization_id: ORG_A,
      p_registro_id: "registro-1",
      p_token_id: TOKEN,
    });
    expect(r).toMatchObject({
      undone: true,
      already_undone: false,
      contact_id: ANA_13,
      restored_contact_id: ANA_12,
      restored: { "conversations.contact_id": 1, "crm_leads.contact_id": 1 },
      fields_returned: ["email"],
    });
    expect((r.did_not_restore as string[]).join(" ")).toContain("etiquetas");
    expect(banco.tabelas.contacts!.find((c) => c.id === ANA_12)!.is_merged_into).toBeNull();
  });

  it("desfaz pelo contato absorvido, achando o registro em aberto", async () => {
    await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: ANA_12 });
    const r = await desfazer({ merged_contact_id: ANA_12 });
    expect(r).toMatchObject({ undone: true, merge_record_id: "registro-1" });
  });

  it("depois de desfeito, o par volta a aparecer como duplicado e pode ser juntado de novo", async () => {
    const junto = await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: ANA_12 });
    expect(idsDe(await buscar({ reason: ["telefone"] }))).not.toContain(ANA_12);
    await desfazer({ merge_record_id: junto.merge_record_id });
    expect(idsDe(await buscar({ reason: ["telefone"] })).sort()).toEqual([ANA_12, ANA_13].sort());
    const deNovo = await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: ANA_12 });
    expect(deNovo).toMatchObject({ merged: true, already_merged: false, merge_record_id: "registro-2" });
  });

  it("audita `contact.merge_undone` com o ator, o motivo e o registro", async () => {
    const junto = await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: ANA_12 });
    h.auditorias.length = 0;
    await desfazer({ merge_record_id: junto.merge_record_id, reason: "eram duas pessoas: mãe e filha" });
    expect(h.auditorias).toHaveLength(1);
    expect(h.auditorias[0]).toMatchObject({
      action: "contact.merge_undone",
      organizationId: ORG_A,
      actorApiTokenId: TOKEN,
      resourceId: ANA_13,
      metadata: {
        via: "mcp",
        actor_name: "Sophia",
        reason: "eram duas pessoas: mãe e filha",
        merge_record_id: "registro-1",
        restored_contact_id: ANA_12,
      },
    });
  });

  it("repetir não desfaz de novo nem audita de novo", async () => {
    const junto = await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: ANA_12 });
    await desfazer({ merge_record_id: junto.merge_record_id });
    h.auditorias.length = 0;
    const repetido = await desfazer({ merge_record_id: junto.merge_record_id });
    expect(repetido).toMatchObject({ undone: true, already_undone: true });
    expect(h.auditorias).toEqual([]);
  });

  it("junção feita pela tela não tem registro: recusa dizendo isso", async () => {
    const r = await desfazer({ merged_contact_id: JA_JUNTADO });
    expect(r).toMatchObject({ permitido: false, motivo: "fusao_sem_registro", merged_into: ANA_13 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("contato que não está juntado, contato de outra organização e registro de outra organização", async () => {
    expect(await desfazer({ merged_contact_id: BRUNO })).toMatchObject({ motivo: "contato_nao_unificado" });
    expect(await desfazer({ merged_contact_id: DE_B_TELEFONE })).toMatchObject({ motivo: "contato_nao_encontrado" });

    const junto = await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: ANA_12 });
    const daOutra = await desfazer({ merge_record_id: junto.merge_record_id }, ctx({ organizationId: ORG_B }));
    expect(daOutra).toMatchObject({ permitido: false, motivo: "registro_nao_encontrado" });
    expect(banco.tabelas.contacts!.find((c) => c.id === ANA_12)!.is_merged_into).toBe(ANA_13);
  });

  it("exige exatamente um alvo", async () => {
    expect(await desfazer({})).toMatchObject({ motivo: "alvo_invalido" });
    expect(await desfazer({ merge_record_id: INEXISTENTE, merged_contact_id: ANA_12 })).toMatchObject({
      motivo: "alvo_invalido",
    });
  });

  it.each([
    ["conflito_ao_desfazer_fusao", "conflito_ao_desfazer"],
    ["fusao_de_contato_anonimizado", "contato_anonimizado"],
    ["principal_da_fusao_foi_absorvido", "principal_ja_unificado"],
    ["absorvido_fora_desta_fusao", "juncao_alterada"],
  ])("o que não dá para desfazer (%s) é recusado com código (%s), e não fingido", async (doBanco, motivo) => {
    const junto = await juntar({ primary_contact_id: ANA_13, duplicate_contact_id: ANA_12 });
    h.auditorias.length = 0;
    erroDaRpc = { message: doBanco };
    const r = await desfazer({ merge_record_id: junto.merge_record_id });
    expect(r).toMatchObject({ permitido: false, motivo });
    expect(h.auditorias).toEqual([]);
  });
});

describe("a regra é a da tela, sem cópia", () => {
  const RAIZ = process.cwd();
  const fonte = (...p: string[]) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

  it("a rota de duplicados e a ferramenta usam a mesma varredura", () => {
    expect(fonte("app", "api", "v1", "contacts", "duplicates", "route.ts")).toContain("varrerContatosDuplicados(");
    expect(fonte("lib", "mcp", "tools", "contatos-duplicados.ts")).toContain("varrerContatosDuplicados(");
  });

  it("a rota de junção lê os desfechos do mesmo mapa da ferramenta", () => {
    expect(fonte("app", "api", "v1", "contacts", "merge", "route.ts")).toContain("desfechoDaFusao(");
    expect(desfechoDaFusao("insufficient_role")).toMatchObject({ code: "forbidden_role", status: 403 });
    // Mensagem decorada pela camada do meio continua casando.
    expect(desfechoDaFusao("ERROR: contato_principal_indisponivel (P0002)")).toMatchObject({
      code: "not_found",
      status: 404,
    });
    expect(desfechoDaFusao("secundario_repetido")).toMatchObject({ code: "validation_failed", status: 422 });
    expect(desfechoDaFusao("qualquer outra coisa")).toBeNull();
    expect(desfechoDaFusao(null)).toBeNull();
  });

  it("a função que registra chama a `fn_mesclar_contatos` de sempre, e o apêndice é espelho da migration", () => {
    const pasta = path.join(RAIZ, "supabase", "migrations");
    const arquivo = fs.readdirSync(pasta).find((n) => /^\d{14}_9813_[a-z0-9_]+\.sql$/.test(n));
    expect(arquivo, "migration 9813 não encontrada").toBeDefined();
    const migration = fs.readFileSync(path.join(pasta, arquivo!), "utf8");
    expect(migration).toContain("public.fn_mesclar_contatos(");
    expect(fonte("supabase", "baseline.sql").includes(migration)).toBe(true);
  });

  it("as três funções da 9813 são só do servidor", () => {
    const pasta = path.join(RAIZ, "supabase", "migrations");
    const arquivo = fs.readdirSync(pasta).find((n) => /^\d{14}_9813_[a-z0-9_]+\.sql$/.test(n))!;
    const migration = fs.readFileSync(path.join(pasta, arquivo), "utf8");
    for (const assinatura of [
      "fn_colunas_que_apontam_para_contato()",
      "fn_mesclar_contatos_com_registro(uuid, uuid, uuid, uuid)",
      "fn_desfazer_fusao_de_contatos(uuid, uuid, uuid)",
    ]) {
      expect(migration).toContain(
        `revoke execute on function public.${assinatura} from public, anon, authenticated;`,
      );
      expect(migration).toContain(`grant execute on function public.${assinatura} to service_role;`);
    }
    expect(migration).toContain("revoke all on public.fusoes_de_contatos from public, anon, authenticated;");
    expect(migration).not.toMatch(/create policy/i);
  });

  it("o desfazer grava na linha do tempo um tipo que a tela sabe nomear, e a ação existe na auditoria", () => {
    const pasta = path.join(RAIZ, "supabase", "migrations");
    const arquivo = fs.readdirSync(pasta).find((n) => /^\d{14}_9813_[a-z0-9_]+\.sql$/.test(n))!;
    expect(fs.readFileSync(path.join(pasta, arquivo), "utf8")).toContain("'contacts_unmerged'");
    expect(Object.keys(ACTIVITY_LABELS)).toContain("contacts_unmerged");
    expect((ACTIVITY_LABELS as Record<string, string>).contacts_unmerged).not.toBe(ACTIVITY_LABEL_FALLBACK);
    expect(AUDIT_ACTIONS as readonly string[]).toContain("contact.merge_undone");
    expect(AUDIT_ACTIONS as readonly string[]).toContain("contact.merged");
  });
});

describe("⭐ no catálogo: quem alcança e por qual pacote aparece", () => {
  const LEITURA = "crm_find_duplicate_contacts";
  const ESCRITAS = ["crm_merge_contacts", "crm_undo_contact_merge"];
  const CATALOGO = TOOL_CATALOG.map((t) => ({ name: t.name, risco: t.risco, pacotes: t.pacotes }));

  it("a leitura é de qualquer token de agente, e não é só de pessoa", () => {
    expect(getToolByName(LEITURA)).toMatchObject({ category: "read", requiresScope: "mcp:read", requiresRole: "agent" });
    expect(catalogEntry(LEITURA)).toMatchObject({ category: "read", risco: "seguro" });
    expect(catalogEntry(LEITURA)!.apenasHumano).toBeFalsy();
    expect(IDS_DO_HARNESS.has(LEITURA)).toBe(false);
  });

  it("as duas escritas pedem gerente, são críticas e operadas por pessoa", () => {
    for (const nome of ESCRITAS) {
      expect(getToolByName(nome), nome).toMatchObject({
        category: "write",
        requiresScope: "mcp:write",
        requiresRole: "manager",
      });
      expect(catalogEntry(nome), nome).toMatchObject({ category: "write", risco: "critico", apenasHumano: true });
      expect(allTools.map((t) => t.name)).toContain(nome);
    }
    // Desfazer não pede MENOS que juntar.
    expect(ROLE_RANK[getToolByName("crm_undo_contact_merge")!.requiresRole]).toBeGreaterThanOrEqual(
      ROLE_RANK[getToolByName("crm_merge_contacts")!.requiresRole],
    );
  });

  it("nenhum pacote liga as duas escritas: crítica só entra marcada à mão", () => {
    for (const nome of ESCRITAS) expect(entraPorPacote(catalogEntry(nome)!.risco)).toBe(false);
    for (const p of PACOTES) {
      const ligadas = ligarPacote([], CATALOGO as never, p.id);
      for (const nome of ESCRITAS) expect(ligadas, `pacote ${p.id}`).not.toContain(nome);
      expect(ligadas.includes(LEITURA), `pacote ${p.id}`).toBe(p.id === "reter");
    }
  });

  it("`reter` continua cabendo sozinho no teto por agente", () => {
    expect(vagasExigidasPeloPacote([], CATALOGO as never, "reter")).toBeLessThanOrEqual(TETO_TOOLS_POR_AGENTE);
  });

  it("o agente nativo em atendimento não recebe as duas escritas, nem pedindo", () => {
    const ator = { type: "ai_agent", id: "agente-1", role: "ai_operator" };
    const montadas = pickToolsFromMcp({
      supabase: {} as never,
      ctx: {
        organizationId: ORG_A,
        role: "ai_operator",
        actor: ator,
        apiTokenId: "tok-1",
        requestId: "run-1",
        supabase: {} as never,
      } as never,
      auth: {
        organizationId: ORG_A,
        role: "ai_operator",
        actor: ator,
        apiTokenId: "tok-1",
        scopes: ["mcp:read", "mcp:write", "actor:ai_agent", "role:ai_operator"],
      } as never,
      toolIds: [LEITURA, ...ESCRITAS],
      handoffToolEnabled: false,
      handoffSignal: { triggered: false },
    });
    for (const nome of ESCRITAS) expect(montadas).not.toHaveProperty(nome);
    expect(montadas).toHaveProperty(LEITURA);
  });
});
