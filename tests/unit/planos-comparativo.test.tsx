/**
 * O COMPARATIVO DOS PLANOS (ArvisX, tarefa 2 dos planos).
 *
 * Com a distribuição real (tests/helpers/distribuicao-dos-planos.ts): quatro
 * cards com os textos do plano, "Mais completo" no Premium, o selo e o "Como
 * funciona" só no Equipe Completa; ao escolher, a diferença de preço e o que
 * entra e o que sai por bloco de benefício — antes do botão de confirmar.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ComparativoDosPlanos } from "@/components/cobranca/ComparativoDosPlanos";
import { BLOCOS, BLOCO_DA_TELA, entraESai, maisCompleto, telasDoPlanoNoSeletor, telasDoSeletor } from "@/lib/cobranca/comparativo";
import type { PlanoDoComparativo } from "@/lib/cobranca/painel";
import { PLANOS, type NomeDoPlano } from "../helpers/distribuicao-dos-planos";

afterEach(cleanup);

const PRECO: Record<NomeDoPlano, number> = { Essencial: 5990, Standard: 12990, Premium: 19990, "Equipe Completa": 49990 };
const LIMITES: Record<NomeDoPlano, [number | null, number | null]> = {
  Essencial: [3, 5],
  Standard: [6, 10],
  Premium: [null, null],
  "Equipe Completa": [null, null],
};

function plano(nome: NomeDoPlano, extra: Partial<PlanoDoComparativo> = {}): PlanoDoComparativo {
  const [canais, pessoas] = LIMITES[nome];
  return {
    id: nome.toLowerCase().replace(" ", "-"), nome, preco_cents: PRECO[nome], moeda: "EUR", intervalo: "mes",
    max_canais: canais, max_assentos: pessoas, teto_ia_usd_cents: null, atual: false,
    descricao_curta: null, para_quem: null, destaques: [], limites: [], como_funciona: null,
    inclui_agentes_arvisx: nome === "Equipe Completa",
    telas: telasDoPlanoNoSeletor({ preset: "completa", destinos: PLANOS[nome] }),
    excedente: {},
    ...extra,
  };
}

const COMO_FUNCIONA = "Assim que a assinatura é confirmada, nossa equipe entra em contato para entender a sua operação.";
const QUATRO = () => [
  plano("Essencial", { descricao_curta: "Atender e organizar.", limites: ["Não tem agentes de IA."] }),
  plano("Standard", { descricao_curta: "Atender e automatizar com IA." }),
  plano("Premium", { descricao_curta: "Operar a empresa inteira.", destaques: ["Campanhas, prospecção e Cold Call"] }),
  plano("Equipe Completa", { como_funciona: COMO_FUNCIONA }),
];

describe("os blocos de benefício cobrem o seletor", () => {
  it("toda tela do seletor tem bloco, e o mapa não tem tela fora do seletor (cerca)", () => {
    const seletor = telasDoSeletor().map((d) => d.href as string);
    const mapeadas = Object.keys(BLOCO_DA_TELA);
    expect(seletor.filter((h) => !mapeadas.includes(h))).toEqual([]);
    expect(mapeadas.filter((h) => !seletor.includes(h))).toEqual([]);
    expect(new Set(Object.values(BLOCO_DA_TELA))).toEqual(new Set(BLOCOS.map((b) => b.id)));
  });

  it("Essencial → Premium: entra tudo o que falta, nada sai", () => {
    const m = entraESai(plano("Essencial").telas, plano("Premium").telas);
    expect(Object.fromEntries(m.map((b) => [b.bloco, [b.entram.length, b.saem.length]]))).toEqual({
      atender: [7, 0],
      automatizar: [11, 0],
      vender: [8, 0],
      prospectar: [4, 0],
      medir: [9, 0],
      integrar: [7, 0],
      ia_avancada: [5, 0],
    });
  });

  it("Premium → Standard: saem as 32 telas de vender, prospectar, medir, integrar e IA avançada", () => {
    const m = entraESai(plano("Premium").telas, plano("Standard").telas);
    expect(Object.fromEntries(m.map((b) => [b.bloco, [b.entram.length, b.saem.length]]))).toEqual({
      vender: [0, 8],
      prospectar: [0, 4],
      medir: [0, 8],
      integrar: [0, 7],
      ia_avancada: [0, 5],
    });
    expect(m.reduce((n, b) => n + b.saem.length, 0)).toBe(32);
  });

  it("o destaque 'Mais completo' é o Premium (o Equipe Completa é serviço, não degrau)", () => {
    expect(maisCompleto(QUATRO())).toBe("premium");
  });
});

describe("o comparativo na tela", () => {
  it("renderiza os quatro planos com os textos do plano; o selo e o 'Como funciona' só no Equipe Completa", () => {
    render(<ComparativoDosPlanos planos={QUATRO()} atual={null} selecionadoId={null} onEscolher={() => {}} />);
    const cards = screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-plano"));
    expect(cards.map((c) => c.getAttribute("data-plano"))).toEqual(["Essencial", "Standard", "Premium", "Equipe Completa"]);
    expect(within(cards[0]!).getByText("Atender e organizar.")).toBeTruthy();
    expect(within(cards[0]!).getByText("Não tem agentes de IA.")).toBeTruthy();
    expect(within(cards[2]!).getByText("Campanhas, prospecção e Cold Call")).toBeTruthy();
    expect(within(cards[3]!).getByText(/499,90/)).toBeTruthy();

    const comSelo = cards.filter((c) => c.querySelector('[data-selo="agentes"]'));
    expect(comSelo.map((c) => c.getAttribute("data-plano"))).toEqual(["Equipe Completa"]);
    const comComoFunciona = cards.filter((c) => c.querySelector("[data-como-funciona]"));
    expect(comComoFunciona.map((c) => c.getAttribute("data-plano"))).toEqual(["Equipe Completa"]);
    expect(within(cards[3]!).getByText(COMO_FUNCIONA)).toBeTruthy();
    const maisCompletoSelo = cards.filter((c) => c.querySelector('[data-selo="mais-completo"]'));
    expect(maisCompletoSelo.map((c) => c.getAttribute("data-plano"))).toEqual(["Premium"]);
    // Sem dado de venda, nada de "mais vendido".
    expect(screen.queryByText(/mais vendido/i)).toBeNull();
  });

  it("Essencial → Premium: '+€140 por mês', os limites que caem e o que entra por bloco", async () => {
    const planos = QUATRO();
    planos[0] = { ...planos[0]!, atual: true };
    render(
      <ComparativoDosPlanos
        planos={planos}
        atual={planos[0]!}
        selecionadoId="premium"
        onEscolher={() => {}}
        confirmar={() => <button type="button">Confirmar</button>}
      />,
    );
    const mudanca = screen.getByRole("region", { name: "De Essencial para Premium" });
    expect(within(mudanca).getByText(/\+140,00\s€ por mês/)).toBeTruthy();
    expect(within(mudanca).getByText("Números conectados: 3 → ilimitados · Pessoas: 5 → ilimitados")).toBeTruthy();
    const linhas = within(mudanca).getAllByRole("row").slice(1);
    expect(linhas.map((l) => l.getAttribute("data-bloco"))).toEqual(["atender", "automatizar", "vender", "prospectar", "medir", "integrar", "ia_avancada"]);
    expect(mudanca.querySelectorAll("[data-saem] li")).toHaveLength(0);
    const vender = linhas.find((l) => l.getAttribute("data-bloco") === "vender")!;
    expect(within(vender).getByText("Propostas (CRM)")).toBeTruthy();
    expect(within(vender).getByText("Propostas (Organização)")).toBeTruthy();
    expect(within(vender).getByText("Campanhas")).toBeTruthy();
    // Plano com IA: a frase da credencial do cliente aparece.
    expect(within(mudanca).getByText(/o consumo é cobrado pelo provedor de IA/)).toBeTruthy();
  });

  it("Premium → Standard: '−€70 por mês' e o que se perde aparece ANTES do botão de confirmar", () => {
    const planos = QUATRO();
    planos[2] = { ...planos[2]!, atual: true };
    render(
      <ComparativoDosPlanos
        planos={planos}
        atual={planos[2]!}
        selecionadoId="standard"
        onEscolher={() => {}}
        confirmar={() => <button type="button">Confirmar troca</button>}
      />,
    );
    const mudanca = screen.getByRole("region", { name: "De Premium para Standard" });
    expect(within(mudanca).getByText(/−70,00\s€ por mês/)).toBeTruthy();
    expect(mudanca.querySelectorAll("[data-saem] li")).toHaveLength(32);
    expect(mudanca.querySelectorAll("[data-entram] li")).toHaveLength(0);
    const ia = within(mudanca).getAllByRole("row").find((l) => l.getAttribute("data-bloco") === "ia_avancada")!;
    expect(within(ia).getByText("Skills")).toBeTruthy();
    expect(within(ia).getByText("Memória")).toBeTruthy();
    expect(within(ia).getByText("Roteadores")).toBeTruthy();
    const perdas = mudanca.querySelector("[data-saem]")!;
    const botao = within(mudanca).getByRole("button", { name: "Confirmar troca" });
    expect(perdas.compareDocumentPosition(botao) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("plano sem IA (Essencial): nenhuma frase sobre IA na mudança", () => {
    const planos = QUATRO();
    render(<ComparativoDosPlanos planos={planos} atual={{ ...planos[1]!, atual: true }} selecionadoId="essencial" onEscolher={() => {}} />);
    expect(screen.queryByText(/o consumo é cobrado pelo provedor de IA/)).toBeNull();
  });

  it("na troca, o plano atual vem marcado e não se escolhe; escolher outro chama onEscolher", async () => {
    const planos = QUATRO();
    planos[1] = { ...planos[1]!, atual: true };
    const escolhas: string[] = [];
    render(<ComparativoDosPlanos planos={planos} atual={planos[1]!} selecionadoId={null} onEscolher={(id) => escolhas.push(id)} />);
    const standard = screen.getAllByRole("listitem").find((li) => li.getAttribute("data-plano") === "Standard")!;
    expect(within(standard).getByText("Plano atual")).toBeTruthy();
    expect((within(standard).getByRole("button", { name: "Seu plano" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.setup().click(screen.getByRole("button", { name: "Escolher Equipe Completa" }));
    expect(escolhas).toEqual(["equipe-completa"]);
  });
});
