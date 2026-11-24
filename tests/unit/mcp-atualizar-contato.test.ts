/**
 * `crm_update_contact` — o agente GRAVA direto no cadastro, contra o handler real.
 *
 * O banco é o de `tests/helpers/banco-em-memoria.ts`: duas organizações nas
 * mesmas tabelas, filtros aplicados de verdade. A escrita das colunas é a do
 * `patchContactHandler` da rota (trocado aqui por um dublê que aplica o patch
 * na mesma tabela: o handler em si tem os testes dele). A dos campos
 * personalizados é `fn_contato_preencher_campos_personalizados` (migration
 * 9820), reproduzida aqui pela mesma regra; a função de verdade, com a trava
 * da linha, é medida em
 * `tests/invariants/contato-preencher-campos-personalizados.test.ts`.
 *
 * O que se guarda:
 *
 *  - a organização vem do token; contato de outra empresa é "não existe";
 *  - num turno de atendimento, só o contato da conversa;
 *  - e-mail, data e documento inválidos são recusados com o código do campo;
 *  - o documento NUNCA volta em claro: nem na resposta, nem na auditoria da
 *    chamada, nem na auditoria da mudança;
 *  - SÓ PREENCHE o que está vazio: campo que já tem valor não é trocado, e
 *    volta em `campos_ja_preenchidos` (revisão de 20/11, item 2.3);
 *  - a auditoria leva o agente como autor e só os NOMES dos campos, para todos
 *    os tipos: nenhum valor, novo ou anterior;
 *  - campo personalizado é mesclado no banco, não substituído;
 *  - o outro telefone que não entra recebe uma recusa só, exista ele em outro
 *    cadastro ou não.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type BancoEmMemoria } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  audit: vi.fn(async (_linha: Record<string, unknown>) => undefined),
  cifraDisponivel: true,
  falhaDoPatch: null as null | { code: string; message: string },
  /** O erro que o INSERT em `contact_phones` devolve; `null` = grava. */
  falhaDoTelefone: null as null | { code?: string; message: string },
  /** A mescla dos campos personalizados falha (banco indisponível). */
  falhaDaMescla: false,
  eventos: [] as Array<Record<string, unknown>>,
  mesclas: [] as Array<Record<string, unknown>>,
  conferencia: { recusados: [] } as {
    custom_fields?: Record<string, unknown>;
    recusados: Array<{ campo: string; mensagem: string }>;
  },
}));

vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/mcp/conferencia-de-campos", () => ({
  // A conferência tem os testes dela; aqui ela devolve o que o caso mandar.
  conferirCamposPersonalizados: vi.fn(async () => h.conferencia),
}));
vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/legal/perfil-do-pais", async (original) => {
  const real = await original<{ perfilDoPais: (codigo: "BR") => unknown }>();
  return { ...real, perfilDaOrganizacao: vi.fn(async () => real.perfilDoPais("BR")) };
});
vi.mock("@/app/api/v1/contacts/_handler", async () => {
  const { ApiError } = await import("@/lib/api/types");
  const { hashCpf } = await import("@/lib/contacts/cpf");
  return {
    // Aplica o patch na MESMA tabela, com o filtro de organização do handler real.
    patchContactHandler: vi.fn(
      async (
        supabase: { from: (t: string) => { update: (p: unknown) => { eq: (c: string, v: unknown) => { eq: (c: string, v: unknown) => Promise<unknown> } } } },
        ctx: { organization_id: string; requestId: string },
        contactId: string,
        input: Record<string, unknown>,
      ) => {
        if (h.falhaDoPatch) throw new ApiError(409, h.falhaDoPatch.code as never, undefined, ctx.requestId, h.falhaDoPatch.message);
        const { cpf, ...resto } = input;
        const patch: Record<string, unknown> = { ...resto };
        if (typeof cpf === "string" && h.cifraDisponivel) patch.cpf_hash = hashCpf(cpf);
        if (Object.keys(patch).length === 0) {
          throw new ApiError(400, "invalid_request", undefined, ctx.requestId, "Nenhum campo para atualizar.");
        }
        await supabase.from("contacts").update(patch).eq("organization_id", ctx.organization_id).eq("id", contactId);
        return { id: contactId };
      },
    ),
  };
});

