/**
 * Tipos do Vix, o assistente do cliente dentro do CRM (Tarefa 7, Fase 1).
 *
 * A regra que este arquivo carrega: o Vix só faz o que está DECLARADO num
 * catálogo em código (`lib/assistente/capacidades/`). Cada capacidade diz o
 * nível, o papel mínimo, a rota da tela equivalente (por onde o plano é
 * perguntado), a entrada validada, o teste que a prova e se tem inverso. O que
 * não está no catálogo não existe para o modelo.
 *
 * Módulo PURO: só tipos e constantes. Pode ser importado por cerca e por tela.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import type { Idioma } from "@/lib/i18n/idiomas";
import type { ModuloOpcional } from "@/lib/instalacao/modulos";
import type { CapacidadeDaOrganizacao } from "@/lib/organizacao/capacidades";

/** Os papéis de PESSOA. `ai_operator` é do agente publicado e nunca entra aqui. */
export const PAPEIS_HUMANOS = ["viewer", "agent", "manager", "admin"] as const;
export type PapelHumano = (typeof PAPEIS_HUMANOS)[number];

export const RANK_DO_PAPEL: Record<PapelHumano, number> = {
  viewer: 1,
  agent: 2,
  manager: 3,
  admin: 4,
};

/** `ler` executa direto. `escrever` e `sensivel` viram cartão e só executam no clique. */
export const NIVEIS = ["ler", "escrever", "sensivel"] as const;
export type Nivel = (typeof NIVEIS)[number];

export const MODOS = ["suporte", "consultor", "onboarding"] as const;
export type Modo = (typeof MODOS)[number];

/** A palavra que o usuário digita para confirmar um cartão de nível sensível. */
export const PALAVRA_DE_CONFIRMACAO = "confirmar";

/** Quanto tempo um cartão espera pelo clique. */
export const VALIDADE_DO_CARTAO_MS = 15 * 60 * 1000;

/**
 * O contexto de CONFIANÇA de uma chamada. Montado só pela rota, a partir do
 * `requireRole`: o modelo não escreve nenhum destes campos nem tem como
 * alcançá-los. `db` é o cliente de SESSÃO do usuário (a RLS vale).
 */
export interface ContextoDoAssistente {
  orgId: string;
  userId: string;
  papel: PapelHumano;
  idioma: Idioma;
  requestId: string;
  db: SupabaseClient;
}

export interface RotaDaTela {
  caminho: string;
  metodo: "GET" | "POST" | "PATCH" | "DELETE";
}

/** O que o usuário vê no cartão antes de confirmar. */
export interface RascunhoDoCartao {
  resumo: string;
  /** Um item por registro que será alterado; o tamanho é o lote. */
  itens: { id: string; rotulo: string }[];
}

export type Origem =
  | { tipo: "mcp"; ferramenta: string }
  | { tipo: "tela"; handler: string }
  | { tipo: "propria" };

export type Inverso = false | { capacidade: string } | { parcial: string } | "nao_se_aplica";

export interface Capacidade<E extends z.ZodObject = z.ZodObject> {
  /** Só letras minúsculas, dígitos e `_`: é o nome da ferramenta que o modelo vê. */
  nome: string;
  /** Fala com o MODELO. */
  descricao: string;
  nivel: Nivel;
  papelMinimo: PapelHumano;
  /** A rota da tela equivalente: o plano é perguntado com ela. `null` = o plano não decide. */
  rotaDaTela: RotaDaTela | null;
  modulo?: ModuloOpcional;
  capacidadeDaEmpresa?: CapacidadeDaOrganizacao;
  /** Modos em que a capacidade é oferecida. Ausente = todos. */
  modos?: readonly Modo[];
  entrada: E;
  temInverso: Inverso;
  /** Arquivo do teste que prova esta capacidade (isolamento entre empresas). */
  teste: string;
  origem: Origem;
  executar: (entrada: z.infer<E>, ctx: ContextoDoAssistente) => Promise<unknown>;
  /** Só escrita: monta o cartão SEM alterar nada. */
  preparar?: (entrada: z.infer<E>, ctx: ContextoDoAssistente) => Promise<RascunhoDoCartao>;
}

/** Declara uma capacidade preservando o tipo da entrada. */
export function capacidade<E extends z.ZodObject>(c: Capacidade<E>): Capacidade {
  return c as unknown as Capacidade;
}

/** Os motivos de recusa do executor. Vão para a auditoria e, traduzidos, para o usuário. */
export type MotivoDeRecusa =
  | "capacidade_inexistente"
  | "proibida"
  | "nivel_errado"
  | "papel_insuficiente"
  | "fora_do_plano"
  | "modulo_desligado"
  | "entrada_invalida"
  | "escritas_desligadas"
  | "lote_acima_do_limite"
  | "falha_ao_executar";

export type ResultadoDaLeitura =
  | { ok: true; dados: unknown }
  | { ok: false; motivo: MotivoDeRecusa; detalhe?: string };
