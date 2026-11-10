import { cleanup, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cena = vi.hoisted(() => ({
  usuario: null as { id: string } | null,
  vitrine: { planos: [] as unknown[], iva: false },
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((destino: string) => {
    throw new Error(`NEXT_REDIRECT:${destino}`);
  }),
}));
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "fonte-da-vitrine", className: "", style: {} }),
}));
vi.mock("@/lib/branding/saida", () => ({
  marcaDaSaida: async () => ({ nome: "Arvisx CRM" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: cena.usuario } }) },
  }),
}));

vi.mock("@/lib/landing/planos", () => ({ planosDaVitrine: async () => cena.vitrine }));

import HomePage, { metadata } from "./page";
import { FRASES_DE_QUEM_CUIDA, QUEM_CUIDA_DOS_AGENTES } from "@/lib/cobranca/quem-cuida-dos-agentes";
import { CADASTRO_ABERTO, LINKS, OFERTA } from "@/lib/landing/links";

async function montar() {
  return render(await HomePage());
}

/** Os quatro planos como o dono os cadastra (docs/arvisx/PLANOS.md). */
const plano = (nome: string, preco: number, canais: number | null, pessoas: number | null, telas: number, extra = {}) => ({
  id: nome, nome, preco_cents: preco, moeda: "EUR", intervalo: "mes", max_canais: canais, max_assentos: pessoas,
  descricao_curta: null, para_quem: null, destaques: [], como_funciona: null, inclui_agentes_arvisx: false,
  telas: Array.from({ length: telas }, (_, i) => `/t${i}`), ...extra,
});
const QUATRO = [
  plano("Essencial", 5990, 3, 5, 12, { descricao_curta: "Atender e organizar.", destaques: ["Agenda"] }),
  plano("Standard", 12990, 6, 10, 31),
  plano("Premium", 19990, null, null, 63),
  plano("Equipe Completa", 49990, null, null, 63, { inclui_agentes_arvisx: true, como_funciona: "Nossa equipe entra em contato." }),
];

beforeEach(() => {
  cena.usuario = null;
  cena.vitrine = { planos: QUATRO, iva: true };
  localStorage.clear();
});