const { crmUpdateContact } = await import("@/lib/mcp/tools/atualizar-contato");
const { patchContactHandler } = await import("@/app/api/v1/contacts/_handler");
const { escritaCabeNoTurno } = await import("@/lib/ai/runtime/escopo-das-escritas");
const { AUDIT_ACTIONS } = await import("@/lib/audit/actions");
const { hashCpf } = await import("@/lib/contacts/cpf");
const { catalogEntry } = await import("@/lib/mcp/tools/catalog");
const { entraPorPacote } = await import("@/lib/mcp/tools/pacotes");
const { getToolByName } = await import("@/lib/mcp/tools");
import type { McpContext } from "@/lib/mcp/types";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const TOKEN_A = "aaaaaaaa-0000-4000-8000-0000000000f1";
const AGENTE = "aaaaaaaa-0000-4000-8000-0000000000a1";
/** Cadastro que já tem nome, e-mail, cidade, UF e dois campos personalizados. */
const CONTATO_A = "aaaaaaaa-0000-4000-8000-0000000000c1";
const CONTATO_A2 = "aaaaaaaa-0000-4000-8000-0000000000c2";
const PESSOAL = "aaaaaaaa-0000-4000-8000-0000000000c3";
const ANONIMIZADO = "aaaaaaaa-0000-4000-8000-0000000000c4";
/** Cadastro recém-chegado do WhatsApp: só o telefone. */
const NOVO = "aaaaaaaa-0000-4000-8000-0000000000c5";
const CONTATO_B = "bbbbbbbb-0000-4000-8000-0000000000c1";

// Dígitos verificadores corretos e incorretos do mesmo número-base.
const CPF_VALIDO = "529.982.247-25";
const CPF_INVALIDO = "529.982.247-26";

let banco: BancoEmMemoria;
let cliente: unknown;

const vazio = (v: unknown) => v === null || v === undefined || v === "";

