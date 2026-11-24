/**
 * A REGRA DE FECHAR CONVERSA — as duas opções que os caminhos antigos pedem.
 *
 * O caminho padrão (trava de revisão + auditoria na hora) é medido pelos
 * testes de quem o usa: `tests/unit/mcp-fechar-conversa.test.ts` (ferramenta)
 * e `tests/unit/arquivar-conversa.test.ts` (rota `POST [id]/close`). Aqui
 * ficam só as duas opções que existem para o `PATCH` de status e para o marcar
 * contato como pessoal chamarem a regra sem mudar o que sempre fizeram:
 *
 *  - `auditoria: "adiada"`: o módulo fecha e NÃO audita; quem chama audita com
 *    `auditarFechamentoDeConversa`, que escreve a mesma linha;
 *  - `SEM_TRAVA_DE_REVISAO`: `p_expected` nem viaja, e o default da função do
 *    banco (`null`) é "não conferir".
 *
 * E o `codigo` do erro do banco, que o `PATCH` usa para responder 404.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";

import {
  auditarFechamentoDeConversa,
  fecharConversa,
  SEM_TRAVA_DE_REVISAO,
} from "./fechar-conversa";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const ORG = "22222222-2222-4222-8222-222222222222";
const CONVERSA = "44444444-4444-4444-8444-444444444444";
const USUARIO = "11111111-1111-4111-8111-111111111111";

const conversa = { id: CONVERSA, organization_id: ORG, status: "open" };
const ator = { actorUserId: USUARIO, metadata: { via: "teste" } };

function admin(erro: { code?: string; message: string } | null = null) {
  const rpc = vi.fn(async () => ({ data: erro ? null : { ...conversa, status: "closed" }, error: erro }));
  return { rpc } as unknown as Parameters<typeof fecharConversa>[0]["admin"] & { rpc: typeof rpc };
}

const LINHA_DE_AUDITORIA = {
  action: "conversation.closed",
  actorUserId: USUARIO,
  organizationId: ORG,
  resourceType: "conversation",
  resourceId: CONVERSA,
  requestId: "req-1",
  metadata: { via: "teste" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fecharConversa: a trava de revisão", () => {
  it("com a revisão, ela viaja como p_expected", async () => {
    const a = admin();
    await fecharConversa({ admin: a, conversa, revisaoEsperada: 7, requestId: "req-1", ator });
    expect(a.rpc).toHaveBeenCalledWith("fn_service_status", {
      p_org: ORG,
      p_conversation: CONVERSA,
      p_status: "closed",
      p_expected: 7,
    });
  });

  it("SEM_TRAVA_DE_REVISAO: p_expected nem viaja", async () => {
    const a = admin();
    await fecharConversa({
      admin: a,
      conversa,
      revisaoEsperada: SEM_TRAVA_DE_REVISAO,
      requestId: "req-1",
      ator,
    });
    expect(a.rpc).toHaveBeenCalledTimes(1);
    expect(a.rpc.mock.calls[0]).toEqual([
      "fn_service_status",
      { p_org: ORG, p_conversation: CONVERSA, p_status: "closed" },
    ]);
  });
});

describe("fecharConversa: a auditoria", () => {
  it("sem opção, audita na hora quando houve mudança", async () => {
    const desfecho = await fecharConversa({
      admin: admin(),
      conversa,
      revisaoEsperada: 7,
      requestId: "req-1",
      ator,
    });
    expect(desfecho).toMatchObject({ ok: true, mudou: true });
    expect(vi.mocked(audit).mock.calls).toEqual([[LINHA_DE_AUDITORIA]]);
  });

  it('"adiada": fecha e não escreve linha nenhuma', async () => {
    const desfecho = await fecharConversa({
      admin: admin(),
      conversa,
      revisaoEsperada: 7,
      requestId: "req-1",
      ator,
      auditoria: "adiada",
    });
    expect(desfecho).toMatchObject({ ok: true, mudou: true });
    expect(audit).not.toHaveBeenCalled();
  });

  it('"adiada" vence `auditarSemMudanca`: quem adia audita por conta própria', async () => {
    await fecharConversa({
      admin: admin(),
      conversa: { ...conversa, status: "closed" },
      revisaoEsperada: 7,
      requestId: "req-1",
      ator,
      auditarSemMudanca: true,
      auditoria: "adiada",
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it("auditarFechamentoDeConversa escreve a MESMA linha que o fechamento na hora", async () => {
    await auditarFechamentoDeConversa({ conversa, requestId: "req-1", ator });
    expect(vi.mocked(audit).mock.calls).toEqual([[LINHA_DE_AUDITORIA]]);
  });

  it("token como ator vai na coluna própria; sem metadata, a chave não existe", async () => {
    await auditarFechamentoDeConversa({
      conversa,
      requestId: "req-1",
      ator: { actorUserId: null, actorApiTokenId: "tok-1" },
    });
    expect(vi.mocked(audit).mock.calls).toEqual([
      [
        {
          action: "conversation.closed",
          actorUserId: null,
          actorApiTokenId: "tok-1",
          organizationId: ORG,
          resourceType: "conversation",
          resourceId: CONVERSA,
          requestId: "req-1",
        },
      ],
    ]);
  });
});

describe("fecharConversa: a recusa carrega o código do banco", () => {
  it.each([
    ["PT409", "conflito"],
    ["40001", "conflito"],
    ["P0002", "falha"],
    ["XX000", "falha"],
  ])("%s → %s, com o código", async (code, erro) => {
    const desfecho = await fecharConversa({
      admin: admin({ code, message: "do banco" }),
      conversa,
      revisaoEsperada: 7,
      requestId: "req-1",
      ator,
    });
    expect(desfecho).toEqual({ ok: false, erro, detalhe: "do banco", codigo: code });
    expect(audit).not.toHaveBeenCalled();
  });

  it("erro sem código → codigo nulo", async () => {
    const desfecho = await fecharConversa({
      admin: admin({ message: "sem código" }),
      conversa,
      revisaoEsperada: 7,
      requestId: "req-1",
      ator,
    });
    expect(desfecho).toEqual({ ok: false, erro: "falha", detalhe: "sem código", codigo: null });
  });
});
