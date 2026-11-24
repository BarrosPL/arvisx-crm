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
 * ═══ Só preenche o que está VAZIO (revisão de 20/11, item 2.3) ═══
 *
 * O agente grava direto o dado que o cadastro NÃO TEM. O campo que já tem
 * valor não é trocado pelo texto que o cliente mandou na conversa: ele volta
 * em `campos_ja_preenchidos`, e o agente deixa a conferência para a equipe
 * (uma tarefa). Vale para os campos de coluna, para o documento e para cada
 * chave dos campos personalizados. Valor igual ao que já está não é escrita.
 *
 * Por quê: a primeira versão sobrescrevia nome e e-mail existentes com o que
 * viesse na conversa, e para "poder desfazer" guardava o valor anterior em
 * claro na auditoria, que a anonimização não alcança (e sem valor anterior
 * para os campos personalizados). Preenchendo só o vazio não há valor anterior
 * a guardar: desfazer é limpar o campo, e a auditoria leva só os NOMES.
 *
 * ═══ O que ela reusa ═══
 *
 * A escrita dos campos de coluna e do documento é o `patchContactHandler` da
 * rota `PATCH /api/v1/contacts/[id]`: o mesmo tratamento de e-mail repetido
 * (409), os mesmos eventos (`contact.updated`, `contact.phone_added`). Nada
 * disso é reescrito aqui.
 *
 * Os campos personalizados NÃO passam pelo handler: ele SUBSTITUI o mapa (é o
 * contrato da tela), e ler o mapa, juntar e regravar perde a escrita de quem
 * gravou ao mesmo tempo. Eles entram por
 * `fn_contato_preencher_campos_personalizados` (migration 9820), que mescla no
 * banco com a linha travada e só nas chaves vazias. A régua de formato do campo
 * (o "padrão" do funil) é a MESMA do handler, conferida aqui antes de gravar.
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
 * Uma linha `contact.updated_by_agent`, com o agente como autor e os NOMES dos
 * campos preenchidos. Nenhum valor: nem o que entrou (dado de titular, e a
 * auditoria não é alcançada pela anonimização), nem o anterior (era vazio, por
 * construção). É uniforme: coluna, documento, telefone e campo personalizado
 * saem do mesmo jeito.
 *
 * ═══ O outro telefone ═══
 *
 * Quando o número não entra, a recusa é UMA só (`telefone_nao_gravado`), seja
 * porque ele já é de outro contato, seja por qualquer outra falha. Dizer "esse
 * número já está em outro cadastro" transformava a ferramenta num jeito de
 * perguntar se um telefone é cliente da empresa.
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
import { camposQueMudaram, defsDoPadraoDaOrg, erroDePadrao, recusasDePadrao } from "@/lib/leads/padrao-do-campo";
import { testaComPrazo } from "@/lib/leads/padrao-do-campo-no-servidor";
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

/** O cadastro não tem este dado: nulo, ausente ou texto em branco. */
function vazio(valor: unknown): boolean {
  return valor === null || valor === undefined || (typeof valor === "string" && valor.trim() === "");
}

