/**
 * O ANEXO DO NEGÓCIO — a regra, fora da rota.
 *
 * Duas portas anexam documento a um negócio: a tela
 * (`app/api/v1/leads/[id]/attachments`, upload por sessão de usuário) e o agente
 * (`lib/mcp/tools/anexos-do-negocio.ts`, token de API ou agente nativo, a partir
 * de uma mídia que já está no CRM). O token não entra na rota REST, então a
 * segunda porta precisa das MESMAS travas da primeira — e trava copiada é trava
 * que diverge: uma das portas passaria a aceitar um formato, um tamanho ou um
 * campo que a outra recusa.
 *
 * O que as duas fazem igual, e por isso mora aqui:
 *
 *  - o que é aceito (`MIMES_ACEITOS_NO_ANEXO`, `TAMANHO_MAXIMO_DO_ANEXO`);
 *  - onde o arquivo pode entrar: só num campo `file` do NEGÓCIO que o funil
 *    daquele lead declara (`campoDeArquivoDoNegocio`);
 *  - o caminho no Storage, sempre sob `<organização>/leads/<negócio>/`;
 *  - a linha em `crm_lead_attachments`, a auditoria e a linha na timeline.
 *
 * O arquivo chega como BYTES: a tela os lê do multipart, o agente os lê do
 * Storage do próprio CRM. Este módulo nunca busca nada na rede.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { camposDoFunil, escopoDoCampo } from "@/lib/leads/campos-do-funil";
import { settingsDoFunil } from "@/lib/leads/campos-exigidos";
import { logger } from "@/lib/logger";

/** O bucket privado dos documentos do negócio. */
export const BUCKET_DOS_ANEXOS = "internal-media";

export const TAMANHO_MAXIMO_DO_ANEXO = 50 * 1024 * 1024; // 50 MB

export const MIMES_ACEITOS_NO_ANEXO: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/jpg",
]);

/** A validade do link assinado que abre o arquivo, em segundos. */
export const VALIDADE_DO_LINK_DO_ANEXO_S = 60;

export interface LeadAttachment {
  id: string;
  name: string;
  path: string;
  size: number;
  type: string;
  url: string;
  created_at?: string;
  uploaded_at?: string;
}

/** As colunas de `crm_lead_attachments` que a lista devolve. */
export const COLUNAS_DO_ANEXO = "id, file_name, storage_path, file_size, mime_type, created_at";

/** As mesmas, mais o campo do funil a que o arquivo pertence — o que a lista do agente devolve. */
export const COLUNAS_DO_ANEXO_COM_CAMPO = `${COLUNAS_DO_ANEXO}, field_key`;

export interface LinhaDoAnexo {
  id: string;
  file_name: string;
  storage_path: string;
  file_size: number | string;
  mime_type: string;
  created_at: string;
  /** Só vem quando a consulta pede `COLUNAS_DO_ANEXO_COM_CAMPO`. */
  field_key?: string;
}

