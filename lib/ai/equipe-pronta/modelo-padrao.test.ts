import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { versionCreateSchema } from "@/lib/ai/agents/validation";
import { costCents } from "@/lib/agent-engine/edge/llm/pricing";
import { perfilSchema } from "@/lib/schemas/equipe-pronta";

import { PAPEIS } from "./index";
import { EquipeProntaError, type ModeloEscolhido } from "./instalar";
import { MODELO_PADRAO_DA_PLATAFORMA, escolherModeloDaEquipe } from "./modelo-padrao";
import { portasDeProducao } from "./portas";
import { renderizarAgente } from "./renderizar";

/**
 * O MODELO COM QUE A EQUIPE PRONTA NASCE (Tarefa 8, parte 5).
 *
 * Os dois casos pedidos, medidos na porta que o instalador usa de verdade
 * (`portasDeProducao().escolherModelo`): com a chave da plataforma no ambiente,
 * `anthropic` + `claude-haiku-5-5`; sem ela, o comportamento de antes.
 *
 * ⚠️ A "chave" destes testes é um texto de mentira, escrito aqui. Nenhum valor
 * real entra no repositório, e o teste cobra que nem o de mentira apareça no
 * que a porta devolve.
 */

// A leitura de "o provedor é oferecido?" vai ao banco pela configuração de
// módulos; aqui ela é a resposta de uma instalação comum: os provedores de chave.
vi.mock("@/lib/ai/pontos/provedores-oferecidos", () => ({
  provedorOferecido: async () => (id: string) => id !== "openai-assinatura",
}));

const CHAVE_DE_MENTIRA = "valor-de-mentira-so-para-o-teste";
const ORG = "66666666-6666-4666-8666-666666666666";

interface Banco {
  credenciais?: { id: string; provider: string }[];
  haikuNoCatalogo?: boolean;
  /** O modelo curado do catálogo, que a escolha de antes devolve para a Anthropic. */
  curadoDaAnthropic?: string;
}

/** Um `pg` de mentira que responde só às consultas que a escolha de modelo faz. */
function banco(b: Banco = {}) {
  const consultas: string[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    consultas.push(sql);
    const credenciais = b.credenciais ?? [];
    if (sql.includes("from ai_provider_credentials") && sql.startsWith("select 1")) {
      return { rows: credenciais.length > 0 ? [{ "?column?": 1 }] : [] };
    }
    if (sql.includes("from ai_models") && sql.startsWith("select 1")) {
      return { rows: b.haikuNoCatalogo === false ? [] : [{ "?column?": 1 }] };
    }
    // Daqui para baixo, as consultas de `resolveSetupModel` (a escolha de antes).
    if (sql.includes("from ai_agents a")) return { rows: [] };
    if (sql.includes("select settings from organizations")) return { rows: [{ settings: {} }] };
    if (sql.includes("select id,provider from ai_provider_credentials")) return { rows: credenciais };
    if (sql.includes("from ai_models where provider=$1")) {
      const provider = params[0];
      if (provider === "anthropic") {
        return {
          rows: [
            { model_id: b.curadoDaAnthropic ?? "claude-sonnet-5", display_name: "Curado", is_default_for_provider: true, supports_tools: true, input_price_per_million_cents: 200, output_price_per_million_cents: 1000 },
            { model_id: "claude-haiku-5-5", display_name: "Haiku", is_default_for_provider: false, supports_tools: true, input_price_per_million_cents: 10, output_price_per_million_cents: 50 },
          ],
        };
      }
      if (provider === "openai") {
        return { rows: [{ model_id: "gpt-do-cliente", display_name: "GPT", is_default_for_provider: true, supports_tools: true, input_price_per_million_cents: 100, output_price_per_million_cents: 500 }] };
      }
      return { rows: [] };
    }
    throw new Error(`consulta inesperada no teste: ${sql.slice(0, 80)}`);
  });
  return { db: { query } as unknown as pg.PoolClient, consultas };
}

const VARIAVEIS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"] as const;
function ambiente(valores: Partial<Record<(typeof VARIAVEIS)[number], string>>) {
  for (const nome of VARIAVEIS) vi.stubEnv(nome, valores[nome] ?? "");
}
afterEach(() => vi.unstubAllEnvs());

const portas = () => portasDeProducao({} as unknown as SupabaseClient);

