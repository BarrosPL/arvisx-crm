import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PAGINAS_COM_DESTINO,
  PAGINAS_LIVRES,
  PREFIXOS_POR_SUB_ROTA,
  ROTAS_DE_API,
  LIVRE,
  classeDaPagina,
  regraDaRotaDeApi,
} from "@/lib/cobranca/rotas-do-plano";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";

/**
 * AS DUAS CERCAS das telas do plano (migration 9802). Página ou rota nova sem
 * classificação reprova aqui — senão ela nasce fora da trava, e o plano deixa
 * de valer para ela sem ninguém perceber.
 *
 * Como classificar: lib/cobranca/rotas-do-plano.ts. Página nova sob um prefixo
 * do catálogo já herda dele; fora disso, `PAGINAS_COM_DESTINO` ou
 * `PAGINAS_LIVRES` (com o porquê). Rota nova: uma linha em `ROTAS_DE_API`.
 */

const RAIZ = process.cwd();

function paginasDeApp(dir = path.join(RAIZ, "app", "app"), prefixo = "/app"): string[] {
  const rotas: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name === "page.tsx") rotas.push(prefixo);
    if (!e.isDirectory() || e.name.startsWith("_") || e.name.startsWith("@")) continue;
    // Grupo de rota `(x)` não entra no caminho; `[id]` vira um segmento qualquer.
    const segmento = /^\(.*\)$/.test(e.name) ? "" : `/${e.name.replace(/^\[\.*(.+?)\]$/, "x-$1")}`;
    rotas.push(...paginasDeApp(path.join(dir, e.name), `${prefixo}${segmento}`));
  }
  return rotas;
}

const subdiretorios = (dir: string) =>
  fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

describe("cerca: toda página de app/app está classificada", () => {
  const paginas = paginasDeApp();

  it("acha as páginas (a cerca não pode passar por não ver nada)", () => {
    expect(paginas.length).toBeGreaterThan(80);
    expect(paginas).toContain("/app/inbox");
  });

  it.each(paginas)("%s", (pagina) => {
    expect(classeDaPagina(pagina).tipo, `${pagina} não está no catálogo nem em PAGINAS_LIVRES/PAGINAS_COM_DESTINO`).not.toBe(
      "desconhecida",
    );
  });

  it("as listas explícitas não apontam para página que não existe", () => {
    for (const p of [...Object.keys(PAGINAS_LIVRES), ...Object.keys(PAGINAS_COM_DESTINO)]) {
      expect(paginas.some((q) => q === p || q.startsWith(`${p}/`)), p).toBe(true);
    }
  });
});

