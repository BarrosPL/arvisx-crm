/**
 * O EQUIPE COMPLETA DEPOIS DO PAGAMENTO (ArvisX, tarefa 2 dos planos; migration 9804).
 *
 *  - O handler de `cobranca.equipe_completa` manda o e-mail à equipe e marca
 *    `equipe_avisada_em`; e-mail que não sai deixa o aviso só na lista
 *    (`skipped`, nunca `error`); aviso de outra empresa ou já avisado não sai.
 *  - A tela de assinatura do cliente diz "nossa equipe entrará em contato" só
 *    no plano com os agentes, só depois do pagamento confirmado e só enquanto
 *    o contato não foi marcado.
 *  - /admin/cobranca lista o que aguarda contato e marca por PATCH.
 *
 * O gatilho que grava a linha e emite o evento é SQL: provado no Supabase local
 * (evidence/planos-tarefa-2/prova-9804.txt).
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ avisar: vi.fn(), patch: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/cobranca/emails", () => ({ avisarEquipeCompleta: h.avisar }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/lib/api/client", () => ({ apiClient: { patch: h.patch } }));

import { EquipeCompletaAguardandoContato } from "@/app/admin/(protected)/cobranca/_equipe-completa";
import { PainelDaAssinatura } from "@/components/cobranca/PainelDaAssinatura";
import { aguardaContatoDaEquipe, avisarPeloEvento } from "@/lib/cobranca/equipe-completa";
import type { DadosDoPainel } from "@/lib/cobranca/painel";
import type { EventRow } from "@/lib/event-log/dispatcher";

const ORG = "11111111-1111-4111-8111-111111111111";
const AVISO = {
  id: "aaaaaaaa-0000-4000-8000-000000000001", organization_id: ORG, tipo: "entrada" as "entrada" | "saida", plano_nome: "Equipe Completa",
  criado_em: "2026-11-10T12:00:00Z", equipe_avisada_em: null as string | null, contatado_em: null as string | null,
};

/** Um cliente Supabase de mentira: guarda os filtros e os updates. */
function banco(linha: Record<string, unknown> | null) {
  const updates: Array<{ valores: unknown; id: unknown }> = [];
  const db = {
    updates,
    from(tabela: string) {
      const filtros: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => ((filtros[c] = v), q),
        in: () => q,
        is: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          if (tabela !== "cobranca_equipe_completa") return { data: null, error: null };
          const bate = linha && Object.entries(filtros).every(([c, v]) => linha[c] === v);
          return { data: bate ? linha : null, error: null };
        },
        update: (valores: unknown) => ({ eq: async (_c: string, id: unknown) => (updates.push({ valores, id }), { error: null }) }),
        then: (ok: (r: unknown) => unknown) => ok({ data: tabela === "organizations" ? [{ id: ORG, display_name: "Clínica Vitalis" }] : [], error: null }),
      };
      return q;
    },
  };
  return db;
}

const evento = (payload: unknown, org = ORG): EventRow => ({ organization_id: org, payload } as unknown as EventRow);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("o aviso à equipe (handler de cobranca.equipe_completa)", () => {
  it("manda o e-mail com o nome da empresa e marca equipe_avisada_em", async () => {
    h.avisar.mockResolvedValue(2);
    const db = banco(AVISO);
    const r = await avisarPeloEvento(evento({ aviso_id: AVISO.id, tipo: "entrada" }), db as never);
    expect(r.status).toBe("ok");
    expect(h.avisar).toHaveBeenCalledWith(db, { empresa: "Clínica Vitalis", plano: "Equipe Completa", tipo: "entrada" });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]!.id).toBe(AVISO.id);
  });

  it("e-mail que não sai: skipped (o aviso fica na lista), nada marcado", async () => {
    h.avisar.mockResolvedValue(0);
    const db = banco(AVISO);
    const r = await avisarPeloEvento(evento({ aviso_id: AVISO.id }), db as never);
    expect(r.status).toBe("skipped");
    expect(db.updates).toHaveLength(0);
  });

  it("evento forjado com aviso de OUTRA empresa não acha nada e não manda e-mail", async () => {
    const db = banco(AVISO);
    const r = await avisarPeloEvento(evento({ aviso_id: AVISO.id }, "22222222-2222-4222-8222-222222222222"), db as never);
    expect(r.status).toBe("skipped");
    expect(h.avisar).not.toHaveBeenCalled();
  });

  it("aviso já avisado não manda de novo", async () => {
    const db = banco({ ...AVISO, equipe_avisada_em: "2026-11-10T12:01:00Z" });
    const r = await avisarPeloEvento(evento({ aviso_id: AVISO.id }), db as never);
    expect(r).toMatchObject({ status: "skipped", detail: "ja_avisada" });
    expect(h.avisar).not.toHaveBeenCalled();
  });

  it("aguarda contato = a linha mais nova é uma entrada sem contato", async () => {
    expect(await aguardaContatoDaEquipe(banco(AVISO) as never, ORG)).toBe(true);
    expect(await aguardaContatoDaEquipe(banco({ ...AVISO, contatado_em: "2026-11-11T10:00:00Z" }) as never, ORG)).toBe(false);
    expect(await aguardaContatoDaEquipe(banco({ ...AVISO, tipo: "saida" }) as never, ORG)).toBe(false);
    expect(await aguardaContatoDaEquipe(banco(null) as never, ORG)).toBe(false);
  });
});

