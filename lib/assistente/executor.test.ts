/**
 * O EXECUTOR DO VIX SOB ATAQUE — as travas medidas uma a uma, sem modelo.
 *
 * Aqui não há modelo nenhum: o executor é chamado com o que um modelo hostil
 * (ou obediente a um texto injetado) pediria. O que se mede é o que EXECUTOU,
 * por espiões nas capacidades: recusa que executa por baixo não passa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { executarConfirmada } from "./confirmar";
import {
  capacidadesOferecidas,
  executarLeitura,
  proporEscrita,
  type DependenciasDoExecutor,
  type EventoDoExecutor,
} from "./executor";
import { MARCA_DE_SEGREDO } from "./filtro-de-segredo";
import { capacidade, type Capacidade, type ContextoDoAssistente, type PapelHumano } from "./tipos";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const execLer = vi.fn(async (..._args: unknown[]) => ({ leads: [{ id: "a", title: "Negócio" }] }));
const execEscrever = vi.fn(async (..._args: unknown[]) => ({ feito: true }));
const execSensivel = vi.fn(async (..._args: unknown[]) => ({ feito: true }));
const execChamado = vi.fn(async (..._args: unknown[]) => ({ aberto: true }));

const ler = capacidade({
  nome: "teste_ler",
  descricao: "lê",
  nivel: "ler",
  papelMinimo: "agent",
  rotaDaTela: { caminho: "/api/v1/leads", metodo: "GET" },
  entrada: z.object({ busca: z.string().optional() }),
  temInverso: "nao_se_aplica",
  teste: "x",
  origem: { tipo: "propria" },
  executar: execLer,
});
const lerDeGerente = capacidade({ ...ler, nome: "teste_ler_gerente", papelMinimo: "manager" } as never);
const lerDeModulo = capacidade({ ...ler, nome: "teste_ler_modulo", modulo: "honorarios" } as never);
const lerForaDoPlano = capacidade({
  ...ler,
  nome: "teste_ler_fora_do_plano",
  rotaDaTela: { caminho: "/api/v1/products", metodo: "GET" },
} as never);
const escrever = capacidade({
  nome: "teste_escrever",
  descricao: "escreve",
  nivel: "escrever",
  papelMinimo: "agent",
  rotaDaTela: { caminho: "/api/v1/leads", metodo: "PATCH" },
  entrada: z.object({ ids: z.array(z.string()).min(1).max(50) }),
  temInverso: false,
  teste: "x",
  origem: { tipo: "tela", handler: "x" },
  preparar: async ({ ids }) => ({ resumo: `mexer em ${ids.length}`, itens: ids.map((id) => ({ id, rotulo: id })) }),
  executar: execEscrever,
});
const sensivel = capacidade({ ...escrever, nome: "teste_sensivel", nivel: "sensivel", executar: execSensivel } as never);
const chamado = capacidade({
  ...escrever,
  nome: "teste_chamado",
  rotaDaTela: null,
  origem: { tipo: "propria" },
  papelMinimo: "viewer",
  executar: execChamado,
} as never);
/** Uma capacidade que alguém declarou apontando para rota proibida: o executor recusa mesmo assim. */
const apontaParaProibida = capacidade({
  ...escrever,
  nome: "teste_convidar",
  rotaDaTela: { caminho: "/api/v1/team/invite", metodo: "POST" },
} as never);

const CATALOGO: Capacidade[] = [ler, lerDeGerente, lerDeModulo, lerForaDoPlano, escrever, sensivel, chamado, apontaParaProibida];

function ctx(papel: PapelHumano = "agent"): ContextoDoAssistente {
  return { orgId: ORG, userId: USER, papel, idioma: "pt-BR", requestId: "req", db: {} as never };
}

let eventos: EventoDoExecutor[];
let cartoes: Array<Record<string, unknown>>;

function deps(sobre: Partial<DependenciasDoExecutor> = {}): DependenciasDoExecutor {
  return {
    catalogo: CATALOGO,
    foraDoPlano: async (_org, rota) => rota.caminho === "/api/v1/products",
    modulosLigados: [],
    capacidadesDaEmpresa: [],
    escritasLigadas: true,
    limiteDeLote: 5,
    auditar: (e) => void eventos.push(e),
    gravarCartao: async (c) => {
      cartoes.push(c as never);
      return `cartao-${cartoes.length}`;
    },
    ...sobre,
  };
}

beforeEach(() => {
  eventos = [];
  cartoes = [];
  vi.clearAllMocks();
});

