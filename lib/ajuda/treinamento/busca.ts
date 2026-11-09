/**
 * A busca do treinamento: título e texto de lição e de passo, e as histórias.
 *
 * Roda no servidor (o índice inteiro tem ~400 mil caracteres, que não vale
 * mandar ao navegador); cada resultado leva a `tela` do módulo para o cliente
 * recortar pelo que a pessoa vê no menu. História não tem tela: aparece para
 * todos, e os links dela para lições são recortados na própria página.
 */
import type { Treinamento } from "./conteudo";

export const RAIZ_DO_TREINAMENTO = "/app/ajuda/treinamento";

export const hrefDoModulo = (modulo: string) => `${RAIZ_DO_TREINAMENTO}/${modulo}`;
export const ancoraDaLicao = (licao: string) => `licao-${licao}`;
export const ancoraDoPasso = (licao: string, passo: string) => `passo-${licao}-${passo}`;
export const hrefDaLicao = (modulo: string, licao: string) =>
  `${hrefDoModulo(modulo)}#${ancoraDaLicao(licao)}`;
export const hrefDoPasso = (modulo: string, licao: string, passo: string) =>
  `${hrefDoModulo(modulo)}#${ancoraDoPasso(licao, passo)}`;
export const hrefDoNicho = (nicho: string) => `${RAIZ_DO_TREINAMENTO}/historias/${nicho}`;
export const hrefDaJornada = (nicho: string, jornada: string) =>
  `${hrefDoNicho(nicho)}#historia-${jornada}`;

export interface EntradaDeBusca {
  tipo: "licao" | "passo" | "historia";
  titulo: string;
  /** Onde fica: "Módulo › Lição" ou "Histórias › Nicho". */
  caminho: string;
  href: string;
  /** Tela do módulo; ausente em história (vale para todos). */
  tela?: string;
  /** Texto e peso: título pesa mais que corpo. */
  campos: [string, number][];
}

export interface ResultadoDaBusca {
  tipo: EntradaDeBusca["tipo"];
  titulo: string;
  caminho: string;
  href: string;
  tela?: string;
  trecho: string;
}

/** Minúsculas e sem acento: "notificação" acha "notificacao" e vice-versa. */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function indiceDeBusca(dados: Treinamento): EntradaDeBusca[] {
  const entradas: EntradaDeBusca[] = [];
  for (const m of dados.modulos) {
    for (const l of m.licoes) {
      entradas.push({
        tipo: "licao",
        titulo: l.titulo,
        caminho: m.titulo,
        href: hrefDaLicao(m.id, l.id),
        tela: m.tela,
        campos: [
          [l.titulo, 5],
          // O trecho sai do primeiro campo depois do título: o objetivo lê melhor que as palavras-chave.
          [l.objetivo, 1],
          [l.busca.join(" "), 3],
          [m.titulo, 2],
        ],
      });
      l.passos.forEach((p, i) => {
        entradas.push({
          tipo: "passo",
          titulo: p.titulo,
          caminho: `${m.titulo} › ${l.titulo} › Passo ${i + 1}`,
          href: hrefDoPasso(m.id, l.id, p.id),
          tela: m.tela,
          campos: [
            [p.titulo, 4],
            [p.texto, 1],
            [p.dica ?? "", 1],
            [(p.foto?.destaques ?? []).map((d) => d.rotulo).join(" "), 1],
          ],
        });
      });
    }
  }
  for (const n of dados.nichos) {
    for (const j of n.jornadas) {
      entradas.push({
        tipo: "historia",
        titulo: j.titulo,
        caminho: `Histórias › ${n.titulo}`,
        href: hrefDaJornada(n.id, j.id),
        campos: [
          [j.titulo, 5],
          [n.titulo, 3],
          [`${j.empresa} ${j.contexto} ${j.resultado}`, 1],
          [j.cenas.map((c) => `${c.titulo} ${c.cliente} ${c.operacao} ${c.valor}`).join(" "), 1],
        ],
      });
    }
  }
  return entradas;
}

function trecho(entrada: EntradaDeBusca, termos: string[]): string {
  const corpo = entrada.campos.slice(1).map(([t]) => t).filter(Boolean);
  for (const texto of corpo) {
    const n = normalizar(texto);
    const pos = Math.min(...termos.map((t) => n.indexOf(t)).filter((i) => i >= 0));
    if (Number.isFinite(pos)) {
      const ini = Math.max(0, pos - 60);
      const fim = Math.min(texto.length, pos + 120);
      return `${ini > 0 ? "…" : ""}${texto.slice(ini, fim).trim()}${fim < texto.length ? "…" : ""}`;
    }
  }
  const primeiro = corpo[0] ?? "";
  return primeiro.length > 180 ? `${primeiro.slice(0, 180).trim()}…` : primeiro;
}

/**
 * Todos os termos precisam aparecer (em qualquer campo). A nota soma o peso
 * do campo por termo encontrado; o título inteiro igual à busca vai ao topo.
 */
export function buscar(
  indice: readonly EntradaDeBusca[],
  consulta: string,
  limite = 60,
): ResultadoDaBusca[] {
  const termos = normalizar(consulta).split(/\s+/).filter((t) => t.length >= 2);
  if (!termos.length) return [];
  const frase = normalizar(consulta).trim();
  const pontuados: { entrada: EntradaDeBusca; nota: number }[] = [];
  for (const entrada of indice) {
    const campos = entrada.campos.map(([t, peso]) => [normalizar(t), peso] as const);
    let nota = 0;
    let todos = true;
    for (const termo of termos) {
      const pesos = campos.filter(([t]) => t.includes(termo)).map(([, peso]) => peso);
      if (!pesos.length) {
        todos = false;
        break;
      }
      nota += Math.max(...pesos);
    }
    if (!todos) continue;
    const titulo = normalizar(entrada.titulo);
    if (titulo === frase) nota += 20;
    else if (titulo.includes(frase)) nota += 8;
    pontuados.push({ entrada, nota });
  }
  return pontuados
    .sort((a, b) => b.nota - a.nota)
    .slice(0, limite)
    .map(({ entrada }) => ({
      tipo: entrada.tipo,
      titulo: entrada.titulo,
      caminho: entrada.caminho,
      href: entrada.href,
      ...(entrada.tela ? { tela: entrada.tela } : {}),
      trecho: trecho(entrada, termos),
    }));
}
