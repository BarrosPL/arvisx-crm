/**
 * Handler de CONTATOS DUPLICADOS por MCP.
 *
 *  Read:
 *   - crm_find_duplicate_contacts
 *
 * A regra não tem cópia aqui: a detecção é a da tela
 * (`lib/contacts/varredura-de-duplicados.ts`).
 *
 * `organization_id` SEMPRE do `ctx` (o token), NUNCA do input. Contato de outra
 * organização nunca entra na lista.
 *
 * ─── Só a leitura (revisão 20/11, item 1.2, Opção A) ────────────────────────
 * Este arquivo trazia também `crm_merge_contacts` e `crm_undo_contact_merge`.
 * As duas saíram do MCP por decisão do dono (23/11): a tarefa AJ-3 só previa a
 * junção por agente com autorização dele, e o servidor MCP não aplica
 * `apenasHumano`, então bastava um token marcado como "tratado como gerente"
 * para unir contatos. Juntar contatos continua sendo gesto da tela
 * (`POST /api/v1/contacts/merge`, papel gerente). A migration 9813 e as funções
 * do banco (`fn_mesclar_contatos_com_registro`, `fn_desfazer_fusao_de_contatos`)
 * ficaram, sem porta por MCP; `tests/unit/mcp-contatos-duplicados.test.ts`
 * prova a ausência no servidor e no catálogo.
 *
 * A leitura é `agent`, como a busca de contatos. Num turno de atendimento ela
 * recusa: a lista traz telefone e e-mail de outras pessoas, e a conversa é com
 * uma só.
 */
import { z } from "zod";

import type { MotivoDeDuplicidade } from "@/lib/contacts/duplicados";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { varrerContatosDuplicados } from "@/lib/contacts/varredura-de-duplicados";
import { CONSULTA_INDISPONIVEL, recusa } from "../negocio-do-contexto";
import type { McpContext, McpToolDefinition } from "../types";

const MOTIVOS = ["telefone", "email", "telefone_em_conflito", "nome_parecido"] as const;

/** Lotes de `in("contact_id", …)`: o mesmo tamanho de `lib/contacts/dispensar-par.ts`. */
const LOTE_DE_CONTATOS = 100;

const FORA_DO_ATENDIMENTO = recusa(
  "fora_do_atendimento",
  "contatos duplicados são limpeza da base, não desta conversa: a lista traz dados de outras " +
    "pessoas. Siga a conversa com quem está falando.",
);

// ---------------------------------------------------------------------------
// crm_find_duplicate_contacts
// ---------------------------------------------------------------------------

const buscaInputShape = {
  reason: z.array(z.enum(MOTIVOS)).optional().describe("Só estes motivos. Sem ele, todos."),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0),
};

async function negociosPorContato(
  ctx: McpContext,
  contatos: string[],
): Promise<Map<string, number> | null> {
  const contagem = new Map<string, number>();
  for (let i = 0; i < contatos.length; i += LOTE_DE_CONTATOS) {
    const { data, error } = await ctx.supabase
      .from("crm_leads")
      .select("contact_id")
      .eq("organization_id", ctx.organizationId)
      .in("contact_id", contatos.slice(i, i + LOTE_DE_CONTATOS));
    if (error) return null;
    for (const linha of (data ?? []) as Array<{ contact_id: string | null }>) {
      if (!linha.contact_id) continue;
      contagem.set(linha.contact_id, (contagem.get(linha.contact_id) ?? 0) + 1);
    }
  }
  return contagem;
}

export const crmFindDuplicateContacts: McpToolDefinition<typeof buscaInputShape> = {
  name: "crm_find_duplicate_contacts",
  description:
    "Grupos de contatos que parecem a mesma pessoa, em toda a base (contato não é de um funil): " +
    "mesmo telefone (com ou sem o nono dígito), mesmo e-mail, telefone em conflito ou nome " +
    "parecido. `nome_parecido` é sugestão para conferir, não prova. Cada contato traz nome, " +
    "telefone, e-mail e quantos negócios tem. `scanned_all: false` = base maior que a varredura.",
  inputSchema: buscaInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    if (ctx.contatoDoTurno) return FORA_DO_ATENDIMENTO;

    // O cliente do MCP é de serviço (sem RLS): a varredura filtra a organização
    // do token em toda leitura, e `soDaOperacao` tira pessoal e grupo.
    const varredura = await varrerContatosDuplicados(
      { contatos: ctx.supabase, dispensas: ctx.supabase },
      ctx.organizationId,
      { soDaOperacao: true },
    );
    if (!varredura.ok) return CONSULTA_INDISPONIVEL;

    const pedidos = input.reason ? new Set<MotivoDeDuplicidade>(input.reason) : null;
    const grupos = pedidos
      ? varredura.grupos.filter(({ grupo }) => grupo.motivos.some((m) => pedidos.has(m)))
      : varredura.grupos;
    const pagina = grupos.slice(input.offset, input.offset + input.limit);

    const ids = [...new Set(pagina.flatMap(({ grupo }) => grupo.contatos.map((c) => c.id)))];
    const negocios = await negociosPorContato(ctx, ids);
    if (!negocios) return CONSULTA_INDISPONIVEL;

    return {
      groups: pagina.map(({ grupo, principalSugerido }) => ({
        key: grupo.chave,
        reasons: grupo.motivos,
        suggested_primary_id: principalSugerido,
        // Os mesmos campos de `crm_search_contacts`, nada além: sem CPF, sem
        // endereço, sem o que a ingestão guardou em `source_metadata`.
        contacts: grupo.contatos.map((c) => ({
          id: c.id,
          name: nomeDoContato(c),
          phone: c.phone_number,
          email: c.email,
          leads_count: negocios.get(c.id) ?? 0,
          created_at: c.created_at,
          last_activity_at: c.last_activity_at,
        })),
      })),
      total_groups: grupos.length,
      has_more: input.offset + pagina.length < grupos.length,
      scanned_all: varredura.varreuTudo,
      contacts_scanned: varredura.contatosVarridos,
    };
  },
};
