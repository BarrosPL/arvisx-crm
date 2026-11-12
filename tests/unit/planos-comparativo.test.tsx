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
import { afterEach, describe, expect, it, vi } from "vitest";

// Só para os três usos do comparativo dentro de AcoesDaAssinatura (tarefa 3): nenhuma chamada sai.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/api/client", () => ({ apiClient: { post: vi.fn() } }));
vi.mock("@/lib/cobranca/navegar", () => ({ abrirNoNavegador: vi.fn() }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

import { AcoesDaAssinatura, type PropsDasAcoes } from "@/components/cobranca/AcoesDaAssinatura";
import { ComparativoDosPlanos } from "@/components/cobranca/ComparativoDosPlanos";
import { FRASES_DE_QUEM_CUIDA, QUEM_CUIDA_DOS_AGENTES, SAIDA_DO_SOB_MEDIDA } from "@/lib/cobranca/quem-cuida-dos-agentes";
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

  it("com IVA pela Stripe Tax: o preço dos cards e a diferença dizem '+ IVA'; sem IVA, não", () => {
    const planos = QUATRO();
    const { unmount } = render(
      <ComparativoDosPlanos planos={planos} atual={{ ...planos[1]!, atual: true }} selecionadoId="premium" onEscolher={() => {}} iva />,
    );
    const premium = screen.getAllByRole("listitem").find((li) => li.getAttribute("data-plano") === "Premium")!;
    expect(within(premium).getByText(/\+ IVA por mês/)).toBeTruthy();
    expect(screen.getByText(/\+70,00\s€ \+ IVA por mês/)).toBeTruthy();
    unmount();
    render(<ComparativoDosPlanos planos={planos} atual={null} selecionadoId={null} onEscolher={() => {}} />);
    expect(screen.queryByText(/IVA/)).toBeNull();
  });
});

/**
 * QUEM CUIDA DOS AGENTES DE IA (ArvisX, tarefa 3 dos planos): o aviso fixo de
 * `lib/cobranca/quem-cuida-dos-agentes.ts` aparece no comparativo, acima dos
 * cards, nos três lugares em que o comparativo é usado, com o texto da constante.
 */