describe("ler", () => {
  it("executa direto e audita (controle positivo)", async () => {
    const r = await executarLeitura("teste_ler", {}, ctx(), deps());
    expect(r.ok).toBe(true);
    expect(execLer).toHaveBeenCalledTimes(1);
    expect(eventos).toEqual([{ tipo: "leitura", capacidade: "teste_ler" }]);
  });

  it("o resultado sai mascarado de segredos", async () => {
    execLer.mockResolvedValueOnce({ leads: [], api_key: "abc", nota: "ok" } as never);
    const r = await executarLeitura("teste_ler", {}, ctx(), deps());
    expect(r).toEqual({ ok: true, dados: { leads: [], api_key: MARCA_DE_SEGREDO, nota: "ok" } });
  });

  it("falha da capacidade vira recusa sem detalhe técnico", async () => {
    execLer.mockRejectedValueOnce(new Error("relation crm_leads does not exist at 10.0.0.3"));
    const r = await executarLeitura("teste_ler", {}, ctx(), deps());
    expect(r).toEqual({ ok: false, motivo: "falha_ao_executar" });
    expect(JSON.stringify(r)).not.toContain("10.0.0.3");
  });
});

describe("pedir dados de outra empresa", () => {
  it.each([
    ["organization_id", { organization_id: "99999999-9999-4999-8999-999999999999" }],
    ["org_id", { org_id: "99999999-9999-4999-8999-999999999999" }],
    ["empresa por nome", { empresa: "Empresa X" }],
    ["tenant", { tenant: "x" }],
  ])("argumento que nomeia empresa (%s) é recusado e nada executa", async (_nome, args) => {
    const r = await executarLeitura("teste_ler", args, ctx(), deps());
    expect(r).toMatchObject({ ok: false, motivo: "entrada_invalida" });
    expect(execLer).not.toHaveBeenCalled();
  });

  it("a empresa que chega à capacidade é a do contexto, seja qual for o argumento", async () => {
    await executarLeitura("teste_ler", { busca: "leads da empresa X" }, ctx(), deps());
    expect(execLer.mock.calls[0]![1]).toMatchObject({ orgId: ORG, userId: USER });
  });
});

describe("ação proibida, pedida de todas as formas", () => {
  it.each([
    ["nome que não existe", "excluir_empresa"],
    ["rota como nome", "/api/v1/team/invite"],
    ["ferramenta MCP de envio ao cliente", "crm_send_whatsapp_message"],
    ["ferramenta MCP de LGPD", "crm_list_privacy_requests"],
    ["ferramenta MCP de escrita fora do catálogo", "crm_create_lead"],
    ["capacidade declarada apontando para rota proibida", "teste_convidar"],
  ])("%s: recusa pelo caminho de leitura", async (_caso, nome) => {
    const r = await executarLeitura(nome, {}, ctx("admin"), deps());
    expect(r.ok).toBe(false);
    expect(eventos.at(-1)?.tipo).toBe("recusa");
  });

  it.each([
    ["nome que não existe", "exportar_dados"],
    ["ferramenta MCP de envio ao cliente", "crm_send_whatsapp_message"],
    ["capacidade declarada apontando para rota proibida", "teste_convidar"],
  ])("%s: recusa pelo caminho de proposta, e nenhum cartão nasce", async (_caso, nome) => {
    const r = await proporEscrita(nome, { ids: ["a"] }, "conv", ctx("admin"), deps());
    expect(r.ok).toBe(false);
    expect(cartoes).toHaveLength(0);
  });

  it("escrita chamada pelo caminho de LEITURA não executa", async () => {
    const r = await executarLeitura("teste_escrever", { ids: ["a"] }, ctx(), deps());
    expect(r).toEqual({ ok: false, motivo: "nivel_errado" });
    expect(execEscrever).not.toHaveBeenCalled();
  });

  it("leitura chamada pelo caminho de PROPOSTA não vira cartão", async () => {
    const r = await proporEscrita("teste_ler", {}, "conv", ctx(), deps());
    expect(r).toMatchObject({ ok: false, motivo: "nivel_errado" });
    expect(cartoes).toHaveLength(0);
  });
});

describe("escrever: o modelo propõe, e propor não executa", () => {
  it("propor grava o cartão e NÃO executa a escrita", async () => {
    const r = await proporEscrita("teste_escrever", { ids: ["a", "b"] }, "conv", ctx(), deps());
    expect(r).toMatchObject({ ok: true, acaoId: "cartao-1", nivel: "escrever" });
    expect(cartoes).toHaveLength(1);
    expect(cartoes[0]).toMatchObject({ capacidade: "teste_escrever", quantidade: 2, conversaId: "conv" });
    expect(execEscrever).not.toHaveBeenCalled();
  });

  it("com as escritas desligadas, nem propõe; abrir chamado (só tabela do assistente) continua", async () => {
    const d = deps({ escritasLigadas: false });
    expect(await proporEscrita("teste_escrever", { ids: ["a"] }, "conv", ctx(), d)).toMatchObject({
      ok: false,
      motivo: "escritas_desligadas",
    });
    expect(await proporEscrita("teste_chamado", { ids: ["a"] }, "conv", ctx(), d)).toMatchObject({ ok: true });
    expect(execEscrever).not.toHaveBeenCalled();
    expect(execChamado).not.toHaveBeenCalled();
  });

  it("estouro de lote: 6 itens com limite 5 não vira cartão", async () => {
    const r = await proporEscrita("teste_escrever", { ids: ["1", "2", "3", "4", "5", "6"] }, "conv", ctx(), deps());
    expect(r).toMatchObject({ ok: false, motivo: "lote_acima_do_limite" });
    expect(cartoes).toHaveLength(0);
    expect(execEscrever).not.toHaveBeenCalled();
  });

  it("no limite exato (5), propõe", async () => {
    const r = await proporEscrita("teste_escrever", { ids: ["1", "2", "3", "4", "5"] }, "conv", ctx(), deps());
    expect(r.ok).toBe(true);
  });
});