const PLANO = {
  id: "equipe", nome: "Equipe Completa", preco_cents: 49990, moeda: "EUR" as const, intervalo: "mes",
  max_assentos: null, max_canais: null, teto_ia_usd_cents: null, inclui_agentes_arvisx: true,
};
const ASSINATURA: NonNullable<DadosDoPainel["assinatura"]> = {
  estado: "ativa", trial_ate: null, prazo_extra_ate: null, proximo_vencimento: "2026-12-10T12:00:00Z", vencida_desde: null,
  cancela_no_fim: false, modo: "teste", provedor: "stripe", link_de_pagamento: null, assinaturas_vivas: 1, plano_agendado: null,
  periodo_pago_desde: "2026-11-10T12:00:00Z", troca_pagamento_url: null, troca_status: null, pagamento_inicial_pendente: false,
};
const dados = (o: Partial<DadosDoPainel> = {}, a: Partial<typeof ASSINATURA> = {}): DadosDoPainel => ({
  assinatura: { ...ASSINATURA, ...a }, plano: PLANO, aguardaContatoDaEquipe: true, uso: { assentos: 1, canais: 1 }, gastoIaUsdCents: 0,
  planosParaTroca: [], escolheAoAssinar: false, planosParaAssinar: [], comparativo: { planos: [], atual: null }, fuso: null,
  checkout: { provedor: "stripe", documentoDoCadastro: null }, ...o,
});
const RECEBEMOS = "Recebemos sua assinatura. Nossa equipe entrará em contato para entender a sua operação e criar seus 4 agentes.";

describe("a tela do cliente depois do pagamento", () => {
  it("Equipe Completa pago e sem contato: a mensagem de contato", () => {
    render(<PainelDaAssinatura dados={dados()} idioma="pt-BR" />);
    expect(screen.getByText(RECEBEMOS)).toBeTruthy();
  });

  it("depois do contato marcado: só diz que o plano inclui os agentes", () => {
    render(<PainelDaAssinatura dados={dados({ aguardaContatoDaEquipe: false })} idioma="pt-BR" />);
    expect(screen.queryByText(RECEBEMOS)).toBeNull();
    expect(screen.getByText("Seu plano inclui os 4 agentes de IA feitos sob medida pela nossa equipe.")).toBeTruthy();
  });

  it("antes do pagamento confirmado (teste ou primeiro pagamento pendente): nada", () => {
    const { unmount } = render(<PainelDaAssinatura dados={dados({}, { estado: "trial" })} idioma="pt-BR" />);
    expect(document.querySelector("[data-equipe-completa]")).toBeNull();
    unmount();
    render(<PainelDaAssinatura dados={dados({}, { pagamento_inicial_pendente: true })} idioma="pt-BR" />);
    expect(document.querySelector("[data-equipe-completa]")).toBeNull();
  });

  it("plano sem os agentes (Premium, ou depois do downgrade): nem mensagem nem selo", () => {
    render(<PainelDaAssinatura dados={dados({ plano: { ...PLANO, nome: "Premium", inclui_agentes_arvisx: false } })} idioma="pt-BR" />);
    expect(document.querySelector("[data-equipe-completa]")).toBeNull();
  });
});

describe("/admin/cobranca: Equipe Completa aguardando contato", () => {
  it("lista entrada e saída, diz se o e-mail saiu, e marca o contato por PATCH", async () => {
    h.patch.mockResolvedValue({ data: {} });
    render(
      <EquipeCompletaAguardandoContato
        avisos={[
          { ...AVISO, tipo: "entrada", empresa: "Clínica Vitalis", equipe_avisada_em: "2026-11-10T12:01:00Z" },
          { ...AVISO, id: "aaaaaaaa-0000-4000-8000-000000000002", tipo: "saida", empresa: "Loja Sol", equipe_avisada_em: null },
        ]}
      />,
    );
    expect(screen.getByText(/assinou o Equipe Completa/)).toBeTruthy();
    expect(screen.getByText(/deixou o Equipe Completa/)).toBeTruthy();
    expect(screen.getByText(/e-mail enviado à equipe/)).toBeTruthy();
    expect(screen.getByText(/e-mail não enviado: o aviso está só aqui/)).toBeTruthy();
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Marcar como contatado" })[0]!);
    expect(h.patch).toHaveBeenCalledWith(`/api/v1/admin/cobranca/equipe-completa/${AVISO.id}`, { contatado: true });
    expect(h.refresh).toHaveBeenCalled();
  });

  it("nada aguardando: a seção não aparece", () => {
    const { container } = render(<EquipeCompletaAguardandoContato avisos={[]} />);
    expect(container.textContent).toBe("");
  });
});