describe("cerca: todo prefixo de app/api/v1 está classificado", () => {
  const base = path.join(RAIZ, "app", "api", "v1");
  const primeiros = subdiretorios(base);
  const hrefs = new Set<string>(NAV_CATALOG.map((d) => d.href));

  it("acha os prefixos", () => {
    expect(primeiros.length).toBeGreaterThan(50);
  });

  it.each(primeiros)("/api/v1/%s", (p) => {
    expect(ROTAS_DE_API[`/api/v1/${p}`], `/api/v1/${p} sem classificação em ROTAS_DE_API`).toBeDefined();
  });

  for (const p of PREFIXOS_POR_SUB_ROTA) {
    it.each(subdiretorios(path.join(base, p)))(`/api/v1/${p}/%s`, (sub) => {
      expect(ROTAS_DE_API[`/api/v1/${p}/${sub}`], `/api/v1/${p}/${sub} sem classificação`).toBeDefined();
    });
  }

  it("toda classificação é LIVRE ou uma tela que existe no catálogo, e todo prefixo existe no disco", () => {
    for (const [prefixo, classe] of Object.entries(ROTAS_DE_API)) {
      const telas =
        classe === LIVRE
          ? []
          : typeof classe === "string"
            ? [classe]
            : [
                classe.destino,
                ...(classe.tambem ?? []),
                ...Object.values(classe.leituras ?? {}).flatMap((l) => (l === LIVRE ? [] : [...l])),
              ];
      for (const tela of telas) expect(hrefs.has(tela), `${prefixo} → ${tela}`).toBe(true);
      expect(fs.existsSync(path.join(RAIZ, "app", prefixo)), `${prefixo} não existe`).toBe(true);
    }
  });

  it("toda leitura aberta é um GET que existe no disco, debaixo do prefixo que a declara", () => {
    for (const [prefixo, classe] of Object.entries(ROTAS_DE_API)) {
      if (classe === LIVRE || typeof classe === "string") continue;
      for (const caminho of Object.keys(classe.leituras ?? {})) {
        expect(caminho === prefixo || caminho.startsWith(`${prefixo}/`), `${caminho} fora de ${prefixo}`).toBe(true);
        // `catalogo/formas` e `catalogo/contas` são valores do segmento `[tipo]`.
        const direto = path.join(RAIZ, "app", caminho, "route.ts");
        const dinamico = path.join(RAIZ, "app", path.dirname(caminho), "[tipo]", "route.ts");
        const arquivo = fs.existsSync(direto) ? direto : dinamico;
        expect(fs.existsSync(arquivo), `${caminho} sem route.ts`).toBe(true);
        expect(fs.readFileSync(arquivo, "utf8"), `${caminho} sem GET`).toMatch(/export async function GET\b/);
      }
    }
  });

  // Auditoria de 11/11/2026: os 12 prefixos que ficaram livres "por dúvida"
  // deixavam o Essencial criar Comanda e ler agentes, roteamento e fontes de webhook.
  it("não sobrou prefixo livre por dúvida", () => {
    const fonte = fs.readFileSync(path.join(RAIZ, "lib", "cobranca", "rotas-do-plano.ts"), "utf8");
    expect(fonte).not.toMatch(/DÚVIDA|PREFIXOS_EM_DUVIDA/);
  });

  const FECHADOS_NA_AUDITORIA = [
    "ai/agents",
    "ai/voz",
    "ai/credentials",
    "settings/routing",
    "calls",
    "financeiro",
    "proposals",
    "settings/proposals",
    "settings/proposal-templates",
    "mcp",
    "webhook-sources",
  ];

  function rotasDe(dir: string): string[] {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) =>
        e.isDirectory() ? rotasDe(path.join(dir, e.name)) : e.name === "route.ts" ? [path.join(dir, e.name)] : [],
      );
  }

  it.each(FECHADOS_NA_AUDITORIA)("/api/v1/%s: fechado por plano, e toda rota dele atravessa um portão que aplica a trava", (p) => {
    expect(regraDaRotaDeApi(`/api/v1/${p}/qualquer-coisa`, "POST"), p).not.toBeNull();
    const rotas = rotasDe(path.join(base, p));
    expect(rotas.length).toBeGreaterThan(0);
    for (const rota of rotas) {
      // A trava mora em `requireRole`, `orgAtivaDaApi` e `resolveAuthDual`: rota
      // que autentica por outro caminho fica fora do plano sem ninguém perceber.
      expect(fs.readFileSync(rota, "utf8"), path.relative(RAIZ, rota)).toMatch(
        /\b(requireRole|orgAtivaDaApi|resolveAuthDual)\(/,
      );
    }
  });

  it("/api/v1/webhooks é livre porque só tem ENTRADA: nenhuma rota de lá autentica pessoa", () => {
    expect(ROTAS_DE_API["/api/v1/webhooks"]).toBe(LIVRE);
    const rotas = rotasDe(path.join(base, "webhooks"));
    expect(rotas.length).toBeGreaterThan(5);
    for (const rota of rotas) {
      // Gestão (tela, cookie, papel) nasceria com um destes; aí o prefixo
      // precisa de sub-rota fechada por plano, e esta cerca avisa.
      expect(fs.readFileSync(rota, "utf8"), path.relative(RAIZ, rota)).not.toMatch(
        /\b(requireRole|orgAtivaDaApi|resolveAuthDual|loadAuthUser|requireAuth)\(/,
      );
    }
  });

  it("o núcleo do Inbox e a entrada de mensagens são livres", () => {
    for (const p of ["messages", "conversations", "contacts", "webhooks", "cron", "auth", "cobranca", "channel-sessions"]) {
      expect(ROTAS_DE_API[`/api/v1/${p}`], p).toBe(LIVRE);
    }
  });
});
