/**
 * Os planos que o cadastro público enxerga, e a regra de quando ele exige um.
 *
 * É o espelho, no servidor, de `fn_trial_na_criacao_da_org` (migration 0679):
 * sem plano escolhido, a empresa nasce no plano padrão; sem padrão, o gatilho
 * recusa com `plano_obrigatorio` — EXCETO quando o revendedor não tem plano
 * NENHUM (nem padrão, nem oferecido): aí a empresa nasce isenta, como antes da
 * 0679 (decisão do dono, doc 146, opção B). Os dois lados têm de usar o mesmo
 * critério: se a tela deixasse passar o que o gatilho recusa, a conta nasceria
 * no GoTrue sem organização.
 *
 * PLANO DE ENTRADA (ArvisX, etapa 3 dos planos): o padrão que NÃO é oferecido —
 * o "Teste" de 7 dias com tudo liberado — é o caminho de quem se cadastra. Aí o
 * cadastro não mostra seletor (só mostra o que é oferecido, e o padrão não é):
 * a empresa nasce no padrão, sem escolha, pela mesma regra do gatilho
 * ("sem escolha, o padrão"). Os planos pagos se escolhem depois, em Plano e
 * cobrança, com o Checkout.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { moduloLigado } from "@/lib/instalacao/modulos";

export interface PlanoDoCadastro {
  id: string;
  nome: string;
  preco_cents: number;
  /** Moeda do preço (BRL ou EUR, migration 9801): a tela formata nela. */
  moeda: string;
  intervalo: string;
  trial_dias: number;
}

export interface PlanosDoCadastro {
  padraoId: string | null;
  oferecidos: PlanoDoCadastro[];
  /** Dias de teste do plano padrão (`null` sem padrão): a frase do cadastro sem seletor. */
  trialDoPadrao?: number | null;
}

/** `null` quando a leitura falhou: quem decide uma AÇÃO trata como recusa. */
export async function lerPlanosDoCadastro(admin: SupabaseClient): Promise<PlanosDoCadastro | null> {
  const [oferecidos, padrao] = await Promise.all([
    admin
      .from("cobranca_planos")
      .select("id, nome, preco_cents, moeda, intervalo, trial_dias")
      .is("arquivado_em", null)
      .eq("oferecido_ao_cliente", true)
      .order("preco_cents"),
    admin
      .from("cobranca_planos")
      .select("id, trial_dias")
      .is("arquivado_em", null)
      .eq("padrao_no_cadastro", true)
      .maybeSingle(),
  ]);
  if (oferecidos.error || padrao.error) return null;
  return {
    padraoId: padrao.data?.id ?? null,
    oferecidos: oferecidos.data ?? [],
    trialDoPadrao: (padrao.data as { trial_dias?: number } | null)?.trial_dias ?? null,
  };
}

/** Cadastro SEM plano escolhido é recusado? O mesmo critério do gatilho. */
export function cadastroExigeEscolhaDePlano(planos: PlanosDoCadastro): boolean {
  return planos.padraoId === null && planos.oferecidos.length > 0;
}

/**
 * O cadastro mostra o seletor de plano? Só quando há plano oferecido E a escolha
 * pode cair num deles: sem padrão (escolha obrigatória) ou com o padrão entre os
 * oferecidos. Padrão fora dos oferecidos é o PLANO DE ENTRADA (o "Teste"): sem
 * seletor, a empresa nasce nele.
 */
export function cadastroMostraSeletor(planos: PlanosDoCadastro): boolean {
  if (planos.oferecidos.length === 0) return false;
  return planos.padraoId === null || planos.oferecidos.some((p) => p.id === planos.padraoId);
}

export interface CadastroNaTela {
  oferecidos: PlanoDoCadastro[];
  padraoId: string | null;
  /** O cadastro sem escolha seria recusado: o Google some e o seletor é obrigatório. */
  exigeEscolha: boolean;
  /** `cadastroMostraSeletor`: falso = a empresa nasce no padrão, sem escolha. */
  mostraSeletor: boolean;
  /** Dias de teste grátis do padrão quando o seletor some (a frase do cadastro); senão `null`. */
  diasDeTesteSemEscolha: number | null;
}

/**
 * O que as telas de cadastro (`/signup`, `/get-started`) mostram. Cobrança
 * desligada, ou leitura que falha: nada — a tela não esconde nem exige coisa
 * alguma, e quem recusa é a action (e, por baixo dela, o gatilho).
 */
export async function lerCadastroNaTela(admin: SupabaseClient): Promise<CadastroNaTela> {
  const nada: CadastroNaTela = { oferecidos: [], padraoId: null, exigeEscolha: false, mostraSeletor: false, diasDeTesteSemEscolha: null };
  if (!(await moduloLigado(admin, "cobranca"))) return nada;
  const lidos = await lerPlanosDoCadastro(admin);
  if (!lidos) return nada;
  const mostraSeletor = cadastroMostraSeletor(lidos);
  return {
    oferecidos: lidos.oferecidos,
    padraoId: lidos.padraoId,
    exigeEscolha: cadastroExigeEscolhaDePlano(lidos),
    mostraSeletor,
    diasDeTesteSemEscolha: !mostraSeletor && lidos.padraoId !== null && (lidos.trialDoPadrao ?? 0) > 0 ? (lidos.trialDoPadrao ?? null) : null,
  };
}

/** Os planos que a tela lista no seletor: nenhum quando ele some (a empresa nasce no padrão). */
export function planosDoSeletor(cadastro: CadastroNaTela | null): PlanoDoCadastro[] {
  return cadastro?.mostraSeletor ? cadastro.oferecidos : [];
}

/** O plano que o seletor já traz marcado: o padrão, quando ele está entre os oferecidos. */
export function planoInicialDoSeletor(oferecidos: readonly PlanoDoCadastro[], padraoId: string | null): string | undefined {
  return oferecidos.find((p) => p.id === padraoId)?.id ?? oferecidos[0]?.id;
}
