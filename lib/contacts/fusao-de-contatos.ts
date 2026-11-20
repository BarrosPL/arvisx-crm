/**
 * JUNTAR dois contatos e DESFAZER a junção — o que a rota da tela e a
 * ferramenta do agente têm em comum.
 *
 * ─── Onde mora a regra ──────────────────────────────────────────────────────
 * No banco, de propósito: `fn_mesclar_contatos` (0215 e seguintes) trava as
 * duas fichas, reponta toda linha que aponta para a absorvida e escreve a
 * lápide numa transação só. Aqui fica o que as duas portas repetiam ao redor
 * dela: o mapa do que a função levanta para o que quem chamou precisa ler.
 *
 * ─── Dois caminhos, uma regra ───────────────────────────────────────────────
 * A TELA (`POST /api/v1/contacts/merge`) chama `fn_mesclar_contatos` com a
 * sessão do usuário, como sempre.
 * O AGENTE (`crm_merge_contacts`) chama `fn_mesclar_contatos_com_registro`
 * (migration 9813), que tira o retrato, chama a MESMA `fn_mesclar_contatos` e
 * grava em `fusoes_de_contatos` o que mudou de ficha. É esse registro que
 * `fn_desfazer_fusao_de_contatos` lê para voltar atrás.
 *
 * A organização vem sempre de quem chama (a sessão ou o token).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface DesfechoDaFusao {
  /** O rótulo que a função levanta (`raise ... message = '<rótulo>'`). */
  rotulo: string;
  code: string;
  status: number;
  message: string;
}

/**
 * O que a função levanta ↔ o que o operador precisa ler.
 *
 * `message` do `raise` chega em `error.message`; o código SQLSTATE chega em
 * `error.code`. Casar pela MENSAGEM (e não pelo código) é de propósito: três
 * desfechos distintos compartilham o `22023`/`P0002`, e é a mensagem que os
 * separa. Sem este mapa, todo desfecho previsto viraria 500 — e um 500 diz ao
 * operador "o sistema quebrou" quando o que houve foi "esse contato não serve".
 */
const DESFECHOS: Record<string, Omit<DesfechoDaFusao, "rotulo">> = {
  insufficient_role: {
    code: "forbidden_role",
    status: 403,
    message: "Juntar contatos exige papel de gerente ou acima.",
  },
  selecao_de_mesclagem_invalida: {
    code: "validation_failed",
    status: 422,
    message: "Seleção inválida: escolha um contato principal e ao menos um a ser absorvido.",
  },
  secundario_repetido: {
    code: "validation_failed",
    status: 422,
    message: "O mesmo contato aparece duas vezes na seleção.",
  },
  contato_principal_indisponivel: {
    code: "not_found",
    status: 404,
    message:
      "O contato principal não está disponível — ele pode ter sido anonimizado ou já mesclado em outro.",
  },
  contato_secundario_indisponivel: {
    code: "not_found",
    status: 404,
    message:
      "Um dos contatos selecionados não está disponível — ele pode ter sido anonimizado ou já mesclado em outro.",
  },
};

/**
 * O desfecho PREVISTO que a mensagem do banco carrega, ou `null`.
 *
 * Casamento por CONTINÊNCIA, não por igualdade. O `message` que o PostgREST
 * devolve é o do `raise`, mas isso é contrato de uma camada que não é nossa:
 * basta ele passar a decorar a linha ("...: insufficient_role") para a
 * igualdade parar de casar — e o modo de falha seria 500 em TODO desfecho
 * previsto, ou seja, o operador lendo "o sistema quebrou" quando o que houve
 * foi "esse contato não serve". A continência sobrevive à decoração; os
 * rótulos não são prefixo um do outro, então não há ambiguidade.
 */
export function desfechoDaFusao(mensagemDoBanco: string | null | undefined): DesfechoDaFusao | null {
  const bruto = mensagemDoBanco ?? "";
  const rotulo = Object.keys(DESFECHOS).find((k) => bruto.includes(k));
  return rotulo ? { rotulo, ...DESFECHOS[rotulo]! } : null;
}

/** O que `fn_mesclar_contatos` devolve. */
export interface ResultadoDaFusao {
  contato_id: string;
  contatos_mesclados: string[];
  nomes_absorvidos?: Array<{ contato_id: string; name: string }>;
  repontado: Record<string, number>;
  nao_repontado: Record<string, number>;
  atividades_emitidas: number;
}

/** O que `fn_mesclar_contatos_com_registro` acrescenta. */
export interface ResultadoDaFusaoRegistrada extends ResultadoDaFusao {
  registro_id: string;
  /** Linhas de tabela sem coluna `id`: mudaram de ficha e não cabem no registro. */
  sem_registro: Record<string, number>;
  telefones_extras_repetidos_apagados: number;
}

