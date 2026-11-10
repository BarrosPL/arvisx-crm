/**
 * TESTE DE 7 DIAS E ESCOLHA DO PLANO, PELA TELA (ArvisX, etapa 3 dos planos).
 *
 *  - O cadastro com o plano de entrada (o "Teste") NÃO mostra seletor: diz os
 *    dias de teste e não manda `cobranca_plan_id` — a empresa cai no padrão.
 *  - A tela de assinatura, com nada assinado no provedor, mostra os planos
 *    oferecidos no comparativo (tarefa 2 dos planos): preço na moeda, pessoas,
 *    números e os textos do plano; escolhido um plano, o "Assinar <plano>"
 *    manda o `plano_id` ao Checkout.
 *  - Plano menor do que o uso: o card diz o excesso e não deixa assinar; a
 *    recusa do servidor diz o mesmo, com os números.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ post: vi.fn(), refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), abrir: vi.fn(), showApiError: vi.fn(), signUp: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: h.push, replace: h.replace }) }));
vi.mock("@/lib/api/client", () => ({ apiClient: { post: h.post } }));
vi.mock("@/lib/cobranca/navegar", () => ({ abrirNoNavegador: h.abrir }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: h.showApiError }));
vi.mock("@/app/actions/auth/signUp", () => ({ signUp: (...a: unknown[]) => h.signUp(...a) }));

import { SignupForm } from "@/components/auth/SignupForm";
import { AcoesDaAssinatura, type PropsDasAcoes } from "@/components/cobranca/AcoesDaAssinatura";
import { ApiError } from "@/lib/api/types";
import { telasDoPlanoNoSeletor } from "@/lib/cobranca/comparativo";
import type { PlanoDoComparativo, PlanoParaAssinar } from "@/lib/cobranca/painel";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import { DESTINOS_DA_SIMPLIFICADA } from "@/lib/navigation/interface";

const TESTE = { id: "teste", nome: "Teste", preco_cents: 5990, moeda: "EUR" as const, intervalo: "mes", max_assentos: null, max_canais: null, teto_ia_usd_cents: null };
const STANDARD_TELAS = { preset: "simplificada", destinos: [...DESTINOS_DA_SIMPLIFICADA, ...NAV_CATALOG.filter((d) => d.group === "ia").map((d) => d.href)] };
const card = (id: string, nome: string, preco: number, canais: number | null, pessoas: number | null, telas: unknown, excedente = {}): PlanoDoComparativo => ({
  id, nome, preco_cents: preco, moeda: "EUR", intervalo: "mes", max_assentos: pessoas, max_canais: canais, teto_ia_usd_cents: null,
  atual: false, descricao_curta: null, para_quem: null, destaques: [], limites: [], como_funciona: null, inclui_agentes_arvisx: false,
  telas: telasDoPlanoNoSeletor(telas), excedente,
});
const ESSENCIAL = { ...card("essencial", "Essencial", 5990, 3, 5, { preset: "simplificada" }), descricao_curta: "Atender e organizar." };
const STANDARD = card("standard", "Standard", 12990, 6, 10, STANDARD_TELAS);
const PREMIUM = card("premium", "Premium", 19990, null, null, { preset: "completa" });
const DO_TESTE = { ...card("teste", "Teste", 5990, null, null, { preset: "completa" }), atual: true };
const paraAssinar = (c: PlanoDoComparativo): PlanoParaAssinar => ({ ...c });

const acoes = (p: Partial<PropsDasAcoes> = {}): PropsDasAcoes => ({
  estado: "trial", temProvedor: false, assinaturasVivas: 0, linkDePagamento: null, cancelaNoFim: false,
  planosParaTroca: [], planoAtual: TESTE, periodoPagoDesde: null, proximoVencimento: null,
  trocaPagamentoUrl: null, trocaStatus: null, instanteCalculo: "2026-11-12T12:00:00Z", voltouDoCheckout: false, noHub: false,
  provedor: "stripe", documentoDoCadastro: null,
  escolheAoAssinar: true, planosParaAssinar: [ESSENCIAL, STANDARD, PREMIUM].map(paraAssinar), uso: { assentos: 2, canais: 1 },
  comparativo: { planos: [ESSENCIAL, STANDARD, PREMIUM], atual: DO_TESTE }, ...p,
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("⭐ cadastro com o plano Teste: sem seletor", () => {
  it("sem planos a escolher e com dias de teste: some o seletor, a tela diz os 7 dias, e o envio não leva plano", async () => {
    h.signUp.mockResolvedValue({ ok: true, sessao_ativa: false });
    render(<SignupForm planos={[]} diasDeTesteGratis={7} />);
    expect(screen.queryByLabelText("Plano")).toBeNull();
    expect(screen.getByTestId("teste-gratis-do-cadastro").textContent).toBe(
      "Você começa com 7 dias de teste grátis. O plano você escolhe depois, em Plano e cobrança.",
    );
    const u = userEvent.setup();
    await u.type(screen.getByLabelText(/Nome da empresa/i), "Clínica Bem Viver");
    await u.type(screen.getByLabelText(/^Email$/i), "dono@bemviver.test");
    await u.type(screen.getByLabelText(/^Senha$/i), "SenhaForte!2026");
    await u.type(screen.getByLabelText(/Confirmar senha/i), "SenhaForte!2026");
    await u.click(screen.getByRole("button", { name: /criar conta/i }));
    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
    const entrada = h.signUp.mock.calls[0]![0] as Record<string, unknown>;
    expect(entrada.cobranca_plan_id).toBeUndefined();
  });

  it("com seletor (planos oferecidos), a frase do teste não aparece", () => {
    render(<SignupForm planos={[{ id: "a", nome: "Essencial", preco_cents: 5990, moeda: "EUR", intervalo: "mes", trial_dias: 7 }]} planoInicial="a" />);
    expect(screen.getByLabelText("Plano")).toBeTruthy();
    expect(screen.queryByTestId("teste-gratis-do-cadastro")).toBeNull();
  });
});

describe("⭐ tela de assinatura a partir do Teste", () => {
  it("mostra os três planos no comparativo, com preço em euro, pessoas, números e o texto do plano — sem o botão único nem a troca", () => {
    render(<AcoesDaAssinatura {...acoes()} />);
    expect(screen.queryByRole("button", { name: "Assinar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Trocar de plano" })).toBeNull();
    const cards = screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-plano"));
    expect(cards.map((c) => c.getAttribute("data-plano"))).toEqual(["Essencial", "Standard", "Premium"]);

    const essencial = within(cards[0]!);
    expect(essencial.getByText(/59,90/)).toBeTruthy();
    expect(essencial.getByText("Números conectados: 3 · Pessoas: 5")).toBeTruthy();
    expect(essencial.getByText("Atender e organizar.")).toBeTruthy();
    expect(within(cards[1]!).getByText(/129,90/)).toBeTruthy();
    expect(within(cards[2]!).getByText("Números conectados: ilimitados · Pessoas: ilimitados")).toBeTruthy();
    // Nenhum "Assinar" antes de escolher: o que muda aparece primeiro.
    expect(screen.queryByRole("button", { name: /^Assinar / })).toBeNull();
  });

  it("⭐ escolher Standard e Assinar Standard manda o plano escolhido ao Checkout e abre a Stripe", async () => {
    h.post.mockResolvedValue({ data: { url: "https://checkout.stripe.com/c/pay/cs_std" } });
    render(<AcoesDaAssinatura {...acoes()} />);
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: "Escolher Standard" }));
    await u.click(screen.getByRole("button", { name: "Assinar Standard" }));
    await waitFor(() => expect(h.abrir).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_std"));
    expect(h.post).toHaveBeenCalledWith("/api/v1/cobranca/assinatura/checkout", { plano_id: "standard" });
  });

  it("no hub da conta suspensa (teste vencido), a mesma escolha volta para o hub", async () => {
    h.post.mockResolvedValue({ data: { url: "https://checkout.stripe.com/c/pay/cs_p" } });
    render(<AcoesDaAssinatura {...acoes({ estado: "em_atraso", noHub: true })} />);
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: "Escolher Premium" }));
    await u.click(screen.getByRole("button", { name: "Assinar Premium" }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith("/api/v1/cobranca/assinatura/checkout", { volta: "hub", plano_id: "premium" }));
  });

  it("⭐ plano menor que o uso: o card lista o excesso e o botão de assinar fica travado", async () => {
    const apertado = { ...ESSENCIAL, excedente: { canais: 2, assentos: 2 } };
    render(<AcoesDaAssinatura {...acoes({ comparativo: { planos: [apertado, PREMIUM], atual: DO_TESTE }, uso: { assentos: 7, canais: 5 } })} />);
    const essencial = screen.getAllByRole("listitem").find((li) => li.getAttribute("data-plano") === "Essencial")!;
    expect(within(essencial).getByText(
      "Você tem 5 números conectados, o plano permite 3: desconecte 2 em Conexões. Você tem 7 pessoas na equipe, o plano permite 5: revogue o acesso de 2 em Equipe.",
    )).toBeTruthy();
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: "Escolher Essencial" }));
    expect((screen.getByRole("button", { name: "Assinar Essencial" }) as HTMLButtonElement).disabled).toBe(true);
    await u.click(screen.getByRole("button", { name: "Escolher Premium" }));
    expect((screen.getByRole("button", { name: "Assinar Premium" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("⭐ a recusa do servidor (uso mudou depois da página) diz os números, e nada foi desconectado", async () => {
    h.post.mockRejectedValue(new ApiError(409, "plan_limit_reached", {
      excedente: { canais: 2 }, uso: { canais: 5, assentos: 2 }, limites: { canais: 3, assentos: 5 },
    }, "req-1", "O uso atual não cabe no plano escolhido."));
    render(<AcoesDaAssinatura {...acoes()} />);
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: "Escolher Essencial" }));
    await u.click(screen.getByRole("button", { name: "Assinar Essencial" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "O uso atual não cabe no plano escolhido. Nada foi desconectado. Você tem 5 números conectados, o plano permite 3: desconecte 2 em Conexões.",
    );
  });

  it("assinatura já no provedor (escolheAoAssinar falso): volta o botão único de sempre", () => {
    render(<AcoesDaAssinatura {...acoes({ escolheAoAssinar: false })} />);
    expect(screen.getByRole("button", { name: "Assinar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Escolher Premium" })).toBeNull();
  });
});
