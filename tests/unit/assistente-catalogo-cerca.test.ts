/**
 * A CERCA DO CATÁLOGO DO VIX.
 *
 * O Vix só faz o que está em `lib/assistente/capacidades/`. Esta cerca reprova
 * quando uma capacidade entra sem o que a torna conferível:
 *
 *  1. nível, papel mínimo (um papel de PESSOA), entrada e "tem inverso?";
 *  2. o TESTE: o arquivo declarado existe e cita o nome da capacidade (para as
 *     leituras do MCP, o arquivo de isolamento tem a lista `PROVAS`, e é ele
 *     que reprova leitura sem prova; aqui se confere que o nome está lá);
 *  3. nenhum campo de entrada nomeia a empresa: ela vem da sessão;
 *  4. nenhuma capacidade aponta para rota proibida, nem reaproveita ferramenta
 *     MCP proibida ou que não seja de leitura;
 *  5. leitura não tem `preparar`; escrita tem, e declara o inverso;
 *  6. quem executa escrita confirmada é UM arquivo, a rota de confirmação;
 *  7. o código do assistente não lê credencial de IA de empresa nenhuma, e só
 *     usa a chave de serviço nos arquivos listados, com motivo. (O provedor
 *     tem cerca própria: `assistente-provedor-cerca.test.ts`.)
 *
 * Lê o catálogo de verdade (importa o módulo) para as regras de 1 a 5, e o
 * código-fonte para as de 6 e 7.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})), isServiceRoleConfigured: () => true }));

const { CATALOGO } = await import("@/lib/assistente/capacidades");
const { LEITURAS_MCP } = await import("@/lib/assistente/capacidades/mcp");
const { FERRAMENTAS_MCP_FORA_DO_VIX, campoNomeiaEmpresa, rotaProibida } = await import("@/lib/assistente/proibidas");
const { NIVEIS, PAPEIS_HUMANOS } = await import("@/lib/assistente/tipos");
const { allTools } = await import("@/lib/mcp/tools");

const RAIZ = process.cwd();
const ler = (caminho: string) => readFileSync(join(RAIZ, caminho), "utf8");

function arquivosTs(dir: string): string[] {
  const base = join(RAIZ, dir);
  if (!existsSync(base)) return [];
  const saida: string[] = [];
  const andar = (d: string) => {
    for (const nome of readdirSync(d)) {
      const p = join(d, nome);
      if (statSync(p).isDirectory()) andar(p);
      else if (/\.tsx?$/.test(nome)) saida.push(relative(RAIZ, p).replace(/\\/g, "/"));
    }
  };
  andar(base);
  return saida;
}

const ehTeste = (arquivo: string) => /\.test\.tsx?$/.test(arquivo);

describe("toda capacidade do catálogo é conferível", () => {
  it("o catálogo não está vazio e os nomes são únicos e válidos como nome de ferramenta", () => {
    expect(CATALOGO.length).toBeGreaterThan(0);
    const nomes = CATALOGO.map((c) => c.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    for (const nome of nomes) expect(nome, nome).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
  });

  it("tem nível, papel de pessoa, descrição, entrada e 'tem inverso?' declarados", () => {
    for (const c of CATALOGO) {
      expect(NIVEIS, c.nome).toContain(c.nivel);
      expect(PAPEIS_HUMANOS, `${c.nome}: papel mínimo`).toContain(c.papelMinimo);
      expect(c.descricao.trim().length, `${c.nome}: descrição`).toBeGreaterThan(20);
      expect(typeof (c.entrada as { safeParse?: unknown }).safeParse, `${c.nome}: entrada`).toBe("function");
      expect(c.temInverso, `${c.nome}: tem inverso?`).not.toBeUndefined();
      expect(typeof c.executar, c.nome).toBe("function");
    }
  });

  it("o teste declarado existe e cita a capacidade", () => {
    for (const c of CATALOGO) {
      expect(existsSync(join(RAIZ, c.teste)), `${c.nome}: o teste ${c.teste} não existe`).toBe(true);
      expect(ler(c.teste), `${c.nome}: o teste ${c.teste} não cita a capacidade`).toContain(c.nome);
    }
  });

  it("nenhum campo de entrada nomeia a empresa", () => {
    for (const c of CATALOGO) {
      const formato = (c.entrada as unknown as { shape: Record<string, unknown> }).shape;
      const culpados = Object.keys(formato).filter(campoNomeiaEmpresa);
      expect(culpados, `${c.nome}: a empresa vem da sessão, não da entrada`).toEqual([]);
    }
  });

  it("a entrada, no modo estrito do executor, recusa um campo de empresa a mais", () => {
    for (const c of CATALOGO) {
      const r = c.entrada.strict().safeParse({ organization_id: "99999999-9999-4999-8999-999999999999" });
      expect(r.success, `${c.nome} aceitou organization_id`).toBe(false);
    }
  });
});

describe("níveis", () => {
  it("leitura não prepara cartão; escrita prepara e diz qual é o inverso", () => {
    for (const c of CATALOGO) {
      if (c.nivel === "ler") {
        expect(c.preparar, `${c.nome}: leitura com preparar`).toBeUndefined();
        expect(c.temInverso, `${c.nome}: leitura`).toBe("nao_se_aplica");
      } else {
        expect(typeof c.preparar, `${c.nome}: escrita sem preparar`).toBe("function");
        expect(c.temInverso, `${c.nome}: escrita precisa responder se tem inverso`).not.toBe("nao_se_aplica");
      }
    }
  });

  it("escrita no CRM executa pelo código da tela, nunca por ferramenta MCP", () => {
    for (const c of CATALOGO.filter((x) => x.nivel !== "ler")) {
      expect(c.origem.tipo, `${c.nome}`).not.toBe("mcp");
    }
  });
});

describe("proibidas", () => {
  it("nenhuma capacidade aponta para rota proibida", () => {
    for (const c of CATALOGO) {
      if (!c.rotaDaTela) continue;
      expect(rotaProibida(c.rotaDaTela.caminho, c.rotaDaTela.metodo), `${c.nome} → ${c.rotaDaTela.caminho}`).toBe(false);
    }
  });

  it("a régua de rota proibida conhece cada item da lista da tarefa", () => {
    for (const [caminho, metodo] of [
      ["/api/v1/team/invite", "POST"],
      ["/api/v1/team/abc/role", "PATCH"],
      ["/api/v1/ai/credentials", "POST"],
      ["/api/v1/ai/credentials/abc", "DELETE"],
      ["/api/v1/modulos/instalar", "POST"],
      ["/api/v1/voip/trunk", "PATCH"],
      ["/api/v1/channels/official", "POST"],
      ["/api/v1/admin/tenants", "GET"],
      ["/api/v1/tenants/provision", "POST"],
      ["/api/v1/cobranca/assinatura", "GET"],
      ["/api/v1/lgpd/requests", "GET"],
      ["/api/v1/lgpd/anonymize", "POST"],
    ] as const) {
      expect(rotaProibida(caminho, metodo), `${metodo} ${caminho}`).toBe(true);
    }
    // As duas leituras admitidas, e só leitura.
    expect(rotaProibida("/api/v1/ai/credentials", "GET")).toBe(false);
    expect(rotaProibida("/api/v1/team", "GET")).toBe(false);
  });

  it("leitura reaproveitada do MCP é de fato leitura, existe, e não está na lista de fora", () => {
    const porNome = new Map(allTools.map((t) => [t.name, t]));
    for (const c of LEITURAS_MCP) {
      expect(c.origem.tipo).toBe("mcp");
      const ferramenta = c.origem.tipo === "mcp" ? c.origem.ferramenta : "";
      expect(porNome.get(ferramenta)?.category, `${c.nome}`).toBe("read");
      expect(FERRAMENTAS_MCP_FORA_DO_VIX as readonly string[], c.nome).not.toContain(ferramenta);
    }
  });

  it("o papel mínimo nunca é mais frouxo que o do MCP", () => {
    const rank = { viewer: 1, agent: 2, ai_operator: 3, manager: 4, admin: 5 } as const;
    const porNome = new Map(allTools.map((t) => [t.name, t]));
    for (const c of LEITURAS_MCP) {
      const def = porNome.get(c.nome)!;
      expect(rank[c.papelMinimo], `${c.nome}: Vix ${c.papelMinimo} < MCP ${def.requiresRole}`).toBeGreaterThanOrEqual(
        rank[def.requiresRole === "ai_operator" ? "agent" : def.requiresRole],
      );
    }
  });
});

describe("quem pode executar e o que o assistente alcança", () => {
  const DE_PRODUCAO = [...arquivosTs("lib"), ...arquivosTs("app"), ...arquivosTs("components"), ...arquivosTs("workers")].filter(
    (a) => !ehTeste(a),
  );

  it("só a rota de confirmação importa o executor de escrita confirmada", () => {
    const importadores = DE_PRODUCAO.filter((a) => a !== "lib/assistente/confirmar.ts").filter((a) =>
      /from\s+["'](?:@\/lib\/assistente\/confirmar|\.{1,2}\/(?:.*\/)?confirmar)["']/.test(ler(a)),
    );
    expect(importadores.filter((a) => a !== "app/api/v1/assistente/acoes/[id]/confirmar/route.ts")).toEqual([]);
  });

  it("nenhum arquivo do assistente chama `executar` de capacidade fora do executor e da confirmação", () => {
    const permitidos = new Set(["lib/assistente/executor.ts", "lib/assistente/confirmar.ts"]);
    const culpados = arquivosTs("lib/assistente")
      .filter((a) => !ehTeste(a) && !permitidos.has(a))
      .filter((a) => /\.executar\(/.test(ler(a)));
    expect(culpados).toEqual([]);
  });

  it("o assistente não lê credencial de IA de empresa nem variável de chave do ambiente", () => {
    // Quem alcança a conta da assinatura e a chave de plataforma tem cerca
    // própria: `tests/unit/assistente-provedor-cerca.test.ts`.
    const PROIBIDO = [
      "resolveOrgLlmConfig",
      "loadCredential",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "OPENROUTER_API_KEY",
      "api_key_encrypted",
      '"ai_provider_credentials"',
    ];
    const achados: string[] = [];
    for (const arquivo of arquivosTs("lib/assistente").filter((a) => !ehTeste(a))) {
      const texto = ler(arquivo);
      for (const p of PROIBIDO) if (texto.includes(p)) achados.push(`${arquivo}: ${p}`);
    }
    expect(achados).toEqual([]);
  });

  it("a chave de serviço só aparece nos arquivos do assistente listados, cada um com o motivo", () => {
    /** Tabelas e leituras que são do SERVIDOR; a organização vem sempre da sessão. */
    const COM_MOTIVO: Record<string, string> = {
      "lib/assistente/capacidades/proprias.ts":
        "abrir chamado grava em tabela do servidor; guia de telas lê módulo da instalação e capacidade da empresa",
    };
    const usam = arquivosTs("lib/assistente")
      .filter((a) => !ehTeste(a))
      // Só a CHAMADA conta: importar o tipo do cliente não usa a chave.
      .filter((a) => /createAdminClient\(/.test(ler(a)));
    expect(usam.filter((a) => !COM_MOTIVO[a])).toEqual([]);
  });
});
