/**
 * COMENTÁRIOS — a regra de ler, responder, ocultar, ignorar e virar contato
 * (`lib/comentarios/acoes.ts`), medida de ponta a ponta até o fio.
 *
 * O arquivo mora AQUI, na fronteira dos canais, porque as linhas de teste
 * descrevem a conexão direta (as colunas dela, o caminho da ingestão): fora
 * daqui, nomear o transporte reprova a cerca de restrição de canal.
 *
 * O espião é o `fetch`: tudo o que vai à rede passa por ele, então "não chamou
 * a rede" e "chamou UMA vez" são medidos no fio, e não numa função nossa que
 * poderia ser contornada. O banco é o falso de `tests/helpers`, que aplica os
 * filtros de verdade — é ele que prova o isolamento por organização e o UPDATE
 * condicional que impede a resposta em dobro.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { criarBancoFalso, type BancoFalso } from "@/tests/helpers/banco-falso-de-comentarios";

const h = vi.hoisted(() => ({
  audit: vi.fn(async (_e: Record<string, unknown>) => undefined),
  ingest: vi.fn(),
  criarLead: vi.fn(),
  cardAberto: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/webhooks/secrets", () => ({
  decryptWebhookSecret: vi.fn(async () => "TOKEN-DA-PAGINA"),
  encryptWebhookSecret: vi.fn(),
}));
vi.mock("@/lib/channels/meta/app", () => ({ appDaMeta: vi.fn(async () => ({ appSecret: null, verifyToken: null })) }));
vi.mock("@/lib/channels/zernio/ingest", () => ({ ingestZernioInbound: h.ingest }));
vi.mock("@/app/api/v1/leads/_handler", () => ({ createLeadHandler: h.criarLead }));
vi.mock("@/lib/automation/captacao-reusa-card-aberto", () => ({ cardAbertoQueACaptacaoReusa: h.cardAberto }));

import { ApiError } from "@/lib/api/types";
import { CHANNEL_PROVIDER_SOCIAL_DIRETO } from "@/lib/channels/capabilities";
import { relogio } from "@/lib/channels/meta-social/comentarios-resposta";

import {
  criarContatoDoComentario,
  ignorarComentario,
  lerComentario,
  listarComentarios,
  ocultarComentario,
  responderEmPrivado,
  responderEmPublico,
  type QuemAge,
} from "@/lib/comentarios/acoes";

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "22222222-2222-4222-8222-222222222222";
const CANAL = "33333333-3333-4333-8333-333333333333";
const CANAL_DA_OUTRA = "44444444-4444-4444-8444-444444444444";
const CONTA = "17840000000000001";
const COMENTARIO = "aaaaaaaa-0000-4000-8000-000000000001";
const DA_OUTRA_ORG = "aaaaaaaa-0000-4000-8000-000000000002";
const ID_NA_REDE = "17865799348089039";
const AUTOR = "232323232";
/** De propósito DIFERENTE do autor: a identidade vem da resposta da rede, não do comentário. */
const RECEBEDOR = "998877665544";

const TOKEN: QuemAge = {
  actor: { type: "api_token", id: "tok-1", role: "manager" },
  apiTokenId: "tok-1",
  requestId: "req-1",
  via: "mcp",
};

const agora = () => new Date().toISOString();
const haDias = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

function canal(id: string, org: string, modo: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: org,
    provider: CHANNEL_PROVIDER_SOCIAL_DIRETO,
    meta_social_account_id: id === CANAL ? CONTA : "17840000000000002",
    meta_social_page_id: "100200300",
    meta_social_token_encrypted: "cifrado",
    display_name: "instagram · @loja",
    status: "WORKING",
    archived_at: null,
    metadata: { social_platform: "instagram", ...(modo ? { comentarios_modo: modo } : {}) },
    ...extra,
  };
}

function comentario(id: string, org: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: org,
    channel_session_id: org === ORG ? CANAL : CANAL_DA_OUTRA,
    comment_id: ID_NA_REDE,
    parent_comment_id: null,
    media_id: "17900000000000123",
    media_product_type: "REELS",
    ad_id: null,
    ad_title: null,
    ao_vivo: false,
    author_id: AUTOR,
    author_username: "cliente.exemplo",
    text: "quanto custa?",
    commented_at: haDias(1),
    estado: "novo",
    public_reply: null,
    private_reply: null,
    hidden: null,
    ignore_reason: null,
    contact_id: null,
    created_at: haDias(1),
    updated_at: haDias(1),
    ...extra,
  };
}

let banco: BancoFalso;
let rede: ReturnType<typeof vi.fn>;

function montar(modo: string | null, extraDoComentario: Record<string, unknown> = {}) {
  banco = criarBancoFalso({
    channel_sessions: [canal(CANAL, ORG, modo), canal(CANAL_DA_OUTRA, OUTRA_ORG, "real")],
    social_comments: [comentario(COMENTARIO, ORG, extraDoComentario), comentario(DA_OUTRA_ORG, OUTRA_ORG)],
    contacts: [],
    conversations: [],
    messages: [],
    crm_stages: [],
  });
  return banco as never;
}

const respostaDaRede = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const erroDaRede = (code: number, message = "erro", status = 400) =>
  respostaDaRede({ error: { code, message } }, status);

const linha = (id = COMENTARIO) => banco.tabelas.social_comments!.find((l) => l.id === id)!;
const chamadasARede = () => rede.mock.calls.map(([url, init]) => ({ url: new URL(String(url)), init: init as RequestInit }));

async function recusa(promessa: Promise<unknown>): Promise<ApiError> {
  const erro = await promessa.then(
    () => null,
    (e: unknown) => e,
  );
  expect(erro).toBeInstanceOf(ApiError);
  return erro as ApiError;
}

