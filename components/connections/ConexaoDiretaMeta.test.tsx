/**
 * O cartão da conexão direta: o que a pessoa vê em cada estado, e o que ele
 * pede ao servidor.
 */
import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), params: new URLSearchParams() }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get: h.get, post: h.post, patch: h.patch } }));
vi.mock("next/navigation", () => ({ useSearchParams: () => h.params }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("./ChannelAiAccess", () => ({ ChannelAiAccess: () => <div>IA pausada</div> }));
vi.mock("./RenomearConexao", () => ({ RenomearConexao: () => <button>Renomear</button> }));

import { ConexaoDiretaMeta } from "./ConexaoDiretaMeta";

function montar() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConexaoDiretaMeta />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.params = new URLSearchParams();
});

it("app da Meta não configurado: botão desligado e a frase dizendo a quem pedir", async () => {
  h.get.mockResolvedValue({ data: { disponivel: false, falta: ["sem_app_id"], conexoes: [] } });
  montar();
  expect(await screen.findByTestId("meta-app-nao-configurado")).toHaveTextContent(/Administração › API Oficial da Meta/);
  expect(screen.getByTestId("conectar-direto-meta")).toBeDisabled();
});

it("pronto: Conectar pede a URL do login ao servidor", async () => {
  h.get.mockResolvedValue({ data: { disponivel: true, falta: [], conexoes: [] } });
  h.post.mockRejectedValue(new Error("falhou de propósito"));
  montar();
  const botao = await screen.findByTestId("conectar-direto-meta");
  await vi.waitFor(() => expect(botao).toBeEnabled());
  fireEvent.click(botao);
  await screen.findByText("falhou de propósito");
  expect(h.post).toHaveBeenCalledWith("/api/v1/channels/meta-social", { acao: "iniciar" });
});

it("volta do login: conclui uma vez, mostra as páginas e conecta a escolhida", async () => {
  h.params = new URLSearchParams({ meta_estado: "estado-assinado", meta_code: "codigo-da-meta" });
  h.get.mockResolvedValue({ data: { disponivel: true, falta: [], conexoes: [] } });
  h.post
    .mockResolvedValueOnce({
      data: {
        selecao: "lacre",
        instagram_permitido: true,
        paginas: [{ id: "111", nome: "Loja", pode_mensagens: true, instagram: { id: "178", username: "loja" } }],
      },
    })
    .mockResolvedValueOnce({ data: { conectadas: [] } });
  montar();
  expect(await screen.findByText("Loja")).toBeInTheDocument();
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post).toHaveBeenCalledWith("/api/v1/channels/meta-social", {
    acao: "concluir",
    estado: "estado-assinado",
    code: "codigo-da-meta",
  });
  fireEvent.click(screen.getByTestId("confirmar-pagina-meta"));
  await vi.waitFor(() =>
    expect(h.post).toHaveBeenLastCalledWith("/api/v1/channels/meta-social", {
      acao: "conectar",
      selecao: "lacre",
      page_id: "111",
      redes: ["facebook", "instagram"],
    }),
  );
});

it("conexões ativas aparecem com a rede e desconectar pede confirmação", async () => {
  h.get.mockResolvedValue({
    data: {
      disponivel: true,
      falta: [],
      conexoes: [{ id: "s1", rede: "instagram", conta: "178", pagina: "Loja", display_name: "@loja", status: "WORKING", metadata: {} }],
    },
  });
  h.post.mockResolvedValue({ data: { desconectada: true } });
  montar();
  expect(await screen.findByText("@loja")).toBeInTheDocument();
  expect(screen.getByText("Recebendo")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));
  const botoes = await screen.findAllByRole("button", { name: "Desconectar" });
  fireEvent.click(botoes[botoes.length - 1]!);
  await vi.waitFor(() =>
    expect(h.post).toHaveBeenCalledWith("/api/v1/channels/meta-social", { acao: "desconectar", channel_session_id: "s1" }),
  );
});
