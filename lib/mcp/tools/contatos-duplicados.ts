/**
 * Handlers de CONTATOS DUPLICADOS por MCP.
 *
 *  Read:
 *   - crm_find_duplicate_contacts
 *  Write (papel `manager`, `apenasHumano` no catálogo, risco crítico):
 *   - crm_merge_contacts
 *   - crm_undo_contact_merge
 *
 * A regra não tem cópia aqui. A detecção é a da tela
 * (`lib/contacts/varredura-de-duplicados.ts`), e a junção é a
 * `fn_mesclar_contatos` de sempre, chamada pela função que guarda o registro
 * (`lib/contacts/fusao-de-contatos.ts`, migration 9813).
 *
 * `organization_id` SEMPRE do `ctx` (o token), NUNCA do input. Contato de outra
 * organização e contato que não existe recebem a mesma recusa.
 *
 * ─── Por que `manager` + `apenasHumano` ─────────────────────────────────────
 * Juntar contatos pela tela exige gerente (`POST /api/v1/contacts/merge`), e a
 * ferramenta segue a rota. O agente nativo roda como `ai_operator`, abaixo de
 * `manager`: ele não alcança as duas escritas, e a ponte do turno nem as monta.
 * Quem usa é o agente externo cujo token o administrador marcou como "tratado
 * como gerente" (escopo `role:manager`).
 *
 * A leitura é `agent`, como a busca de contatos. Num turno de atendimento ela
 * recusa: a lista traz telefone e e-mail de outras pessoas, e a conversa é com
 * uma só.
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { ROLE_RANK } from "@/lib/auth/types";
import type { MotivoDeDuplicidade } from "@/lib/contacts/duplicados";
import {
  desfazerFusaoDeContatos,
  mesclarContatosComRegistro,
  registroAbertoDaFusao,
  type RotuloDeRecusaDaFusao,
} from "@/lib/contacts/fusao-de-contatos";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { varrerContatosDuplicados } from "@/lib/contacts/varredura-de-duplicados";
import { auditoriaDoContexto, autorDoContexto } from "../ator-do-contexto";
import { comChaveDoPedido } from "../idempotencia";
import { CONSULTA_INDISPONIVEL, recusa, type RecusaParaOAgente } from "../negocio-do-contexto";
import type { McpContext, McpToolDefinition } from "../types";

const MOTIVOS = ["telefone", "email", "telefone_em_conflito", "nome_parecido"] as const;

/** Lotes de `in("contact_id", …)`: o mesmo tamanho de `lib/contacts/dispensar-par.ts`. */
const LOTE_DE_CONTATOS = 100;

const FORA_DO_ATENDIMENTO = recusa(
  "fora_do_atendimento",
  "contatos duplicados são limpeza da base, não desta conversa: a lista traz dados de outras " +
    "pessoas. Siga a conversa com quem está falando.",
);

const PAPEL_INSUFICIENTE = recusa(
  "papel_insuficiente",
  "juntar contatos e desfazer a junção exigem papel de gerente. O administrador libera isso " +
    "na tela de tokens (\"tratado como gerente\"); sem isso, avise uma pessoa da equipe.",
);

/** Papel conferido também aqui: o servidor MCP já barra antes, e a defesa não depende dele. */
function semPapelDeGerente(ctx: McpContext): boolean {
  return (ROLE_RANK[ctx.role] ?? 0) < ROLE_RANK.manager;
}

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

// ---------------------------------------------------------------------------
// crm_merge_contacts
// ---------------------------------------------------------------------------

interface ContatoDaFusao {
  id: string;
  is_personal: boolean | null;
  kind: string | null;
  is_anonymized: boolean | null;
  is_merged_into: string | null;
}

const CONTATO_NAO_ENCONTRADO = recusa(
  "contato_nao_encontrado",
  "um dos contatos não existe nesta organização. Contato de outra organização nunca é juntado. " +
    "Confira os ids com `crm_find_duplicate_contacts`.",
);

async function lerContatosDaFusao(
  ctx: McpContext,
  ids: string[],
): Promise<Map<string, ContatoDaFusao> | null> {
  const { data, error } = await ctx.supabase
    .from("contacts")
    .select("id, is_personal, kind, is_anonymized, is_merged_into")
    .eq("organization_id", ctx.organizationId)
    .in("id", ids);
  if (error) return null;
  return new Map(((data ?? []) as ContatoDaFusao[]).map((c) => [c.id.toLowerCase(), c] as const));
}

