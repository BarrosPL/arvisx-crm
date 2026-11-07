import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cena = vi.hoisted(() => ({
  B: "00000000-0000-4000-8000-00000000000b",
  C: "00000000-0000-4000-8000-00000000000c",
  D: "00000000-0000-4000-8000-00000000000d",
  papel: "admin" as "admin" | "agent",
  status: {} as Record<string, string>,
  statusNaSessao: undefined as string | undefined,
  falhaNaLeitura: false,
  suporte: "suporte@revenda.test",
  platformAdmin: false,
  modoSuporte: null as { reason: string } | null,
  semOrgAtiva: false,
  motivo: {} as Record<string, string | null>,
  // Pedidos de LGPD em aberto por organização (o que a consulta conta).
  lgpdAbertos: {} as Record<string, number>,
  falhaNaLgpd: false,
  consultasLgpd: [] as Array<{ org: string; filtro: string }>,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((destino: string) => {
    throw new Error(`NEXT_REDIRECT:${destino}`);
  }),
}));
vi.mock("@/lib/auth/server", () => ({
  requireAuth: async () => ({
    id: "11111111-1111-4111-8111-111111111111",
    email: "admin@empresa.test",
    is_platform_admin: cena.platformAdmin,
    support: cena.modoSuporte,
    idioma: "pt-BR",
    organizations: [
      { organization_id: cena.B, organization_name: "Empresa B", role: cena.papel },
      { organization_id: cena.C, organization_name: "Empresa C", role: "admin" },
      { organization_id: cena.D, organization_name: "Empresa D", role: "admin" },
    ],
  }),
  // A régua da SESSÃO (o embed de `loadAuthUser`), que é a do `resolveActiveOrg`
  // do layout; `statusNaSessao` só difere do banco no caso da divergência.
  orgAtivaSemPortao: async () => cena.semOrgAtiva ? null : ({
    orgId: cena.B, name: "Empresa B", role: cena.papel,
    org_status: cena.statusNaSessao ?? cena.status[cena.B],
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) =>
      tabela === "lgpd_requests"
        ? {
            // A contagem de `temPedidoDaLgpdEmAberto`: org e filtro de status ficam registrados.
            select: () => ({
              eq: (_coluna: string, org: string) => ({
                not: async (_c: string, _op: string, filtro: string) => {
                  cena.consultasLgpd.push({ org, filtro });
                  return cena.falhaNaLgpd
                    ? { count: null, error: { message: "rede" } }
                    : { count: cena.lgpdAbertos[org] ?? 0, error: null };
                },
              }),
            }),
          }
        : {
            select: () => ({
              in: async (_coluna: string, ids: string[]) =>
                cena.falhaNaLeitura
                  ? { data: null, error: { message: "rede" } }
                  : {
                      data: ids.map((id) => ({
                        id,
                        status: cena.status[id] ?? "active",
                        suspended_kind: null,
                        suspended_reason: cena.motivo[id] ?? null,
                      })),
                      error: null,
                    },
            }),
          },
  }),
}));
vi.mock("@/lib/branding/saida", () => ({
  emailDeSuporte: async () => cena.suporte,
  marcaDaSaida: async () => ({ nome: "ArvisX CRM", logoUrl: null }),
}));
vi.mock("@/app/actions/auth/signOut", () => ({ signOut: vi.fn() }));
vi.mock("@/app/app/lgpd/requests/RequestsTable", () => ({
  RequestsTable: ({ baseDoPedido }: { baseDoPedido?: string }) => <p data-testid="lgpd-lista">{baseDoPedido}</p>,
}));
vi.mock("@/app/app/lgpd/requests/[id]/_client", () => ({
  LgpdRequestDetail: ({ id, hrefDaLista }: { id: string; hrefDaLista?: string }) => (
    <p data-testid="lgpd-pedido">{`${id} ${hrefDaLista}`}</p>
  ),
}));
vi.mock("@/app/onboarding/_components/OutrasOrganizacoes", () => ({
  OutrasOrganizacoes: ({ outras }: { outras: Array<{ id: string; nome: string }> }) => (
    <p data-testid="outras">{outras.map((o) => o.nome).join(",")}</p>
  ),
}));

