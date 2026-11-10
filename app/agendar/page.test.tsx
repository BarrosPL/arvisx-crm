import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", () => ({
  default: () => ({ variable: "fonte-da-vitrine", className: "", style: {} }),
}));
vi.mock("@/lib/branding/saida", () => ({
  marcaDaSaida: async () => ({ nome: "Arvisx CRM" }),
}));

import AgendarPage, { metadata } from "./page";
import { AGENDA_EMBED } from "@/lib/landing/links";

async function montar() {
  return render(await AgendarPage());
}

describe("/agendar — reunião com o time Arvisx sobre o Equipe Completa", () => {
  it("mostra a etiqueta e o título do Equipe Completa e volta ao site pela landing", async () => {
    await montar();
    expect(screen.getByText("Equipe Completa · Reunião com o time Arvisx")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Quer agentes de IA feitos para a sua operação?",
    );
    expect(screen.getByRole("link", { name: "Voltar ao site" })).toHaveAttribute("href", "/");
  });

  it("⭐ a reunião é do Equipe Completa: a página não vende mais solução sob medida fora do plano", async () => {
    const { container } = await montar();
    const tudo = `${container.textContent} ${String(metadata.title)} ${String(metadata.description)}`;
    for (const antiga of [/algo que o CRM ainda não faz/, /além do que o Arvisx CRM já oferece/, /Agentes Arvisx/, /Atendimento especializado/, /solução personalizada/, /que o CRM não cobre/]) {
      expect(tudo).not.toMatch(antiga);
    }
    expect(String(metadata.description)).toMatch(/para quem quer o plano Equipe Completa/);
    expect(container.querySelector(".lead")!.textContent).toMatch(/entendemos a sua operação e orientamos como assinar o plano\. A assinatura é feita no CRM\./);
    const para = within(screen.getByRole("heading", { level: 2, name: "Esta reunião é para" }).parentElement as HTMLElement);
    expect(para.getAllByRole("listitem")).toHaveLength(4);
    expect(para.getByText(/Quem quer o Equipe Completa:/)).toBeInTheDocument();
    // Capacidade, não resultado: nada de prazo nem de promessa de resultado.
    expect(tudo).not.toMatch(/\d+\s?%|em \d+ dias|garanti/i);
  });

  it("os planos Essencial, Standard e Premium não precisam de reunião nem têm desenvolvimento personalizado", async () => {
    await montar();
    const nao = within(screen.getByRole("heading", { level: 2, name: "Não é para" }).parentElement as HTMLElement);
    expect(nao.getByRole("link", { name: "comece o teste grátis de 7 dias" })).toHaveAttribute("href", "/");
    expect(
      nao.getByText(/não precisam de reunião nem têm\s+desenvolvimento personalizado\. Nesses planos, você configura os seus agentes\./),
    ).toBeInTheDocument();
    expect(nao.getByText("Essencial, Standard e Premium:")).toBeInTheDocument();
  });

  it("sem a confirmação, a agenda do Google não carrega", async () => {
    const { container } = await montar();
    expect(container.querySelector("iframe")).toBeNull();
    expect(
      screen.getByText("Marque a confirmação acima para ver os horários disponíveis."),
    ).toBeInTheDocument();
    expect(container.querySelector(".portao .longo")!.textContent).toBe(
      "Confirmo que a reunião é sobre o plano Equipe Completa (agentes de IA sob medida) e não para suporte ou para conhecer o CRM.",
    );
    expect(screen.getByText("Agendamentos fora desse objetivo podem ser cancelados.")).toBeInTheDocument();
  });

  it("confirmar que a reunião é sobre o Equipe Completa monta a agenda incorporada", async () => {
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
