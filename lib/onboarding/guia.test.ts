/**
 * O roteiro guiado dentro do CRM (ArvisX, `ONBOARDING_GUIADO`).
 *
 * O que estes casos seguram:
 *  - desligado é o padrão, e só `on` liga — instalação que não pediu o guia
 *    continua no wizard;
 *  - ninguém entra no CRM antes das boas-vindas (é lá que os termos são aceitos);
 *  - depois de um passo, a pessoa volta à tela DAQUELE passo, que é onde o
 *    resultado aparece, e não à tela do passo seguinte;
 *  - o plano sem IA não ganha missão de IA, e passo pulado aparece como pulado.
 */
import { describe, expect, it } from "vitest";

import {
  TELA_DA_MISSAO,
  TELA_DE_ENTRADA,
  destinoDoRoteador,
  destinoForaDoWizard,
  missaoAtual,
  missoesDoGuia,
  onboardingGuiadoLigado,
} from "@/lib/onboarding/guia";
import { PASSOS, type ContextoDoPasso } from "@/lib/onboarding/passos";
import type { OnboardingState } from "@/lib/schemas/onboarding";

const COM_IA: ContextoDoPasso = { lojaLigada: false, iaNoPlano: true };
const SEM_IA: ContextoDoPasso = { lojaLigada: false, iaNoPlano: false };
const COM_LOJA: ContextoDoPasso = { lojaLigada: true, iaNoPlano: true };

const BOAS_VINDAS: OnboardingState = {
  welcome: { accepted_at: "2026-11-13T12:00:00.000Z", timezone: "America/Sao_Paulo", display_name: "Clínica" },
};
const WHATSAPP: OnboardingState = { ...BOAS_VINDAS, whatsapp: { status: "WORKING" } };
const AGENTE: OnboardingState = { ...WHATSAPP, ai: { agent_id: "a1", prompt_template: "ecommerce_friendly" } };
const FUNIL: OnboardingState = { ...AGENTE, funil: { origem: "pacote", etapas: 7 } };
const TESTE: OnboardingState = { ...FUNIL, teste: { respondeu: true } };
const TUDO: OnboardingState = { ...TESTE, team: { invites_sent: 1 } };

describe("a chave do roteiro guiado", () => {
  it("nasce desligada", () => {
    expect(onboardingGuiadoLigado(undefined)).toBe(false);
    expect(onboardingGuiadoLigado("")).toBe(false);
  });

  it("só `on` liga", () => {
    expect(onboardingGuiadoLigado("on")).toBe(true);
    expect(onboardingGuiadoLigado(" ON ")).toBe(true);
    for (const valor of ["off", "true", "1", "sim"]) expect(onboardingGuiadoLigado(valor)).toBe(false);
  });
});

describe("toda missão tem tela", () => {
  it("cada passo do roteiro, menos as boas-vindas, sabe onde é feito", () => {
    const semTela = PASSOS.filter((p) => p.segmento !== "welcome" && !TELA_DA_MISSAO[p.segmento]).map(
      (p) => p.segmento,
    );
    expect(semTela).toEqual([]);
  });
});

describe("para onde o roteador manda", () => {
  it("sem as boas-vindas, é para elas — ninguém entra no CRM antes dos termos", () => {
    expect(destinoDoRoteador({}, COM_IA)).toBe("/onboarding/welcome");
    expect(missaoAtual({}, COM_IA)).toBeNull();
  });

  it("logo depois das boas-vindas, é a entrada do CRM", () => {
    expect(destinoDoRoteador(BOAS_VINDAS, COM_IA)).toBe(TELA_DE_ENTRADA);
  });

  it("depois de um passo, é a tela DAQUELE passo", () => {
    expect(destinoDoRoteador(WHATSAPP, COM_IA)).toBe("/app/connections");
    expect(destinoDoRoteador(AGENTE, COM_IA)).toBe("/app/ai/agents");
    expect(destinoDoRoteador(FUNIL, COM_IA)).toBe("/app/kanban");
    expect(destinoDoRoteador(TESTE, COM_IA)).toBe("/app/inbox");
    expect(destinoDoRoteador(TUDO, COM_IA)).toBe("/app/team");
  });

  it("passo pulado também devolve à tela dele", () => {
    const pulou: OnboardingState = { ...BOAS_VINDAS, whatsapp: { status: "skipped", skipped: true } };
    expect(destinoDoRoteador(pulou, COM_IA)).toBe("/app/connections");
  });

  it("a loja não tem tela no CRM: depois dela, volta à entrada", () => {
    const comLoja: OnboardingState = { ...WHATSAPP, nuvemshop: { skipped: true } };
    expect(destinoDoRoteador(comLoja, COM_LOJA)).toBe(TELA_DE_ENTRADA);
  });

  it("no plano sem IA, depois do WhatsApp vem o funil, sem passar por agente", () => {
    expect(missaoAtual(WHATSAPP, SEM_IA)?.segmento).toBe("funil");
    const comFunil: OnboardingState = { ...WHATSAPP, funil: { origem: "pacote", etapas: 7 } };
    expect(destinoDoRoteador(comFunil, SEM_IA)).toBe("/app/kanban");
    expect(missaoAtual(comFunil, SEM_IA)?.segmento).toBe("invite-team");
  });
});

