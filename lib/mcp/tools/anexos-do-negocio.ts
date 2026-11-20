/**
 * Handlers das capacidades de ANEXO DO NEGÓCIO — o documento preso ao card.
 *
 *  Read:
 *   - crm_list_lead_attachments
 *  Write:
 *   - crm_attach_to_lead
 *
 * A regra mora em `lib/leads/anexos-do-negocio.ts`, a MESMA da tela
 * (`app/api/v1/leads/[id]/attachments`): formatos e tamanho aceitos, o campo de
 * arquivo que o funil declara, o caminho no Storage, a linha da tabela, a
 * auditoria e a timeline. O token de API não entra naquela rota, então a
 * superfície do agente é esta.
 *
 * ⚠️ DE ONDE O ARQUIVO VEM — e por que só de dois lugares. A tela recebe os
 * bytes do navegador. O agente não manda bytes: ele aponta para um arquivo que
 * JÁ ESTÁ no CRM —
 *
 *  - a mídia de uma mensagem da conversa (`message_id`), ou
 *  - uma URL assinada do Storage desta instalação (`signed_url`).
 *
 * Nunca uma URL qualquer: buscar o endereço que o agente escreve deixaria o
 * texto dele escolher para onde o servidor liga (SSRF). A URL assinada é só
 * LIDA para saber qual objeto ela aponta (`objetoDaUrlAssinada`); quem baixa é
 * o cliente do Storage, pelo par bucket + caminho, sempre sob o prefixo da
 * organização do token.
 *
 * `organization_id` SEMPRE do `ctx`, NUNCA do input.
 */
import { z } from "zod";

import {
  BUCKET_DAS_MIDIAS_DE_CONVERSA,
  BUCKET_DOS_ANEXOS,
  COLUNAS_DO_ANEXO_COM_CAMPO,
  VALIDADE_DO_LINK_DO_ANEXO_S,
  camposDeArquivoDoNegocio,
  gravarAnexoDoNegocio,
  listarAnexosDoNegocio,
  objetoDaUrlAssinada,
  recusaDoArquivo,
  type CampoDeArquivo,
} from "@/lib/leads/anexos-do-negocio";
import { nomeOriginalDaMensagem } from "@/lib/messaging/media/nome-de-arquivo";
import {
  isLeadAttachmentPathOwnedBy,
  isMediaPathInOrganization,
} from "@/lib/messaging/media/upload-validation";
import { customFieldSchema } from "@/lib/schemas/settings";
import { auditoriaDoContexto } from "../ator-do-contexto";
import { comChaveDoPedido } from "../idempotencia";
import {
  CONSULTA_INDISPONIVEL,
  negocioDoContexto,
  recusa,
  type RecusaParaOAgente,
} from "../negocio-do-contexto";
import type { McpContext, McpToolDefinition } from "../types";

// ---------------------------------------------------------------------------
// crm_list_lead_attachments
// ---------------------------------------------------------------------------

const listaInputShape = {
  lead_id: z.string().uuid(),
  field_key: z.string().trim().min(1).max(64).optional(),
};

export const crmListLeadAttachments: McpToolDefinition<typeof listaInputShape> = {
  name: "crm_list_lead_attachments",
  description:
    "Lista os documentos anexados a um negócio: nome, tipo, tamanho, campo de arquivo e um " +
    "link assinado que vence em um minuto (liste de novo para obter outro).",
  inputSchema: listaInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const negocio = await negocioDoContexto(ctx, input.lead_id);
    if (!negocio.ok) return negocio.recusa;

    const lista = await listarAnexosDoNegocio(
      ctx.supabase,
      ctx.organizationId,
      negocio.lead.id,
      input.field_key,
      COLUNAS_DO_ANEXO_COM_CAMPO,
    );
    if (!lista.ok) return CONSULTA_INDISPONIVEL;

    const attachments = [];
    for (const linha of lista.linhas) {
      // O link sai com service role: só assina o que mora sob o prefixo DESTE
      // negócio. Linha com caminho fora dele aparece sem link, nunca com o de outro.
      let url: string | null = null;
      if (
        linha.storage_path &&
        isLeadAttachmentPathOwnedBy(linha.storage_path, ctx.organizationId, negocio.lead.id)
      ) {
        const { data } = await ctx.supabase.storage
          .from(BUCKET_DOS_ANEXOS)
          .createSignedUrl(linha.storage_path, VALIDADE_DO_LINK_DO_ANEXO_S);
        url = data?.signedUrl ?? null;
      }
      attachments.push({
        id: linha.id,
        name: linha.file_name,
        type: linha.mime_type,
        size: Number(linha.file_size) || 0,
        field_key: linha.field_key ?? null,
        created_at: linha.created_at,
        url,
        url_expires_in_seconds: url ? VALIDADE_DO_LINK_DO_ANEXO_S : null,
      });
    }

    return { lead_id: negocio.lead.id, attachments };
  },
};

// ---------------------------------------------------------------------------
// crm_attach_to_lead
// ---------------------------------------------------------------------------

