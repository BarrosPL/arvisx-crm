/**
 * O ANEXO DO NEGÓCIO PELO AGENTE — `crm_attach_to_lead` e
 * `crm_list_lead_attachments`, contra os handlers reais e
 * `lib/leads/anexos-do-negocio.ts` (a mesma regra da rota da tela).
 *
 * O ponto que este arquivo existe para prender: o agente nunca faz o servidor
 * BUSCAR um endereço. O arquivo vem do Storage do próprio CRM, pelo par
 * bucket + caminho, sob o prefixo da organização do token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type BancoEmMemoria } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({ audit: vi.fn(async (..._args: unknown[]) => undefined) }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));

const { crmAttachToLead, crmListLeadAttachments } = await import("@/lib/mcp/tools/anexos-do-negocio");
const { objetoDaUrlAssinada, TAMANHO_MAXIMO_DO_ANEXO, MIMES_ACEITOS_NO_ANEXO } = await import(
  "@/lib/leads/anexos-do-negocio"
);
import type { McpContext } from "@/lib/mcp/types";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const TOKEN_A = "aaaaaaaa-0000-4000-8000-0000000000f1";
const CONTATO_A = "aaaaaaaa-0000-4000-8000-0000000000c1";
const CONTATO_B = "bbbbbbbb-0000-4000-8000-0000000000c1";
const NEGOCIO_A = "aaaaaaaa-0000-4000-8000-0000000000d1";
const NEGOCIO_SEM_CAMPO = "aaaaaaaa-0000-4000-8000-0000000000d2";
const NEGOCIO_DOIS_CAMPOS = "aaaaaaaa-0000-4000-8000-0000000000d3";
const NEGOCIO_B = "bbbbbbbb-0000-4000-8000-0000000000d1";
const FUNIL_UM_CAMPO = "aaaaaaaa-0000-4000-8000-000000000011";
const FUNIL_SEM_CAMPO = "aaaaaaaa-0000-4000-8000-000000000012";
const FUNIL_DOIS_CAMPOS = "aaaaaaaa-0000-4000-8000-000000000013";
const CONVERSA_A = "aaaaaaaa-0000-4000-8000-000000000021";
const MSG_PDF = "aaaaaaaa-0000-4000-8000-000000000031";
const MSG_TEXTO = "aaaaaaaa-0000-4000-8000-000000000032";
const MSG_AUDIO = "aaaaaaaa-0000-4000-8000-000000000033";
const MSG_ENORME = "aaaaaaaa-0000-4000-8000-000000000034";
const MSG_B = "bbbbbbbb-0000-4000-8000-000000000031";

const CAMINHO_PDF = `${ORG_A}/${CONVERSA_A}/comprovante.pdf`;
const CAMINHO_AUDIO = `${ORG_A}/${CONVERSA_A}/audio.ogg`;
const CAMINHO_B = `${ORG_B}/conversa-b/segredo.pdf`;
const PDF = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);

const BASE = "https://storage.exemplo.test";

let banco: BancoEmMemoria;

function ctx(extra: Partial<McpContext> = {}): McpContext {
  return {
    organizationId: ORG_A,
    role: "agent",
    actor: { type: "api_token", id: TOKEN_A, role: "agent" },
    apiTokenId: TOKEN_A,
    requestId: "req-1",
    supabase: banco.cliente as never,
    ...extra,
  };
}

const campo = (key: string, label: string, extra: Record<string, unknown> = {}) => ({
  key,
  label,
  type: "file",
  ...extra,
});

beforeEach(() => {
  h.audit.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", BASE);
  banco = bancoEmMemoria(
    {
      contacts: [
        { id: CONTATO_A, organization_id: ORG_A, is_personal: false },
        { id: CONTATO_B, organization_id: ORG_B, is_personal: false },
      ],
      crm_pipelines: [
        { id: FUNIL_UM_CAMPO, organization_id: ORG_A, settings: { fields: [campo("comprovante", "Comprovante")] } },
        { id: FUNIL_SEM_CAMPO, organization_id: ORG_A, settings: { fields: [{ key: "obs", label: "Obs", type: "text" }] } },
        {
          id: FUNIL_DOIS_CAMPOS,
          organization_id: ORG_A,
          settings: { fields: [campo("contrato", "Contrato"), campo("documento", "Documento")] },
        },
      ],
      crm_leads: [
        { id: NEGOCIO_A, organization_id: ORG_A, contact_id: CONTATO_A, pipeline_id: FUNIL_UM_CAMPO, title: "A" },
        { id: NEGOCIO_SEM_CAMPO, organization_id: ORG_A, contact_id: CONTATO_A, pipeline_id: FUNIL_SEM_CAMPO, title: "S" },
        { id: NEGOCIO_DOIS_CAMPOS, organization_id: ORG_A, contact_id: CONTATO_A, pipeline_id: FUNIL_DOIS_CAMPOS, title: "D" },
        { id: NEGOCIO_B, organization_id: ORG_B, contact_id: CONTATO_B, pipeline_id: FUNIL_UM_CAMPO, title: "B" },
      ],
      messages: [
        {
          id: MSG_PDF,
          organization_id: ORG_A,
          contact_id: CONTATO_A,
          media_storage_path: CAMINHO_PDF,
          media_mime: "application/pdf",
          media_size_bytes: PDF.byteLength,
          metadata: { media_filename: "Comprovante de residência.pdf" },
        },
        { id: MSG_TEXTO, organization_id: ORG_A, contact_id: CONTATO_A, media_storage_path: null, metadata: {} },
        {
          id: MSG_AUDIO,
          organization_id: ORG_A,
          contact_id: CONTATO_A,
          media_storage_path: CAMINHO_AUDIO,
          media_mime: "audio/ogg",
          media_size_bytes: 10,
          metadata: {},
        },
        {
          id: MSG_ENORME,
          organization_id: ORG_A,
          contact_id: CONTATO_A,
          media_storage_path: `${ORG_A}/${CONVERSA_A}/enorme.pdf`,
          media_mime: "application/pdf",
          media_size_bytes: TAMANHO_MAXIMO_DO_ANEXO + 1,
          metadata: {},
        },
        {
          id: MSG_B,
          organization_id: ORG_B,
          contact_id: CONTATO_B,
          media_storage_path: CAMINHO_B,
          media_mime: "application/pdf",
          media_size_bytes: 8,
          metadata: {},
        },
      ],
      crm_lead_attachments: [
        {
          id: "bbbbbbbb-0000-4000-8000-0000000000a1",
          organization_id: ORG_B,
          lead_id: NEGOCIO_B,
          field_key: "comprovante",
          file_name: "da-outra-empresa.pdf",
          file_size: 8,
          mime_type: "application/pdf",
          storage_path: `${ORG_B}/leads/${NEGOCIO_B}/comprovante/x.pdf`,
          created_at: "2026-11-01T10:00:00.000Z",
        },
      ],
    },
    {
      [`whatsapp-media/${CAMINHO_PDF}`]: { bytes: PDF, tipo: "application/pdf" },
      [`whatsapp-media/${CAMINHO_AUDIO}`]: { bytes: new Uint8Array(10), tipo: "audio/ogg" },
      [`whatsapp-media/${CAMINHO_B}`]: { bytes: new Uint8Array(8), tipo: "application/pdf" },
    },
  );
});

afterEach(() => vi.unstubAllEnvs());

type Resposta = Record<string, unknown>;
const anexar = (args: Record<string, unknown>, c = ctx()) =>
  crmAttachToLead.handler(args as never, c) as Promise<Resposta>;
const listar = (args: Record<string, unknown>, c = ctx()) =>
  crmListLeadAttachments.handler(args as never, c) as Promise<Resposta>;
const anexosDaA = () => banco.tabelas.crm_lead_attachments!.filter((a) => a.organization_id === ORG_A);
const gravadosNoBucketDosAnexos = () => [...banco.arquivos.keys()].filter((k) => k.startsWith("internal-media/"));

describe("crm_attach_to_lead — a partir de uma mensagem da conversa", () => {
  it("⭐ copia o arquivo para o negócio, no prefixo da organização, e grava a linha dela", async () => {
    const r = await anexar({ lead_id: NEGOCIO_A, message_id: MSG_PDF });

    expect(r.attachment).toMatchObject({
      name: "Comprovante de residência.pdf",
      type: "application/pdf",
      size: PDF.byteLength,
      field_key: "comprovante",
    });
    const [linha] = anexosDaA();
    expect(linha).toMatchObject({
      organization_id: ORG_A,
      lead_id: NEGOCIO_A,
      field_key: "comprovante",
      created_by: null,
    });
    expect(String(linha!.storage_path).startsWith(`${ORG_A}/leads/${NEGOCIO_A}/comprovante/`)).toBe(true);
    expect(gravadosNoBucketDosAnexos()).toEqual([`internal-media/${linha!.storage_path}`]);
    expect(banco.downloads).toEqual([`whatsapp-media/${CAMINHO_PDF}`]);
  });

  it("⭐ audita com o agente como ator e deixa a linha 'documento anexado' na timeline", async () => {
    await anexar({ lead_id: NEGOCIO_A, message_id: MSG_PDF });

    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "lead.attachment_uploaded",
        organizationId: ORG_A,
        actorUserId: null,
        actorApiTokenId: TOKEN_A,
        resourceId: NEGOCIO_A,
        metadata: expect.objectContaining({ via: "mcp", source_message_id: MSG_PDF, field_key: "comprovante" }),
      }),
    );
    await vi.waitFor(() =>
      expect(banco.tabelas.crm_lead_activities).toEqual([
        expect.objectContaining({ organization_id: ORG_A, lead_id: NEGOCIO_A, type: "document_attached" }),
      ]),
    );
  });

  it("⭐ mensagem de OUTRA organização: recusa, e o arquivo de lá nem é lido", async () => {
    const r = await anexar({ lead_id: NEGOCIO_A, message_id: MSG_B });

    expect(r).toMatchObject({ permitido: false, motivo: "mensagem_nao_encontrada" });
    expect(banco.downloads).toEqual([]);
    expect(anexosDaA()).toHaveLength(0);
  });

  it("⭐ negócio de OUTRA organização: recusa, nada sobe", async () => {
    const r = await anexar({ lead_id: NEGOCIO_B, message_id: MSG_PDF });

    expect(r).toMatchObject({ permitido: false, motivo: "negocio_nao_encontrado" });
    expect(banco.downloads).toEqual([]);
    expect(gravadosNoBucketDosAnexos()).toEqual([]);
  });

  it("mensagem sem arquivo é recusada", async () => {
    expect(await anexar({ lead_id: NEGOCIO_A, message_id: MSG_TEXTO })).toMatchObject({
      permitido: false,
      motivo: "mensagem_sem_arquivo",
    });
  });

  it("⭐ os limites são os da tela: formato fora da lista e arquivo acima de 50 MB são recusados SEM baixar", async () => {
    expect(MIMES_ACEITOS_NO_ANEXO.has("audio/ogg")).toBe(false);

    expect(await anexar({ lead_id: NEGOCIO_A, message_id: MSG_AUDIO })).toMatchObject({
      permitido: false,
      motivo: "tipo_de_arquivo_nao_aceito",
    });
    expect(await anexar({ lead_id: NEGOCIO_A, message_id: MSG_ENORME })).toMatchObject({
      permitido: false,
      motivo: "arquivo_grande_demais",
    });
    expect(banco.downloads).toEqual([]);
    expect(anexosDaA()).toHaveLength(0);
  });

  it("só anexa em campo de arquivo que o funil declara", async () => {
    expect(await anexar({ lead_id: NEGOCIO_SEM_CAMPO, message_id: MSG_PDF })).toMatchObject({
      permitido: false,
      motivo: "funil_sem_campo_de_arquivo",
    });
    expect(await anexar({ lead_id: NEGOCIO_A, message_id: MSG_PDF, field_key: "inexistente" })).toMatchObject({
      permitido: false,
      motivo: "campo_de_arquivo_inexistente",
      available_fields: [{ field_key: "comprovante", label: "Comprovante" }],
    });
  });

  it("com mais de um campo de arquivo, pede qual — e aceita o escolhido", async () => {
    expect(await anexar({ lead_id: NEGOCIO_DOIS_CAMPOS, message_id: MSG_PDF })).toMatchObject({
      permitido: false,
      motivo: "campo_de_arquivo_ambiguo",
    });
    const r = await anexar({ lead_id: NEGOCIO_DOIS_CAMPOS, message_id: MSG_PDF, field_key: "contrato" });
    expect(r.attachment).toMatchObject({ field_key: "contrato" });
  });

  it("exige UMA origem: nem as duas, nem nenhuma", async () => {
    const recusa = { permitido: false, motivo: "origem_do_arquivo_invalida" };
    expect(await anexar({ lead_id: NEGOCIO_A })).toMatchObject(recusa);
    expect(
      await anexar({ lead_id: NEGOCIO_A, message_id: MSG_PDF, signed_url: `${BASE}/storage/v1/object/sign/x/y` }),
    ).toMatchObject(recusa);
  });

  it("⭐ a mesma Idempotency-Key não anexa o arquivo duas vezes", async () => {
    const comChave = ctx({ idempotencyKey: "11111111-1111-4111-8111-111111111111" });
    const primeira = await anexar({ lead_id: NEGOCIO_A, message_id: MSG_PDF }, comChave);
    const segunda = await anexar({ lead_id: NEGOCIO_A, message_id: MSG_PDF }, comChave);

    expect(anexosDaA()).toHaveLength(1);
    expect((segunda.attachment as Resposta).id).toBe((primeira.attachment as Resposta).id);
    expect(segunda.idempotent_replay).toBe(true);
  });
});

describe("crm_attach_to_lead — URL assinada: só a do próprio CRM, e ela nunca é buscada", () => {
  let busca: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    busca = vi.fn(() => {
      throw new Error("o servidor não pode buscar endereço nenhum");
    });
    vi.stubGlobal("fetch", busca);
  });
  afterEach(() => vi.unstubAllGlobals());

  const assinada = (bucket: string, caminho: string) =>
    `${BASE}/storage/v1/object/sign/${bucket}/${caminho}?token=abc`;

  it("⭐ aceita a URL assinada de um arquivo da organização — lendo pelo Storage, sem fetch", async () => {
    const r = await anexar({ lead_id: NEGOCIO_A, signed_url: assinada("whatsapp-media", CAMINHO_PDF) });

    expect(r.attachment).toMatchObject({ type: "application/pdf", size: PDF.byteLength, name: "comprovante.pdf" });
    expect(banco.downloads).toEqual([`whatsapp-media/${CAMINHO_PDF}`]);
    expect(busca).not.toHaveBeenCalled();
  });

  it.each([
    ["host de fora", "https://malicioso.test/storage/v1/object/sign/whatsapp-media/CAMINHO"],
    ["metadados da nuvem (SSRF clássico)", "http://169.254.169.254/latest/meta-data/"],
    ["serviço interno", "http://localhost:5432/storage/v1/object/sign/whatsapp-media/CAMINHO"],
    ["mesmo host, outro protocolo", "http://storage.exemplo.test/storage/v1/object/sign/whatsapp-media/CAMINHO"],
    ["host parecido", "https://storage.exemplo.test.malicioso.test/storage/v1/object/sign/whatsapp-media/CAMINHO"],
    ["credencial embutida", "https://u:p@storage.exemplo.test/storage/v1/object/sign/whatsapp-media/CAMINHO"],
    ["rota que não é a de objeto assinado", "https://storage.exemplo.test/rest/v1/contacts?select=*"],
    ["bucket que não é do CRM", "https://storage.exemplo.test/storage/v1/object/sign/outro-bucket/CAMINHO"],
    ["arquivo local", "file:///etc/passwd"],
    ["texto que não é URL", "comprovante.pdf"],
  ])("⭐ recusa %s, sem buscar e sem ler o Storage", async (_caso, modelo) => {
    const r = await anexar({ lead_id: NEGOCIO_A, signed_url: modelo.replace("CAMINHO", CAMINHO_PDF) });

    expect(r).toMatchObject({ permitido: false, motivo: "url_nao_aceita" });
    expect(busca).not.toHaveBeenCalled();
    expect(banco.downloads).toEqual([]);
    expect(anexosDaA()).toHaveLength(0);
  });

  it("⭐ URL assinada do arquivo de OUTRA organização é recusada — o caminho não começa pela do token", async () => {
    const r = await anexar({ lead_id: NEGOCIO_A, signed_url: assinada("whatsapp-media", CAMINHO_B) });

    expect(r).toMatchObject({ permitido: false, motivo: "url_nao_aceita" });
    expect(banco.downloads).toEqual([]);
  });

  it("no turno de atendimento a URL não entra: só a mensagem, que tem dono conferível", async () => {
    const turno = ctx({ contatoDoTurno: CONTATO_A });
    const r = await anexar({ lead_id: NEGOCIO_A, signed_url: assinada("whatsapp-media", CAMINHO_PDF) }, turno);

    expect(r).toMatchObject({ permitido: false, motivo: "origem_do_arquivo_invalida" });
    expect(banco.downloads).toEqual([]);

    const pelaMensagem = await anexar({ lead_id: NEGOCIO_A, message_id: MSG_PDF }, turno);
    expect(pelaMensagem.attachment).toBeDefined();
  });

  it("travessia de caminho, codificada ou não, não escapa do prefixo da organização", () => {
    const tentativas = [
      `${ORG_A}/../${ORG_B}/conversa-b/segredo.pdf`,
      `${ORG_A}/%2e%2e/${ORG_B}/conversa-b/segredo.pdf`,
      `${ORG_A}/%2E%2E%2F${ORG_B}/conversa-b/segredo.pdf`,
      `${ORG_A}//segredo.pdf`,
      `${ORG_A}`,
    ];
    for (const caminho of tentativas) {
      expect(objetoDaUrlAssinada(assinada("whatsapp-media", caminho), BASE, ORG_A), caminho).toBeNull();
    }
  });

  it("sem a base do Storage configurada, nenhuma URL é aceita (falha fechada)", () => {
    expect(objetoDaUrlAssinada(assinada("whatsapp-media", CAMINHO_PDF), undefined, ORG_A)).toBeNull();
  });

  it("a URL assinada (que carrega token de acesso) não vai para a auditoria", () => {
    const limpo = crmAttachToLead.redigirParaAuditoria!({ lead_id: "x", signed_url: assinada("whatsapp-media", CAMINHO_PDF) });
    expect(limpo).toEqual({ lead_id: "x", signed_url: "[redacted]" });
  });
});

describe("crm_list_lead_attachments", () => {
  it("⭐ nome, tipo, tamanho, campo e um link assinado CURTO", async () => {
    await anexar({ lead_id: NEGOCIO_A, message_id: MSG_PDF });

    const r = await listar({ lead_id: NEGOCIO_A });

    expect(r.attachments).toEqual([
      expect.objectContaining({
        name: "Comprovante de residência.pdf",
        type: "application/pdf",
        size: PDF.byteLength,
        field_key: "comprovante",
        url_expires_in_seconds: 60,
      }),
    ]);
    const url = (r.attachments as Resposta[])[0]!.url as string;
    expect(url).toContain(`/storage/v1/object/sign/internal-media/${ORG_A}/leads/${NEGOCIO_A}/comprovante/`);
  });

  it("⭐ negócio de OUTRA organização: recusa, e o anexo de lá não sai", async () => {
    const r = await listar({ lead_id: NEGOCIO_B });
    expect(r).toMatchObject({ permitido: false, motivo: "negocio_nao_encontrado" });
    expect(JSON.stringify(r)).not.toContain("da-outra-empresa");
  });

  it("⭐ linha de OUTRA organização com o mesmo lead_id não entra na lista", async () => {
    banco.tabelas.crm_lead_attachments!.push({
      id: "bbbbbbbb-0000-4000-8000-0000000000a2",
      organization_id: ORG_B,
      lead_id: NEGOCIO_A,
      field_key: "comprovante",
      file_name: "infiltrado.pdf",
      file_size: 1,
      mime_type: "application/pdf",
      storage_path: `${ORG_B}/leads/${NEGOCIO_A}/comprovante/i.pdf`,
      created_at: "2026-11-01T10:00:00.000Z",
    });

    expect((await listar({ lead_id: NEGOCIO_A })).attachments).toEqual([]);
  });

  it("caminho fora do prefixo deste negócio aparece SEM link — nunca com o de outro", async () => {
    banco.tabelas.crm_lead_attachments!.push({
      id: "aaaaaaaa-0000-4000-8000-0000000000a3",
      organization_id: ORG_A,
      lead_id: NEGOCIO_A,
      field_key: "comprovante",
      file_name: "forjado.pdf",
      file_size: 1,
      mime_type: "application/pdf",
      storage_path: `${ORG_B}/leads/${NEGOCIO_B}/comprovante/x.pdf`,
      created_at: "2026-11-01T10:00:00.000Z",
    });

    const [linha] = (await listar({ lead_id: NEGOCIO_A })).attachments as Resposta[];
    expect(linha).toMatchObject({ name: "forjado.pdf", url: null, url_expires_in_seconds: null });
  });

  it("filtra pelo campo de arquivo", async () => {
    await anexar({ lead_id: NEGOCIO_DOIS_CAMPOS, message_id: MSG_PDF, field_key: "contrato" });
    await anexar({ lead_id: NEGOCIO_DOIS_CAMPOS, message_id: MSG_PDF, field_key: "documento" });

    const r = await listar({ lead_id: NEGOCIO_DOIS_CAMPOS, field_key: "documento" });
    expect((r.attachments as Resposta[]).map((a) => a.field_key)).toEqual(["documento"]);
  });
});

describe("contrato das duas ferramentas", () => {
  it("papel mínimo `agent` e o escopo certo; nenhuma aceita organização como argumento", () => {
    expect(crmListLeadAttachments).toMatchObject({ category: "read", requiresRole: "agent", requiresScope: "mcp:read" });
    expect(crmAttachToLead).toMatchObject({ category: "write", requiresRole: "agent", requiresScope: "mcp:write" });
    expect(Object.keys(crmAttachToLead.inputSchema)).not.toContain("organization_id");
    // Nenhum campo aceita endereço livre além da URL assinada, que é conferida.
    expect(Object.keys(crmAttachToLead.inputSchema).sort()).toEqual([
      "field_key",
      "file_name",
      "lead_id",
      "message_id",
      "signed_url",
    ]);
  });
});
