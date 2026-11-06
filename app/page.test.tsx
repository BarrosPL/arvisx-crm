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
vi.mock("@/lib/branding/saida", () => ({
  marcaDaSaida: async () => ({ nome: "Arvisx CRM" }),
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

describe("/ — página provisória (em breve)", () => {
  it("sem sessão: só o aviso de lançamento, sem botões nem links", async () => {
    await montar();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Estamos nos preparando para o nosso lançamento.",
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("o logo tem texto alternativo", async () => {
    await montar();
    for (const img of screen.getAllByRole("img")) {
      expect(img.getAttribute("alt")).toBeTruthy();
    }
  });

  it("com sessão: segue para o painel", async () => {
    cena.usuario = { id: "u1" };
    await expect(montar()).rejects.toThrow("NEXT_REDIRECT:/app");
  });
});
