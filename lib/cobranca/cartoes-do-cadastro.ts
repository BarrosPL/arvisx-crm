/**
 * OS CARTÕES DE PLANO DO CADASTRO — o que a pessoa lê antes de escolher.
 *
 * O cadastro mostrava os planos numa lista suspensa, do mais barato ao mais
 * caro, com o primeiro já marcado. Cada linha dizia nome, preço e dias de teste,
 * e mais nada: quem não abria a lista saía com o plano mais barato sem ter lido
 * que ele não tem agentes de IA. Medido pelo dono em 13/11/2026: quase todo
 * cadastro novo entrava no plano mais barato.
 *
 * Aqui cada plano oferecido ganha o texto que já está cadastrado para ele (os
 * mesmos campos que a página inicial mostra), e duas coisas que só existem na
 * comparação entre eles:
 *
 *  - `temIa`: o plano libera a tela de Agentes? Lido das telas do plano, a mesma
 *    fonte que trava as telas e o motor. `null` = não deu para saber (a vitrine
 *    não trouxe o plano), e aí o cartão não afirma nada sobre IA.
 *  - `recomendado`: o plano MAIS BARATO que tem IA, e só quando existe algum
 *    plano oferecido sem IA. É a régua do produto, não de um nome de plano: se
 *    todos têm IA (ou nenhum tem), ninguém leva o selo.
 *
 * Função pura: não lê banco. Quem lê é a página.
 */
import type { PlanoDoCadastro } from "./cadastro";

/** A tela que decide "este plano tem agentes de IA". */
export const TELA_DOS_AGENTES_DE_IA = "/app/ai/agents";

/** O que a vitrine sabe de um plano e o cartão usa. Estruturalmente, `PlanoDaVitrine`. */
export interface TextosDoPlano {
  id: string;
  descricao_curta: string | null;
  para_quem: string | null;
  destaques: string[];
  max_canais: number | null;
  max_assentos: number | null;
  telas: string[];
}

export interface CartaoDePlano extends PlanoDoCadastro {
  descricao_curta: string | null;
  para_quem: string | null;
  destaques: string[];
  max_canais: number | null;
  max_assentos: number | null;
  temIa: boolean | null;
  recomendado: boolean;
}

export function cartoesDoCadastro(
  planos: readonly PlanoDoCadastro[],
  textos: readonly TextosDoPlano[],
): CartaoDePlano[] {
  const porId = new Map(textos.map((t) => [t.id, t]));
  const cartoes = planos.map((plano): CartaoDePlano => {
    const texto = porId.get(plano.id);
    return {
      ...plano,
      descricao_curta: texto?.descricao_curta ?? null,
      para_quem: texto?.para_quem ?? null,
      destaques: texto?.destaques ?? [],
      max_canais: texto?.max_canais ?? null,
      max_assentos: texto?.max_assentos ?? null,
      temIa: texto ? texto.telas.includes(TELA_DOS_AGENTES_DE_IA) : null,
      recomendado: false,
    };
  });
  const algumSemIa = cartoes.some((c) => c.temIa === false);
  if (!algumSemIa) return cartoes;
  // `planos` chega do mais barato ao mais caro; em empate de preço, vale a ordem.
  const recomendado = [...cartoes].filter((c) => c.temIa === true).sort((a, b) => a.preco_cents - b.preco_cents)[0];
  return cartoes.map((c) => ({ ...c, recomendado: c.id === recomendado?.id }));
}

/** O plano que a página inicial mandou na URL, se ele ainda é oferecido. */
export function planoDaUrl(cartoes: readonly CartaoDePlano[], valor: string | undefined): string | null {
  if (!valor) return null;
  return cartoes.find((c) => c.id === valor)?.id ?? null;
}
