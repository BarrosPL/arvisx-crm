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

function montar(emHomologacao = false) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConexaoDiretaMeta emHomologacao={emHomologacao} />
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

it("em homologação: botão de conectar apagado mesmo com o app da Meta pronto", async () => {
  h.get.mockResolvedValue({ data: { disponivel: true, falta: [], conexoes: [] } });
  montar(true);
  const botao = await screen.findByTestId("conectar-direto-meta");
  await vi.waitFor(() => expect(h.get).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 30));
  expect(botao).toBeDisabled();
  fireEvent.click(botao);
  expect(h.post).not.toHaveBeenCalled();
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

// ─── Comentários do Instagram no cartão ─────────────────────────────────────

const IG = { id: "s1", rede: "instagram", conta: "178", pagina: "Loja", display_name: "@loja", status: "WORKING", metadata: {} };
const FB = { id: "s2", rede: "facebook", conta: "111", pagina: "Loja", display_name: "Loja", status: "WORKING", metadata: {} };
const comentarios = (modo: string, escopo: boolean) => ({ modo, escopo_concedido: escopo, disponivel: escopo });
const conexoes = (...c: unknown[]) => ({ data: { disponivel: true, falta: [], conexoes: c } });

it("o cartão do Instagram mostra o estado dos comentários; o do Messenger não tem o bloco", async () => {
  h.get.mockResolvedValue(conexoes({ ...IG, comentarios: comentarios("registrar", true) }, FB));
  montar();
  expect(await screen.findByTestId("estado-dos-comentarios")).toHaveTextContent("Registrando");
  expect(screen.getAllByTestId("comentarios-da-conexao")).toHaveLength(1);
  expect(screen.queryByTestId("falta-permissao-de-comentarios")).not.toBeInTheDocument();
  expect(screen.queryByTestId("reautorizar-para-comentarios")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ver comentários" })).toHaveAttribute("href", "/app/inbox/comentarios?canal=s1");
});

it.each([
  ["off", "Desligado"],
  ["registrar", "Registrando"],
  ["real", "Ativo"],
])("modo %s aparece como %s", async (modo, rotulo) => {
  h.get.mockResolvedValue(conexoes({ ...IG, comentarios: comentarios(modo, true) }));
  montar();
  expect(await screen.findByTestId("estado-dos-comentarios")).toHaveTextContent(rotulo);
});

it("servidor sem o estado dos comentários (versão anterior): o cartão segue sem o bloco", async () => {
  h.get.mockResolvedValue(conexoes(IG));
  montar();
  expect(await screen.findByText("@loja")).toBeInTheDocument();
  expect(screen.queryByTestId("comentarios-da-conexao")).not.toBeInTheDocument();
});

it("sem a permissão: avisa e oferece Reautorizar, que refaz o login sem desconectar nem mudar o modo", async () => {
  window.sessionStorage.clear();
  h.get.mockResolvedValue(conexoes({ ...IG, comentarios: comentarios("registrar", false) }, FB));
  h.post.mockRejectedValue(new Error("falhou de propósito"));
  montar();
  expect(await screen.findByTestId("falta-permissao-de-comentarios")).toHaveTextContent(/permissão de comentários/);
  fireEvent.click(screen.getByTestId("reautorizar-para-comentarios"));
  await screen.findByText("falhou de propósito");
  // O único pedido é o do login: nada de desconectar, nada de trocar o modo.
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post).toHaveBeenCalledWith("/api/v1/channels/meta-social", { acao: "iniciar" });
  expect(JSON.parse(window.sessionStorage.getItem("conexao-direta-reautorizar") ?? "null")).toEqual({
    conta: "178",
    contasConectadas: ["178", "111"],
  });
});

it("volta da reautorização: a página da conta já vem marcada, só com as redes que ela já tinha", async () => {
  window.sessionStorage.setItem("conexao-direta-reautorizar", JSON.stringify({ conta: "178", contasConectadas: ["178"] }));
  h.params = new URLSearchParams({ meta_estado: "estado-assinado", meta_code: "codigo-da-meta" });
  h.get.mockResolvedValue(conexoes({ ...IG, comentarios: comentarios("registrar", false) }));
  h.post
    .mockResolvedValueOnce({
      data: {
        selecao: "lacre",
        instagram_permitido: true,
        paginas: [
          { id: "999", nome: "Outra página", pode_mensagens: true, instagram: null },
          { id: "111", nome: "Loja", pode_mensagens: true, instagram: { id: "178", username: "loja" } },
        ],
      },
    })
    .mockResolvedValueOnce({ data: { conectadas: [] } });
  montar();
  expect(await screen.findByTestId("aviso-de-reautorizacao")).toHaveTextContent(/o modo dos comentários não muda/);
  // A lembrança é de uso único: um F5 depois não reaproveita a escolha.
  expect(window.sessionStorage.getItem("conexao-direta-reautorizar")).toBeNull();
  fireEvent.click(screen.getByTestId("confirmar-pagina-meta"));
  await vi.waitFor(() =>
    expect(h.post).toHaveBeenLastCalledWith("/api/v1/channels/meta-social", {
      acao: "conectar",
      selecao: "lacre",
      page_id: "111",
      // Só o Instagram: a empresa não tinha o Messenger desta página, e
      // reautorizar não cria conexão nova de carona.
      redes: ["instagram"],
    }),
  );
  // Nenhum pedido troca o modo dos comentários.
  expect(h.post.mock.calls.some(([, corpo]) => (corpo as { acao?: string }).acao === "comentarios_modo")).toBe(false);
});

it("volta da reautorização sem a página da conta entre as autorizadas: diz isso", async () => {
  window.sessionStorage.setItem("conexao-direta-reautorizar", JSON.stringify({ conta: "178", contasConectadas: ["178"] }));
  h.params = new URLSearchParams({ meta_estado: "estado-assinado", meta_code: "codigo-da-meta" });
  h.get.mockResolvedValue(conexoes());
  h.post.mockResolvedValueOnce({
    data: {
      selecao: "lacre",
      instagram_permitido: true,
      paginas: [{ id: "999", nome: "Outra página", pode_mensagens: true, instagram: null }],
    },
  });
  montar();
  expect(await screen.findByTestId("aviso-de-reautorizacao")).toHaveTextContent(/não veio entre as autorizadas/);
});

it("mudar para Registrando grava direto; para Ativo pede confirmação antes", async () => {
  h.get.mockResolvedValue(conexoes({ ...IG, comentarios: comentarios("off", true) }));
  h.post.mockResolvedValue({ data: { modo: "registrar", alterado: true } });
  montar();
  const seletor = await screen.findByTestId("modo-dos-comentarios");
  fireEvent.change(seletor, { target: { value: "registrar" } });
  await vi.waitFor(() =>
    expect(h.post).toHaveBeenCalledWith("/api/v1/channels/meta-social", {
      acao: "comentarios_modo",
      channel_session_id: "s1",
      modo: "registrar",
    }),
  );
  h.post.mockClear();
  await vi.waitFor(() => expect(screen.getByTestId("modo-dos-comentarios")).toBeEnabled());
  fireEvent.change(screen.getByTestId("modo-dos-comentarios"), { target: { value: "real" } });
  // Publicar de verdade não sai num clique: primeiro a confirmação.
  expect(await screen.findByText("Publicar as respostas de verdade?")).toBeInTheDocument();
  expect(h.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("confirmar-modo-real"));
  await vi.waitFor(() =>
    expect(h.post).toHaveBeenCalledWith("/api/v1/channels/meta-social", {
      acao: "comentarios_modo",
      channel_session_id: "s1",
      modo: "real",
    }),
  );
});

it("a recusa do servidor ao mudar o modo aparece com a frase dele", async () => {
  h.get.mockResolvedValue(conexoes({ ...IG, comentarios: comentarios("off", true) }));
  h.post.mockRejectedValue(new Error("Permissão insuficiente."));
  montar();
  fireEvent.change(await screen.findByTestId("modo-dos-comentarios"), { target: { value: "registrar" } });
  expect(await screen.findByText("Permissão insuficiente.")).toBeInTheDocument();
});
