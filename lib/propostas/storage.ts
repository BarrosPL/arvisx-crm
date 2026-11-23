import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "propostas";

/** Upload + signed URL — mesmo padrão de `workers/lgpd-export-worker.ts` (bucket lgpd-exports). */
export async function salvarPdfDaProposta(
  admin: SupabaseClient,
  input: { orgId: string; propostaId: string; buffer: Buffer },
): Promise<{ path: string; signedUrl: string }> {
  const path = `${input.orgId}/${input.propostaId}.pdf`;

  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(path, input.buffer, { contentType: "application/pdf", upsert: true });
  if (uploadErr) throw new Error(`proposta_pdf_upload_failed: ${uploadErr.message}`);

  const { data: signed, error: signedErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 dias — tempo de a mensagem chegar e o canal baixar o arquivo
  if (signedErr || !signed) throw new Error(`proposta_pdf_signed_url_failed: ${signedErr?.message ?? "no_url"}`);

  return { path, signedUrl: signed.signedUrl };
}

/**
 * Validade do link de CONSULTA do PDF: curta, como a do link de anexo do
 * negócio. Serve para quem consulta abrir o documento agora, não para circular.
 */
export const VALIDADE_DO_LINK_DE_CONSULTA_DO_PDF_S = 60;

/** O caminho que `salvarPdfDaProposta` grava: `<organização>/<proposta>.pdf`. */
export function caminhoDoPdfDaProposta(orgId: string, propostaId: string): string {
  return `${orgId}/${propostaId}.pdf`;
}

/**
 * Link assinado e curto para LER o PDF já gerado de uma proposta.
 *
 * O cliente é service role: só assina quando o caminho gravado é exatamente o
 * desta proposta nesta organização. Caminho diferente volta sem link, nunca com
 * o de outra proposta. Falha do Storage também volta `null`: a consulta segue.
 */
export async function linkDeConsultaDoPdfDaProposta(
  admin: SupabaseClient,
  input: { orgId: string; propostaId: string; pdfPath: string | null },
): Promise<string | null> {
  if (!input.pdfPath || input.pdfPath !== caminhoDoPdfDaProposta(input.orgId, input.propostaId)) {
    return null;
  }
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(input.pdfPath, VALIDADE_DO_LINK_DE_CONSULTA_DO_PDF_S);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
