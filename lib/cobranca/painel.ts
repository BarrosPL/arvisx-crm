import type { SupabaseClient } from "@supabase/supabase-js";

import { provedorDaInstalacao } from "@/lib/cobranca/configuracao";
import { sugestaoDoCadastro } from "@/lib/cobranca/documento";
import { telasDoPlanoNoSeletor } from "@/lib/cobranca/comparativo";
import { excedenteDoPlano, lerUsoDaOrganizacao, type Excedente, type UsoDaOrganizacao } from "@/lib/cobranca/uso";
import { modulosLigados } from "@/lib/instalacao/modulos";
import { provedorCobraEm, type EstadoDaAssinatura, type Modo, type Moeda, type ProvedorDeCobranca } from "@/lib/cobranca/vocabulario";

export interface AssinaturaDoPainel {
  estado: EstadoDaAssinatura;
  trial_ate: string | null;
  prazo_extra_ate: string | null;
  proximo_vencimento: string | null;
  vencida_desde: string | null;
  cancela_no_fim: boolean;
  modo: Modo | null;
  provedor: string | null;
  link_de_pagamento: string | null;
  assinaturas_vivas: number;
  plano_agendado: { id: string; nome: string } | null;
  periodo_pago_desde: string | null;
  troca_pagamento_url: string | null;
  troca_status: string | null;
  pagamento_inicial_pendente: boolean;
}

export interface PlanoParaTroca {
  id: string;
  nome: string;
  preco_cents: number;
  /** A moeda do preço (migration 9801): a tela formata nela. */
  moeda: Moeda;
  intervalo: string;
  max_assentos: number | null;
  max_canais: number | null;
  teto_ia_usd_cents: number | null;
}

/**
 * Um plano na escolha do "Assinar" (ArvisX, etapa 3): preço na moeda dele,
 * limites e o que o uso de hoje passa do teto — a mesma conta da recusa do
 * servidor. O que ele tem e não tem vai no comparativo (`PlanoDoComparativo`).
 */
export interface PlanoParaAssinar extends PlanoParaTroca {
  /** É o plano em que a empresa está agora. */
  atual: boolean;
  /** Vazio = o uso de hoje cabe. */
  excedente: Excedente;
}

/**
 * Um plano no COMPARATIVO (ArvisX, tarefa 2 dos planos): preço, limites, os
 * textos que o dono escreveu (migration 9803), as telas do seletor que ele
 * libera (a mesma régua da trava) e o excesso do uso de hoje.
 */
export interface PlanoDoComparativo extends PlanoParaTroca {
  atual: boolean;
  descricao_curta: string | null;
  para_quem: string | null;
  destaques: string[];
  limites: string[];
  como_funciona: string | null;
  inclui_agentes_arvisx: boolean;
  /** hrefs das telas do seletor que o plano libera. */
  telas: string[];
  /** Vazio = o uso de hoje cabe. */
  excedente: Excedente;
}

export interface DadosDoPainel {
  assinatura: AssinaturaDoPainel | null;
  plano: {
    id: string;
    nome: string;
    preco_cents: number;
    moeda: Moeda;
    intervalo: string;
    max_assentos: number | null;
    max_canais: number | null;
    teto_ia_usd_cents: number | null;
  } | null;
  uso: UsoDaOrganizacao;
  /** Na moeda de `fn_gasto_de_ia_do_mes` (centavos de dólar), a régua única de gasto. */
  gastoIaUsdCents: number;
  /** Planos ativos e oferecidos às empresas, do MESMO intervalo, fora o atual (a troca não muda o intervalo), numa moeda que o provedor cobra. */
  planosParaTroca: PlanoParaTroca[];
  /**
   * A escolha do plano no "Assinar" (etapa 3): só existe enquanto NADA está
   * assinado no provedor (sem `provedor_assinatura_id`, sem assinatura viva) e
   * a empresa não está em dia — o caso do teste grátis, vencido ou não. Aí
   * assinar troca o `plano_id` para o escolhido e abre o Checkout.
   */
  escolheAoAssinar: boolean;
  /** Planos ativos e oferecidos, numa moeda que o provedor cobra, em ordem de preço. Vazio sem `escolheAoAssinar`. */
  planosParaAssinar: PlanoParaAssinar[];
  /**
   * O comparativo da escolha (no Assinar) ou da troca: os planos que a empresa
   * pode escolher, em ordem de preço (o atual entra se for oferecido), e o
   * plano ATUAL como base do "o que entra / o que sai" — ele mesmo quando é um
   * plano escondido, como o teste grátis.
   */
  comparativo: { planos: PlanoDoComparativo[]; atual: PlanoDoComparativo | null };
  /** IANA da empresa (`organizations.timezone`): as datas do painel e do recado saem nele. */
  fuso: string | null;
  /**
   * O que o "Assinar" precisa saber: QUEM cobra — o provedor da assinatura; sem
   * ele, o da instalação (D-8) — e o CNPJ do cadastro, só se o dígito confere,
   * para pré-preencher o documento que o Asaas exige.
   */
  checkout: { provedor: ProvedorDeCobranca | null; documentoDoCadastro: string | null };
}

