// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { descartarContaSemEmpresa } from "@/lib/auth/cadastro-recusado";
import type * as CadastroRecusado from "@/lib/auth/cadastro-recusado";
import { EmailNaoConfirmadoError } from "@/lib/auth/email-confirmado";
import { ensureTenantForUser } from "@/lib/auth/provision";
import { createClient } from "@/lib/supabase/server";

/**
 * /auth/confirm — AS DUAS RECUSAS DA AUDITORIA DE 11/11/2026.
 *
 * 1. Sem e-mail confirmado pelo provedor a empresa não nasce
 *    (`ensureTenantForUser` levanta `EmailNaoConfirmadoError`): é recusa
 *    auditada, e a pessoa vai para `/get-started`, que diz o que falta.
 *
 * 2. O plano que a conta trouxe foi recusado pelo gatilho da cobrança
 *    (`plano_obrigatorio`). A tela de cadastro confere o plano antes de criar a
 *    conta; esta é a conta que nasceu por fora dela. Antes ficava um login
 *    confirmado, com sessão e sem empresa. Agora a conta é apagada e a sessão
 *    encerrada — e só quando é seguro apagar.
 */

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/aplicar-convite", () => ({ aplicarConvite: vi.fn() }));
vi.mock("@/lib/auth/convite-no-signup", () => ({ decidirConviteDoSignup: vi.fn(() => ({ tipo: "provisionar" })) }));
vi.mock("@/lib/auth/provision", () => ({ ensureTenantForUser: vi.fn() }));
vi.mock("@/lib/auth/cadastro-recusado", async (original) => ({
  ...(await original<typeof CadastroRecusado>()),
  descartarContaSemEmpresa: vi.fn(),
}));
vi.mock("@/lib/auth/politica-de-cadastro", () => ({ modoDeCadastro: vi.fn(async () => "aberto") }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "http://localhost:3000" } }));

const PLANO = "99999999-9999-4999-8999-999999999999";
const sair = vi.fn(async (_: unknown) => ({ error: null }));

function comConta(user_metadata: Record<string, unknown>) {
  const usuario = { id: "11111111-1111-4111-8111-111111111111", email: "novo@exemplo.test", user_metadata };
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      verifyOtp: vi.fn(async () => ({ data: { user: usuario }, error: null })),
      exchangeCodeForSession: vi.fn(),
      getUser: vi.fn(async () => ({ data: { user: usuario } })),
      signOut: sair,
    },
  } as never);
  return usuario;
}

async function confirmar(): Promise<string> {
  const { POST } = await import("@/app/auth/confirm/route");
  const res = await POST(
    new NextRequest("http://localhost:3000/auth/confirm", {
      method: "POST",
      body: new URLSearchParams("token_hash=abc&type=signup"),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }),
  );
  const destino = new URL(res.headers.get("location") ?? "");
  return destino.pathname + destino.search;
}

const auditados = () => vi.mocked(audit).mock.calls.map(([a]) => ({ action: a.action, metadata: a.metadata }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureTenantForUser).mockResolvedValue({ provisioned: true, organizationId: "org-1" });
  vi.mocked(descartarContaSemEmpresa).mockResolvedValue("apagada");
});

describe("sem e-mail confirmado", () => {
  it("⭐ a recusa do provisionamento é auditada como recusa e leva a /get-started; a conta NÃO é apagada", async () => {
    comConta({ org_name: "Empresa de Fachada" });
    vi.mocked(ensureTenantForUser).mockRejectedValue(new EmailNaoConfirmadoError());

    expect(await confirmar()).toBe("/get-started");
    expect(auditados()).toContainEqual({
      action: "auth.signup_provision_recusado",
      metadata: { motivo: "email_nao_confirmado" },
    });
    expect(descartarContaSemEmpresa).not.toHaveBeenCalled();
    expect(sair).not.toHaveBeenCalled();
  });
});

describe("plano recusado pelo gatilho da cobrança", () => {
  const recusa = () => new Error("signup provisioning: org insert failed: plano_obrigatorio");

  it("⭐ a conta que trouxe o plano é apagada, a sessão encerrada, e o login explica", async () => {
    const usuario = comConta({ org_name: "Empresa", cobranca_plan_id: PLANO });
    vi.mocked(ensureTenantForUser).mockRejectedValue(recusa());

    expect(await confirmar()).toBe("/login?error=plano_indisponivel");
    expect(descartarContaSemEmpresa).toHaveBeenCalledWith(usuario.id);
    expect(sair).toHaveBeenCalledWith({ scope: "local" });
    expect(auditados()).toContainEqual({
      action: "auth.signup_provision_recusado",
      metadata: { motivo: "plano_indisponivel", conta: "apagada" },
    });
  });

  it("o mesmo para plano_invalido", async () => {
    comConta({ cobranca_plan_id: PLANO });
    vi.mocked(ensureTenantForUser).mockRejectedValue(new Error("org insert failed: plano_invalido"));
    expect(await confirmar()).toBe("/login?error=plano_indisponivel");
  });

  it.each(["mantida", "falhou"] as const)(
    "quando a conta não pôde ser apagada (%s), o caminho de antes continua: /get-started, com a sessão",
    async (descarte) => {
      comConta({ cobranca_plan_id: PLANO });
      vi.mocked(ensureTenantForUser).mockRejectedValue(recusa());
      vi.mocked(descartarContaSemEmpresa).mockResolvedValue(descarte);

      expect(await confirmar()).toBe("/get-started");
      expect(sair).not.toHaveBeenCalled();
      expect(auditados()).toContainEqual({
        action: "auth.signup_provision_recusado",
        metadata: { motivo: "plano_indisponivel", conta: descarte },
      });
    },
  );

  it("conta SEM plano na metadata (anterior à cobrança): não é apagada, escolhe o plano em /get-started", async () => {
    comConta({ org_name: "Empresa Antiga" });
    vi.mocked(ensureTenantForUser).mockRejectedValue(recusa());

    expect(await confirmar()).toBe("/get-started");
    expect(descartarContaSemEmpresa).not.toHaveBeenCalled();
    expect(auditados()).toContainEqual({
      action: "auth.signup_provision_failed",
      metadata: { reason: "signup provisioning: org insert failed: plano_obrigatorio" },
    });
  });

  it("CONTROLE: falha que não é do plano (banco fora) nunca apaga ninguém", async () => {
    comConta({ cobranca_plan_id: PLANO });
    vi.mocked(ensureTenantForUser).mockRejectedValue(new Error("signup provisioning: org insert failed: timeout"));

    expect(await confirmar()).toBe("/get-started");
    expect(descartarContaSemEmpresa).not.toHaveBeenCalled();
    expect(sair).not.toHaveBeenCalled();
  });

  it("CONTROLE: o cadastro que dá certo segue para o onboarding", async () => {
    comConta({ cobranca_plan_id: PLANO });
    expect(await confirmar()).toBe("/onboarding/welcome");
    expect(descartarContaSemEmpresa).not.toHaveBeenCalled();
  });
});
