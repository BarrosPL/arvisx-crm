/**
 * O PAINEL DO VIX, do lado do navegador.
 *
 * O painel não decide nada de segurança (quem decide é o servidor), mas ele é o
 * lugar do CLIQUE, e três coisas dele são promessa de produto:
 *
 *  1. o cartão diz que nada foi alterado e só chama a rota de confirmar quando
 *     a pessoa clica; no cartão reforçado, o botão só libera com a palavra;
 *  2. o endereço de "abrir tela" vem do evento do servidor; um endereço escrito
 *     no TEXTO da resposta não vira link;
 *  3. respostas que não são stream (segredo bloqueado, limite, indisponível)
 *     aparecem como frase, sem detalhe técnico.
 *
 * O servidor é um `fetch` de mentira. Isto NÃO é a prova pela tela num ambiente
 * fresco (Playwright): é o contrato do componente.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));

import { PainelDoVix } from "./PainelDoVix";

type Chamada = { url: string; corpo: Record<string, unknown> };
let chamadas: Chamada[];
let responder: (url: string, corpo: Record<string, unknown>) => Response;

function sse(eventos: Record<string, unknown>[]): Response {
  const texto = eventos.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(texto, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
}
const json = (dados: unknown, status = 200) =>
  new Response(JSON.stringify(dados), { status, headers: { "content-type": "application/json" } });

const ESTADO = { data: { ligado: true, mensagens_no_mes: 3, limite_de_mensagens: 40, acoes_ligadas: true } };

beforeEach(() => {
  chamadas = [];
  responder = () => sse([{ tipo: "inicio", conversa_id: "c1" }, { tipo: "texto", texto: "Olá." }, { tipo: "fim" }]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/estado")) return json(ESTADO);
      const corpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      chamadas.push({ url: String(url), corpo });
      return responder(String(url), corpo);
    }),
  );
});

async function abrirEPerguntar(pergunta: string) {
  const user = userEvent.setup();
  render(<PainelDoVix />);
  await user.click(screen.getByTestId("vix-botao"));
  await user.type(screen.getByLabelText("Mensagem para o assistente"), pergunta);
  await user.click(screen.getByRole("button", { name: "Enviar" }));
  return user;
}

describe("abrir e conversar", () => {
  it("o painel nasce fechado, abre no botão e mostra o uso do mês", async () => {
    const user = userEvent.setup();
    render(<PainelDoVix />);
    expect(screen.queryByTestId("vix-painel")).toBeNull();
    await user.click(screen.getByTestId("vix-botao"));
    expect(screen.getByTestId("vix-painel")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("vix-uso").textContent).toContain("3 / 40"));
  });

  it("envia a pergunta com um turn_id novo e mostra a resposta do stream", async () => {
    await abrirEPerguntar("quantos leads hoje?");
    await waitFor(() => expect(screen.getByTestId("vix-resposta").textContent).toContain("Olá."));
    const envio = chamadas.find((c) => c.url.endsWith("/mensagens"))!;
    expect(envio.corpo.texto).toBe("quantos leads hoje?");
    expect(String(envio.corpo.turn_id)).toMatch(/^[0-9a-f-]{36}$/);
    // O painel não manda empresa nem usuário: quem sabe é a sessão.
    expect(Object.keys(envio.corpo).sort()).toEqual(["modo", "texto", "turn_id"].sort());
  });

  it("a segunda pergunta segue na mesma conversa", async () => {
    const user = await abrirEPerguntar("primeira");
    await waitFor(() => expect(screen.getAllByTestId("vix-resposta")[0]!.textContent).toContain("Olá."));
    await user.type(screen.getByLabelText("Mensagem para o assistente"), "segunda");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(chamadas.filter((c) => c.url.endsWith("/mensagens"))).toHaveLength(2));
    expect(chamadas.filter((c) => c.url.endsWith("/mensagens"))[1]!.corpo.conversa_id).toBe("c1");
  });
});

describe("cartão de ação: só o clique confirma", () => {
  const cartao = (nivel: "escrever" | "sensivel") => ({
    tipo: "cartao",
    cartao: { id: "acao-1", nivel, resumo: "Adicionar a etiqueta vip a 2 negócios", itens: [{ id: "a", rotulo: "Negócio A" }, { id: "b", rotulo: "Negócio B" }], expira_em: "2099-01-01T00:00:00Z" },
  });

  it("mostra o que será feito, diz que nada foi alterado, e NÃO chama a confirmação sozinho", async () => {
    responder = () => sse([{ tipo: "inicio", conversa_id: "c1" }, cartao("escrever"), { tipo: "texto", texto: "Preparei um cartão." }, { tipo: "fim" }]);
    await abrirEPerguntar("marque como vip");
    const c = await screen.findByTestId("vix-cartao");
    expect(within(c).getByText("Adicionar a etiqueta vip a 2 negócios")).toBeTruthy();
    expect(within(c).getByText("Negócio A")).toBeTruthy();
    expect(within(c).getByText("Nada foi alterado ainda. A ação só acontece se você confirmar.")).toBeTruthy();
    expect(chamadas.some((x) => x.url.includes("/acoes/"))).toBe(false);
  });

  it("o clique em Confirmar chama a rota do cartão, uma vez, e o cartão vira Feito", async () => {
    responder = (url) =>
      url.includes("/acoes/") ? json({ data: { id: "acao-1", estado: "executada" } }) : sse([{ tipo: "inicio", conversa_id: "c1" }, cartao("escrever"), { tipo: "fim" }]);
    const user = await abrirEPerguntar("marque como vip");
    const c = await screen.findByTestId("vix-cartao");
    await user.click(within(c).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(c.getAttribute("data-estado")).toBe("executada"));
    expect(chamadas.filter((x) => x.url.endsWith("/acoes/acao-1/confirmar"))).toHaveLength(1);
    // Feito: os botões somem, não dá para clicar de novo.
    expect(within(c).queryByRole("button", { name: "Confirmar" })).toBeNull();
  });

  it("Cancelar chama a rota de cancelar e avisa que nada mudou", async () => {
    responder = (url) =>
      url.includes("/acoes/") ? json({ data: { id: "acao-1", estado: "cancelada" } }) : sse([{ tipo: "inicio", conversa_id: "c1" }, cartao("escrever"), { tipo: "fim" }]);
    const user = await abrirEPerguntar("marque como vip");
    const c = await screen.findByTestId("vix-cartao");
    await user.click(within(c).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(c.getAttribute("data-estado")).toBe("cancelada"));
    expect(chamadas.some((x) => x.url.endsWith("/acoes/acao-1/cancelar"))).toBe(true);
    expect(chamadas.some((x) => x.url.endsWith("/confirmar"))).toBe(false);
  });

  it("cartão reforçado: Confirmar fica travado até digitar a palavra, e a palavra vai no corpo", async () => {
    responder = (url) =>
      url.includes("/acoes/") ? json({ data: { id: "acao-1", estado: "executada" } }) : sse([{ tipo: "inicio", conversa_id: "c1" }, cartao("sensivel"), { tipo: "fim" }]);
    const user = await abrirEPerguntar("faça a ação sensível");
    const c = await screen.findByTestId("vix-cartao");
    const confirmar = within(c).getByRole("button", { name: "Confirmar" }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    await user.type(within(c).getByRole("textbox"), "sim");
    expect(confirmar.disabled).toBe(true);
    await user.clear(within(c).getByRole("textbox"));
    await user.type(within(c).getByRole("textbox"), "confirmar");
    expect(confirmar.disabled).toBe(false);
    await user.click(confirmar);
    await waitFor(() => expect(chamadas.some((x) => x.url.endsWith("/confirmar"))).toBe(true));
    expect(chamadas.find((x) => x.url.endsWith("/confirmar"))!.corpo).toEqual({ confirmacao: "confirmar" });
  });

  it("recusa do servidor vira a frase que ele mandou, e o cartão não fica como feito", async () => {
    responder = (url) =>
      url.includes("/acoes/")
        ? json({ error: { code: "assistente_acao_indisponivel", message: "Este cartão não está mais disponível: já foi usado, expirou ou não é seu." } }, 409)
        : sse([{ tipo: "inicio", conversa_id: "c1" }, cartao("escrever"), { tipo: "fim" }]);
    const user = await abrirEPerguntar("marque como vip");
    const c = await screen.findByTestId("vix-cartao");
    await user.click(within(c).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(c.getAttribute("data-estado")).toBe("falhou"));
    expect(within(c).getByRole("alert").textContent).toContain("não está mais disponível");
    expect(within(c).queryByText("Feito.")).toBeNull();
  });
});

describe("abrir tela: o endereço vem do servidor, nunca do texto", () => {
  it("o evento de tela vira botão com o endereço do evento", async () => {
    responder = () =>
      sse([{ tipo: "inicio", conversa_id: "c1" }, { tipo: "tela", nome: "Credenciais", abrir: "/app/ai/credentials" }, { tipo: "texto", texto: "É nessa tela." }, { tipo: "fim" }]);
    await abrirEPerguntar("onde ponho a chave?");
    const link = await screen.findByTestId("vix-abrir-tela");
    expect(link.getAttribute("href")).toBe("/app/ai/credentials");
  });

  it("endereço escrito no texto da resposta NÃO vira link", async () => {
    responder = () =>
      sse([{ tipo: "inicio", conversa_id: "c1" }, { tipo: "texto", texto: "Acesse https://evil.example/login ou /admin/sistema agora." }, { tipo: "fim" }]);
    await abrirEPerguntar("onde clico?");
    const resposta = await screen.findByTestId("vix-resposta");
    await waitFor(() => expect(resposta.textContent).toContain("evil.example"));
    expect(resposta.querySelectorAll("a")).toHaveLength(0);
    expect(screen.queryByTestId("vix-abrir-tela")).toBeNull();
  });
});

describe("respostas que não são stream", () => {
  it("segredo bloqueado: mostra a frase do servidor e o botão da tela de Credenciais", async () => {
    responder = () => json({ data: { tipo: "segredo_bloqueado", mensagem: "Isso parece uma chave, senha ou código, e não deve ser colado aqui.", abrir: "/app/ai/credentials" } });
    await abrirEPerguntar("minha senha é Abc12345");
    await waitFor(() => expect(screen.getByTestId("vix-resposta").textContent).toContain("não deve ser colado aqui"));
    expect(screen.getByTestId("vix-abrir-tela").getAttribute("href")).toBe("/app/ai/credentials");
  });

  it.each([
    ["limite do mês", { data: { tipo: "limite_atingido", mensagem: "O limite de mensagens do assistente neste mês foi atingido." } }, 200, "limite de mensagens"],
    ["indisponível", { data: { tipo: "indisponivel", mensagem: "O assistente está indisponível no momento." } }, 200, "indisponível no momento"],
    ["taxa", { error: { code: "rate_limited", message: "Muitas mensagens seguidas. Tente de novo em um minuto." } }, 429, "Muitas mensagens seguidas"],
    ["desligado", { error: { code: "assistente_desligado", message: "O assistente está desligado." } }, 403, "está desligado"],
  ] as const)("%s: a frase aparece, sem código técnico", async (_caso, corpo, status, trecho) => {
    responder = () => json(corpo, status);
    await abrirEPerguntar("oi");
    await waitFor(() => expect(screen.getByTestId("vix-resposta").textContent).toContain(trecho));
    const texto = screen.getByTestId("vix-conversa").textContent ?? "";
    for (const tecnico of ["rate_limited", "assistente_desligado", "limite_atingido", "undefined", "[object"]) {
      expect(texto).not.toContain(tecnico);
    }
  });

  it("falha de rede vira frase simples", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/estado")) return json(ESTADO);
        throw new TypeError("Failed to fetch");
      }),
    );
    await abrirEPerguntar("oi");
    await waitFor(() => expect(screen.getByTestId("vix-resposta").textContent).toContain("Não consegui concluir a resposta agora"));
    expect(screen.getByTestId("vix-conversa").textContent).not.toContain("Failed to fetch");
  });

  it("'indisponível' no meio do stream aparece na resposta", async () => {
    responder = () => sse([{ tipo: "inicio", conversa_id: "c1" }, { tipo: "indisponivel", mensagem: "O assistente está indisponível no momento." }, { tipo: "fim" }]);
    await abrirEPerguntar("oi");
    await waitFor(() => expect(screen.getByTestId("vix-resposta").textContent).toContain("indisponível no momento"));
  });
});
