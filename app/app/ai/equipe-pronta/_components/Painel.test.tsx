/**
 * O PAINEL DA EQUIPE PRONTA: o aviso de "gatilhos não instalados".
 *
 * Revisão de 20/11, item 2.7. Quem instalou a equipe antes de os gatilhos
 * existirem fica com os quatro agentes "em dia" (as respostas não mudaram), e
 * a tela só olhava a situação dos agentes: nenhum aviso, nenhum botão. A
 * equipe seguia sem retomar quem faltou nem a proposta parada, e a única pista
 * era a nota de versão.
 *
 *     pnpm vitest run "app/app/ai/equipe-pronta/_components/Painel.test.tsx"
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EstadoDaEquipe } from "@/lib/ai/equipe-pronta/estado";

import { Painel } from "./Painel";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));

const agente = (papel: EstadoDaEquipe["agentes"][number]["papel"]): EstadoDaEquipe["agentes"][number] => ({
  papel,
  agent_id: `agente-${papel}`,
  situacao: "em_dia",
  publicado: true,
  versao_do_papel_instalada: 2,
  nome: `Agente ${papel}`,
  descricao: "Descrição",
  versao_do_papel: 2,
  texto_gerado: null,
  atualizacao_disponivel: null,
});

/** A equipe instalada e em dia: nenhum agente pede reinstalação. */
function estado(mudancas: Partial<EstadoDaEquipe> = {}): EstadoDaEquipe {
  return {
    respostas: {},
    estado: "instalado",
    modo: "ativo",
    pausada: false,
    instalado_em: "2026-11-18T10:00:00.000Z",
    perfil_completo: true,
    faltam: [],
    agentes: [agente("sdr"), agente("agendamento"), agente("proposta"), agente("recuperador")],
    atualizacao_disponivel: [],
    gatilhos_que_faltam: [],
    checklist: [],
    pode_ativar: true,
    ...mudancas,
  };
}

function montar(e: EstadoDaEquipe, administra = true) {
  const aoInstalar = vi.fn();
  render(
    <Painel
      estado={e}
      administra={administra}
      ocupado={false}
      aoAtivar={vi.fn()}
      aoPausar={vi.fn()}
      aoRetomar={vi.fn()}
      aoInstalar={aoInstalar}
      aoEditar={vi.fn()}
    />,
  );
  return { aoInstalar };
}

describe("Painel — gatilhos não instalados", () => {
  it("equipe em dia e com os gatilhos: nenhum aviso, e nenhum botão de instalar de novo", () => {
    montar(estado());
    expect(screen.queryByTestId("ep-gatilhos-nao-instalados")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ep-reinstalar")).not.toBeInTheDocument();
  });

  it("⭐ agentes em dia, gatilhos faltando: o aviso aparece, diz o que falta e o botão instala de novo", () => {
    const { aoInstalar } = montar(
      estado({ gatilhos_que_faltam: ["fluxo_de_falta", "fluxo_de_proposta_parada", "regra_de_proposta_parada"] }),
    );
    const aviso = screen.getByTestId("ep-gatilhos-nao-instalados");
    expect(aviso).toHaveTextContent("Os gatilhos da equipe ainda não foram instalados");
    const itens = screen.getByTestId("ep-gatilhos-que-faltam").querySelectorAll("li");
    expect([...itens].map((li) => li.getAttribute("data-gatilho"))).toEqual([
      "fluxo_de_falta",
      "fluxo_de_proposta_parada",
      "regra_de_proposta_parada",
    ]);
    expect(aviso).toHaveTextContent("Retomar quem faltou a um compromisso e oferecer um novo horário");
    expect(aviso).toHaveTextContent("Retomar a proposta que ficou sem resposta");

    fireEvent.click(screen.getByTestId("ep-instalar-gatilhos"));
    expect(aoInstalar).toHaveBeenCalledTimes(1);
    // O botão de sempre também aparece: antes, com os agentes em dia, não havia nenhum.
    expect(screen.getByTestId("ep-reinstalar")).toBeInTheDocument();
  });

  it("⭐ o aviso diz o que instalar de novo SUBSTITUI: edições feitas fora da equipe", () => {
    montar(estado({ gatilhos_que_faltam: ["fluxo_de_falta"] }));
    const texto = screen.getByTestId("ep-o-que-reinstalar-substitui");
    expect(texto).toHaveTextContent("substitui o que foi editado fora da equipe pronta");
    expect(texto).toHaveTextContent("sem perguntar");
    expect(texto).toHaveTextContent("pedem confirmação antes");
  });

  it("só o que falta entra na lista (empresa que não usa proposta só vê o de falta)", () => {
    montar(estado({ gatilhos_que_faltam: ["fluxo_de_falta"] }));
    expect(screen.getByTestId("ep-gatilhos-que-faltam").querySelectorAll("li")).toHaveLength(1);
  });

  it("quem não administra vê o aviso, sem o botão", () => {
    montar(estado({ gatilhos_que_faltam: ["fluxo_de_falta"] }), false);
    expect(screen.getByTestId("ep-gatilhos-nao-instalados")).toBeInTheDocument();
    expect(screen.queryByTestId("ep-instalar-gatilhos")).not.toBeInTheDocument();
  });

  it("resposta de um servidor anterior ao campo (sem `gatilhos_que_faltam`) não quebra a tela nem inventa aviso", () => {
    const antigo = estado();
    delete (antigo as Partial<EstadoDaEquipe>).gatilhos_que_faltam;
    montar(antigo);
    expect(screen.getByTestId("ep-painel")).toBeInTheDocument();
    expect(screen.queryByTestId("ep-gatilhos-nao-instalados")).not.toBeInTheDocument();
  });
});