/** O cliente do teste: o banco em memória, mais as duas RPCs e a falha do telefone. */
function montarCliente(): unknown {
  return {
    ...banco.cliente,
    from: (tabela: string) => {
      const real = banco.cliente.from(tabela) as Record<string, unknown>;
      if (tabela !== "contact_phones" || !h.falhaDoTelefone) return real;
      return { ...real, insert: async () => ({ data: null, error: h.falhaDoTelefone }) };
    },
    rpc: async (nome: string, args: Record<string, unknown>) => {
      if (nome === "emit_event") {
        h.eventos.push(args);
        return { data: null, error: null };
      }
      if (nome !== "fn_contato_preencher_campos_personalizados") throw new Error(`rpc inesperada: ${nome}`);
      h.mesclas.push(args);
      if (h.falhaDaMescla) return { data: null, error: { message: "falha simulada" } };
      // A regra da 9820: só a chave vazia entra; a preenchida com outro valor
      // volta pelo nome; a organização é filtro, e anonimizado não é alcançado.
      const linha = banco.tabelas.contacts!.find(
        (c) => c.organization_id === args.p_org && c.id === args.p_contato && c.is_anonymized !== true,
      );
      if (!linha) return { data: null, error: null };
      const atual = { ...((linha.custom_fields as Record<string, unknown> | null) ?? {}) };
      const gravados: string[] = [];
      const jaPreenchidos: string[] = [];
      for (const [chave, valor] of Object.entries(args.p_campos as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
        if (vazio(valor)) continue;
        if (vazio(atual[chave])) {
          atual[chave] = valor;
          gravados.push(chave);
        } else if (JSON.stringify(atual[chave]) !== JSON.stringify(valor)) {
          jaPreenchidos.push(chave);
        }
      }
      linha.custom_fields = atual;
      return { data: { gravados, ja_preenchidos: jaPreenchidos }, error: null };
    },
  };
}

function ctx(extra: Partial<McpContext> = {}): McpContext {
  return {
    organizationId: ORG_A,
    role: "agent",
    actor: { type: "ai_agent", id: "run-1", role: "agent", agent_id: AGENTE },
    apiTokenId: TOKEN_A,
    requestId: "req-1",
    supabase: cliente as never,
    ...extra,
  };
}

const contato = (id: string, org: string, extra: Record<string, unknown> = {}) => ({
  id,
  organization_id: org,
  is_anonymized: false,
  is_personal: false,
  phone_number: "+5511999990001",
  cpf_hash: null,
  custom_fields: { origem: "indicação", plano: "básico" },
  name: "Maria",
  email: "maria@antigo.test",
  birthdate: null,
  zip_code: null,
  street: null,
  number: null,
  complement: null,
  district: null,
  city: "Campinas",
  state: "SP",
  ...extra,
});

const linha = (id: string) => banco.tabelas.contacts!.find((c) => c.id === id)!;
const chamar = (input: Record<string, unknown>, c: McpContext = ctx()) =>
  crmUpdateContact.handler(input as never, c) as Promise<Record<string, unknown>>;
const metadataDaAuditoria = () =>
  (h.audit.mock.calls[0]![0] as { metadata: Record<string, unknown> }).metadata;

beforeEach(() => {
  h.audit.mockClear();
  vi.mocked(patchContactHandler).mockClear();
  h.cifraDisponivel = true;
  h.falhaDoPatch = null;
  h.falhaDoTelefone = null;
  h.falhaDaMescla = false;
  h.eventos = [];
  h.mesclas = [];
  h.conferencia = { recusados: [] };
  banco = bancoEmMemoria({
    contacts: [
      contato(CONTATO_A, ORG_A),
      contato(CONTATO_A2, ORG_A, { name: "João" }),
      contato(PESSOAL, ORG_A, { is_personal: true }),
      contato(ANONIMIZADO, ORG_A, { is_anonymized: true }),
      contato(NOVO, ORG_A, {
        phone_number: "+5511999990005",
        name: null,
        email: null,
        city: null,
        state: "",
        custom_fields: {},
      }),
      contato(CONTATO_B, ORG_B, { name: "Da outra empresa" }),
    ],
    contact_phones: [],
  });
  cliente = montarCliente();
});

describe("crm_update_contact: grava direto o que o cadastro não tem", () => {
  it("grava os campos informados e diz quais gravou", async () => {
    const r = await chamar({
      contact_id: NOVO,
      name: "Maria Souza",
      email: "maria@novo.test",
      birthdate: "1990-05-17",
      street: "Rua das Flores",
      number: "120",
      city: "Valinhos",
      state: "SP",
    });
    expect(r).toMatchObject({ atualizado: true, contact_id: NOVO, cpf_available: false });
    expect(r.campos_gravados).toEqual(["name", "email", "birthdate", "street", "number", "city", "state"]);
    expect(r.campos_ja_preenchidos).toBeUndefined();
    expect(linha(NOVO)).toMatchObject({
      name: "Maria Souza",
      email: "maria@novo.test",
      birthdate: "1990-05-17",
      city: "Valinhos",
      // Texto em branco conta como vazio.
      state: "SP",
      // O que não veio não muda.
      phone_number: "+5511999990005",
    });
  });

  it("⭐ campo que JÁ TEM valor não é trocado: os vazios entram, os preenchidos voltam pelo nome", async () => {
    const r = await chamar({
      contact_id: CONTATO_A,
      name: "Maria Souza",
      email: "outra@pessoa.test",
      city: "Valinhos",
      birthdate: "1990-05-17",
    });
    expect(r).toMatchObject({ atualizado: true, campos_gravados: ["birthdate"] });
    expect(r.campos_ja_preenchidos).toEqual(["name", "email", "city"]);
    expect(String((r.avisos as string[]).join(" "))).toContain("tarefa");
    // O cadastro continua com o que a equipe (ou a própria pessoa, antes) gravou.
    expect(linha(CONTATO_A)).toMatchObject({
      name: "Maria",
      email: "maria@antigo.test",
      city: "Campinas",
      birthdate: "1990-05-17",
    });
    // A resposta não devolve o valor que estava no cadastro.
    const resposta = JSON.stringify(r);
    expect(resposta).not.toContain("maria@antigo.test");
    expect(resposta).not.toContain("Campinas");
  });

  it("⭐ só campo já preenchido na chamada: nada é gravado, recusa campo_ja_preenchido, sem auditoria", async () => {
    const r = await chamar({ contact_id: CONTATO_A, name: "Outro Nome", email: "outra@pessoa.test" });
    expect(r).toMatchObject({ permitido: false, motivo: "campo_ja_preenchido", campos_ja_preenchidos: ["name", "email"] });
    expect(linha(CONTATO_A)).toMatchObject({ name: "Maria", email: "maria@antigo.test" });
    expect(patchContactHandler).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("⭐ a auditoria leva o agente como autor e só os NOMES dos campos: nenhum valor, novo ou anterior", async () => {
    await chamar({ contact_id: NOVO, email: "maria@novo.test", city: "Valinhos", custom_fields: { renda: "10 mil" } });
    expect(h.audit).toHaveBeenCalledTimes(1);
    const registro = h.audit.mock.calls[0]![0] as { action: string; metadata: Record<string, unknown> };
    expect(registro).toMatchObject({
      action: "contact.updated_by_agent",
      organizationId: ORG_A,
      resourceType: "contact",
      resourceId: NOVO,
      actorUserId: null,
      actorApiTokenId: TOKEN_A,
    });
    expect(registro.metadata).toMatchObject({
      via: "mcp",
      actor_type: "ai_agent",
      agent_id: AGENTE,
      fields: ["email", "city", "custom_fields.renda"],
      custom_fields_changed: ["renda"],
      // Esta ferramenta só preenche o que estava vazio: o anterior é sempre vazio.
      valor_anterior: "vazio",
    });
    // Uniforme: coluna e campo personalizado saem do mesmo jeito, sem valor.
    expect(registro.metadata).not.toHaveProperty("changes");
    const texto = JSON.stringify(registro);
    expect(texto).not.toContain("maria@novo.test");
    expect(texto).not.toContain("Valinhos");
    expect(texto).not.toContain("10 mil");
    expect((AUDIT_ACTIONS as readonly string[]).includes("contact.updated_by_agent")).toBe(true);
  });

  it("valor igual ao que já está no cadastro não é escrita: nada a gravar, sem auditoria", async () => {
    const r = await chamar({ contact_id: CONTATO_A, name: "Maria", city: "Campinas", custom_fields: { plano: "básico" } });
    expect(r).toMatchObject({ permitido: false, motivo: "nada_a_gravar" });
    expect(h.audit).not.toHaveBeenCalled();
    expect(h.mesclas).toHaveLength(0);
  });
});

describe("crm_update_contact: campos personalizados", () => {
  it("⭐ a mescla é do banco: a ferramenta manda SÓ as chaves novas, nunca o mapa inteiro", async () => {
    const r = await chamar({ contact_id: CONTATO_A, custom_fields: { renda: "10 mil" } });
    expect(r.campos_gravados).toEqual(["custom_fields.renda"]);
    expect(linha(CONTATO_A).custom_fields).toEqual({ origem: "indicação", plano: "básico", renda: "10 mil" });
    // O que foi para o banco: a organização do token, o contato e só a chave
    // nova. Mandar o mapa lido antes é o que perdia a escrita concorrente.
    expect(h.mesclas).toEqual([{ p_org: ORG_A, p_contato: CONTATO_A, p_campos: { renda: "10 mil" } }]);
    // Os campos personalizados não passam mais pelo handler, que SUBSTITUI o mapa.
    expect(patchContactHandler).not.toHaveBeenCalled();
  });

  it("⭐ uma chave gravada por outro no meio do caminho não é apagada (a leitura da ferramenta está velha)", async () => {
    // Entre a leitura do contato e a gravação, outro turno (ou a tela) grava
    // `profissao`. Antes, a ferramenta regravava o mapa que tinha lido e a
    // chave sumia.
    const real = (cliente as { rpc: (n: string, a: Record<string, unknown>) => Promise<unknown> }).rpc;
    (cliente as { rpc: unknown }).rpc = async (nome: string, args: Record<string, unknown>) => {
      if (nome === "fn_contato_preencher_campos_personalizados") {
        (linha(CONTATO_A).custom_fields as Record<string, unknown>).profissao = "médica";
      }
      return real(nome, args);
    };
    await chamar({ contact_id: CONTATO_A, custom_fields: { renda: "10 mil" } });
    expect(linha(CONTATO_A).custom_fields).toEqual({
      origem: "indicação",
      plano: "básico",
      profissao: "médica",
      renda: "10 mil",
    });
  });

  it("⭐ chave que já tem OUTRO valor não é trocada, e volta pelo nome", async () => {
    const r = await chamar({ contact_id: CONTATO_A, custom_fields: { plano: "premium", renda: "10 mil" } });
    expect(r).toMatchObject({ atualizado: true, campos_gravados: ["custom_fields.renda"] });
    expect(r.campos_ja_preenchidos).toEqual(["custom_fields.plano"]);
    expect(linha(CONTATO_A).custom_fields).toMatchObject({ plano: "básico", renda: "10 mil" });
    // O valor do campo personalizado não entra na auditoria: só o nome.
    expect(metadataDaAuditoria().custom_fields_changed).toEqual(["renda"]);
    expect(JSON.stringify(metadataDaAuditoria())).not.toContain("premium");
    expect(JSON.stringify(r)).not.toContain("básico");
  });

  it("só os campos personalizados mudaram: o evento contact.updated sai da ferramenta", async () => {
    await chamar({ contact_id: CONTATO_A, custom_fields: { renda: "10 mil" } });
    expect(h.eventos).toHaveLength(1);
    expect(h.eventos[0]).toMatchObject({
      p_event_type: "contact.updated",
      p_entity_kind: "contact",
      p_entity_id: CONTATO_A,
      p_organization_id: ORG_A,
      p_payload: { fields: ["custom_fields"] },
    });
    // Com coluna gravada junto, quem emite é o handler: aqui não sai o segundo.
    h.eventos = [];
    await chamar({ contact_id: NOVO, name: "Ana", custom_fields: { renda: "5 mil" } });
    expect(h.eventos).toHaveLength(0);
  });

  it("⭐ campo personalizado que a pessoa não disse não é gravado, e volta como erro de ensino", async () => {
    h.conferencia = {
      custom_fields: { profissao: "médica" },
      recusados: [{ campo: "renda", mensagem: "Campo «Renda»: a pessoa não informou esse valor." }],
    };
    const r = await chamar({ contact_id: CONTATO_A, custom_fields: { profissao: "médica", renda: "10 mil" } });
    expect(r).toMatchObject({ atualizado: true, campos_gravados: ["custom_fields.profissao"] });
    expect(r.campos_nao_gravados).toEqual(h.conferencia.recusados);
    expect(String(r.erro_de_ensino)).toContain("Renda");
    expect(linha(CONTATO_A).custom_fields).toEqual({ origem: "indicação", plano: "básico", profissao: "médica" });
    // Todos recusados: nada é gravado, e a recusa diz por quê.
    h.conferencia = { custom_fields: {}, recusados: [{ campo: "renda", mensagem: "x" }] };
    expect(await chamar({ contact_id: CONTATO_A, custom_fields: { renda: "10 mil" } })).toMatchObject({
      permitido: false,
      motivo: "campo_nao_conferido",
    });
  });

  it("a mescla falha: a resposta diz que os campos personalizados não entraram, e o que entrou é só o resto", async () => {
    h.falhaDaMescla = true;
    const so = await chamar({ contact_id: CONTATO_A, custom_fields: { renda: "10 mil" } });
    expect(so).toMatchObject({ permitido: false, motivo: "indisponivel" });
    expect(h.audit).not.toHaveBeenCalled();
    const comColuna = await chamar({ contact_id: NOVO, name: "Ana", custom_fields: { renda: "10 mil" } });
    expect(comColuna).toMatchObject({ atualizado: true, campos_gravados: ["name"] });
    expect(String((comColuna.avisos as string[]).join(" "))).toContain("NÃO foram gravados");
  });
});

describe("crm_update_contact: o outro telefone", () => {
  it("entra como telefone extra, na forma canônica; o principal não muda", async () => {
    const r = await chamar({ contact_id: CONTATO_A, secondary_phone: "(11) 98888-7777" });
    expect(r.campos_gravados).toEqual(["secondary_phone"]);
    expect(banco.tabelas.contact_phones).toHaveLength(1);
    expect(banco.tabelas.contact_phones![0]).toMatchObject({
      organization_id: ORG_A,
      contact_id: CONTATO_A,
      origem: "manual",
    });
    expect(banco.tabelas.contact_phones![0]!.phone_number).toBe("+5511988887777");
    expect(linha(CONTATO_A).phone_number).toBe("+5511999990001");
    // O número não entra na auditoria: só o nome do campo.
    expect(JSON.stringify(metadataDaAuditoria())).not.toContain("988887777");
  });

  it("o telefone principal repetido como extra é recusado", async () => {
    const r = await chamar({ contact_id: CONTATO_A, secondary_phone: "+55 11 99999-0001" });
    expect(r).toMatchObject({ permitido: false, motivo: "telefone_igual_ao_principal" });
    expect(banco.tabelas.contact_phones).toHaveLength(0);
  });

  it("o extra que ESTE contato já tem não é escrita, e não vira recusa de telefone", async () => {
    await chamar({ contact_id: CONTATO_A, secondary_phone: "(11) 98888-7777" });
    h.audit.mockClear();
    const r = await chamar({ contact_id: CONTATO_A, secondary_phone: "11 98888 7777" });
    expect(r).toMatchObject({ permitido: false, motivo: "nada_a_gravar" });
    expect(banco.tabelas.contact_phones).toHaveLength(1);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("⭐ número que é de OUTRO contato e falha qualquer do banco recebem a MESMA recusa (não é oráculo de existência)", async () => {
    h.falhaDoTelefone = { code: "23505", message: "duplicate key value violates unique constraint" };
    const deOutro = await chamar({ contact_id: CONTATO_A, secondary_phone: "(11) 97777-6666" });
    h.falhaDoTelefone = { message: "connection reset" };
    const falhaQualquer = await chamar({ contact_id: CONTATO_A, secondary_phone: "(11) 97777-6666" });
    expect(deOutro).toMatchObject({ permitido: false, motivo: "telefone_nao_gravado" });
    expect(falhaQualquer).toEqual(deOutro);
    const texto = JSON.stringify(deOutro).toLowerCase();
    expect(texto).not.toContain("outro contato");
    expect(texto).not.toContain("já está");
    expect(texto).not.toContain("cadastrado");
    // Junto com outro campo: o campo entra, e o aviso do telefone é o mesmo nos dois casos.
    h.falhaDoTelefone = { code: "23505", message: "duplicate" };
    const a = await chamar({ contact_id: CONTATO_A, birthdate: "1990-05-17", secondary_phone: "(11) 97777-6666" });
    linha(CONTATO_A).birthdate = null;
    h.falhaDoTelefone = { message: "timeout" };
    const b = await chamar({ contact_id: CONTATO_A, birthdate: "1990-05-17", secondary_phone: "(11) 97777-6666" });
    expect(a).toMatchObject({ atualizado: true, campos_gravados: ["birthdate"] });
    expect(b).toEqual(a);
  });
});

describe("crm_update_contact: o que ela recusa", () => {
  it.each([
    ["email_invalido", { email: "maria-sem-arroba" }],
    ["data_invalida", { birthdate: "17/05/1990" }],
    ["data_invalida", { birthdate: "1990-02-31" }],
    ["data_invalida", { birthdate: "2999-01-01" }],
    ["telefone_invalido", { secondary_phone: "123" }],
    ["documento_invalido", { cpf: CPF_INVALIDO }],
    ["documento_invalido", { cpf: "111.111.111-11" }],
  ])("%s", async (motivo, campos) => {
    const antes = { ...linha(NOVO) };
    const r = await chamar({ contact_id: NOVO, ...campos });
    expect(r).toMatchObject({ permitido: false, motivo });
    // Recusa não grava nada, nem audita.
    expect(linha(NOVO)).toEqual(antes);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("campo inválido derruba a chamada inteira: o campo bom ao lado não é gravado pela metade", async () => {
    const r = await chamar({ contact_id: NOVO, name: "Maria Souza", cpf: CPF_INVALIDO });
    expect(r).toMatchObject({ permitido: false, motivo: "documento_invalido" });
    expect(linha(NOVO).name).toBeNull();
  });

  it("⭐ contato de outra organização é 'não existe', e nada é escrito nele", async () => {
    const antes = { ...linha(CONTATO_B) };
    const r = await chamar({ contact_id: CONTATO_B, birthdate: "1990-05-17", custom_fields: { renda: "x" } });
    expect(r).toMatchObject({ permitido: false, motivo: "contato_nao_encontrado" });
    expect(linha(CONTATO_B)).toEqual(antes);
    expect(h.mesclas).toHaveLength(0);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("⭐ num turno de atendimento, só o contato da conversa", async () => {
    const turno = ctx({ contatoDoTurno: CONTATO_A });
    const doOutro = await chamar({ contact_id: CONTATO_A2, birthdate: "1990-05-17" }, turno);
    const inexistente = await chamar({ contact_id: CONTATO_B, birthdate: "1990-05-17" }, turno);
    // Outro cliente e contato de outra empresa recebem a MESMA recusa.
    expect(doOutro).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
    expect(inexistente).toEqual(doOutro);
    expect(linha(CONTATO_A2).birthdate).toBeNull();
    expect((await chamar({ contact_id: CONTATO_A, birthdate: "1990-05-17" }, turno)).atualizado).toBe(true);
  });

  it("a ponte do turno conhece a ferramenta: contato de outro cliente não passa", async () => {
    const supabase = banco.cliente as never;
    expect(
      await escritaCabeNoTurno(supabase, ORG_A, CONTATO_A, "crm_update_contact", { contact_id: CONTATO_A }),
    ).toEqual({ permitido: true });
    expect(
      await escritaCabeNoTurno(supabase, ORG_A, CONTATO_A, "crm_update_contact", { contact_id: CONTATO_A2 }),
    ).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
  });

  it("contato pessoal e contato anonimizado ficam fora", async () => {
    expect(await chamar({ contact_id: PESSOAL, name: "X" })).toMatchObject({ motivo: "contato_pessoal" });
    expect(await chamar({ contact_id: ANONIMIZADO, name: "X" })).toMatchObject({ motivo: "contato_anonimizado" });
  });

  it("o conflito do banco (e-mail que já é de outro contato) volta como recusa com o código", async () => {
    h.falhaDoPatch = { code: "state_conflict", message: "Este e-mail já é de outro contato." };
    const r = await chamar({ contact_id: NOVO, email: "joao@outro.test" });
    expect(r).toMatchObject({ permitido: false, motivo: "state_conflict" });
    expect(h.audit).not.toHaveBeenCalled();
  });
});

describe("crm_update_contact: o documento nunca volta em claro", () => {
  const digitos = CPF_VALIDO.replace(/\D/g, "");

  it("⭐ documento válido é gravado, e a resposta só diz que o cadastro tem um", async () => {
    const r = await chamar({ contact_id: CONTATO_A, cpf: CPF_VALIDO });
    expect(r).toMatchObject({ atualizado: true, campos_gravados: ["cpf"], cpf_available: true });
    expect(linha(CONTATO_A).cpf_hash).toBe(hashCpf(CPF_VALIDO));
    const resposta = JSON.stringify(r);
    expect(resposta).not.toContain(CPF_VALIDO);
    expect(resposta).not.toContain(digitos);
  });

  it("⭐ a auditoria da mudança não leva o documento: só o nome do campo", async () => {
    await chamar({ contact_id: CONTATO_A, cpf: CPF_VALIDO });
    const registro = JSON.stringify(h.audit.mock.calls[0]![0]);
    expect(registro).not.toContain(digitos);
    expect(registro).not.toContain(CPF_VALIDO);
    expect(metadataDaAuditoria()).toMatchObject({ fields: ["cpf"], valor_anterior: "vazio" });
    expect(metadataDaAuditoria()).not.toHaveProperty("changes");
  });

  it("⭐ cadastro que já tem OUTRO documento: não é trocado, e nada do antigo nem do novo aparece", async () => {
    linha(CONTATO_A).cpf_hash = hashCpf("390.533.447-05");
    const r = await chamar({ contact_id: CONTATO_A, cpf: CPF_VALIDO });
    expect(r).toMatchObject({ permitido: false, motivo: "campo_ja_preenchido", campos_ja_preenchidos: ["cpf"] });
    expect(linha(CONTATO_A).cpf_hash).toBe(hashCpf("390.533.447-05"));
    const resposta = JSON.stringify(r);
    expect(resposta).not.toContain(digitos);
    expect(resposta).not.toContain("39053344705");
    expect(patchContactHandler).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("⭐ a auditoria da CHAMADA recebe os argumentos sem o documento", () => {
    const limpos = crmUpdateContact.redigirParaAuditoria!({ contact_id: CONTATO_A, cpf: CPF_VALIDO, name: "Maria" });
    expect(limpos).toEqual({ contact_id: CONTATO_A, cpf: "[protegido]", name: "Maria" });
    // Sem documento nos argumentos, nada é acrescentado.
    expect(crmUpdateContact.redigirParaAuditoria!({ contact_id: CONTATO_A })).toEqual({ contact_id: CONTATO_A });
  });

  it("sem a cifra disponível, o documento NÃO é gravado e a resposta diz isso", async () => {
    h.cifraDisponivel = false;
    const so = await chamar({ contact_id: CONTATO_A, cpf: CPF_VALIDO });
    expect(so).toMatchObject({ permitido: false, motivo: "documento_nao_gravado" });
    expect(linha(CONTATO_A).cpf_hash).toBeNull();
    // Com outro campo junto: o outro entra, e o aviso vai na resposta.
    const comData = await chamar({ contact_id: CONTATO_A, cpf: CPF_VALIDO, birthdate: "1990-05-17" });
    expect(comData).toMatchObject({ atualizado: true, campos_gravados: ["birthdate"], cpf_available: false });
    expect(String((comData.avisos as string[])[0])).toContain("NÃO foi gravado");
  });

  it("o mesmo documento que já está no cadastro não é reescrito", async () => {
    linha(CONTATO_A).cpf_hash = hashCpf(CPF_VALIDO);
    expect(await chamar({ contact_id: CONTATO_A, cpf: CPF_VALIDO })).toMatchObject({ motivo: "nada_a_gravar" });
  });
});

describe("crm_update_contact: no catálogo", () => {
  it("é escrita ao alcance do agente, altera dados e não fala com o cliente", () => {
    const tool = getToolByName("crm_update_contact")!;
    expect(tool).toMatchObject({ category: "write", requiresRole: "agent", requiresScope: "mcp:write" });
    const entrada = catalogEntry("crm_update_contact")!;
    expect(entrada.risco).toBe("atencao");
    expect(entraPorPacote(entrada.risco)).toBe(true);
    // Nenhum argumento escolhe a organização.
    expect(Object.keys(tool.inputSchema)).not.toContain("organization_id");
  });
});