beforeEach(() => {
  rede = vi.fn(async () => respostaDaRede({ id: "17999000111", message_id: "mid.1", recipient_id: RECEBEDOR, success: true }));
  vi.stubGlobal("fetch", rede);
  vi.spyOn(relogio, "esperar").mockResolvedValue(undefined);
  h.audit.mockClear();
  h.ingest.mockReset();
  h.criarLead.mockReset();
  h.cardAberto.mockReset();
  // A ingestão real cria contato e conversa; o dublê faz o mesmo no banco falso.
  h.ingest.mockImplementation(async (db: BancoFalso, entrada: { organizationId: string; socialMessage: { participantId: string } }) => {
    const identidade = `instagram:${CONTA}:${entrada.socialMessage.participantId}`;
    let contato = db.tabelas.contacts!.find((c) => c.social_identity === identidade);
    if (!contato) {
      contato = { id: "cccccccc-0000-4000-8000-0000000000aa", organization_id: entrada.organizationId, social_identity: identidade };
      db.tabelas.contacts!.push(contato);
    }
    db.tabelas.conversations!.push({ id: "dddddddd-0000-4000-8000-000000000001", organization_id: entrada.organizationId, contact_id: contato.id });
    db.tabelas.messages!.push({ id: "eeeeeeee-0000-4000-8000-000000000001", organization_id: entrada.organizationId, metadata: {} });
    return { status: "ingested", conversationId: "dddddddd-0000-4000-8000-000000000001", messageId: "eeeeeeee-0000-4000-8000-000000000001" };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ler e listar", () => {
  it("⭐ a lista só traz comentários da organização de quem chama", async () => {
    const db = montar("real");
    const pagina = await listarComentarios(db, ORG, {}, TOKEN);
    expect(pagina.comentarios.map((c) => c.id)).toEqual([COMENTARIO]);
    const daOutra = await listarComentarios(db, OUTRA_ORG, {}, TOKEN);
    expect(daOutra.comentarios.map((c) => c.id)).toEqual([DA_OUTRA_ORG]);
  });

  it("⭐ comentário de OUTRA organização e comentário inexistente recebem o mesmo 404", async () => {
    const db = montar("real");
    const alheio = await recusa(lerComentario(db, ORG, DA_OUTRA_ORG, TOKEN));
    const inexistente = await recusa(lerComentario(db, ORG, "aaaaaaaa-0000-4000-8000-00000000ffff", TOKEN));
    expect([alheio.status, alheio.code, alheio.message]).toEqual([404, "not_found", inexistente.message]);
    expect(inexistente.status).toBe(404);
  });

  it("o texto volta inteiro, e o prazo da resposta privada é 7 dias depois do comentário", async () => {
    const longo = "x".repeat(5000);
    const db = montar("real", { text: longo, commented_at: "2026-11-01T10:00:00.000Z" });
    const c = await lerComentario(db, ORG, COMENTARIO, TOKEN);
    expect(c.text).toBe(longo);
    expect(c.private_reply_deadline).toBe("2026-11-08T10:00:00.000Z");
    expect(c.author).toEqual({ id: AUTOR, username: "cliente.exemplo" });
  });

  it("filtra por estado, canal, publicação e data", async () => {
    const db = montar("real");
    banco.tabelas.social_comments!.push(
      comentario("aaaaaaaa-0000-4000-8000-000000000003", ORG, { estado: "sem_acao", media_id: "outra", commented_at: haDias(10) }),
    );
    expect((await listarComentarios(db, ORG, { estado: "novo" }, TOKEN)).comentarios).toHaveLength(1);
    expect((await listarComentarios(db, ORG, { estado: "sem_acao" }, TOKEN)).comentarios[0]?.media_id).toBe("outra");
    expect((await listarComentarios(db, ORG, { midia: "outra" }, TOKEN)).comentarios).toHaveLength(1);
    expect((await listarComentarios(db, ORG, { desde: haDias(5) }, TOKEN)).comentarios).toHaveLength(1);
    expect((await listarComentarios(db, ORG, { canal: CANAL_DA_OUTRA }, TOKEN)).comentarios).toHaveLength(0);
  });

  it("pagina sem repetir nem pular, e recusa cursor que não é nosso", async () => {
    const db = montar("real");
    banco.tabelas.social_comments = [1, 2, 3, 4, 5].map((n) =>
      comentario(`aaaaaaaa-0000-4000-8000-00000000001${n}`, ORG, {
        // Dois com a MESMA hora: o desempate pelo id é o que evita repetir.
        commented_at: n <= 2 ? "2026-11-19T10:00:00.000Z" : `2026-11-1${n}T10:00:00.000Z`,
      }),
    );
    const vistos: string[] = [];
    let cursor: string | undefined;
    for (let volta = 0; volta < 5; volta++) {
      const p = await listarComentarios(db, ORG, { limite: 2, ...(cursor ? { cursor } : {}) }, TOKEN);
      vistos.push(...p.comentarios.map((c) => c.id));
      if (!p.tem_mais) break;
      cursor = p.cursor ?? undefined;
    }
    expect(vistos).toHaveLength(5);
    expect(new Set(vistos).size).toBe(5);
    const erro = await recusa(listarComentarios(db, ORG, { cursor: "nao-e-cursor" }, TOKEN));
    expect([erro.status, erro.code]).toEqual([400, "invalid_cursor"]);
  });
});

describe("responder em público", () => {
  it("⭐ modo registrar: NUNCA chama a rede, grava simulada e devolve simulada", async () => {
    const db = montar("registrar");
    const r = await responderEmPublico(db, ORG, COMENTARIO, { text: "Olá!" }, TOKEN);
    expect(rede).not.toHaveBeenCalled();
    expect(r.simulada).toBe(true);
    expect(r.comment.public_reply).toMatchObject({ id: null, texto: "Olá!", simulada: true, situacao: "concluida" });
    expect(r.comment.public_reply?.quem).toEqual({ tipo: "api_token", id: "tok-1", api_token_id: "tok-1" });
    expect(r.comment.estado).toBe("respondido");
  });

  it("⭐ modo real: chama a rede UMA vez, no endereço da resposta, com o token no cabeçalho", async () => {
    const db = montar("real");
    const r = await responderEmPublico(db, ORG, COMENTARIO, { text: "Olá!" }, TOKEN);
    expect(rede).toHaveBeenCalledTimes(1);
    const { url, init } = chamadasARede()[0]!;
    expect(url.pathname.endsWith(`/${ID_NA_REDE}/replies`)).toBe(true);
    expect(url.search).toBe("");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ message: "Olá!" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN-DA-PAGINA");
    expect(r.simulada).toBe(false);
    expect(r.comment.public_reply).toMatchObject({ id: "17999000111", simulada: false, situacao: "concluida" });
    expect(r.comment.estado).toBe("respondido");
  });

  it("⭐ a segunda chamada recebe 409 ja_respondido com a resposta existente, e a rede não é chamada de novo", async () => {
    const db = montar("real");
    await responderEmPublico(db, ORG, COMENTARIO, { text: "primeira" }, TOKEN);
    const erro = await recusa(responderEmPublico(db, ORG, COMENTARIO, { text: "segunda" }, TOKEN));
    expect([erro.status, erro.code]).toEqual([409, "ja_respondido"]);
    expect((erro.details as { resposta: { texto: string } }).resposta.texto).toBe("primeira");
    expect(rede).toHaveBeenCalledTimes(1);
  });

  it("⭐ duas chamadas ao mesmo tempo: só uma publica", async () => {
    const db = montar("real");
    const desfechos = await Promise.allSettled([
      responderEmPublico(db, ORG, COMENTARIO, { text: "a" }, TOKEN),
      responderEmPublico(db, ORG, COMENTARIO, { text: "b" }, TOKEN),
    ]);
    expect(desfechos.filter((d) => d.status === "fulfilled")).toHaveLength(1);
    const recusada = desfechos.find((d) => d.status === "rejected") as PromiseRejectedResult;
    expect((recusada.reason as ApiError).status).toBe(409);
    expect(rede).toHaveBeenCalledTimes(1);
  });

  it("modo off: 409 comentarios_desligados, sem rede e sem gravar", async () => {
    const db = montar(null);
    const erro = await recusa(responderEmPublico(db, ORG, COMENTARIO, { text: "Olá!" }, TOKEN));
    expect([erro.status, erro.code]).toEqual([409, "comentarios_desligados"]);
    expect(rede).not.toHaveBeenCalled();
    expect(linha().public_reply).toBeNull();
  });

  it("⭐ recusa da rede NÃO deixa o comentário respondido, e a chamada seguinte pode publicar", async () => {
    const db = montar("real");
    rede.mockResolvedValueOnce(erroDaRede(100, "Invalid parameter"));
    const erro = await recusa(responderEmPublico(db, ORG, COMENTARIO, { text: "Olá!" }, TOKEN));
    expect([erro.status, erro.code]).toEqual([502, "upstream_unavailable"]);
    expect(linha().public_reply).toBeNull();
    expect(linha().estado).toBe("novo");
    expect(h.audit).not.toHaveBeenCalled();
    const r = await responderEmPublico(db, ORG, COMENTARIO, { text: "Olá!" }, TOKEN);
    expect(r.comment.estado).toBe("respondido");
  });

  it("sem a permissão de comentários: 422 escopo_ausente, com a frase de reautorizar", async () => {
    const db = montar("real");
    rede.mockResolvedValueOnce(erroDaRede(10, "(#10) Application does not have permission: instagram_manage_comments", 403));
    const erro = await recusa(responderEmPublico(db, ORG, COMENTARIO, { text: "Olá!" }, TOKEN));
    expect([erro.status, erro.code]).toEqual([422, "escopo_ausente"]);
    expect(erro.message).toContain("Reautorize");
    expect(linha().estado).toBe("novo");
  });

  it("⭐ resposta que não chegou: fica INCERTA, não é repetida sozinha, e só confirmar_reenvio manda de novo", async () => {
    const db = montar("real");
    rede.mockRejectedValueOnce(new Error("timeout"));
    const primeira = await recusa(responderEmPublico(db, ORG, COMENTARIO, { text: "Olá!" }, TOKEN));
    expect([primeira.status, primeira.code]).toEqual([502, "resposta_incerta"]);
    expect(rede).toHaveBeenCalledTimes(1);
    expect(linha().estado).toBe("novo");
    expect((linha().public_reply as { situacao: string }).situacao).toBe("incerta");

    const segunda = await recusa(responderEmPublico(db, ORG, COMENTARIO, { text: "Olá!" }, TOKEN));
    expect([segunda.status, segunda.code]).toEqual([409, "resposta_incerta"]);
    expect(rede).toHaveBeenCalledTimes(1);

    const r = await responderEmPublico(db, ORG, COMENTARIO, { text: "Olá!", confirmar_reenvio: true }, TOKEN);
    expect(rede).toHaveBeenCalledTimes(2);
    expect(r.comment.estado).toBe("respondido");
  });

  it("erro de servidor da rede (5xx) também é incerto: nada de nova tentativa", async () => {
    const db = montar("real");
    rede.mockResolvedValueOnce(respostaDaRede({}, 503));
    const erro = await recusa(responderEmPublico(db, ORG, COMENTARIO, { text: "Olá!" }, TOKEN));
    expect(erro.code).toBe("resposta_incerta");
    expect(rede).toHaveBeenCalledTimes(1);
  });

  it("reserva recente de outra chamada: 409 resposta_em_andamento, nem com confirmar_reenvio", async () => {
    const db = montar("real", {
      public_reply: { id: null, texto: "x", quando: agora(), quem: { tipo: "user", id: "u" }, simulada: false, situacao: "enviando" },
    });
    const erro = await recusa(
      responderEmPublico(db, ORG, COMENTARIO, { text: "Olá!", confirmar_reenvio: true }, TOKEN),
    );
    expect([erro.status, erro.code]).toEqual([409, "resposta_em_andamento"]);
    expect(rede).not.toHaveBeenCalled();
  });

  it("limite de chamadas da rede: espera e tenta de novo, porque nada saiu", async () => {
    const db = montar("real");
    rede.mockResolvedValueOnce(erroDaRede(4, "limit")).mockResolvedValueOnce(erroDaRede(32, "limit"));
    const r = await responderEmPublico(db, ORG, COMENTARIO, { text: "Olá!" }, TOKEN);
    expect(rede).toHaveBeenCalledTimes(3);
    expect(relogio.esperar).toHaveBeenCalledTimes(2);
    expect(r.comment.estado).toBe("respondido");
  });

  it("limite que não cede: 429, e o comentário volta a não ter resposta", async () => {
    const db = montar("real");
    rede.mockImplementation(async () => erroDaRede(613, "limit"));
    const erro = await recusa(responderEmPublico(db, ORG, COMENTARIO, { text: "Olá!" }, TOKEN));
    expect([erro.status, erro.code]).toEqual([429, "rate_limited"]);
    expect(rede).toHaveBeenCalledTimes(3);
    expect(linha().public_reply).toBeNull();
  });

  it("recusas que não chegam à rede: texto vazio, ao vivo, de outra organização, canal desconectado", async () => {
    const vazio = await recusa(responderEmPublico(montar("real"), ORG, COMENTARIO, { text: "   " }, TOKEN));
    expect([vazio.status, vazio.code]).toEqual([422, "validation_error"]);
    const aoVivo = await recusa(responderEmPublico(montar("real", { ao_vivo: true }), ORG, COMENTARIO, { text: "oi" }, TOKEN));
    expect([aoVivo.status, aoVivo.code]).toEqual([422, "comentario_ao_vivo"]);
    const alheio = await recusa(responderEmPublico(montar("real"), ORG, DA_OUTRA_ORG, { text: "oi" }, TOKEN));
    expect(alheio.status).toBe(404);
    const db = montar("real");
    banco.tabelas.channel_sessions![0]!.archived_at = agora();
    const semCanal = await recusa(responderEmPublico(db, ORG, COMENTARIO, { text: "oi" }, TOKEN));
    expect([semCanal.status, semCanal.code]).toEqual([409, "canal_indisponivel"]);
    expect(rede).not.toHaveBeenCalled();
  });

  it("sem regra de conteúdo: link, preço e texto longo passam como vieram", async () => {
    const db = montar("real");
    const texto = `Custa R$ 199,90 — veja em https://exemplo.test/produto ${"a".repeat(3000)}`;
    await responderEmPublico(db, ORG, COMENTARIO, { text: texto }, TOKEN);
    const { init } = chamadasARede()[0]!;
    expect(JSON.parse(String(init.body)).message).toBe(texto);
  });

  it("⭐ a escrita é auditada em nome de quem agiu, com o token", async () => {
    const db = montar("real");
    await responderEmPublico(db, ORG, COMENTARIO, { text: "Olá!" }, TOKEN);
    expect(h.audit).toHaveBeenCalledTimes(1);
    expect(h.audit.mock.calls[0]![0]).toMatchObject({
      action: "social_comment.respondido",
      actorUserId: null,
      actorApiTokenId: "tok-1",
      organizationId: ORG,
      resourceType: "social_comment",
      resourceId: COMENTARIO,
      requestId: "req-1",
      metadata: { via: "mcp", actor_type: "api_token", simulada: false, reply_id: "17999000111" },
    });
  });
});

describe("responder em privado", () => {
  it("⭐ passados 7 dias: 422 janela_de_7_dias, sem rede — no modo real e no de registro", async () => {
    for (const modo of ["real", "registrar"]) {
      const db = montar(modo, { commented_at: haDias(8) });
      const erro = await recusa(responderEmPrivado(db, ORG, COMENTARIO, { text: "oi" }, TOKEN));
      expect([erro.status, erro.code]).toEqual([422, "janela_de_7_dias"]);
    }
    expect(rede).not.toHaveBeenCalled();
  });

  it("dentro do prazo (6 dias) a resposta sai", async () => {
    const db = montar("real", { commented_at: haDias(6) });
    await responderEmPrivado(db, ORG, COMENTARIO, { text: "oi", criar_contato: true }, TOKEN);
    expect(rede).toHaveBeenCalledTimes(1);
  });

  it("⭐ modo registrar: sem rede, sem conversa, sem contato — só a resposta simulada", async () => {
    const db = montar("registrar");
    const r = await responderEmPrivado(db, ORG, COMENTARIO, { text: "oi", criar_contato: true }, TOKEN);
    expect(rede).not.toHaveBeenCalled();
    expect(h.ingest).not.toHaveBeenCalled();
    expect(banco.tabelas.contacts).toHaveLength(0);
    expect(r).toMatchObject({ simulada: true, contact_id: null, conversation_id: null, sem_conversa: "simulada" });
    expect(r.comment.private_reply).toMatchObject({ simulada: true, situacao: "concluida", message_id: null });
  });

  it("⭐ modo real: UMA chamada com recipient.comment_id, e a mensagem entra na conversa pelo id que a rede devolveu", async () => {
    const db = montar("real");
    const r = await responderEmPrivado(db, ORG, COMENTARIO, { text: "te chamei aqui", criar_contato: true }, TOKEN);
    expect(rede).toHaveBeenCalledTimes(1);
    const { url, init } = chamadasARede()[0]!;
    expect(url.pathname.endsWith(`/${CONTA}/messages`)).toBe(true);
    expect(JSON.parse(String(init.body))).toEqual({
      recipient: { comment_id: ID_NA_REDE },
      message: { text: "te chamei aqui" },
    });

    expect(h.ingest).toHaveBeenCalledTimes(1);
    const entrada = h.ingest.mock.calls[0]![1] as { organizationId: string; channelSessionId: string; socialMessage: Record<string, unknown> };
    expect(entrada.organizationId).toBe(ORG);
    expect(entrada.channelSessionId).toBe(CANAL);
    expect(entrada.socialMessage).toMatchObject({
      platform: "instagram",
      direction: "outbound",
      kind: "message",
      participantId: RECEBEDOR,
      conversationId: RECEBEDOR,
      accountId: CONTA,
      text: "te chamei aqui",
    });
    // O id da mensagem é o da rede: é o que faz o eco ser reconhecido como repetido.
    expect(String(entrada.socialMessage.externalId)).toContain("mid.1");

    expect(r).toMatchObject({ simulada: false, sem_conversa: null, conversation_id: "dddddddd-0000-4000-8000-000000000001" });
    expect(r.comment.contact_id).toBe(r.contact_id);
    expect(r.comment.private_reply).toMatchObject({ id: "mid.1", message_id: "eeeeeeee-0000-4000-8000-000000000001", situacao: "concluida" });
    expect(r.comment.estado).toBe("respondido");
    expect(banco.tabelas.messages![0]!.metadata).toMatchObject({ origem: "resposta_privada_de_comentario", social_comment_id: COMENTARIO });
  });

  it("⭐ uma só por comentário: a segunda recebe 409 e a rede não é chamada", async () => {
    const db = montar("real");
    await responderEmPrivado(db, ORG, COMENTARIO, { text: "oi", criar_contato: true }, TOKEN);
    const erro = await recusa(responderEmPrivado(db, ORG, COMENTARIO, { text: "de novo" }, TOKEN));
    expect([erro.status, erro.code]).toEqual([409, "ja_respondido_em_privado"]);
    expect(rede).toHaveBeenCalledTimes(1);
  });

  it("sem contato e sem criar_contato: a resposta sai e NÃO cria contato nem conversa", async () => {
    const db = montar("real");
    const r = await responderEmPrivado(db, ORG, COMENTARIO, { text: "oi" }, TOKEN);
    expect(rede).toHaveBeenCalledTimes(1);
    expect(h.ingest).not.toHaveBeenCalled();
    expect(r).toMatchObject({ contact_id: null, conversation_id: null, sem_conversa: "sem_contato" });
    expect(r.comment.estado).toBe("respondido");
  });

  it("quem já escreveu por mensagem direta tem a resposta gravada na conversa, mesmo sem criar_contato", async () => {
    const db = montar("real");
    banco.tabelas.contacts!.push({
      id: "cccccccc-0000-4000-8000-0000000000bb",
      organization_id: ORG,
      social_identity: `instagram:${CONTA}:${RECEBEDOR}`,
      is_merged_into: null,
      is_blocked: false,
      is_personal: false,
      is_anonymized: false,
    });
    const r = await responderEmPrivado(db, ORG, COMENTARIO, { text: "oi" }, TOKEN);
    expect(h.ingest).toHaveBeenCalledTimes(1);
    expect(r.contact_id).toBe("cccccccc-0000-4000-8000-0000000000bb");
  });

  it("⭐ o contato criado a pedido ganha a identidade que a REDE devolveu, não a do autor do comentário", async () => {
    const db = montar("real");
    const criado = await criarContatoDoComentario(db, ORG, COMENTARIO, {}, TOKEN);
    const ficha = () => banco.tabelas.contacts!.find((c) => c.id === criado.contact_id)!;
    expect(ficha().social_identity ?? null).toBeNull();
    // O que o banco de verdade preenche por padrão na ficha nova.
    Object.assign(ficha(), { is_anonymized: false, is_merged_into: null, is_blocked: false, is_personal: false });
    const r = await responderEmPrivado(db, ORG, COMENTARIO, { text: "oi" }, TOKEN);
    expect(ficha().social_identity).toBe(`instagram:${CONTA}:${RECEBEDOR}`);
    expect(String(ficha().social_identity)).not.toContain(AUTOR);
    expect(r.contact_id).toBe(criado.contact_id);
    expect(banco.tabelas.contacts).toHaveLength(1);
  });

  it("a rede não informou quem recebeu: a resposta vale, e nada é ligado a contato", async () => {
    const db = montar("real");
    rede.mockResolvedValueOnce(respostaDaRede({ message_id: "mid.2" }));
    const r = await responderEmPrivado(db, ORG, COMENTARIO, { text: "oi", criar_contato: true }, TOKEN);
    expect(h.ingest).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sem_conversa: "identidade_nao_confirmada", contact_id: null });
    expect(r.comment.estado).toBe("respondido");
  });

  it("⭐ falha ao gravar a conversa DEPOIS de enviar não vira erro: a rede só aceita uma", async () => {
    const db = montar("real");
    h.ingest.mockRejectedValueOnce(new Error("banco fora"));
    const r = await responderEmPrivado(db, ORG, COMENTARIO, { text: "oi", criar_contato: true }, TOKEN);
    expect(r).toMatchObject({ simulada: false, sem_conversa: "falha_ao_gravar" });
    expect(r.comment.private_reply?.situacao).toBe("concluida");
    const erro = await recusa(responderEmPrivado(db, ORG, COMENTARIO, { text: "oi" }, TOKEN));
    expect(erro.code).toBe("ja_respondido_em_privado");
    expect(rede).toHaveBeenCalledTimes(1);
  });

  it("pessoa que pediu para não receber mensagens: 422 contato_bloqueado, sem rede", async () => {
    const db = montar("real");
    banco.tabelas.contacts!.push({
      id: "cccccccc-0000-4000-8000-0000000000cc",
      organization_id: ORG,
      social_identity: `instagram:${CONTA}:${AUTOR}`,
      is_merged_into: null,
      is_blocked: true,
      is_personal: false,
      is_anonymized: false,
    });
    const erro = await recusa(responderEmPrivado(db, ORG, COMENTARIO, { text: "oi" }, TOKEN));
    expect([erro.status, erro.code]).toEqual([422, "contato_bloqueado"]);
    expect(rede).not.toHaveBeenCalled();
    expect(linha().private_reply).toBeNull();
  });

  it("recusa da rede não deixa resposta privada gravada", async () => {
    const db = montar("real");
    rede.mockResolvedValueOnce(erroDaRede(551, "indisponível"));
    const erro = await recusa(responderEmPrivado(db, ORG, COMENTARIO, { text: "oi" }, TOKEN));
    expect(erro.status).toBe(502);
    expect(linha().private_reply).toBeNull();
    expect(linha().estado).toBe("novo");
    expect(h.ingest).not.toHaveBeenCalled();
  });
});

