/**
 * O atalho do Inbox para os Comentários do Instagram: só para quem pode usar a
 * tela e só quando há conexão direta com a Meta. Fora disso não desenha nada —
 * é o que mantém a coluna da lista como era para todo o resto.
 */
import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  papel: "manager" as string,
  plataforma: false,
  suporte: false,
  sessoes: undefined as unknown[] | undefined,
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { is_platform_admin: h.plataforma, support: h.suporte }, activeOrg: { role: h.papel } }),
}));
vi.mock("@/hooks/channels/useChannelSessions", () => ({ useChannelSessions: () => ({ data: h.sessoes }) }));

import { CHANNEL_PROVIDER_SOCIAL_DIRETO, DEFAULT_CHANNEL_PROVIDER } from "@/lib/channels/capabilities";

import { AtalhoDosComentarios } from "./AtalhoDosComentarios";

const DIRETA = { id: "s1", provider: CHANNEL_PROVIDER_SOCIAL_DIRETO };
const POR_QR = { id: "s2", provider: DEFAULT_CHANNEL_PROVIDER };

beforeEach(() => {
  cleanup();
  h.papel = "manager";
  h.plataforma = false;
  h.suporte = false;
  h.sessoes = [POR_QR, DIRETA];
});

it.each(["manager", "admin"])("%s com conexão direta vê o atalho para a tela", (papel) => {
  h.papel = papel;
  render(<AtalhoDosComentarios />);
  expect(screen.getByRole("link", { name: "Comentários do Instagram" })).toHaveAttribute(
    "href",
    "/app/inbox/comentarios",
  );
});

it.each(["agent", "viewer"])("%s não vê o atalho: a tela é de gerente para cima", (papel) => {
  h.papel = papel;
  const { container } = render(<AtalhoDosComentarios />);
  expect(container).toBeEmptyDOMElement();
});

// Revisão de 20/11, item 2.25: as rotas exigem papel de gerente NA EMPRESA, e
// administrar a plataforma não o dá. O atalho levaria a uma tela que só recusa.
it.each(["agent", "viewer"])("quem administra a plataforma com papel %s na empresa não vê o atalho", (papel) => {
  h.plataforma = true;
  h.papel = papel;
  const { container } = render(<AtalhoDosComentarios />);
  expect(container).toBeEmptyDOMElement();
});

it("quem administra a plataforma E é gerente da empresa vê o atalho, pelo papel na empresa", () => {
  h.plataforma = true;
  h.papel = "manager";
  render(<AtalhoDosComentarios />);
  expect(screen.getByRole("link", { name: "Comentários do Instagram" })).toBeInTheDocument();
});

it("sem conexão direta com a Meta, não desenha nada", () => {
  h.sessoes = [POR_QR];
  const { container } = render(<AtalhoDosComentarios />);
  expect(container).toBeEmptyDOMElement();
});

it("enquanto a lista de conexões não chegou, não desenha nada", () => {
  h.sessoes = undefined;
  const { container } = render(<AtalhoDosComentarios />);
  expect(container).toBeEmptyDOMElement();
});
