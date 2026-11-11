/**
 * A aba de Planos de /admin/cobranca (spec da cobrança §9): criar, editar,
 * arquivar e marcar o plano do cadastro, pelas rotas das Tasks 23 e 24. O
 * formulário recusa antes da rota o que o banco recusaria (preço < R$ 5).
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn(), refresh: vi.fn(), erro: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: h.erro } }));
vi.mock("@/lib/api/client", () => ({ apiClient: { post: h.post, patch: h.patch } }));

import { PlanosDaInstalacao, type PlanoDaTela } from "@/app/admin/(protected)/cobranca/_planos";

const PLANO: PlanoDaTela = {
  id: "cccccccc-0000-4000-8000-000000000001", nome: "Básico", preco_cents: 4990, moeda: "BRL", intervalo: "mes", trial_dias: 14,
  max_assentos: 3, max_canais: null, teto_ia_usd_cents: null, padrao_no_cadastro: false, oferecido_ao_cliente: true, interface_settings: { preset: "completa" },
  descricao_curta: null, para_quem: null, destaques: null, limites: null, como_funciona: null, inclui_agentes_arvisx: false, fora_do_managed_payments: false, arquivado_em: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.post.mockResolvedValue({ data: PLANO });
  h.patch.mockResolvedValue({ data: PLANO });
});
afterEach(cleanup);

async function preencher(u: ReturnType<typeof userEvent.setup>, preco: string) {
  await u.type(screen.getByLabelText("Nome do plano"), "Pro");
  await u.type(screen.getByLabelText("Preço (R$)"), preco);
  await u.clear(screen.getByLabelText("Dias de teste grátis"));
  await u.type(screen.getByLabelText("Dias de teste grátis"), "7");
  await u.type(screen.getByLabelText("Máximo de pessoas"), "5");
}

describe("Planos da instalação", () => {
  it("criar manda centavos e limites vazios como nulos, e recarrega a tela", async () => {
    const u = userEvent.setup();
    render(<PlanosDaInstalacao planos={[]} />);
    await preencher(u, "99,90");
    await u.click(screen.getByRole("button", { name: "Salvar plano" }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post).toHaveBeenCalledWith("/api/v1/admin/cobranca/planos", {
      nome: "Pro", preco_cents: 9990, moeda: "BRL", intervalo: "mes", trial_dias: 7,
      max_assentos: 5, max_canais: null,
      // Telas do plano (migration 9802): sem mexer no editor, a completa.
      interface_settings: { preset: "completa" },
      // Textos do plano (migration 9803): vazios vão nulos, nenhum texto inventado.
      descricao_curta: null, para_quem: null, destaques: null, limites: null, como_funciona: null, inclui_agentes_arvisx: false,
      // Migration 9807: o plano nasce dentro do Managed Payments.
      fora_do_managed_payments: false,
    });
    expect(h.refresh).toHaveBeenCalled();
  });

  it("⭐ sem teto de IA no formulário (etapa 3): o cliente usa a própria credencial; criar e editar não mandam o campo", async () => {
    const u = userEvent.setup();
    render(<PlanosDaInstalacao planos={[{ ...PLANO, teto_ia_usd_cents: 1000 }]} />);
    expect(screen.queryByLabelText(/Teto de uso de IA/)).toBeNull();
    await u.click(screen.getByRole("button", { name: "Editar" }));
    await u.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(h.patch.mock.calls[0]![1]).not.toHaveProperty("teto_ia_usd_cents");
  });

  it("⭐ telas do plano (migration 9802): o InterfaceEditor manda preset e destinos, e a edição traz o que estava gravado", async () => {
    const u = userEvent.setup();
    const { unmount } = render(<PlanosDaInstalacao planos={[]} />);
    await preencher(u, "59,90");
    await u.selectOptions(screen.getByLabelText("Perfil de interface"), "simplificada");
    await u.click(screen.getByRole("button", { name: "Salvar plano" }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post.mock.calls[0]![1]).toMatchObject({ interface_settings: { preset: "simplificada" } });
    unmount();

    const standard = { ...PLANO, interface_settings: { preset: "simplificada", destinos: ["/app/inbox", "/app/ai/agents"] } };
    render(<PlanosDaInstalacao planos={[standard]} />);
    expect(screen.getByText(/Personalizada \(2 áreas\)/)).toBeTruthy();
    await u.click(screen.getByRole("button", { name: "Editar" }));
    await u.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(h.patch.mock.calls[0]![1]).toMatchObject({
      interface_settings: { preset: "simplificada", destinos: ["/app/inbox", "/app/ai/agents"] },
    });
  });

  it("⭐ plano em euro (migration 9801): a moeda vai no corpo e o rótulo do preço vira €", async () => {
    const u = userEvent.setup();
    render(<PlanosDaInstalacao planos={[]} />);
    await u.selectOptions(screen.getByLabelText("Moeda"), "EUR");
    expect(screen.getByLabelText("Preço (€)")).toBeTruthy();
    await u.type(screen.getByLabelText("Nome do plano"), "Essencial");
    await u.type(screen.getByLabelText("Preço (€)"), "59,90");
    await u.click(screen.getByRole("button", { name: "Salvar plano" }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post.mock.calls[0]![1]).toMatchObject({ nome: "Essencial", preco_cents: 5990, moeda: "EUR" });
  });

  it("preço abaixo de € 5 em euro: o aviso fala em euro", async () => {
    const u = userEvent.setup();
    render(<PlanosDaInstalacao planos={[]} />);
    await u.selectOptions(screen.getByLabelText("Moeda"), "EUR");
    await u.type(screen.getByLabelText("Nome do plano"), "Essencial");
    await u.type(screen.getByLabelText("Preço (€)"), "4,99");
    await u.click(screen.getByRole("button", { name: "Salvar plano" }));
    expect(h.post).not.toHaveBeenCalled();
    expect(h.erro).toHaveBeenCalledWith(expect.stringMatching(/preço a partir de 5,00\s€/));
  });

  it("a lista escreve o preço na moeda de cada plano", () => {
    render(<PlanosDaInstalacao planos={[PLANO, { ...PLANO, id: "cccccccc-0000-4000-8000-000000000002", nome: "Euro", preco_cents: 5990, moeda: "EUR" }]} />);
    expect(screen.getByText(/R\$\s49,90/)).toBeTruthy();
    expect(screen.getByText(/59,90\s€/)).toBeTruthy();
  });

  it("preço abaixo de R$ 5 não chega à rota", async () => {
    const u = userEvent.setup();
    render(<PlanosDaInstalacao planos={[]} />);
    await preencher(u, "4,99");
    await u.click(screen.getByRole("button", { name: "Salvar plano" }));
    expect(h.post).not.toHaveBeenCalled();
    expect(h.erro).toHaveBeenCalled();
  });

  it("arquivar e usar no cadastro são PATCH do plano", async () => {
    const u = userEvent.setup();
    render(<PlanosDaInstalacao planos={[PLANO]} />);
    await u.click(screen.getByRole("button", { name: "Arquivar" }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledWith(`/api/v1/admin/cobranca/planos/${PLANO.id}`, { arquivado: true }));
    await u.click(screen.getByRole("button", { name: "Usar no cadastro" }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledWith(`/api/v1/admin/cobranca/planos/${PLANO.id}`, { padrao_no_cadastro: true }));
  });

  it("editar carrega o plano no formulário e salva por PATCH", async () => {
    const u = userEvent.setup();
    render(<PlanosDaInstalacao planos={[PLANO]} />);
    await u.click(screen.getByRole("button", { name: "Editar" }));
    expect((screen.getByLabelText("Nome do plano") as HTMLInputElement).value).toBe("Básico");
    expect((screen.getByLabelText("Preço (R$)") as HTMLInputElement).value).toBe("49,90");
    await u.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(h.patch.mock.calls[0]![0]).toBe(`/api/v1/admin/cobranca/planos/${PLANO.id}`);
    expect(h.patch.mock.calls[0]![1]).toMatchObject({ nome: "Básico", preco_cents: 4990, max_assentos: 3 });
  });
  it("⭐ esconder um plano das empresas é PATCH, e o plano escondido mostra que só o dono o atribui", async () => {
    const u = userEvent.setup();
    const { rerender } = render(<PlanosDaInstalacao planos={[PLANO]} />);
    await u.click(screen.getByRole("button", { name: "Esconder das empresas" }));
    await waitFor(() =>
      expect(h.patch).toHaveBeenCalledWith(`/api/v1/admin/cobranca/planos/${PLANO.id}`, { oferecido_ao_cliente: false }),
    );
    rerender(<PlanosDaInstalacao planos={[{ ...PLANO, oferecido_ao_cliente: false }]} />);
    expect(screen.getByText("Só você atribui")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mostrar às empresas" })).toBeTruthy();
  });

  it("⭐ textos do plano (migration 9803): uma frase por linha, linha vazia não conta, e a edição traz o que estava gravado", async () => {
    const u = userEvent.setup();
    const { unmount } = render(<PlanosDaInstalacao planos={[]} />);
    await preencher(u, "499,90");
    await u.type(screen.getByLabelText("Descrição curta"), "O CRM completo e uma equipe de IA.");
    await u.type(screen.getByLabelText("Para quem é"), "Quem quer agentes prontos.");
    await u.type(screen.getByLabelText("O que tem"), "Tudo do Premium{Enter}{Enter}4 agentes sob medida");
    await u.type(screen.getByLabelText("Como funciona (em destaque no card)"), "Nossa equipe entra em contato.");
    await u.click(screen.getByLabelText(/Inclui os 4 agentes de IA/));
    await u.click(screen.getByRole("button", { name: "Salvar plano" }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post.mock.calls[0]![1]).toMatchObject({
      descricao_curta: "O CRM completo e uma equipe de IA.",
      para_quem: "Quem quer agentes prontos.",
      destaques: ["Tudo do Premium", "4 agentes sob medida"],
      limites: null,
      como_funciona: "Nossa equipe entra em contato.",
      inclui_agentes_arvisx: true,
    });
    unmount();

    const equipe = { ...PLANO, nome: "Equipe Completa", descricao_curta: "Frase curta.", limites: ["Sem X", "Sem Y"], inclui_agentes_arvisx: true };
    render(<PlanosDaInstalacao planos={[equipe]} />);
    expect(screen.getByText("Agentes sob medida")).toBeTruthy();
    expect(screen.getByText("Frase curta.")).toBeTruthy();
    await u.click(screen.getByRole("button", { name: "Editar" }));
    expect((screen.getByLabelText("O que não tem") as HTMLTextAreaElement).value).toBe("Sem X\nSem Y");
    expect((screen.getByLabelText(/Inclui os 4 agentes de IA/) as HTMLInputElement).checked).toBe(true);
  });
});

describe("Managed Payments na aba de Planos (migration 9807)", () => {
  it("⭐ a marca 'Fora do Managed Payments' é editável: marcada vai no corpo, e o plano marcado mostra o selo e volta marcado na edição", async () => {
    const u = userEvent.setup();
    const { unmount } = render(<PlanosDaInstalacao planos={[]} />);
    await preencher(u, "499,90");
    await u.click(screen.getByLabelText(/^Fora do Managed Payments/));
    await u.click(screen.getByRole("button", { name: "Salvar plano" }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post.mock.calls[0]![1]).toMatchObject({ fora_do_managed_payments: true });
    unmount();

    render(<PlanosDaInstalacao planos={[{ ...PLANO, nome: "Equipe Completa", fora_do_managed_payments: true }]} />);
    expect(screen.getAllByText("Fora do Managed Payments").length).toBe(2);
    await u.click(screen.getByRole("button", { name: "Editar" }));
    const marca = screen.getByLabelText(/^Fora do Managed Payments/) as HTMLInputElement;
    expect(marca.checked).toBe(true);
    await u.click(marca);
    await u.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(h.patch.mock.calls[0]![1]).toMatchObject({ fora_do_managed_payments: false });
  });

  it("⭐ 'Sincronizar produtos na Stripe' só aparece com a Stripe conectada, chama a rota e mostra o resultado por plano", async () => {
    const u = userEvent.setup();
    const { unmount } = render(<PlanosDaInstalacao planos={[PLANO]} />);
    expect(screen.queryByRole("button", { name: "Sincronizar produtos na Stripe" })).toBeNull();
    unmount();

    h.post.mockResolvedValueOnce({
      data: {
        modo: "teste", criados: 1, atualizados: 1, erros: 1,
        resultados: [
          { plano_id: "p1", nome: "Essencial", resultado: "criado" },
          { plano_id: "p2", nome: "Premium", resultado: "atualizado" },
          { plano_id: "p3", nome: "Equipe Completa", resultado: "erro", erro: "permission_error" },
        ],
      },
    });
    render(<PlanosDaInstalacao planos={[PLANO]} stripeConectada />);
    await u.click(screen.getByRole("button", { name: "Sincronizar produtos na Stripe" }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith("/api/v1/admin/cobranca/planos/sincronizar", {}));
    expect(await screen.findByText("Essencial: criado")).toBeTruthy();
    expect(screen.getByText("Premium: atualizado")).toBeTruthy();
    expect(screen.getByText("Equipe Completa: erro (permission_error)")).toBeTruthy();
    expect(screen.getByText(/Conta Stripe de teste\./)).toBeTruthy();
    // Algum plano falhou: o aviso é de erro, não de sucesso.
    expect(h.erro).toHaveBeenCalled();
  });
});
