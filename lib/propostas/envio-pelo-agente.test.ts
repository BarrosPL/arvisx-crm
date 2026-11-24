import { describe, expect, it } from "vitest";

import {
  MODO_DE_ENVIO_PADRAO,
  decidirEnvioPeloAgente,
  modoDeEnvioDaEmpresa,
  propostaEstaAprovada,
  type ItemParaDecidir,
  type PropostaParaDecidir,
} from "./envio-pelo-agente";

/**
 * A REGRA DE `envio_de_proposta`, sem banco.
 *
 *   • `apos_aprovacao` (padrão): só sai o rascunho que a equipe aprovou;
 *   • `direto`: sai sozinho se TODOS os itens são do catálogo, com o preço do
 *     catálogo e sem desconto. Fora disso, volta a pedir aprovação.
 */
const proposta = (extra: Partial<PropostaParaDecidir> = {}): PropostaParaDecidir => ({
  revision: 3,
  moeda: "BRL",
  condicoes: null,
  aprovada_em: null,
  aprovada_na_revisao: null,
  ...extra,
});

const item = (extra: Partial<ItemParaDecidir> = {}): ItemParaDecidir => ({
  descricao: "Plano anual",
  product_id: "p1",
  preco_unitario_cents: 10_000,
  desconto_cents: 0,
  ...extra,
});

const CATALOGO: Record<string, { preco_cents: number; moeda: string }> = {
  p1: { preco_cents: 10_000, moeda: "BRL" },
  p2: { preco_cents: 2_500, moeda: "BRL" },
};
const precoDoCatalogo = (id: string) => CATALOGO[id] ?? null;

const decidir = (
  modo: "apos_aprovacao" | "direto",
  p: PropostaParaDecidir,
  itens: ItemParaDecidir[],
  condicoesPadrao: string | null = null,
) => decidirEnvioPeloAgente({ modo, proposta: p, itens, precoDoCatalogo, condicoesPadrao });

describe("a aprovação vale para UMA revisão", () => {
  it("aprovada na revisão atual: vale", () => {
    expect(propostaEstaAprovada(proposta({ aprovada_em: "2026-11-20T10:00:00Z", aprovada_na_revisao: 3 }))).toBe(true);
  });

  it("⭐ editada depois de aprovada: a aprovação não vale mais", () => {
    expect(propostaEstaAprovada(proposta({ aprovada_em: "2026-11-20T10:00:00Z", aprovada_na_revisao: 2 }))).toBe(false);
  });

  it("nunca aprovada: não vale", () => {
    expect(propostaEstaAprovada(proposta())).toBe(false);
  });
});

describe("modo apos_aprovacao (o padrão)", () => {
  it("sem aprovação, não envia: nem com tudo do catálogo e sem desconto", () => {
    expect(decidir("apos_aprovacao", proposta(), [item()])).toEqual({ pode: false, porque: "aguardando_aprovacao" });
  });

  it("aprovada: envia", () => {
    const aprovada = proposta({ aprovada_em: "2026-11-20T10:00:00Z", aprovada_na_revisao: 3 });
    expect(decidir("apos_aprovacao", aprovada, [item({ desconto_cents: 500 })])).toEqual({ pode: true, por: "aprovacao" });
  });

  it("aprovada e depois editada: volta a pedir aprovação, dizendo por quê", () => {
    const editada = proposta({ aprovada_em: "2026-11-20T10:00:00Z", aprovada_na_revisao: 2 });
    expect(decidir("apos_aprovacao", editada, [item()])).toEqual({ pode: false, porque: "editada_depois_de_aprovada" });
  });
});

describe("modo direto", () => {
  it("⭐ tudo do catálogo, preço do catálogo, sem desconto: envia sozinho", () => {
    expect(decidir("direto", proposta(), [item(), item({ product_id: "p2", preco_unitario_cents: 2_500 })])).toEqual({
      pode: true,
      por: "direto",
    });
  });

  it.each([
    ["item_fora_do_catalogo", item({ product_id: null, descricao: "Serviço avulso" })],
    ["item_fora_do_catalogo", item({ product_id: "sumiu", descricao: "Produto desativado" })],
    ["preco_diferente_do_catalogo", item({ preco_unitario_cents: 9_000 })],
    ["preco_diferente_do_catalogo", item({ preco_unitario_cents: null })],
    ["tem_desconto", item({ desconto_cents: 1 })],
  ] as const)("⭐ %s: volta a pedir aprovação", (porque, itemFora) => {
    const r = decidir("direto", proposta(), [item({ product_id: "p2", preco_unitario_cents: 2_500 }), itemFora]);
    expect(r).toEqual({ pode: false, porque, item: itemFora.descricao });
  });

  it("moeda da proposta diferente da moeda do catálogo não é 'preço do catálogo'", () => {
    expect(decidir("direto", proposta({ moeda: "EUR" }), [item()])).toMatchObject({
      pode: false,
      porque: "preco_diferente_do_catalogo",
    });
  });

  it("condição escrita à mão pede aprovação; a condição padrão da empresa não", () => {
    const comCondicao = proposta({ condicoes: "Entrega em duas etapas." });
    expect(decidir("direto", comCondicao, [item()])).toEqual({ pode: false, porque: "condicao_fora_do_padrao" });
    expect(decidir("direto", comCondicao, [item()], " Entrega em duas etapas. ")).toEqual({ pode: true, por: "direto" });
  });

  it("fora da regra, a aprovação da equipe libera", () => {
    const aprovada = proposta({ aprovada_em: "2026-11-20T10:00:00Z", aprovada_na_revisao: 3 });
    expect(decidir("direto", aprovada, [item({ desconto_cents: 500 })])).toEqual({ pode: true, por: "aprovacao" });
  });
});

describe("o modo da empresa: falha fechada", () => {
  const cliente = (resposta: { data: unknown; error: unknown } | Error) =>
    ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (resposta instanceof Error) throw resposta;
              return resposta;
            },
          }),
        }),
      }),
    }) as never;

  it("o padrão é apos_aprovacao", () => {
    expect(MODO_DE_ENVIO_PADRAO).toBe("apos_aprovacao");
  });

  it("lê o modo do perfil da empresa", async () => {
    const perfil = { data: { respostas: { proposta: { envio_de_proposta: "direto" } } }, error: null };
    expect(await modoDeEnvioDaEmpresa(cliente(perfil), "org")).toBe("direto");
  });

  it.each([
    ["sem perfil", { data: null, error: null }],
    ["perfil sem a resposta", { data: { respostas: { proposta: {} } }, error: null }],
    ["valor desconhecido", { data: { respostas: { proposta: { envio_de_proposta: "sempre" } } }, error: null }],
    ["respostas ilegíveis", { data: { respostas: "x" }, error: null }],
    ["erro de leitura", { data: null, error: { message: "fora do ar" } }],
    ["leitura que lança", new Error("rede")],
  ])("⭐ %s: apos_aprovacao", async (_caso, resposta) => {
    expect(await modoDeEnvioDaEmpresa(cliente(resposta as never), "org")).toBe("apos_aprovacao");
  });
});
