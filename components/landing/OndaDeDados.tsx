"use client";

import { useEffect, useRef } from "react";

/**
 * A onda de dados de arvisx.com.br (js/hero.js do site) como fundo da página
 * provisória: um campo de pontos em perspectiva ondulando, com uma frente
 * dourada que vem do fundo até a frente de tempos em tempos e segue o mouse
 * de leve. Aqui o campo ocupa a tela inteira, sem a coluna de texto do hero.
 *
 * Movimento reduzido: um quadro parado, com a frente dourada no meio.
 */

type Cor = [number, number, number];

const AZUL: Cor = [78, 168, 255];
const OURO: Cor = [212, 175, 55];

const COLS = 64;
const LINHAS = 26;
const Z_PERTO = 1.25;
const Z_FUNDO = 6.65;

function rgba(cor: Cor, a: number) {
  const alfa = Math.max(0, Math.min(1, a)).toFixed(3);
  return `rgba(${cor[0] | 0}, ${cor[1] | 0}, ${cor[2] | 0}, ${alfa})`;
}

function misturar(a: Cor, b: Cor, q: number): Cor {
  return [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q, a[2] + (b[2] - a[2]) * q];
}

function altura(x: number, z: number, t: number) {
  return (
    0.17 * Math.sin(x * 1.25 + t * 0.85) +
    0.11 * Math.sin(z * 1.6 - t * 1.15) +
    0.06 * Math.sin((x - z) * 2.3 + t * 1.6)
  );
}

export function OndaDeDados({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const campo = ref.current;
    const ctx = campo?.getContext("2d");
    if (!campo || !ctx) return;

    const semMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ponteiro = { x: 0, y: 0, ativo: false };
    const mira = { x: 0, y: 0 };
    let W = 0;
    let H = 0;
    let rodando = false;
    let quadroId = 0;
    const inicio = performance.now();

    const medir = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const caixa = campo.getBoundingClientRect();
      W = caixa.width;
      H = caixa.height;
      campo.width = Math.round(W * dpr);
      campo.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const desenhar = (t: number) => {
      mira.x += ((ponteiro.ativo ? ponteiro.x : 0) - mira.x) * 0.05;
      mira.y += ((ponteiro.ativo ? ponteiro.y : 0) - mira.y) * 0.05;

      const estreito = W < 700;
      const base = H;
      const horizonte = H * 0.3;
      const camY = 1.05 + mira.y * 0.08;
      const meio = W / 2 + mira.x * 30;
      const F = W * (estreito ? 0.62 : 0.4);
      const Fv = ((base - 24 - horizonte) * Z_PERTO) / camY;
      const frente = 6.4 - ((t * 1.25) % 8);

      ctx.clearRect(0, 0, W, H);

      for (let r = LINHAS - 1; r >= 0; r--) {
        const z = Z_PERTO + r * ((Z_FUNDO - Z_PERTO) / LINHAS);
        const ouro = Math.exp(-Math.pow(z - frente, 2) / 0.18);
        const perto = 1 / z;

        ctx.beginPath();
        for (let c = 0; c < COLS; c++) {
          const x = (c / (COLS - 1) - 0.5) * 7;
          const sx = meio + (x * F) / z;
          const sy = horizonte + ((camY - altura(x, z, t)) * Fv) / z;
          if (sy > base) continue;

          const alfa = 0.1 + perto * 0.75 + ouro * 0.5;
          const tam = 0.7 + perto * 2.4 + ouro * 1.3;

          ctx.fillStyle = rgba(misturar(AZUL, OURO, ouro), alfa);
          ctx.fillRect(sx - tam / 2, sy - tam / 2, tam, tam);

          if (c === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.strokeStyle =
          ouro > 0.3 ? rgba(misturar(AZUL, OURO, 0.5), 0.05 + ouro * 0.04) : rgba(AZUL, 0.05);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };

    const quadro = (agora: number) => {
      if (document.hidden) {
        rodando = false;
        return;
      }
      desenhar((agora - inicio) / 1000);
      quadroId = window.requestAnimationFrame(quadro);
    };

    const ligar = () => {
      if (rodando || semMovimento) return;
      rodando = true;
      quadroId = window.requestAnimationFrame(quadro);
    };

    const preparar = () => {
      medir();
      if (semMovimento) desenhar(2.2);
    };

    const aoMover = (e: PointerEvent) => {
      ponteiro.x = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth - 0.5) * 2));
      ponteiro.y = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight - 0.5) * 2));
      ponteiro.ativo = true;
    };
    const aoSair = () => {
      ponteiro.ativo = false;
    };
    const aoMudarVisibilidade = () => {
      if (!document.hidden) ligar();
    };

    preparar();
    const observador = new ResizeObserver(preparar);
    observador.observe(campo);
    window.addEventListener("pointermove", aoMover);
    document.documentElement.addEventListener("pointerleave", aoSair);
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    ligar();

    return () => {
      rodando = false;
      window.cancelAnimationFrame(quadroId);
      observador.disconnect();
      window.removeEventListener("pointermove", aoMover);
      document.documentElement.removeEventListener("pointerleave", aoSair);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
