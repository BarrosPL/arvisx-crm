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
