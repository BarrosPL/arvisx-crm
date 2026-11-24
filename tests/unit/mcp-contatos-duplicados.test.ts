/**
 * CONTATOS DUPLICADOS POR MCP — `crm_find_duplicate_contacts`, contra o handler
 * real, e a prova de que `crm_merge_contacts` e `crm_undo_contact_merge` NÃO
 * existem por MCP.
 *
 * O banco é o de `tests/helpers/banco-em-memoria.ts`: duas organizações nas
 * mesmas tabelas, com os filtros aplicados de verdade. A detecção é a REAL
 * (`lib/contacts/duplicados.ts`, pela varredura que a tela também usa).
 *
 * ─── Juntar e desfazer saíram (revisão 20/11, item 1.2, Opção A) ────────────
 * As duas ferramentas existiam neste PR e foram retiradas por decisão do dono
 * (23/11): o servidor MCP não aplica `apenasHumano`, e um token marcado como
 * "tratado como gerente" unia contatos sem autorização registrada. Os casos que
 * mediam os dois handlers saíram com eles; no lugar, o bloco "juntar e desfazer
 * não existem por MCP" reprova se alguém as registrar de volta. A migration
 * 9813 e as funções do banco ficaram, e continuam medidas com Postgres em
 * `tests/invariants/fusao-de-contatos-registro-e-desfazer.test.ts`.
 *
 * ─── SABOTAGEM ──────────────────────────────────────────────────────────────
 * - Tirar o `.eq("organization_id", …)` de `varrerContatosDuplicados`: os
 *   contatos da outra organização entram nos grupos e o caso de vazamento cai.
 * - Tirar `soDaOperacao`: o contato pessoal volta à lista.
 * - Registrar `crm_merge_contacts` em `lib/mcp/tools/index.ts` ou no catálogo:
 *   o bloco da ausência cai.
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

const moduloDaFerramenta = await import("@/lib/mcp/tools/contatos-duplicados");
const { crmFindDuplicateContacts } = moduloDaFerramenta;
const { desfechoDaFusao } = await import("@/lib/contacts/fusao-de-contatos");
const { ACTIVITY_LABELS, ACTIVITY_LABEL_FALLBACK } = await import("@/lib/leads/activity-vocabulary");
const { AUDIT_ACTIONS } = await import("@/lib/audit/actions");
const { allTools, getToolByName } = await import("@/lib/mcp/tools");
const { catalogEntry, TOOL_CATALOG } = await import("@/lib/mcp/tools/catalog");
const { IDS_DO_HARNESS } = await import("@/lib/mcp/tools/ferramentas-do-harness");
const { PACOTES } = await import("@/lib/mcp/tools/pacotes");
const { TETO_TOOLS_POR_AGENTE, ligarPacote, vagasExigidasPeloPacote } = await import(
  "@/lib/mcp/tools/selecao-por-pacote"
);
const { pickToolsFromMcp } = await import("@/lib/ai/runtime/tools");
const { ALVO_DE_FUNIL } = await import("@/lib/leads/escopo-de-funil");
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

/** A leitura não chama função do banco: qualquer RPC aqui é defeito. */
function rpcDeMentira(nome: string): never {
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
const idsDe = (r: Achados) => r.groups.flatMap((g) => g.contacts.map((c) => c.id));

beforeEach(() => {
  banco = semear();
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
    const campos = Object.keys(getToolByName("crm_find_duplicate_contacts")!.inputSchema);
    expect(campos.filter((c) => /org/i.test(c))).toEqual([]);
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

  // O nome da agenda do celular é o rótulo que alguém da empresa escreveu
  // ("Maria caloteira"). A varredura o COMPARA, como a tela; a ferramenta nunca o
  // DEVOLVE: quem lê a resposta é um agente, e agente fala com o cliente
  // (tests/unit/nome-da-agenda-nunca-vai-ao-cliente.test.ts).
  it("⭐ o nome salvo na agenda do celular serve para achar o par e não sai na resposta", async () => {
    const SO_AGENDA_1 = "aaaaaaaa-0000-4000-8000-0000000000d1";
    const SO_AGENDA_2 = "aaaaaaaa-0000-4000-8000-0000000000d2";
    banco.tabelas.contacts!.push(
      contato(SO_AGENDA_1, ORG_A, {
        address_book_name: "Oficina Caloteira Betim",
        phone_number: "+5531911110001",
        created_at: "2026-10-20T10:00:00.000Z",
      }),
      contato(SO_AGENDA_2, ORG_A, {
        address_book_name: "Oficina Caloteira Betim Filial",
        phone_number: "+5531922220002",
        created_at: "2026-10-21T10:00:00.000Z",
      }),
    );

    const r = await buscar({ reason: ["nome_parecido"] });
    const par = r.groups.find((g) => g.contacts.some((c) => c.id === SO_AGENDA_1))!;
    // Controle: sem ler a agenda o par não existiria, e o caso passaria vazio.
    expect(par.contacts.map((c) => c.id).sort()).toEqual([SO_AGENDA_1, SO_AGENDA_2].sort());
    for (const c of par.contacts) expect(c.name).toBeNull();
    expect(JSON.stringify(r)).not.toContain("Caloteira");
    expect(JSON.stringify(r)).not.toContain("address_book_name");
  });
});

describe("a regra é a da tela, sem cópia", () => {
  const RAIZ = process.cwd();
  const fonte = (...p: string[]) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

  it("a rota de duplicados e a ferramenta usam a mesma varredura", () => {
    expect(fonte("app", "api", "v1", "contacts", "duplicates", "route.ts")).toContain("varrerContatosDuplicados(");
    expect(fonte("lib", "mcp", "tools", "contatos-duplicados.ts")).toContain("varrerContatosDuplicados(");
  });

  it("a rota de junção lê os desfechos do mapa de `lib/contacts/fusao-de-contatos.ts`", () => {
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
  const CATALOGO = TOOL_CATALOG.map((t) => ({ name: t.name, risco: t.risco, pacotes: t.pacotes }));

  it("a leitura é de qualquer token de agente, e não é só de pessoa", () => {
    expect(getToolByName(LEITURA)).toMatchObject({ category: "read", requiresScope: "mcp:read", requiresRole: "agent" });
    expect(catalogEntry(LEITURA)).toMatchObject({ category: "read", risco: "seguro" });
    expect(catalogEntry(LEITURA)!.apenasHumano).toBeFalsy();
    expect(IDS_DO_HARNESS.has(LEITURA)).toBe(false);
  });

  it("só `reter` liga a leitura", () => {
    for (const p of PACOTES) {
      const ligadas = ligarPacote([], CATALOGO as never, p.id);
      expect(ligadas.includes(LEITURA), `pacote ${p.id}`).toBe(p.id === "reter");
    }
  });

  it("`reter` continua cabendo sozinho no teto por agente", () => {
    expect(vagasExigidasPeloPacote([], CATALOGO as never, "reter")).toBeLessThanOrEqual(TETO_TOOLS_POR_AGENTE);
  });
});

describe("⭐ juntar e desfazer não existem por MCP (revisão 20/11, item 1.2, Opção A)", () => {
  const RETIRADAS = ["crm_merge_contacts", "crm_undo_contact_merge"];
  const RAIZ = process.cwd();
  const fonte = (...p: string[]) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

  it("o servidor MCP não as registra: `allTools` é a lista que ele serve", () => {
    // `lib/mcp/server.ts` monta o servidor a partir de `allTools`, e a chamada
    // por nome passa por `getToolByName`.
    expect(fonte("lib", "mcp", "server.ts")).toMatch(/allTools|getToolByName/);
    const nomes = allTools.map((t) => t.name);
    for (const nome of RETIRADAS) {
      expect(nomes, nome).not.toContain(nome);
      expect(getToolByName(nome), nome).toBeUndefined();
    }
    expect(nomes).toContain("crm_find_duplicate_contacts");
  });

  it("o módulo da ferramenta só exporta a leitura", () => {
    expect(Object.keys(moduloDaFerramenta)).toEqual(["crmFindDuplicateContacts"]);
  });

  it("o catálogo (a tela 'O que o agente pode fazer') não as oferece, em pacote nenhum", () => {
    for (const nome of RETIRADAS) {
      expect(catalogEntry(nome), nome).toBeUndefined();
      expect(TOOL_CATALOG.map((t) => t.name), nome).not.toContain(nome);
      expect(Object.keys(ALVO_DE_FUNIL), nome).not.toContain(nome);
    }
    for (const p of PACOTES) {
      const ligadas = ligarPacote([], TOOL_CATALOG as never, p.id);
      for (const nome of RETIRADAS) expect(ligadas, `pacote ${p.id}`).not.toContain(nome);
    }
  });

  it("nem pedindo pelo nome: o agente nativo e o token gerente não as recebem", () => {
    for (const papel of ["ai_operator", "manager", "admin"]) {
      const ator = { type: papel === "ai_operator" ? "ai_agent" : "api_token", id: "ator-1", role: papel };
      const montadas = pickToolsFromMcp({
        supabase: {} as never,
        ctx: {
          organizationId: ORG_A,
          role: papel,
          actor: ator,
          apiTokenId: "tok-1",
          requestId: "run-1",
          supabase: {} as never,
        } as never,
        auth: {
          organizationId: ORG_A,
          role: papel,
          actor: ator,
          apiTokenId: "tok-1",
          scopes: ["mcp:read", "mcp:write", `role:${papel}`],
        } as never,
        toolIds: ["crm_find_duplicate_contacts", ...RETIRADAS],
        handoffToolEnabled: false,
        handoffSignal: { triggered: false },
      });
      for (const nome of RETIRADAS) expect(montadas, `${papel}: ${nome}`).not.toHaveProperty(nome);
      expect(montadas, papel).toHaveProperty("crm_find_duplicate_contacts");
    }
  });

  it("as funções do banco ficaram (migration 9813), sem porta por MCP", () => {
    const pasta = path.join(RAIZ, "supabase", "migrations");
    const arquivo = fs.readdirSync(pasta).find((n) => /^\d{14}_9813_[a-z0-9_]+\.sql$/.test(n));
    expect(arquivo, "migration 9813 não encontrada").toBeDefined();
    const ferramentas = fonte("lib", "mcp", "tools", "contatos-duplicados.ts");
    for (const funcao of ["fn_mesclar_contatos_com_registro", "fn_desfazer_fusao_de_contatos"]) {
      expect(fs.readFileSync(path.join(pasta, arquivo!), "utf8")).toContain(`public.${funcao}(`);
    }
    expect(ferramentas).not.toMatch(/\.rpc\(/);
    expect(ferramentas).not.toContain("mesclarContatosComRegistro");
    expect(ferramentas).not.toContain("desfazerFusaoDeContatos");
  });
});
