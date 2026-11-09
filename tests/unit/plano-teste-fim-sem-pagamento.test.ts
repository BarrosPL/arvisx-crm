/**
 * FIM DO TESTE DE 7 DIAS SEM PAGAMENTO (ArvisX, etapa 3): o fluxo de sempre,
 * sem mudança — teste vencido sem provedor vira `em_atraso`, recebe o aviso
 * final e é suspenso 48 h depois (a régua de `lib/cobranca/regua.ts`, #2753).
 * O plano "Teste" não tem nada de especial para a régua: é um plano com
 * `trial_dias = 7` e sem assinatura no provedor.
 */
import { describe, expect, it } from "vitest";

import { decidirRegua, type AssinaturaNaRegua } from "@/lib/cobranca/regua";

const HORA = 3_600_000;
const CRIADA = new Date("2026-11-09T12:00:00Z");
const FIM_DO_TESTE = new Date(CRIADA.getTime() + 7 * 24 * HORA);
const ATIVA = { status: "active", suspendedKind: null };

/** A assinatura que `fn_trial_na_criacao_da_org` grava no plano Teste: trial de 7 dias, sem provedor. */
const noTeste = (p: Partial<AssinaturaNaRegua> = {}): AssinaturaNaRegua => ({
  estado: "trial", temProvedor: false, cancelaNoFim: false, assinaturasVivas: 0, trialAte: FIM_DO_TESTE,
  vencidaDesde: null, proximoVencimento: null, prazoExtraAte: null, ultimoAviso: null, ultimoAvisoEm: null,
  relidaEm: null, entradaPendente: false, ...p,
});
const em = (horasDepoisDoFim: number) => new Date(FIM_DO_TESTE.getTime() + horasDepoisDoFim * HORA);

describe("⭐ o Teste de 7 dias que acaba sem pagamento segue a régua de sempre", () => {
  it("no 5º dia (2 dias do fim): avisa que o teste está acabando", () => {
    const d = decidirRegua(noTeste(), ATIVA, em(-48), 7);
    expect(d.acao).toEqual({ tipo: "avisar", aviso: "trial_acabando", debitoDesde: null, data: FIM_DO_TESTE, origem: "teste" });
    expect(d.estado).toBe("trial");
  });

  it("⭐ venceu: vira em_atraso, com o aviso final já no fim do teste (sem tolerância: nada foi pago)", () => {
    const d = decidirRegua(noTeste(), ATIVA, em(1), 7);
    expect(d.estado).toBe("em_atraso");
    expect(d.acao).toEqual({ tipo: "avisar", aviso: "suspende_em_breve", debitoDesde: FIM_DO_TESTE, data: em(49), origem: "teste" });
  });

  it("⭐ 48 h depois do aviso final: suspende (e a empresa vai para /account-suspended, onde escolhe o plano)", () => {
    const d = decidirRegua(
      noTeste({ estado: "em_atraso", vencidaDesde: FIM_DO_TESTE, ultimoAviso: "suspende_em_breve", ultimoAvisoEm: em(1) }),
      ATIVA,
      em(50),
      7,
    );
    expect(d.acao).toEqual({ tipo: "suspender", debitoDesde: FIM_DO_TESTE, origem: "teste" });
  });
});
