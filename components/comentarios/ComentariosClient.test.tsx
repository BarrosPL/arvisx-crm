/**
 * A tela de Comentários do Instagram: o que a equipe vê e o que ela pede às
 * rotas `/api/v1/social-comments`. A regra (uma resposta por comentário, modo
 * da conexão, 7 dias) é do servidor e é medida lá; aqui se mede que a tela
 * mostra "simulada" e "incerta" sem ambiguidade, que só reenvia uma resposta
 * incerta com confirmação, e que a recusa aparece com a frase do servidor.
 */
import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  sucesso: vi.fn(),
  erro: vi.fn(),
  sessoes: [] as unknown[],
}));
vi.mock("@/lib/api/client", () => ({ apiClient: { get: h.get, post: h.post } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/lib/i18n/IdiomaProvider", () => ({ useIdioma: () => "pt-BR" }));
vi.mock("sonner", () => ({ toast: { success: h.sucesso, error: h.erro } }));
vi.mock("@/hooks/channels/useChannelSessions", () => ({
  useChannelSessions: () => ({ data: h.sessoes }),
  channelLabel: (c: { display_name: string | null }) => c.display_name ?? "sem nome",
}));

import { CHANNEL_PROVIDER_SOCIAL_DIRETO } from "@/lib/channels/capabilities";

import { TETO_DE_TRANSPORTE_DO_TEXTO } from "@/lib/comentarios/schemas";

import { ComentariosClient, TETO_DO_TEXTO_DA_RESPOSTA } from "./ComentariosClient";

const CANAL = "44444444-4444-4444-8444-444444444444";
const QUEM = { tipo: "user", id: "u1" };
const DIA = 24 * 60 * 60 * 1000;

function comentario(extra: Record<string, unknown> = {}) {
  const quando = new Date(Date.now() - DIA).toISOString();
  return {
    id: "c1",
    comment_id: "1786",
    channel_session_id: CANAL,
    modo_do_canal: "registrar",
    parent_comment_id: null,
    media_id: "1790",
    media_product_type: "REELS",
    ad_id: null,
    ad_title: null,
    ao_vivo: false,
    author: { id: "23", username: "cliente.exemplo" },
    text: "Quanto custa?",
    commented_at: quando,
    private_reply_deadline: new Date(Date.parse(quando) + 7 * DIA).toISOString(),
    estado: "novo",
    public_reply: null,
    private_reply: null,
    hidden: null,
    ignore_reason: null,
    contact_id: null,
    created_at: quando,
    updated_at: quando,
    ...extra,
  };
}
const resposta = (extra: Record<string, unknown> = {}) => ({
  id: null,
  texto: "Chama no privado!",
  quando: new Date().toISOString(),
  quem: QUEM,
  simulada: false,
  situacao: "concluida",
  ...extra,
});
const pagina = (...c: unknown[]) => ({ data: c, meta: { cursor: null, has_more: false } });

function montar(canalInicial: string | null = null) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ComentariosClient canalInicial={canalInicial} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.sessoes = [{ id: CANAL, provider: CHANNEL_PROVIDER_SOCIAL_DIRETO, display_name: "instagram · @loja" }];
});

it("lista o comentário com a conexão, o autor, o texto inteiro, a publicação e o estado", async () => {
  h.get.mockResolvedValue(pagina(comentario()));
  montar();
  const cartao = await screen.findByTestId("comentario");
  expect(within(cartao).getByText("@cliente.exemplo")).toBeInTheDocument();
  expect(within(cartao).getByTestId("texto-do-comentario")).toHaveTextContent("Quanto custa?");
  expect(within(cartao).getByText(/instagram · @loja/)).toBeInTheDocument();
  expect(within(cartao).getByText(/REELS · 1790/)).toBeInTheDocument();
  expect(within(cartao).getByTestId("estado-do-comentario")).toHaveTextContent("Novo");
  expect(h.get).toHaveBeenCalledWith("/api/v1/social-comments?limite=30");
});

it("lista vazia explica que os comentários dependem do modo da conexão", async () => {
  h.get.mockResolvedValue(pagina());
  montar();
  expect(await screen.findByTestId("comentarios-vazio")).toHaveTextContent(/Registrando ou Ativo/);
});

it("os filtros de conexão, estado e publicação vão para a rota", async () => {
  h.get.mockResolvedValue(pagina(comentario()));
  montar(CANAL);
  await screen.findByTestId("comentario");
  expect(h.get).toHaveBeenLastCalledWith(`/api/v1/social-comments?limite=30&canal=${CANAL}`);
  fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "respondido" } });
  await vi.waitFor(() =>
    expect(h.get).toHaveBeenLastCalledWith(`/api/v1/social-comments?limite=30&canal=${CANAL}&estado=respondido`),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Só desta publicação" }));
  await vi.waitFor(() =>
    expect(h.get).toHaveBeenLastCalledWith(
      `/api/v1/social-comments?limite=30&canal=${CANAL}&estado=respondido&midia=1790`,
    ),
  );
});