const anexoInputShape = {
  lead_id: z.string().uuid(),
  message_id: z
    .string()
    .uuid()
    .optional()
    .describe("A mensagem da conversa que trouxe o arquivo."),
  signed_url: z
    .string()
    .max(2048)
    .optional()
    .describe("Alternativa: URL assinada devolvida por ESTE CRM. Endereço de fora é recusado."),
  // A MESMA régua da chave que o funil aceita ao cadastrar o campo: ela entra
  // no caminho do objeto no Storage.
  field_key: customFieldSchema.shape.key
    .optional()
    .describe("Campo de arquivo do funil; dispensável quando há um só."),
  file_name: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .optional()
    .describe("Padrão: o nome original."),
};

/** O arquivo de origem, já localizado no Storage do CRM. */
interface Origem {
  bucket: string;
  caminho: string;
  nome: string | null;
  tipo: string | null;
  tamanho: number | null;
  mensagem: string | null;
}

async function origemDoAnexo(
  ctx: McpContext,
  input: { message_id?: string; signed_url?: string },
): Promise<{ ok: true; origem: Origem } | { ok: false; recusa: RecusaParaOAgente }> {
  if (input.message_id) {
    const { data, error } = await ctx.supabase
      .from("messages")
      .select("id, media_storage_path, media_mime, media_size_bytes, metadata")
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.message_id)
      .maybeSingle();
    if (error) return { ok: false, recusa: CONSULTA_INDISPONIVEL };
    const mensagem = data as {
      id: string;
      media_storage_path: string | null;
      media_mime: string | null;
      media_size_bytes: number | null;
      metadata: unknown;
    } | null;
    if (!mensagem) {
      return {
        ok: false,
        recusa: recusa(
          "mensagem_nao_encontrada",
          "não existe mensagem com esse id nesta organização. Use o `id` de uma mensagem do histórico da conversa.",
        ),
      };
    }
    const caminho = mensagem.media_storage_path;
    if (!caminho || !isMediaPathInOrganization(caminho, ctx.organizationId)) {
      return {
        ok: false,
        recusa: recusa(
          "mensagem_sem_arquivo",
          "esta mensagem não tem arquivo guardado no CRM (é só texto, ou a mídia já foi removida).",
        ),
      };
    }
    return {
      ok: true,
      origem: {
        bucket: BUCKET_DAS_MIDIAS_DE_CONVERSA,
        caminho,
        nome: nomeOriginalDaMensagem(mensagem.metadata),
        tipo: mensagem.media_mime,
        tamanho: mensagem.media_size_bytes,
        mensagem: mensagem.id,
      },
    };
  }

  const objeto = objetoDaUrlAssinada(
    input.signed_url ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    ctx.organizationId,
  );
  if (!objeto) {
    return {
      ok: false,
      recusa: recusa(
        "url_nao_aceita",
        "só aceito URL assinada que este CRM devolveu, de um arquivo desta organização. " +
          "Endereço de fora não é buscado: use o `message_id` da mensagem que trouxe o arquivo.",
      ),
    };
  }
  return {
    ok: true,
    origem: {
      bucket: objeto.bucket,
      caminho: objeto.caminho,
      nome: objeto.caminho.split("/").pop() ?? null,
      tipo: null,
      tamanho: null,
      mensagem: null,
    },
  };
}

/** Qual campo de arquivo do funil recebe o anexo — ou por que nenhum. */
function escolherCampo(
  campos: CampoDeArquivo[],
  pedido: string | undefined,
): { ok: true; campo: CampoDeArquivo } | { ok: false; recusa: RecusaParaOAgente } {
  const disponiveis = campos.map((c) => ({ field_key: c.key, label: c.label ?? c.key }));
  if (campos.length === 0) {
    return {
      ok: false,
      recusa: recusa(
        "funil_sem_campo_de_arquivo",
        "o funil deste negócio não tem campo de arquivo, então não há onde anexar. Quem " +
          "administra o funil precisa criar um campo do tipo arquivo.",
      ),
    };
  }
  if (pedido) {
    const campo = campos.find((c) => c.key === pedido);
    if (campo) return { ok: true, campo };
    return {
      ok: false,
      recusa: recusa(
        "campo_de_arquivo_inexistente",
        "o funil deste negócio não tem um campo de arquivo com essa chave. Escolha um de `available_fields`.",
        { available_fields: disponiveis },
      ),
    };
  }
  if (campos.length === 1) return { ok: true, campo: campos[0]! };
  return {
    ok: false,
    recusa: recusa(
      "campo_de_arquivo_ambiguo",
      "o funil deste negócio tem mais de um campo de arquivo. Diga em `field_key` qual deles (ver `available_fields`).",
      { available_fields: disponiveis },
    ),
  };
}

const ARQUIVO_GRANDE_DEMAIS = recusa(
  "arquivo_grande_demais",
  "o arquivo excede o limite de 50 MB dos anexos do negócio.",
);

