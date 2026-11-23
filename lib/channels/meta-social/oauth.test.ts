/**
 * O login em duas fases (revisão de 20/11/2026, item 2.20).
 *
 * O login normal pede só as permissões de mensagem, as mesmas de antes dos
 * comentários; as duas de comentários só entram no login de reautorização. O
 * que se grava na conexão é o que a pessoa concedeu dentre TODAS as que o
 * produto conhece, para a reconexão pelo login normal não apagar as de
 * comentários.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ graph: vi.fn() }));
vi.mock("./graph", () => ({ chamarGraph: h.graph }));

import {
  ESCOPOS_DA_REAUTORIZACAO_PARA_COMENTARIOS,
  ESCOPOS_DE_COMENTARIOS,
  ESCOPOS_DO_LOGIN,
  escoposConcedidos,
  permissoesNegadas,
  urlDoLogin,
} from "./oauth";

const ENTRADA = { appId: "555", redirectUri: "https://crm.exemplo.com/auth/meta-social-return", estado: "estado" };
const escoposDe = (url: string) => (new URL(url).searchParams.get("scope") ?? "").split(",");

beforeEach(() => {
  h.graph.mockReset();
});

describe("as listas de permissões", () => {
  it("⭐ o login normal é o de antes dos comentários: nenhuma permissão de comentários", () => {
    expect([...ESCOPOS_DO_LOGIN]).toEqual([
      "pages_show_list",
      "pages_messaging",
      "pages_manage_metadata",
      "instagram_basic",
      "instagram_manage_messages",
      "business_management",
    ]);
    for (const e of ESCOPOS_DE_COMENTARIOS) expect(ESCOPOS_DO_LOGIN as readonly string[]).not.toContain(e);
  });

  it("a reautorização pede as do login normal mais as de comentários, sem repetir", () => {
    expect([...ESCOPOS_DA_REAUTORIZACAO_PARA_COMENTARIOS]).toEqual([...ESCOPOS_DO_LOGIN, ...ESCOPOS_DE_COMENTARIOS]);
    expect(new Set(ESCOPOS_DA_REAUTORIZACAO_PARA_COMENTARIOS).size).toBe(ESCOPOS_DA_REAUTORIZACAO_PARA_COMENTARIOS.length);
  });
});

describe("urlDoLogin", () => {
  it("⭐ sem `paraComentarios` (ou com `false`) pede só as do login normal", () => {
    expect(escoposDe(urlDoLogin(ENTRADA))).toEqual([...ESCOPOS_DO_LOGIN]);
    expect(escoposDe(urlDoLogin({ ...ENTRADA, paraComentarios: false }))).toEqual([...ESCOPOS_DO_LOGIN]);
  });

  it("⭐ com `paraComentarios` pede também as duas de comentários", () => {
    expect(escoposDe(urlDoLogin({ ...ENTRADA, paraComentarios: true }))).toEqual([
      ...ESCOPOS_DA_REAUTORIZACAO_PARA_COMENTARIOS,
    ]);
  });

  it("os dois logins mantêm `auth_type=rerequest`", () => {
    for (const paraComentarios of [false, true]) {
      expect(new URL(urlDoLogin({ ...ENTRADA, paraComentarios })).searchParams.get("auth_type")).toBe("rerequest");
    }
  });
});

describe("o que a pessoa concedeu", () => {
  const resposta = (concedidas: string[], negadas: string[] = []) => ({
    data: [
      ...concedidas.map((permission) => ({ permission, status: "granted" })),
      ...negadas.map((permission) => ({ permission, status: "declined" })),
    ],
  });

  it("⭐ as de comentários já concedidas ao app ficam gravadas mesmo num login normal", async () => {
    h.graph.mockResolvedValue(resposta([...ESCOPOS_DO_LOGIN, ...ESCOPOS_DE_COMENTARIOS, "email"]));
    expect(await escoposConcedidos("token", "segredo")).toEqual([...ESCOPOS_DA_REAUTORIZACAO_PARA_COMENTARIOS]);
  });

  it("permissão recusada não entra como concedida", async () => {
    h.graph.mockResolvedValue(resposta([...ESCOPOS_DO_LOGIN], [...ESCOPOS_DE_COMENTARIOS]));
    expect(await escoposConcedidos("token", "segredo")).toEqual([...ESCOPOS_DO_LOGIN]);
  });

  it("⭐ faltar as de comentários nunca aparece como permissão negada do login", async () => {
    h.graph.mockResolvedValue(resposta([...ESCOPOS_DO_LOGIN]));
    expect(await permissoesNegadas("token", "segredo")).toEqual([]);
    h.graph.mockResolvedValue(resposta(["pages_show_list"]));
    const negadas = await permissoesNegadas("token", "segredo");
    expect(negadas).toContain("pages_messaging");
    for (const e of ESCOPOS_DE_COMENTARIOS) expect(negadas).not.toContain(e);
  });
});
