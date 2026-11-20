/**
 * `crm_update_contact` — o agente GRAVA direto no cadastro, contra o handler real.
 *
 * O banco é o de `tests/helpers/banco-em-memoria.ts`: duas organizações nas
 * mesmas tabelas, filtros aplicados de verdade. A escrita em `contacts` é a do
 * `patchContactHandler` da rota (trocado aqui por um dublê que aplica o patch
 * na mesma tabela: o handler em si tem os testes dele). O que se guarda:
 *
 *  - a organização vem do token; contato de outra empresa é "não existe";
 *  - num turno de atendimento, só o contato da conversa;
 *  - e-mail, data e documento inválidos são recusados com o código do campo;
 *  - o documento NUNCA volta em claro: nem na resposta, nem na auditoria da
 *    chamada, nem na auditoria da mudança;
 *  - a auditoria leva o agente como autor e o valor ANTERIOR de cada campo;
 *  - campo personalizado é mesclado, não substituído.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type BancoEmMemoria } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  audit: vi.fn(async (_linha: Record<string, unknown>) => undefined),
  cifraDisponivel: true,
  falhaDoPatch: null as null | { code: string; message: string },
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
const CONTATO_A = "aaaaaaaa-0000-4000-8000-0000000000c1";
const CONTATO_A2 = "aaaaaaaa-0000-4000-8000-0000000000c2";
const PESSOAL = "aaaaaaaa-0000-4000-8000-0000000000c3";
const ANONIMIZADO = "aaaaaaaa-0000-4000-8000-0000000000c4";
const CONTATO_B = "bbbbbbbb-0000-4000-8000-0000000000c1";

// Dígitos verificadores corretos e incorretos do mesmo número-base.
const CPF_VALIDO = "529.982.247-25";
const CPF_INVALIDO = "529.982.247-26";

let banco: BancoEmMemoria;

function ctx(extra: Partial<McpContext> = {}): McpContext {
  return {
    organizationId: ORG_A,
    role: "agent",
    actor: { type: "ai_agent", id: "run-1", role: "agent", agent_id: AGENTE },
    apiTokenId: TOKEN_A,
    requestId: "req-1",
    supabase: banco.cliente as never,
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

beforeEach(() => {
  h.audit.mockClear();
  h.cifraDisponivel = true;
  h.falhaDoPatch = null;
  h.conferencia = { recusados: [] };
  banco = bancoEmMemoria({
    contacts: [
      contato(CONTATO_A, ORG_A),
      contato(CONTATO_A2, ORG_A, { name: "João" }),
      contato(PESSOAL, ORG_A, { is_personal: true }),
      contato(ANONIMIZADO, ORG_A, { is_anonymized: true }),
      contato(CONTATO_B, ORG_B, { name: "Da outra empresa" }),
    ],
    contact_phones: [],
  });
});

describe("crm_update_contact: grava direto", () => {
  it("grava os campos informados e diz quais gravou", async () => {
    const r = await chamar({
      contact_id: CONTATO_A,
      name: "Maria Souza",
      email: "maria@novo.test",
      birthdate: "1990-05-17",
      street: "Rua das Flores",
      number: "120",
      city: "Valinhos",
    });
    expect(r).toMatchObject({ atualizado: true, contact_id: CONTATO_A, cpf_available: false });
    expect(r.campos_gravados).toEqual(["name", "email", "birthdate", "street", "number", "city"]);
    expect(linha(CONTATO_A)).toMatchObject({
      name: "Maria Souza",
      email: "maria@novo.test",
      birthdate: "1990-05-17",
      city: "Valinhos",
      // O que não veio não muda.
      state: "SP",
    });
  });

  it("⭐ a auditoria leva o agente como autor e o valor ANTERIOR de cada campo", async () => {
    await chamar({ contact_id: CONTATO_A, email: "maria@novo.test", city: "Valinhos" });
    expect(h.audit).toHaveBeenCalledTimes(1);
    const registro = h.audit.mock.calls[0]![0] as { action: string; metadata: Record<string, unknown> };
    expect(registro).toMatchObject({
      action: "contact.updated_by_agent",
      organizationId: ORG_A,
      resourceType: "contact",
      resourceId: CONTATO_A,
      actorUserId: null,
      actorApiTokenId: TOKEN_A,
    });
    expect(registro.metadata).toMatchObject({
      via: "mcp",
      actor_type: "ai_agent",
      agent_id: AGENTE,
      fields: ["email", "city"],
      changes: {
        email: { old: "maria@antigo.test", new: "maria@novo.test" },
        city: { old: "Campinas", new: "Valinhos" },
      },
    });
    expect((AUDIT_ACTIONS as readonly string[]).includes("contact.updated_by_agent")).toBe(true);
  });

  it("campo personalizado é MESCLADO: a chave que não veio continua lá", async () => {
    const r = await chamar({ contact_id: CONTATO_A, custom_fields: { plano: "premium" } });
    expect(r.campos_gravados).toEqual(["custom_fields.plano"]);
    expect(linha(CONTATO_A).custom_fields).toEqual({ origem: "indicação", plano: "premium" });
    // O valor do campo personalizado não entra na auditoria: só o nome.
    const metadata = (h.audit.mock.calls[0]![0] as { metadata: Record<string, unknown> }).metadata;
    expect(metadata.custom_fields_changed).toEqual(["plano"]);
    expect(JSON.stringify(metadata)).not.toContain("premium");
  });

  it("⭐ campo personalizado que a pessoa não disse não é gravado, e volta como erro de ensino", async () => {
    h.conferencia = {
      custom_fields: { plano: "premium" },
      recusados: [{ campo: "renda", mensagem: "Campo «Renda»: a pessoa não informou esse valor." }],
    };
    const r = await chamar({ contact_id: CONTATO_A, custom_fields: { plano: "premium", renda: "10 mil" } });
    expect(r).toMatchObject({ atualizado: true, campos_gravados: ["custom_fields.plano"] });
    expect(r.campos_nao_gravados).toEqual(h.conferencia.recusados);
    expect(String(r.erro_de_ensino)).toContain("Renda");
    expect(linha(CONTATO_A).custom_fields).toEqual({ origem: "indicação", plano: "premium" });
    // Todos recusados: nada é gravado, e a recusa diz por quê.
    h.conferencia = { custom_fields: {}, recusados: [{ campo: "renda", mensagem: "x" }] };
    expect(await chamar({ contact_id: CONTATO_A, custom_fields: { renda: "10 mil" } })).toMatchObject({
      permitido: false,
      motivo: "campo_nao_conferido",
    });
  });

  it("valor igual ao que já está no cadastro não é escrita: nada a gravar, sem auditoria", async () => {
    const r = await chamar({ contact_id: CONTATO_A, name: "Maria", city: "Campinas" });
    expect(r).toMatchObject({ permitido: false, motivo: "nada_a_gravar" });
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("outro telefone entra como telefone extra, na forma canônica; o principal não muda", async () => {
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
  });

  it("o telefone principal repetido como extra é recusado", async () => {
    const r = await chamar({ contact_id: CONTATO_A, secondary_phone: "+55 11 99999-0001" });
    expect(r).toMatchObject({ permitido: false, motivo: "telefone_igual_ao_principal" });
    expect(banco.tabelas.contact_phones).toHaveLength(0);
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
    const antes = { ...linha(CONTATO_A) };
    const r = await chamar({ contact_id: CONTATO_A, ...campos });
    expect(r).toMatchObject({ permitido: false, motivo });
    // Recusa não grava nada, nem audita.
    expect(linha(CONTATO_A)).toEqual(antes);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("campo inválido derruba a chamada inteira: o campo bom ao lado não é gravado pela metade", async () => {
    const r = await chamar({ contact_id: CONTATO_A, name: "Maria Souza", cpf: CPF_INVALIDO });
    expect(r).toMatchObject({ permitido: false, motivo: "documento_invalido" });
    expect(linha(CONTATO_A).name).toBe("Maria");
  });

  it("⭐ contato de outra organização é 'não existe', e nada é escrito nele", async () => {
    const antes = { ...linha(CONTATO_B) };
    const r = await chamar({ contact_id: CONTATO_B, name: "Invadido" });
    expect(r).toMatchObject({ permitido: false, motivo: "contato_nao_encontrado" });
    expect(linha(CONTATO_B)).toEqual(antes);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("⭐ num turno de atendimento, só o contato da conversa", async () => {
    const turno = ctx({ contatoDoTurno: CONTATO_A });
    const doOutro = await chamar({ contact_id: CONTATO_A2, name: "Trocado" }, turno);
    const inexistente = await chamar({ contact_id: CONTATO_B, name: "Trocado" }, turno);
    // Outro cliente e contato de outra empresa recebem a MESMA recusa.
    expect(doOutro).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
    expect(inexistente).toEqual(doOutro);
    expect(linha(CONTATO_A2).name).toBe("João");
    expect((await chamar({ contact_id: CONTATO_A, name: "Maria Souza" }, turno)).atualizado).toBe(true);
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
    const r = await chamar({ contact_id: CONTATO_A, email: "joao@outro.test" });
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

  it("⭐ a auditoria da mudança não leva o documento, nem o anterior nem o novo", async () => {
    banco.tabelas.contacts!.find((c) => c.id === CONTATO_A)!.cpf_hash = hashCpf("390.533.447-05");
    await chamar({ contact_id: CONTATO_A, cpf: CPF_VALIDO });
    const registro = JSON.stringify(h.audit.mock.calls[0]![0]);
    expect(registro).not.toContain(digitos);
    expect(registro).not.toContain(CPF_VALIDO);
    expect(registro).not.toContain("39053344705");
    expect((h.audit.mock.calls[0]![0] as { metadata: { changes: unknown } }).metadata.changes).toEqual({
      cpf: { old: "[protegido]", new: "[protegido]" },
    });
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
    const comNome = await chamar({ contact_id: CONTATO_A, cpf: CPF_VALIDO, name: "Maria Souza" });
    expect(comNome).toMatchObject({ atualizado: true, campos_gravados: ["name"], cpf_available: false });
    expect(String((comNome.avisos as string[])[0])).toContain("NÃO foi gravado");
  });

  it("o mesmo documento que já está no cadastro não é reescrito", async () => {
    banco.tabelas.contacts!.find((c) => c.id === CONTATO_A)!.cpf_hash = hashCpf(CPF_VALIDO);
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
