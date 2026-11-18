/**
 * O RENDERIZADOR — papel + perfil + o que existe na organização → os campos da
 * versão do agente.
 *
 * PURO: sem banco, sem relógio, sem ambiente. A mesma entrada dá a mesma saída,
 * byte a byte — é o que deixa o hash servir de prova (`hashDosCampos`) e o que
 * deixa provar por teste que duas empresas de ramos diferentes recebem o MESMO
 * papel e só o bloco "## Esta empresa" muda.
 *
 * O texto final tem três partes, nesta ordem:
 *
 *   1. o PAPEL                 — igual para todas as empresas;
 *   2. as REGRAS COMUNS        — iguais para os quatro papéis;
 *   3. "## Esta empresa"       — GERADO aqui a partir do perfil e do contexto.
 *
 * ⚠️ O BLOCO "ESTA EMPRESA" É DADO GERADO, NÃO TEXTO ESCRITO À MÃO. O tipo de
 * agenda entra com o id e o slug REAIS, resolvidos pelo instalador; a etapa do
 * funil entra com o id real. Ninguém digita identificador neste arquivo.
 *
 * ⚠️ PREÇO E HORÁRIO NÃO ENTRAM NEM AQUI. O bloco diz ONDE consultar (catálogo,
 * agenda, base), nunca o valor. Formas de pagamento e perguntas frequentes vão
 * para a base de conhecimento, pelo instalador.
 */
import { createHash } from "node:crypto";

import type { PerfilDoNegocio } from "@/lib/schemas/equipe-pronta";
import { REGRAS_COMUNS } from "./papeis/comum";
import type { CamposDoAgente, ContextoDaInstalacao, PapelDaEquipe } from "./tipos";

/** O título do bloco gerado. Os testes de universalidade cortam o texto NELE. */
export const TITULO_DE_ESTA_EMPRESA = "## Esta empresa";

const TOM: Record<PerfilDoNegocio["atendente"]["tom"], string> = {
  caloroso: "caloroso e próximo",
  profissional: "profissional e cordial",
  direto: "direto e objetivo",
};

const IDIOMA: Record<PerfilDoNegocio["negocio"]["idioma"], string> = {
  "pt-BR": "português do Brasil",
  es: "espanhol",
  en: "inglês",
};

const PRIMEIRO_PASSO: Record<PerfilDoNegocio["primeiro_passo"]["tipo"], string> = {
  agendar: "marcar um compromisso na agenda",
  proposta: "preparar uma proposta",
  humano: "passar a conversa para uma pessoa da equipe",
};

function lista(itens: readonly string[]): string {
  return itens.map((item) => `- ${item}`).join("\n");
}

function secaoDaAgenda(contexto: ContextoDaInstalacao): string {
  if (contexto.agenda === null) {
    return "Agenda: esta empresa não marca compromisso pela conversa. Se a pessoa pedir para marcar, chame uma pessoa da equipe.";
  }
  // O id e o slug vão JUNTOS e literais: é a cópia deles que impede o modelo de
  // derivar um identificador a partir do nome do tipo.
  return [
    `Agenda: o tipo de atendimento desta empresa é "${contexto.agenda.nome}".`,
    `Nas ferramentas da agenda, use \`event_type_id\`: \`${contexto.agenda.id}\` (ou \`event_type_slug\`: \`${contexto.agenda.slug}\`). Copie exatamente; não use outro tipo.`,
  ].join("\n");
}

function secaoDoFunil(contexto: ContextoDaInstalacao): string {
  if (contexto.funil === null) {
    return "Funil: nenhum funil foi escolhido para a equipe. Não mova negócio de etapa.";
  }
  const { etapas } = contexto.funil;
  const linhas = [
    `Funil: "${contexto.funil.nome}" (\`pipeline_id\`: \`${contexto.funil.id}\`). Trabalhe só neste funil.`,
  ];
  const marcadas: [string, { id: string; nome: string } | undefined][] = [
    ["Qualificado", etapas.qualificado],
    ["Proposta", etapas.proposta],
    ["Perdido", etapas.perdido],
  ];
  for (const [rotulo, etapa] of marcadas) {
    if (etapa) linhas.push(`- ${rotulo}: etapa "${etapa.nome}" (\`to_stage_id\`: \`${etapa.id}\`).`);
  }
  if (etapas.perdido) {
    linhas.push(
      "Ao mover para a etapa de perdido, informe o motivo de perda (`lost_reason`) que a pessoa deu.",
    );
  }
  return linhas.join("\n");
}

function secaoDoPreco(perfil: PerfilDoNegocio): string {
  return perfil.oferta.informa_preco_por_mensagem
    ? "Preço: pode ser informado por mensagem — sempre o valor que o catálogo devolver, nunca outro."
    : "Preço: NÃO é informado por mensagem. Diga que o valor vem na proposta ou com a equipe.";
}

