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

/**
 * Os três planos ofertados, como o dono os cadastra (docs/arvisx/PLANOS.md). O
 * Equipe Completa saiu da oferta em 12/11/2026 (arquivado; a vitrine não o lê):
 * os agentes sob medida são o serviço à parte Agentes Arvisx.
 */
const plano = (nome: string, preco: number, canais: number | null, pessoas: number | null, telas: number, extra = {}) => ({
  id: nome, nome, preco_cents: preco, moeda: "EUR", intervalo: "mes", max_canais: canais, max_assentos: pessoas,
  descricao_curta: null, para_quem: null, destaques: [], como_funciona: null, inclui_agentes_arvisx: false,
  telas: Array.from({ length: telas }, (_, i) => `/t${i}`), ...extra,
});
const TRES = [
  plano("Essencial", 5990, 3, 5, 12, { descricao_curta: "Atender e organizar.", destaques: ["Agenda"] }),
  plano("Standard", 12990, 6, 10, 31),
  plano("Premium", 19990, null, null, 63),
];
/** Um plano com a flag do serviço sob medida: nenhum é ofertado hoje, mas o ramo da landing continua. */
const COM_A_FLAG = plano("Sob medida", 49990, null, null, 63, { inclui_agentes_arvisx: true, como_funciona: "Nossa equipe entra em contato." });

beforeEach(() => {
  cena.usuario = null;
  cena.vitrine = { planos: TRES, iva: true };
  localStorage.clear();
});

