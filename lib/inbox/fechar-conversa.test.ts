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
  mudarEstadoDoAtendimento,
  origemDoAtor,
  SEM_TRAVA_DE_REVISAO,
} from "./fechar-conversa";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const ORG = "22222222-2222-4222-8222-222222222222";
const CONVERSA = "44444444-4444-4444-8444-444444444444";
const USUARIO = "11111111-1111-4111-8111-111111111111";

const conversa = { id: CONVERSA, organization_id: ORG, status: "open" };
const ator = { actorUserId: USUARIO, metadata: { via: "teste" } };

function admin(erro: { code?: string; message: string } | null = null) {
  const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
    data: erro ? null : { ...conversa, status: "closed" },
    error: erro,
  }));
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
    await fecharConversa({ admin: a, conversa, origem: "pessoa", revisaoEsperada: 7, requestId: "req-1", ator });
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
      origem: "pessoa",
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
      origem: "pessoa",
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
      origem: "pessoa",
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
      origem: "pessoa",
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
      origem: "pessoa",
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
      origem: "pessoa",
      revisaoEsperada: 7,
      requestId: "req-1",
      ator,
    });
    expect(desfecho).toEqual({ ok: false, erro: "falha", detalhe: "sem código", codigo: null });
  });
});

// Tarefa 6.1 (24/11/2026): a regra 2.31 mora AQUI e na função do banco, não nos
// chamadores. `origem` é obrigatória; com "agente" o módulo recusa a conversa
// assumida na leitura e manda `p_ator` para o banco recusar com a linha travada.
describe("fecharConversa: de quem é o pedido (regra 2.31)", () => {
  const PESSOA = "33333333-3333-4333-8333-333333333333";
  const assumida = { ...conversa, status: "claimed", assigned_to_user_id: PESSOA };
  const pedido = { revisaoEsperada: 7, requestId: "req-1", ator } as const;

  it("pessoa: `p_ator` nem viaja (a chamada de antes da migration 9824)", async () => {
    const a = admin();
    await fecharConversa({ admin: a, conversa, origem: "pessoa", ...pedido });
    expect(a.rpc.mock.calls[0]![1]).not.toHaveProperty("p_ator");
  });

  it("agente: `p_ator: 'agente'` viaja, junto da revisão", async () => {
    const a = admin();
    await fecharConversa({ admin: a, conversa, origem: "agente", ...pedido });
    expect(a.rpc.mock.calls).toEqual([
      [
        "fn_service_status",
        { p_org: ORG, p_conversation: CONVERSA, p_status: "closed", p_expected: 7, p_ator: "agente" },
      ],
    ]);
  });

  it("⭐ agente × conversa assumida: `com_humano` sem chamar o banco e sem auditar", async () => {
    const a = admin();
    const desfecho = await fecharConversa({ admin: a, conversa: assumida, origem: "agente", ...pedido });
    expect(desfecho).toEqual({
      ok: false,
      erro: "com_humano",
      detalhe: "service_assigned_to_human",
      codigo: "PT403",
    });
    expect(a.rpc).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("⭐ agente, a janela: a leitura não viu responsável e o BANCO recusa (PT403) → `com_humano`, sem auditar", async () => {
    const a = admin({ code: "PT403", message: "service_assigned_to_human" });
    const desfecho = await fecharConversa({
      admin: a,
      conversa: { ...conversa, assigned_to_user_id: null },
      origem: "agente",
      ...pedido,
    });
    expect(desfecho).toMatchObject({ ok: false, erro: "com_humano", codigo: "PT403" });
    expect(a.rpc).toHaveBeenCalledTimes(1);
    expect(audit).not.toHaveBeenCalled();
  });

  it("agente que não leu o responsável: o módulo não adivinha, quem decide é o banco", async () => {
    const a = admin();
    await fecharConversa({ admin: a, conversa, origem: "agente", ...pedido });
    expect(a.rpc).toHaveBeenCalledTimes(1);
    expect(a.rpc.mock.calls[0]![1]).toMatchObject({ p_ator: "agente" });
  });

  it("agente × conversa assumida JÁ encerrada: segue ao banco (repetir é sucesso sem efeito)", async () => {
    const a = admin();
    const desfecho = await fecharConversa({
      admin: a,
      conversa: { ...assumida, status: "closed" },
      origem: "agente",
      ...pedido,
    });
    expect(desfecho).toMatchObject({ ok: true, mudou: false });
    expect(a.rpc).toHaveBeenCalledTimes(1);
  });

  it("controle: a PESSOA fecha a conversa assumida", async () => {
    const a = admin();
    const desfecho = await fecharConversa({ admin: a, conversa: assumida, origem: "pessoa", ...pedido });
    expect(desfecho).toMatchObject({ ok: true, mudou: true });
    expect(a.rpc).toHaveBeenCalledTimes(1);
  });

  it("⭐ banco anterior à 9824 (PGRST202): `falha`, UMA chamada, sem volta ao caminho sem `p_ator`", async () => {
    const a = admin({ code: "PGRST202", message: "Could not find the function public.fn_service_status" });
    const desfecho = await fecharConversa({ admin: a, conversa, origem: "agente", ...pedido });
    expect(desfecho).toMatchObject({ ok: false, erro: "falha", codigo: "PGRST202" });
    expect(a.rpc).toHaveBeenCalledTimes(1);
    expect(a.rpc.mock.calls[0]![1]).toMatchObject({ p_ator: "agente" });
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("mudarEstadoDoAtendimento: a única chamada à fn_service_status", () => {
  it.each(["closed", "resolved", "archived", "open"])("agente pedindo %s leva `p_ator`; pessoa, não", async (status) => {
    const a = admin();
    const base = { admin: a, organizationId: ORG, conversationId: CONVERSA, status, revisaoEsperada: 7 };
    await mudarEstadoDoAtendimento({ ...base, origem: "agente" });
    await mudarEstadoDoAtendimento({ ...base, origem: "pessoa" });
    expect(a.rpc.mock.calls.map((c) => c[1])).toEqual([
      { p_org: ORG, p_conversation: CONVERSA, p_status: status, p_expected: 7, p_ator: "agente" },
      { p_org: ORG, p_conversation: CONVERSA, p_status: status, p_expected: 7 },
    ]);
  });

  it.each([
    ["PT403", "com_humano"],
    ["PT409", "conflito"],
    ["40001", "conflito"],
    ["P0002", "falha"],
    ["PGRST202", "falha"],
  ])("código %s do banco → erro `%s`", async (code, erro) => {
    const desfecho = await mudarEstadoDoAtendimento({
      admin: admin({ code, message: "x" }),
      organizationId: ORG,
      conversationId: CONVERSA,
      status: "archived",
      revisaoEsperada: undefined,
      origem: "agente",
    });
    expect(desfecho).toEqual({ ok: false, erro, detalhe: "x", codigo: code });
  });
});

describe("origemDoAtor: só `user` é pessoa", () => {
  it.each([
    ["user", "pessoa"],
    ["api_token", "agente"],
    ["ai_agent", "agente"],
    ["system", "agente"],
    ["", "agente"],
  ])("%s → %s", (type, origem) => {
    expect(origemDoAtor({ type })).toBe(origem);
  });
});