function secaoDoDesconto(perfil: PerfilDoNegocio): string {
  const { desconto } = perfil.regras;
  return desconto.modo === "nunca"
    ? "Desconto: esta empresa não dá desconto pela conversa. Se a pessoa pedir, chame uma pessoa da equipe."
    : `Desconto: pode existir, de até ${desconto.ate_percentual}%, e SEMPRE com aprovação de uma pessoa da equipe. Nunca prometa; diga que a equipe confirma.`;
}

function secaoDaProposta(perfil: PerfilDoNegocio): string {
  return perfil.proposta.usa
    ? `Proposta: esta empresa usa proposta. Ela é preparada como rascunho para a equipe aprovar, com validade de ${perfil.proposta.validade_dias} dias.`
    : "Proposta: esta empresa não usa proposta pela conversa. Se a pessoa pedir, chame uma pessoa da equipe.";
}

function secaoDaRecuperacao(perfil: PerfilDoNegocio): string {
  const r = perfil.recuperacao;
  return [
    `Retomada: uma conversa é considerada parada depois de ${r.dias_para_esfriar} dia(s) sem resposta.`,
    `No máximo ${r.toques_maximos} tentativa(s) de retomada, com ${r.intervalo_dias} dia(s) entre elas.`,
    `Contato parado há mais de ${r.limite_lead_frio_dias} dias: só com aprovação de uma pessoa da equipe.`,
  ].join(" ");
}

/**
 * O bloco "## Esta empresa". Exportado porque a tela de revisão o mostra, e
 * porque os testes de universalidade provam que é a ÚNICA parte que muda.
 */
export function blocoEstaEmpresa(perfil: PerfilDoNegocio, contexto: ContextoDaInstalacao): string {
  const partes = [
    TITULO_DE_ESTA_EMPRESA,
    [
      `Empresa: ${perfil.negocio.nome}.`,
      `O que faz: ${perfil.negocio.o_que_faz}`,
      ...(perfil.negocio.cidade ? [`Onde: ${perfil.negocio.cidade}.`] : []),
    ].join("\n"),
    [
      `Você se apresenta como ${perfil.atendente.nome}, em tom ${TOM[perfil.atendente.tom]}.`,
      `Chame quem escreve de "${perfil.atendente.como_chamar}" quando precisar se referir a essa pessoa.`,
      `Converse em ${IDIOMA[perfil.negocio.idioma]}.`,
    ].join("\n"),
    `Primeiro passo desta empresa: ${PRIMEIRO_PASSO[perfil.primeiro_passo.tipo]}.`,
    secaoDaAgenda(contexto),
    secaoDoFunil(contexto),
    perfil.qualificacao.perguntas.length > 0
      ? `Perguntas de qualificação:\n${lista(perfil.qualificacao.perguntas)}`
      : "Perguntas de qualificação: nenhuma definida. Entenda o que a pessoa quer e siga para o primeiro passo.",
    secaoDoPreco(perfil),
    secaoDaProposta(perfil),
    secaoDoDesconto(perfil),
    perfil.humano.situacoes.length > 0
      ? `Chame uma pessoa da equipe quando:\n${lista(perfil.humano.situacoes)}`
      : "Chame uma pessoa da equipe sempre que a pessoa pedir.",
    secaoDaRecuperacao(perfil),
    perfil.ligacoes.pode_ligar
      ? "Ligações: a equipe pode ligar para a pessoa, se ela aceitar."
      : "Ligações: não ofereça ligação. O atendimento é por mensagem.",
    "Serviços, preços, horários, políticas e perguntas frequentes NÃO estão neste texto: consulte o catálogo, a agenda e a base de conhecimento.",
  ];
  return partes.join("\n\n");
}

