/**
 * A CERCA DO PROVEDOR DO VIX.
 *
 * O pagador `hermes` leva o texto da conversa para FORA do CRM (o Hermes) e
 * recebe de volta texto. Esta cerca garante que esse caminho tem UM endereço e
 * que o Hermes continua sendo só um cérebro, sem alcançar nada do CRM:
 *
 *  1. só `hermes.ts` lê `VIX_HERMES_URL` e `VIX_HERMES_SEGREDO` (fora dele, as
 *     chaves só aparecem na DECLARAÇÃO do catálogo da instalação);
 *  2. só `hermes.ts` importa o modelo do Hermes, e só o índice importa `hermes.ts`;
 *  3. o modelo do Hermes não importa banco, sessão, cliente de serviço, nem
 *     leitor de credencial: ele só recebe texto e a chave que lhe entregam;
 *  4. a assinatura ChatGPT/Codex NÃO é caminho do assistente: nada em
 *     `lib/assistente` importa `login-codex`;
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

const HERMES = "lib/assistente/provedor/hermes.ts";
const MODELO = "lib/assistente/provedor/modelo-hermes.ts";
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

describe("o Hermes tem uma porta só", () => {
  it("os arquivos do provedor existem (controle: a cerca enxerga o que vigia)", () => {
    for (const a of [HERMES, MODELO, CHAVE, INDICE]) expect(DO_ASSISTENTE, a).toContain(a);
  });

  it("só hermes.ts lê VIX_HERMES_URL e VIX_HERMES_SEGREDO; fora dele, só a declaração no catálogo", () => {
    for (const chave of ["VIX_HERMES_URL", "VIX_HERMES_SEGREDO"]) {
      const quemCita = DE_PRODUCAO.filter((a) => ler(a).includes(chave));
      expect(quemCita.sort(), chave).toEqual([HERMES, "lib/instalacao/catalogo.ts"].sort());
    }
  });

  it("só hermes.ts importa o modelo do Hermes, e só o índice importa hermes.ts", () => {
    const quemImportaOModelo = DE_PRODUCAO.filter((a) => a !== MODELO).filter((a) => importsDe(a).some((m) => m.endsWith("modelo-hermes")));
    expect(quemImportaOModelo).toEqual([HERMES]);
    const quemImportaHermes = DE_PRODUCAO.filter((a) => a !== HERMES).filter((a) => importsDe(a).some((m) => m.endsWith("provedor/hermes") || m === "./hermes"));
    expect(quemImportaHermes).toEqual([INDICE]);
  });

  it("o modelo do Hermes não alcança banco, sessão, serviço nem credencial: só recebe texto", () => {
    const PROIBIDO = ["supabase", "@/lib/ai/", "@/lib/instalacao", "@/lib/auth", "next/headers", "@/lib/agent-engine", "@/lib/assistente/executor", "@/lib/assistente/catalogo"];
    const achados = importsDe(MODELO).filter((m) => PROIBIDO.some((p) => m.includes(p)));
    expect(achados).toEqual([]);
    expect(ler(MODELO)).not.toMatch(/process\.env|createAdminClient|createClient/);
  });

  it("nem hermes.ts nem o modelo escrevem a chave, o endereço ou o corpo em log", () => {
    for (const a of [HERMES, MODELO]) expect(ler(a), a).not.toMatch(/logger\.|console\./);
  });

  it("a chamada ao Hermes não segue redirecionamento (a chave não pode ir para outro endereço)", () => {
    expect(ler(MODELO)).toMatch(/redirect:\s*"error"/);
  });

  it("a assinatura ChatGPT/Codex não é caminho do assistente", () => {
    const quemImporta = DO_ASSISTENTE.filter((a) => importsDe(a).some((m) => m.includes("credenciais/login-codex")));
    expect(quemImporta).toEqual([]);
    expect(DE_PRODUCAO.filter((a) => ler(a).includes("VIX_ORGANIZACAO_DA_CONTA"))).toEqual([]);
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
    expect(importsDe(HERMES).some((m) => m.endsWith("chave-da-plataforma"))).toBe(false);
    expect(importsDe(CHAVE).some((m) => m.endsWith("hermes") || m.endsWith("modelo-hermes"))).toBe(false);
  });

  it("o Hermes não alcança a chave de plataforma", () => {
    expect(ler(HERMES)).not.toMatch(/chaveDePlataforma/);
    expect(ler(MODELO)).not.toMatch(/chaveDePlataforma/);
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
    expect(texto.match(/hermesDaPlataforma\(/g)?.length).toBe(1);
    expect(texto.match(/chaveDaPlataforma\(/g)?.length).toBe(1);
  });
});
