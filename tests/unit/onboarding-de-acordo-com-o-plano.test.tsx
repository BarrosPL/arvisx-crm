// @vitest-environment jsdom
/**
 * ONBOARDING DE ACORDO COM O PLANO (ArvisX): o Essencial não tem os passos de IA.
 *
 * O roteiro do wizard era o MESMO para todos os planos, e ele é inteiro sobre
 * montar um "funcionário" de IA. No Essencial, que não tem IA:
 *
 *  - `createDefaultAgent` e `salvarChaveDaIa` são server actions, que não passam
 *    pela trava de `/api/v1`: a pessoa guardava uma chave e criava um agente que
 *    o motor nunca roda (`planoIncluiIaParaOMotor` = false);
 *  - o passo do funil pedia uma sugestão à IA e, sem chave, mostrava "Não
 *    consegui pedir uma sugestão para o seu funcionário";
 *  - todos os textos falavam de "seu funcionário" / "ele".
 *
 * A ordem dos passos e os rótulos têm os casos próprios em
 * `lib/onboarding/passos.test.ts`. Aqui ficam a leitura do plano, as travas de
 * servidor, o funil e os textos.
 *
 * "Tem IA" é a leitura que já trava as telas (`leituraDoPlanoDaOrg` + o grupo
 * `ia` do catálogo). Na FALHA de leitura o roteiro é o de sempre, COM IA: um
 * Premium não pode perder os passos porque uma leitura oscilou.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import type { LeituraDoPlano } from "@/lib/cobranca/telas-do-plano";

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";

/** O plano Essencial é o preset `simplificada` (só o Atendimento); o Standard libera tudo. */
const ESSENCIAL: LeituraDoPlano = { tipo: "plano", interface: { preset: "simplificada" } };
const STANDARD: LeituraDoPlano = { tipo: "plano", interface: { preset: "completa" } };
const ISENTA: LeituraDoPlano = { tipo: "isenta" };
const FALHA: LeituraDoPlano = { tipo: "falha" };

interface Resposta {
  data: unknown;
  error: { message: string } | null;
}

const cena = vi.hoisted(() => ({
  leitura: { tipo: "isenta" } as unknown,
  leituraLanca: false,
  papel: "admin",
  respostas: {} as Record<string, unknown>,
  /** Toda tabela que alguém abriu, e toda escrita pedida. */
  tabelas: [] as string[],
  escritas: [] as { tabela: string; op: string }[],
  rpcs: [] as string[],
}));