interface PlanoLido extends PlanoParaTroca {
  interface_settings: unknown;
  descricao_curta: string | null;
  para_quem: string | null;
  destaques: string[] | null;
  limites: string[] | null;
  como_funciona: string | null;
  inclui_agentes_arvisx: boolean;
  max_assentos: number | null;
  max_canais: number | null;
  teto_ia_usd_cents: number | null;
  arquivado_em: string | null;
  /** false = plano negociado: só o dono atribui (Task 4A), a empresa não o vê na troca. */
  oferecido_ao_cliente: boolean;
}

/**
 * O que o painel da empresa mostra (spec da cobrança §9). `orgId` vem da
 * sessão, nunca do corpo. LANÇA em qualquer leitura que falha: o painel não
 * afirma uso nem estado que não leu. `cobranca_planos` é da instalação (sem
 * `organization_id`): a lista toda é pequena e alimenta a troca de plano.
 */
export async function lerPainelDaAssinatura(db: SupabaseClient, orgId: string): Promise<DadosDoPainel> {
  const { data: a, error } = await db
    .from("cobranca_assinaturas")
    .select(
      "plano_id, plano_agendado_id, estado, trial_ate, prazo_extra_ate, proximo_vencimento, vencida_desde, cancela_no_fim, modo, provedor, provedor_assinatura_id, link_de_pagamento, assinaturas_vivas, periodo_pago_desde, troca_pagamento_url, troca_status, pagamento_inicial_pendente",
    )
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`painel da assinatura: leitura falhou (${error.code})`);

  const [planos, uso, gasto, org, daInstalacao, modulos] = await Promise.all([
    db
      .from("cobranca_planos")
      .select("id, nome, preco_cents, moeda, intervalo, max_assentos, max_canais, teto_ia_usd_cents, arquivado_em, oferecido_ao_cliente, interface_settings, descricao_curta, para_quem, destaques, limites, como_funciona, inclui_agentes_arvisx"),
    lerUsoDaOrganizacao(db, orgId),
    db.rpc("fn_gasto_de_ia_do_mes", { p_org: orgId }),
    db.from("organizations").select("timezone, cnpj").eq("id", orgId).maybeSingle(),
    provedorDaInstalacao(),
    // Nunca lança: falha = nenhum módulo, e a lista do que se perde só fica menor.
    modulosLigados(db),
  ]);
  if (planos.error || !uso || gasto.error || org.error) throw new Error("painel da assinatura: leitura falhou");

  const todos = (planos.data ?? []) as PlanoLido[];
  const plano = a ? (todos.find((p) => p.id === a.plano_id) ?? null) : null;
  const agendado = a?.plano_agendado_id ? (todos.find((p) => p.id === a.plano_agendado_id) ?? null) : null;
  const provedorDoCheckout = (a?.provedor as ProvedorDeCobranca | null | undefined) ?? daInstalacao;
  const cobravel = (p: PlanoLido) => provedorDoCheckout === null || provedorCobraEm(provedorDoCheckout, p.moeda);
  const escolheAoAssinar =
    a !== null && a !== undefined && plano !== null &&
    !a.provedor_assinatura_id && a.assinaturas_vivas === 0 && a.estado !== "ativa";
  const paraTela = (p: PlanoLido): PlanoParaTroca => ({
    id: p.id, nome: p.nome, preco_cents: p.preco_cents, moeda: p.moeda, intervalo: p.intervalo,
    max_assentos: p.max_assentos, max_canais: p.max_canais, teto_ia_usd_cents: p.teto_ia_usd_cents,
  });
  const paraComparar = (p: PlanoLido): PlanoDoComparativo => ({
    ...paraTela(p),
    atual: p.id === plano?.id,
    descricao_curta: p.descricao_curta ?? null,
    para_quem: p.para_quem ?? null,
    destaques: p.destaques ?? [],
    limites: p.limites ?? [],
    como_funciona: p.como_funciona ?? null,
    inclui_agentes_arvisx: p.inclui_agentes_arvisx === true,
    telas: telasDoPlanoNoSeletor(p.interface_settings, modulos),
    excedente: excedenteDoPlano(uso, p),
  });
  // Os mesmos filtros da escolha e da troca: oferecido, vivo, numa moeda que o
  // provedor cobra; na troca, do mesmo intervalo (a troca não muda o intervalo).
  const escolhiveis = plano
    ? todos
        .filter((p) => p.arquivado_em === null && p.oferecido_ao_cliente && cobravel(p))
        .filter((p) => escolheAoAssinar || p.intervalo === plano.intervalo)
        .sort((x, y) => x.preco_cents - y.preco_cents)
    : [];
  return {
    assinatura: a
      ? {
          estado: a.estado as EstadoDaAssinatura,
          trial_ate: a.trial_ate,
          prazo_extra_ate: a.prazo_extra_ate,
          proximo_vencimento: a.proximo_vencimento,
          vencida_desde: a.vencida_desde,
          cancela_no_fim: a.cancela_no_fim,
          modo: a.modo as Modo | null,
          provedor: a.provedor,
          link_de_pagamento: a.link_de_pagamento,
          assinaturas_vivas: a.assinaturas_vivas,
          plano_agendado: agendado ? { id: agendado.id, nome: agendado.nome } : null,
          periodo_pago_desde: a.periodo_pago_desde,
          troca_pagamento_url: a.troca_pagamento_url,
          troca_status: a.troca_status,
          pagamento_inicial_pendente: a.pagamento_inicial_pendente,
        }
      : null,
    plano: plano
      ? {
          id: plano.id, nome: plano.nome, preco_cents: plano.preco_cents, moeda: plano.moeda, intervalo: plano.intervalo,
          max_assentos: plano.max_assentos, max_canais: plano.max_canais, teto_ia_usd_cents: plano.teto_ia_usd_cents,
        }
      : null,
    uso,
    comparativo: {
      planos: escolhiveis.map(paraComparar),
      atual: plano ? paraComparar(plano) : null,
    },
    gastoIaUsdCents: Number(gasto.data ?? 0),
    fuso: (org.data as { timezone: string | null } | null)?.timezone ?? null,
    checkout: {
      provedor: provedorDoCheckout,
      documentoDoCadastro: sugestaoDoCadastro((org.data as { cnpj: string | null } | null)?.cnpj ?? null),
    },
    planosParaTroca: plano
      ? todos
          // Plano numa moeda que o provedor que cobra não cobra (EUR com o Asaas) não é oferecido.
          .filter((p) => p.arquivado_em === null && p.oferecido_ao_cliente && p.intervalo === plano.intervalo && p.id !== plano.id && cobravel(p))
          .map(paraTela)
      : [],
    escolheAoAssinar,
    // Nada assinado no provedor: o intervalo pode mudar junto (não há assinatura a ajustar).
    planosParaAssinar: escolheAoAssinar
      ? todos
          .filter((p) => p.arquivado_em === null && p.oferecido_ao_cliente && cobravel(p))
          .sort((x, y) => x.preco_cents - y.preco_cents)
          .map((p) => ({
            ...paraTela(p),
            atual: p.id === plano?.id,
            excedente: excedenteDoPlano(uso, p),
          }))
      : [],
  };
}
