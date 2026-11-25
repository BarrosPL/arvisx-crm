/**
 * A CERCA DO PROVEDOR DO VIX.
 *
 * O pagador `assinatura_plataforma` é uma EXCEÇÃO consciente: é o único ponto
 * do sistema em que o token de uma organização (a designada) é usado numa
 * chamada disparada por usuário de outra. Esta cerca garante que a exceção
 * tem UM endereço, e que nada cresce em volta dela sem alguém decidir:
 *
 *  1. só `assinatura-da-plataforma.ts` lê `VIX_ORGANIZACAO_DA_CONTA` (fora
 *     dele, a chave só aparece na DECLARAÇÃO do catálogo da instalação);
 *  2. no assistente, só ele importa o leitor da assinatura (`login-codex`);
 *  3. ele exporta UMA função, e só `provedor/index.ts` a importa;
 *  4. ele não recebe organização por parâmetro;
 *  5. só `chave-da-plataforma.ts` alcança a chave de plataforma;
 *  6. nenhum arquivo do provedor chama a política de reserva dos agentes, e um
 *     pagador não importa o outro: não há queda de um para o outro.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const ler = (caminho: string) => readFileSync(join(RAIZ, caminho), "utf8");

function arquivosTs(dir: string): string[] {
  const base = join(RAIZ, dir);
  if (!existsSync(base)) return [];
  const saida: string[] = [];
  const andar = (d: string) => {
    for (const nome of readdirSync(d)) {
      if (nome === "node_modules" || nome.startsWith(".")) continue;
      const p = join(d, nome);
      if (statSync(p).isDirectory()) andar(p);
      else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(relative(RAIZ, p).replace(/\\/g, "/"));
    }
  };
  andar(base);
  return saida;
}

const DE_PRODUCAO = ["lib", "app", "components", "workers", "hooks"].flatMap(arquivosTs);
const DO_ASSISTENTE = DE_PRODUCAO.filter((a) => a.startsWith("lib/assistente/"));

const ASSINATURA = "lib/assistente/provedor/assinatura-da-plataforma.ts";
const CHAVE = "lib/assistente/provedor/chave-da-plataforma.ts";
const INDICE = "lib/assistente/provedor/index.ts";

/** Os módulos que um arquivo importa (o texto do `from`). */
function importsDe(arquivo: string): string[] {
  const ast = ts.createSourceFile(arquivo, ler(arquivo), ts.ScriptTarget.Latest, true);
  const saida: string[] = [];
  ast.forEachChild((no) => {
    if ((ts.isImportDeclaration(no) || ts.isExportDeclaration(no)) && no.moduleSpecifier && ts.isStringLiteral(no.moduleSpecifier)) {
      saida.push(no.moduleSpecifier.text);
    }
  });
  return saida;
}

/** Os nomes que um arquivo exporta em VALOR (tipo não conta). */
function exportsDeValor(arquivo: string): string[] {
  const ast = ts.createSourceFile(arquivo, ler(arquivo), ts.ScriptTarget.Latest, true);
  const nomes: string[] = [];
  ast.forEachChild((no) => {
    const exportado = ts.canHaveModifiers(no) && ts.getModifiers(no)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exportado) return;
    if (ts.isFunctionDeclaration(no) && no.name) nomes.push(no.name.text);
    if (ts.isVariableStatement(no)) for (const d of no.declarationList.declarations) nomes.push(d.name.getText(ast));
    if (ts.isClassDeclaration(no) && no.name) nomes.push(no.name.text);
  });
  return nomes;
}