import AccountSuspendedPage from "./page";

async function montar(pedido?: string) {
  return render(await AccountSuspendedPage({ searchParams: Promise.resolve(pedido ? { pedido } : {}) }));
}

beforeEach(() => {
  cena.papel = "admin";
  cena.status = { [cena.B]: "suspended", [cena.C]: "active", [cena.D]: "suspended" };
  cena.statusNaSessao = undefined;
  cena.falhaNaLeitura = false;
  cena.suporte = "suporte@revenda.test";
  cena.platformAdmin = false;
  cena.modoSuporte = null;
  cena.semOrgAtiva = false;
  cena.motivo = {};
  cena.lgpdAbertos = { [cena.B]: 2 };
  cena.falhaNaLgpd = false;
  cena.consultasLgpd = [];
});

describe("/account-suspended: o hub de quem está numa empresa suspensa", () => {
  it("diz QUAL empresa está suspensa — quem participa de várias não fica na dúvida", async () => {
    await montar();
    const titulo = screen.getByRole("heading", { level: 1, name: "Conta suspensa" });
    expect(titulo.nextElementSibling).toHaveTextContent("Empresa B");
    expect(screen.getByTestId("outras")).not.toHaveTextContent("Empresa B");
  });

  it("empresa que opera não fica presa aqui: volta para /app", async () => {
    cena.status[cena.B] = "active";
    await expect(montar()).rejects.toThrow("NEXT_REDIRECT:/app");
  });

  // Acabamento 7: o e-mail de prazo mandado com a empresa parada aponta para
  // cá; se ela voltou a operar antes do clique, o pedido não pode se perder.
  it("empresa que opera com ?pedido= volta direto ao pedido, não à home", async () => {
    cena.status[cena.B] = "active";
    const id = "22222222-2222-4222-8222-222222222222";
    await expect(montar(id)).rejects.toThrow(`NEXT_REDIRECT:/app/lgpd/requests/${id}`);
  });

  it("empresa que opera com ?pedido= que não é uuid volta para /app", async () => {
    cena.status[cena.B] = "active";
    await expect(montar("../admin")).rejects.toThrow(/^NEXT_REDIRECT:\/app$/);
  });

  // Review Focus 2: o layout de /app manda para cá se QUALQUER das duas réguas
  // (sessão ou leitura do banco) diz parada; o hub só devolve para /app quando
  // AS DUAS dizem que opera. Sem isso, a divergência vira laço de 307.
  it.each([
    ["sessão diz parada, banco diz ativa", "suspended", "active"],
    ["sessão diz ativa, banco diz parada", "active", "suspended"],
  ])("%s → renderiza o hub, sem redirect", async (_nome, naSessao, noBanco) => {
    cena.statusNaSessao = naSessao;
    cena.status[cena.B] = noBanco;
    await montar();
    expect(screen.getByRole("heading", { name: "Conta suspensa" })).toBeVisible();
  });

  it("admin vê o suporte, a LGPD abrindo no próprio hub e só as empresas que operam", async () => {
    await montar();
    expect(screen.getByRole("heading", { name: "Conta suspensa" })).toBeVisible();
    expect(screen.getByRole("link", { name: "suporte@revenda.test" })).toHaveAttribute("href", "mailto:suporte@revenda.test");
    expect(screen.getByTestId("lgpd-lista")).toHaveTextContent("/account-suspended?pedido=");
    expect(screen.getByTestId("outras")).toHaveTextContent(/^Empresa C$/);
  });

  it("sem SUPPORT_EMAIL, quem administra é mandado a quem administra o sistema, sem link, e a LGPD segue", async () => {
    cena.suporte = "";
    await montar();
    expect(
      screen.getByText("Sua conta está suspensa. Fale com quem administra este sistema para saber o motivo e como reativá-la."),
    ).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("lgpd-lista")).toBeVisible();
  });

  it("dono da plataforma com papel de atendente vê o painel de admin", async () => {
    cena.papel = "agent";
    cena.platformAdmin = true;
    await montar();
    expect(screen.getByTestId("lgpd-lista")).toBeVisible();
    expect(screen.getByRole("link", { name: "suporte@revenda.test" })).toBeVisible();
  });

  it("dono da plataforma em modo suporte, com papel de atendente, não administra", async () => {
    cena.papel = "agent";
    cena.platformAdmin = true;
    cena.modoSuporte = { reason: "acompanhamento" };
    await montar();
    expect(screen.getByText("Sua conta está suspensa. Avise o administrador da sua empresa.")).toBeVisible();
    expect(screen.queryByTestId("lgpd-lista")).toBeNull();
  });

  it("sem empresa ativa não há o que mostrar: vai para /app", async () => {
    cena.semOrgAtiva = true;
    await expect(montar()).rejects.toThrow(/^NEXT_REDIRECT:\/app$/);
  });

  it("quem não administra é mandado ao administrador, sem LGPD e sem o endereço do suporte", async () => {
    cena.papel = "agent";
    await montar();
    expect(screen.getByText("Sua conta está suspensa. Avise o administrador da sua empresa.")).toBeVisible();
    expect(screen.queryByTestId("lgpd-lista")).toBeNull();
    expect(screen.queryByRole("link", { name: "suporte@revenda.test" })).toBeNull();
  });

  it("?pedido= com uuid abre o detalhe no hub", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    await montar(id);
    expect(screen.getByTestId("lgpd-pedido")).toHaveTextContent(`${id} /account-suspended`);
  });

  it("?pedido= que não é uuid cai na lista", async () => {
    await montar("../app/inbox");
    expect(screen.getByTestId("lgpd-lista")).toBeVisible();
    expect(screen.queryByTestId("lgpd-pedido")).toBeNull();
  });

  it("'Sair' encerra a sessão: é um botão de envio dentro de um form, não um link para /login", async () => {
    await montar();
    const sair = screen.getByRole("button", { name: "Sair" });
    expect(sair).toHaveAttribute("type", "submit");
    expect(sair.closest("form")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Sair" })).toBeNull();
  });

  it("leitura do estado que falha LANÇA: nem hub nem redirect por palpite", async () => {
    cena.falhaNaLeitura = true;
    await expect(montar()).rejects.toThrow(/account_suspended_status_indisponivel/);
  });

  describe("o motivo da suspensão", () => {
    it("mostra o motivo digitado por quem suspendeu, para quem administra", async () => {
      cena.motivo[cena.B] = "Contrato encerrado em 31/10. Fale com o financeiro.";
      await montar();
      expect(screen.getByText("Motivo da suspensão")).toBeVisible();
      expect(screen.getByTestId("motivo-da-suspensao")).toHaveTextContent(
        "Contrato encerrado em 31/10. Fale com o financeiro.",
      );
    });

    it("mostra o motivo também para quem não administra", async () => {
      cena.papel = "agent";
      cena.motivo[cena.B] = "Uso fora dos termos de serviço.";
      await montar();
      expect(screen.getByTestId("motivo-da-suspensao")).toHaveTextContent("Uso fora dos termos de serviço.");
      expect(screen.getByText("Sua conta está suspensa. Avise o administrador da sua empresa.")).toBeVisible();
    });

    it("é o motivo da empresa ATIVA, nunca o de outra empresa da pessoa", async () => {
      cena.motivo[cena.D] = "Motivo da empresa D";
      await montar();
      expect(screen.queryByTestId("motivo-da-suspensao")).toBeNull();
      expect(screen.queryByText("Motivo da empresa D")).toBeNull();
    });

    it("sem motivo (vazio ou só espaços), fica o texto genérico", async () => {
      cena.suporte = "";
      cena.motivo[cena.B] = "   ";
      await montar();
      expect(screen.queryByTestId("motivo-da-suspensao")).toBeNull();
      expect(
        screen.getByText("Sua conta está suspensa. Fale com quem administra este sistema para saber o motivo e como reativá-la."),
      ).toBeVisible();
    });

    it("com motivo e sem e-mail de suporte, o texto não manda perguntar o motivo", async () => {
      cena.suporte = "";
      cena.motivo[cena.B] = "Pedido do cliente.";
      await montar();
      expect(screen.getByText("Sua conta está suspensa. Fale com quem administra este sistema para reativá-la.")).toBeVisible();
    });

    it("HTML no motivo sai como texto, sem virar elemento", async () => {
      const bruto = `<img src=x onerror="alert(1)"><b>negrito</b>`;
      cena.motivo[cena.B] = bruto;
      const { container } = await montar();
      expect(screen.getByTestId("motivo-da-suspensao").textContent).toBe(bruto);
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("b")).toBeNull();
    });

    it("motivo longo é cortado no teto de 500 caracteres", async () => {
      cena.motivo[cena.B] = "a".repeat(800);
      await montar();
      const exibido = screen.getByTestId("motivo-da-suspensao").textContent ?? "";
      expect(exibido).toBe(`${"a".repeat(500)}…`);
    });
  });

  describe("a seção de LGPD só com pedido em aberto", () => {
    it("com pedido em aberto, quem administra vê a lista", async () => {
      cena.lgpdAbertos = { [cena.B]: 1 };
      await montar();
      expect(screen.getByRole("heading", { name: "Solicitações LGPD" })).toBeVisible();
      expect(screen.getByTestId("lgpd-lista")).toBeVisible();
    });

    it("sem pedido em aberto, a seção não aparece: só o cartão", async () => {
      cena.lgpdAbertos = {};
      await montar();
      expect(screen.queryByRole("heading", { name: "Solicitações LGPD" })).toBeNull();
      expect(screen.queryByTestId("lgpd-lista")).toBeNull();
      expect(screen.getByRole("button", { name: "Sair" })).toBeVisible();
      expect(screen.getByTestId("outras")).toBeVisible();
    });

    it("a contagem é da org da SESSÃO e exclui só os status terminais da lista", async () => {
      await montar();
      expect(cena.consultasLgpd).toEqual([{ org: cena.B, filtro: "(completed,failed)" }]);
    });

    it("quem não administra nunca vê a seção, mesmo com pedido em aberto, e nem consulta", async () => {
      cena.papel = "agent";
      cena.lgpdAbertos = { [cena.B]: 3 };
      await montar();
      expect(screen.queryByRole("heading", { name: "Solicitações LGPD" })).toBeNull();
      expect(cena.consultasLgpd).toEqual([]);
    });

    it("?pedido= abre o detalhe mesmo sem pedido em aberto na contagem", async () => {
      cena.lgpdAbertos = {};
      const id = "22222222-2222-4222-8222-222222222222";
      await montar(id);
      expect(screen.getByTestId("lgpd-pedido")).toHaveTextContent(`${id} /account-suspended`);
    });

    it("?pedido= para quem não administra não abre nada", async () => {
      cena.papel = "agent";
      await montar("22222222-2222-4222-8222-222222222222");
      expect(screen.queryByTestId("lgpd-pedido")).toBeNull();
      expect(screen.queryByTestId("lgpd-lista")).toBeNull();
    });

    it("contagem que falha mostra a seção: prazo legal não some por erro de leitura", async () => {
      cena.falhaNaLgpd = true;
      await montar();
      expect(screen.getByTestId("lgpd-lista")).toBeVisible();
    });
  });
});