/** A recusa que o banco levantou, na frase que o agente lê. */
function recusaDoBanco(rotulo: RotuloDeRecusaDaFusao): RecusaParaOAgente {
  switch (rotulo) {
    case "fusao_de_contato_pessoal":
      return recusa(
        "contato_pessoal",
        "um dos contatos está marcado como pessoal — fora da operação: não é juntado por agente.",
      );
    case "fusao_de_contato_de_grupo":
      return recusa(
        "contato_de_grupo",
        "um dos contatos representa um grupo de WhatsApp, não uma pessoa: não é juntado.",
      );
    case "contato_principal_indisponivel":
    case "contato_secundario_indisponivel":
    case "contato_da_fusao_indisponivel":
      return recusa(
        "contato_indisponivel",
        "um dos contatos mudou enquanto o pedido rodava (foi anonimizado ou juntado em outro). " +
          "Leia os dois de novo antes de tentar outra vez.",
      );
    case "selecao_de_mesclagem_invalida":
    case "secundario_repetido":
      return recusa(
        "mesmo_contato",
        "os dois ids são do mesmo contato: não há o que juntar.",
      );
    case "registro_de_fusao_nao_encontrado":
      return recusa(
        "registro_nao_encontrado",
        "não existe registro de junção com esse id nesta organização.",
      );
    case "fusao_de_contato_anonimizado":
      return recusa(
        "contato_anonimizado",
        "um dos contatos foi anonimizado depois da junção. Anonimização não tem volta: esta " +
          "junção não pode mais ser desfeita.",
      );
    case "principal_da_fusao_foi_absorvido":
      return recusa(
        "principal_ja_unificado",
        "o contato que ficou nesta junção foi juntado em outro depois. Desfaça primeiro a junção " +
          "mais recente.",
      );
    case "absorvido_fora_desta_fusao":
      return recusa(
        "juncao_alterada",
        "o contato absorvido não está mais nesta junção (alguém mexeu nele por fora). Nada foi desfeito.",
      );
    case "conflito_ao_desfazer_fusao":
      return recusa(
        "conflito_ao_desfazer",
        "o contato absorvido não pode voltar: outro contato passou a usar o mesmo telefone, " +
          "e-mail ou identidade de canal. Nada foi desfeito. Uma pessoa da equipe precisa " +
          "resolver o conflito na tela de contatos.",
      );
    case "registro_de_fusao_em_mudanca":
      return recusa(
        "pedido_em_andamento",
        "outra junção está mexendo neste registro agora. Espere alguns segundos e tente de novo.",
      );
    case "support_readonly":
      return recusa(
        "somente_leitura",
        "a organização está em modo somente leitura (suporte). Nada foi alterado.",
      );
    case "insufficient_role":
      return PAPEL_INSUFICIENTE;
  }
}

/** O que a junção faz e o desfazer não devolve — dito em toda resposta de escrita. */
const O_QUE_NAO_VOLTA = [
  "as etiquetas: o contato que fica continua com as etiquetas dos dois",
  "o telefone extra do absorvido que repetia o número do contato que fica",
  "linhas de tabela sem identificador próprio (vêm contadas em `not_recorded`)",
  "o que for criado no contato que fica depois da junção, fora das conversas e dos negócios devolvidos",
  "campo herdado que alguém alterar depois",
];

const fusaoInputShape = {
  primary_contact_id: z.string().uuid().describe("O contato que FICA."),
  duplicate_contact_id: z.string().uuid().describe("O contato que será absorvido."),
  reason: z
    .string()
    .trim()
    .min(10)
    .max(500)
    .describe("Por que são a mesma pessoa. Fica na auditoria."),
};

