/**
 * Onde desenhar caixas, setas e números por cima da foto.
 *
 * As fotos não têm nada desenhado: as medidas vêm em `capturas.json`, na base
 * 1440×900. Esta é a mesma geometria do site do curso (`curso/site/app.js`,
 * `posicionar`/`seta`), em TypeScript e sem HTML: o componente desenha um SVG
 * com o mesmo `viewBox` da base, então tudo escala com a largura renderizada.
 * O recorte à foto é o de `curso/geometria.ts`.
 */
import { caixaNaFoto } from "@/curso/geometria";

import type { DestaqueDaFoto } from "./conteudo";

/** Folga da caixa e raio do selo, em pixels da base. */
const FOLGA = 6;
const RAIO = 22;

export interface Caixa {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DesenhoDoDestaque {
  numero: number;
  rotulo: string;
  tipo: DestaqueDaFoto["tipo"];
  caixa: Caixa;
  /** `numero` só marca o selo; caixa e seta também contornam o alvo. */
  contorno: boolean;
  selo: { x: number; y: number };
  seta: { linha: [number, number, number, number]; ponta: string } | null;
}

type Ponto = [number, number];

function livre(p: Ponto, caixas: Caixa[], selos: Ponto[], W: number, H: number): boolean {
  if (p[0] < RAIO || p[1] < RAIO || p[0] > W - RAIO || p[1] > H - RAIO) return false;
  for (const c of caixas) {
    if (p[0] > c.x - RAIO && p[0] < c.x + c.w + RAIO && p[1] > c.y - RAIO && p[1] < c.y + c.h + RAIO) {
      return false;
    }
  }
  return selos.every((s) => Math.hypot(p[0] - s[0], p[1] - s[1]) >= 2 * RAIO + 4);
}

function seta(de: Ponto, ate: Ponto): NonNullable<DesenhoDoDestaque["seta"]> {
  const ang = Math.atan2(ate[1] - de[1], ate[0] - de[0]);
  const t = 24;
  const a = 0.45;
  const p1: Ponto = [ate[0] - t * Math.cos(ang - a), ate[1] - t * Math.sin(ang - a)];
  const p2: Ponto = [ate[0] - t * Math.cos(ang + a), ate[1] - t * Math.sin(ang + a)];
  const meio: Ponto = [ate[0] - 0.8 * t * Math.cos(ang), ate[1] - 0.8 * t * Math.sin(ang)];
  return {
    linha: [de[0], de[1], meio[0], meio[1]],
    ponta: [ate, p1, p2].map((p) => p.join(",")).join(" "),
  };
}

/** Selo nunca cobre um alvo: o primeiro candidato livre vence; sem lugar, o menos ruim. */
function posicionar(
  c: Caixa,
  tipo: DestaqueDaFoto["tipo"],
  caixas: Caixa[],
  selos: Ponto[],
  W: number,
  H: number,
): { selo: Ponto; ponta?: Ponto } {
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const cands: { selo: Ponto; ponta?: Ponto }[] = [];
  if (tipo === "seta") {
    const L = 110;
    const g = 10;
    const d = L * 0.7;
    const bases: [Ponto, Ponto][] = [
      [[c.x - g, cy], [-L, 0]],
      [[cx, c.y - g], [0, -L]],
      [[c.x + c.w + g, cy], [L, 0]],
      [[cx, c.y + c.h + g], [0, L]],
      [[c.x - g, c.y - g], [-d, -d]],
      [[c.x + c.w + g, c.y - g], [d, -d]],
      [[c.x - g, c.y + c.h + g], [-d, d]],
      [[c.x + c.w + g, c.y + c.h + g], [d, d]],
    ];
    for (const [ponta, desvio] of bases) {
      cands.push({ selo: [ponta[0] + desvio[0], ponta[1] + desvio[1]], ponta });
    }
  } else {
    const f = RAIO + 6;
    const pontos: Ponto[] = [
      [c.x - f, cy],
      [c.x - f, c.y - f + RAIO],
      [cx, c.y - f],
      [c.x + c.w + f, cy],
      [cx, c.y + c.h + f],
      [c.x - f, c.y - f],
      [c.x + c.w + f, c.y - f],
    ];
    for (const selo of pontos) cands.push({ selo });
  }
  const achado = cands.find((cand) => livre(cand.selo, caixas, selos, W, H));
  if (achado) return achado;
  const reserva = cands[0]!;
  return {
    ...reserva,
    selo: [
      Math.min(W - RAIO, Math.max(RAIO, reserva.selo[0])),
      Math.min(H - RAIO, Math.max(RAIO, reserva.selo[1])),
    ],
  };
}

/**
 * Destaque inteiramente fora da foto é descartado (o recorte de
 * `caixaNaFoto` recusa), em vez de virar seta apontando para o nada.
 */
export function desenharDestaques(
  destaques: readonly DestaqueDaFoto[],
  W: number,
  H: number,
): DesenhoDoDestaque[] {
  const validos = destaques.flatMap((d) => {
    try {
      const r = caixaNaFoto({ x: d.x, y: d.y, width: d.w, height: d.h }, W, H);
      return [{ ...d, ...r }];
    } catch {
      return [];
    }
  });
  const caixas = validos.map((d) => ({
    x: d.x - FOLGA,
    y: d.y - FOLGA,
    w: d.w + 2 * FOLGA,
    h: d.h + 2 * FOLGA,
  }));
  const postos: Ponto[] = [];
  return validos.map((d, i) => {
    const caixa = caixas[i]!;
    const lugar = posicionar(caixa, d.tipo, caixas, postos, W, H);
    postos.push(lugar.selo);
    return {
      numero: i + 1,
      rotulo: d.rotulo,
      tipo: d.tipo,
      caixa,
      contorno: d.tipo !== "numero",
      selo: { x: lugar.selo[0], y: lugar.selo[1] },
      seta: d.tipo === "seta" && lugar.ponta ? seta(lugar.selo, lugar.ponta) : null,
    };
  });
}

export const RAIO_DO_SELO = RAIO;