describe("o instalador da equipe pronta escolhe o modelo do agente novo", () => {
  it("⭐ COM a chave da plataforma no ambiente: anthropic + claude-haiku-5-5, sem credencial escolhida", async () => {
    ambiente({ ANTHROPIC_API_KEY: CHAVE_DE_MENTIRA });
    const { db } = banco();
    const modelo = await portas().escolherModelo(db, ORG, null);
    expect(modelo).toEqual({ provider: "anthropic", model: "claude-haiku-5-5", credential_id: null });
    expect(MODELO_PADRAO_DA_PLATAFORMA).toEqual({ provider: "anthropic", model: "claude-haiku-5-5" });
    // A chave não viaja: a porta só soube que ela existe.
    expect(JSON.stringify(modelo)).not.toContain(CHAVE_DE_MENTIRA);
  });

  it("⭐ SEM a chave da plataforma e sem chave nenhuma: o erro de sempre, 'sem_chave_de_ia', e nada é escolhido", async () => {
    ambiente({});
    const { db, consultas } = banco();
    const erro = await portas().escolherModelo(db, ORG, null).then(
      () => null,
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(EquipeProntaError);
    expect((erro as EquipeProntaError).codigo).toBe("sem_chave_de_ia");
    expect((erro as EquipeProntaError).status).toBe(422);
    // Sem a chave, o caminho novo nem consulta o banco: quem responde é a escolha de antes.
    expect(consultas.some((sql) => sql.startsWith("select 1"))).toBe(false);
  });

  it("⭐ SEM a chave da plataforma e com a chave do cliente: a escolha de antes, com a credencial dele", async () => {
    ambiente({});
    const { db } = banco({ credenciais: [{ id: "77777777-7777-4777-8777-777777777777", provider: "openai" }] });
    expect(await portas().escolherModelo(db, ORG, null)).toEqual({
      provider: "openai",
      model: "gpt-do-cliente",
      credential_id: "77777777-7777-4777-8777-777777777777",
    });
  });

  it("controle: sem a mudança, a chave da plataforma levaria ao modelo CURADO do catálogo, e não ao Haiku", async () => {
    // É o que `escolhaDeSempre` devolve com a chave no ambiente: o caso que a parte 5 muda.
    ambiente({ ANTHROPIC_API_KEY: CHAVE_DE_MENTIRA });
    const { db } = banco({ haikuNoCatalogo: false });
    expect(await portas().escolherModelo(db, ORG, null)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
      credential_id: null,
    });
  });
});

describe("quando o modelo padrão NÃO vale, fica a escolha de antes", () => {
  const deSempre: ModeloEscolhido = { provider: "openai", model: "modelo-de-sempre", credential_id: "88888888-8888-4888-8888-888888888888" };
  const comChave = { temChaveDaPlataforma: (p: string) => p === "anthropic", oferece: () => true };

  it("a empresa trouxe a própria chave: a escolha dela é respeitada, mesmo com a chave da plataforma no ambiente", async () => {
    const { db } = banco({ credenciais: [{ id: deSempre.credential_id!, provider: "openai" }] });
    const escolhaDeSempre = vi.fn(async () => deSempre);
    expect(await escolherModeloDaEquipe(db, ORG, { ...comChave, escolhaDeSempre })).toBe(deSempre);
    expect(escolhaDeSempre).toHaveBeenCalledTimes(1);
  });

  it("o modelo padrão não está no catálogo desta instalação (ou está sem ferramentas): a escolha de antes", async () => {
    const { db } = banco({ haikuNoCatalogo: false });
    const escolhaDeSempre = vi.fn(async () => deSempre);
    expect(await escolherModeloDaEquipe(db, ORG, { ...comChave, escolhaDeSempre })).toBe(deSempre);
  });

  it("o provedor não é oferecido nesta instalação: a escolha de antes, sem consultar o banco", async () => {
    const { db, consultas } = banco();
    const escolhaDeSempre = vi.fn(async () => deSempre);
    expect(await escolherModeloDaEquipe(db, ORG, { temChaveDaPlataforma: () => true, oferece: () => false, escolhaDeSempre })).toBe(deSempre);
    expect(consultas).toEqual([]);
  });

  it("com tudo no lugar, a escolha de antes nem é chamada", async () => {
    const { db } = banco();
    const escolhaDeSempre = vi.fn(async () => deSempre);
    expect(await escolherModeloDaEquipe(db, ORG, { ...comChave, escolhaDeSempre })).toEqual({
      provider: "anthropic",
      model: "claude-haiku-5-5",
      credential_id: null,
    });
    expect(escolhaDeSempre).not.toHaveBeenCalled();
  });
});

describe("a versão que nasce com o modelo padrão é válida, e o preço dele está na tabela", () => {
  const perfil = perfilSchema.parse({
    negocio: { nome: "Empresa", o_que_faz: "Presta um serviço." },
    atendente: { nome: "Ana" },
    primeiro_passo: { tipo: "humano" },
  });

  it.each(PAPEIS.map((p) => [p.id, p] as const))("%s: os campos do papel + o modelo padrão passam no schema da versão", (_id, papel) => {
    const campos = renderizarAgente(papel, perfil, { agenda: null, funil: null, knowledgeSourceIds: [], reguaDeFollowupId: null });
    const versao = versionCreateSchema.safeParse({
      ...campos,
      ...MODELO_PADRAO_DA_PLATAFORMA,
      credential_id: null,
      channel_session_id: null,
      handoff_tool_enabled: true,
    });
    expect(versao.success, JSON.stringify(versao.error?.issues)).toBe(true);
    expect(versao.data).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5", credential_id: null });
  });

  it("⭐ o preço registrado é o da página oficial conferida em 25/11/2026: US$ 0,10 de entrada e US$ 0,50 de saída por milhão", () => {
    const milhao = 1_000_000;
    const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    // 1 milhão de tokens de entrada = US$ 0,10 = 10 centavos; de saída = US$ 0,50 = 50 centavos.
    expect(costCents("claude-haiku-5-5", { ...zero, inputTokens: milhao })).toBeCloseTo(10, 6);
    expect(costCents("claude-haiku-5-5", { ...zero, outputTokens: milhao })).toBeCloseTo(50, 6);
  });
});