export const crmMergeContacts: McpToolDefinition<typeof fusaoInputShape> = {
  name: "crm_merge_contacts",
  description:
    "Junta dois contatos da MESMA pessoa: conversas, negócios, tarefas e mensagens do absorvido " +
    "passam para o que fica, que herda só o que não tinha (nunca o nome). Exige papel de gerente. " +
    "Guarda um registro (`merge_record_id`) para `crm_undo_contact_merge`. Não junte por " +
    "`nome_parecido` sem outra evidência.",
  inputSchema: fusaoInputShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) =>
    comChaveDoPedido(ctx, "crm_merge_contacts", input, async () => {
      if (semPapelDeGerente(ctx)) return PAPEL_INSUFICIENTE;
      if (ctx.contatoDoTurno) return FORA_DO_ATENDIMENTO;

      const principal = input.primary_contact_id.toLowerCase();
      const absorvido = input.duplicate_contact_id.toLowerCase();
      if (principal === absorvido) {
        return recusa("mesmo_contato", "os dois ids são do mesmo contato: não há o que juntar.");
      }

      const contatos = await lerContatosDaFusao(ctx, [principal, absorvido]);
      if (!contatos) return CONSULTA_INDISPONIVEL;
      const fica = contatos.get(principal);
      const sai = contatos.get(absorvido);
      // Uma recusa só para "não existe" e para "é de outra organização".
      if (!fica || !sai) return CONTATO_NAO_ENCONTRADO;

      if (fica.is_personal === true || sai.is_personal === true) {
        return recusaDoBanco("fusao_de_contato_pessoal");
      }
      if ((fica.kind ?? "person") !== "person" || (sai.kind ?? "person") !== "person") {
        return recusaDoBanco("fusao_de_contato_de_grupo");
      }
      if (fica.is_anonymized === true || sai.is_anonymized === true) {
        return recusa(
          "contato_anonimizado",
          "um dos contatos foi anonimizado. Contato anonimizado não é juntado.",
        );
      }

      // Repetir o MESMO pedido não junta de novo nem vira erro.
      if (sai.is_merged_into) {
        if (sai.is_merged_into.toLowerCase() === principal) {
          const registro = await registroAbertoDaFusao(ctx.supabase, ctx.organizationId, sai.id);
          return {
            merged: true,
            already_merged: true,
            contact_id: fica.id,
            merged_contact_id: sai.id,
            merge_record_id: registro?.id ?? null,
          };
        }
        return recusa(
          "contato_ja_unificado",
          "o contato a absorver já foi juntado em outro contato. Leia `merged_into` e decida a " +
            "partir dele.",
          { merged_into: sai.is_merged_into },
        );
      }
      if (fica.is_merged_into) {
        return recusa(
          "principal_ja_unificado",
          "o contato escolhido para ficar já foi juntado em outro. Use `merged_into` como o " +
            "contato que fica.",
          { merged_into: fica.is_merged_into },
        );
      }

      const desfecho = await mesclarContatosComRegistro(ctx.supabase, {
        organizationId: ctx.organizationId,
        principal: fica.id,
        absorvido: sai.id,
        tokenId: ctx.apiTokenId,
      });
      if (!desfecho.ok) {
        return desfecho.recusa ? recusaDoBanco(desfecho.recusa) : CONSULTA_INDISPONIVEL;
      }
      const r = desfecho.resultado;

      // O rastro que existe sempre: quem juntou (o token e, se houver, o agente),
      // por quê, e o registro que desfaz. A linha do tempo só existe quando o
      // contato tem negócio.
      const autor = await autorDoContexto(ctx);
      await audit({
        action: "contact.merged",
        organizationId: ctx.organizationId,
        resourceType: "contact",
        resourceId: fica.id,
        ...auditoriaDoContexto(ctx, {
          actor_name: autor.nome,
          reason: input.reason,
          merged_contact_ids: [sai.id],
          merge_record_id: r.registro_id,
          repointed: r.repontado,
          not_repointed: r.nao_repontado,
          not_recorded: r.sem_registro,
          timeline_activities: r.atividades_emitidas,
        }),
      });

      return {
        merged: true,
        already_merged: false,
        contact_id: fica.id,
        merged_contact_id: sai.id,
        merge_record_id: r.registro_id,
        moved: r.repontado,
        // Linha que colidiu com uma regra de unicidade e continuou no contato absorvido.
        not_moved: r.nao_repontado,
        not_recorded: r.sem_registro,
        absorbed_names: r.nomes_absorvidos ?? [],
        undo: "Para voltar atrás: `crm_undo_contact_merge` com este `merge_record_id`.",
        undo_does_not_restore: O_QUE_NAO_VOLTA,
      };
    }),
};

// ---------------------------------------------------------------------------
// crm_undo_contact_merge
// ---------------------------------------------------------------------------

