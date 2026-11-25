import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

import { describe, expect, it } from "vitest";

import { ORIGEM_DA_CHAVE_DO_JEV } from "@/lib/ai/decisao/origem";
import { ORIGENS_DA_CHAVE, origemDaChaveGravada } from "@/lib/ai/usage/origem-da-chave";
import { linhaDaLigacao } from "@/workers/voice-agent/uso-da-sessao";

/**
 * TODO ESCRITOR DE `llm_calls` DIZ DE QUEM É A CHAVE (Tarefa 8; migration 9825).
 *
 * O padrão da coluna `origem_da_chave` é `plataforma`: a linha de quem não
 * informa conta no teto do plano. Isso protege quem paga a chave da instalação,
 * mas tem um custo: o escritor que usa a chave do CLIENTE e esquece de dizer
 * faz a empresa gastar o que o plano inclui sem dever. O jeito de não depender
 * de memória é este arquivo: ele acha todo ponto do produto que grava em
 * `llm_calls` e cobra que a origem esteja escrita ali.
 *
 * Escritor novo que não informa a origem reprova aqui.
 */

const RAIZ = join(__dirname, "..", "..");
const RAIZES = ["app", "lib", "workers"] as const;

function arquivos(dir: string): string[] {
  return readdirSync(join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = posix.join(dir, e.name);
    if (e.isDirectory()) return arquivos(rel);
    return /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel) ? [rel] : [];
  });
}

interface Escrita {
  arquivo: string;
  linha: number;
  trecho: string;
}

/** O objeto de `.insert({ … })`, do `{` até a chave que o fecha. */
function objetoDoInsert(fonte: string, de: number): string {
  const abre = fonte.indexOf("{", de);
  let nivel = 0;
  for (let i = abre; i < fonte.length; i++) {
    if (fonte[i] === "{") nivel++;
    else if (fonte[i] === "}" && --nivel === 0) return fonte.slice(abre, i + 1);
  }
  return fonte.slice(abre);
}

