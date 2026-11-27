import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoFalso, valorDoFiltro, type BancoFalso, type Cadeia, type Resposta } from "@/tests/helpers/banco-falso-da-cobranca";

const h = vi.hoisted(() => ({ sincronizar: vi.fn(), aplicarRegua: vi.fn() }));
vi.mock("./sincronizar", () => ({ sincronizar: h.sincronizar, aplicarRegua: h.aplicarRegua }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { LIMITE_DA_RECONCILIACAO, rodadaDaCobranca } from "./rodada";

interface Mundo {
  reconciliaveis: Array<{ organization_id: string; relida_em: string | null; precisa_reler: boolean }>;
  todas: string[];
  planos: Array<{ id: string; teto_ia_usd_cents: number }>;
  assinaturasDePlano: Array<{ organization_id: string; plano_id: string }>;
  orgs: Array<{ id: string; status: string; locale: string | null }>;
  /** Gasto da chave da PLATAFORMA no ciclo (`fn_ia_do_plano`). */
  gasto: Record<string, number>;
  conversas: Record<string, number>;
  teto: number | null;
  franquia: number | null;
}
const CICLO = "2026-11-10T00:00:00.000Z";
let m: Mundo;
let banco: BancoFalso;

function responder(c: Cadeia): Resposta {
  if (c.tabela === "cobranca_planos") return { data: m.planos };
  if (c.tabela === "organizations") return { data: m.orgs };
  if (valorDoFiltro(c, "in", "plano_id") !== undefined) return { data: m.assinaturasDePlano };
  return { data: m.todas.map((organization_id) => ({ organization_id })) };
}
function rpc(nome: string, args: Record<string, unknown>): Resposta {
  if (nome === "fn_cobranca_reconciliaveis") return { data: m.reconciliaveis };
  if (nome === "fn_ia_do_plano") {
    const org = String(args.p_org);
    return {
      data: [
        {
          com_assinatura: true,
          teto: m.teto,
          franquia: m.franquia,
          gasto: m.gasto[org] ?? 0,
          conversas: m.conversas[org] ?? 0,
          ciclo_inicio: CICLO,
        },
      ],
    };
  }
  return { data: true };
}

beforeEach(() => {
  vi.clearAllMocks();
  m = { reconciliaveis: [], todas: [], planos: [], assinaturasDePlano: [], orgs: [], gasto: {}, conversas: {}, teto: 1000, franquia: null };
  banco = bancoFalso(responder, rpc);
  h.sincronizar.mockResolvedValue({ tipo: "aplicada", estado: "ativa", mudou: false, acao: "nada" });
  h.aplicarRegua.mockResolvedValue("nada");
});

const rodar = () => rodadaDaCobranca(banco.cliente as never);
const orgsSincronizadas = () => h.sincronizar.mock.calls.map((c) => c[1]);

describe("rodadaDaCobranca", () => {
  it("⭐ relê só quem precisa, nunca lida primeiro, no máximo 50", async () => {
    m.reconciliaveis = [
      ...Array.from({ length: 58 }, (_, i) => ({ organization_id: `lida-${i}`, relida_em: new Date(Date.UTC(2026, 9, 1, i)).toISOString(), precisa_reler: true })),
      { organization_id: "nunca", relida_em: null, precisa_reler: true },
      { organization_id: "fresca", relida_em: new Date().toISOString(), precisa_reler: false },
    ];
    const r = await rodar();
    expect(orgsSincronizadas()).toHaveLength(LIMITE_DA_RECONCILIACAO);
    expect(orgsSincronizadas()[0]).toBe("nunca");
    expect(orgsSincronizadas()[1]).toBe("lida-0");
    expect(orgsSincronizadas()).not.toContain("fresca");
    expect(r.relidas).toBe(50);
  });

  it("⭐ leitura que falha na reconciliação não deixa a régua rodar para essa empresa", async () => {
    m.reconciliaveis = [{ organization_id: "A", relida_em: null, precisa_reler: true }];
    m.todas = ["A", "B"];
    h.sincronizar.mockResolvedValue({ tipo: "falhou", erro: "provedor_fora", transitorio: true });
    const r = await rodar();
    expect(h.aplicarRegua.mock.calls.map((c) => c[1])).toEqual(["B"]);
    expect(r.falhas).toBe(1);
  });

  it("régua só com o banco para quem não foi relido, e as contagens saem por ação", async () => {
    m.reconciliaveis = [{ organization_id: "A", relida_em: null, precisa_reler: true }];
    m.todas = ["A", "B", "C", "D"];
    h.sincronizar.mockResolvedValue({ tipo: "aplicada", estado: "em_atraso", mudou: false, acao: "suspender" });
    h.aplicarRegua.mockImplementation(async (_db: unknown, org: string) => ({ B: "avisar", C: "reativar", D: "cancelar_no_provedor" })[org] ?? "nada");
    expect(await rodar()).toEqual({ relidas: 1, falhas: 0, avisos: 1, suspensas: 1, reativadas: 1, canceladas: 1, avisosDeIa: 0 });
  });

  it("⭐ empresa sem provedor na fila: a ação da régua que sincronizar já executou entra no resumo", async () => {
    m.reconciliaveis = [{ organization_id: "A", relida_em: null, precisa_reler: true }];
    h.sincronizar.mockResolvedValue({ tipo: "sem_provedor", acao: "suspender" });
    expect(await rodar()).toMatchObject({ relidas: 0, falhas: 0, suspensas: 1 });
  });

  it("a falha de uma empresa não derruba a rodada", async () => {
    m.todas = ["A", "B"];
    h.aplicarRegua.mockImplementation(async (_db: unknown, org: string) => {
      if (org === "A") throw new Error("boom");
      return "avisar";
    });
    expect(await rodar()).toMatchObject({ falhas: 1, avisos: 1 });
  });

  it("aviso de 80% da IA: só empresa operante, entre 80% e 100% do teto, com o gasto no texto", async () => {
    m.planos = [{ id: "p1", teto_ia_usd_cents: 1000 }];
    m.assinaturasDePlano = [
      { organization_id: "A", plano_id: "p1" },
      { organization_id: "B", plano_id: "p1" },
      { organization_id: "C", plano_id: "p1" },
    ];
    m.orgs = [
      { id: "A", status: "active", locale: "pt-BR" },
      { id: "B", status: "suspended", locale: "pt-BR" },
      { id: "C", status: "active", locale: "pt-BR" },
    ];
    m.gasto = { A: 850, B: 900, C: 1000 };
    const r = await rodar();
    const avisos = banco.rpcs.filter((x) => x.nome === "fn_cobranca_avisar_uso_de_ia");
    expect(avisos.map((a) => a.args.p_org)).toEqual(["A"]);
    // Sem franquia no plano, o texto fala no percentual do uso incluído.
    expect(String(avisos[0]?.args.p_corpo)).toContain("já usou 85% do uso de IA incluído no plano");
    // Um aviso por CICLO: a função do banco deduplica desde o início dele.
    expect(avisos[0]?.args.p_desde).toBe(CICLO);
    expect(r.avisosDeIa).toBe(1);
  });

  it("⭐ com franquia, o aviso de 80% fala em conversas e traz as duas saídas", async () => {
    m.planos = [{ id: "p1", teto_ia_usd_cents: 1200 }];
    m.teto = 1200;
    m.franquia = 300;
    m.assinaturasDePlano = [
      { organization_id: "A", plano_id: "p1" },
      { organization_id: "B", plano_id: "p1" },
      { organization_id: "C", plano_id: "p1" },
    ];
    m.orgs = ["A", "B", "C"].map((id) => ({ id, status: "active", locale: "pt-BR" }));
    m.conversas = { A: 240, B: 239, C: 300 };
    m.gasto = { A: 100, B: 100, C: 100 };
    const r = await rodar();
    const avisos = banco.rpcs.filter((x) => x.nome === "fn_cobranca_avisar_uso_de_ia");
    // 240 de 300 = 80%: avisa. 239 ainda não. 300 já é o bloqueio: quem fala é o motor.
    expect(avisos.map((a) => a.args.p_org)).toEqual(["A"]);
    const corpo = String(avisos[0]?.args.p_corpo);
    expect(corpo).toContain("já usou 240 de 300 conversas com IA incluídas no plano");
    expect(corpo).toContain("fale com a ArvisX para contratar um pacote extra");
    expect(corpo).toContain("cadastre uma chave de IA própria em IA › Credenciais");
    expect(r.avisosDeIa).toBe(1);
  });

  it("o teto em dólar a 80% avisa mesmo com a franquia com folga", async () => {
    m.planos = [{ id: "p1", teto_ia_usd_cents: 1200 }];
    m.teto = 1200;
    m.franquia = 300;
    m.assinaturasDePlano = [{ organization_id: "A", plano_id: "p1" }];
    m.orgs = [{ id: "A", status: "active", locale: "pt-BR" }];
    m.conversas = { A: 10 };
    m.gasto = { A: 1000 };
    await rodar();
    const avisos = banco.rpcs.filter((x) => x.nome === "fn_cobranca_avisar_uso_de_ia");
    expect(String(avisos[0]?.args.p_corpo)).toContain("já usou 83% do uso de IA incluído no plano");
  });

  it("o aviso antigo, que deduplicava por mês-calendário e somava todas as chaves, não é mais chamado", async () => {
    m.planos = [{ id: "p1", teto_ia_usd_cents: 1000 }];
    m.assinaturasDePlano = [{ organization_id: "A", plano_id: "p1" }];
    m.orgs = [{ id: "A", status: "active", locale: "pt-BR" }];
    m.gasto = { A: 850 };
    await rodar();
    expect(banco.rpcs.map((x) => x.nome)).not.toContain("fn_cobranca_avisar_teto_de_ia");
    expect(banco.rpcs.map((x) => x.nome)).not.toContain("fn_gasto_de_ia_do_mes");
  });
});