const desfazerInputShape = {
  merge_record_id: z.string().uuid().optional().describe("O registro que a junção devolveu."),
  merged_contact_id: z
    .string()
    .uuid()
    .optional()
    .describe("Ou o contato absorvido, quando não há o registro em mãos."),
  reason: z.string().trim().min(10).max(500).describe("Por que desfazer. Fica na auditoria."),
};

export const crmUndoContactMerge: McpToolDefinition<typeof desfazerInputShape> = {
  name: "crm_undo_contact_merge",
  description:
    "Desfaz uma junção feita por `crm_merge_contacts`: o contato absorvido volta a existir com " +
    "as conversas, negócios, tarefas e mensagens que eram dele. Informe `merge_record_id` ou " +
    "`merged_contact_id` (um só). Exige papel de gerente. Junção feita pela tela não tem " +
    "registro e não é desfeita. A resposta diz o que voltou e o que não voltou.",
  inputSchema: desfazerInputShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) =>
    comChaveDoPedido(ctx, "crm_undo_contact_merge", input, async () => {
      if (semPapelDeGerente(ctx)) return PAPEL_INSUFICIENTE;
      if (ctx.contatoDoTurno) return FORA_DO_ATENDIMENTO;

      if ((input.merge_record_id === undefined) === (input.merged_contact_id === undefined)) {
        return recusa(
          "alvo_invalido",
          "informe exatamente um: `merge_record_id` (o registro) ou `merged_contact_id` (o contato absorvido).",
        );
      }

      let registroId = input.merge_record_id ?? null;
      if (!registroId) {
        const absorvido = input.merged_contact_id!;
        const contatos = await lerContatosDaFusao(ctx, [absorvido]);
        if (!contatos) return CONSULTA_INDISPONIVEL;
        const contato = contatos.get(absorvido.toLowerCase());
        if (!contato) return CONTATO_NAO_ENCONTRADO;
        const registro = await registroAbertoDaFusao(ctx.supabase, ctx.organizationId, contato.id);
        if (!registro) {
          return contato.is_merged_into
            ? recusa(
                "fusao_sem_registro",
                "este contato foi juntado pela tela, que não guarda registro do que mudou. Não há " +
                  "como desfazer por aqui: uma pessoa da equipe precisa separar os dados à mão.",
                { merged_into: contato.is_merged_into },
              )
            : recusa(
                "contato_nao_unificado",
                "este contato não está juntado em outro: não há junção para desfazer.",
              );
        }
        registroId = registro.id;
      }

      const desfecho = await desfazerFusaoDeContatos(ctx.supabase, {
        organizationId: ctx.organizationId,
        registroId,
        tokenId: ctx.apiTokenId,
      });
      if (!desfecho.ok) {
        return desfecho.recusa ? recusaDoBanco(desfecho.recusa) : CONSULTA_INDISPONIVEL;
      }
      const r = desfecho.resultado;

      // Repetição não desfaz de novo, então não audita de novo.
      if (!r.ja_desfeita) {
        const autor = await autorDoContexto(ctx);
        await audit({
          action: "contact.merge_undone",
          organizationId: ctx.organizationId,
          resourceType: "contact",
          resourceId: r.contato_principal_id ?? null,
          ...auditoriaDoContexto(ctx, {
            actor_name: autor.nome,
            reason: input.reason,
            merge_record_id: r.registro_id,
            restored_contact_id: r.contato_restaurado_id ?? null,
            restored: r.voltou ?? {},
            not_restored: r.nao_voltou ?? {},
            fields_returned: r.campos_devolvidos ?? [],
            fields_kept: r.campos_mantidos ?? [],
          }),
        });
      }

      return {
        undone: true,
        already_undone: r.ja_desfeita,
        merge_record_id: r.registro_id,
        contact_id: r.contato_principal_id ?? null,
        restored_contact_id: r.contato_restaurado_id ?? null,
        restored: r.voltou ?? {},
        // Linha registrada que não estava mais no contato que ficou (alguém a moveu ou apagou).
        not_restored: r.nao_voltou ?? {},
        // Campos que o contato que ficou tinha herdado: os devolvidos e os que alguém alterou depois.
        fields_returned: r.campos_devolvidos ?? [],
        fields_kept: r.campos_mantidos ?? [],
        not_recorded: r.sem_registro ?? {},
        did_not_restore: O_QUE_NAO_VOLTA,
      };
    }),
};
