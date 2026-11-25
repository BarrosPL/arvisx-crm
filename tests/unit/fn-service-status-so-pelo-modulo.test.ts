/**
 * CERCA — a `fn_service_status` só é chamada pelo módulo unificado, e todo
 * chamador declara de quem é o pedido (Tarefa 6.1, lacunas 1 e 3 da regra 2.31).
 *
 * A regra "agente não fecha conversa que uma pessoa assumiu" mora em dois
 * lugares: `lib/inbox/fechar-conversa.ts` (`origem`) e a função do banco
 * (`p_ator`, migration 9824). O default da função é `'pessoa'` de propósito
 * (default `'agente'` quebraria a tela de uma imagem antiga), e o custo desse
 * default é um chamador novo de agente que esqueça o parâmetro e feche conversa
 * assumida. Esta cerca cobra o que fecha esse custo:
 *
 *  1. nenhum arquivo de produção chama `rpc("fn_service_status"` fora do módulo
 *     unificado. Lá existe UMA chamada, a de `mudarEstadoDoAtendimento`, e ela
 *     manda `p_ator` quando a origem é agente;
 *  2. todo chamador de `fecharConversa` / `mudarEstadoDoAtendimento` passa
 *     `origem` (o tipo já obriga; aqui fica escrito QUAL origem cada porta
 *     declara, para a troca de uma delas aparecer num diff de teste);
 *  3. porta nova que fecha conversa não entra sem ser listada aqui.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const PASTAS = ["app", "lib", "workers", "components", "hooks", "scripts"];
const MODULO = "lib/inbox/fechar-conversa.ts";

function arquivosDeProducao(): string[] {
  const achados: string[] = [];
  const andar = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      if (nome === "node_modules" || nome === ".next") continue;
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) {
        andar(caminho);
        continue;
      }
      if (!/\.(ts|tsx|mts|mjs|js)$/.test(nome)) continue;
      if (/\.(test|spec)\.[a-z]+$/.test(nome)) continue;
      achados.push(relative(RAIZ, caminho).split(sep).join("/"));
    }
  };
  for (const pasta of PASTAS) {
    try {
      andar(join(RAIZ, pasta));
    } catch {
      // pasta ausente neste checkout: nada a varrer nela
    }
  }
  return achados;
}

const ler = (arquivo: string) => readFileSync(join(RAIZ, arquivo), "utf8");

/** Chamada de RPC com o nome da função como literal (aspas simples, duplas ou crase). */
const CHAMADA_DIRETA = /\.rpc\(\s*["'`]fn_service_status["'`]/g;

/** O texto dos argumentos de cada chamada a `nome(` no arquivo, com parênteses casados. */
function chamadasDe(fonte: string, nome: string): string[] {
  const chamadas: string[] = [];
  const re = new RegExp(`(?<![\\w.])${nome}\\(`, "g");
  for (let m = re.exec(fonte); m; m = re.exec(fonte)) {
    // Declaração (`function nome(`) não é chamada.
    if (/function\s+$/.test(fonte.slice(Math.max(0, m.index - 12), m.index))) continue;
    let nivel = 1;
    let i = m.index + m[0].length;
    while (i < fonte.length && nivel > 0) {
      if (fonte[i] === "(") nivel += 1;
      else if (fonte[i] === ")") nivel -= 1;
      i += 1;
    }
    chamadas.push(fonte.slice(m.index, i));
  }
  return chamadas;
}

describe("a fn_service_status só é chamada pelo módulo unificado", () => {
  const arquivos = arquivosDeProducao();

  it("controle: a varredura enxerga o repositório e o módulo", () => {
    expect(arquivos.length).toBeGreaterThan(1500);
    expect(arquivos).toContain(MODULO);
    expect(arquivos).toContain("app/api/v1/conversations/_handler.ts");
    expect(arquivos).toContain("lib/mcp/tools/fechar-conversa.ts");
  });

  it("⭐ nenhum arquivo de produção chama rpc('fn_service_status') fora do módulo", () => {
    const fora = arquivos.filter((a) => a !== MODULO && (ler(a).match(CHAMADA_DIRETA) ?? []).length > 0);
    expect(fora).toEqual([]);
  });

  it("⭐ no módulo existe UMA chamada, e ela manda p_ator quando a origem é agente", () => {
    const fonte = ler(MODULO);
    expect(fonte.match(CHAMADA_DIRETA) ?? []).toHaveLength(1);

    const [chamada] = chamadasDe(fonte, "deps\\.admin\\.rpc");
    expect(chamada).toBeDefined();
    expect(chamada).toContain('"fn_service_status"');
    expect(chamada).toMatch(/deps\.origem === "agente" \? \{ p_ator: "agente" \} : \{\}/);
  });

  it("controle da régua: uma chamada direta plantada é acusada", () => {
    const plantada = 'await admin\n  .rpc("fn_service_status", { p_org: o, p_conversation: c, p_status: "closed" });';
    expect(plantada.match(CHAMADA_DIRETA) ?? []).toHaveLength(1);
    expect("await admin.rpc('fn_service_status', {})".match(CHAMADA_DIRETA) ?? []).toHaveLength(1);
  });
});

describe("todo chamador que fecha conversa declara de quem é o pedido", () => {
  const arquivos = arquivosDeProducao();

  /**
   * As portas que existem hoje, e a origem que cada uma declara. Porta nova ou
   * origem trocada muda esta tabela, à vista de quem revisa.
   */
  const PORTAS: Record<string, { funcao: "fecharConversa" | "mudarEstadoDoAtendimento"; origem: RegExp }[]> = {
    // Tela, sessão de usuário (`requireRole("agent")` + `exigirControleDaConversa`).
    "app/api/v1/conversations/[id]/close/route.ts": [{ funcao: "fecharConversa", origem: /origem: "pessoa"/ }],
    // Tela, decisão de gerente (`requireRole("manager")`).
    "app/api/v1/contacts/[id]/personal/route.ts": [{ funcao: "fecharConversa", origem: /origem: "pessoa"/ }],
    // PATCH: a origem sai do ator (`origemDoAtor(ctx.actor)`), nos dois ramos.
    "app/api/v1/conversations/_handler.ts": [
      { funcao: "fecharConversa", origem: /\n\s+origem,\n/ },
      { funcao: "mudarEstadoDoAtendimento", origem: /\n\s+origem,\n/ },
    ],
    // Ferramenta do agente (token de API ou agente nativo): sempre agente.
    "lib/mcp/tools/fechar-conversa.ts": [{ funcao: "fecharConversa", origem: /origem: "agente"/ }],
    // O próprio módulo: `fecharConversa` repassa a origem que recebeu.
    [MODULO]: [{ funcao: "mudarEstadoDoAtendimento", origem: /origem: deps\.origem/ }],
  };

  it("⭐ as portas são exatamente as desta tabela", () => {
    const comChamada = arquivos.filter((a) => {
      const fonte = ler(a);
      return chamadasDe(fonte, "fecharConversa").length + chamadasDe(fonte, "mudarEstadoDoAtendimento").length > 0;
    });
    expect(comChamada.sort()).toEqual(Object.keys(PORTAS).sort());
  });

  it.each(Object.entries(PORTAS))("%s declara a origem em cada chamada", (arquivo, esperadas) => {
    const fonte = ler(arquivo);
    for (const funcao of ["fecharConversa", "mudarEstadoDoAtendimento"] as const) {
      const chamadas = chamadasDe(fonte, funcao);
      const daTabela = esperadas.filter((e) => e.funcao === funcao);
      expect({ arquivo, funcao, chamadas: chamadas.length }).toEqual({ arquivo, funcao, chamadas: daTabela.length });
      chamadas.forEach((chamada, i) => expect(chamada).toMatch(daTabela[i]!.origem));
    }
  });

  it("no PATCH, a origem sai do ator: só `user` é pessoa", () => {
    const fonte = ler("app/api/v1/conversations/_handler.ts");
    expect(fonte).toMatch(/const origem = origemDoAtor\(ctx\.actor\);/);
    const modulo = ler(MODULO);
    expect(modulo).toMatch(/return ator\.type === "user" \? "pessoa" : "agente";/);
  });
});
