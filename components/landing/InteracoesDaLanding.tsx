"use client";

import { useEffect } from "react";

/**
 * O comportamento da landing (`app/page.tsx`), igual aos <script> do protótipo
 * aprovado (docs/arvisx/prototipo/landing/novo-modelo-v3-claro.html):
 *
 *  1. as capturas fora da hero e do carrossel entram ao aparecer na tela;
 *  2. o carrossel "Veja o seu novo CRM em ação" (abas, setas, pontos, teclado,
 *     arrastar e avanço sozinho a cada 7 s enquanto está visível);
 *  3. a lista de chamadas (voz, vídeo, Cold Call) que troca a captura a cada
 *     6,5 s, com a barra de progresso, até alguém clicar.
 *
 * A marcação vem pronta do servidor; este componente só liga os ouvintes, e
 * nada some se o JavaScript não carregar (as capturas só ganham a classe que
 * as esconde para a entrada depois que o observador existe). Com
 * `prefers-reduced-motion: reduce` nada avança sozinho e a rolagem não anima.
 */
export function InteracoesDaLanding() {
  useEffect(() => {
    const limpar: Array<() => void> = [];
    const quieto =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const temObservador = "IntersectionObserver" in window;

    // 1. capturas que entram ao aparecer
    if (temObservador) {
      const io = new IntersectionObserver(
        (es) => {
          for (const e of es) {
            if (e.isIntersecting) {
              e.target.classList.add("in");
              io.unobserve(e.target);
            }
          }
        },
        { threshold: 0.12 },
      );
      document.querySelectorAll(".lp .janela").forEach((f) => {
        if (f.closest(".hero") || f.closest(".slide")) return;
        f.classList.add("pre");
        io.observe(f);
      });
      limpar.push(() => io.disconnect());
    }

    // 2. carrossel
    const track = document.getElementById("car-track");
    if (track) {
      const slides = Array.from(track.querySelectorAll<HTMLElement>(".slide"));
      const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".lp .car-tabs button"));
      const dots = Array.from(document.querySelectorAll<HTMLElement>(".lp .car-dots i"));
      let atual = 0;
      let parado = false;
      let visivel = false;
      const marcar = (i: number) => {
        atual = i;
        slides.forEach((s, k) => s.classList.toggle("on", k === i));
        tabs.forEach((t, k) => t.setAttribute("aria-selected", k === i ? "true" : "false"));
        dots.forEach((d, k) => d.classList.toggle("on", k === i));
        const t = tabs[i];
        const barra = t?.parentElement;
        if (t && barra?.scrollTo) barra.scrollTo({ left: t.offsetLeft - 16, behavior: "smooth" });
      };
      const ir = (i: number) => {
        const n = (i + slides.length) % slides.length;
        const s = slides[n];
        if (!s) return;
        track.scrollTo({
          left: s.offsetLeft - (track.clientWidth - s.offsetWidth) / 2,
          behavior: quieto ? "auto" : "smooth",
        });
        marcar(n);
      };
      let raf = 0;
      const aoRolar = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const c = track.scrollLeft + track.clientWidth / 2;
          let melhor = 0;
          let d = Number.POSITIVE_INFINITY;
          slides.forEach((s, k) => {
            const m = Math.abs(s.offsetLeft + s.offsetWidth / 2 - c);
            if (m < d) {
              d = m;
              melhor = k;
            }
          });
          if (melhor !== atual) marcar(melhor);
        });
      };
      const parar = () => {
        parado = true;
      };
      const anterior = () => {
        parar();
        ir(atual - 1);
      };
      const proxima = () => {
        parar();
        ir(atual + 1);
      };
      const aoTeclar = (e: KeyboardEvent) => {
        if (e.key === "ArrowRight") {
          parar();
          ir(atual + 1);
          e.preventDefault();
        }
        if (e.key === "ArrowLeft") {
          parar();
          ir(atual - 1);
          e.preventDefault();
        }
      };
      const prev = document.getElementById("car-prev");
      const next = document.getElementById("car-next");
      track.addEventListener("scroll", aoRolar, { passive: true });
      prev?.addEventListener("click", anterior);
      next?.addEventListener("click", proxima);
      track.addEventListener("keydown", aoTeclar);
      const porAba = tabs.map((t) => {
        const f = () => {
          parar();
          ir(Number(t.getAttribute("data-i")));
        };
        t.addEventListener("click", f);
        return () => t.removeEventListener("click", f);
      });
      const eventosDeMao = ["pointerdown", "wheel", "touchstart"] as const;
      eventosDeMao.forEach((ev) => track.addEventListener(ev, parar, { passive: true }));
      marcar(0);
      let io: IntersectionObserver | null = null;
      if (temObservador) {
        io = new IntersectionObserver(
          (es) => {
            visivel = es[0]?.isIntersecting ?? false;
          },
          { threshold: 0.4 },
        );
        io.observe(track);
      }
      const relogio = quieto
        ? null
        : window.setInterval(() => {
            if (!parado && visivel && !document.hidden) ir(atual + 1);
          }, 7000);
      limpar.push(() => {
        cancelAnimationFrame(raf);
        track.removeEventListener("scroll", aoRolar);
        prev?.removeEventListener("click", anterior);
        next?.removeEventListener("click", proxima);
        track.removeEventListener("keydown", aoTeclar);
        porAba.forEach((f) => f());
        eventosDeMao.forEach((ev) => track.removeEventListener(ev, parar));
        io?.disconnect();
        if (relogio !== null) window.clearInterval(relogio);
      });
    }

    // 3. chamadas
    const itens = Array.from(document.querySelectorAll<HTMLButtonElement>(".lp .cs-item"));
    const cs = document.querySelector(".lp .cs");
    if (itens.length && cs) {
      const panes = Array.from(document.querySelectorAll<HTMLElement>(".lp .cs-pane"));
      const rot = document.getElementById("cs-rot");
      let atual = 0;
      let parado = false;
      let visivel = !temObservador;
      let t: number | undefined;
      const ir = (i: number) => {
        atual = (i + itens.length) % itens.length;
        itens.forEach((b, k) => {
          b.classList.toggle("on", k === atual);
          b.setAttribute("aria-pressed", k === atual ? "true" : "false");
          b.classList.remove("auto");
        });
        panes.forEach((pn, k) => pn.classList.toggle("on", k === atual));
        const item = itens[atual];
        if (rot && item) rot.textContent = item.getAttribute("data-rot");
        window.clearTimeout(t);
        if (!parado && !quieto && item) {
          // relê o layout para a barra de progresso recomeçar do zero
          void item.offsetWidth;
          item.classList.add("auto");
          t = window.setTimeout(() => {
            if (visivel && !document.hidden) ir(atual + 1);
            else ir(atual);
          }, 6500);
        }
      };
      const porItem = itens.map((b) => {
        const f = () => {
          parado = true;
          ir(Number(b.getAttribute("data-i")));
        };
        b.addEventListener("click", f);
        return () => b.removeEventListener("click", f);
      });
      let io: IntersectionObserver | null = null;
      if (temObservador) {
        io = new IntersectionObserver(
          (es) => {
            visivel = es[0]?.isIntersecting ?? false;
          },
          { threshold: 0.3 },
        );
        io.observe(cs);
      }
      ir(0);
      limpar.push(() => {
        window.clearTimeout(t);
        porItem.forEach((f) => f());
        io?.disconnect();
      });
    }

    return () => limpar.forEach((f) => f());
  }, []);

  return null;
}