it("resposta SIMULADA aparece com o selo e a frase de que nada foi publicado", async () => {
  h.get.mockResolvedValue(pagina(comentario({ estado: "respondido", public_reply: resposta({ simulada: true }) })));
  montar();
  const bloco = await screen.findByTestId("resposta-do-comentario");
  expect(within(bloco).getByTestId("selo-simulada")).toHaveTextContent("Simulada");
  expect(bloco).toHaveTextContent(/nada foi publicado/);
  expect(within(bloco).queryByTestId("selo-incerta")).not.toBeInTheDocument();
  // Já há resposta pública: o botão de responder não é oferecido de novo.
  expect(screen.getByTestId("responder-em-publico")).toBeDisabled();
});

it("resposta publicada de verdade não leva selo de simulada nem de incerta", async () => {
  h.get.mockResolvedValue(pagina(comentario({ estado: "respondido", public_reply: resposta({ id: "179" }) })));
  montar();
  const bloco = await screen.findByTestId("resposta-do-comentario");
  expect(within(bloco).getByText("Publicada")).toBeInTheDocument();
  expect(within(bloco).queryByTestId("selo-simulada")).not.toBeInTheDocument();
});

it("resposta INCERTA: avisa que pode ter saído e só reenvia com confirmação explícita", async () => {
  h.get.mockResolvedValue(pagina(comentario({ public_reply: resposta({ situacao: "incerta" }) })));
  h.post.mockResolvedValue({ data: { simulada: false } });
  montar();
  const bloco = await screen.findByTestId("resposta-do-comentario");
  expect(within(bloco).getByTestId("selo-incerta")).toHaveTextContent("Incerta");
  expect(bloco).toHaveTextContent(/pode ter sido publicada ou não/);
  // Nada é reenviado sozinho ao abrir a tela.
  expect(h.post).not.toHaveBeenCalled();
  fireEvent.click(within(bloco).getByTestId("reenviar-incerta"));
  // O diálogo avisa do risco de duplicar e traz o texto da tentativa anterior.
  expect(await screen.findByText(/a pessoa verá duas/)).toBeInTheDocument();
  expect(screen.getByLabelText("Sua resposta")).toHaveValue("Chama no privado!");
  expect(h.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("enviar-resposta"));
  await vi.waitFor(() =>
    expect(h.post).toHaveBeenCalledWith("/api/v1/social-comments/c1/reply", {
      text: "Chama no privado!",
      confirmar_reenvio: true,
    }),
  );
});