describe("a lista que o guia desenha", () => {
  it("não lista as boas-vindas: elas vêm antes do guia", () => {
    expect(missoesDoGuia(BOAS_VINDAS, COM_IA).map((m) => m.segmento)).toEqual([
      "connect-whatsapp",
      "setup-ai",
      "funil",
      "testar",
      "invite-team",
    ]);
  });

  it("plano sem IA não ganha missão de IA, e os rótulos falam da empresa", () => {
    const missoes = missoesDoGuia(BOAS_VINDAS, SEM_IA);
    expect(missoes.map((m) => m.segmento)).toEqual(["connect-whatsapp", "funil", "invite-team"]);
    expect(missoes.map((m) => m.rotulo)).toEqual(["Seu WhatsApp", "Seu funil", "Sua equipe"]);
  });

  it("uma missão é a da vez, as de trás estão feitas e as da frente esperam", () => {
    expect(missoesDoGuia(AGENTE, COM_IA).map((m) => m.estado)).toEqual([
      "feita",
      "feita",
      "atual",
      "espera",
      "espera",
    ]);
  });

  it("pulada é pulada, e não feita", () => {
    const pulou: OnboardingState = { ...BOAS_VINDAS, whatsapp: { status: "skipped", skipped: true } };
    const missoes = missoesDoGuia(pulou, COM_IA);
    expect(missoes[0]?.estado).toBe("pulada");
    expect(missoes[1]?.estado).toBe("atual");
  });

  it("com tudo resolvido não há missão da vez", () => {
    expect(missaoAtual(TUDO, COM_IA)).toBeNull();
    expect(missoesDoGuia(TUDO, COM_IA).every((m) => m.estado === "feita")).toBe(true);
  });

  it("cada missão aponta para a tela onde é feita", () => {
    expect(missoesDoGuia(BOAS_VINDAS, COM_IA).map((m) => m.href)).toEqual([
      "/app/connections",
      "/app/ai/agents",
      "/app/kanban",
      "/app/inbox",
      "/app/team",
    ]);
  });
});

describe("o wizard antigo não é desenhado depois das boas-vindas", () => {
  it("antes das boas-vindas, a página do wizard é a da pessoa", () => {
    expect(destinoForaDoWizard("/onboarding/welcome", {}, COM_IA)).toBeNull();
    expect(destinoForaDoWizard("/onboarding", {}, COM_IA)).toBeNull();
  });

  it("o roteador responde com a mesma tela que as actions", () => {
    for (const estado of [BOAS_VINDAS, WHATSAPP, AGENTE, FUNIL, TESTE, TUDO]) {
      expect(destinoForaDoWizard("/onboarding", estado, COM_IA)).toBe(destinoDoRoteador(estado, COM_IA));
      expect(destinoForaDoWizard("/onboarding/", estado, COM_IA)).toBe(destinoDoRoteador(estado, COM_IA));
    }
  });

  it("toda página de passo do wizard devolve à tela da missão da vez", () => {
    for (const p of PASSOS) {
      expect(destinoForaDoWizard(`/onboarding/${p.segmento}`, WHATSAPP, COM_IA)).toBe("/app/ai/agents");
    }
    expect(destinoForaDoWizard("/onboarding/done", WHATSAPP, COM_IA)).toBe("/app/ai/agents");
    expect(destinoForaDoWizard("/onboarding/welcome", BOAS_VINDAS, SEM_IA)).toBe("/app/connections");
  });

  it("sem missão pendente, o wizard devolve à entrada do CRM", () => {
    expect(destinoForaDoWizard("/onboarding/done", TUDO, COM_IA)).toBe(TELA_DE_ENTRADA);
  });

  it("a loja, que ainda mora no wizard, só abre enquanto é a missão da vez", () => {
    expect(destinoForaDoWizard("/onboarding/connect-nuvemshop", WHATSAPP, COM_LOJA)).toBeNull();
    expect(destinoForaDoWizard("/onboarding/funil", WHATSAPP, COM_LOJA)).toBe("/onboarding/connect-nuvemshop");
    expect(destinoForaDoWizard("/onboarding/connect-nuvemshop", BOAS_VINDAS, COM_LOJA)).toBe("/app/connections");
  });
});
