import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Catraca do UPSTREAM no código que executa — o fork da ArvisX não fala com o
 * dono do repositório de origem nem carrega o contato de terceiros.
 *
 * Por que existe: a auditoria de 06/11/2026 (`docs/arvisx/AUDITORIA-DESKCOMM.md`,
 * §7.4 e §7.5) achou, no código que embarca, o e-mail pessoal do autor do
 * upstream no User-Agent enviado à Nuvemshop, o DSN do Sentry dele e imagens e
 * LABELs apontando para `github.com/melgarafael`. Nenhum deles aparece na tela;
 * todos saem da máquina do cliente. `tests/unit/branding.test.ts` vigia a MARCA
 * (`deskcomm`), não o DONO (`melgarafael`) nem o e-mail de terceiro — este
 * arquivo fecha esse vão.
 *
 * O QUE FALHA:
 *  - qualquer ocorrência de `melgarafael` (em qualquer caixa, com o
 *    identificador inteiro em volta: `ghcr.io/melgarafael`, `@melgarafael`);
 *  - qualquer e-mail cujo domínio não seja nosso nem reservado (ver
 *    `EMAIL_QUE_NAO_E_DE_TERCEIRO`).
 *
 * ONDE: o que executa na instalação — `.ts`/`.tsx` de `app/ components/ hooks/
 * lib/ workers/` e `proxy.ts` (fora `*.test.*` e `__fixtures__`, que não
 * embarcam) — e a infra que roda na VPS ou publica a imagem: `Dockerfile*`,
 * `docker-compose*.yml`, `deploy/**`, `hostgator-setup-kit/**\/*.sh`,
 * `ubuntu-*-installer.sh`, `scripts/instalar-guias.sh` e
 * `.github/workflows/publish-image.yml`.
 *
 * Ficam FORA de propósito (não executam na instalação, ou medem o upstream por
 * função): o resto de `scripts/` — `scripts/migration-populacao.sh` e
 * `scripts/vigia-colisao-de-migration.ts` consultam o upstream PARA medir
 * colisão de migration —, os workflows `acolhida`/`release` (desligam-se por
 * `github.repository_owner`/`github.repository`), `docs/`, `tests/` e o
 * `.mailmap` (créditos de autoria, categoria C).
 *
 * Diferente da catraca de marca, comentário CONTA: num `.sh` ou num YAML a
 * fronteira entre comentário e valor é frágil (um `#` dentro de string), e
 * crédito a quem escreveu o código é exceção que se DECLARA, com motivo, e não
 * que se ignora em silêncio. A lista só encolhe: ocorrência nova reprova,
 * ocorrência que sumiu também, até a linha ser apagada.
 */

const RAIZ = process.cwd();

type CategoriaDeExcecao =
  /** Crédito ou referência histórica ao upstream em COMENTÁRIO (categoria C da
   *  auditoria): não executa, não sai da máquina, e apagá-lo é conflito a mais
   *  em todo merge do upstream. */
  | "CREDITO"
  /** Valor de exemplo/fixture de dev que não é e-mail de ninguém. */
  | "AMOSTRA"
  /** Sintaxe que só PARECE e-mail (`git@github.com:` é remoto SSH). */
  | "SINTAXE";

type Excecao = {
  categoria: CategoriaDeExcecao;
  motivo: string;
  /** Conjunto EXATO de achados do arquivo, em minúsculas, ordenado. */
  achados: string[];
};

