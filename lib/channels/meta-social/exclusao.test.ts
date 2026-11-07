/**
 * O callback de exclusão de dados da Meta: o `signed_request` só vale com a
 * assinatura do App Secret, e o código de confirmação não pode ser forjado.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { codigoDeConfirmacao, lerCodigoDeConfirmacao, lerSignedRequest } from "./exclusao";

const APP_SECRET = "0123456789abcdef0123456789abcdef";
const INTERNO = "segredo-interno-com-mais-de-16-caracteres";

function assinado(carga: Record<string, unknown>, segredo = APP_SECRET): string {
  const corpo = Buffer.from(JSON.stringify(carga)).toString("base64url");
  const sig = createHmac("sha256", segredo).update(corpo).digest().toString("base64url");
  return `${sig}.${corpo}`;
}

describe("signed_request da Meta", () => {
  it("assinatura certa: devolve o id da pessoa no app", () => {
    expect(lerSignedRequest(assinado({ algorithm: "HMAC-SHA256", user_id: "10203040", issued_at: 1 }), APP_SECRET)).toEqual({
      userId: "10203040",
      emitidoEm: 1,
    });
  });

  it("assinatura de outro segredo, carga trocada ou formato ruim: recusa", () => {
    expect(lerSignedRequest(assinado({ user_id: "1" }, "outro-segredo-qualquer-123456"), APP_SECRET)).toBeNull();
    const [sig] = assinado({ user_id: "1" }).split(".");
    const outraCarga = Buffer.from(JSON.stringify({ user_id: "2" })).toString("base64url");
    expect(lerSignedRequest(`${sig}.${outraCarga}`, APP_SECRET)).toBeNull();
    expect(lerSignedRequest("sem-ponto", APP_SECRET)).toBeNull();
    expect(lerSignedRequest(assinado({ user_id: "1" }), null)).toBeNull();
    expect(lerSignedRequest(assinado({ algorithm: "HMAC-SHA1", user_id: "1" }), APP_SECRET)).toBeNull();
    expect(lerSignedRequest(assinado({ user_id: "abc" }), APP_SECRET)).toBeNull();
  });
});

describe("código de confirmação", () => {
  it("ida e volta: a página de status lê a hora e a contagem", () => {
    const recebidoEm = new Date("2026-11-07T15:30:00Z");
    const codigo = codigoDeConfirmacao({ recebidoEm, conexoes: 2 }, INTERNO);
    expect(lerCodigoDeConfirmacao(codigo, INTERNO)).toEqual({ recebidoEm, conexoes: 2 });
  });

  it("código alterado ou de outra instalação não vale", () => {
    const codigo = codigoDeConfirmacao({ recebidoEm: new Date(), conexoes: 1 }, INTERNO);
    const [t, , resto] = [codigo.slice(0, codigo.indexOf("-")), null, codigo.slice(codigo.indexOf("-", codigo.indexOf("-") + 1))];
    expect(lerCodigoDeConfirmacao(`${t}-9${resto}`, INTERNO)).toBeNull();
    expect(lerCodigoDeConfirmacao(codigo, "outro-segredo-interno-123456")).toBeNull();
    expect(lerCodigoDeConfirmacao("qualquer-coisa", INTERNO)).toBeNull();
  });
});
