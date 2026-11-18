/**
 * EQUIPE PRONTA — o QUESTIONÁRIO EM PASSOS (a parte pura da tela).
 *
 * A tela `/app/ai/equipe-pronta` pergunta os onze blocos do perfil
 * (`lib/schemas/equipe-pronta.ts`) em seis passos e salva o rascunho ao fim de
 * cada um. O que mora aqui é o que dá para medir sem navegador:
 *
 *   • quais blocos cada passo pergunta (todo bloco em exatamente um passo);
 *   • o corpo do PUT de um passo — só os blocos dele, já limpos;
 *   • em que passo está cada resposta obrigatória que falta.
 *
 * ⚠️ O PUT junta POR BLOCO (`respostas || excluded.respostas`): o bloco que
 * vai substitui o bloco de mesmo nome inteiro. Por isso um passo manda os
 * blocos DELE completos e nenhum outro — mandar um bloco vazio de outro passo
 * apagaria o que já foi respondido lá.
 */
import type {
  BLOCOS_DO_QUESTIONARIO} from "@/lib/schemas/equipe-pronta";
import {
  type RascunhoDoPerfil,
} from "@/lib/schemas/equipe-pronta";

export type BlocoDoPerfil = (typeof BLOCOS_DO_QUESTIONARIO)[number] | "onde";

export interface PassoDoQuestionario {
  id: "negocio" | "atendente" | "venda" | "regras" | "recuperacao" | "onde";
  titulo: string;
  /** Uma linha: o que este passo decide. */
  resumo: string;
  blocos: readonly BlocoDoPerfil[];
  /** Tem resposta sem padrão: sem ela não dá para instalar. */
  obrigatorio: boolean;
}

export const PASSOS_DO_QUESTIONARIO: readonly PassoDoQuestionario[] = [
  {
    id: "negocio",
    titulo: "Seu negócio",
    resumo: "O nome da empresa e o que ela faz.",
    blocos: ["negocio"],
    obrigatorio: true,
  },
  {
    id: "atendente",
    titulo: "O atendente",
    resumo: "Como os agentes se apresentam e falam.",
    blocos: ["atendente"],
    obrigatorio: true,
  },
  {
    id: "venda",
    titulo: "Como você vende",
    resumo: "O primeiro passo que leva à venda, a agenda e a proposta.",
    blocos: ["oferta", "primeiro_passo", "proposta"],
    obrigatorio: true,
  },
  {
    id: "regras",
    titulo: "Perguntas e regras",
    resumo: "O que perguntar a quem chega, desconto e quando chamar uma pessoa.",
    blocos: ["qualificacao", "regras", "humano"],
    obrigatorio: false,
  },
  {
    id: "recuperacao",
    titulo: "Recuperação e respostas",
    resumo: "Quando voltar a falar com quem sumiu e o que os agentes sabem responder.",
    blocos: ["recuperacao", "faq", "ligacoes"],
    obrigatorio: false,
  },
  {
    id: "onde",
    titulo: "Onde instalar",
    resumo: "O WhatsApp, o funil e os telefones de teste.",
    blocos: ["onde"],
    obrigatorio: false,
  },
] as const;

export type PassoId = PassoDoQuestionario["id"];

/**
 * O mesmo valor sem o que o schema recusaria por estar VAZIO: texto em branco,
 * item em branco de lista, objeto que ficou sem campo. Campo de formulário
 * vazio é "não respondi", e no rascunho isso é ausência — não `""`.
 *
 * `false` e `0` ficam: são respostas.
 */
export function semVazios(valor: unknown): unknown {
  if (typeof valor === "string") {
    const texto = valor.trim();
    return texto === "" ? undefined : texto;
  }
  if (Array.isArray(valor)) {
    return valor.map(semVazios).filter((v) => v !== undefined);
  }
  if (valor !== null && typeof valor === "object") {
    const pares = Object.entries(valor as Record<string, unknown>)
      .map(([k, v]) => [k, semVazios(v)] as const)
      .filter(([, v]) => v !== undefined);
    return Object.fromEntries(pares);
  }
  return valor === null ? undefined : valor;
}

/**
 * As uniões entram inteiras ou não entram (`rascunhoSchema`): uma agenda "a
 * criar" sem nome, ou um desconto "com aprovação" sem percentual, ainda não é
 * resposta — sai do corpo em vez de reprovar o passo inteiro.
 */
function semUniaoPelaMetade(bloco: BlocoDoPerfil, limpo: Record<string, unknown>): Record<string, unknown> {
  if (bloco === "primeiro_passo") {
    const agenda = limpo.agenda as Record<string, unknown> | undefined;
    const inteira =
      agenda?.modo === "existente"
        ? typeof agenda.event_type_id === "string"
        : agenda?.modo === "criar"
          ? typeof agenda.nome === "string"
          : false;
    if (!inteira) {
      const { agenda: _fora, ...resto } = limpo;
      return resto;
    }
  }
  if (bloco === "regras") {
    const desconto = limpo.desconto as Record<string, unknown> | undefined;
    const inteiro =
      desconto?.modo === "nunca" ||
      (desconto?.modo === "com_aprovacao" && typeof desconto.ate_percentual === "number");
    if (!inteiro) {
      const { desconto: _fora, ...resto } = limpo;
      return resto;
    }
  }
  return limpo;
}

/**
 * O corpo do PUT de um passo: os blocos DELE, limpos. Bloco que o formulário
 * nem tocou vai como `{}` — é o que o faz existir no rascunho com os padrões,
 * e é o que apaga um campo que a pessoa esvaziou.
 */
export function respostasDoPasso(passoId: PassoId, formulario: RascunhoDoPerfil): RascunhoDoPerfil {
  const passo = PASSOS_DO_QUESTIONARIO.find((p) => p.id === passoId);
  if (!passo) return {};
  const corpo: Record<string, unknown> = {};
  for (const bloco of passo.blocos) {
    const limpo = (semVazios(formulario[bloco] ?? {}) ?? {}) as Record<string, unknown>;
    corpo[bloco] = semUniaoPelaMetade(bloco, limpo);
  }
  return corpo as RascunhoDoPerfil;
}

/**
 * Em que passos estão as respostas obrigatórias que faltam.
 *
 * `faltam` é o que `oQueFaltaNoRascunho` devolve: caminhos `bloco.campo`.
 */
export function passosComPendencia(faltam: readonly string[]): PassoId[] {
  const blocos = new Set(faltam.map((caminho) => caminho.split(".")[0]));
  return PASSOS_DO_QUESTIONARIO.filter((p) => p.blocos.some((b) => blocos.has(b))).map((p) => p.id);
}

/** O primeiro passo com pendência — onde a tela abre quando falta algo. */
export function primeiroPassoPendente(faltam: readonly string[]): PassoId | null {
  return passosComPendencia(faltam)[0] ?? null;
}
