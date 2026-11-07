import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cena = vi.hoisted(() => ({
  usuario: null as { id: string } | null,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((destino: string) => {
    throw new Error(`NEXT_REDIRECT:${destino}`);
  }),
}));
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "fonte-da-vitrine", className: "", style: {} }),
}));
vi.mock("@/lib/branding/saida", () => ({
  marcaDaSaida: async () => ({ nome: "Arvisx CRM" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: cena.usuario } }) },
  }),
}));

import HomePage from "./page";
import { CADASTRO_ABERTO, LINKS, OFERTA } from "@/lib/landing/links";

async function montar() {
  return render(await HomePage());
}

beforeEach(() => {
  cena.usuario = null;
  localStorage.clear();
});

describe("/ — landing v3", () => {
  it("sem sessão: a promessa da hero, como no protótipo aprovado", async () => {
    await montar();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Toda a sua operação de vendas e atendimento em um só CRM.",
    );
  });

  it("com o cadastro fechado, os três botões dizem 'Lançamento em breve' e nenhum leva ao cadastro", async () => {
    expect(CADASTRO_ABERTO).toBe(false);
    const { container } = await montar();
    // topo, hero e cartão de preço
    expect(screen.getAllByText(OFERTA.ctaEmBreve)).toHaveLength(3);
    expect(screen.queryByRole("link", { name: new RegExp(OFERTA.cta) })).toBeNull();
    expect(container.querySelector(`a[href="${LINKS.cadastro}"]`)).toBeNull();
    expect(LINKS.cadastro).toBe("/signup");
  });

  it("o botão de reunião com o time Arvisx leva a /agendar", async () => {
    await montar();
    expect(screen.getByRole("link", { name: "Agendar reunião com o time Arvisx" })).toHaveAttribute(
      "href",
      "/agendar",
    );
  });

  it("Entrar leva ao login", async () => {
    await montar();
    expect(screen.getByRole("link", { name: "Entrar" })).toHaveAttribute("href", "/login");
  });

  it("sem sessão: descreve o produto e traz os links de privacidade e termos (exigência do Google)", async () => {
    await montar();
    // a finalidade do produto, visível na página inicial
    expect(
      screen.getByText(/Atendimento, funil, agenda e chamadas de voz e vídeo num só CRM\./),
    ).toBeInTheDocument();
    // os dois documentos cadastrados na tela de permissão OAuth, com o href exato
    const legal = within(screen.getByRole("navigation", { name: "Legal" }));
    expect(legal.getByRole("link", { name: "Política de Privacidade" })).toHaveAttribute(
      "href",
      "/legal/privacy",
    );
    expect(legal.getByRole("link", { name: "Termos de Serviço" })).toHaveAttribute(
      "href",
      "/legal/terms",
    );
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/legal/privacy");
    expect(hrefs).toContain("/legal/terms");
  });

  it("preço e teste grátis saem da oferta centralizada", async () => {
    await montar();
    expect(screen.getAllByText(OFERTA.preco).length).toBeGreaterThan(0);
    expect(screen.getAllByText(OFERTA.trial).length).toBeGreaterThan(0);
  });

  it("o carrossel tem as seis telas e a primeira começa selecionada", async () => {
    await montar();
    const abas = screen.getAllByRole("tab");
    expect(abas.map((a) => a.textContent)).toEqual([
      "Caixa de entrada",
      "Funis",
      "Cartão do lead",
      "Contatos",
      "Agenda",
      "Financeiro",
    ]);
    expect(abas[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(6);
  });

  it("os ícones são <svg> do Phosphor do app (nada de fonte de ícone por CDN)", async () => {
    const { container } = await montar();
    expect(container.querySelectorAll("i.ph, i[class*='ph-']")).toHaveLength(0);
    expect(container.querySelectorAll("svg.ico").length).toBeGreaterThanOrEqual(30);
  });

  it("toda imagem tem texto alternativo declarado e as capturas são .webp locais", async () => {
    const { container } = await montar();
    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      expect(img.hasAttribute("alt")).toBe(true);
      expect(img.getAttribute("width")).toBeTruthy();
      expect(img.getAttribute("height")).toBeTruthy();
    }
    const capturas = imgs.filter((i) => i.getAttribute("src")?.startsWith("/img/landing/"));
    expect(capturas.length).toBeGreaterThan(0);
    for (const c of capturas) expect(c.getAttribute("src")).toMatch(/\.webp$/);
  });

  it("mostra o aviso de cookies a quem ainda não o dispensou", async () => {
    await montar();
    expect(await screen.findByRole("region", { name: "Aviso de cookies" })).toBeInTheDocument();
  });

  it("com sessão: segue para o painel", async () => {
    cena.usuario = { id: "u1" };
    await expect(montar()).rejects.toThrow("NEXT_REDIRECT:/app");
  });
});