function escritasDe(arquivo: string): Escrita[] {
  const fonte = readFileSync(join(RAIZ, arquivo), "utf8");
  const linhaDe = (i: number) => fonte.slice(0, i).split("\n").length;
  const achadas: Escrita[] = [];
  // Pelo cliente do Supabase: `.from("llm_calls")` seguido de `.insert(`.
  for (const m of fonte.matchAll(/\.from\(\s*["']llm_calls["']\s*\)\s*\.insert\(/g)) {
    achadas.push({ arquivo, linha: linhaDe(m.index), trecho: objetoDoInsert(fonte, m.index + m[0].length - 1) });
  }
  // Pelo `pg`: `insert into [public.]llm_calls ( colunas )`.
  for (const m of fonte.matchAll(/insert\s+into\s+(?:public\.)?llm_calls\s*\(([^)]*)\)/gi)) {
    achadas.push({ arquivo, linha: linhaDe(m.index), trecho: m[1]! });
  }
  return achadas;
}

const ESCRITAS = RAIZES.flatMap(arquivos).flatMap(escritasDe);

describe("todo escritor de llm_calls diz de quem é a chave", () => {
  it("guarda de vacuidade: a varredura acha os escritores conhecidos, pelos dois caminhos", () => {
    const onde = new Set(ESCRITAS.map((e) => e.arquivo));
    for (const esperado of [
      "lib/agent-engine/edge/llm/run-model-call.ts",
      "lib/agent-engine/edge/crm/send-voice.ts",
      "lib/ai/log-invocation.ts",
      "lib/ai/usage/registrar-chamada.ts",
      "lib/ai/decisao/pedidos.ts",
      "lib/ai/decisao/roteador.ts",
      "lib/ai/decisao/pool.ts",
      "workers/media-derive-worker.ts",
    ]) {
      expect(onde, `a varredura não achou o escritor ${esperado}`).toContain(esperado);
    }
    expect(ESCRITAS.length).toBeGreaterThanOrEqual(17);
  });

  it.each(ESCRITAS.map((e) => [`${e.arquivo}:${e.linha}`, e] as const))("%s grava origem_da_chave", (_onde, escrita) => {
    expect(
      escrita.trecho,
      "Este ponto grava em llm_calls sem dizer de quem é a chave. Sem a origem, a linha cai no\n" +
        "padrão da coluna (`plataforma`) e conta no teto do plano. Grave `origem_da_chave`:\n" +
        "`cliente` para credencial da organização, `plataforma` para a chave da instalação.",
    ).toMatch(/origem_da_chave/);
  });

  it("controle: a varredura reprova um escritor sem a origem", () => {
    const semOrigem = `await admin.from("llm_calls").insert({ organization_id: org, purpose: "x", provider: "y", model: "z" });`;
    const m = /\.from\(\s*["']llm_calls["']\s*\)\s*\.insert\(/.exec(semOrigem)!;
    expect(objetoDoInsert(semOrigem, m.index + m[0].length - 1)).not.toMatch(/origem_da_chave/);
    const sql = "insert into public.llm_calls (organization_id, purpose, provider, model) values ($1, $2, $3, $4)";
    expect(/insert\s+into\s+(?:public\.)?llm_calls\s*\(([^)]*)\)/i.exec(sql)![1]).not.toMatch(/origem_da_chave/);
  });
});

describe("quem repassa a linha por um registrador comum também informa a origem", () => {
  const fonte = (arquivo: string) => readFileSync(join(RAIZ, arquivo), "utf8");

  /** O texto de cada chamada `nome({ … })`, pelo objeto do argumento. */
  function chamadas(arquivo: string, nome: string): string[] {
    const f = fonte(arquivo);
    return [...f.matchAll(new RegExp(`\\b${nome}\\(\\{`, "g"))].map((m) => objetoDoInsert(f, m.index + m[0].length - 1));
  }

  it("worker de resposta (legado): as três linhas levam a origem e o contato", () => {
    const linhas = chamadas("workers/ai-response-worker.ts", "logInvocation");
    expect(linhas).toHaveLength(3);
    for (const linha of linhas) {
      expect(linha).toMatch(/origem_da_chave: origemDaChaveGravada\(origemDaChave\)/);
      expect(linha).toMatch(/contact_id: ctx\.contact_id/);
    }
  });

  it("worker de sentimento: as duas linhas do Jev são do cliente, e as duas da IA de sempre seguem o ponto resolvido", () => {
    const linhas = chamadas("workers/ai-sentiment-worker.ts", "logInvocation");
    expect(linhas).toHaveLength(4);
    const doJev = linhas.filter((l) => /provider: "typesafe"/.test(l));
    const daIa = linhas.filter((l) => /provider: resolvido\.provider/.test(l));
    expect(doJev).toHaveLength(2);
    expect(daIa).toHaveLength(2);
    for (const l of doJev) expect(l).toMatch(/origem_da_chave: ORIGEM_DA_CHAVE_DO_JEV/);
    for (const l of daIa) expect(l).toMatch(/origem_da_chave: resolvido\.origem === "padrao" \? "plataforma" : "cliente"/);
  });

  it("a chave do Jev é sempre a da organização", () => {
    expect(ORIGEM_DA_CHAVE_DO_JEV).toBe("cliente");
    // Quem resolve a chave do Jev lê só a credencial da organização: nenhuma
    // leitura de ambiente no arquivo que a busca.
    const ponto = fonte("lib/ai/decisao/ponto.ts");
    expect(ponto).toMatch(/\.from\("ai_provider_credentials"\)/);
    expect(ponto).not.toMatch(/process\.env/);
  });

  it("sessão de voz: a linha leva a origem que veio do resolvedor da chave", () => {
    const base = { organizationId: "o", agentId: null, contactId: null, modelo: "m", uso: { entrada: 1, saida: 1 }, duracaoMs: 1, erro: null };
    expect(linhaDaLigacao({ ...base, origemDaChave: "cliente" } as never).origem_da_chave).toBe("cliente");
    expect(linhaDaLigacao({ ...base, origemDaChave: "plataforma" } as never).origem_da_chave).toBe("plataforma");
    expect(fonte("workers/voice-agent/index.ts")).toMatch(/origemDaChave: call\.origemDaChave/);
    // O resolvedor: credencial da organização = cliente; `.env` do servidor = plataforma.
    const agentes = fonte("lib/ai/agents.ts");
    expect(agentes).toMatch(/origemDaChave: "cliente"/);
    expect(agentes).toMatch(/process\.env\.OPENAI_API_KEY \?\? "", origemDaChave: "plataforma"/);
  });

  it("síntese de voz: a ElevenLabs não tem chave de instalação, então a linha é do cliente", () => {
    expect(fonte("lib/agent-engine/edge/crm/send-voice.ts")).toMatch(/origem_da_chave: "cliente"/);
    // O porquê, medido: o resolvedor só cai no `.env` para estes três provedores.
    const credenciais = fonte("lib/agent-engine/edge/llm/credentials.ts");
    const quedas = [...credenciais.matchAll(/provider === '([a-z]+)' && cfg\.[a-zA-Z]+ApiKey/g)].map((m) => m[1]);
    expect(quedas.sort()).toEqual(["anthropic", "openai", "openrouter"]);
  });

  it("transcrição: cada degrau da escada tem a origem da chave decidida por quem resolveu a chave", () => {
    const midia = fonte("workers/media-derive-worker.ts");
    expect(midia).toMatch(/decisao\.origem === "servico_da_instalacao"\s*\?\s*"chave_da_instalacao"/);
    expect(midia).toMatch(/origemDaChaveOpenai = llm\.origemDaChave/);
    expect(midia).toMatch(/origemDaChaveOpenai = oa\.origemDaChave/);
    expect(midia).toMatch(/origemDaChaveElevenlabs = el\.origemDaChave/);
    expect(midia).toMatch(/conversa\?\.origemDaChave \?\? null/);
    // As duas linhas da transcrição (falha e sucesso) repassam a origem.
    expect([...midia.matchAll(/ctx\.origemDaChave \?\? undefined/g)]).toHaveLength(2);
  });

  it("a conversão do resolvedor para a coluna só produz cliente ou plataforma", () => {
    expect(origemDaChaveGravada("credencial_da_organizacao")).toBe("cliente");
    expect(origemDaChaveGravada("chave_da_instalacao")).toBe("plataforma");
    expect([...ORIGENS_DA_CHAVE]).toEqual(["cliente", "plataforma", "assinatura_plataforma", "assistente_chave_plataforma"]);
  });
});

/**
 * GASTO DE AGENTE NÃO VIRA GASTO DO ASSISTENTE (reforço do Lucas, 25/11/2026).
 *
 * As somas de limite ignoram os dois valores do assistente da plataforma. Então o
 * erro que falha em silêncio é o inverso: um caminho de AGENTE gravar um desses
 * valores e sair do teto do plano e do orçamento da empresa sem ninguém ver.
 * Duas travas: o tipo (a conversão do resolvedor só devolve `cliente` ou
 * `plataforma`, caso acima) e esta varredura, que não deixa os dois literais
 * aparecerem em código do produto fora de onde nascem e da área do assistente.
 */
describe("os valores do assistente da plataforma só existem onde nascem e na área do assistente", () => {
  const DO_ASSISTENTE = ["assinatura_plataforma", "assistente_chave_plataforma"] as const;
  const PERMITIDO = (arquivo: string) => arquivo === "lib/ai/usage/origem-da-chave.ts" || arquivo.startsWith("lib/assistente/");
  const ehComentario = (linha: string) => /^\s*(\/\/|\*|\/\*)/.test(linha);

  function usosForaDoLugar(fontes: { arquivo: string; fonte: string }[]): string[] {
    return fontes.flatMap(({ arquivo, fonte }) =>
      PERMITIDO(arquivo)
        ? []
        : fonte
            .split("\n")
            .map((linha, i) => ({ linha, n: i + 1 }))
            .filter(({ linha }) => !ehComentario(linha) && DO_ASSISTENTE.some((v) => linha.includes(v)))
            .map(({ n }) => `${arquivo}:${n}`),
    );
  }

  it("nenhum arquivo do produto fora desses dois lugares escreve um valor do assistente", () => {
    const fontes = [...RAIZES, "components"].flatMap((r) => arquivos(r)).map((arquivo) => ({ arquivo, fonte: readFileSync(join(RAIZ, arquivo), "utf8") }));
    // Guarda de vacuidade: a varredura leu o produto e achou o arquivo onde os valores nascem.
    expect(fontes.length).toBeGreaterThan(1000);
    const origem = fontes.find((f) => f.arquivo === "lib/ai/usage/origem-da-chave.ts");
    expect(origem && DO_ASSISTENTE.every((v) => origem.fonte.includes(v))).toBe(true);
    expect(usosForaDoLugar(fontes)).toEqual([]);
  });

  it("controle: a varredura reprova um escritor de agente que grave o valor do assistente, e não se engana com comentário", () => {
    expect(
      usosForaDoLugar([
        { arquivo: "workers/exemplo.ts", fonte: 'const linha = {\n  origem_da_chave: "assinatura_plataforma",\n};' },
        { arquivo: "lib/exemplo.ts", fonte: "// o valor `assistente_chave_plataforma` não é gravado aqui\nconst x = 1;" },
        { arquivo: "lib/assistente/custo.ts", fonte: 'const origem = "assistente_chave_plataforma";' },
      ]),
    ).toEqual(["workers/exemplo.ts:2"]);
  });
});
