/**
 * O TRANSPORTE das respostas a comentário: o que vai no fio, como cada erro da
 * Graph é classificado, e quem é o contato da resposta privada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { criarBancoFalso, type BancoFalso } from "@/tests/helpers/banco-falso-de-comentarios";

const h = vi.hoisted(() => ({
  cred: { token: "TOKEN", pageId: "100200300", rede: "instagram" } as { token: string; pageId: string; rede: string } | null,
  ingest: vi.fn(),
}));

vi.mock("./store", () => ({ tokenDaSessao: async () => h.cred }));
vi.mock("../meta/app", () => ({ appDaMeta: async () => ({ appSecret: "app-secret", verifyToken: "v" }) }));
vi.mock("../zernio/ingest", () => ({ ingestZernioInbound: h.ingest }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import {
  ESPERAS_DO_RECUO_MS,
  enviarRespostaPrivada,
  gravarRespostaPrivadaNaConversa,
  identidadeCandidataDoAutor,
  ocultarNaRede,
  publicarRespostaPublica,
  relogio,
} from "./comentarios-resposta";
import { ErroDaGraph, FRASE_SEM_ESCOPO_DE_COMENTARIOS, fraseDoErroDaGraph, provaDoApp } from "./graph";
import type { SessaoDireta } from "./store";

const ORG = "11111111-1111-4111-8111-111111111111";
const SESSAO: SessaoDireta = {
  id: "33333333-3333-4333-8333-333333333333",
  organizationId: ORG,
  rede: "instagram",
  conta: "17840000000000001",
  pageId: "100200300",
  displayName: "instagram · @loja",
  status: "WORKING",
  metadata: { social_platform: "instagram", comentarios_modo: "real" },
};

let rede: ReturnType<typeof vi.fn>;
const ok = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });
const erro = (code: number, message = "x", status = 400, subcode?: number) =>
  ok({ error: { code, message, ...(subcode ? { error_subcode: subcode } : {}) } }, status);
const db = {} as never;

beforeEach(() => {
  h.cred = { token: "TOKEN", pageId: "100200300", rede: "instagram" };
  h.ingest.mockReset();
  rede = vi.fn(async () => ok({ id: "1", message_id: "mid.1", recipient_id: "998877", success: true }));
  vi.stubGlobal("fetch", rede);
  vi.spyOn(relogio, "esperar").mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a frase do erro da Graph", () => {
  it("⭐ escopo de comentários ausente tem frase própria, que manda reautorizar", () => {
    for (const d of [
      { status: 403, code: 10, subcode: null, mensagem: "(#10) To use 'instagram_manage_comments', your use of this endpoint must be reviewed" },
      { status: 403, code: 200, subcode: null, mensagem: "(#200) Requires pages_read_engagement permission" },
      { status: 400, code: 3, subcode: null, mensagem: "(#3) App must have instagram_manage_comments" },
    ]) {
      expect(fraseDoErroDaGraph(d)).toBe(FRASE_SEM_ESCOPO_DE_COMENTARIOS);
      expect(new ErroDaGraph("x", d).escopoDeComentariosAusente).toBe(true);
    }
    expect(FRASE_SEM_ESCOPO_DE_COMENTARIOS).toContain("Reautorize");
  });

  it("CONTROLE: as outras recusas de permissão e a janela de 24 h continuam com a frase delas", () => {
    const semNome = { status: 403, code: 10, subcode: null, mensagem: "(#10) Application does not have permission for this action" };
    expect(fraseDoErroDaGraph(semNome)).toContain("falta de permissão");
    expect(new ErroDaGraph("x", semNome).escopoDeComentariosAusente).toBe(false);
    expect(fraseDoErroDaGraph({ status: 400, code: 10, subcode: 2534022, mensagem: null })).toContain("24 horas");
    // Erro que só CITA a permissão, mas não é de permissão, não vira "reautorize".
    expect(fraseDoErroDaGraph({ status: 400, code: 100, subcode: null, mensagem: "instagram_manage_comments" })).toContain("dado inválido");
  });

  it("limite de chamadas e desfecho incerto são classificados pelo que a Meta garante", () => {
    const de = (status: number, code: number | null) => new ErroDaGraph("x", { status, code, subcode: null, mensagem: null });
    for (const code of [4, 17, 32, 613]) expect(de(400, code).limiteDeTaxa).toBe(true);
    expect(de(400, 100).limiteDeTaxa).toBe(false);
    expect(de(0, null).desfechoIncerto).toBe(true);
    expect(de(502, null).desfechoIncerto).toBe(true);
    expect(de(500, 1).desfechoIncerto).toBe(true);
    expect(de(400, 2).desfechoIncerto).toBe(true);
    expect(de(400, 100).desfechoIncerto).toBe(false);
    expect(de(400, 4).desfechoIncerto).toBe(false);
  });
});

describe("o que vai no fio", () => {
  it("resposta pública: POST {comentário}/replies com message, token no cabeçalho e a prova do app", async () => {
    const r = await publicarRespostaPublica(db, SESSAO, "17865799348089039", "Olá!");
    expect(r).toEqual({ ok: true, id: "1" });
    const [url, init] = rede.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toMatch(/\/17865799348089039\/replies$/);
    expect(url.searchParams.get("appsecret_proof")).toBe(provaDoApp("TOKEN", "app-secret"));
    // O token nunca vai na URL.
    expect(url.toString()).not.toContain("TOKEN");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ message: "Olá!" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN");
  });

  it("resposta privada: POST {conta do Instagram}/messages com recipient.comment_id", async () => {
    const r = await enviarRespostaPrivada(db, SESSAO, "17865799348089039", "oi");
    expect(r).toEqual({ ok: true, messageId: "mid.1", recipientId: "998877" });
    const [url, init] = rede.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toMatch(/\/17840000000000001\/messages$/);
    expect(JSON.parse(String(init.body))).toEqual({ recipient: { comment_id: "17865799348089039" }, message: { text: "oi" } });
  });

  it("ocultar: POST {comentário} com hide", async () => {
    expect(await ocultarNaRede(db, SESSAO, "17865799348089039")).toEqual({ ok: true });
    const [url, init] = rede.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toMatch(/\/17865799348089039$/);
    expect(JSON.parse(String(init.body))).toEqual({ hide: true });
  });

  it("id que não é número não vira caminho de chamada", async () => {
    for (const id of ["../me", "123/replies", "abc", ""]) {
      const r = await publicarRespostaPublica(db, SESSAO, id, "x");
      expect(r).toMatchObject({ ok: false, falha: { tipo: "recusada" } });
    }
    expect(rede).not.toHaveBeenCalled();
  });

  it("conexão sem token: não chama a rede e diz para reconectar", async () => {
    h.cred = null;
    const r = await enviarRespostaPrivada(db, SESSAO, "1", "oi");
    expect(r).toMatchObject({ ok: false, falha: { tipo: "sem_credencial" } });
    expect(rede).not.toHaveBeenCalled();
  });
});

describe("o desfecho de cada erro", () => {
  it("⭐ limite: recua e repete; as esperas são as declaradas", async () => {
    rede.mockResolvedValueOnce(erro(4)).mockResolvedValueOnce(erro(17));
    const r = await publicarRespostaPublica(db, SESSAO, "1", "x");
    expect(r).toEqual({ ok: true, id: "1" });
    expect(rede).toHaveBeenCalledTimes(3);
    expect(vi.mocked(relogio.esperar).mock.calls.map((c) => c[0])).toEqual([...ESPERAS_DO_RECUO_MS]);
  });

  it("limite que não cede: desiste depois das esperas, como `limite`", async () => {
    rede.mockImplementation(async () => erro(613));
    const r = await enviarRespostaPrivada(db, SESSAO, "1", "x");
    expect(r).toMatchObject({ ok: false, falha: { tipo: "limite" } });
    expect(rede).toHaveBeenCalledTimes(ESPERAS_DO_RECUO_MS.length + 1);
  });

  it("⭐ rede que caiu, 5xx e 200 sem id são INCERTOS e nunca repetidos", async () => {
    rede.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await publicarRespostaPublica(db, SESSAO, "1", "x")).toMatchObject({ ok: false, falha: { tipo: "incerta" } });
    rede.mockResolvedValueOnce(ok({}, 500));
    expect(await publicarRespostaPublica(db, SESSAO, "1", "x")).toMatchObject({ ok: false, falha: { tipo: "incerta" } });
    rede.mockResolvedValueOnce(ok({}));
    expect(await publicarRespostaPublica(db, SESSAO, "1", "x")).toMatchObject({ ok: false, falha: { tipo: "incerta" } });
    rede.mockResolvedValueOnce(ok({ recipient_id: "1" }));
    expect(await enviarRespostaPrivada(db, SESSAO, "1", "x")).toMatchObject({ ok: false, falha: { tipo: "incerta" } });
    expect(rede).toHaveBeenCalledTimes(4);
    expect(relogio.esperar).not.toHaveBeenCalled();
  });

  it("recusa definitiva volta na hora, com a frase e a marca de escopo", async () => {
    rede.mockResolvedValueOnce(erro(200, "(#200) Requires instagram_manage_comments", 403));
    const r = await publicarRespostaPublica(db, SESSAO, "1", "x");
    expect(r).toEqual({ ok: false, falha: { tipo: "recusada", frase: FRASE_SEM_ESCOPO_DE_COMENTARIOS, escopoAusente: true } });
    expect(rede).toHaveBeenCalledTimes(1);
  });

  it("`recipient_id` que não é número não é aceito como identidade", async () => {
    rede.mockResolvedValueOnce(ok({ message_id: "mid.9", recipient_id: "abc:def" }));
    expect(await enviarRespostaPrivada(db, SESSAO, "1", "x")).toEqual({ ok: true, messageId: "mid.9", recipientId: null });
  });
});

describe("a resposta privada na conversa", () => {
  const RESPOSTA = {
    recipientId: "998877",
    messageId: "mid.1",
    texto: "oi",
    quando: "2026-11-20T12:00:00.000Z",
    usuario: "cliente.exemplo",
    contatoDoComentario: null as string | null,
    criarContato: false,
    origem: { social_comment_id: "sc-1", comment_id: "1786" },
  };
  let banco: BancoFalso;

  beforeEach(() => {
    banco = criarBancoFalso({ contacts: [], conversations: [{ id: "conv-1", organization_id: ORG, contact_id: "c-1" }], messages: [{ id: "m-1", organization_id: ORG }] });
    h.ingest.mockResolvedValue({ status: "ingested", conversationId: "conv-1", messageId: "m-1" });
  });

  it("⭐ a identidade é montada com o id que a rede devolveu", () => {
    expect(identidadeCandidataDoAutor(SESSAO, "998877")).toBe("instagram:17840000000000001:998877");
  });

  it("sem contato e sem `criarContato`: não grava nada e devolve null", async () => {
    expect(await gravarRespostaPrivadaNaConversa(banco as never, SESSAO, RESPOSTA)).toBeNull();
    expect(h.ingest).not.toHaveBeenCalled();
  });

  it("com `criarContato`: entra pela ingestão das mensagens, como saída, e a mensagem ganha a origem", async () => {
    const r = await gravarRespostaPrivadaNaConversa(banco as never, SESSAO, { ...RESPOSTA, criarContato: true });
    expect(r).toEqual({ contactId: "c-1", conversationId: "conv-1", messageId: "m-1" });
    const entrada = h.ingest.mock.calls[0]![1] as { socialMessage: Record<string, unknown>; organizationId: string; channelSessionId: string };
    expect(entrada).toMatchObject({ organizationId: ORG, channelSessionId: SESSAO.id });
    expect(entrada.socialMessage).toMatchObject({
      direction: "outbound",
      status: "sent",
      participantId: "998877",
      conversationId: "998877",
      identity: { username: "cliente.exemplo", displayName: "@cliente.exemplo" },
    });
    expect(banco.tabelas.messages![0]!.metadata).toEqual({ origem: "resposta_privada_de_comentario", social_comment_id: "sc-1", comment_id: "1786" });
  });

  it("⭐ o contato do comentário só ganha a identidade se ainda não tem nenhuma", async () => {
    banco.tabelas.contacts!.push(
      { id: "c-livre", organization_id: ORG, social_identity: null, is_merged_into: null, is_anonymized: false },
      { id: "c-outra-org", organization_id: "22222222-2222-4222-8222-222222222222", social_identity: null, is_merged_into: null, is_anonymized: false },
    );
    await gravarRespostaPrivadaNaConversa(banco as never, SESSAO, { ...RESPOSTA, contatoDoComentario: "c-livre" });
    expect(banco.tabelas.contacts![0]!.social_identity).toBe("instagram:17840000000000001:998877");
    expect(h.ingest).toHaveBeenCalledTimes(1);

    // Contato que JÁ tem outra identidade não é reescrito — e, sem `criarContato`, nada é gravado.
    banco.tabelas.contacts = [{ id: "c-com", organization_id: ORG, social_identity: "instagram:1:2", is_merged_into: null, is_anonymized: false }];
    h.ingest.mockClear();
    expect(await gravarRespostaPrivadaNaConversa(banco as never, SESSAO, { ...RESPOSTA, contatoDoComentario: "c-com" })).toBeNull();
    expect(banco.tabelas.contacts[0]!.social_identity).toBe("instagram:1:2");
    expect(h.ingest).not.toHaveBeenCalled();

    // Contato de OUTRA organização nunca é tocado.
    banco.tabelas.contacts = [{ id: "c-outra-org", organization_id: "22222222-2222-4222-8222-222222222222", social_identity: null, is_merged_into: null, is_anonymized: false }];
    await gravarRespostaPrivadaNaConversa(banco as never, SESSAO, { ...RESPOSTA, contatoDoComentario: "c-outra-org" });
    expect(banco.tabelas.contacts[0]!.social_identity).toBeNull();
  });

  it("mensagem que já estava lá (o eco chegou antes): a conversa vale, sem id de mensagem novo", async () => {
    h.ingest.mockResolvedValue({ status: "duplicate", conversationId: "conv-1" });
    const r = await gravarRespostaPrivadaNaConversa(banco as never, SESSAO, { ...RESPOSTA, criarContato: true });
    expect(r).toEqual({ contactId: "c-1", conversationId: "conv-1", messageId: null });
  });
});
