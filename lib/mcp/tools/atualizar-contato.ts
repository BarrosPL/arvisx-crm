/**
 * MCP write tool — crm_update_contact.
 *
 * Grava DIRETO no cadastro do contato o que a pessoa informou: nome, e-mail,
 * telefone secundário, documento (CPF), endereço, data de nascimento e campos
 * personalizados. É a ferramenta dos papéis da Equipe pronta (decisão do dono:
 * "os agentes gravam tudo direto"); `crm_propose_contact_field`, que só propõe
 * para uma pessoa confirmar, continua existindo e os demais agentes seguem com
 * ela.
 *
 * ═══ O que ela reusa ═══
 *
 * A escrita é o `patchContactHandler` da rota `PATCH /api/v1/contacts/[id]`: a
 * mesma régua de campo personalizado, o mesmo tratamento de e-mail repetido
 * (409 com o contato que já tem o dado), os mesmos eventos (`contact.updated`,
 * `contact.phone_added`). Nada disso é reescrito aqui.
 *
 * ═══ O documento (CPF) ═══
 *
 *  - Validado pela régua do PAÍS da organização (`perfilDaOrganizacao`): no
 *    Brasil, o dígito verificador.
 *  - Gravado como o resto do produto grava: cifrado no banco, com o hash ao
 *    lado (`camposCpfParaGravar`). Se a cifra não estiver disponível, o
 *    documento NÃO é gravado, e a resposta diz isso.
 *  - NUNCA volta em claro: nem na resposta, nem na auditoria da chamada
 *    (`redigirParaAuditoria`), nem na auditoria da mudança. A resposta só diz
 *    `cpf_available`.
 *
 * ═══ Auditoria ═══
 *
 * Uma linha `contact.updated_by_agent`, com o agente como autor e o valor
 * ANTERIOR de cada campo alterado, para a equipe poder desfazer. Campo
 * personalizado sai pelo nome (o valor é dado de titular em texto livre, e a
 * auditoria não é alcançada pela anonimização); o documento sai só como
 * "tinha / passou a ter".
 *
 * `organization_id` SEMPRE do contexto, nunca do input. Num turno de
 * atendimento, só o contato da conversa.
 */
import { z } from "zod";

import { patchContactHandler } from "@/app/api/v1/contacts/_handler";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { canonicalPhoneBR } from "@/lib/channels/phone-variants";
import { hashCpf } from "@/lib/contacts/cpf";
import { perfilDaOrganizacao } from "@/lib/legal/perfil-do-pais";
import { contactPatchSchemaDoPais, type ContactPatch } from "@/lib/schemas/contacts";
import { auditoriaDoContexto } from "../ator-do-contexto";
import { conferirCamposPersonalizados } from "../conferencia-de-campos";
import {
  CONSULTA_INDISPONIVEL,
  NEGOCIO_DE_CONTATO_PESSOAL,
  NEGOCIO_FORA_DA_CONVERSA,
  recusa,
} from "../negocio-do-contexto";
import type { McpToolDefinition } from "../types";

/** Os campos de texto simples que vão direto para a coluna de mesmo nome. */
const CAMPOS_DIRETOS = [
  "name",
  "email",
  "birthdate",
  "zip_code",
  "street",
  "number",
  "complement",
  "district",
  "city",
  "state",
] as const;
type CampoDireto = (typeof CAMPOS_DIRETOS)[number];

const PROTEGIDO = "[protegido]";

const inputShape = {
  contact_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().max(254).optional(),
  secondary_phone: z
    .string()
    .trim()
    .max(32)
    .optional()
    .describe("Outro telefone da pessoa, com DDD. O principal não muda."),
  cpf: z.string().trim().max(32).optional().describe("Documento da pessoa. Nunca é devolvido."),
  birthdate: z.string().trim().max(10).optional().describe("AAAA-MM-DD."),
  zip_code: z.string().trim().max(16).optional(),
  street: z.string().trim().max(300).optional(),
  number: z.string().trim().max(40).optional(),
  complement: z.string().trim().max(120).optional(),
  district: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(2).optional().describe("UF, 2 letras."),
  custom_fields: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Só as chaves a gravar; as outras ficam como estão."),
};

interface ContatoAntes {
  id: string;
  is_anonymized: boolean | null;
  is_personal: boolean | null;
  phone_number: string | null;
  cpf_hash: string | null;
  custom_fields: Record<string, unknown> | null;
  name: string | null;
  email: string | null;
  birthdate: string | null;
  zip_code: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
}

/** Data de calendário que existe e não está no futuro. */
function dataDeNascimentoValida(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const data = new Date(`${valor}T00:00:00Z`);
  if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== valor) return false;
  return data.getTime() <= Date.now() && data.getUTCFullYear() >= 1900;
}

