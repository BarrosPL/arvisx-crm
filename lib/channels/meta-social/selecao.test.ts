/**
 * O lacre da escolha da página: o token de usuário viaja pelo navegador sem ser
 * legível, e só abre para a MESMA organização e a MESMA pessoa, dentro do prazo.
 */
import { describe, expect, it } from "vitest";

import { abrirSelecao, lacrarSelecao, VALIDADE_DA_SELECAO_MS } from "./selecao";

const SEGREDO = "segredo-interno-com-mais-de-16-caracteres";
const AGORA = new Date("2026-11-07T12:00:00Z");
const DONO = { organizationId: "org-a", userId: "user-a" };

function lacre() {
  return lacrarSelecao(
    { ...DONO, tokenDoUsuario: "EAAB-token-secreto", metaUserId: "123456" },
    { segredo: SEGREDO, agora: AGORA },
  );
}

describe("lacre da seleção", () => {
  it("abre para o mesmo dono e devolve o token", () => {
    expect(abrirSelecao(lacre(), DONO, { segredo: SEGREDO, agora: AGORA })).toEqual({
      tokenDoUsuario: "EAAB-token-secreto",
      metaUserId: "123456",
    });
  });

  it("o token não aparece em claro no lacre", () => {
    expect(lacre()).not.toContain("EAAB");
    expect(Buffer.from(lacre(), "base64url").toString("utf8")).not.toContain("EAAB-token-secreto");
  });

  it("outra organização ou outra pessoa: não abre (isolamento)", () => {
    const l = lacre();
    expect(abrirSelecao(l, { organizationId: "org-b", userId: "user-a" }, { segredo: SEGREDO, agora: AGORA })).toBeNull();
    expect(abrirSelecao(l, { organizationId: "org-a", userId: "user-b" }, { segredo: SEGREDO, agora: AGORA })).toBeNull();
  });

  it("vencido, adulterado ou com outro segredo: não abre", () => {
    const l = lacre();
    const depois = new Date(AGORA.getTime() + VALIDADE_DA_SELECAO_MS + 1);
    expect(abrirSelecao(l, DONO, { segredo: SEGREDO, agora: depois })).toBeNull();
    const bytes = Buffer.from(l, "base64url");
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    expect(abrirSelecao(bytes.toString("base64url"), DONO, { segredo: SEGREDO, agora: AGORA })).toBeNull();
    expect(abrirSelecao(l, DONO, { segredo: "outro-segredo-com-mais-de-16", agora: AGORA })).toBeNull();
    expect(abrirSelecao("curto", DONO, { segredo: SEGREDO, agora: AGORA })).toBeNull();
    expect(abrirSelecao(null, DONO, { segredo: SEGREDO, agora: AGORA })).toBeNull();
  });
});
