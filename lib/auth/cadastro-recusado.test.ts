// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A CONTA DO CADASTRO RECUSADO É APAGADA — E SÓ ELA (auditoria de 11/11/2026).
 *
 * Apagar conta não tem volta. O que este arquivo prova é a metade "só ela":
 * quem já teve empresa, quem pediu uma, quem administra a instalação e
 * qualquer conta cuja leitura falhou ficam.
 */

const h = vi.hoisted(() => ({
  linhas: {} as Record<string, number>,
  erroDeLeitura: null as string | null,
  apagar: vi.fn(async (_: string) => ({ error: null as { message: string } | null })),
  lidas: [] as string[],
}));

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => ({
      select: () => ({
        eq: async (coluna: string, valor: string) => {
          h.lidas.push(`${tabela}.${coluna}=${valor}`);
          if (h.erroDeLeitura === tabela) return { count: null, error: { message: "PostgREST fora" } };
          return { count: h.linhas[tabela] ?? 0, error: null };
        },
      }),
    }),
    auth: { admin: { deleteUser: h.apagar } },
  }),
}));

const CONTA = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.linhas = {};
  h.erroDeLeitura = null;
  h.lidas = [];
  h.apagar.mockReset();
  h.apagar.mockResolvedValue({ error: null });
});

describe("recusaPorPlano", () => {
  it("reconhece as duas recusas do gatilho da cobrança, e mais nada", async () => {
    const { recusaPorPlano } = await import("./cadastro-recusado");
    expect(recusaPorPlano("signup provisioning: org insert failed: plano_obrigatorio")).toBe(true);
    expect(recusaPorPlano("org insert failed: plano_invalido")).toBe(true);
    expect(recusaPorPlano("signup provisioning: org insert failed: timeout")).toBe(false);
    expect(recusaPorPlano("email_nao_confirmado")).toBe(false);
  });
});

describe("descartarContaSemEmpresa", () => {
  it("⭐ conta que nunca teve empresa, pedido nem poder de plataforma: apagada", async () => {
    const { descartarContaSemEmpresa } = await import("./cadastro-recusado");
    expect(await descartarContaSemEmpresa(CONTA)).toBe("apagada");
    expect(h.apagar).toHaveBeenCalledExactlyOnceWith(CONTA);
    // As três conferências olham ESTA conta, pela coluna do dono.
    expect(h.lidas).toEqual([
      `user_organizations.user_id=${CONTA}`,
      `registration_requests.user_id=${CONTA}`,
      `platform_admins.user_id=${CONTA}`,
    ]);
  });

  it.each(["user_organizations", "registration_requests", "platform_admins"])(
    "⭐ conta com linha em %s NUNCA é apagada (vínculo revogado conta como vínculo)",
    async (tabela) => {
      h.linhas[tabela] = 1;
      const { descartarContaSemEmpresa } = await import("./cadastro-recusado");
      expect(await descartarContaSemEmpresa(CONTA)).toBe("mantida");
      expect(h.apagar).not.toHaveBeenCalled();
    },
  );

  it.each(["user_organizations", "registration_requests", "platform_admins"])(
    "⭐ leitura de %s que falhou não é prova de conta descartável: mantida",
    async (tabela) => {
      h.erroDeLeitura = tabela;
      const { descartarContaSemEmpresa } = await import("./cadastro-recusado");
      expect(await descartarContaSemEmpresa(CONTA)).toBe("mantida");
      expect(h.apagar).not.toHaveBeenCalled();
    },
  );

  it("o provedor recusou apagar: `falhou`, sem lançar — quem chama segue pelo caminho de antes", async () => {
    h.apagar.mockResolvedValue({ error: { message: "GoTrue 504" } });
    const { descartarContaSemEmpresa } = await import("./cadastro-recusado");
    expect(await descartarContaSemEmpresa(CONTA)).toBe("falhou");
  });

  it("exceção no meio do caminho também vira `falhou`", async () => {
    h.apagar.mockRejectedValue(new Error("rede"));
    const { descartarContaSemEmpresa } = await import("./cadastro-recusado");
    expect(await descartarContaSemEmpresa(CONTA)).toBe("falhou");
  });
});