export const crmUpdateContact: McpToolDefinition<typeof inputShape> = {
  name: "crm_update_contact",
  description:
    "Grava no cadastro do contato o que a PESSOA informou: nome, e-mail, outro telefone, documento (CPF), " +
    "data de nascimento, endereço e campos personalizados. Envie só os campos a gravar. Grava direto, com " +
    "registro do valor anterior. Recusa valor inválido (`email_invalido`, `documento_invalido`, " +
    "`data_invalida`, `telefone_invalido`) dizendo qual. O documento nunca é devolvido: a resposta só diz " +
    "se o cadastro tem um. Nunca grave dado que a pessoa não disse.",
  inputSchema: inputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  // O documento é dado de titular: não entra na auditoria da chamada.
  redigirParaAuditoria: (args) => ("cpf" in args ? { ...args, cpf: PROTEGIDO } : args),
  handler: async (input, ctx) => {
    if (ctx.contatoDoTurno && input.contact_id.toLowerCase() !== ctx.contatoDoTurno.toLowerCase()) {
      return NEGOCIO_FORA_DA_CONVERSA;
    }

    const { data, error } = await ctx.supabase
      .from("contacts")
      .select(
        "id, is_anonymized, is_personal, phone_number, cpf_hash, custom_fields, " + CAMPOS_DIRETOS.join(", "),
      )
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.contact_id)
      .maybeSingle();
    if (error) return CONSULTA_INDISPONIVEL;
    const antes = data as unknown as ContatoAntes | null;
    if (!antes) {
      return ctx.contatoDoTurno
        ? NEGOCIO_FORA_DA_CONVERSA
        : recusa(
            "contato_nao_encontrado",
            "não existe contato com esse id nesta organização. Confira o id e tente de novo.",
          );
    }
    if (antes.is_personal === true) return NEGOCIO_DE_CONTATO_PESSOAL;
    if (antes.is_anonymized === true) {
      return recusa(
        "contato_anonimizado",
        "esse contato exerceu o direito de exclusão de dados; não é possível gravar informações dele.",
      );
    }

    // ── validação: cada recusa diz QUAL campo, para o modelo perguntar de novo ──
    if (input.email !== undefined && !z.string().email().safeParse(input.email).success) {
      return recusa("email_invalido", "o e-mail informado não tem forma de e-mail. Confirme com a pessoa.");
    }
    if (input.birthdate !== undefined && !dataDeNascimentoValida(input.birthdate)) {
      return recusa(
        "data_invalida",
        "a data de nascimento precisa ser uma data real, no formato AAAA-MM-DD, e não pode estar no futuro.",
      );
    }
    // Documento e telefone seguem a régua do PAÍS da organização, a mesma da tela.
    const perfil =
      input.cpf !== undefined || input.secondary_phone !== undefined
        ? await perfilDaOrganizacao(ctx.supabase, ctx.organizationId)
        : null;
    if (input.cpf !== undefined && perfil) {
      if (!perfil.documento.valida(input.cpf)) {
        return recusa(
          "documento_invalido",
          `${perfil.documento.mensagemInvalido}. Peça para a pessoa conferir os números; não corrija por conta própria.`,
        );
      }
    }
    let telefoneExtra: string | null = null;
    if (input.secondary_phone !== undefined && perfil) {
      // A mesma normalização do cadastro pela tela: o número nacional ganha o
      // código do país, e o que não vira E.164 é recusado.
      const lido = contactPatchSchemaDoPais(perfil).shape.phone_number.safeParse(input.secondary_phone);
      if (!lido.success || !lido.data) {
        return recusa("telefone_invalido", "o telefone informado não tem forma de telefone. Peça o número com DDD.");
      }
      telefoneExtra = canonicalPhoneBR(lido.data);
      if (antes.phone_number && canonicalPhoneBR(antes.phone_number) === telefoneExtra) {
        return recusa("telefone_igual_ao_principal", "esse número já é o telefone principal deste contato.");
      }
    }

    // ── o que muda de fato ──
    const patch: ContactPatch = {};
    const mudancas: Record<string, { old: unknown; new: unknown }> = {};
    for (const campo of CAMPOS_DIRETOS) {
      const novo = input[campo as CampoDireto];
      if (novo === undefined || novo === (antes[campo] ?? null)) continue;
      (patch as Record<string, unknown>)[campo] = novo;
      mudancas[campo] = { old: antes[campo] ?? null, new: novo };
    }
    // A IA só grava o que a PESSOA disse: a mesma conferência dos campos do
    // negócio (`crm_update_lead`), com as definições de escopo `contato`. O
    // campo recusado sai da gravação e volta como erro de ensino; os outros
    // campos da mesma chamada seguem.
    const conferencia = await conferirCamposPersonalizados(ctx, { contato: true }, input.custom_fields);
    const personalizados = conferencia.custom_fields ?? input.custom_fields ?? {};
    // Só as chaves cujo valor muda de fato.
    const camposPersonalizados = Object.entries(personalizados)
      .filter(([chave, valor]) => JSON.stringify(valor) !== JSON.stringify((antes.custom_fields ?? {})[chave]))
      .map(([chave]) => chave);
    if (camposPersonalizados.length > 0) {
      // O PATCH da rota SUBSTITUI o mapa; aqui o agente manda só o que muda.
      patch.custom_fields = { ...(antes.custom_fields ?? {}), ...personalizados };
    }
    const mudaDocumento = input.cpf !== undefined && hashCpf(input.cpf) !== antes.cpf_hash;
    if (mudaDocumento) patch.cpf = input.cpf;

    const naoConferidos =
      conferencia.recusados.length > 0
        ? {
            campos_nao_gravados: conferencia.recusados,
            erro_de_ensino: conferencia.recusados.map((r) => r.mensagem).join(" "),
          }
        : {};
    if (Object.keys(patch).length === 0 && telefoneExtra === null) {
      return recusa(
        conferencia.recusados.length > 0 ? "campo_nao_conferido" : "nada_a_gravar",
        conferencia.recusados.length > 0
          ? "nenhum campo foi gravado: os campos personalizados não conferem com o que a pessoa disse."
          : "nenhum campo novo para gravar: o cadastro já tem esses valores, ou nenhum campo foi informado.",
        naoConferidos,
      );
    }

    // ── grava ──
    let documentoGravado = false;
    if (Object.keys(patch).length > 0) {
      // Só com o documento no patch e a cifra indisponível, o handler não tem o
      // que gravar e recusa: o desfecho certo é dizer que o documento não entrou.
      try {
        await patchContactHandler(
          ctx.supabase,
          { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
          input.contact_id,
          patch,
        );
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        const soODocumento = mudaDocumento && Object.keys(patch).length === 1;
        if (!(soODocumento && err.code === "invalid_request")) {
          return recusa(err.code, err.message);
        }
      }
      if (mudaDocumento) {
        const { data: depois } = await ctx.supabase
          .from("contacts")
          .select("cpf_hash")
          .eq("organization_id", ctx.organizationId)
          .eq("id", input.contact_id)
          .maybeSingle();
        documentoGravado = (depois as { cpf_hash?: string | null } | null)?.cpf_hash === hashCpf(input.cpf!);
      }
    }

    let telefoneGravado = false;
    let recusaDoTelefone: string | null = null;
    if (telefoneExtra !== null) {
      const { error: erroDoTelefone } = await ctx.supabase.from("contact_phones").insert({
        organization_id: ctx.organizationId,
        contact_id: input.contact_id,
        phone_number: telefoneExtra,
        tipo: "outro",
        origem: "manual",
      });
      if (!erroDoTelefone) telefoneGravado = true;
      else if (erroDoTelefone.code === "23505") recusaDoTelefone = "telefone_ja_cadastrado";
      else recusaDoTelefone = "telefone_nao_gravado";
    }

    const gravados = [
      ...Object.keys(mudancas),
      ...camposPersonalizados.map((c) => `custom_fields.${c}`),
      ...(documentoGravado ? ["cpf"] : []),
      ...(telefoneGravado ? ["secondary_phone"] : []),
    ];

    if (gravados.length > 0) {
      await audit({
        action: "contact.updated_by_agent",
        organizationId: ctx.organizationId,
        resourceType: "contact",
        resourceId: input.contact_id,
        ...auditoriaDoContexto(ctx, {
          fields: gravados,
          // O valor anterior de cada campo, para desfazer. O documento nunca
          // entra em claro; campo personalizado sai pelo nome.
          changes: {
            ...mudancas,
            ...(documentoGravado
              ? { cpf: { old: antes.cpf_hash ? PROTEGIDO : null, new: PROTEGIDO } }
              : {}),
            ...(telefoneGravado ? { secondary_phone: { old: null, new: telefoneExtra } } : {}),
          },
          custom_fields_changed: camposPersonalizados,
        }),
      });
    }

    const avisos: string[] = [];
    if (mudaDocumento && !documentoGravado) {
      avisos.push(
        "o documento NÃO foi gravado: a proteção de documentos não está disponível nesta instalação. " +
          "Não diga que ficou anotado; avise a equipe.",
      );
    }
    if (recusaDoTelefone === "telefone_ja_cadastrado") {
      avisos.push("o outro telefone NÃO foi gravado: esse número já está no cadastro deste ou de outro contato.");
    } else if (recusaDoTelefone !== null) {
      avisos.push("o outro telefone NÃO foi gravado agora; tente de novo.");
    }

    if (gravados.length === 0) {
      return recusa(
        mudaDocumento && !documentoGravado ? "documento_nao_gravado" : (recusaDoTelefone ?? "nada_a_gravar"),
        avisos.join(" "),
      );
    }
    return {
      atualizado: true,
      contact_id: input.contact_id,
      campos_gravados: gravados,
      cpf_available: documentoGravado || antes.cpf_hash !== null,
      ...(avisos.length > 0 ? { avisos } : {}),
      ...naoConferidos,
    };
  },
};