const generateText = vi.hoisted(() => vi.fn(async () => ({ text: "isto não é um quadro" })));
const guardarCredencial = vi.hoisted(() => vi.fn(async () => ({ ok: false, motivo: "falhou" })));
const definirPadrao = vi.hoisted(() => vi.fn(async () => ({ ok: false, motivo: "nao_gravou" })));
const audit = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("ai", () => ({ generateText }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT: ${url}`);
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/auth/server", () => ({
  mfaEmDivida: vi.fn(async () => false),
  loadAuthUser: vi.fn(async () => ({ id: USER, email: "dono@qa.local", full_name: "Dono" })),
  resolveActiveOrg: vi.fn(async () => ({ orgId: ORG, name: "Clínica QA", role: cena.papel })),
}));
vi.mock("@/lib/cobranca/leitura-do-plano", () => ({
  leituraDoPlanoDaOrg: vi.fn(async () => {
    if (cena.leituraLanca) throw new Error("banco fora do ar");
    return cena.leitura;
  }),
}));
vi.mock("@/lib/ai/credenciais/guardar", () => ({
  guardarCredencial,
  MENSAGEM_ASSINATURA_SO_PELO_LOGIN: "assinatura só pelo login",
}));
vi.mock("@/lib/ai/pontos/padrao-da-organizacao", () => ({ definirPadraoDeIaDaOrganizacao: definirPadrao }));
vi.mock("@/lib/ai/pontos/provedores-oferecidos", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@/lib/ai/pontos/provedores-oferecidos")),
  provedorDesligadoNaInstalacao: vi.fn(async () => false),
}));
vi.mock("@/lib/ai/runtime/agent", () => ({
  buildModel: vi.fn(() => ({ modelo: "de mentira" })),
  chaveDePlataforma: vi.fn(() => "chave-da-instalacao"),
}));

/** Banco de mentira no formato do PostgREST: encadeável, thenable, e que ANOTA o que foi pedido. */
function consulta(tabela: string) {
  const resposta = (): Resposta => (cena.respostas[tabela] as Resposta | undefined) ?? { data: null, error: null };
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "is", "not", "in", "order", "limit"]) q[m] = () => q;
  for (const op of ["insert", "update", "upsert", "delete"]) {
    q[op] = () => {
      cena.escritas.push({ tabela, op });
      return q;
    };
  }
  q.maybeSingle = async () => resposta();
  q.single = async () => resposta();
  q.then = (ok: (r: Resposta) => unknown, falha?: (e: unknown) => unknown) =>
    Promise.resolve(resposta()).then(ok, falha);
  return q;
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      cena.tabelas.push(tabela);
      return consulta(tabela);
    },
    rpc: async (nome: string) => {
      cena.rpcs.push(nome);
      return { data: null, error: null };
    },
  }),
}));

import { createDefaultAgent } from "@/app/actions/onboarding/createDefaultAgent";
import { salvarChaveDaIa } from "@/app/actions/onboarding/chaveDaIa";
import { dadosDoPasso } from "@/app/actions/onboarding/montarQuadro";
import { DoneClient } from "@/app/onboarding/done/_client";
import { QuadroClient } from "@/app/onboarding/funil/_client";
import { InviteTeamForm } from "@/app/onboarding/invite-team/_form";
import { IDS_DE_PROVEDOR } from "@/lib/ai/pontos/provedores";
import {
  MENSAGEM_IA_FORA_DO_PLANO,
  contextoDoOnboarding,
  iaNoPlanoDaOrg,
} from "@/lib/onboarding/contexto";
import { oQueMaisExiste } from "@/lib/onboarding/o-que-mais-existe";
import { passosVisiveis, resumoDoOnboarding } from "@/lib/onboarding/passos";

function formulario(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

beforeEach(() => {
  cena.leitura = ISENTA;
  cena.leituraLanca = false;
  cena.papel = "admin";
  cena.respostas = {};
  cena.tabelas = [];
  cena.escritas = [];
  cena.rpcs = [];
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("a leitura do plano vira o contexto do onboarding", () => {
  it("⭐ Essencial (só o Atendimento) = sem IA; Standard e empresa isenta = com IA", async () => {
    cena.leitura = ESSENCIAL;
    expect(await iaNoPlanoDaOrg(ORG)).toBe(false);
    expect((await contextoDoOnboarding(ORG)).iaNoPlano).toBe(false);

    cena.leitura = STANDARD;
    expect((await contextoDoOnboarding(ORG)).iaNoPlano).toBe(true);

    cena.leitura = ISENTA;
    expect((await contextoDoOnboarding(ORG)).iaNoPlano).toBe(true);
  });

  it("⭐ leitura em FALHA = com IA, o roteiro de sempre (um Premium não perde os passos)", async () => {
    cena.leitura = FALHA;
    const ctx = await contextoDoOnboarding(ORG);
    expect(ctx.iaNoPlano).toBe(true);
    expect(passosVisiveis(ctx).map((p) => p.segmento)).toEqual(
      expect.arrayContaining(["setup-ai", "testar"]),
    );

    // E a leitura que LANÇA também: o contexto nunca derruba o wizard.
    cena.leituraLanca = true;
    expect(await iaNoPlanoDaOrg(ORG)).toBe(true);
    expect((await contextoDoOnboarding(ORG)).iaNoPlano).toBe(true);
  });

  it("o contexto do Essencial tira os dois passos de IA do roteiro", async () => {
    cena.leitura = ESSENCIAL;
    const segmentos = passosVisiveis(await contextoDoOnboarding(ORG)).map((p) => p.segmento);
    expect(segmentos).not.toContain("setup-ai");
    expect(segmentos).not.toContain("testar");
    expect(segmentos).toEqual(expect.arrayContaining(["welcome", "connect-whatsapp", "funil", "invite-team"]));
  });
});

describe("as actions de IA do onboarding têm trava de servidor", () => {
  it("⭐ createDefaultAgent recusa no plano sem IA, com mensagem clara, e não grava nada", async () => {
    cena.leitura = ESSENCIAL;
    const r = await createDefaultAgent(formulario({ name: "Bia", prompt_template: "ecommerce_friendly" }));

    expect(r).toEqual({ ok: false, error: "fora_do_plano", mensagem: MENSAGEM_IA_FORA_DO_PLANO });
    expect(MENSAGEM_IA_FORA_DO_PLANO).toBe("Os agentes de IA estão no Standard e no Premium.");
    expect(cena.escritas).toEqual([]);
    // Nem leitura: a recusa vem antes de abrir qualquer tabela.
    expect(cena.tabelas).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("controle: com IA no plano a mesma chamada chega a escrever em ai_agents", async () => {
    cena.leitura = STANDARD;
    // O banco recusa a escrita: basta para provar que a action passou da trava
    // e TENTOU gravar, sem montar a publicação inteira.
    cena.respostas.ai_agents = { data: null, error: { message: "sem banco" } };
    const r = await createDefaultAgent(formulario({ name: "Bia", prompt_template: "ecommerce_friendly" }));

    expect(r).toMatchObject({ ok: false, error: "db_error" });
    expect(cena.escritas).toContainEqual({ tabela: "ai_agents", op: "update" });
  });

  it("⭐ salvarChaveDaIa recusa no plano sem IA e não guarda a chave nem muda o padrão da empresa", async () => {
    cena.leitura = ESSENCIAL;
    const r = await salvarChaveDaIa(formulario({ provider: IDS_DE_PROVEDOR[0], api_key: "sk-chave-inteira-123" }));

    expect(r).toEqual({ ok: false, erro: "Os agentes de IA estão no Standard e no Premium." });
    expect(guardarCredencial).not.toHaveBeenCalled();
    expect(definirPadrao).not.toHaveBeenCalled();
    expect(cena.escritas).toEqual([]);
    expect(cena.tabelas).toEqual([]);
  });

  it("controle: com IA no plano (e na falha de leitura) a mesma chamada chega a guardar a chave", async () => {
    for (const leitura of [STANDARD, FALHA]) {
      guardarCredencial.mockClear();
      cena.leitura = leitura;
      const r = await salvarChaveDaIa(formulario({ provider: IDS_DE_PROVEDOR[0], api_key: "sk-chave-inteira-123" }));
      expect(guardarCredencial, leitura.tipo).toHaveBeenCalledTimes(1);
      expect(r, leitura.tipo).toEqual({ ok: false, erro: "Não consegui guardar a chave agora. Tente de novo." });
    }
  });
});

describe("o quadro do funil", () => {
  /** Um agente publicado, com modelo e chave: tudo o que a sugestão por IA precisa para ser pedida. */
  function comAgentePublicado() {
    cena.respostas = {
      organizations: {
        data: { onboarding_state: { welcome: { o_que_faz: "clínica odontológica" } }, onboarded_at: null },
        error: null,
      },
      crm_pipelines: { data: { id: "funil-1", name: "Pedidos" }, error: null },
      crm_stages: { data: [{ name: "Carrinho abandonado", position: 1 }], error: null },
      ai_agents: { data: { published_version_id: "versao-1" }, error: null },
      ai_agent_versions: { data: { provider: "anthropic", model: "modelo-x", credential_id: null }, error: null },
    };
  }

  it("⭐ plano sem IA: não chama a IA e usa direto o pacote, sem motivo de falha", async () => {
    comAgentePublicado();
    cena.leitura = ESSENCIAL;
    const { atual, sugestao } = await dadosDoPasso(ORG, "Clínica QA");

    expect(generateText).not.toHaveBeenCalled();
    // Nem procura o agente: não há cérebro a consultar num plano sem IA.
    expect(cena.tabelas).not.toContain("ai_agents");
    expect(cena.tabelas).not.toContain("ai_agent_versions");
    expect(sugestao.origem).toBe("pacote");
    if (sugestao.origem !== "pacote") throw new Error("esperava o pacote");
    expect(sugestao.porque).toBe("");
    expect(sugestao.pacote.proposta.etapas.length).toBeGreaterThan(2);
    expect(atual).toEqual({ pipelineId: "funil-1", nome: "Pedidos", colunas: ["Carrinho abandonado"] });
  });

  it("controle: com IA no plano a MESMA empresa pede a sugestão à IA", async () => {
    comAgentePublicado();
    cena.leitura = STANDARD;
    const { sugestao } = await dadosDoPasso(ORG, "Clínica QA");

    expect(generateText).toHaveBeenCalledTimes(1);
    // A resposta de mentira não é um quadro: cai no pacote, COM o motivo.
    expect(sugestao.origem).toBe("pacote");
    if (sugestao.origem !== "pacote") throw new Error("esperava o pacote");
    expect(sugestao.porque).not.toBe("");
  });

  it("⭐ a tela do Essencial diz de onde veio o quadro, sem aviso de falha e sem 'ele'", async () => {
    cena.leitura = ESSENCIAL;
    const { atual, sugestao } = await dadosDoPasso(ORG, "Clínica QA");
    const { container } = render(<QuadroClient atual={atual} sugestao={sugestao} iaNoPlano={false} />);
    const texto = container.textContent ?? "";

    expect(texto).toContain(
      "Sugerimos este quadro a partir do que você contou sobre o negócio. Ajuste o que quiser.",
    );
    expect(texto).not.toContain("Não consegui pedir uma sugestão");
    expect(texto).not.toMatch(/funcion[aá]ri/i);
    expect(texto).not.toContain("Ele move o cliente para cá quando");
    expect(texto).not.toContain("ele não mexe nesta");
  });

  it("controle: com IA no plano a mesma sugestão de pacote mostra o aviso de sempre", async () => {
    cena.leitura = ESSENCIAL;
    const { atual, sugestao } = await dadosDoPasso(ORG, "Clínica QA");
    const { container } = render(<QuadroClient atual={atual} sugestao={sugestao} />);
    const texto = container.textContent ?? "";

    expect(texto).toContain("Não consegui pedir uma sugestão para o seu funcionário agora");
    expect(texto).not.toContain("Sugerimos este quadro a partir do que você contou");
    expect(texto).toMatch(/Ele move o cliente para cá quando|ele não mexe nesta/);
  });
});

describe("os textos do Essencial não falam de funcionário", () => {
  const SEM_IA = { lojaLigada: false, iaNoPlano: false };
  const TUDO_FEITO = {
    welcome: { accepted_at: "x", timezone: "America/Sao_Paulo", display_name: "N" },
    whatsapp: { status: "WORKING" },
    funil: { pipeline_id: "f", origem: "pacote" as const, etapas: 6 },
    team: { invites_sent: 2 },
  };

  it("⭐ a última página fala da empresa, aponta o plano e não oferece nada de IA", () => {
    const itens = resumoDoOnboarding(TUDO_FEITO, SEM_IA);
    // `noAr: false` de propósito: no Essencial não há agente publicado, e isso
    // NÃO pode virar "Quase lá" nem "ele ainda não foi treinado".
    const { container } = render(
      <DoneClient itens={itens} pecas={oQueMaisExiste({ iaNoPlano: false })} noAr={false} iaNoPlano={false} />,
    );
    const texto = container.textContent ?? "";

    expect(texto).toContain("Tudo pronto!");
    expect(texto).toContain("Sua empresa está pronta: conecte, atenda e acompanhe tudo pelo Inbox.");
    expect(texto).not.toContain("Quase lá!");
    expect(texto).not.toMatch(/funcion[aá]ri/i);
    expect(texto).not.toMatch(/\b[Ee]le\b|\bdele\b/);
    expect(texto).not.toMatch(/treinad|chave|rascunho/i);

    const plano = container.querySelector("[data-ia-fora-do-plano] a")!;
    expect(plano.textContent).toBe("Agentes de IA estão nos planos Standard e Premium.");
    expect(plano.getAttribute("href")).toBe("/app/settings/billing");

    // O tour só aponta para telas que o plano tem: nenhuma de IA.
    const hrefs = [...container.querySelectorAll("li a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/app/inbox", "/app/kanban", "/app/contacts", "/app/tasks"]);
  });

  it("ficou algo para depois: a frase muda, e continua sem funcionário", () => {
    const itens = resumoDoOnboarding({ ...TUDO_FEITO, whatsapp: { status: "skipped", skipped: true } }, SEM_IA);
    const { container } = render(<DoneClient itens={itens} pecas={[]} noAr={false} iaNoPlano={false} />);
    const texto = container.textContent ?? "";

    expect(texto).toContain("Sua empresa já pode começar. O que ficou para depois continua te esperando.");
    expect(texto).toContain("Seu WhatsApp (você pulou)");
    expect(texto).not.toMatch(/funcion[aá]ri/i);
  });

  it("controle: com IA no plano a última página é a de sempre, sem a linha do plano", () => {
    const itens = resumoDoOnboarding(
      { ...TUDO_FEITO, ai: { agent_id: "a", prompt_template: "p" }, teste: { respondeu: true } },
      { lojaLigada: false, iaNoPlano: true },
    );
    const { container } = render(<DoneClient itens={itens} pecas={oQueMaisExiste()} noAr />);
    const texto = container.textContent ?? "";

    expect(texto).toContain("Seu funcionário está montado. Daqui em diante é só acompanhar.");
    expect(container.querySelector("[data-ia-fora-do-plano]")).toBeNull();
    expect(texto).not.toContain("Agentes de IA estão nos planos Standard e Premium.");
    expect([...container.querySelectorAll("li a")].map((a) => a.getAttribute("href"))).toContain(
      "/app/ai/followups",
    );
  });

  it("o tour do Essencial não promete comportamento de agente, e o de quem tem IA não mudou", () => {
    const semIa = oQueMaisExiste({ iaNoPlano: false });
    const tudo = semIa.flatMap((p) => [p.comoChamar, p.porQue, ...p.comoFunciona]).join(" ");
    expect(tudo).not.toMatch(/funcion[aá]ri|\b[Ee]le\b|\bdele\b|sozinho|\bIA\b/);
    expect(semIa.every((p) => !p.href.startsWith("/app/ai"))).toBe(true);
    for (const p of semIa) expect(p.comoFunciona.length, p.href).toBeGreaterThanOrEqual(3);

    expect(oQueMaisExiste({ iaNoPlano: true })).toEqual(oQueMaisExiste());
    expect(oQueMaisExiste().map((p) => p.href)).toContain("/app/ai/inbox");
  });

  it("⭐ o convite da equipe: 'quem vai atender com você', não 'com ele'", () => {
    const semIa = render(<InviteTeamForm iaNoPlano={false} />);
    expect(semIa.container.textContent).toContain("E-mail de quem vai atender com você");
    expect(semIa.container.textContent).not.toMatch(/com ele|funcion[aá]ri/i);
    cleanup();

    const comIa = render(<InviteTeamForm />);
    expect(comIa.container.textContent).toContain("E-mail de quem vai trabalhar com ele");
  });
});
