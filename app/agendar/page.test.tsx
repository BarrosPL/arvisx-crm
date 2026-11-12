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

describe("/agendar — reunião com o time Arvisx sobre os Agentes Arvisx", () => {
  it("mostra a etiqueta e o título dos Agentes Arvisx e volta ao site pela landing", async () => {
    await montar();
    expect(screen.getByText("Agentes Arvisx · Reunião com o time Arvisx")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Quer agentes de IA feitos para a sua operação?",
    );
    expect(screen.getByRole("link", { name: "Voltar ao site" })).toHaveAttribute("href", "/");
  });

  it("⭐ a reunião é dos Agentes Arvisx, serviço à parte do plano: a página não fala mais em Equipe Completa nem em assinatura", async () => {
    const { container } = await montar();
    const tudo = `${container.textContent} ${String(metadata.title)} ${String(metadata.description)}`;
    for (const antiga of [/Equipe Completa/, /\d+ agentes/, /único plano/, /assinatura|assinar o plano/, /feita no CRM/, /algo que o CRM ainda não faz/, /além do que o Arvisx CRM já oferece/, /Atendimento especializado/, /que o CRM não cobre/]) {
      expect(tudo).not.toMatch(antiga);
    }
    expect(String(metadata.title)).toBe("Arvisx CRM | Agentes Arvisx: reunião com o time Arvisx");
    expect(String(metadata.description)).toMatch(/sobre os Agentes Arvisx: agentes de IA sob medida, contratados à parte do plano\./);
    expect(container.querySelector(".lead")!.textContent).toMatch(
      /serviço sob medida, contratado à parte do plano, e ele começa\s+por esta conversa de 30 minutos: entendemos a sua operação e preparamos a proposta\.\s+Vale para quem já usa o Arvisx CRM, em qualquer plano, e para quem usa outras\s+ferramentas\./,
    );
    const para = within(screen.getByRole("heading", { level: 2, name: "Esta reunião é para" }).parentElement as HTMLElement);
    expect(para.getAllByRole("listitem")).toHaveLength(4);
    expect(para.getByText("Quem quer os Agentes Arvisx (serviço sob medida):")).toBeInTheDocument();
    expect(para.getByText("Preparar a proposta:")).toBeInTheDocument();
    // Capacidade, não resultado: nada de prazo nem de promessa de resultado.
    expect(tudo).not.toMatch(/\d+\s?%|em \d+ dias|garanti/i);
  });

  it("assinar o Essencial, o Standard ou o Premium não precisa de reunião: nos planos, o cliente configura os seus agentes", async () => {
    await montar();
    const nao = within(screen.getByRole("heading", { level: 2, name: "Não é para" }).parentElement as HTMLElement);
    expect(nao.getByRole("link", { name: "comece o teste grátis de 7 dias" })).toHaveAttribute("href", "/");
    expect(
      nao.getByText(/não precisa de reunião\.\s+Nos planos, você configura os seus agentes\./),
    ).toBeInTheDocument();
    expect(nao.getByText("Assinar o Essencial, o Standard ou o Premium:")).toBeInTheDocument();
  });

  it("sem a confirmação, a agenda do Google não carrega", async () => {
    const { container } = await montar();
    expect(container.querySelector("iframe")).toBeNull();
    expect(
      screen.getByText("Marque a confirmação acima para ver os horários disponíveis."),
    ).toBeInTheDocument();
    expect(container.querySelector(".portao .longo")!.textContent).toBe(
      "Confirmo que a reunião é sobre os Agentes Arvisx (agentes de IA sob medida) e não para suporte ou para conhecer o CRM.",
    );
    expect(container.querySelector(".portao .curto")!.textContent).toBe("Reunião sobre os Agentes Arvisx, confirmado.");
    expect(screen.getByText("Agendamentos fora desse objetivo podem ser cancelados.")).toBeInTheDocument();
  });

  it("confirmar que a reunião é sobre os Agentes Arvisx monta a agenda incorporada", async () => {
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