describe("papel, plano e módulo", () => {
  it("viewer pedindo leitura de atendente: recusa", async () => {
    const r = await executarLeitura("teste_ler", {}, ctx("viewer"), deps());
    expect(r).toEqual({ ok: false, motivo: "papel_insuficiente" });
    expect(execLer).not.toHaveBeenCalled();
  });

  it("viewer pedindo escrita: recusa, sem cartão", async () => {
    const r = await proporEscrita("teste_escrever", { ids: ["a"] }, "conv", ctx("viewer"), deps());
    expect(r).toMatchObject({ ok: false, motivo: "papel_insuficiente" });
    expect(cartoes).toHaveLength(0);
  });

  it("atendente pedindo leitura de gerente: recusa; o gerente lê", async () => {
    expect(await executarLeitura("teste_ler_gerente", {}, ctx("agent"), deps())).toEqual({
      ok: false,
      motivo: "papel_insuficiente",
    });
    expect((await executarLeitura("teste_ler_gerente", {}, ctx("manager"), deps())).ok).toBe(true);
  });

  it("plano sem a tela: recusa com fora_do_plano e nada é lido", async () => {
    const r = await executarLeitura("teste_ler_fora_do_plano", {}, ctx(), deps());
    expect(r).toEqual({ ok: false, motivo: "fora_do_plano" });
    expect(execLer).not.toHaveBeenCalled();
  });

  it("módulo desligado na instalação: recusa; ligado, lê", async () => {
    expect(await executarLeitura("teste_ler_modulo", {}, ctx(), deps())).toEqual({ ok: false, motivo: "modulo_desligado" });
    expect((await executarLeitura("teste_ler_modulo", {}, ctx(), deps({ modulosLigados: ["honorarios"] }))).ok).toBe(true);
  });

  it("o conjunto oferecido ao modelo já vem recortado por papel, plano, módulo e proibição", async () => {
    const nomes = async (papel: PapelHumano, sobre: Partial<DependenciasDoExecutor> = {}) =>
      (await capacidadesOferecidas(ctx(papel), deps(sobre), "suporte")).map((c) => c.nome);
    expect(await nomes("viewer")).toEqual(["teste_chamado"]);
    expect(await nomes("agent")).toEqual(["teste_ler", "teste_escrever", "teste_sensivel", "teste_chamado"]);
    expect(await nomes("agent", { escritasLigadas: false })).toEqual(["teste_ler", "teste_chamado"]);
    expect(await nomes("admin")).not.toContain("teste_convidar");
    expect(await nomes("admin")).not.toContain("teste_ler_fora_do_plano");
  });
});