const O_QUE_FAZER_COM_O_PREENCHIDO =
  "O agente não troca dado que já está no cadastro. Se a pessoa informou um valor diferente, deixe uma tarefa " +
  "para a equipe conferir e corrigir, e não diga que atualizou.";

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
    "data de nascimento, endereço e campos personalizados. Envie só os campos a gravar. Grava direto, e só " +
    "PREENCHE campo vazio: o que já tem valor não é trocado e volta em `campos_ja_preenchidos` (deixe tarefa " +
    "para a equipe). Recusa valor inválido (`email_invalido`, `documento_invalido`, " +
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

    // ── o que muda de fato: só o que o cadastro NÃO TEM ──
    const patch: ContactPatch = {};
    const preenchidos: string[] = [];
    const jaPreenchidos: string[] = [];
    for (const campo of CAMPOS_DIRETOS) {
      const novo = input[campo as CampoDireto];
      if (novo === undefined || novo === (antes[campo] ?? null)) continue;
      if (!vazio(antes[campo])) {
        jaPreenchidos.push(campo);
        continue;
      }
      (patch as Record<string, unknown>)[campo] = novo;
      preenchidos.push(campo);
    }
    let mudaDocumento = false;
    if (input.cpf !== undefined && hashCpf(input.cpf) !== antes.cpf_hash) {
      if (antes.cpf_hash) jaPreenchidos.push("cpf");
      else {
        mudaDocumento = true;
        patch.cpf = input.cpf;
      }
    }

    // A IA só grava o que a PESSOA disse: a mesma conferência dos campos do
    // negócio (`crm_update_lead`), com as definições de escopo `contato`. O
    // campo recusado sai da gravação e volta como erro de ensino; os outros
    // campos da mesma chamada seguem.
    const conferencia = await conferirCamposPersonalizados(ctx, { contato: true }, input.custom_fields);
    const personalizados = conferencia.custom_fields ?? input.custom_fields ?? {};
    // Candidatas: as chaves com valor a gravar (valor vazio não é dado) que
    // diferem do que está no cadastro. Quem decide o que entra é o banco, com a
    // linha travada (`fn_contato_preencher_campos_personalizados`): a leitura
    // acima pode estar velha quando a gravação acontecer.
    const candidatas = Object.fromEntries(
      Object.entries(personalizados).filter(
        ([chave, valor]) =>
          !vazio(valor) && JSON.stringify(valor) !== JSON.stringify((antes.custom_fields ?? {})[chave]),
      ),
    );
    if (Object.keys(candidatas).length > 0) {
      // A régua de formato do campo (o "padrão" do funil), a MESMA do
      // `patchContactHandler`, julgando só o que muda. Formato recusado derruba
      // a chamada antes de qualquer gravação, como derrubava pelo handler.
      const alterados = camposQueMudaram(candidatas, antes.custom_fields);
      if (Object.keys(alterados).length > 0) {
        const defs = await defsDoPadraoDaOrg(ctx.supabase, ctx.organizationId, "contato");
        const recusas = recusasDePadrao(defs, alterados, testaComPrazo);
        if (recusas.length > 0) {
          const erro = erroDePadrao(recusas, ctx.requestId);
          return recusa(erro.code, erro.message);
        }
      }
    }

    // O outro telefone que este MESMO contato já tem não é escrita (e não diz
    // nada sobre contato de mais ninguém).
    if (telefoneExtra !== null) {
      const { data: jaTem, error: erroDaLeitura } = await ctx.supabase
        .from("contact_phones")
        .select("id")
        .eq("organization_id", ctx.organizationId)
        .eq("contact_id", input.contact_id)
        .eq("phone_number", telefoneExtra)
        .limit(1);
      if (erroDaLeitura) return CONSULTA_INDISPONIVEL;
      if (((jaTem ?? []) as unknown[]).length > 0) telefoneExtra = null;
    }

    const naoConferidos =
      conferencia.recusados.length > 0
        ? {
            campos_nao_gravados: conferencia.recusados,
            erro_de_ensino: conferencia.recusados.map((r) => r.mensagem).join(" "),
          }
        : {};
    const temCandidata = Object.keys(candidatas).length > 0;
    if (Object.keys(patch).length === 0 && !temCandidata && telefoneExtra === null) {
      if (jaPreenchidos.length > 0) {
        return recusa(
          "campo_ja_preenchido",
          `nenhum campo foi gravado: ${jaPreenchidos.join(", ")} já ${jaPreenchidos.length === 1 ? "tem" : "têm"} valor ` +
            `no cadastro. ${O_QUE_FAZER_COM_O_PREENCHIDO}`,
          { campos_ja_preenchidos: jaPreenchidos, ...naoConferidos },
        );
      }
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
    let colunasGravadas: string[] = [];
    if (Object.keys(patch).length > 0) {
      // Só com o documento no patch e a cifra indisponível, o handler não tem o
      // que gravar e recusa: o desfecho certo é dizer que o documento não entrou.
      let gravou = true;
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
        gravou = false;
      }
      if (gravou) colunasGravadas = preenchidos;
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

    // Campos personalizados: a mescla é do banco, com a linha travada, e só nas
    // chaves que ESTÃO vazias na hora da gravação.
    let camposPersonalizados: string[] = [];
    let personalizadosNaoGravados = false;
    if (temCandidata) {
      const { data: mescla, error: erroDaMescla } = await ctx.supabase.rpc(
        "fn_contato_preencher_campos_personalizados",
        { p_org: ctx.organizationId, p_contato: input.contact_id, p_campos: candidatas },
      );
      const lido = mescla as { gravados?: unknown; ja_preenchidos?: unknown } | null;
      if (erroDaMescla || !lido) {
        personalizadosNaoGravados = true;
      } else {
        camposPersonalizados = Array.isArray(lido.gravados) ? lido.gravados.map(String) : [];
        const ocupados = Array.isArray(lido.ja_preenchidos) ? lido.ja_preenchidos.map(String) : [];
        jaPreenchidos.push(...ocupados.map((c) => `custom_fields.${c}`));
        // O handler emite `contact.updated` quando grava as colunas. Quando só
        // os campos personalizados mudaram, o evento sai daqui: regra de
        // automação e webhook que ouvem "contato atualizado" não ficam sem ele.
        if (camposPersonalizados.length > 0 && colunasGravadas.length === 0 && !documentoGravado) {
          const { error: erroDoEvento } = await ctx.supabase.rpc("emit_event", {
            p_event_type: "contact.updated",
            p_entity_kind: "contact",
            p_entity_id: input.contact_id,
            p_payload: { fields: ["custom_fields"] },
            p_metadata: { request_id: ctx.requestId, via: "mcp", actor_type: ctx.actor.type },
            p_organization_id: ctx.organizationId,
          });
          // O evento que falha não desfaz a gravação: o dado já está no cadastro.
          if (erroDoEvento) console.error("[crm_update_contact] emit_event failed", erroDoEvento.message);
        }
      }
    }

    let telefoneGravado = false;
    let telefoneRecusado = false;
    if (telefoneExtra !== null) {
      const { error: erroDoTelefone } = await ctx.supabase.from("contact_phones").insert({
        organization_id: ctx.organizationId,
        contact_id: input.contact_id,
        phone_number: telefoneExtra,
        tipo: "outro",
        origem: "manual",
      });
      // Uma recusa só: "já é de outro contato" (23505) e qualquer outra falha
      // respondem igual. A diferença dizia se o número existe em outro cadastro.
      if (!erroDoTelefone) telefoneGravado = true;
      else telefoneRecusado = true;
    }

    const gravados = [
      ...colunasGravadas.filter((c) => c !== "cpf"),
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
          // Só NOMES de campo, para todos os tipos. Nenhum valor entra: o novo
          // é dado de titular (e a auditoria não é alcançada pela
          // anonimização); o anterior era vazio, porque esta ferramenta só
          // preenche o que não tinha valor. Desfazer é limpar o campo.
          fields: gravados,
          custom_fields_changed: camposPersonalizados,
          valor_anterior: "vazio",
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
    if (telefoneRecusado) {
      avisos.push(
        "o outro telefone NÃO foi gravado. Não tente de novo nesta conversa; se o número for importante, deixe " +
          "uma tarefa para a equipe conferir.",
      );
    }
    if (personalizadosNaoGravados) {
      avisos.push("os campos personalizados NÃO foram gravados agora; tente de novo em instantes.");
    }
    if (jaPreenchidos.length > 0) {
      avisos.push(
        `${jaPreenchidos.join(", ")} já ${jaPreenchidos.length === 1 ? "tem" : "têm"} valor no cadastro e ` +
          `${jaPreenchidos.length === 1 ? "não foi alterado" : "não foram alterados"}. ${O_QUE_FAZER_COM_O_PREENCHIDO}`,
      );
    }
    const preenchidosDeAntes = jaPreenchidos.length > 0 ? { campos_ja_preenchidos: jaPreenchidos } : {};

    if (gravados.length === 0) {
      const motivo =
        mudaDocumento && !documentoGravado
          ? "documento_nao_gravado"
          : telefoneRecusado
            ? "telefone_nao_gravado"
            : personalizadosNaoGravados
              ? "indisponivel"
              : jaPreenchidos.length > 0
                ? "campo_ja_preenchido"
                : "nada_a_gravar";
      return recusa(motivo, avisos.join(" "), { ...preenchidosDeAntes, ...naoConferidos });
    }
    return {
      atualizado: true,
      contact_id: input.contact_id,
      campos_gravados: gravados,
      cpf_available: documentoGravado || antes.cpf_hash !== null,
      ...preenchidosDeAntes,
      ...(avisos.length > 0 ? { avisos } : {}),
      ...naoConferidos,
    };
  },
};