it("Responder em público manda só o texto; em modo de registro o aviso diz que nada foi publicado", async () => {
  h.get.mockResolvedValue(pagina(comentario()));
  h.post.mockResolvedValue({ data: { simulada: true } });
  montar();
  fireEvent.click(await screen.findByTestId("responder-em-publico"));
  const enviar = await screen.findByTestId("enviar-resposta");
  // Texto vazio não sai.
  expect(enviar).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Sua resposta"), { target: { value: "Olá!" } });
  fireEvent.click(enviar);
  await vi.waitFor(() => expect(h.post).toHaveBeenCalledWith("/api/v1/social-comments/c1/reply", { text: "Olá!" }));
  await vi.waitFor(() =>
    expect(h.sucesso).toHaveBeenCalledWith("Resposta registrada como simulada. Nada foi publicado."),
  );
});

it("Responder em privado manda o texto e o pedido de criar o contato", async () => {
  h.get.mockResolvedValue(pagina(comentario()));
  h.post.mockResolvedValue({ data: { simulada: false } });
  montar();
  fireEvent.click(await screen.findByTestId("responder-em-privado"));
  fireEvent.change(await screen.findByLabelText("Sua resposta"), { target: { value: "Te chamei aqui." } });
  fireEvent.click(screen.getByTestId("enviar-resposta"));
  await vi.waitFor(() =>
    expect(h.post).toHaveBeenCalledWith("/api/v1/social-comments/c1/private-reply", {
      text: "Te chamei aqui.",
      criar_contato: true,
    }),
  );
  await vi.waitFor(() => expect(h.sucesso).toHaveBeenCalledWith("Resposta privada enviada."));
});