describe("confirmar: a única porta de execução, depois da reserva no banco", () => {
  /** Um banco de mentira com UM cartão, que a reserva entrega uma vez só. */
  function banco(acao: Record<string, unknown> | null) {
    let reservado = false;
    const atualizacoes: Array<Record<string, unknown>> = [];
    const admin = {
      rpc: vi.fn(async () => {
        if (!acao || reservado) return { data: [], error: null };
        reservado = true;
        return { data: [acao], error: null };
      }),
      from: () => ({
        update: (campos: Record<string, unknown>) => {
          atualizacoes.push(campos);
          const fim = { eq: () => fim, then: (r: (v: unknown) => void) => r({ error: null }) };
          return fim;
        },
      }),
    };
    return { admin: admin as never, atualizacoes };
  }
  const cartao = (sobre: Record<string, unknown> = {}) => ({
    id: "acao-1",
    capacidade: "teste_escrever",
    nivel: "escrever",
    entrada: { ids: ["a", "b"] },
    quantidade: 2,
    ...sobre,
  });

  it("no clique, executa uma vez e grava executada (controle positivo)", async () => {
    const b = banco(cartao());
    const r = await executarConfirmada(b.admin, "acao-1", undefined, ctx(), deps());
    expect(r).toMatchObject({ ok: true, capacidade: "teste_escrever" });
    expect(execEscrever).toHaveBeenCalledTimes(1);
    expect(b.atualizacoes.at(-1)).toMatchObject({ estado: "executada" });
  });

  it("cartão repetido: a segunda confirmação não executa", async () => {
    const b = banco(cartao());
    await executarConfirmada(b.admin, "acao-1", undefined, ctx(), deps());
    const r = await executarConfirmada(b.admin, "acao-1", undefined, ctx(), deps());
    expect(r).toEqual({ ok: false, motivo: "cartao_indisponivel" });
    expect(execEscrever).toHaveBeenCalledTimes(1);
  });

  it("cartão que o banco não reserva (expirado, de outro usuário, de outra empresa): não executa", async () => {
    const b = banco(null);
    const r = await executarConfirmada(b.admin, "acao-1", undefined, ctx(), deps());
    expect(r).toEqual({ ok: false, motivo: "cartao_indisponivel" });
    expect(execEscrever).not.toHaveBeenCalled();
  });

  it("a reserva é pedida com o usuário e a organização do CONTEXTO", async () => {
    const b = banco(cartao());
    await executarConfirmada(b.admin, "acao-1", undefined, ctx(), deps());
    expect((b.admin as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith("fn_assistente_reservar_acao", {
      p_org: ORG,
      p_user: USER,
      p_acao: "acao-1",
    });
  });

  it("papel rebaixado entre a proposta e o clique: não executa e o cartão fica falhou", async () => {
    const b = banco(cartao());
    const r = await executarConfirmada(b.admin, "acao-1", undefined, ctx("viewer"), deps());
    expect(r).toMatchObject({ ok: false, motivo: "papel_insuficiente" });
    expect(execEscrever).not.toHaveBeenCalled();
    expect(b.atualizacoes.at(-1)).toMatchObject({ estado: "falhou" });
  });

  it("escritas desligadas depois da proposta: não executa", async () => {
    const b = banco(cartao());
    const r = await executarConfirmada(b.admin, "acao-1", undefined, ctx(), deps({ escritasLigadas: false }));
    expect(r).toMatchObject({ ok: false, motivo: "escritas_desligadas" });
    expect(execEscrever).not.toHaveBeenCalled();
  });

  it("cartão adulterado para 6 itens (entrada ou contagem) com limite 5: não executa", async () => {
    const seis = ["1", "2", "3", "4", "5", "6"];
    for (const adulterado of [cartao({ entrada: { ids: seis }, quantidade: 2 }), cartao({ quantidade: 6 })]) {
      const b = banco(adulterado);
      const r = await executarConfirmada(b.admin, "acao-1", undefined, ctx(), deps());
      expect(r).toMatchObject({ ok: false, motivo: "lote_acima_do_limite" });
    }
    expect(execEscrever).not.toHaveBeenCalled();
  });

  it("cartão adulterado para capacidade proibida ou inexistente: não executa", async () => {
    for (const nome of ["teste_convidar", "crm_send_whatsapp_message", "nao_existe"]) {
      const b = banco(cartao({ capacidade: nome }));
      const r = await executarConfirmada(b.admin, "acao-1", undefined, ctx("admin"), deps());
      expect(r.ok).toBe(false);
    }
    expect(execEscrever).not.toHaveBeenCalled();
  });

  it("cartão cuja capacidade é de LEITURA não executa por esta porta", async () => {
    const b = banco(cartao({ capacidade: "teste_ler", entrada: {} }));
    const r = await executarConfirmada(b.admin, "acao-1", undefined, ctx(), deps());
    expect(r).toMatchObject({ ok: false, motivo: "nivel_errado" });
    expect(execLer).not.toHaveBeenCalled();
  });

  it("nível sensível: sem a palavra digitada não executa; com ela, executa", async () => {
    const sens = () => cartao({ capacidade: "teste_sensivel", nivel: "sensivel" });
    for (const palavra of [undefined, "", "sim", "confirma"]) {
      const b = banco(sens());
      expect(await executarConfirmada(b.admin, "acao-1", palavra, ctx(), deps())).toMatchObject({
        ok: false,
        motivo: "confirmacao_ausente",
      });
    }
    expect(execSensivel).not.toHaveBeenCalled();
    const b = banco(sens());
    expect((await executarConfirmada(b.admin, "acao-1", " Confirmar ", ctx(), deps())).ok).toBe(true);
    expect(execSensivel).toHaveBeenCalledTimes(1);
  });

  it("cartão de nível escrever gravado como sensível (ou o contrário) não executa", async () => {
    const b = banco(cartao({ nivel: "sensivel" }));
    expect(await executarConfirmada(b.admin, "acao-1", "confirmar", ctx(), deps())).toMatchObject({
      ok: false,
      motivo: "nivel_errado",
    });
    expect(execEscrever).not.toHaveBeenCalled();
  });
});