/**
 * Revisão de 20/11/2026, item 1.1 (bloqueante). A resposta gravada em modo de
 * registro é SIMULADA: nada saiu. Ela não pode valer como resposta de verdade
 * depois que a conexão passa para o modo real — senão o comentário nunca mais
 * é respondido (e a janela de 7 dias da privada vence com ele preso).
 */
describe("resposta simulada não trava a resposta real", () => {
  const passarParaReal = () => {
    const sessao = banco.tabelas.channel_sessions!.find((c) => c.id === CANAL)!;
    sessao.metadata = { ...(sessao.metadata as Record<string, unknown>), comentarios_modo: "real" };
  };

  it("⭐ pública: registrar → mudar para real → a resposta real é publicada e substitui a simulada", async () => {
    const db = montar("registrar");
    await responderEmPublico(db, ORG, COMENTARIO, { text: "ensaio" }, TOKEN);
    expect(rede).not.toHaveBeenCalled();
    passarParaReal();

    const r = await responderEmPublico(db, ORG, COMENTARIO, { text: "de verdade" }, TOKEN);
    expect(rede).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(chamadasARede()[0]!.init.body))).toEqual({ message: "de verdade" });
    expect(r.simulada).toBe(false);
    expect(r.comment.public_reply).toMatchObject({ id: "17999000111", texto: "de verdade", simulada: false, situacao: "concluida" });
    expect(r.comment.estado).toBe("respondido");
  });

  it("⭐ privada: registrar → mudar para real → a mensagem sai e entra na conversa", async () => {
    const db = montar("registrar");
    await responderEmPrivado(db, ORG, COMENTARIO, { text: "ensaio", criar_contato: true }, TOKEN);
    expect(rede).not.toHaveBeenCalled();
    passarParaReal();

    const r = await responderEmPrivado(db, ORG, COMENTARIO, { text: "de verdade", criar_contato: true }, TOKEN);
    expect(rede).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(chamadasARede()[0]!.init.body))).toEqual({
      recipient: { comment_id: ID_NA_REDE },
      message: { text: "de verdade" },
    });
    expect(r).toMatchObject({ simulada: false, sem_conversa: null });
    expect(r.comment.private_reply).toMatchObject({ id: "mid.1", texto: "de verdade", simulada: false, situacao: "concluida" });
  });

  it("⭐ as duas no mesmo comentário: simuladas em registro, e as duas saem de verdade depois", async () => {
    const db = montar("registrar");
    await responderEmPublico(db, ORG, COMENTARIO, { text: "ensaio público" }, TOKEN);
    await responderEmPrivado(db, ORG, COMENTARIO, { text: "ensaio privado" }, TOKEN);
    passarParaReal();
    await responderEmPublico(db, ORG, COMENTARIO, { text: "público" }, TOKEN);
    await responderEmPrivado(db, ORG, COMENTARIO, { text: "privado" }, TOKEN);
    expect(rede).toHaveBeenCalledTimes(2);
    expect(linha().public_reply).toMatchObject({ texto: "público", simulada: false });
    expect(linha().private_reply).toMatchObject({ texto: "privado", simulada: false });
  });

  it("⭐ real → real continua 409: a resposta de verdade nunca é substituída", async () => {
    const db = montar("real");
    await responderEmPublico(db, ORG, COMENTARIO, { text: "primeira" }, TOKEN);
    await responderEmPrivado(db, ORG, COMENTARIO, { text: "primeira" }, TOKEN);
    const publica = await recusa(responderEmPublico(db, ORG, COMENTARIO, { text: "segunda" }, TOKEN));
    const privada = await recusa(responderEmPrivado(db, ORG, COMENTARIO, { text: "segunda" }, TOKEN));
    expect([publica.status, publica.code]).toEqual([409, "ja_respondido"]);
    expect([privada.status, privada.code]).toEqual([409, "ja_respondido_em_privado"]);
    expect(rede).toHaveBeenCalledTimes(2);
  });

  it("⭐ real → voltar para registrar: a resposta de verdade continua valendo (409), nada é simulado por cima", async () => {
    const db = montar("real");
    await responderEmPublico(db, ORG, COMENTARIO, { text: "de verdade" }, TOKEN);
    const sessao = banco.tabelas.channel_sessions!.find((c) => c.id === CANAL)!;
    sessao.metadata = { ...(sessao.metadata as Record<string, unknown>), comentarios_modo: "registrar" };
    const erro = await recusa(responderEmPublico(db, ORG, COMENTARIO, { text: "ensaio" }, TOKEN));
    expect([erro.status, erro.code]).toEqual([409, "ja_respondido"]);
    expect(linha().public_reply).toMatchObject({ texto: "de verdade", simulada: false });
  });

  it("⭐ em modo de registro, repetir a simulação continua recusado com a resposta existente (nada é regravado)", async () => {
    const db = montar("registrar");
    await responderEmPublico(db, ORG, COMENTARIO, { text: "ensaio" }, TOKEN);
    await responderEmPrivado(db, ORG, COMENTARIO, { text: "ensaio" }, TOKEN);
    const publica = await recusa(responderEmPublico(db, ORG, COMENTARIO, { text: "outro ensaio" }, TOKEN));
    const privada = await recusa(responderEmPrivado(db, ORG, COMENTARIO, { text: "outro ensaio" }, TOKEN));
    expect([publica.status, publica.code]).toEqual([409, "ja_respondido"]);
    expect((publica.details as { resposta: { texto: string; simulada: boolean } }).resposta).toMatchObject({
      texto: "ensaio",
      simulada: true,
    });
    expect([privada.status, privada.code]).toEqual([409, "ja_respondido_em_privado"]);
    expect(linha().public_reply).toMatchObject({ texto: "ensaio", simulada: true });
    expect(linha().private_reply).toMatchObject({ texto: "ensaio", simulada: true });
    expect(rede).not.toHaveBeenCalled();
  });

  it("⭐ privada com a janela de 7 dias vencida continua recusada, com simulada anterior e modo real", async () => {
    const db = montar("registrar", { commented_at: haDias(6) });
    await responderEmPrivado(db, ORG, COMENTARIO, { text: "ensaio" }, TOKEN);
    passarParaReal();
    linha().commented_at = haDias(8);
    const erro = await recusa(responderEmPrivado(db, ORG, COMENTARIO, { text: "tarde demais" }, TOKEN));
    expect([erro.status, erro.code]).toEqual([422, "janela_de_7_dias"]);
    expect(rede).not.toHaveBeenCalled();
    expect(linha().private_reply).toMatchObject({ texto: "ensaio", simulada: true });
  });

  it("⭐ a rede recusa a resposta real: a simulada anterior volta ao registro, e dá para tentar de novo", async () => {
    const db = montar("registrar");
    await responderEmPublico(db, ORG, COMENTARIO, { text: "ensaio" }, TOKEN);
    passarParaReal();
    rede.mockResolvedValueOnce(erroDaRede(100, "Invalid parameter"));
    await recusa(responderEmPublico(db, ORG, COMENTARIO, { text: "de verdade" }, TOKEN));
    expect(linha().public_reply).toMatchObject({ texto: "ensaio", simulada: true, situacao: "concluida" });

    const r = await responderEmPublico(db, ORG, COMENTARIO, { text: "de verdade" }, TOKEN);
    expect(r.comment.public_reply).toMatchObject({ texto: "de verdade", simulada: false });
    expect(rede).toHaveBeenCalledTimes(2);
  });

  it("⭐ duas chamadas reais ao mesmo tempo sobre a simulada: só uma publica", async () => {
    const db = montar("registrar");
    await responderEmPublico(db, ORG, COMENTARIO, { text: "ensaio" }, TOKEN);
    passarParaReal();
    const desfechos = await Promise.allSettled([
      responderEmPublico(db, ORG, COMENTARIO, { text: "a" }, TOKEN),
      responderEmPublico(db, ORG, COMENTARIO, { text: "b" }, TOKEN),
    ]);
    expect(desfechos.filter((d) => d.status === "fulfilled")).toHaveLength(1);
    expect(((desfechos.find((d) => d.status === "rejected") as PromiseRejectedResult).reason as ApiError).status).toBe(409);
    expect(rede).toHaveBeenCalledTimes(1);
  });

  it("⭐ a simulada substituída fica na auditoria: a entrada dela existe, e a real diz o que substituiu", async () => {
    const db = montar("registrar");
    await responderEmPublico(db, ORG, COMENTARIO, { text: "ensaio" }, TOKEN);
    const quandoDaSimulada = (linha().public_reply as { quando: string }).quando;
    passarParaReal();
    await responderEmPublico(db, ORG, COMENTARIO, { text: "de verdade" }, TOKEN);
    const entradas = h.audit.mock.calls.map(([e]) => e as { action: string; metadata: Record<string, unknown> });
    expect(entradas.map((e) => [e.action, e.metadata.simulada])).toEqual([
      ["social_comment.respondido", true],
      ["social_comment.respondido", false],
    ]);
    expect(entradas[1]!.metadata.substituiu_simulada).toEqual({ quando: quandoDaSimulada });
    expect(entradas[0]!.metadata).not.toHaveProperty("substituiu_simulada");
  });
});