export function nomeSeguroDoArquivo(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function serializarAnexo(row: LinhaDoAnexo, leadId: string): LeadAttachment {
  return {
    id: row.id,
    name: row.file_name,
    path: row.storage_path,
    size: Number(row.file_size) || 0,
    type: row.mime_type,
    url: `/api/v1/leads/${leadId}/attachments/${row.id}/media`,
    created_at: row.created_at,
    uploaded_at: row.created_at,
  };
}

/** Por que o arquivo não serve — antes de tocar o Storage. */
export type RecusaDoArquivo = "grande_demais" | "tipo_nao_aceito";

export function recusaDoArquivo(arquivo: { tipo: string; tamanho: number }): RecusaDoArquivo | null {
  if (arquivo.tamanho > TAMANHO_MAXIMO_DO_ANEXO) return "grande_demais";
  if (!MIMES_ACEITOS_NO_ANEXO.has(arquivo.tipo.toLowerCase())) return "tipo_nao_aceito";
  return null;
}

/** Um campo `file` do negócio, como o funil o declara. */
export interface CampoDeArquivo {
  key: string;
  label?: string;
}

/** Os campos `file` do NEGÓCIO que o funil declara (arquivo de contato fica de fora). */
export async function camposDeArquivoDoNegocio(
  supabase: SupabaseClient,
  pipelineId: string,
): Promise<CampoDeArquivo[]> {
  const settings = await settingsDoFunil(supabase, pipelineId);
  return camposDoFunil(settings as Record<string, unknown> | null)
    .filter((c) => c.type === "file" && escopoDoCampo(c) === "negocio")
    .map((c) => ({ key: c.key, ...(c.label ? { label: c.label } : {}) }));
}

/** Só se anexa a um campo `file` do NEGÓCIO que o funil deste lead declara. */
export async function campoDeArquivoDoNegocio(
  supabase: SupabaseClient,
  pipelineId: string,
  fieldKey: string,
): Promise<CampoDeArquivo | null> {
  const campos = await camposDeArquivoDoNegocio(supabase, pipelineId);
  return campos.find((c) => c.key === fieldKey) ?? null;
}

export interface AuditoriaDoAnexo {
  actorUserId: string | null;
  actorApiTokenId?: string | null;
  requestId: string;
  metadata?: Record<string, unknown>;
}

export type DesfechoDoAnexo =
  | { ok: true; anexo: LinhaDoAnexo }
  | { ok: false; recusa: "falha_no_armazenamento" | "falha_no_registro" };

/**
 * Sobe os bytes e grava a linha do anexo.
 *
 * Quem chama já conferiu o negócio (organização de fonte confiável), o campo
 * (`campoDeArquivoDoNegocio`) e o arquivo (`recusaDoArquivo`). Aqui só a
 * escrita: Storage primeiro, tabela depois, e o arquivo é removido se a linha
 * não entrar — para não sobrar objeto que nenhuma lista alcança.
 */
export async function gravarAnexoDoNegocio(entrada: {
  /** Sessão (RLS) ou admin: a linha leva a organização nos dois casos. */
  supabase: SupabaseClient;
  /** Service role — o Storage do bucket privado só aceita escrita por ele. */
  admin: SupabaseClient;
  organizationId: string;
  /** O id do negócio COMO O BANCO O DEVOLVE (minúsculo): o caminho confere contra ele. */
  leadId: string;
  campo: CampoDeArquivo;
  arquivo: { nome: string; tipo: string; tamanho: number; bytes: Uint8Array };
  /** `crm_lead_attachments.created_by` (FK para `auth.users`): `null` quando não foi uma pessoa. */
  criadoPor: string | null;
  ator: Actor;
  auditoria: AuditoriaDoAnexo;
  /** Somado ao `payload` da linha da timeline (ex.: de qual mensagem veio). */
  origem?: Record<string, unknown>;
}): Promise<DesfechoDoAnexo> {
  const { supabase, admin, organizationId, leadId, campo, arquivo, auditoria } = entrada;
  const fieldKey = campo.key;

  const safeName = nomeSeguroDoArquivo(arquivo.nome);
  const attachmentId = randomUUID();
  const ext = safeName.includes(".") ? safeName.split(".").pop() : "bin";
  const storagePath = `${organizationId}/leads/${leadId}/${fieldKey}/${attachmentId}.${ext}`;

  const { error: uploadError } = await admin.storage
    .from(BUCKET_DOS_ANEXOS)
    .upload(storagePath, arquivo.bytes, { contentType: arquivo.tipo, upsert: false });

  if (uploadError) {
    logger.error("[leads/attachments] upload falhou", {
      detalhe: uploadError.message,
      requestId: auditoria.requestId,
    });
    return { ok: false, recusa: "falha_no_armazenamento" };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("crm_lead_attachments")
    .insert({
      id: attachmentId,
      organization_id: organizationId,
      lead_id: leadId,
      field_key: fieldKey,
      file_name: arquivo.nome,
      file_size: arquivo.tamanho,
      mime_type: arquivo.tipo,
      storage_path: storagePath,
      created_by: entrada.criadoPor,
    })
    .select(COLUNAS_DO_ANEXO)
    .single();

  if (insertError || !inserted) {
    logger.error("[leads/attachments] insert falhou", {
      detalhe: insertError?.message,
      requestId: auditoria.requestId,
    });
    // Tenta limpar o arquivo enviado para não deixar lixo no Storage
    await admin.storage.from(BUCKET_DOS_ANEXOS).remove([storagePath]).catch(() => null);
    return { ok: false, recusa: "falha_no_registro" };
  }

  await audit({
    action: "lead.attachment_uploaded",
    organizationId,
    actorUserId: auditoria.actorUserId,
    ...(auditoria.actorApiTokenId ? { actorApiTokenId: auditoria.actorApiTokenId } : {}),
    resourceType: "crm_leads",
    resourceId: leadId,
    metadata: {
      attachment_id: attachmentId,
      field_key: fieldKey,
      file_name: arquivo.nome,
      file_size: arquivo.tamanho,
      mime_type: arquivo.tipo,
      ...auditoria.metadata,
    },
    requestId: auditoria.requestId,
  });

  // A LINHA DO TEMPO (#3316): sem ela, o documento existe no card e some da
  // história do negócio — quem abre o card uma semana depois não vê quando o
  // voucher chegou nem que arquivo sustenta a proposta que a IA leu dele.
  // Fire-and-forget como todo emissor: a timeline não derruba o upload que ela
  // descreve. O payload é NOME e TIPO do arquivo — nunca o conteúdo.
  void emitLeadActivity(supabase, {
    organizationId,
    leadId,
    type: "document_attached",
    sourceModule: "leads/attachments",
    sourceId: attachmentId,
    actor: entrada.ator,
    reason: `Documento anexado ao campo ${campo.label ?? fieldKey}`,
    payload: {
      field_key: fieldKey,
      file_name: arquivo.nome,
      mime_type: arquivo.tipo,
      ...entrada.origem,
    },
  }).catch(() => null);

  return { ok: true, anexo: inserted as LinhaDoAnexo };
}

/** Os anexos de um negócio, do mais antigo ao mais novo. Quem chama já conferiu o negócio. */
export async function listarAnexosDoNegocio(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
  fieldKey?: string | null,
  colunas: string = COLUNAS_DO_ANEXO,
): Promise<{ ok: true; linhas: LinhaDoAnexo[] } | { ok: false; erro: string }> {
  let query = supabase
    .from("crm_lead_attachments")
    .select(colunas)
    .eq("lead_id", leadId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (fieldKey) {
    query = query.eq("field_key", fieldKey);
  }

  const { data: rows, error } = await query;
  if (error) return { ok: false, erro: error.message };
  return { ok: true, linhas: (rows ?? []) as unknown as LinhaDoAnexo[] };
}

/** O bucket das mídias de conversa — de onde o agente pode trazer um arquivo já recebido. */
export const BUCKET_DAS_MIDIAS_DE_CONVERSA = "whatsapp-media";

/** Os buckets do próprio CRM de onde um anexo pode ser copiado. Nenhum outro. */
const BUCKETS_DE_ORIGEM: ReadonlySet<string> = new Set([
  BUCKET_DAS_MIDIAS_DE_CONVERSA,
  BUCKET_DOS_ANEXOS,
]);

/**
 * Lê uma URL ASSINADA DO PRÓPRIO CRM e devolve QUAL objeto ela aponta — sem
 * nunca buscar a URL.
 *
 * ⚠️ Esta função é a trava contra SSRF do anexo por agente. O agente entrega um
 * texto; se o servidor fizesse `fetch` dele, o texto escolheria para onde o
 * servidor liga (metadados da nuvem, serviço interno, outra máquina da rede).
 * Aqui a URL é só LIDA: confere-se que o host é o do Storage desta instalação,
 * que o caminho é o de um objeto assinado, que o bucket é um dos dois do CRM e
 * que o objeto mora sob o prefixo da organização do token. Quem baixa depois é
 * o cliente do Storage, pelo par (bucket, caminho) — a URL não é usada de novo,
 * e o token dela não é conferido nem necessário.
 *
 * Devolve `null` para qualquer coisa fora disso; quem chama recusa.
 */
export function objetoDaUrlAssinada(
  url: string,
  baseDoStorage: string | undefined,
  organizationId: string,
): { bucket: string; caminho: string } | null {
  if (!baseDoStorage) return null;
  let alvo: URL;
  let base: URL;
  try {
    alvo = new URL(url);
    base = new URL(baseDoStorage);
  } catch {
    return null;
  }
  if (alvo.protocol !== "https:" && alvo.protocol !== "http:") return null;
  if (alvo.protocol !== base.protocol || alvo.host !== base.host) return null;
  if (alvo.username || alvo.password) return null;

  const prefixo = "/storage/v1/object/sign/";
  if (!alvo.pathname.startsWith(prefixo)) return null;
  const resto = alvo.pathname.slice(prefixo.length);
  const barra = resto.indexOf("/");
  if (barra <= 0) return null;

  const bucket = resto.slice(0, barra);
  if (!BUCKETS_DE_ORIGEM.has(bucket)) return null;

  let caminho: string;
  try {
    caminho = decodeURIComponent(resto.slice(barra + 1));
  } catch {
    return null;
  }
  // A mesma régua de `isMediaPathInOrganization`: primeiro segmento = a
  // organização, e nenhum segmento vazio, `.` ou `..` depois de decodificar.
  const segmentos = caminho.split("/");
  if (segmentos.length < 2 || segmentos[0] !== organizationId) return null;
  if (/[%\?#\p{Cc}]/u.test(caminho)) return null;
  if (segmentos.some((s) => s === "" || s === "." || s === "..")) return null;

  return { bucket, caminho };
}
