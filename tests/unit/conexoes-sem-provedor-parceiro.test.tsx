// @vitest-environment jsdom
/**
 * Conexões sem "Provedor parceiro", com a aba "Facebook / Instagram" (ArvisX,
 * decisão do dono em 12/11/2026).
 *
 * O cliente não vê mais a conexão do WhatsApp por provedor parceiro. As abas que
 * ficam: Números por QR, API Oficial (Meta), Telefone, Facebook / Instagram e
 * Chamada de voz. A aba que se chamava "Redes sociais" passa a dizer o que ela
 * conecta (Messenger e Instagram, direto pela Meta), e o bloco "Conexão por
 * parceiro" dela fica escondido.
 *
 * O que NÃO pode quebrar, e por isso está aqui:
 *  - `?aba=parceiro` (links antigos e a volta de `app/auth/partner-return`) cai
 *    na aba padrão, em vez de abrir uma tela vazia;
 *  - `?aba=sociais` continua valendo: as voltas de OAuth dependem desse valor;
 *  - com o bloco do parceiro escondido, a tela nem consulta a rota do parceiro.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const cena = vi.hoisted(() => ({ busca: "", chamadas: [] as string[] }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(cena.busca),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: vi.fn(async (url: string) => {
      cena.chamadas.push(`GET ${url}`);
      return { data: {} };
    }),
    post: vi.fn(async (url: string) => {
      cena.chamadas.push(`POST ${url}`);
      return { data: {} };
    }),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

/**
 * Os clientes de cada aba viram marcadores: o que está sob teste é a CASCA
 * (quais abas existem e qual abre), não o formulário de cada canal.
 */
vi.mock("@/components/connections/ConnectionsClient", () => ({ ConnectionsClient: () => <div data-testid="aba-numeros" /> }));
vi.mock("@/components/connections/CanalOficialClient", () => ({ CanalOficialClient: () => <div data-testid="aba-oficial" /> }));
vi.mock("@/components/connections/CanalParceiroClient", () => ({ CanalParceiroClient: () => <div data-testid="aba-parceiro" /> }));
vi.mock("@/components/connections/CanalGraphParceiroClient", () => ({ CanalGraphParceiroClient: () => <div data-testid="aba-graph" /> }));
vi.mock("@/components/connections/CanalVozClient", () => ({ CanalVozClient: () => <div data-testid="aba-voz" /> }));
vi.mock("@/components/connections/TelefoniaClient", () => ({ TelefoniaClient: () => <div data-testid="aba-telefonia" /> }));
vi.mock("@/components/connections/TemplatesClient", () => ({ TemplatesClient: () => <div data-testid="templates-da-meta" /> }));
vi.mock("@/components/connections/TemplatesParceiroClient", () => ({ TemplatesParceiroClient: () => <div data-testid="modelos-do-parceiro" /> }));
vi.mock("@/components/connections/ConexaoDiretaMeta", () => ({ ConexaoDiretaMeta: () => <div data-testid="conexao-direta-meta" /> }));

import { ConexoesShell } from "@/components/connections/ConexoesShell";

function montar(busca = "") {
  cena.busca = busca;
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <ConexoesShell wahaConfigured wacallsConfigured />
    </QueryClientProvider>,
  );
}

const abaAberta = () => screen.getAllByRole("tab").find((a) => a.getAttribute("aria-selected") === "true")?.textContent;

beforeEach(() => {
  cena.busca = "";
  cena.chamadas = [];
});
afterEach(cleanup);

describe("Conexões sem a aba do provedor parceiro", () => {
  it("⭐ as abas são as cinco que o cliente vê, nesta ordem, sem 'Provedor parceiro' nem 'Redes sociais'", () => {
    const { container } = montar();
    expect(screen.getAllByRole("tab").map((a) => a.textContent)).toEqual([
      "Números por QR",
      "API Oficial (Meta)",
      "Telefone",
      "Facebook / Instagram",
      "Chamada de voz",
    ]);
    expect(container.textContent).not.toMatch(/provedor parceiro/i);
    expect(container.textContent).not.toMatch(/Redes sociais/);
    expect(container.textContent).not.toMatch(/Modelos do parceiro/);
  });

  it("⭐ ?aba=parceiro cai em 'Números por QR', com e sem a sub-aba de modelos", () => {
    for (const busca of ["aba=parceiro", "aba=parceiro&sub=templates", "aba=parceiro&parceiro_estado=x&parceiro_conta=y"]) {
      montar(busca);
      expect(abaAberta(), busca).toBe("Números por QR");
      expect(screen.getByTestId("aba-numeros")).toBeTruthy();
      expect(screen.queryByTestId("aba-parceiro")).toBeNull();
      expect(screen.queryByTestId("modelos-do-parceiro")).toBeNull();
      cleanup();
    }
  });

  it("sem ?aba= abre 'Números por QR'; as outras abas continuam abrindo pelo endereço (controle)", () => {
    montar();
    expect(abaAberta()).toBe("Números por QR");
    cleanup();
    for (const [busca, rotulo, marcador] of [
      ["aba=oficial", "API Oficial (Meta)", "aba-oficial"],
      ["aba=telefonia", "Telefone", "aba-telefonia"],
      ["aba=voz", "Chamada de voz", "aba-voz"],
    ] as const) {
      montar(busca);
      expect(abaAberta(), busca).toBe(rotulo);
      expect(screen.getByTestId(marcador)).toBeTruthy();
      cleanup();
    }
  });

  it("⭐ ?aba=sociais abre 'Facebook / Instagram': só a conexão direta pela Meta, sem o bloco do parceiro e sem consultar a rota dele", async () => {
    const { container } = montar("aba=sociais&connected=1");
    expect(abaAberta()).toBe("Facebook / Instagram");
    expect(screen.getByRole("heading", { level: 2, name: "Facebook / Instagram" })).toBeTruthy();
    expect(screen.getByTestId("conexao-direta-meta")).toBeTruthy();
    // A trava de homologação está desligada (13/11/2026): quem avalia o app pela
    // Meta precisa do botão funcionando, e o aviso dizia que ele não funciona.
    expect(screen.queryByTestId("aviso-homologacao-meta")).toBeNull();
    expect(container.textContent).not.toMatch(/Conexão por parceiro/);
    expect(container.textContent).not.toMatch(/Vincular o provedor|Conectar uma rede|Autorizar conta|Carregando/);
    expect(screen.queryByRole("button", { name: "Atualizar" })).toBeNull();
    // Dá tempo de uma consulta ligada disparar: nenhuma chamada à rota do parceiro.
    await new Promise((r) => setTimeout(r, 30));
    expect(cena.chamadas.filter((c) => c.includes("/api/v1/channels/social"))).toEqual([]);
  });
});