/** O que `fn_desfazer_fusao_de_contatos` devolve. */
export interface ResultadoDoDesfazer {
  registro_id: string;
  ja_desfeita: boolean;
  contato_principal_id?: string;
  contato_restaurado_id?: string;
  voltou?: Record<string, number>;
  nao_voltou?: Record<string, number>;
  campos_devolvidos?: string[];
  campos_mantidos?: string[];
  telefone_em_conflito_voltou?: boolean;
  sem_registro?: Record<string, number>;
  telefones_extras_repetidos_apagados?: number;
  atividades_emitidas?: number;
}

/**
 * Os rótulos que as duas funções da 9813 levantam além dos de
 * `fn_mesclar_contatos`. Só o rótulo: a frase para o agente é da ferramenta.
 */
const ROTULOS_DO_REGISTRO = [
  "fusao_de_contato_pessoal",
  "fusao_de_contato_de_grupo",
  "registro_de_fusao_nao_encontrado",
  "registro_de_fusao_em_mudanca",
  "contato_da_fusao_indisponivel",
  "fusao_de_contato_anonimizado",
  "principal_da_fusao_foi_absorvido",
  "absorvido_fora_desta_fusao",
  "conflito_ao_desfazer_fusao",
  "support_readonly",
] as const;

export type RotuloDeRecusaDaFusao =
  | (typeof ROTULOS_DO_REGISTRO)[number]
  | "insufficient_role"
  | "selecao_de_mesclagem_invalida"
  | "secundario_repetido"
  | "contato_principal_indisponivel"
  | "contato_secundario_indisponivel";

function rotuloDaRecusa(mensagemDoBanco: string | null | undefined): RotuloDeRecusaDaFusao | null {
  const previsto = desfechoDaFusao(mensagemDoBanco);
  if (previsto) return previsto.rotulo as RotuloDeRecusaDaFusao;
  const bruto = mensagemDoBanco ?? "";
  return ROTULOS_DO_REGISTRO.find((r) => bruto.includes(r)) ?? null;
}

export type DesfechoDaChamada<T> =
  | { ok: true; resultado: T }
  /** O banco recusou por um motivo previsto. Nada mudou. */
  | { ok: false; recusa: RotuloDeRecusaDaFusao }
  /** Falha que não é recusa: rede, banco fora, erro inesperado. */
  | { ok: false; recusa: null; erro: string };

/**
 * Junta `absorvido` em `principal` e guarda o registro do que mudou de ficha.
 *
 * `admin` é o cliente de SERVIÇO: a função é só do `service_role`, e quem
 * confere o papel de quem pediu é a ferramenta, antes de chegar aqui.
 */
export async function mesclarContatosComRegistro(
  admin: SupabaseClient,
  args: { organizationId: string; principal: string; absorvido: string; tokenId: string | null },
): Promise<DesfechoDaChamada<ResultadoDaFusaoRegistrada>> {
  const { data, error } = await admin.rpc("fn_mesclar_contatos_com_registro", {
    p_organization_id: args.organizationId,
    p_contato_principal: args.principal,
    p_contato_absorvido: args.absorvido,
    p_token_id: args.tokenId,
  });
  if (error) {
    const recusa = rotuloDaRecusa(error.message);
    return recusa ? { ok: false, recusa } : { ok: false, recusa: null, erro: error.message };
  }
  return { ok: true, resultado: data as unknown as ResultadoDaFusaoRegistrada };
}

/** Desfaz a junção de um registro. Repetir devolve o resultado da primeira vez. */
export async function desfazerFusaoDeContatos(
  admin: SupabaseClient,
  args: { organizationId: string; registroId: string; tokenId: string | null },
): Promise<DesfechoDaChamada<ResultadoDoDesfazer>> {
  const { data, error } = await admin.rpc("fn_desfazer_fusao_de_contatos", {
    p_organization_id: args.organizationId,
    p_registro_id: args.registroId,
    p_token_id: args.tokenId,
  });
  if (error) {
    const recusa = rotuloDaRecusa(error.message);
    return recusa ? { ok: false, recusa } : { ok: false, recusa: null, erro: error.message };
  }
  return { ok: true, resultado: data as unknown as ResultadoDoDesfazer };
}

export interface RegistroDeFusao {
  id: string;
  contato_principal_id: string;
  contato_absorvido_id: string;
  created_at: string;
  desfeito_em: string | null;
}

/**
 * O registro em aberto (não desfeito) da junção de `absorvido`, o mais recente.
 * `null` quando a junção foi feita pela tela, que não gera registro.
 */
export async function registroAbertoDaFusao(
  admin: SupabaseClient,
  organizationId: string,
  absorvido: string,
): Promise<RegistroDeFusao | null> {
  const { data } = await admin
    .from("fusoes_de_contatos")
    .select("id, contato_principal_id, contato_absorvido_id, created_at, desfeito_em")
    .eq("organization_id", organizationId)
    .eq("contato_absorvido_id", absorvido)
    .is("desfeito_em", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as RegistroDeFusao | null) ?? null;
}
