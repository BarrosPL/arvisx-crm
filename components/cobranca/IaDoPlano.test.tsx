/**
 * A IA INCLUÍDA NO PLANO NA TELA (Tarefa 8, parte 1): franquia usada e total, e
 * o aviso. O mesmo bloco aparece em Uso de IA e em Plano e cobrança.
 *
 *     pnpm vitest run components/cobranca/IaDoPlano.test.tsx
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PainelDaAssinatura } from "@/components/cobranca/PainelDaAssinatura";
import { iaDoPlanoNaTela, type IaDoPlanoNaTela } from "@/lib/cobranca/ia-do-plano";
import type { DadosDoPainel } from "@/lib/cobranca/painel";

import { IaDoPlano } from "./IaDoPlano";

afterEach(cleanup);

const linha = (d: Record<string, unknown>) => ({
  com_assinatura: true,
  teto: 1200,
  franquia: 300,
  gasto: 0,
  conversas: 0,
  ciclo_inicio: "2026-11-10T00:00:00.000Z",
  ciclo_fim: "2026-12-10T00:00:00.000Z",
  pelo_periodo_pago: true,
  ...d,
});
const naTela = (d: Record<string, unknown>) => iaDoPlanoNaTela(linha(d)) as IaDoPlanoNaTela;
const desenhar = (ia: IaDoPlanoNaTela, idioma: "pt-BR" | "es" = "pt-BR") =>
  render(<IaDoPlano ia={ia} idioma={idioma} fuso="UTC" />);
const aviso = () => document.querySelector("[data-aviso-da-ia-do-plano]");

describe("a leitura do banco vira o que a tela mostra", () => {
  it("empresa sem assinatura não tem bloco: nada a mostrar", () => {
    expect(iaDoPlanoNaTela(linha({ com_assinatura: false, teto: null, franquia: null }))).toBeNull();
    expect(iaDoPlanoNaTela(null)).toBeNull();
  });

  it.each([
    ["normal", { conversas: 239, gasto: 100 }, "normal"],
    ["80% da franquia", { conversas: 240, gasto: 100 }, "perto_do_fim"],
    ["80% do teto em dólar, com a franquia com folga", { conversas: 10, gasto: 960 }, "perto_do_fim"],
    ["franquia cheia", { conversas: 300, gasto: 100 }, "esgotada"],
    ["teto em dólar atingido", { conversas: 10, gasto: 1200 }, "esgotada"],
    ["plano sem teto", { teto: null, franquia: null }, "sem_teto"],
  ] as const)("%s", (_caso, dados, situacao) => {
    expect(naTela(dados).situacao).toBe(situacao);
  });

  it("o teto em dólar vira percentual, e nunca valor em dinheiro", () => {
    const ia = naTela({ gasto: 600 });
    expect(ia.percentualDoUsoIncluido).toBe(50);
    expect(JSON.stringify(ia)).not.toMatch(/1200|600/);
  });
});

describe("o bloco na tela", () => {
  it("⭐ mostra a franquia usada e o total, e o percentual do uso incluído", () => {
    desenhar(naTela({ conversas: 120, gasto: 300 }));
    expect(document.querySelector('[data-uso="conversas-com-ia"]')!.textContent).toBe("120 de 300");
    expect(document.querySelector('[data-uso="ia-incluida"]')!.textContent).toBe("25%");
    expect(aviso(), "avisou sem motivo").toBeNull();
  });

  it("diz quando o ciclo renova, e se ele acompanha a assinatura ou o mês", () => {
    const { container, unmount } = desenhar(naTela({}));
    expect(container.textContent).toContain("O ciclo acompanha a sua assinatura e renova em");
    unmount();
    const outro = desenhar(naTela({ pelo_periodo_pago: false }));
    expect(outro.container.textContent).toContain("O ciclo é o mês e renova em");
  });

  it("⭐ a 80%: avisa, com as duas saídas (pacote extra e chave própria)", () => {
    desenhar(naTela({ conversas: 240 }));
    const texto = aviso()!.textContent!;
    expect(aviso()!.getAttribute("data-aviso-da-ia-do-plano")).toBe("perto_do_fim");
    expect(texto).toContain("está perto do fim neste ciclo");
    expect(texto).toContain("fale com a ArvisX para contratar um pacote extra");
    expect(texto).toContain("cadastre uma chave de IA própria em IA › Credenciais");
  });

  it("⭐ no estouro: diz que acabou, que as conversas novas vão para a equipe, e as duas saídas", () => {
    desenhar(naTela({ conversas: 300 }));
    const texto = aviso()!.textContent!;
    expect(aviso()!.getAttribute("role")).toBe("alert");
    expect(texto).toContain("A IA incluída no plano acabou neste ciclo. As conversas novas vão para a equipe.");
    expect(texto).toContain("fale com a ArvisX para contratar um pacote extra");
    expect(texto).toContain("cadastre uma chave de IA própria em IA › Credenciais");
  });

  it("⭐ plano sem teto: diz que a IA incluída não foi liberada, e as duas saídas", () => {
    desenhar(naTela({ teto: null, franquia: null }));
    const texto = aviso()!.textContent!;
    expect(texto).toContain("não tem limite de uso de IA configurado, e por isso a IA incluída não foi liberada");
    expect(texto).toContain("cadastre uma chave de IA própria em IA › Credenciais");
    expect(document.querySelector('[data-uso="conversas-com-ia"]')!.textContent).toBe("0 · sem limite");
  });

  it("em espanhol o bloco sai traduzido", () => {
    desenhar(naTela({ conversas: 300 }), "es");
    expect(screen.getByText("IA incluida en el plan")).toBeTruthy();
    expect(aviso()!.textContent).toContain("habla con ArvisX para contratar un paquete extra");
  });
});

describe("Plano e cobrança mostra o mesmo bloco", () => {
  const PLANO = { id: "p", nome: "Plano 1", preco_cents: 12990, moeda: "EUR" as const, intervalo: "mes", max_assentos: 5, max_canais: 3, teto_ia_usd_cents: 1200, inclui_agentes_arvisx: false };
  const ASSINATURA = {
    estado: "ativa" as const, trial_ate: null, prazo_extra_ate: null, proximo_vencimento: "2026-12-10T00:00:00Z", vencida_desde: null,
    cancela_no_fim: false, modo: "producao" as const, provedor: "stripe" as const, provedor_assinatura_id: "sub_1", link_de_pagamento: null,
    assinaturas_vivas: 1, plano_agendado: null, periodo_pago_desde: "2026-11-10T00:00:00Z", troca_pagamento_url: null, troca_status: null,
    pagamento_inicial_pendente: false,
  };
  const dados = (iaDoPlano: IaDoPlanoNaTela | null | undefined) =>
    ({
      assinatura: ASSINATURA, plano: PLANO, aguardaContatoDaEquipe: false, iva: false, uso: { assentos: 1, canais: 1 },
      gastoIaUsdCents: 120, iaDoPlano, planosParaTroca: [], escolheAoAssinar: false, planosParaAssinar: [], fuso: "UTC",
    }) as unknown as DadosDoPainel;

  it("⭐ com a leitura da IA do plano: franquia usada e total, e o aviso; a linha antiga em dólar sai", () => {
    render(<PainelDaAssinatura dados={dados(naTela({ conversas: 240 }))} idioma="pt-BR" />);
    expect(document.querySelector('[data-uso="conversas-com-ia"]')!.textContent).toBe("240 de 300");
    expect(aviso()).not.toBeNull();
    expect(document.querySelector('[data-uso="ia"]'), "a linha de gasto em dólar ficou ao lado da franquia").toBeNull();
  });

  it("sem a leitura (falhou): fica o gasto do mês, como antes", () => {
    render(<PainelDaAssinatura dados={dados(null)} idioma="pt-BR" />);
    expect(document.querySelector('[data-uso="ia"]')).not.toBeNull();
    expect(document.querySelector('[data-uso="conversas-com-ia"]')).toBeNull();
  });
});