it("a recusa do servidor aparece no diálogo com a frase dele, e a resposta não some", async () => {
  h.get.mockResolvedValue(pagina(comentario()));
  h.post.mockRejectedValue(
    Object.assign(new Error("Os comentários desta conexão estão desligados."), { code: "comentarios_desligados" }),
  );
  montar();
  fireEvent.click(await screen.findByTestId("responder-em-publico"));
  fireEvent.change(await screen.findByLabelText("Sua resposta"), { target: { value: "Olá!" } });
  fireEvent.click(screen.getByTestId("enviar-resposta"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Os comentários desta conexão estão desligados.");
  expect(screen.getByLabelText("Sua resposta")).toHaveValue("Olá!");
  expect(h.sucesso).not.toHaveBeenCalled();
});

it("recusa de resposta incerta recarrega a lista, para o aviso aparecer no comentário", async () => {
  h.get.mockResolvedValue(pagina(comentario()));
  h.post.mockRejectedValue(Object.assign(new Error("A Meta não confirmou a operação."), { code: "resposta_incerta" }));
  montar();
  fireEvent.click(await screen.findByTestId("responder-em-publico"));
  fireEvent.change(await screen.findByLabelText("Sua resposta"), { target: { value: "Olá!" } });
  const antes = h.get.mock.calls.length;
  fireEvent.click(screen.getByTestId("enviar-resposta"));
  expect(await screen.findByRole("alert")).toHaveTextContent("A Meta não confirmou a operação.");
  await vi.waitFor(() => expect(h.get.mock.calls.length).toBeGreaterThan(antes));
});

it("passados os 7 dias, a resposta privada fica desligada e a tela diz por quê", async () => {
  const velho = new Date(Date.now() - 8 * DIA).toISOString();
  h.get.mockResolvedValue(
    pagina(comentario({ commented_at: velho, private_reply_deadline: new Date(Date.parse(velho) + 7 * DIA).toISOString() })),
  );
  montar();
  expect(await screen.findByTestId("responder-em-privado")).toBeDisabled();
  expect(screen.getByText(/até 7 dias depois do comentário/)).toBeInTheDocument();
  expect(screen.getByTestId("responder-em-publico")).toBeEnabled();
});

it("Ocultar pede confirmação e diz quando a ocultação foi só simulada", async () => {
  h.get.mockResolvedValue(pagina(comentario()));
  h.post.mockResolvedValue({ data: { simulada: true } });
  montar();
  fireEvent.click(await screen.findByTestId("ocultar-comentario"));
  expect(h.post).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByTestId("confirmar-ocultar"));
  await vi.waitFor(() => expect(h.post).toHaveBeenCalledWith("/api/v1/social-comments/c1/hide", {}));
  await vi.waitFor(() =>
    expect(h.sucesso).toHaveBeenCalledWith("Ocultação registrada como simulada. Nada mudou no Instagram."),
  );
});

it("Ignorar grava o motivo; comentário respondido ou já sem ação não oferece Ignorar", async () => {
  h.get.mockResolvedValue(
    pagina(comentario(), comentario({ id: "c2", estado: "sem_acao", ignore_reason: "elogio" })),
  );
  h.post.mockResolvedValue({ data: {} });
  montar();
  const cartoes = await screen.findAllByTestId("comentario");
  expect(within(cartoes[1]!).getByTestId("ignorar-comentario")).toBeDisabled();
  expect(within(cartoes[1]!).getByText(/elogio/)).toBeInTheDocument();
  fireEvent.click(within(cartoes[0]!).getByTestId("ignorar-comentario"));
  fireEvent.change(await screen.findByLabelText("Motivo (opcional)"), { target: { value: "  spam " } });
  fireEvent.click(screen.getByTestId("confirmar-ignorar"));
  await vi.waitFor(() =>
    expect(h.post).toHaveBeenCalledWith("/api/v1/social-comments/c1/ignore", { motivo: "spam" }),
  );
});

it("falha ao carregar aparece como erro, não como lista vazia", async () => {
  h.get.mockRejectedValue(new Error("Sem permissão para ver os comentários."));
  montar();
  expect(await screen.findByRole("alert")).toHaveTextContent("Sem permissão para ver os comentários.");
  expect(screen.queryByTestId("comentarios-vazio")).not.toBeInTheDocument();
});

// ─── Revisão de 20/11/2026 ──────────────────────────────────────────────────

// Item 1.1, na tela: resposta simulada não trava a resposta de verdade.
it("⭐ resposta simulada + conexão em modo real: Responder volta a ser oferecido, e a tela avisa da substituição", async () => {
  h.get.mockResolvedValue(
    pagina(
      comentario({
        estado: "respondido",
        modo_do_canal: "real",
        public_reply: resposta({ simulada: true }),
        private_reply: resposta({ simulada: true, message_id: null }),
      }),
    ),
  );
  h.post.mockResolvedValue({ data: { simulada: false } });
  montar();
  const responder = await screen.findByTestId("responder-em-publico");
  expect(responder).toBeEnabled();
  expect(screen.getByTestId("responder-em-privado")).toBeEnabled();
  expect(screen.getAllByTestId("simulada-substituivel")).toHaveLength(2);

  fireEvent.click(responder);
  expect(await screen.findByTestId("aviso-substitui-simulada")).toHaveTextContent(/publicada de verdade/);
  // O texto começa vazio: não é reenvio da simulada, é uma resposta nova.
  expect(screen.getByLabelText("Sua resposta")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Sua resposta"), { target: { value: "Agora vai." } });
  fireEvent.click(screen.getByTestId("enviar-resposta"));
  await vi.waitFor(() => expect(h.post).toHaveBeenCalledWith("/api/v1/social-comments/c1/reply", { text: "Agora vai." }));
  await vi.waitFor(() => expect(h.sucesso).toHaveBeenCalledWith("Resposta publicada no Instagram."));
});

it("⭐ resposta simulada com a conexão ainda em registro (ou sem modo conhecido): Responder segue desligado", async () => {
  for (const modo of ["registrar", "off", null]) {
    cleanup();
    h.get.mockResolvedValue(
      pagina(comentario({ estado: "respondido", modo_do_canal: modo, public_reply: resposta({ simulada: true }) })),
    );
    montar();
    expect(await screen.findByTestId("responder-em-publico")).toBeDisabled();
    expect(screen.queryByTestId("simulada-substituivel")).not.toBeInTheDocument();
  }
});

it("⭐ resposta de VERDADE nunca volta a oferecer Responder, nem em modo real", async () => {
  h.get.mockResolvedValue(
    pagina(
      comentario({
        estado: "respondido",
        modo_do_canal: "real",
        public_reply: resposta({ id: "179" }),
        private_reply: resposta({ id: "mid.1", message_id: null }),
      }),
    ),
  );
  montar();
  expect(await screen.findByTestId("responder-em-publico")).toBeDisabled();
  expect(screen.getByTestId("responder-em-privado")).toBeDisabled();
  expect(screen.queryByTestId("simulada-substituivel")).not.toBeInTheDocument();
});

it("privada simulada + modo real, mas com os 7 dias vencidos: continua desligada", async () => {
  const velho = new Date(Date.now() - 8 * DIA).toISOString();
  h.get.mockResolvedValue(
    pagina(
      comentario({
        commented_at: velho,
        private_reply_deadline: new Date(Date.parse(velho) + 7 * DIA).toISOString(),
        modo_do_canal: "real",
        private_reply: resposta({ simulada: true, message_id: null }),
      }),
    ),
  );
  montar();
  expect(await screen.findByTestId("responder-em-privado")).toBeDisabled();
  expect(screen.queryByTestId("simulada-substituivel")).not.toBeInTheDocument();
});

// O mesmo defeito do item 1.1, na ocultação: a simulada não trava a de verdade.
it("⭐ ocultação simulada + conexão em modo real: Ocultar volta a ser oferecido e chama a rota", async () => {
  const oculta = { quando: new Date().toISOString(), quem: QUEM, simulada: true };
  h.get.mockResolvedValue(pagina(comentario({ modo_do_canal: "real", hidden: oculta })));
  h.post.mockResolvedValue({ data: { simulada: false } });
  montar();
  const ocultar = await screen.findByTestId("ocultar-comentario");
  expect(ocultar).toBeEnabled();
  fireEvent.click(ocultar);
  fireEvent.click(await screen.findByTestId("confirmar-ocultar"));
  await vi.waitFor(() => expect(h.post).toHaveBeenCalledWith("/api/v1/social-comments/c1/hide", {}));
  await vi.waitFor(() => expect(h.sucesso).toHaveBeenCalledWith("Comentário ocultado no Instagram."));
});

it("⭐ ocultação simulada em registro (ou sem modo conhecido) e ocultação de verdade: Ocultar segue desligado", async () => {
  const casos: [string | null, boolean][] = [
    ["registrar", true],
    ["off", true],
    [null, true],
    ["real", false],
  ];
  for (const [modo, simulada] of casos) {
    cleanup();
    h.get.mockResolvedValue(
      pagina(comentario({ modo_do_canal: modo, hidden: { quando: new Date().toISOString(), quem: QUEM, simulada } })),
    );
    montar();
    expect(await screen.findByTestId("ocultar-comentario")).toBeDisabled();
  }
});

// Item 2.25.
it("⭐ os botões de cada cartão dizem de quem é o comentário no nome acessível", async () => {
  h.get.mockResolvedValue(
    pagina(comentario(), comentario({ id: "c2", author: { id: "24", username: "outra.pessoa" } }), comentario({ id: "c3", author: { id: null, username: null } })),
  );
  montar();
  const cartoes = await screen.findAllByTestId("comentario");
  expect(within(cartoes[0]!).getByRole("button", { name: "Responder — @cliente.exemplo" })).toBeInTheDocument();
  expect(within(cartoes[0]!).getByRole("button", { name: "Responder em privado — @cliente.exemplo" })).toBeInTheDocument();
  expect(within(cartoes[0]!).getByRole("button", { name: "Ocultar — @cliente.exemplo" })).toBeInTheDocument();
  expect(within(cartoes[0]!).getByRole("button", { name: "Ignorar — @cliente.exemplo" })).toBeInTheDocument();
  expect(within(cartoes[1]!).getByRole("button", { name: "Responder — @outra.pessoa" })).toBeInTheDocument();
  expect(within(cartoes[2]!).getByRole("button", { name: "Responder — Autor não informado" })).toBeInTheDocument();
  // O texto visível continua curto.
  expect(within(cartoes[0]!).getByTestId("responder-em-publico")).toHaveTextContent(/^Responder$/);
});

it("⭐ o campo da resposta tem o mesmo teto de tamanho que a rota aceita", async () => {
  expect(TETO_DO_TEXTO_DA_RESPOSTA).toBe(TETO_DE_TRANSPORTE_DO_TEXTO);
  h.get.mockResolvedValue(pagina(comentario()));
  montar();
  fireEvent.click(await screen.findByTestId("responder-em-publico"));
  expect(await screen.findByLabelText("Sua resposta")).toHaveAttribute("maxlength", String(TETO_DE_TRANSPORTE_DO_TEXTO));
});

it("⭐ dois cliques em Enviar mandam UMA resposta", async () => {
  h.get.mockResolvedValue(pagina(comentario()));
  let soltar: (v: unknown) => void = () => undefined;
  h.post.mockReturnValue(new Promise((resolve) => (soltar = resolve)));
  montar();
  fireEvent.click(await screen.findByTestId("responder-em-publico"));
  fireEvent.change(await screen.findByLabelText("Sua resposta"), { target: { value: "Olá!" } });
  const enviar = screen.getByTestId("enviar-resposta");
  fireEvent.click(enviar);
  fireEvent.click(enviar);
  await vi.waitFor(() => expect(enviar).toBeDisabled());
  fireEvent.click(enviar);
  expect(h.post).toHaveBeenCalledTimes(1);
  soltar({ data: { simulada: true } });
  await vi.waitFor(() => expect(h.sucesso).toHaveBeenCalledTimes(1));
  expect(h.post).toHaveBeenCalledTimes(1);
});

it("⭐ dois cliques na confirmação de Ocultar mandam UMA chamada, e a confirmação fica desligada enquanto envia", async () => {
  h.get.mockResolvedValue(pagina(comentario()));
  let soltar: (v: unknown) => void = () => undefined;
  h.post.mockReturnValue(new Promise((resolve) => (soltar = resolve)));
  montar();
  fireEvent.click(await screen.findByTestId("ocultar-comentario"));
  const confirmar = await screen.findByTestId("confirmar-ocultar");
  fireEvent.click(confirmar);
  fireEvent.click(confirmar);
  await vi.waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
  soltar({ data: { simulada: false } });
  await vi.waitFor(() => expect(h.sucesso).toHaveBeenCalledWith("Comentário ocultado no Instagram."));
  expect(h.post).toHaveBeenCalledTimes(1);
});

it("⭐ dois cliques em Marcar como sem ação mandam UMA chamada", async () => {
  h.get.mockResolvedValue(pagina(comentario()));
  let soltar: (v: unknown) => void = () => undefined;
  h.post.mockReturnValue(new Promise((resolve) => (soltar = resolve)));
  montar();
  fireEvent.click(await screen.findByTestId("ignorar-comentario"));
  const confirmar = await screen.findByTestId("confirmar-ignorar");
  fireEvent.click(confirmar);
  fireEvent.click(confirmar);
  await vi.waitFor(() => expect(confirmar).toBeDisabled());
  expect(h.post).toHaveBeenCalledTimes(1);
  soltar({ data: {} });
  await vi.waitFor(() => expect(h.sucesso).toHaveBeenCalledWith("Comentário marcado como sem ação."));
  expect(h.post).toHaveBeenCalledTimes(1);
});

it("⭐ recusa por papel (403) vira o estado de sem permissão, não um erro cru", async () => {
  h.get.mockRejectedValue(Object.assign(new Error("forbidden"), { status: 403, code: "forbidden" }));
  montar();
  const aviso = await screen.findByTestId("comentarios-sem-permissao");
  expect(aviso).toHaveTextContent("Você não tem permissão para ver os comentários desta empresa.");
  expect(aviso).toHaveTextContent(/gerentes e administradores/);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByTestId("comentarios-vazio")).not.toBeInTheDocument();
});
