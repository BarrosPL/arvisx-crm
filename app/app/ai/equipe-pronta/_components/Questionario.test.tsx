/**
 * O QUESTIONÁRIO DA EQUIPE PRONTA: a pergunta "tipo de negócio" (Tarefa 8, parte 4).
 *
 * A pergunta mora no primeiro passo, "Seu negócio". Escolher um ramo com pacote
 * mostra o aviso de rascunho e, nos passos seguintes, o que o pacote sugere
 * aparece como padrão do campo — e só do campo que a empresa ainda não
 * respondeu. Sem ramo ("Outro (genérico)") a tela é a de sempre.
 *
 *     pnpm vitest run "app/app/ai/equipe-pronta/_components/Questionario.test.tsx"
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PACOTE_ADVOCACIA } from "@/lib/ai/equipe-pronta/nichos/advocacia";
import type { PassoId } from "@/lib/ai/equipe-pronta/questionario";
import { SITUACOES_PADRAO_DE_HUMANO } from "@/lib/schemas/equipe-pronta";

import { Questionario, type Formulario } from "./Questionario";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));

afterEach(cleanup);

const NEGOCIO = { nome: "Empresa de Exemplo", o_que_faz: "Atende com hora marcada." };

function montar(passo: PassoId, respostas: Formulario) {
  const aoSalvar = vi.fn(async (_passo: PassoId, _respostas: Formulario) => true);
  render(
    <Questionario
      passo={passo}
      respostas={respostas}
      faltam={[]}
      opcoes={{ canais: [], funis: [], tiposDeAgenda: [] }}
      ocupado={false}
      aoSalvar={aoSalvar}
      aoIrPara={() => undefined}
      aoRevisar={() => undefined}
    />,
  );
  return aoSalvar;
}

const valorDe = (id: string) => (document.getElementById(id) as HTMLTextAreaElement | HTMLSelectElement).value;
const enviar = (passo: PassoId) => fireEvent.submit(screen.getByTestId(`ep-passo-${passo}`));

describe("a pergunta 'tipo de negócio', no passo Seu negócio", () => {
  it("⭐ oferece advocacia e 'Outro (genérico)', e começa no genérico, sem aviso de ramo", () => {
    montar("negocio", { negocio: NEGOCIO });
    const campo = document.getElementById("ep-negocio-tipo") as HTMLSelectElement;
    expect([...campo.options].map((o) => [o.value, o.textContent])).toEqual([
      ["generico", "Outro (genérico)"],
      ["advocacia", "Advocacia"],
    ]);
    expect(campo.value).toBe("generico");
    expect(screen.queryByTestId("ep-aviso-do-ramo")).toBeNull();
  });

  it("⭐ escolher advocacia mostra o aviso de rascunho, e salvar grava o tipo no bloco do negócio", async () => {
    const aoSalvar = montar("negocio", { negocio: NEGOCIO });
    fireEvent.change(document.getElementById("ep-negocio-tipo")!, { target: { value: "advocacia" } });
    const aviso = screen.getByTestId("ep-aviso-do-ramo").textContent!;
    expect(aviso).toContain("são um rascunho: ainda não foram validadas com um cliente real");
    expect(aviso).toContain(PACOTE_ADVOCACIA.resumoDasRegras);
    for (const etapa of PACOTE_ADVOCACIA.etapasSugeridas) expect(aviso).toContain(etapa);

    enviar("negocio");
    await waitFor(() => expect(aoSalvar).toHaveBeenCalledTimes(1));
    expect(aoSalvar.mock.calls[0]![1]).toEqual({ negocio: { ...NEGOCIO, tipo_de_negocio: "advocacia" } });
  });
});

describe("o pacote pré-preenche os passos seguintes", () => {
  const DO_RAMO = { negocio: { ...NEGOCIO, tipo_de_negocio: "advocacia" } };

  it("⭐ perguntas e situações do ramo aparecem como padrão e vão junto quando a pessoa salva o que viu", async () => {
    const aoSalvar = montar("regras", DO_RAMO);
    expect(valorDe("ep-qualificacao-perguntas")).toBe(PACOTE_ADVOCACIA.perguntasDeQualificacao.join("\n"));
    expect(valorDe("ep-humano-situacoes")).toBe(
      [...SITUACOES_PADRAO_DE_HUMANO, ...PACOTE_ADVOCACIA.situacoesDeHumano].join("\n"),
    );
    enviar("regras");
    await waitFor(() => expect(aoSalvar).toHaveBeenCalledTimes(1));
    const corpo = aoSalvar.mock.calls[0]![1];
    expect(corpo.qualificacao).toEqual({ perguntas: [...PACOTE_ADVOCACIA.perguntasDeQualificacao] });
    expect(corpo.humano?.situacoes).toEqual([...SITUACOES_PADRAO_DE_HUMANO, ...PACOTE_ADVOCACIA.situacoesDeHumano]);
  });

  it("⭐ o que a empresa já respondeu não é trocado pelo pacote", () => {
    montar("regras", {
      ...DO_RAMO,
      qualificacao: { perguntas: ["Pergunta da empresa?"] },
      humano: { situacoes: ["Situação da empresa"] },
    });
    expect(valorDe("ep-qualificacao-perguntas")).toBe("Pergunta da empresa?");
    expect(valorDe("ep-humano-situacoes")).toBe("Situação da empresa");
  });

  it("o modelo de perguntas frequentes do ramo aparece no passo das respostas", () => {
    montar("recuperacao", DO_RAMO);
    expect(valorDe("ep-faq-texto")).toBe(PACOTE_ADVOCACIA.faqModelo);
  });

  it("⭐ sem ramo, os passos são os de sempre: sem pergunta sugerida, e o passo não grava pergunta nenhuma", async () => {
    const aoSalvar = montar("regras", { negocio: NEGOCIO });
    expect(valorDe("ep-qualificacao-perguntas")).toBe("");
    expect(valorDe("ep-humano-situacoes")).toBe(SITUACOES_PADRAO_DE_HUMANO.join("\n"));
    enviar("regras");
    await waitFor(() => expect(aoSalvar).toHaveBeenCalledTimes(1));
    expect(aoSalvar.mock.calls[0]![1].qualificacao).toEqual({});
  });
});
