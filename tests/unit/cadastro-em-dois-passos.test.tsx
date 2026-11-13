/**
 * O CADASTRO EM DOIS PASSOS: primeiro o plano, depois os dados (ArvisX).
 *
 * O plano era uma lista suspensa com o mais barato já marcado, e quase todo
 * cadastro saía nele. O que estes casos seguram:
 *
 *  - nenhum plano nasce marcado: sem clicar num cartão não há formulário;
 *  - o plano mais barato COM IA leva "Recomendado", e o sem IA diz que não tem;
 *  - o plano clicado é o que o envio leva, e "Trocar" volta aos cartões;
 *  - `?plano=` da página inicial pula o primeiro passo;
 *  - o texto convida a testar ("se gostar, faz a sua assinatura"), e não diz
 *    que a pessoa só paga depois;
 *  - sem plano oferecido, a tela é a de sempre.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ signUp: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/app/actions/auth/signUp", () => ({ signUp: (...a: unknown[]) => h.signUp(...a) }));

import { EscolhaDoPlano } from "@/components/auth/EscolhaDoPlano";
import { SignupForm } from "@/components/auth/SignupForm";
import type { PlanoDoCadastro } from "@/lib/cobranca/cadastro";
import {
  TELA_DOS_AGENTES_DE_IA,
  cartoesDoCadastro,
  planoDaUrl,
  type TextosDoPlano,
} from "@/lib/cobranca/cartoes-do-cadastro";

const plano = (id: string, nome: string, preco: number): PlanoDoCadastro => ({
  id,
  nome,
  preco_cents: preco,
  moeda: "EUR",
  intervalo: "mes",
  trial_dias: 7,
});
// O formulário valida o plano como UUID: com um id qualquer o envio nem sai.
const ID = {
  essencial: "11111111-1111-4111-8111-111111111111",
  standard: "22222222-2222-4222-8222-222222222222",
  premium: "33333333-3333-4333-8333-333333333333",
} as const;
const PLANOS = [plano(ID.essencial, "Essencial", 5990), plano(ID.standard, "Standard", 12990), plano(ID.premium, "Premium", 19990)];
const texto = (id: string, curta: string, comIa: boolean, canais: number | null): TextosDoPlano => ({
  id,
  descricao_curta: curta,
  para_quem: null,
  destaques: [`Destaque do ${id}`],
  max_canais: canais,
  max_assentos: canais,
  telas: comIa ? ["/app/inbox", TELA_DOS_AGENTES_DE_IA] : ["/app/inbox"],
});
const TEXTOS = [
  texto(ID.essencial, "Atender e organizar.", false, 3),
  texto(ID.standard, "Atender e automatizar com IA.", true, 6),
  texto(ID.premium, "Operar a empresa inteira.", true, null),
];
const CARTOES = cartoesDoCadastro(PLANOS, TEXTOS);

function montar(planoInicial: string | null = null) {
  return render(
    <EscolhaDoPlano planos={CARTOES} planoInicial={planoInicial}>
      <SignupForm planos={PLANOS} planoInicial={ID.essencial} />
    </EscolhaDoPlano>,
  );
}
const cartao = (nome: keyof typeof ID) =>
  screen.getByTestId("escolha-do-plano").querySelector(`[data-plano="${ID[nome]}"]`) as HTMLElement;

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("os cartões", () => {
  it("o recomendado é o mais barato COM IA, e só ele", () => {
    expect(CARTOES.filter((c) => c.recomendado).map((c) => c.id)).toEqual([ID.standard]);
    expect(CARTOES.map((c) => c.temIa)).toEqual([false, true, true]);
  });

  it("se todos têm IA, ninguém leva o selo", () => {
    const todos = cartoesDoCadastro(
      PLANOS,
      TEXTOS.map((t) => ({ ...t, telas: [TELA_DOS_AGENTES_DE_IA] })),
    );
    expect(todos.some((c) => c.recomendado)).toBe(false);
  });

  it("sem os textos da vitrine, o cartão não afirma nada sobre IA nem recomenda", () => {
    const crus = cartoesDoCadastro(PLANOS, []);
    expect(crus.map((c) => c.temIa)).toEqual([null, null, null]);
    expect(crus.some((c) => c.recomendado)).toBe(false);
  });

  it("o plano da URL só vale se ainda é oferecido", () => {
    expect(planoDaUrl(CARTOES, ID.standard)).toBe(ID.standard);
    expect(planoDaUrl(CARTOES, "arquivado")).toBeNull();
    expect(planoDaUrl(CARTOES, undefined)).toBeNull();
  });
});

describe("⭐ primeiro passo: a escolha é da pessoa", () => {
  it("nenhum plano nasce marcado: há cartões, e não há formulário", () => {
    montar();
    const passo = screen.getByTestId("escolha-do-plano");
    expect(within(passo).getAllByRole("heading", { level: 2 }).map((h2) => h2.textContent)).toEqual([
      "Essencial",
      "Standard",
      "Premium",
    ]);
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByRole("button", { name: /Criar conta/ })).toBeNull();
  });

  it("o texto convida a testar e só então assinar", () => {
    montar();
    const passo = screen.getByTestId("escolha-do-plano");
    expect(passo.textContent).toContain(
      "Escolha o que melhor se encaixa no seu caso e teste por 7 dias. No fim do teste, se gostar, você faz a sua assinatura.",
    );
    expect(passo.textContent).not.toMatch(/só paga depois|não paga nada/i);
  });

  it("o Standard leva Recomendado e o Essencial diz que não tem agentes de IA", () => {
    montar();
    expect(cartao("standard").textContent).toContain("Recomendado");
    expect(cartao("essencial").textContent).not.toContain("Recomendado");
    expect(cartao("premium").textContent).not.toContain("Recomendado");
    expect(cartao("essencial").textContent).toContain("Não tem agentes de IA");
    expect(cartao("standard").textContent).not.toContain("Não tem agentes de IA");
    expect(cartao("essencial").textContent).toContain("Atender e organizar.");
  });

  it("a comparação abre e mostra o limite de cada plano", async () => {
    montar();
    await userEvent.click(screen.getByRole("button", { name: "Comparar os planos" }));
    const tabela = screen.getByRole("table");
    expect(tabela.textContent).toContain("Agentes de IA");
    expect(tabela.textContent).toContain("Ilimitado");
  });
});

describe("⭐ segundo passo: o plano clicado é o que vai", () => {
  it("clicar num cartão abre o formulário com o plano no resumo e no botão, sem o seletor", async () => {
    montar();
    await userEvent.click(screen.getByRole("button", { name: "Testar o Premium por 7 dias" }));
    expect(screen.queryByTestId("escolha-do-plano")).toBeNull();
    const resumo = screen.getByTestId("plano-escolhido");
    expect(resumo.textContent).toContain("Plano Premium");
    expect(resumo.textContent).toContain("7 dias de teste. Se gostar, a assinatura é");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "Criar conta e testar o Premium" })).toBeTruthy();
    expect(screen.getByText("Você testa por 7 dias. No fim, se gostar, faz a sua assinatura.")).toBeTruthy();
  });

  it("o envio leva o plano escolhido, e não o que o seletor antigo marcaria", async () => {
    h.signUp.mockResolvedValue({ ok: true, requires_email_confirmation: true });
    montar();
    await userEvent.click(screen.getByRole("button", { name: "Testar o Standard por 7 dias" }));
    await userEvent.type(screen.getByLabelText("Nome da empresa"), "Clínica Vitalis");
    await userEvent.type(screen.getByLabelText("Email"), "ana@clinica.test");
    await userEvent.type(screen.getByLabelText("Senha"), "Senha-Forte-2026!");
    await userEvent.type(screen.getByLabelText("Confirmar senha"), "Senha-Forte-2026!");
    await userEvent.click(screen.getByRole("button", { name: "Criar conta e testar o Standard" }));
    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
    expect((h.signUp.mock.calls[0]?.[0] as { cobranca_plan_id?: string }).cobranca_plan_id).toBe(ID.standard);
  });

  it("Trocar volta aos cartões", async () => {
    montar();
    await userEvent.click(screen.getByRole("button", { name: "Testar o Essencial por 7 dias" }));
    await userEvent.click(screen.getByRole("button", { name: "Trocar" }));
    expect(screen.getByTestId("escolha-do-plano")).toBeTruthy();
    expect(screen.queryByTestId("plano-escolhido")).toBeNull();
  });

  it("vindo da página inicial com o plano na URL, o primeiro passo é pulado", () => {
    montar(ID.premium);
    expect(screen.queryByTestId("escolha-do-plano")).toBeNull();
    expect(screen.getByTestId("plano-escolhido").textContent).toContain("Plano Premium");
  });
});

describe("fora dos dois passos, a tela é a de sempre", () => {
  it("sem plano oferecido não há primeiro passo", () => {
    render(
      <EscolhaDoPlano planos={[]}>
        <SignupForm planos={[]} diasDeTesteGratis={7} />
      </EscolhaDoPlano>,
    );
    expect(screen.queryByTestId("escolha-do-plano")).toBeNull();
    expect(screen.getByRole("button", { name: "Criar conta" })).toBeTruthy();
  });

  it("o formulário sozinho continua com o seletor", () => {
    render(<SignupForm planos={PLANOS} planoInicial={ID.essencial} />);
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(screen.queryByTestId("plano-escolhido")).toBeNull();
  });
});
