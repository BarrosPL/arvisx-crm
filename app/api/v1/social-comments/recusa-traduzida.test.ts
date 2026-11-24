// @vitest-environment node
/**
 * AS RECUSAS DOS COMENTÁRIOS SAEM NO IDIOMA DE QUEM CHAMOU.
 *
 * A regra (`lib/comentarios/acoes.ts`) escreve as recusas em português. Quem
 * chama pela sessão — a tela de Comentários — mostra a frase como veio; então
 * ela precisa chegar em espanhol para quem usa o produto em espanhol. Quem
 * chama por token decide pelo `code` e segue recebendo português.
 *
 * O inglês ainda não é servido a ninguém (`lib/i18n/registro.ts`: em
 * construção; `lib/i18n/catalogos.ts` não carrega o catálogo). Por isso a
 * primeira metade mede só o espanhol em execução, e a segunda — a cerca —
 * confere o inglês no arquivo do catálogo, que é onde ele mora até ser
 * promovido.
 *
 * A cerca: toda frase de recusa que pode sair destas rotas tem espanhol (no
 * dicionário) e inglês (em `traducoes/en.json`). Frase nova sem tradução
 * reprova aqui, em vez de aparecer em português no meio de uma tela em outro
 * idioma.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/types";
import { DICIONARIO, traduzir } from "@/lib/i18n/dicionario";

import { corpo, idDoCaminho, recusaDosComentarios } from "./_borda";
import { NextRequest } from "next/server";
import { z } from "zod";

type Envelope = { error: { code: string; message: string; details?: unknown } };
const json = async (r: Response) => (await r.json()) as Envelope;

const FRASE = "Os comentários desta conexão estão desligados. Ligue em modo de registro ou real para responder.";
const recusa = () => new ApiError(409, "comentarios_desligados", { canal: "c1" }, "req-1", FRASE);

describe("a recusa da regra, por idioma", () => {
  it("sessão em espanhol: a frase vem em espanhol; código, status e detalhes não mudam", async () => {
    const r = recusaDosComentarios(recusa(), { requestId: "req-1", idioma: "es" });
    expect(r.status).toBe(409);
    const { error } = await json(r);
    expect(error.code).toBe("comentarios_desligados");
    expect(error.details).toEqual({ canal: "c1" });
    expect(error.message).toBe(traduzir(FRASE, "es"));
    expect(error.message).not.toBe(FRASE);
  });

  it("sessão em português e chamada por token (sem idioma): a frase original", async () => {
    for (const pedido of [{ requestId: "req-1", idioma: "pt-BR" as const }, { requestId: "req-1" }]) {
      const r = recusaDosComentarios(recusa(), pedido);
      expect(r.status).toBe(409);
      expect((await json(r)).error.message).toBe(FRASE);
    }
  });

  it("frase sem tradução (a que cita o código da Meta) degrada para português, nunca some", async () => {
    const crua = new ApiError(502, "upstream_unavailable", undefined, "req-1", "A Meta recusou a operação (código 368).");
    const { error } = await json(recusaDosComentarios(crua, { requestId: "req-1", idioma: "es" }));
    expect(error.message).toBe("A Meta recusou a operação (código 368).");
  });

  it("erro que não é recusa sobe: não vira um 500 educado", () => {
    expect(() => recusaDosComentarios(new Error("defeito"), { requestId: "req-1", idioma: "es" })).toThrow("defeito");
  });

  it("as recusas da própria borda (id e corpo) também seguem o idioma", async () => {
    const id = idDoCaminho("nao-e-uuid", { requestId: "req-1", idioma: "es" });
    expect("response" in id && (await json(id.response)).error.message).toBe("Comentario no encontrado.");
    const req = new NextRequest("https://crm.exemplo.test/api/v1/social-comments/x/reply", { method: "POST", body: "{" });
    const lido = await corpo(req, z.object({}), { requestId: "req-1", idioma: "es" });
    expect("response" in lido && (await json(lido.response)).error.message).toBe("El cuerpo debe ser JSON válido.");
  });
});

/**
 * De onde saem as frases: a regra, as chamadas à rede e a tabela de erros da
 * Graph. Uma frase de recusa, nestes arquivos, é um literal que começa com
 * maiúscula, tem mais de uma palavra e termina em ponto.
 */
const FONTES = [
  "lib/comentarios/acoes.ts",
  "lib/channels/meta-social/comentarios-resposta.ts",
  "lib/channels/meta-social/graph.ts",
  "app/api/v1/social-comments/_borda.ts",
  "app/api/v1/social-comments/route.ts",
];

function frasesDeRecusa(): string[] {
  const achadas = new Set<string>();
  for (const fonte of FONTES) {
    const codigo = readFileSync(join(process.cwd(), fonte), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const m of codigo.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
      const frase = m[1]!;
      if (/^[A-ZÀ-Ý]/.test(frase) && frase.endsWith(".") && frase.includes(" ") && !frase.includes("${")) {
        achadas.add(frase);
      }
    }
  }
  return [...achadas];
}

describe("toda frase de recusa dos comentários tem espanhol e inglês", () => {
  const frases = frasesDeRecusa();

  it("a varredura achou as frases — se isto zerar, a cerca não prova nada", () => {
    expect(frases.length).toBeGreaterThan(25);
    expect(frases).toContain(FRASE);
    expect(frases).toContain("A rede só aceita resposta privada até 7 dias depois do comentário, e este prazo já passou.");
  });

  // "Tem entrada", e não "difere do português": "Cursor inválido." é igual nos
  // dois idiomas, e exigir diferença reprovaria uma tradução correta.
  it("nenhuma está sem espanhol no dicionário", () => {
    expect(frases.filter((f) => DICIONARIO[f]?.es === undefined)).toEqual([]);
  });

  it("nenhuma está sem inglês no catálogo", () => {
    const ingles = JSON.parse(
      readFileSync(join(process.cwd(), "lib", "i18n", "traducoes", "en.json"), "utf8"),
    ) as Record<string, string>;
    expect(frases.filter((f) => !ingles[f])).toEqual([]);
  });
});