const EXCECOES: Record<string, Excecao> = {
  // ─── CREDITO — comentário que cita o upstream; não executa. ───
  "lib/agent-engine/queue/loop.ts": {
    categoria: "CREDITO",
    motivo: "comentário que credita a medição do defeito ao autor do upstream (@melgarafael); não executa",
    achados: ["@melgarafael"],
  },
  "lib/agent-engine/queue/soneca.ts": {
    categoria: "CREDITO",
    motivo: "comentário que credita a medição do defeito (#3688) ao autor do upstream; não executa",
    achados: ["@melgarafael"],
  },
  "lib/waha/client.ts": {
    categoria: "CREDITO",
    motivo: "comentário que referencia a issue do upstream onde o comportamento do WAHA foi medido; não executa",
    achados: ["melgarafael/deskcommcrm#1428"],
  },
  "hostgator-setup-kit/_common.sh": {
    categoria: "CREDITO",
    motivo:
      "comentário que conta por que as URLs do GHCR deixaram de ter o dono cravado (PR #605). O `git@github.com:` é o padrão de remoto SSH que o kit aceita ao normalizar a URL do repositório — não é e-mail",
    achados: ["git@github.com", "ghcr.io/melgarafael", "melgarafael", "repository:melgarafael/"],
  },
  "deploy/arvisx/crm/docker-compose.easypanel.yml": {
    categoria: "CREDITO",
    motivo: "comentário que AFIRMA que o default da imagem nunca aponta para o upstream; não executa",
    achados: ["ghcr.io/melgarafael"],
  },

  // ─── AMOSTRA — exemplo de interface ou fixture; e-mail de ninguém. ───
  "lib/email/resend.ts": {
    categoria: "AMOSTRA",
    motivo: "comentário que cita o remetente do fallback REMOVIDO (`noreply@deskcomm.app`); é histórico, não sai",
    achados: ["noreply@deskcomm.app"],
  },
  "lib/agent-engine/guardrails/vazamento-interno.ts": {
    categoria: "AMOSTRA",
    motivo: "comentário que descreve o falso positivo medido (um e-mail de cliente qualquer); não sai",
    achados: ["admin@minhaloja.com.br"],
  },
  "components/inbox/composer/MentionMenu.tsx": {
    categoria: "AMOSTRA",
    motivo: "comentário que explica por que `@` no meio de um e-mail não abre a menção; não sai",
    achados: ["ana@clinica.com"],
  },
  "app/vitrine-agenda/_client.tsx": {
    categoria: "AMOSTRA",
    motivo: "dado de demonstração da vitrine pública da agenda (nome de fonte fictício); não envia nada a ninguém",
    achados: ["ana@clinica.com"],
  },
  "hostgator-setup-kit/test-validators.sh": {
    categoria: "AMOSTRA",
    motivo:
      "teste do próprio kit: URLs de conexão FALSAS (`usuario:senha@host`) e um DSN de exemplo para provar os validadores; a parte antes do `@` é senha de mentira, não e-mail",
    achados: [
      "1@aws-0-sa-east-1.pooler.supabase.com",
      "40ss@aws-1-sa-east-1.pooler.supabase.com",
      "40ss@aws-1-sa-east-1.pooler.supabase.com",
      "40ss@aws-1-sa-east-1.pooler.supabase.com",
      "abc123@o0.ingest.sentry.io",
      "abc123@o0.ingest.sentry.io",
      "senha@aws-1-sa-east-1.pooler.supabase.com",
      "senha@aws-1-us-west-2.pooler.supabase.com",
      "senha@aws-1-us-west-2.pooler.supabase.com",
      "senha@aws-1-us-west-2.pooler.supabase.com",
      "senha@aws-1-us-west-2.pooler.supabase.com",
      "senha@aws-1-us-west-2.pooler.supabase.com",
      "senha@db.abcdefghijklmnop.supabase.co",
    ],
  },
  "ubuntu-local-installer.sh": {
    categoria: "AMOSTRA",
    motivo: "default da conta de DEV do instalador local (`admin@admin.com`), sobrescrito por OWNER_EMAIL; não vai a VPS de cliente",
    achados: ["admin@admin.com"],
  },
};

/**
 * Domínio que não é de terceiro: o nosso, TLD reservado (RFC 6761/2606), os
 * placeholders que a interface mostra (em português e espanhol) e os ids do
 * WhatsApp, que têm forma de e-mail e não são.
 */
const EMAIL_QUE_NAO_E_DE_TERCEIRO =
  /@(?:arvisx\.com\.br|arvisx\.test|[\w.-]*\.test|[\w.-]*\.local|example\.(?:com|org|net)|c\.us|g\.us|s\.whatsapp\.net|lid)$|exemplo|ejemplo|@empresa\.com|seudominio|suaempresa|tudominio|tuempresa|suempresa/i;