describe("a organização designada tem um leitor só", () => {
  it("os três arquivos do provedor existem (controle: a cerca enxerga o que vigia)", () => {
    for (const a of [ASSINATURA, CHAVE, INDICE]) expect(DO_ASSISTENTE, a).toContain(a);
  });

  it("só o leitor da assinatura lê VIX_ORGANIZACAO_DA_CONTA; fora dele, só a declaração no catálogo da instalação", () => {
    const quemCita = DE_PRODUCAO.filter((a) => ler(a).includes("VIX_ORGANIZACAO_DA_CONTA"));
    expect(quemCita.sort()).toEqual([ASSINATURA, "lib/instalacao/catalogo.ts"].sort());
  });

  it("no assistente, só o leitor da assinatura importa de login-codex", () => {
    const quemImporta = DO_ASSISTENTE.filter((a) => importsDe(a).some((m) => m.includes("credenciais/login-codex")));
    expect(quemImporta).toEqual([ASSINATURA]);
  });

  it("o leitor da assinatura exporta UMA função, e ela não recebe organização", () => {
    expect(exportsDeValor(ASSINATURA)).toEqual(["assinaturaDaPlataforma"]);
    const ast = ts.createSourceFile(ASSINATURA, ler(ASSINATURA), ts.ScriptTarget.Latest, true);
    let parametros: string[] | null = null;
    ast.forEachChild((no) => {
      if (ts.isFunctionDeclaration(no) && no.name?.text === "assinaturaDaPlataforma") {
        parametros = no.parameters.map((p) => p.name.getText(ast));
      }
    });
    // Só o cliente de serviço. A organização vem da configuração da instalação.
    expect(parametros).toEqual(["admin"]);
  });

  it("só o índice do provedor importa o leitor da assinatura", () => {
    const quemImporta = DE_PRODUCAO.filter((a) => a !== ASSINATURA).filter((a) =>
      importsDe(a).some((m) => m.endsWith("assinatura-da-plataforma")),
    );
    expect(quemImporta).toEqual([INDICE]);
  });

  it("o leitor da assinatura não escreve a organização designada nem o token em log", () => {
    const texto = ler(ASSINATURA);
    expect(texto).not.toMatch(/logger\.|console\./);
  });
});

describe("a chave de plataforma tem um leitor só no assistente", () => {
  it("só chave-da-plataforma.ts chama chaveDePlataforma", () => {
    const quem = DO_ASSISTENTE.filter((a) => /\bchaveDePlataforma\s*\(/.test(ler(a)));
    expect(quem).toEqual([CHAVE]);
  });

  it("nenhum arquivo do assistente lê variável de chave de IA direto do ambiente", () => {
    const achados = DO_ASSISTENTE.filter((a) => /(process\.env|env)\.[A-Z_]*(API_KEY|TOKEN|SECRET)/.test(ler(a)));
    expect(achados).toEqual([]);
  });

  it("só o índice do provedor importa o pagador da chave de plataforma", () => {
    const quemImporta = DE_PRODUCAO.filter((a) => a !== CHAVE).filter((a) =>
      importsDe(a).some((m) => m.endsWith("chave-da-plataforma")),
    );
    expect(quemImporta).toEqual([INDICE]);
  });
});

describe("sem queda de um pagador para o outro, e sem a reserva dos agentes", () => {
  it("um pagador não importa o outro", () => {
    expect(importsDe(ASSINATURA).some((m) => m.endsWith("chave-da-plataforma"))).toBe(false);
    expect(importsDe(CHAVE).some((m) => m.endsWith("assinatura-da-plataforma"))).toBe(false);
  });

  it("a assinatura não alcança a chave de plataforma", () => {
    expect(ler(ASSINATURA)).not.toMatch(/chaveDePlataforma/);
  });

  it("nenhum arquivo do assistente usa a política de reserva nem os leitores genéricos de credencial", () => {
    const PROIBIDO = [
      "decidirQuedaDoProvedor",
      "reservaDaAssinatura",
      "PROVEDOR_DE_RESERVA_DA_ASSINATURA",
      "quedaPorTokenRevogado",
      "resolveOrgLlmConfig",
      "loadCredential",
      "runModelCall",
    ];
    const achados: string[] = [];
    for (const arquivo of DO_ASSISTENTE) {
      const texto = ler(arquivo);
      for (const p of PROIBIDO) if (new RegExp(`\\b${p}\\b`).test(texto)) achados.push(`${arquivo}: ${p}`);
    }
    expect(achados).toEqual([]);
  });

  it("o índice escolhe por `switch` no pagador, sem tentar um e depois o outro", () => {
    const texto = ler(INDICE);
    expect(texto).not.toMatch(/\bcatch\b/);
    // Cada pagador aparece em exatamente uma chamada.
    expect(texto.match(/assinaturaDaPlataforma\(/g)?.length).toBe(1);
    expect(texto.match(/chaveDaPlataforma\(/g)?.length).toBe(1);
  });
});
