/**
 * O NEGÓCIO que uma ferramenta do agente recebeu por id — conferido.
 *
 * Toda ferramenta de tarefa, nota, anexo e próxima ação começa pela mesma
 * pergunta: este `lead_id` é desta organização, e é de quem o agente pode
 * tratar agora? Respondida em cada handler, a resposta divergiria — e a
 * divergência aqui é vazamento: uma das ferramentas leria a nota do cliente de
 * outra empresa.
 *
 * Três travas, nesta ordem:
 *
 *  1. ORGANIZAÇÃO — sempre a do contexto do token (`ctx.organizationId`), nunca
 *     um argumento. O cliente é service role: sem o filtro, a RLS não segura.
 *  2. CONVERSA — num turno de atendimento (`ctx.contatoDoTurno`), só o negócio
 *     do contato atendido. Negócio de outro cliente e negócio inexistente
 *     recebem a MESMA recusa, com a mesma consulta: o id não vira oráculo.
 *  3. CONTATO PESSOAL — negócio de contato marcado como pessoal fica fora da
 *     operação, como nas demais leituras de negócio (`lib/mcp/tools/leads.ts`).
 *
 * As recusas voltam como objeto (`permitido: false`) e não como exceção: é o
 * formato que o modelo já lê nas outras ferramentas, com o motivo em código e a
 * frase que diz o que fazer em seguida.
 */
import type { McpContext } from "./types";

export interface RecusaParaOAgente {
  permitido: false;
  motivo: string;
  mensagem: string;
  [extra: string]: unknown;
}

export function recusa(
  motivo: string,
  mensagem: string,
  extra: Record<string, unknown> = {},
): RecusaParaOAgente {
  return { permitido: false, motivo, mensagem, ...extra };
}

export const NEGOCIO_FORA_DA_CONVERSA = recusa(
  "fora_da_conversa",
  "esta conversa é com outra pessoa — um negócio que não é deste cliente não é seu para ver " +
    "nem alterar; siga a conversa com quem está falando.",
);

export const NEGOCIO_NAO_ENCONTRADO = recusa(
  "negocio_nao_encontrado",
  "não existe negócio com esse id nesta organização. Confira o id (é o do NEGÓCIO, não o do " +
    "contato nem o da conversa) e tente de novo.",
);

export const NEGOCIO_DE_CONTATO_PESSOAL = recusa(
  "contato_pessoal",
  "este negócio é de um contato marcado como pessoal — fora da operação: não leia nem escreva aqui.",
);

export const CONSULTA_INDISPONIVEL = recusa(
  "indisponivel",
  "não consegui consultar o CRM agora; tente de novo em instantes.",
);

export interface NegocioConferido {
  id: string;
  contact_id: string | null;
  pipeline_id: string;
  title: string | null;
}

export async function negocioDoContexto(
  ctx: McpContext,
  leadId: string,
): Promise<{ ok: true; lead: NegocioConferido } | { ok: false; recusa: RecusaParaOAgente }> {
  const { data, error } = await ctx.supabase
    .from("crm_leads")
    .select("id, contact_id, pipeline_id, title")
    .eq("organization_id", ctx.organizationId)
    .eq("id", leadId)
    .maybeSingle();
  if (error) return { ok: false, recusa: CONSULTA_INDISPONIVEL };

  const lead = data as NegocioConferido | null;

  if (ctx.contatoDoTurno) {
    if (!lead || lead.contact_id !== ctx.contatoDoTurno) {
      return { ok: false, recusa: NEGOCIO_FORA_DA_CONVERSA };
    }
  }
  if (!lead) return { ok: false, recusa: NEGOCIO_NAO_ENCONTRADO };

  if (lead.contact_id) {
    const { data: contato } = await ctx.supabase
      .from("contacts")
      .select("is_personal")
      .eq("organization_id", ctx.organizationId)
      .eq("id", lead.contact_id)
      .maybeSingle();
    if ((contato as { is_personal?: boolean } | null)?.is_personal === true) {
      return { ok: false, recusa: NEGOCIO_DE_CONTATO_PESSOAL };
    }
  }

  return { ok: true, lead };
}

/**
 * O CONTATO que uma ferramenta recebeu por id — mesmas três travas.
 *
 * Existe porque `crm_tasks.contact_id` tem chave estrangeira simples para
 * `contacts`, e a conferência de chave estrangeira não olha organização: sem
 * isto, o id de um contato de outra empresa gravaria sem erro.
 */
export async function contatoDoContexto(
  ctx: McpContext,
  contactId: string,
): Promise<{ ok: true } | { ok: false; recusa: RecusaParaOAgente }> {
  if (ctx.contatoDoTurno && contactId.toLowerCase() !== ctx.contatoDoTurno.toLowerCase()) {
    return { ok: false, recusa: NEGOCIO_FORA_DA_CONVERSA };
  }
  const { data, error } = await ctx.supabase
    .from("contacts")
    .select("id, is_personal")
    .eq("organization_id", ctx.organizationId)
    .eq("id", contactId)
    .maybeSingle();
  if (error) return { ok: false, recusa: CONSULTA_INDISPONIVEL };
  const contato = data as { id: string; is_personal?: boolean } | null;
  if (!contato) {
    return {
      ok: false,
      recusa: ctx.contatoDoTurno
        ? NEGOCIO_FORA_DA_CONVERSA
        : recusa(
            "contato_nao_encontrado",
            "não existe contato com esse id nesta organização. Confira o id e tente de novo.",
          ),
    };
  }
  if (contato.is_personal === true) return { ok: false, recusa: NEGOCIO_DE_CONTATO_PESSOAL };
  return { ok: true };
}