const EMAIL = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi;
const UPSTREAM = /[\w@./:#-]*melgarafael[\w@./:#-]*/gi;

/** Os achados de um texto, um por ocorrência, em minúsculas e ordenados. */
function achadosNoTexto(fonte: string): string[] {
  const achados: string[] = [];
  for (const m of fonte.matchAll(UPSTREAM)) {
    // Pontuação encostada não faz parte do identificador.
    achados.push(m[0].toLowerCase().replace(/^[.:/-]+/, "").replace(/[.:,-]+$/, ""));
  }
  for (const m of fonte.matchAll(EMAIL)) {
    const email = m[0].toLowerCase();
    if (email.includes("melgarafael")) continue; // já contado acima
    if (EMAIL_QUE_NAO_E_DE_TERCEIRO.test(email)) continue;
    achados.push(email.replace(/^[.-]+/, ""));
  }
  return achados.sort();
}

const IGNORADOS = new Set(["node_modules", ".next", ".git", "coverage"]);

function andar(dir: string, aceitar: (relativo: string) => boolean, saida: string[]): void {
  const abs = path.join(RAIZ, dir);
  if (!fs.existsSync(abs)) return;
  for (const entrada of fs.readdirSync(abs, { withFileTypes: true })) {
    if (IGNORADOS.has(entrada.name)) continue;
    const relativo = path.posix.join(dir, entrada.name);
    if (entrada.isDirectory()) andar(relativo, aceitar, saida);
    else if (entrada.isFile() && aceitar(relativo)) saida.push(relativo);
  }
}

const RAIZES_DE_CODIGO = ["app", "components", "hooks", "lib", "workers"] as const;

function codigoQueEmbarca(relativo: string): boolean {
  if (!/\.(ts|tsx)$/.test(relativo)) return false;
  if (/\.test\.(ts|tsx)$/.test(relativo)) return false;
  return !relativo.split("/").includes("__fixtures__");
}

function arquivosVarridos(): string[] {
  const saida: string[] = [];
  for (const raiz of RAIZES_DE_CODIGO) andar(raiz, codigoQueEmbarca, saida);
  andar("deploy", () => true, saida);
  andar("hostgator-setup-kit", (f) => f.endsWith(".sh"), saida);
  for (const nome of fs.readdirSync(RAIZ)) {
    if (
      nome === "proxy.ts" ||
      /^Dockerfile/.test(nome) ||
      /^docker-compose.*\.ya?ml$/.test(nome) ||
      /^ubuntu-.*-installer\.sh$/.test(nome)
    ) {
      if (fs.statSync(path.join(RAIZ, nome)).isFile()) saida.push(nome);
    }
  }
  for (const avulso of ["scripts/instalar-guias.sh", ".github/workflows/publish-image.yml"]) {
    if (fs.existsSync(path.join(RAIZ, avulso))) saida.push(avulso);
  }
  return saida.sort();
}

describe("catraca do upstream no código que executa", () => {
  const alvos = arquivosVarridos();
  const encontrado = new Map<string, string[]>();
  for (const arquivo of alvos) {
    const achados = achadosNoTexto(fs.readFileSync(path.join(RAIZ, arquivo), "utf8"));
    if (achados.length > 0) encontrado.set(arquivo, achados);
  }

  it("a varredura alcança o que diz alcançar — senão o resto não prova nada", () => {
    for (const raiz of RAIZES_DE_CODIGO) {
      expect(alvos.some((f) => f.startsWith(`${raiz}/`)), `${raiz}/ não devolveu arquivo`).toBe(true);
    }
    for (const obrigatorio of [
      "proxy.ts",
      "Dockerfile",
      "docker-compose.prod.yml",
      "hostgator-setup-kit/install.sh",
      "hostgator-setup-kit/update.sh",
      "scripts/instalar-guias.sh",
      ".github/workflows/publish-image.yml",
    ]) {
      expect(alvos, `${obrigatorio} ficou fora da varredura`).toContain(obrigatorio);
    }
    expect(alvos.some((f) => f.startsWith("deploy/"))).toBe(true);
    expect(alvos.some((f) => /^ubuntu-.*-installer\.sh$/.test(f))).toBe(true);
    expect(alvos.some((f) => /\.test\.tsx?$/.test(f)), "teste entrou na varredura").toBe(false);
    expect(alvos.length).toBeGreaterThan(1000);
  });

  it("acha o dono do upstream e o e-mail de terceiro, e deixa passar o que não é", () => {
    expect(achadosNoTexto(`image: ghcr.io/melgarafael/deskcommcrm:latest`)).toEqual([
      "ghcr.io/melgarafael/deskcommcrm:latest",
    ]);
    expect(achadosNoTexto(`LABEL source="https://github.com/MelgaRafael/DeskcommCRM"`)).toEqual([
      "https://github.com/melgarafael/deskcommcrm",
    ]);
    expect(achadosNoTexto(`ua = "App (rafael@maudibrasil.com.br)"`)).toEqual(["rafael@maudibrasil.com.br"]);
    expect(achadosNoTexto(`dsn = "https://abc@o1.ingest.us.sentry.io/2"`)).toEqual(["abc@o1.ingest.us.sentry.io"]);
    for (const inofensivo of [
      "suporte@arvisx.com.br",
      "demo@arvisx.test",
      "dono@acme.test",
      "x@host.local",
      "voce@example.com",
      "contato@seudominio.com.br",
      "vendas@suaempresa.com",
      "ana@empresa.com",
      "nome@exemplo.com.br",
      "soporte@suempresa.com",
      "5511999999999@c.us",
      "120363000000000000@g.us",
      "5511999999999@s.whatsapp.net",
      "123456789@lid",
      'import x from "@supabase/ssr";',
    ]) {
      expect(achadosNoTexto(inofensivo), inofensivo).toEqual([]);
    }
  });

  it("nenhum arquivo fora da lista cita o upstream ou e-mail de terceiro", () => {
    const novos = [...encontrado.keys()].filter((f) => !(f in EXCECOES));
    expect(
      novos,
      `Upstream ou e-mail de terceiro em código que executa.\n` +
        `Troque pelo repositório/contato da ArvisX (lib/branding.ts: SUPORTE_DO_PRODUTO) — ou,\n` +
        `se for crédito em comentário ou amostra, declare em EXCECOES com categoria e motivo:\n` +
        novos.map((f) => `  ${f}  ${JSON.stringify(encontrado.get(f))}`).join("\n"),
    ).toEqual([]);
  });

  it("arquivo da lista não ganhou nem perdeu achado sem a lista acompanhar", () => {
    const divergentes: string[] = [];
    for (const [arquivo, excecao] of Object.entries(EXCECOES)) {
      const atual = encontrado.get(arquivo) ?? [];
      const declarado = [...excecao.achados].sort();
      if (atual.length === 0) continue; // coberto pelo caso de baixo
      if (JSON.stringify(atual) !== JSON.stringify(declarado)) {
        divergentes.push(`  ${arquivo}\n    lista: ${JSON.stringify(declarado)}\n    disco: ${JSON.stringify(atual)}`);
      }
    }
    expect(
      divergentes,
      `O conjunto de achados mudou num arquivo da lista.\n` +
        `Ganhou: é ocorrência NOVA — tire do código.\n` +
        `Perdeu: a exceção encolheu — atualize a linha da lista.\n` +
        divergentes.join("\n"),
    ).toEqual([]);
  });

  it("a lista não guarda arquivo que já não tem achado nenhum (ela só encolhe)", () => {
    const obsoletos = Object.keys(EXCECOES).filter((f) => !encontrado.has(f));
    expect(
      obsoletos,
      `Estes arquivos não têm mais achado — apague a linha de EXCECOES:\n` + obsoletos.map((f) => `  ${f}`).join("\n"),
    ).toEqual([]);
  });

  it("toda exceção tem motivo escrito", () => {
    for (const [arquivo, excecao] of Object.entries(EXCECOES)) {
      expect(excecao.motivo.length, `${arquivo} sem motivo`).toBeGreaterThan(30);
      expect(excecao.achados.length, `${arquivo} sem achados`).toBeGreaterThan(0);
    }
  });
});