describe("ocultar", () => {
  it("modo real chama a rede uma vez com hide; ocultar de novo não chama", async () => {
    const db = montar("real");
    const r = await ocultarComentario(db, ORG, COMENTARIO, TOKEN);
    const { url, init } = chamadasARede()[0]!;
    expect(url.pathname.endsWith(`/${ID_NA_REDE}`)).toBe(true);
    expect(JSON.parse(String(init.body))).toEqual({ hide: true });
    expect(r).toMatchObject({ simulada: false, ja_estava_oculto: false });
    expect(r.comment.hidden).toMatchObject({ simulada: false });
    const denovo = await ocultarComentario(db, ORG, COMENTARIO, TOKEN);
    expect(denovo.ja_estava_oculto).toBe(true);
    expect(rede).toHaveBeenCalledTimes(1);
    expect(h.audit).toHaveBeenCalledTimes(1);
  });

  it("modo registrar não chama a rede, e recusa da rede não grava a ocultação", async () => {
    const r = await ocultarComentario(montar("registrar"), ORG, COMENTARIO, TOKEN);
    expect(rede).not.toHaveBeenCalled();
    expect(r.simulada).toBe(true);

    const db = montar("real");
    rede.mockResolvedValueOnce(erroDaRede(100));
    await recusa(ocultarComentario(db, ORG, COMENTARIO, TOKEN));
    expect(linha().hidden).toBeNull();
  });
});