describe("/ — landing v3", () => {
  it("sem sessão: a promessa da hero, como no protótipo aprovado", async () => {
    await montar();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Toda a sua operação de vendas e atendimento em um só CRM.",
    );
  });

  it("⭐ com o cadastro aberto, o topo, a hero e os três planos levam ao cadastro; a reunião fica só na seção dos Agentes Arvisx", async () => {
    expect(CADASTRO_ABERTO).toBe(true);
    const { container } = await montar();
    expect(screen.queryByText(OFERTA.ctaEmBreve)).toBeNull();
    // topo + hero + Essencial, Standard e Premium
    // (o botão de cada plano leva a escolha junto: `/signup?plano=<id>`)
    expect(container.querySelectorAll(`a[href="${LINKS.cadastro}"]`)).toHaveLength(2);
    expect(container.querySelectorAll(`a[href^="${LINKS.cadastro}?plano="]`)).toHaveLength(TRES.length);
    for (const card of container.querySelectorAll("[data-plano]")) {
      const links = within(card as HTMLElement).getAllByRole("link");
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveTextContent(OFERTA.cta);
      expect(links[0]?.getAttribute("href")).toMatch(/^\/signup\?plano=.+/);
    }
    expect(LINKS.cadastro).toBe("/signup");
    expect(LINKS.agendar).toBe("/agendar");
    // Só a seção #agentes: nenhum card de plano leva à reunião.
    const paraAReuniao = [...container.querySelectorAll(`a[href="${LINKS.agendar}"]`)];
    expect(paraAReuniao).toHaveLength(1);
    expect(paraAReuniao[0]!.closest("#agentes")).toBeTruthy();
  });

  it("⭐ os planos vêm do cadastro: três cards com preço + IVA, limites e o texto do plano; selos certos", async () => {
    const { container } = await montar();
    const cards = [...container.querySelectorAll("[data-plano]")] as HTMLElement[];
    expect(cards.map((c) => c.getAttribute("data-plano"))).toEqual(["Essencial", "Standard", "Premium"]);
    const essencial = within(cards[0]!);
    expect(essencial.getByText(/59,90/)).toBeTruthy();
    expect(essencial.getByText("+ IVA por mês")).toBeTruthy();
    expect(essencial.getByText("Até 3 canais · até 5 pessoas")).toBeTruthy();
    expect(essencial.getByText("Atender e organizar.")).toBeTruthy();
    expect(within(cards[2]!).getByText("Mais completo")).toBeTruthy();
    expect(container.querySelector("#plano")!.textContent).not.toMatch(/agentes de IA sob medida/);
    expect(container.textContent).not.toMatch(/plano único/);
  });

  it("um plano com a flag do serviço sob medida (nenhum é ofertado hoje) ainda começa pela reunião, sem prometer quantidade", async () => {
    cena.vitrine = { planos: [...TRES, COM_A_FLAG], iva: true };
    const { container } = await montar();
    const card = container.querySelector('[data-plano="Sob medida"]') as HTMLElement;
    const links = within(card).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Agendar reunião");
    expect(links[0]).toHaveAttribute("href", "/agendar");
    expect(within(card).getByText("Agentes de IA sob medida")).toBeTruthy();
    expect(within(card).getByText("Nossa equipe entra em contato.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d+ agentes/);
  });

  it("sem IVA ligado, o preço não diz '+ IVA'; sem plano cadastrado, a seção fica só com o teste grátis", async () => {
    cena.vitrine = { planos: TRES, iva: false };
    const { container, unmount } = await montar();
    expect(container.textContent).not.toMatch(/IVA/);
    unmount();
    cena.vitrine = { planos: [], iva: false };
    const vazio = await montar();
    expect(vazio.container.querySelectorAll("[data-plano]")).toHaveLength(0);
    expect(vazio.container.querySelector("#plano a[href='/signup']")).toBeTruthy();
  });

  it("⭐ a seção dos Agentes Arvisx começa pela reunião: três passos e o botão que leva a /agendar, sem botão de cadastro", async () => {
    const { container } = await montar();
    const secao = container.querySelector("#agentes") as HTMLElement;
    expect(within(secao).getByText("Agentes Arvisx · Soluções sob medida")).toBeTruthy();
    expect(within(secao).getByRole("heading", { level: 2 })).toHaveTextContent(
      "Quer ir além do CRM? Agentes de IA feitos para a sua operação.",
    );
    expect(within(secao).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Você agenda uma reunião de 30 minutos com o time Arvisx",
      "Entendemos a sua operação e desenhamos os agentes com você",
      "Enviamos a proposta, desenvolvemos e conectamos à sua operação",
    ]);
    expect(within(secao).getByRole("link", { name: "Agendar reunião com o time Arvisx" })).toHaveAttribute("href", LINKS.agendar);
    expect(secao.querySelector(`a[href="${LINKS.cadastro}"]`)).toBeNull();
    expect(secao.querySelector("[data-agentes-arvisx]")).toBeTruthy();
    // Serviço à parte, por conversa: os agentes não dependem do Arvisx CRM nem de plano.
    expect(secao.textContent).toMatch(/desenvolve agentes de IA sob medida, conectados à sua operação: ao\s+Arvisx CRM ou aos sistemas que você já usa\./);
    expect(secao.textContent).toMatch(/É um serviço contratado à parte, depois\s+de uma conversa, e não depende de plano\./);
    expect(secao.textContent).not.toMatch(/integrad[oa]s? ao|integramos ao|qualquer\s+plano/);
    expect(secao.textContent).toMatch(/O escopo, o prazo e o valor são combinados na proposta\./);
    expect(secao.textContent).toMatch(/O nome do assistente é o que\s+você quiser, e o agente se apresenta como assistente virtual\./);
    // Sem preço público e sem prometer quantidade.
    expect(secao.textContent).not.toMatch(/€|\d+ agentes|assinatura/);
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

  it("⭐ a landing não oferece mais o Equipe Completa: três planos, e os agentes sob medida são o serviço à parte Agentes Arvisx (também na descrição da página)", async () => {
    const { container } = await montar();
    const tudo = `${container.textContent} ${String(metadata.description)} ${String(metadata.openGraph?.description)}`;
    for (const proibida of [/Equipe Completa/, /Quatro planos/i, /\d+ agentes/, /único plano/, /desenhe e acompanhe o agente/]) {
      expect(tudo).not.toMatch(proibida);
    }
    expect(String(metadata.description)).toMatch(/Três planos, do atendimento à operação inteira com IA/);
    expect(String(metadata.description)).toMatch(/Agentes de IA sob medida são um serviço à parte, os Agentes Arvisx\./);
    expect(String(metadata.openGraph?.description)).toMatch(/Três planos/);
    expect(container.querySelector(".hero")!.textContent).toMatch(/Três planos, do\s+atendimento à operação inteira com IA\./);
    expect(container.querySelector("#ia")!.textContent).toMatch(/A gestão e a configuração dos agentes são suas\./);
    expect(container.querySelector("#suas-chaves")!.textContent).toMatch(
      /Esse é um serviço à\s+parte, os Agentes Arvisx, contratado depois de uma reunião\./,
    );
    // Sem preço público do serviço: "Quanto custa?" diz que ele é orçado na reunião.
    const faq = container.querySelector("#faq")!.textContent!;
    expect(faq).toMatch(/Os Agentes Arvisx são um serviço à parte, orçado na\s+reunião; nos planos, você configura e gerencia os seus agentes\./);
    expect(faq).toMatch(/O que são os Agentes Arvisx\?/);
    expect(faq).toMatch(/conectados à sua operação, no Arvisx CRM ou em outros sistemas\. É um\s+serviço contratado à parte, por reunião e proposta, e não depende de plano\./);
    // Nada na página amarra os Agentes Arvisx ao CRM ou a um plano ("IA integrada" é a IA do CRM e fica).
    expect(tudo).not.toMatch(/integrad[oa]s ao (seu )?CRM|integramos ao seu CRM|vale para qualquer plano|Funciona com qualquer/);
  });

  it("os links para a seção dos Agentes Arvisx existem e a âncora #agentes continua no lugar", async () => {
    const { container } = await montar();
    expect(container.querySelector("section#agentes")).toBeTruthy();
    const para = [...container.querySelectorAll('a[href="#agentes"]')].map((a) => a.textContent);
    expect(para).toEqual(["Conheça os Agentes Arvisx", "Agentes de IA sob medida", "Agentes Arvisx"]);
    expect(within(screen.getByRole("navigation", { name: "Rodapé" })).getByRole("link", { name: "Agentes Arvisx" })).toHaveAttribute("href", "#agentes");
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
    expect(screen.getByText(/São 3 planos mensais, de 59,90\s€ a 199,90\s€ \+ IVA/)).toBeTruthy();
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