function tipoNaoAceito(tipo: string): RecusaParaOAgente {
  return recusa(
    "tipo_de_arquivo_nao_aceito",
    "o negócio só aceita PDF ou imagem (PNG, JPG, WebP) como anexo.",
    { type: tipo },
  );
}

export const crmAttachToLead: McpToolDefinition<typeof anexoInputShape> = {
  name: "crm_attach_to_lead",
  description:
    "Anexa ao negócio um arquivo que JÁ está no CRM: informe `message_id` (a mídia de uma " +
    "mensagem da conversa) OU `signed_url` (URL assinada deste CRM). Aceita PDF e imagem de até " +
    "50 MB; aparece no card e na linha do tempo.",
  inputSchema: anexoInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  // A URL assinada carrega um token de acesso ao arquivo: fora da auditoria.
  redigirParaAuditoria: (args) =>
    typeof args.signed_url === "string" ? { ...args, signed_url: "[redacted]" } : args,
  handler: async (input, ctx) =>
    comChaveDoPedido(ctx, "crm_attach_to_lead", input, async () => {
      if (Boolean(input.message_id) === Boolean(input.signed_url)) {
        return recusa(
          "origem_do_arquivo_invalida",
          "informe `message_id` OU `signed_url` — exatamente um dos dois.",
        );
      }

      // Num turno de atendimento a origem tem de ter DONO conferível: a ponte
      // confere que a mensagem é do cliente da conversa (`message_id`, dono
      // `mensagem` em `ESCOPO_DAS_ESCRITAS`). Uma URL não diz de quem é o
      // arquivo — ela só diz de qual organização —, então no turno ela não entra.
      if (ctx.contatoDoTurno && input.signed_url) {
        return recusa(
          "origem_do_arquivo_invalida",
          "durante a conversa, anexe pelo `message_id` da mensagem que trouxe o arquivo.",
        );
      }

      const negocio = await negocioDoContexto(ctx, input.lead_id);
      if (!negocio.ok) return negocio.recusa;

      const escolha = escolherCampo(
        await camposDeArquivoDoNegocio(ctx.supabase, negocio.lead.pipeline_id),
        input.field_key,
      );
      if (!escolha.ok) return escolha.recusa;

      const localizada = await origemDoAnexo(ctx, input);
      if (!localizada.ok) return localizada.recusa;
      const { origem } = localizada;

      // O que já se sabe sem baixar é conferido antes de baixar.
      if (origem.tamanho !== null && origem.tipo !== null) {
        const antes = recusaDoArquivo({ tipo: origem.tipo, tamanho: origem.tamanho });
        if (antes === "grande_demais") return ARQUIVO_GRANDE_DEMAIS;
        if (antes === "tipo_nao_aceito") return tipoNaoAceito(origem.tipo);
      }

      const baixado = await ctx.supabase.storage.from(origem.bucket).download(origem.caminho);
      if (baixado.error || !baixado.data) {
        return recusa(
          "arquivo_indisponivel",
          "não consegui ler o arquivo no armazenamento do CRM (ele pode ter sido removido).",
        );
      }
      const bytes = new Uint8Array(await baixado.data.arrayBuffer());
      const tipo = (origem.tipo ?? baixado.data.type ?? "").split(";")[0]!.trim().toLowerCase();

      // A régua da tela, sobre o arquivo de verdade: o tamanho é o dos bytes lidos.
      const veredito = recusaDoArquivo({ tipo, tamanho: bytes.byteLength });
      if (veredito === "grande_demais") return ARQUIVO_GRANDE_DEMAIS;
      if (veredito === "tipo_nao_aceito") return tipoNaoAceito(tipo);

      const gravacao = await gravarAnexoDoNegocio({
        supabase: ctx.supabase,
        admin: ctx.supabase,
        organizationId: ctx.organizationId,
        leadId: negocio.lead.id,
        campo: escolha.campo,
        arquivo: {
          nome: input.file_name ?? origem.nome ?? "arquivo",
          tipo,
          tamanho: bytes.byteLength,
          bytes,
        },
        // `created_by` é chave estrangeira para pessoa; quem anexou foi um agente.
        criadoPor: null,
        ator: ctx.actor,
        auditoria: auditoriaDoContexto(
          ctx,
          origem.mensagem ? { source_message_id: origem.mensagem } : {},
        ),
        origem: origem.mensagem ? { source_message_id: origem.mensagem } : {},
      });
      if (!gravacao.ok) {
        return recusa("indisponivel", "não consegui gravar o anexo agora; tente de novo em instantes.");
      }

      return {
        attachment: {
          id: gravacao.anexo.id,
          name: gravacao.anexo.file_name,
          type: gravacao.anexo.mime_type,
          size: Number(gravacao.anexo.file_size) || 0,
          field_key: escolha.campo.key,
          created_at: gravacao.anexo.created_at,
        },
        lead_id: negocio.lead.id,
        next_action: "Arquivo anexado ao negócio; ele aparece no card e na linha do tempo.",
      };
    }),
};
