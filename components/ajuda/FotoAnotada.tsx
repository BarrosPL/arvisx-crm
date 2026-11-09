import { useId } from "react";

import type { FotoDoPasso } from "@/lib/ajuda/treinamento/conteudo";
import { desenharDestaques } from "@/lib/ajuda/treinamento/destaques";

const pct = (v: number, total: number) => `${(v / total) * 100}%`;

/**
 * A foto de um passo com os destaques desenhados POR CIMA (a foto não tem
 * nada desenhado). O SVG usa o `viewBox` da base em que as medidas foram
 * tiradas (1440×900), então caixas e setas escalam com a largura renderizada;
 * os números são HTML posicionados em porcentagem, para o texto não esticar.
 */
export function FotoAnotada({ foto, alt }: { foto: FotoDoPasso; alt: string }) {
  const mascara = `veu-${useId().replace(/:/g, "")}`;
  const W = foto.largura;
  const H = foto.altura;
  const desenhos = desenharDestaques(foto.destaques, W, H);

  return (
    <div className="flex flex-col gap-3">
      <figure
        className="relative m-0 w-full max-w-full overflow-hidden rounded-lg border bg-muted"
        style={{ aspectRatio: `${W} / ${H}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- estático do pacote; a base pode ser externa (AJUDA_FOTOS_BASE) */}
        <img
          src={foto.src}
          alt={alt}
          loading="lazy"
          decoding="async"
          width={W}
          height={H}
          className="block h-auto w-full max-w-full"
        />
        {desenhos.length > 0 && (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <defs>
              <mask id={mascara}>
                <rect width={W} height={H} fill="#fff" />
                {desenhos.map((d) => (
                  <rect
                    key={d.numero}
                    x={d.caixa.x}
                    y={d.caixa.y}
                    width={d.caixa.w}
                    height={d.caixa.h}
                    rx={8}
                    fill="#000"
                  />
                ))}
              </mask>
            </defs>
            <rect width={W} height={H} fill="rgba(15, 19, 26, 0.38)" mask={`url(#${mascara})`} />
            {desenhos
              .filter((d) => d.contorno)
              .map((d) => (
                <rect
                  key={`c${d.numero}`}
                  x={d.caixa.x}
                  y={d.caixa.y}
                  width={d.caixa.w}
                  height={d.caixa.h}
                  rx={8}
                  fill="none"
                  stroke="var(--color-brand)"
                  strokeWidth={3}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            {desenhos.map((d) =>
              d.seta ? (
                <g key={`s${d.numero}`}>
                  <line
                    x1={d.seta.linha[0]}
                    y1={d.seta.linha[1]}
                    x2={d.seta.linha[2]}
                    y2={d.seta.linha[3]}
                    stroke="var(--color-brand)"
                    strokeWidth={3}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polygon points={d.seta.ponta} fill="var(--color-brand)" />
                </g>
              ) : null,
            )}
          </svg>
        )}
        {desenhos.map((d) => (
          <span
            key={`n${d.numero}`}
            aria-hidden="true"
            className="absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-semibold shadow-sm ring-2 ring-white sm:size-7 sm:text-xs"
            style={{
              left: pct(d.selo.x, W),
              top: pct(d.selo.y, H),
              background: "var(--color-brand)",
              color: "var(--color-cta-fg)",
            }}
          >
            {d.numero}
          </span>
        ))}
      </figure>
      {desenhos.length > 0 && (
        <ol className="flex flex-col gap-1.5 text-sm" aria-label="Destaques da foto">
          {desenhos.map((d) => (
            <li key={d.numero} className="flex items-start gap-2">
              <span
                className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                style={{ background: "var(--color-brand)", color: "var(--color-cta-fg)" }}
                aria-hidden="true"
              >
                {d.numero}
              </span>
              <span>{d.rotulo}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
