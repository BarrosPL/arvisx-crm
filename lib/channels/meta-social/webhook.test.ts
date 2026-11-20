/**
 * Leitura do webhook da Messenger Platform (Messenger e Instagram) — pura.
 * O que se prova: QUAL conta (é ela que roteia à organização), QUEM é o
 * participante (é o endereço da resposta), e que eco, entrega e leitura não
 * viram mensagem nova.
 */
import { describe, expect, it } from "vitest";

import { lerWebhookDireto } from "./webhook";

const PAGINA = "1111111111";
const IG = "17840000000000001";
const PSID = "2222222222";

function envelope(object: string, id: string, messaging: unknown[]) {
  return { object, entry: [{ id, time: 1_700_000_000_000, messaging }] };
}

describe("lerWebhookDireto", () => {
  it("mensagem de texto do Messenger: a conta é a página, o participante é o remetente", () => {
    const eventos = lerWebhookDireto(
      envelope("page", PAGINA, [
        { sender: { id: PSID }, recipient: { id: PAGINA }, timestamp: 1_700_000_000_123, message: { mid: "m_1", text: "Oi" } },
      ]),
    );
    expect(eventos).toEqual([
      {
        tipo: "mensagem",
        rede: "facebook",
        conta: PAGINA,
        participante: PSID,
        mid: "m_1",
        texto: "Oi",
        anexos: [],
        quando: new Date(1_700_000_000_123).toISOString(),
        eco: false,
        appId: null,
      },
    ]);
  });

  it("Instagram: `object: instagram` vira rede instagram, com a conta profissional como conta", () => {
    const [e] = lerWebhookDireto(
      envelope("instagram", IG, [{ sender: { id: "333" }, recipient: { id: IG }, timestamp: 1, message: { mid: "ig_1", text: "olá" } }]),
    );
    expect(e).toMatchObject({ tipo: "mensagem", rede: "instagram", conta: IG, participante: "333" });
  });

  it("eco: o participante é o DESTINATÁRIO, e o app que enviou vem junto", () => {
    const [e] = lerWebhookDireto(
      envelope("page", PAGINA, [
        {
          sender: { id: PAGINA },
          recipient: { id: PSID },
          timestamp: 1,
          message: { mid: "m_eco", text: "resposta", is_echo: true, app_id: 987654321 },
        },
      ]),
    );
    expect(e).toMatchObject({ tipo: "mensagem", eco: true, participante: PSID, appId: "987654321" });
  });

  it("anexos: só https e só os tipos que o CRM grava; o resto vira aviso no texto", () => {
    const [comImagem] = lerWebhookDireto(
      envelope("page", PAGINA, [
        {
          sender: { id: PSID },
          recipient: { id: PAGINA },
          message: { mid: "m_2", attachments: [{ type: "image", payload: { url: "https://cdn.exemplo/x.jpg" } }] },
        },
      ]),
    );
    expect(comImagem).toMatchObject({ anexos: [{ type: "image", url: "https://cdn.exemplo/x.jpg" }], texto: null });

    const [semSuporte] = lerWebhookDireto(
      envelope("instagram", IG, [
        { sender: { id: "333" }, recipient: { id: IG }, message: { mid: "ig_2", attachments: [{ type: "story_mention", payload: { url: "https://x" } }] } },
      ]),
    );
    expect(semSuporte).toMatchObject({ anexos: [] });
    expect((semSuporte as { texto: string }).texto).toMatch(/não suportado/);

    expect(
      lerWebhookDireto(
        envelope("page", PAGINA, [
          { sender: { id: PSID }, recipient: { id: PAGINA }, message: { mid: "m_3", attachments: [{ type: "image", payload: { url: "http://inseguro/x.jpg" } }] } },
        ]),
      )[0],
    ).toMatchObject({ anexos: [] });
  });

  it("entrega e leitura não são mensagem nova", () => {
    const eventos = lerWebhookDireto(
      envelope("page", PAGINA, [
        { sender: { id: PSID }, recipient: { id: PAGINA }, delivery: { mids: ["m_a", "m_b"], watermark: 1_700_000_000_000 } },
        { sender: { id: PSID }, recipient: { id: PAGINA }, read: { watermark: 1_700_000_000_000 } },
      ]),
    );
    expect(eventos.map((e) => e.tipo)).toEqual(["entrega", "leitura"]);
    expect(eventos[0]).toMatchObject({ mids: ["m_a", "m_b"] });
    expect(eventos[1]).toMatchObject({ mid: null, ate: new Date(1_700_000_000_000).toISOString() });
  });

  it("postback (clique em botão) entra como mensagem com o título", () => {
    const [e] = lerWebhookDireto(
      envelope("page", PAGINA, [{ sender: { id: PSID }, recipient: { id: PAGINA }, postback: { mid: "pb_1", title: "Quero saber o preço" } }]),
    );
    expect(e).toMatchObject({ tipo: "mensagem", mid: "pb_1", texto: "Quero saber o preço", eco: false });
  });

  it("descarta o que não é da Messenger Platform, mensagem apagada e remetente igual à conta", () => {
    expect(lerWebhookDireto({ object: "whatsapp_business_account", entry: [{ id: "1", messaging: [] }] })).toEqual([]);
    expect(lerWebhookDireto("lixo")).toEqual([]);
    expect(
      lerWebhookDireto(
        envelope("page", PAGINA, [
          { sender: { id: PSID }, recipient: { id: PAGINA }, message: { mid: "m_x", text: "x", is_deleted: true } },
          { sender: { id: PAGINA }, recipient: { id: PAGINA }, message: { mid: "m_y", text: "eu mesmo" } },
          { sender: { id: "abc" }, recipient: { id: PAGINA }, message: { mid: "m_z", text: "id não numérico" } },
        ]),
      ),
    ).toEqual([]);
    expect(lerWebhookDireto(envelope("page", "nao-numerico", [{ sender: { id: PSID }, message: { mid: "m", text: "x" } }]))).toEqual([]);
  });
});

