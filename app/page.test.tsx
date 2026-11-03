import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cena = vi.hoisted(() => ({
  usuario: null as { id: string } | null,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((destino: string) => {
    throw new Error(`NEXT_REDIRECT:${destino}`);
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: cena.usuario } }) },
  }),
}));

import HomePage from "./page";

async function montar() {
  return render(await HomePage());
}

beforeEach(() => {
  cena.usuario = null;
});

describe("/ — a página inicial pública (a vitrine do Arvisx CRM)", () => {
  it("sem sessão: mostra a promessa, o botão de entrar e os documentos legais", async () => {
    await montar();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "O WhatsApp chega. A IA atende e vende. Seu CRM organiza tudo.",
    );
    // Quem já é cliente entra por aqui: o topo e o hero levam ao login.
    const entrar = screen.getAllByRole("link", { name: /^(Entrar|Já sou cliente)$/ });
    expect(entrar.length).toBeGreaterThanOrEqual(2);
    for (const a of entrar) expect(a).toHaveAttribute("href", "/login");

    expect(screen.getByRole("link", { name: "Termos de uso" })).toHaveAttribute(
      "href",
      "/termos-de-uso",
    );
    expect(screen.getByRole("link", { name: "Política de privacidade e cookies" })).toHaveAttribute(
      "href",
      "/privacidade-e-cookies",
    );
  });

  it("a landing é a da Arvisx: não há cadastro aberto nem link para /signup", async () => {
    await montar();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/signup");
  });

  it("as capturas do CRM têm texto alternativo", async () => {
    await montar();
    for (const img of screen.getAllByRole("img")) {
      expect(img.getAttribute("alt")).toBeTruthy();
    }
  });

  it("com sessão: segue direto para o painel, como sempre foi", async () => {
    cena.usuario = { id: "11111111-1111-4111-8111-111111111111" };
    await expect(montar()).rejects.toThrow("NEXT_REDIRECT:/app");
  });
});