describe("/ — landing v3", () => {
  it("sem sessão: a promessa da hero, como no protótipo aprovado", async () => {
    await montar();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Toda a sua operação de vendas e atendimento em um só CRM.",
    );
  });

  it("⭐ com o cadastro aberto, o topo, a hero e os planos sem o serviço sob medida levam ao cadastro; o Equipe Completa, à reunião", async () => {
    expect(CADASTRO_ABERTO).toBe(true);
    const { container } = await montar();
    expect(screen.queryByText(OFERTA.ctaEmBreve)).toBeNull();
    // topo + hero + Essencial, Standard e Premium (o Equipe Completa começa pela reunião)
    expect(container.querySelectorAll(`a[href="${LINKS.cadastro}"]`)).toHaveLength(2 + QUATRO.length - 1);
    for (const card of container.querySelectorAll("[data-plano]")) {
      const links = within(card as HTMLElement).getAllByRole("link");
      expect(links).toHaveLength(1);
      if (card.getAttribute("data-plano") === "Equipe Completa") {
        expect(links[0]).toHaveTextContent("Agendar reunião");
        expect(links[0]).toHaveAttribute("href", "/agendar");
      } else {
        expect(links[0]).toHaveTextContent(OFERTA.cta);
        expect(links[0]).toHaveAttribute("href", "/signup");
      }
    }
    expect(LINKS.cadastro).toBe("/signup");
    expect(LINKS.agendar).toBe("/agendar");
    // card do Equipe Completa + seção #agentes
    expect(container.querySelectorAll(`a[href="${LINKS.agendar}"]`)).toHaveLength(2);
  });

  it("⭐ os planos vêm do cadastro: quatro cards com preço + IVA, limites e o texto do plano; selos certos", async () => {
    const { container } = await montar();
    const cards = [...container.querySelectorAll("[data-plano]")] as HTMLElement[];
    expect(cards.map((c) => c.getAttribute("data-plano"))).toEqual(["Essencial", "Standard", "Premium", "Equipe Completa"]);
    const essencial = within(cards[0]!);
    expect(essencial.getByText(/59,90/)).toBeTruthy();
    expect(essencial.getByText("+ IVA por mês")).toBeTruthy();
    expect(essencial.getByText("Até 3 canais · até 5 pessoas")).toBeTruthy();
    expect(essencial.getByText("Atender e organizar.")).toBeTruthy();
    expect(within(cards[2]!).getByText("Mais completo")).toBeTruthy();
    expect(within(cards[3]!).getByText(/4 agentes de IA sob medida/)).toBeTruthy();
    expect(within(cards[3]!).getByText("Nossa equipe entra em contato.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/plano único/);
  });

  it("sem IVA ligado, o preço não diz '+ IVA'; sem plano cadastrado, a seção fica só com o teste grátis", async () => {
    cena.vitrine = { planos: QUATRO, iva: false };
    const { container, unmount } = await montar();
    expect(container.textContent).not.toMatch(/IVA/);
    unmount();
    cena.vitrine = { planos: [], iva: false };
    const vazio = await montar();
    expect(vazio.container.querySelectorAll("[data-plano]")).toHaveLength(0);
    expect(vazio.container.querySelector("#plano a[href='/signup']")).toBeTruthy();
  });

  it("⭐ a seção do Equipe Completa começa pela reunião: três passos e o botão que leva a /agendar, sem botão de cadastro", async () => {
    const { container } = await montar();
    const secao = container.querySelector("#agentes") as HTMLElement;
    expect(within(secao).getByRole("heading", { level: 2 })).toHaveTextContent("Quer agentes de IA feitos para a sua operação?");
    expect(within(secao).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Você agenda uma reunião de 30 minutos com o time Arvisx",
      "Entendemos a sua operação e orientamos como assinar o Equipe Completa",
      "Desenvolvemos os 4 agentes e integramos ao seu CRM",
    ]);
    expect(within(secao).getByRole("link", { name: "Agendar reunião com o time Arvisx" })).toHaveAttribute("href", LINKS.agendar);
    expect(secao.querySelector(`a[href="${LINKS.cadastro}"]`)).toBeNull();
    expect(secao.textContent).toMatch(/A assinatura do Equipe Completa é feita no CRM, com a orientação da nossa equipe na reunião\./);
    expect(secao.textContent).toMatch(/É o único plano em que a Arvisx desenvolve soluções personalizadas\./);
  });

  it("o hero não promete IA em todos os planos: a IA começa no Standard", async () => {
    const { container } = await montar();
    const hero = container.querySelector(".hero") as HTMLElement;
    expect(hero.textContent).not.toMatch(/Em todos os planos · IA/);
    expect(within(hero).getByText("IA a partir do Standard, com as credenciais da sua empresa")).toBeTruthy();
  });

  it("⭐ o aviso 'Quem cuida dos agentes de IA' aparece abaixo da grade de planos, com as frases da constante", async () => {
    const { container } = await montar();
    const secao = container.querySelector("#plano") as HTMLElement;
    const aviso = within(secao).getByRole("region", { name: QUEM_CUIDA_DOS_AGENTES.titulo });
    expect(aviso.textContent).toBe(FRASES_DE_QUEM_CUIDA.join(""));
    const grade = secao.querySelector(".planos-grade")!;
    expect(grade.compareDocumentPosition(aviso) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll("[data-quem-cuida-dos-agentes]")).toHaveLength(1);
    // Também sem plano cadastrado: a regra não depende do cadastro.
    cleanup();
    cena.vitrine = { planos: [], iva: false };
    const vazio = await montar();
    expect(vazio.container.querySelector("#plano [data-quem-cuida-dos-agentes]")).toBeTruthy();
  });

  it("⭐ nada na landing diz que o serviço da Arvisx é à parte ou por reunião (nem a descrição da página)", async () => {
    const { container } = await montar();
    const tudo = `${container.textContent} ${String(metadata.description)} ${String(metadata.openGraph?.description)}`;
    for (const proibida of [/contratad[oa]s? à parte/i, /orçad[oa]s? em reunião/i, /combinad[oa]s? na reunião/i, /Agentes Arvisx/, /desenhe e acompanhe o agente/]) {
      expect(tudo).not.toMatch(proibida);
    }
    // Onde a landing diz que a Arvisx desenvolve, diz em que plano.
    expect(String(metadata.description)).toMatch(/No plano Equipe Completa, a equipe Arvisx desenvolve agentes de IA sob medida\./);
    expect(container.querySelector("#ia")!.textContent).toMatch(/A gestão e a configuração dos agentes são suas\./);
    expect(container.querySelector("#suas-chaves")!.textContent).toMatch(/Esse serviço faz parte do plano Equipe Completa\. Comece por uma reunião\./);
    // A reunião é do Equipe Completa: a descrição não diz que se assina sem ela, e o FAQ diz por onde começa.
    expect(String(metadata.description)).not.toMatch(/sem reunião|assine|assinar/i);
    const faq = container.querySelector("#faq")!.textContent!;
    expect(faq).toMatch(/nos demais planos, a Arvisx não desenvolve soluções personalizadas\. O Equipe Completa começa por uma reunião\./);
    expect(faq).toMatch(/Você começa por uma reunião com a nossa equipe, que entende a sua operação e orienta a assinatura; depois criamos 4 agentes de IA sob medida/);
  });

  it("os links para a seção do Equipe Completa existem e a âncora #agentes continua no lugar", async () => {
    const { container } = await montar();
    expect(container.querySelector("section#agentes")).toBeTruthy();
    const para = [...container.querySelectorAll('a[href="#agentes"]')].map((a) => a.textContent);
    expect(para).toEqual(["Conheça o Equipe Completa", "Como funciona o Equipe Completa", "Equipe Completa"]);
    expect(within(screen.getByRole("navigation", { name: "Rodapé" })).getByRole("link", { name: "Equipe Completa" })).toHaveAttribute("href", "#agentes");
  });

  it("Entrar leva ao login", async () => {
    await montar();
    expect(screen.getByRole("link", { name: "Entrar" })).toHaveAttribute("href", "/login");
  });

  it("sem sessão: descreve o produto e traz os links de privacidade e termos (exigência do Google)", async () => {
    await montar();
    // a finalidade do produto, visível na página inicial
    expect(
      screen.getByText(/Atendimento, funil, agenda e chamadas de voz e vídeo num só CRM\./),
    ).toBeInTheDocument();
    // os dois documentos cadastrados na tela de permissão OAuth, com o href exato
    const legal = within(screen.getByRole("navigation", { name: "Legal" }));
    expect(legal.getByRole("link", { name: "Política de Privacidade" })).toHaveAttribute(
      "href",
      "/legal/privacy",
    );
    expect(legal.getByRole("link", { name: "Termos de Serviço" })).toHaveAttribute(
      "href",
      "/legal/terms",
    );
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/legal/privacy");
    expect(hrefs).toContain("/legal/terms");
  });

  it("o teste grátis sai da oferta centralizada, e 'Quanto custa?' usa os preços do cadastro", async () => {
    await montar();
    expect(screen.getAllByText(OFERTA.trial).length).toBeGreaterThan(0);
    expect(screen.getByText(/São 4 planos mensais, de 59,90\s€ a 499,90\s€ \+ IVA/)).toBeTruthy();
  });

  it("o carrossel tem as seis telas e a primeira começa selecionada", async () => {
    await montar();
    const abas = screen.getAllByRole("tab");
    expect(abas.map((a) => a.textContent)).toEqual([
      "Caixa de entrada",
      "Funis",
      "Cartão do lead",
      "Contatos",
      "Agenda",
      "Financeiro",
    ]);
    expect(abas[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(6);
  });

  it("os ícones são <svg> do Phosphor do app (nada de fonte de ícone por CDN)", async () => {
    const { container } = await montar();
    expect(container.querySelectorAll("i.ph, i[class*='ph-']")).toHaveLength(0);
    expect(container.querySelectorAll("svg.ico").length).toBeGreaterThanOrEqual(30);
  });

  it("toda imagem tem texto alternativo declarado e as capturas são .webp locais", async () => {
    const { container } = await montar();
    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      expect(img.hasAttribute("alt")).toBe(true);
      expect(img.getAttribute("width")).toBeTruthy();
      expect(img.getAttribute("height")).toBeTruthy();
    }
    const capturas = imgs.filter((i) => i.getAttribute("src")?.startsWith("/img/landing/"));
    expect(capturas.length).toBeGreaterThan(0);
    for (const c of capturas) expect(c.getAttribute("src")).toMatch(/\.webp$/);
  });

  it("mostra o aviso de cookies a quem ainda não o dispensou", async () => {
    await montar();
    expect(await screen.findByRole("region", { name: "Aviso de cookies" })).toBeInTheDocument();
  });

  it("com sessão: segue para o painel", async () => {
    cena.usuario = { id: "u1" };
    await expect(montar()).rejects.toThrow("NEXT_REDIRECT:/app");
  });
});
