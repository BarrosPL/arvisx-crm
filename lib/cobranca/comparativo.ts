/**
 * O COMPARATIVO DOS PLANOS EM LINGUAGEM DE BENEFÍCIO (ArvisX, tarefa 2 dos planos).
 *
 * A tela de assinatura comparava planos por nome técnico de tela ("Fica de
 * fora: Agente de IA: Roteadores, Memória…"), e o cliente não via o que
 * justifica o plano maior. Agora a comparação fala em BLOCOS de benefício
 * (Atender, Automatizar com IA, Vender, Prospectar, Medir e gerir, Integrar,
 * IA avançada); o nome de cada tela, o mesmo do seletor, fica no detalhe.
 *
 * Os textos do card (descrição, para quem, destaques, limites, como funciona)
 * NÃO estão aqui: vêm do plano (migration 9803), escritos pelo dono. Este
 * módulo só classifica telas e faz contas. Puro: roda no servidor, na tela e
 * nos testes, sem banco.
 *
 * As telas de cada plano saem da MESMA régua da trava (`destinosDoPlano`):
 * o que o comparativo diz que sai é exatamente o que a trava recusaria.
 */
import { destinosDoPlano } from "@/lib/cobranca/telas-do-plano";
import type { ModuloOpcional } from "@/lib/instalacao/modulos";
import { NAV_CATALOG, NAV_GROUPS, type NavDestinationId } from "@/lib/navigation/catalogo";
import { essencial, permitidos } from "@/lib/navigation/interface";

export const BLOCOS = [
  { id: "atender", rotulo: "Atender" },
  { id: "automatizar", rotulo: "Automatizar com IA" },
  { id: "vender", rotulo: "Vender" },
  { id: "prospectar", rotulo: "Prospectar" },
  { id: "medir", rotulo: "Medir e gerir" },
  { id: "integrar", rotulo: "Integrar" },
  { id: "ia_avancada", rotulo: "IA avançada" },
] as const;
export type BlocoId = (typeof BLOCOS)[number]["id"];

/**
 * O bloco de cada tela do SELETOR de telas do plano. Toda tela do seletor tem
 * bloco: a cerca `tests/unit/planos-comparativo.test.ts` reprova tela nova sem
 * classificação. As telas do Standard que não são de IA (Radar, cadastro B2B,
 * importação, distribuição, recursos opcionais) contam como "Atender"; Atividades
 * e Automações, que entram no Standard, ficam em "Medir e gerir" e
 * "Automatizar com IA".
 */
export const BLOCO_DA_TELA: Readonly<Partial<Record<NavDestinationId, BlocoId>>> = {
  // Atender
  "/app/inbox": "atender",
  "/app/radar": "atender",
  "/app/agenda": "atender",
  "/app/templates": "atender",
  "/app/kanban": "atender",
  "/app/settings/tenant/pipelines": "atender",
  "/app/contacts": "atender",
  "/app/companies": "atender",
  "/app/people": "atender",
  "/app/tasks": "atender",
  "/app/tasks/planos": "atender",
  "/app/imports": "atender",
  "/app/connections": "atender",
  "/app/settings/tenant/agenda": "atender",
  "/app/agenda/avisos": "atender",
  "/app/settings/tags": "atender",
  "/app/lgpd/requests": "atender",
  "/app/settings/atendimento": "atender",
  "/app/settings/recursos": "atender",
  // Automatizar com IA
  "/app/ai/agents": "automatizar",
  "/app/ai/followups": "automatizar",
  "/app/ai/atendimento": "automatizar",
  "/app/ai/knowledge/sources": "automatizar",
  "/app/ai/credentials": "automatizar",
  "/app/ai/providers": "automatizar",
  "/app/ai/cases": "automatizar",
  "/app/ai/inbox": "automatizar",
  "/app/ai/cases/avisos": "automatizar",
  "/app/ai/usage": "automatizar",
  "/app/settings/automacoes": "automatizar",
  // Vender
  "/app/proposals": "vender",
  "/app/products": "vender",
  "/app/comandas": "vender",
  "/app/campaigns": "vender",
  "/app/settings/tenant/proposals": "vender",
  "/app/settings/tenant/proposals/modelos": "vender",
  "/app/settings/tenant/financeiro": "vender",
  "/app/settings/metas": "vender",
  // Prospectar
  "/app/prospecting": "prospectar",
  "/app/cold-call": "prospectar",
  "/app/calls": "prospectar",
  "/app/settings/voip-trunk": "prospectar",
  // Medir e gerir
  "/app/activities": "medir",
  "/app/metrics": "medir",
  "/app/faturamento": "medir",
  "/app/honorarios": "medir",
  "/app/ads/meta": "medir",
  "/app/ai/evolution": "medir",
  "/app/audit": "medir",
  "/app/settings/conversoes": "medir",
  "/app/settings/meta-ads": "medir",
  // Integrar
  "/app/webhooks": "integrar",
  "/app/integrations/nuvemshop": "integrar",
  "/app/settings/api-tokens": "integrar",
  "/app/settings/servidor-mcp-externo": "integrar",
  "/app/extensions": "integrar",
  "/app/integracao-dados": "integrar",
  "/app/settings/marca": "integrar",
  // IA avançada
  "/app/ai/routers": "ia_avancada",
  "/app/ai/memory": "ia_avancada",
  "/app/ai/skills": "ia_avancada",
  "/app/ai/proposals": "ia_avancada",
  "/app/ai/runs": "ia_avancada",
};