describe("ignorar", () => {
  it("vira sem_acao com o motivo, sem rede, em qualquer modo do canal — e é auditado", async () => {
    const db = montar(null);
    const r = await ignorarComentario(db, ORG, COMENTARIO, { motivo: "só um elogio" }, TOKEN);
    expect(r.comment).toMatchObject({ estado: "sem_acao", ignore_reason: "só um elogio" });
    expect(rede).not.toHaveBeenCalled();
    expect(h.audit.mock.calls[0]![0]).toMatchObject({ action: "social_comment.ignorado", actorApiTokenId: "tok-1" });
    // Repetir igual não audita de novo.
    await ignorarComentario(db, ORG, COMENTARIO, { motivo: "só um elogio" }, TOKEN);
    expect(h.audit).toHaveBeenCalledTimes(1);
  });

  it("comentário já respondido não é ignorado; o de outra organização não existe", async () => {
    const erro = await recusa(ignorarComentario(montar("real", { estado: "respondido" }), ORG, COMENTARIO, {}, TOKEN));
    expect([erro.status, erro.code]).toEqual([409, "ja_respondido"]);
    const alheio = await recusa(ignorarComentario(montar("real"), ORG, DA_OUTRA_ORG, {}, TOKEN));
    expect(alheio.status).toBe(404);
    expect(linha(DA_OUTRA_ORG).estado).toBe("novo");
  });
});