describe("lerWebhookDireto — comentários do Instagram", () => {
  const comentario = (valor: Record<string, unknown>, campo = "comments") => ({
    object: "instagram",
    entry: [{ id: IG, time: 1_763_640_000, changes: [{ field: campo, value: valor }] }],
  });
  const BASE = {
    id: "17865799348089039",
    from: { id: "232323232", username: "cliente.exemplo" },
    text: "Qual o valor?",
    media: { id: "17900000000000123", media_product_type: "REELS" },
  };

  it("lê `entry[].changes[]` com `field: comments` — a conta é `entry.id`, a hora é a da notificação", () => {
    expect(lerWebhookDireto(comentario({ ...BASE, parent_id: "17860000000000777" }))).toEqual([
      {
        tipo: "comentario",
        rede: "instagram",
        conta: IG,
        commentId: "17865799348089039",
        parentId: "17860000000000777",
        mediaId: "17900000000000123",
        mediaProductType: "REELS",
        adId: null,
        adTitle: null,
        autorId: "232323232",
        autorUsuario: "cliente.exemplo",
        texto: "Qual o valor?",
        aoVivo: false,
        proprio: false,
        quando: new Date(1_763_640_000_000).toISOString(),
      },
    ]);
  });

  it("`live_comments` sai marcado como ao vivo; `mentions` e campo desconhecido são ignorados", () => {
    expect(lerWebhookDireto(comentario(BASE, "live_comments"))[0]).toMatchObject({ tipo: "comentario", aoVivo: true });
    expect(lerWebhookDireto(comentario(BASE, "mentions"))).toEqual([]);
    expect(lerWebhookDireto(comentario(BASE, "story_insights"))).toEqual([]);
  });

  it("aceita os dois formatos da doc: `comment_id` no lugar de `id`, e o anúncio dentro de `media`", () => {
    const [porExemplo] = lerWebhookDireto(
      comentario({
        comment_id: "17865799348089040",
        from: BASE.from,
        text: "Oi",
        media: { id: "179", media_product_type: "AD", ad_id: "1202", ad_title: "Campanha" },
      }),
    );
    expect(porExemplo).toMatchObject({ commentId: "17865799348089040", adId: "1202", adTitle: "Campanha" });
    const [porReferencia] = lerWebhookDireto(comentario({ ...BASE, ad_id: "1203", ad_title: "Outra" }));
    expect(porReferencia).toMatchObject({ commentId: "17865799348089039", adId: "1203", adTitle: "Outra" });
  });

  it("o envelope do login direto do Instagram (sem `changes`) também é lido", () => {
    const eventos = lerWebhookDireto({
      object: "instagram",
      entry: [{ id: IG, time: 1_763_640_000, field: "comments", value: BASE }],
    });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ tipo: "comentario", conta: IG, commentId: "17865799348089039" });
  });

  it("comentário escrito pela própria conta sai marcado como `proprio`", () => {
    const [evento] = lerWebhookDireto(comentario({ ...BASE, from: { id: IG, username: "loja" } }));
    expect(evento).toMatchObject({ tipo: "comentario", proprio: true });
    // `self_ig_scoped_id` sozinho não marca: só a igualdade com a conta.
    const [deFora] = lerWebhookDireto(comentario({ ...BASE, from: { ...BASE.from, self_ig_scoped_id: "999" } }));
    expect(deFora).toMatchObject({ proprio: false });
  });

  it("o texto não é cortado, e comentário sem texto continua sendo comentário", () => {
    const longo = "a".repeat(2200);
    expect(lerWebhookDireto(comentario({ ...BASE, text: longo }))[0]).toMatchObject({ texto: longo });
    expect(lerWebhookDireto(comentario({ ...BASE, text: undefined }))[0]).toMatchObject({ texto: null });
  });

  it("id de comentário ausente ou com caractere de caminho é descartado; os outros ids viram nulos", () => {
    expect(lerWebhookDireto(comentario({ ...BASE, id: undefined }))).toEqual([]);
    expect(lerWebhookDireto(comentario({ ...BASE, id: "123/replies" }))).toEqual([]);
    expect(lerWebhookDireto(comentario({ ...BASE, id: "../me" }))).toEqual([]);
    expect(lerWebhookDireto(comentario("lixo" as never))).toEqual([]);
    expect(lerWebhookDireto(comentario({ ...BASE, parent_id: "a b", media: { id: "x/y" } }))[0]).toMatchObject({
      parentId: null,
      mediaId: null,
    });
  });

  it("comentário NÃO é lido no objeto `page` (Facebook fica fora) e não atrapalha as mensagens", () => {
    expect(
      lerWebhookDireto({ object: "page", entry: [{ id: PAGINA, time: 1, changes: [{ field: "comments", value: BASE }] }] }),
    ).toEqual([]);
    const misto = lerWebhookDireto({
      object: "instagram",
      entry: [
        {
          id: IG,
          time: 1_763_640_000,
          changes: [{ field: "comments", value: BASE }],
          messaging: [{ sender: { id: PSID }, recipient: { id: IG }, timestamp: 1_700_000_000_123, message: { mid: "m_1", text: "Oi" } }],
        },
      ],
    });
    expect(misto.map((e) => e.tipo)).toEqual(["comentario", "mensagem"]);
  });
});