/** As telas do seletor (o que quem administra vê nesta instalação, sem as essenciais). */
export function telasDoSeletor(modulos?: readonly ModuloOpcional[]) {
  return permitidos(false, "admin", modulos).filter((d) => !essencial(d, "admin"));
}

/** As telas do SELETOR que o plano libera, na ordem do catálogo. */
export function telasDoPlanoNoSeletor(interfaceDoPlano: unknown, modulos?: readonly ModuloOpcional[]): string[] {
  const liberadas = (destinosDoPlano({ tipo: "plano", interface: interfaceDoPlano }) ?? []) as readonly string[];
  return telasDoSeletor(modulos)
    .filter((d) => liberadas.includes(d.href))
    .map((d) => d.href);
}

/**
 * O nome da tela como o seletor mostra. O seletor tem nomes repetidos em grupos
 * diferentes ("Propostas" em CRM, Agente de IA e Organização; "Meta Ads" em
 * Análise e Organização): fora do grupo, o nome repetido leva o grupo junto.
 * Devolve as duas partes (pt-BR) para quem desenha traduzir cada uma.
 */
export function nomeDaTela(href: string): { tela: string; grupo: string | null } {
  const d = NAV_CATALOG.find((x) => x.href === href);
  if (!d) return { tela: href, grupo: null };
  const repetido = NAV_CATALOG.filter((x) => x.label === d.label).length > 1;
  return { tela: d.label, grupo: repetido ? (NAV_GROUPS.find((g) => g.id === d.group)?.label ?? null) : null };
}

export interface MudancaDoBloco {
  bloco: BlocoId;
  rotulo: string;
  /** hrefs das telas que entram, na ordem do catálogo. */
  entram: string[];
  /** hrefs das telas que saem, na ordem do catálogo. */
  saem: string[];
}

/** O que entra e o que sai ao mudar de `de` para `para`, por bloco. Só blocos com mudança. */
export function entraESai(de: readonly string[], para: readonly string[]): MudancaDoBloco[] {
  const ordem = NAV_CATALOG.map((d) => d.href as string);
  const porOrdem = (a: string, b: string) => ordem.indexOf(a) - ordem.indexOf(b);
  const entram = para.filter((h) => !de.includes(h)).sort(porOrdem);
  const saem = de.filter((h) => !para.includes(h)).sort(porOrdem);
  const doBloco = (lista: string[], bloco: BlocoId) =>
    lista.filter((h) => BLOCO_DA_TELA[h as NavDestinationId] === bloco);
  return BLOCOS.flatMap((b) => {
    const m = { bloco: b.id, rotulo: b.rotulo, entram: doBloco(entram, b.id), saem: doBloco(saem, b.id) };
    return m.entram.length + m.saem.length > 0 ? [m] : [];
  });
}

/** Os blocos que o plano tem (alguma tela liberada), na ordem dos blocos. */
export function blocosDoPlano(telas: readonly string[]): BlocoId[] {
  return BLOCOS.filter((b) => telas.some((h) => BLOCO_DA_TELA[h as NavDestinationId] === b.id)).map((b) => b.id);
}

/** Diferença de preço entre dois planos do MESMO intervalo e moeda; `null` quando não se comparam. */
export function diferencaDePreco(
  de: { preco_cents: number; moeda: string; intervalo: string },
  para: { preco_cents: number; moeda: string; intervalo: string },
): number | null {
  if (de.moeda !== para.moeda || de.intervalo !== para.intervalo) return null;
  return para.preco_cents - de.preco_cents;
}

/**
 * O plano a destacar como "Mais completo": o que libera mais telas entre os que
 * NÃO incluem os agentes feitos pela equipe (o Equipe Completa é um serviço, não
 * um degrau de telas); empate, o mais caro. Sem destaque com menos de 2 planos,
 * ou quando todos liberam o mesmo tanto.
 */
export function maisCompleto(
  planos: readonly { id: string; telas: readonly string[]; preco_cents: number; inclui_agentes_arvisx: boolean }[],
): string | null {
  const candidatos = planos.filter((p) => !p.inclui_agentes_arvisx);
  if (planos.length < 2 || candidatos.length === 0) return null;
  const maior = Math.max(...candidatos.map((p) => p.telas.length));
  if (planos.every((p) => p.telas.length === maior)) return null;
  const empatados = candidatos.filter((p) => p.telas.length === maior);
  return empatados.sort((a, b) => b.preco_cents - a.preco_cents)[0]!.id;
}
