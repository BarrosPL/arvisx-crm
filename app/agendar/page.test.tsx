import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", () => ({
  default: () => ({ variable: "fonte-da-vitrine", className: "", style: {} }),
}));
vi.mock("@/lib/branding/saida", () => ({
  marcaDaSaida: async () => ({ nome: "Arvisx CRM" }),
}));

import AgendarPage from "./page";
import { AGENDA_EMBED } from "@/lib/landing/links";

async function montar() {
  return render(await AgendarPage());
}

describe("/agendar — reunião com o time Arvisx", () => {
  it("mostra o título do protótipo e volta ao site pela landing", async () => {
    await montar();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Precisa de algo que o CRM ainda não faz?",
    );
    expect(screen.getByRole("link", { name: "Voltar ao site" })).toHaveAttribute("href", "/");
  });

  it("sem a confirmação, a agenda do Google não carrega", async () => {
    const { container } = await montar();
    expect(container.querySelector("iframe")).toBeNull();
    expect(
      screen.getByText("Marque a confirmação acima para ver os horários disponíveis."),
    ).toBeInTheDocument();
  });

  it("confirmar a solução personalizada monta a agenda incorporada", async () => {
    const { container } = await montar();
    fireEvent.click(screen.getByRole("checkbox"));
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe).toHaveAttribute("src", AGENDA_EMBED);
    expect(iframe).toHaveAttribute("title", "Horários disponíveis para a reunião");
    expect(container.querySelector(".cartao-agenda")).toHaveClass("confirmado");
    expect(container.querySelector("#agenda")).toHaveClass("on");

    // desmarcar esconde a agenda sem desmontar o <iframe>
    fireEvent.click(screen.getByRole("checkbox"));
    expect(container.querySelector("#agenda")).not.toHaveClass("on");
    expect(container.querySelector("iframe")).not.toBeNull();
  });
});