describe("quem cuida dos agentes de IA, no comparativo", () => {
  const acoes = (p: Partial<PropsDasAcoes> = {}): PropsDasAcoes => {
    const planos = QUATRO();
    const doTeste = { ...plano("Premium"), id: "do-teste", nome: "Teste", atual: true };
    return {
      estado: "trial", temProvedor: false, assinaturasVivas: 0, linkDePagamento: null, cancelaNoFim: false,
      planosParaTroca: [], planoAtual: { ...doTeste }, periodoPagoDesde: null, proximoVencimento: null,
      trocaPagamentoUrl: null, trocaStatus: null, instanteCalculo: "2026-11-12T12:00:00Z", voltouDoCheckout: false, noHub: false,
      provedor: "stripe", documentoDoCadastro: null, escolheAoAssinar: true, planosParaAssinar: planos.map((c) => ({ ...c })),
      uso: { assentos: 2, canais: 1 }, comparativo: { planos, atual: doTeste }, ...p,
    };
  };

  /** O aviso está na tela, inteiro, com as frases da constante, e ANTES dos cards. */
  function conferirOAviso() {
    const aviso = screen.getByRole("region", { name: QUEM_CUIDA_DOS_AGENTES.titulo });
    for (const frase of FRASES_DE_QUEM_CUIDA) expect(within(aviso).getAllByText(frase).length).toBeGreaterThan(0);
    expect(aviso.querySelectorAll("[data-planos]")).toHaveLength(QUEM_CUIDA_DOS_AGENTES.itens.length);
    expect(within(aviso).getByText(QUEM_CUIDA_DOS_AGENTES.consumo)).toBeTruthy();
    const primeiroCard = screen.getAllByRole("listitem").find((li) => li.hasAttribute("data-plano"))!;
    expect(aviso.compareDocumentPosition(primeiroCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelectorAll("[data-quem-cuida-dos-agentes]")).toHaveLength(1);
    return aviso.textContent;
  }

  it("⭐ o mesmo texto nos três usos: fim do teste, Assinar e Plano e cobrança", async () => {
    // 1. Fim do teste (hub da conta suspensa).
    const fim = render(<AcoesDaAssinatura {...acoes({ estado: "em_atraso", noHub: true })} />);
    const noFimDoTeste = conferirOAviso();
    fim.unmount();

    // 2. Assinar, ainda no teste grátis.
    const assinar = render(<AcoesDaAssinatura {...acoes()} />);
    const noAssinar = conferirOAviso();
    assinar.unmount();

    // 3. Plano e cobrança: a troca de plano de quem já assina.
    const planos = QUATRO();
    planos[1] = { ...planos[1]!, atual: true };
    render(
      <AcoesDaAssinatura
        {...acoes({
          estado: "ativa", temProvedor: true, assinaturasVivas: 1, escolheAoAssinar: false, planosParaAssinar: [],
          planoAtual: { ...planos[1]! }, planosParaTroca: [planos[0]!, planos[2]!, planos[3]!].map((c) => ({ ...c })),
          periodoPagoDesde: "2026-11-01T12:00:00Z", proximoVencimento: "2026-12-01T12:00:00Z",
          comparativo: { planos, atual: planos[1]! },
        })}
      />,
    );
    expect(document.querySelector("[data-quem-cuida-dos-agentes]")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Trocar de plano" }));
    const naTroca = conferirOAviso();

    expect(noAssinar).toBe(noFimDoTeste);
    expect(naTroca).toBe(noFimDoTeste);
    expect(noFimDoTeste).toBe(FRASES_DE_QUEM_CUIDA.join(""));
  });

  it("o aviso comum não substitui o 'Como funciona' do Equipe Completa, que segue em destaque no card", () => {
    render(<ComparativoDosPlanos planos={QUATRO()} atual={null} selecionadoId={null} onEscolher={() => {}} />);
    const equipe = screen.getAllByRole("listitem").find((li) => li.getAttribute("data-plano") === "Equipe Completa")!;
    expect(within(equipe.querySelector("[data-como-funciona]") as HTMLElement).getByText(COMO_FUNCIONA)).toBeTruthy();
    expect(screen.getByRole("region", { name: QUEM_CUIDA_DOS_AGENTES.titulo }).querySelector("[data-como-funciona]")).toBeNull();
  });

  it("a frase é de capacidade e não promete trava: não limita agentes nem dá nome de agente", () => {
    const tudo = [...FRASES_DE_QUEM_CUIDA, SAIDA_DO_SOB_MEDIDA].join(" ");
    expect(tudo).toMatch(/você é responsável pela gestão e pela configuração dos seus agentes de IA/);
    // 12/11/2026: o Equipe Completa saiu da oferta. Os agentes sob medida são o
    // serviço à parte Agentes Arvisx, para qualquer plano, por reunião e proposta
    // — e só o item dele fala em reunião.
    const itens = QUEM_CUIDA_DOS_AGENTES.itens.map((i) => ({ id: i.id as string, planos: i.planos as string, texto: i.texto as string }));
    expect(itens.map((i) => i.id)).toEqual(["essencial", "standard_e_premium", "agentes_arvisx"]);
    const porPlano = Object.fromEntries(itens.map((i) => [i.id, i.texto]));
    expect(itens[2]!.planos).toBe("Agentes Arvisx (à parte)");
    expect(porPlano.agentes_arvisx).toMatch(/^Em qualquer plano, quem quiser agentes de IA desenvolvidos pela Arvisx contrata o serviço à parte, depois de uma reunião: /);
    expect(porPlano.agentes_arvisx).toMatch(/envia a proposta e desenvolve os agentes sob medida, conectados à sua operação\.$/);
    for (const id of ["essencial", "standard_e_premium"]) expect(porPlano[id]).not.toMatch(/reunião/);
    expect(porPlano.standard_e_premium).toMatch(/A Arvisx só desenvolve soluções personalizadas pelo serviço à parte Agentes Arvisx\.$/);
    // Os agentes da Arvisx não dependem do CRM nem do plano: o Essencial só não tem a IA DA PLATAFORMA.
    expect(porPlano.essencial).toBe(
      "O Essencial não tem agentes de IA na plataforma: a IA dentro do CRM começa no Standard. Agentes desenvolvidos pela Arvisx podem ser contratados à parte, pelo serviço Agentes Arvisx.",
    );
    expect(FRASES_DE_QUEM_CUIDA.join(" ")).not.toMatch(/integrad[oa]s ao/);
    // O aviso fixo não cita o plano que saiu, não promete quantidade nem dá preço.
    expect(FRASES_DE_QUEM_CUIDA.join(" ")).not.toMatch(/Equipe Completa|único plano|\d+ agentes|€/);
    expect(tudo).not.toMatch(/\b(Sophia|Matheus|Pedro)\b|agente Financeiro/i);
    expect(tudo).not.toMatch(/\d+\s?%|sozinho|funcionário/i);
  });

  it("⭐ Equipe Completa → Premium: a perda do serviço sob medida aparece ANTES do botão de confirmar; no caminho inverso, não", () => {
    const planos = QUATRO();
    planos[3] = { ...planos[3]!, atual: true };
    const { unmount } = render(
      <ComparativoDosPlanos planos={planos} atual={planos[3]!} selecionadoId="premium" onEscolher={() => {}} confirmar={() => <button type="button">Confirmar troca</button>} />,
    );
    const mudanca = screen.getByRole("region", { name: "De Equipe Completa para Premium" });
    const perda = within(mudanca).getByText(SAIDA_DO_SOB_MEDIDA);
    const botao = within(mudanca).getByRole("button", { name: "Confirmar troca" });
    expect(perda.compareDocumentPosition(botao) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mudanca.querySelectorAll("[data-sai-do-sob-medida]")).toHaveLength(1);
    unmount();

    const outros = QUATRO();
    outros[2] = { ...outros[2]!, atual: true };
    render(<ComparativoDosPlanos planos={outros} atual={outros[2]!} selecionadoId="equipe-completa" onEscolher={() => {}} />);
    expect(screen.queryByText(SAIDA_DO_SOB_MEDIDA)).toBeNull();
  });
});