/** Sem repetição, na ordem em que apareceram, sem diferença de caixa. */
function semRepetir(itens: readonly string[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const item of itens) {
    const limpo = item.trim();
    const chave = limpo.toLowerCase();
    if (limpo === "" || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(limpo);
  }
  return saida;
}

/** Teto de `handoff_keywords` no schema da versão (`lib/ai/agents/validation.ts`). */
const TETO_DE_PALAVRAS = 20;

export function renderizarAgente(
  papel: PapelDaEquipe,
  perfil: PerfilDoNegocio,
  contexto: ContextoDaInstalacao,
): CamposDoAgente {
  const usaRegua = papel.usaReguaDeFollowup && contexto.reguaDeFollowupId !== null;
  return {
    system_prompt: [papel.prompt, REGRAS_COMUNS, blocoEstaEmpresa(perfil, contexto)].join("\n\n"),
    tool_ids: [...papel.toolIds],
    handoff_keywords: semRepetir([...papel.handoffKeywordsPadrao, ...perfil.humano.palavras]).slice(
      0,
      TETO_DE_PALAVRAS,
    ),
    followup: {
      enabled: usaRegua,
      flow_pointer_ids: usaRegua ? [contexto.reguaDeFollowupId as string] : [],
    },
    pipeline_ids: contexto.funil ? [contexto.funil.id] : [],
    knowledge_source_ids: [...contexto.knowledgeSourceIds],
    // Decisão P-03: proposta sempre como rascunho para a equipe aprovar. Com a
    // empresa dizendo que não usa proposta, a capacidade sai de todos os papéis.
    proposal_ai_draft_enabled: perfil.proposta.usa,
  };
}

/**
 * A forma CANÔNICA dos campos que a equipe pronta decide — o que entra no hash.
 *
 * Só estes campos. Modelo, credencial, orçamento e janela de histórico são do
 * cliente: trocar o modelo do agente não é "editar à mão" o que a equipe pronta
 * instalou, e não pode travar a próxima instalação.
 *
 * Listas de identificadores são ORDENADAS: a ordem delas no banco não é
 * decisão de ninguém. O texto e as palavras de passagem conservam a ordem.
 */
export function camposCanonicos(campos: {
  system_prompt?: unknown;
  tool_ids?: unknown;
  handoff_keywords?: unknown;
  followup?: unknown;
  pipeline_ids?: unknown;
  knowledge_source_ids?: unknown;
  proposal_ai_draft_enabled?: unknown;
}): CamposDoAgente {
  const textos = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const followup = (campos.followup ?? {}) as { enabled?: unknown; flow_pointer_ids?: unknown };
  return {
    system_prompt: typeof campos.system_prompt === "string" ? campos.system_prompt.trim() : "",
    tool_ids: textos(campos.tool_ids).sort(),
    handoff_keywords: textos(campos.handoff_keywords),
    followup: {
      enabled: followup.enabled === true,
      flow_pointer_ids: textos(followup.flow_pointer_ids).sort(),
    },
    pipeline_ids: textos(campos.pipeline_ids).sort(),
    knowledge_source_ids: textos(campos.knowledge_source_ids).sort(),
    proposal_ai_draft_enabled: campos.proposal_ai_draft_enabled !== false,
  };
}

/**
 * O hash dos campos — de uma versão lida do banco OU do que o renderizador
 * gerou. Os dois passam pela MESMA forma canônica, então dá para comparar um
 * com o outro: é assim que "editado à mão" é decidido contra o que está
 * publicado de fato, e não só contra um hash guardado.
 */
export function hashDosCampos(campos: Parameters<typeof camposCanonicos>[0]): string {
  const c = camposCanonicos(campos);
  // Chaves em ordem fixa: `JSON.stringify` respeita a ordem de inserção.
  const ordenado = {
    system_prompt: c.system_prompt,
    tool_ids: c.tool_ids,
    handoff_keywords: c.handoff_keywords,
    followup: { enabled: c.followup.enabled, flow_pointer_ids: c.followup.flow_pointer_ids },
    pipeline_ids: c.pipeline_ids,
    knowledge_source_ids: c.knowledge_source_ids,
    proposal_ai_draft_enabled: c.proposal_ai_draft_enabled,
  };
  return createHash("sha256").update(JSON.stringify(ordenado)).digest("hex");
}

export type SituacaoDoAgente =
  /** O que está publicado é o que o renderizador geraria agora. Nada a fazer. */
  | "em_dia"
  /** Está como o instalador deixou, mas o perfil ou o papel mudou: reaplicar é seguro. */
  | "desatualizado"
  /** Alguém mudou o agente fora da equipe pronta. Só sobrescreve com `forcar`. */
  | "editado_a_mao";

/**
 * EDITADO À MÃO?
 *
 * Três hashes, todos na forma canônica:
 *
 *   • `publicado` — os campos da versão PUBLICADA agora, lidos do banco;
 *   • `gerado`    — o que o renderizador geraria agora, com o perfil atual;
 *   • `instalado` — o que o instalador gravou da última vez (pode faltar).
 *
 * A decisão é contra o que está PUBLICADO DE FATO, não só contra o hash
 * guardado: se `publicado == gerado`, o agente está em dia e ponto — mesmo que
 * o hash guardado esteja velho ou ausente. Só é "editado à mão" quando o
 * publicado não bate com o que o instalador deixou NEM com o que ele geraria.
 *
 * Sem hash guardado e com o publicado diferente do gerado, não há como provar
 * que foi o instalador quem escreveu: fecha na dúvida, como edição à mão.
 */
export function situacaoDoAgente(hashes: {
  publicado: string;
  gerado: string;
  instalado: string | null;
}): SituacaoDoAgente {
  if (hashes.publicado === hashes.gerado) return "em_dia";
  if (hashes.instalado !== null && hashes.publicado === hashes.instalado) return "desatualizado";
  return "editado_a_mao";
}