describe("criar contato", () => {
  it("⭐ cria o contato SEM identidade social, liga ao comentário, e chamar de novo devolve o mesmo", async () => {
    const db = montar("real");
    const r = await criarContatoDoComentario(db, ORG, COMENTARIO, {}, TOKEN);
    expect(r).toMatchObject({ contato_ja_existia: false, lead: null });
    const ficha = banco.tabelas.contacts![0]!;
    expect(ficha).toMatchObject({ organization_id: ORG, name: "@cliente.exemplo", source: "social" });
    expect("social_identity" in ficha).toBe(false);
    expect(r.comment.contact_id).toBe(r.contact_id);
    expect(rede).not.toHaveBeenCalled();

    const denovo = await criarContatoDoComentario(db, ORG, COMENTARIO, {}, TOKEN);
    expect(denovo).toMatchObject({ contact_id: r.contact_id, contato_ja_existia: true });
    expect(banco.tabelas.contacts).toHaveLength(1);
  });

  // Revisão de 20/11, item 2.23: duas chamadas ao mesmo tempo criavam dois contatos.
  it("⭐ duas chamadas ao mesmo tempo no MESMO comentário criam UM contato, e as duas devolvem o mesmo", async () => {
    const db = montar("real");
    const [a, b] = await Promise.all([
      criarContatoDoComentario(db, ORG, COMENTARIO, {}, TOKEN),
      criarContatoDoComentario(db, ORG, COMENTARIO, {}, TOKEN),
    ]);
    expect(banco.tabelas.contacts).toHaveLength(1);
    expect(a.contact_id).toBe(b.contact_id);
    expect(linha().contact_id).toBe(a.contact_id);
    expect([a.contato_ja_existia, b.contato_ja_existia].sort()).toEqual([false, true]);
  });

  it("três chamadas ao mesmo tempo, com funil: um contato só, e o negócio é pedido para ele", async () => {
    const db = montar("real");
    banco.tabelas.crm_stages!.push({ id: "etapa-1", organization_id: ORG, pipeline_id: "ffffffff-0000-4000-8000-000000000001", is_archived: false, position: 1 });
    h.cardAberto.mockResolvedValue(null);
    h.criarLead.mockResolvedValue({ id: "lead-novo" });
    const pedidos = [1, 2, 3].map(() =>
      criarContatoDoComentario(db, ORG, COMENTARIO, { pipeline_id: "ffffffff-0000-4000-8000-000000000001" }, TOKEN),
    );
    const r = await Promise.all(pedidos);
    expect(banco.tabelas.contacts).toHaveLength(1);
    expect(new Set(r.map((x) => x.contact_id)).size).toBe(1);
  });

  it("a outra chamada some no meio (não liga o contato): recusa com 409, sem criar um segundo", async () => {
    const db = montar("real");
    // Simula a chamada concorrente que tomou a vez e ainda não terminou: a
    // linha muda entre a leitura e a tomada da vez, e o contato não aparece.
    // As consultas a `social_comments`, na ordem: ler o comentário, procurar
    // outro do mesmo autor, tomar a vez. A linha muda antes da terceira.
    const original = banco.from.bind(banco);
    let consultas = 0;
    banco.from = (tabela: string) => {
      if (tabela === "social_comments" && ++consultas === 3) {
        linha().updated_at = new Date(Date.now() + 5_000).toISOString();
      }
      return original(tabela);
    };
    const erro = await recusa(criarContatoDoComentario(db, ORG, COMENTARIO, {}, TOKEN));
    expect([erro.status, erro.code]).toEqual([409, "contato_em_criacao"]);
    expect(banco.tabelas.contacts).toHaveLength(0);
    expect(linha().contact_id).toBeNull();
  });

  it("outro comentário do MESMO autor reaproveita o contato; o de outra organização, não", async () => {
    const db = montar("real");
    const outro = "aaaaaaaa-0000-4000-8000-000000000009";
    banco.tabelas.social_comments!.push(comentario(outro, ORG, { comment_id: "1700000000000000" }));
    const primeiro = await criarContatoDoComentario(db, ORG, COMENTARIO, {}, TOKEN);
    const segundo = await criarContatoDoComentario(db, ORG, outro, {}, TOKEN);
    expect(segundo).toMatchObject({ contact_id: primeiro.contact_id, contato_ja_existia: true });

    const daOutra = await criarContatoDoComentario(db, OUTRA_ORG, DA_OUTRA_ORG, {}, TOKEN);
    expect(daOutra.contato_ja_existia).toBe(false);
    expect(daOutra.contact_id).not.toBe(primeiro.contact_id);
  });

  it("com funil: reaproveita o card aberto do contato, pela regra da captação", async () => {
    const db = montar("real");
    h.cardAberto.mockResolvedValueOnce({ id: "lead-aberto" });
    const r = await criarContatoDoComentario(db, ORG, COMENTARIO, { pipeline_id: "ffffffff-0000-4000-8000-000000000001" }, TOKEN);
    expect(r.lead).toEqual({ id: "lead-aberto", ja_existia: true });
    expect(h.criarLead).not.toHaveBeenCalled();
    expect(h.cardAberto.mock.calls[0]![1]).toMatchObject({
      opcaoDaFonteLigada: true,
      organizationId: ORG,
      contactId: r.contact_id,
      pipelineId: "ffffffff-0000-4000-8000-000000000001",
    });
  });

  it("com funil e sem card aberto: cria o negócio na primeira etapa ativa, em nome de quem agiu", async () => {
    const db = montar("real");
    const funil = "ffffffff-0000-4000-8000-000000000001";
    banco.tabelas.crm_stages = [
      { id: "etapa-2", organization_id: ORG, pipeline_id: funil, position: 2, is_archived: false },
      { id: "etapa-0", organization_id: ORG, pipeline_id: funil, position: 0, is_archived: true },
      { id: "etapa-1", organization_id: ORG, pipeline_id: funil, position: 1, is_archived: false },
      { id: "etapa-alheia", organization_id: OUTRA_ORG, pipeline_id: funil, position: 0, is_archived: false },
    ];
    h.cardAberto.mockResolvedValueOnce(null);
    h.criarLead.mockResolvedValueOnce({ id: "lead-novo" });
    const r = await criarContatoDoComentario(db, ORG, COMENTARIO, { pipeline_id: funil }, TOKEN);
    expect(r.lead).toEqual({ id: "lead-novo", ja_existia: false });
    const [, ctx, entrada] = h.criarLead.mock.calls[0]!;
    expect(ctx).toMatchObject({ organization_id: ORG, actor: TOKEN.actor, requestId: "req-1" });
    expect(entrada).toMatchObject({ pipeline_id: funil, stage_id: "etapa-1", contact_id: r.contact_id, title: "@cliente.exemplo" });
    expect(h.audit.mock.calls.at(-1)![0]).toMatchObject({
      action: "social_comment.contato_criado",
      metadata: { contact_id: r.contact_id, lead_id: "lead-novo", lead_ja_existia: false },
    });
  });

  it("contato anonimizado a pedido do titular não ganha um substituto", async () => {
    const db = montar("real", { contact_id: "cccccccc-0000-4000-8000-0000000000dd" });
    banco.tabelas.contacts!.push({
      id: "cccccccc-0000-4000-8000-0000000000dd",
      organization_id: ORG,
      is_merged_into: null,
      is_blocked: false,
      is_personal: false,
      is_anonymized: true,
    });
    const erro = await recusa(criarContatoDoComentario(db, ORG, COMENTARIO, {}, TOKEN));
    expect([erro.status, erro.code]).toEqual([409, "contato_anonimizado"]);
    expect(banco.tabelas.contacts).toHaveLength(1);
  });
});

describe("toda consulta filtra pela organização", () => {
  it("⭐ nenhuma leitura ou escrita em social_comments, contacts ou channel_sessions sai sem organization_id", async () => {
    const db = montar("real");
    await listarComentarios(db, ORG, {}, TOKEN);
    await criarContatoDoComentario(db, ORG, COMENTARIO, {}, TOKEN);
    await responderEmPublico(db, ORG, COMENTARIO, { text: "oi" }, TOKEN);
    await responderEmPrivado(db, ORG, COMENTARIO, { text: "oi" }, TOKEN);
    await ocultarComentario(db, ORG, COMENTARIO, TOKEN);
    const semOrg = banco.chamadas
      .filter((c) => ["social_comments", "contacts", "channel_sessions", "conversations", "messages"].includes(c.tabela))
      .filter((c) => c.operacao !== "insert")
      .filter((c) => !c.filtros.includes("eq:organization_id"));
    expect(banco.chamadas.length).toBeGreaterThan(10);
    expect(semOrg).toEqual([]);
  });
});
