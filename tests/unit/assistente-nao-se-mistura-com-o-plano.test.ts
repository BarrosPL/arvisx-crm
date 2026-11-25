/**
 * O VIX NÃO SE MISTURA COM O LIMITE DE IA DO PLANO DOS AGENTES.
 *
 * São dois controles diferentes, e o erro de juntá-los falha em silêncio:
 *
 *   (a) o limite de IA do plano (franquia e teto em dólar) é dos AGENTES dos
 *       clientes, na chave da plataforma;
 *   (b) o Vix não tem limite por plano: tem um freio técnico contra abuso e um
 *       aviso interno de uso.
 *
 * Esta cerca lê o código e o SQL e reprova se:
 *
 *  1. o Vix ler teto, franquia ou a tabela de planos (migration, baseline e
 *     código);
 *  2. o Vix passar pelo portão de orçamento dos agentes (`runModelCall`,
 *     `aplicarOrcamento` e vizinhos);
 *  3. algum pagador do Vix gravar a origem dos agentes (`plataforma`), a do
 *     cliente (`cliente`) ou reaproveitar o `assinatura` que já existe para a
 *     conta que o cliente conecta;
 *  4. os valores de origem do Vix forem escritos fora de `lib/assistente/custo.ts`;
 *  5. o vocabulário da cobrança citar o assistente (ele não é item de plano);
 *  6. sobrar coluna, função ou texto de tela falando em limite de mensagens.
 *
 * Cerca de leitura de arquivo: prova o que ESTÁ escrito, não o comportamento. O
 * comportamento está nos testes de rota e de banco citados em cada caso.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { ORIGEM_DA_CHAVE_DO_VIX, ORIGENS_QUE_NAO_SAO_DO_VIX } from "@/lib/assistente/custo";
import { PAGADORES } from "@/lib/assistente/provedor/tipos";

const RAIZ = process.cwd();
const ler = (...p: string[]) => readFileSync(join(RAIZ, ...p), "utf8");

function arquivos(dir: string, filtro: (caminho: string) => boolean): string[] {
  const achados: string[] = [];
  const andar = (d: string) => {
    for (const nome of readdirSync(d)) {
      if (nome === "node_modules" || nome.startsWith(".")) continue;
      const p = join(d, nome);
      if (statSync(p).isDirectory()) andar(p);
      else if (filtro(p)) achados.push(relative(RAIZ, p).replaceAll("\\", "/"));
    }
  };
  andar(join(RAIZ, dir));
  return achados;
}

const ehCodigo = (p: string) => /\.(ts|tsx)$/.test(p);
const ehTeste = (p: string) => /\.test\.tsx?$/.test(p);
const DO_VIX = [
  ...arquivos("lib/assistente", ehCodigo),
  ...arquivos("app/api/v1/assistente", ehCodigo),
  ...arquivos("app/api/v1/admin/assistente", ehCodigo),
  ...arquivos("components/assistente", ehCodigo),
].filter((p) => !ehTeste(p));

const MIGRATIONS = readdirSync(join(RAIZ, "supabase", "migrations")).filter((n) => /_983\d_assistente_/.test(n));
const BASELINE = ler("supabase", "baseline.sql");
/** Os blocos do Vix no baseline (o espelho das migrations 983x), do primeiro rótulo até a varredura que vem depois. */
function blocosDoVixNoBaseline(): string {
  const ini = BASELINE.indexOf("-- ---- fundação do Vix, o assistente do cliente (migration 9830) ----");
  const fim = BASELINE.indexOf("-- ---- VARREDURA anon: função nova nasce exposta em quem ATUALIZA (migration 0116) ----");
  return ini === -1 || fim === -1 ? "" : BASELINE.slice(ini, fim);
}

describe("controle: a cerca enxerga o que diz que enxerga", () => {
  it("acha os arquivos do Vix, as migrations e os blocos do baseline", () => {
    expect(DO_VIX.length).toBeGreaterThan(15);
    expect(DO_VIX).toContain("lib/assistente/custo.ts");
    expect(DO_VIX).toContain("app/api/v1/assistente/mensagens/route.ts");
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(2);
    expect(blocosDoVixNoBaseline()).toContain("fn_assistente_acesso_da_org");
    expect(blocosDoVixNoBaseline()).toContain("fn_expurgar_historico_do_assistente");
  });
});

describe("1. o Vix não lê teto, franquia nem a tabela de planos", () => {
  const PROIBIDO = /teto_ia_usd_cents|franquia_conversas_ia|cobranca_planos/;

  it.each(MIGRATIONS)("migration %s", (nome) => {
    expect(ler("supabase", "migrations", nome)).not.toMatch(PROIBIDO);
  });

  it("os blocos do Vix no baseline", () => {
    expect(blocosDoVixNoBaseline()).not.toMatch(PROIBIDO);
  });

  it("o código do Vix", () => {
    const culpados = DO_VIX.filter((p) => PROIBIDO.test(ler(p)));
    expect(culpados).toEqual([]);
  });

  it("a disponibilidade lê só a existência e o estado da assinatura", () => {
    const corpo = blocosDoVixNoBaseline();
    const i = corpo.indexOf("create or replace function public.fn_assistente_acesso_da_org");
    const funcao = corpo.slice(i, corpo.indexOf("$$;", i));
    expect(funcao).toContain("public.cobranca_assinaturas");
    expect(funcao).toContain("a.estado not in ('em_atraso', 'cancelada')");
    expect(funcao).toContain("o.status = 'active'");
    // Nenhuma coluna de plano: nem o id do plano entra na decisão.
    expect(funcao).not.toMatch(/plano_id|preco|teto|franquia|limite/);
  });
});

describe("2. o Vix não passa pelo portão de orçamento dos agentes", () => {
  const PORTAO = /run-model-call|runModelCall|aplicarOrcamento|edge\/llm\/orcamento|lib\/ai\/budget|pode-gastar|podeGastar/;

  it("nenhum arquivo do Vix importa nem cita o portão", () => {
    const culpados = DO_VIX.filter((p) => PORTAO.test(ler(p)));
    expect(culpados).toEqual([]);
  });

  it("o caminho da chave da plataforma monta o modelo direto, sem o motor dos agentes", () => {
    const fonte = ler("lib", "assistente", "provedor", "chave-da-plataforma.ts");
    expect(fonte).toContain("buildModel(");
    expect(fonte).not.toMatch(PORTAO);
    expect(ler("lib", "assistente", "turno.ts")).toContain("streamText(");
  });
});

describe("3. a origem que o Vix grava é sempre dele", () => {
  const ligados = PAGADORES.filter((p) => p !== "desligado");

  it("todo pagador ligado tem uma origem, e só eles", () => {
    expect(Object.keys(ORIGEM_DA_CHAVE_DO_VIX).sort()).toEqual([...ligados].sort());
  });

  it.each(ligados)("pagador %s não mapeia para a origem dos agentes, do cliente, nem para 'assinatura'", (pagador) => {
    const origem = ORIGEM_DA_CHAVE_DO_VIX[pagador];
    expect(ORIGENS_QUE_NAO_SAO_DO_VIX as readonly string[]).not.toContain(origem);
    expect(origem).not.toBe("");
  });

  it("a lista do que não é do Vix nomeia os três valores alheios", () => {
    expect([...ORIGENS_QUE_NAO_SAO_DO_VIX].sort()).toEqual(["assinatura", "cliente", "plataforma"]);
  });
});

describe("4. só lib/assistente/custo.ts escreve os valores de origem do Vix", () => {
  // O vocabulário da coluna (o lado TypeScript do CHECK) pode NOMEAR os valores;
  // ele não grava nada. É o único outro arquivo aceito, e só existe depois que a
  // migration da coluna entrar.
  const SO_NOMEIA = new Set(["lib/ai/usage/origem-da-chave.ts", "lib/database.types.ts"]);
  const PRODUTO = ["lib", "app", "components", "workers", "hooks"]
    .flatMap((d) => {
      try {
        return arquivos(d, ehCodigo);
      } catch {
        return [];
      }
    })
    .filter((p) => !ehTeste(p) && !SO_NOMEIA.has(p));

  it("controle: a varredura cobre o produto", () => {
    expect(PRODUTO.length).toBeGreaterThan(500);
    expect(PRODUTO).toContain("lib/assistente/custo.ts");
  });

  it("o valor próprio do Vix na chave da plataforma só aparece em custo.ts", () => {
    expect(PRODUTO.filter((p) => ler(p).includes("assistente_chave_plataforma"))).toEqual(["lib/assistente/custo.ts"]);
  });

  it("dentro do Vix, a coluna de origem e a tabela llm_calls só são tocadas em custo.ts", () => {
    const tocam = DO_VIX.filter((p) => /origem_da_chave|COLUNA_DA_ORIGEM_DA_CHAVE|\.from\("llm_calls"\)/.test(ler(p)));
    expect(tocam).toEqual(["lib/assistente/custo.ts"]);
  });

  it("os provedores do Vix não carregam valor de origem: quem decide é o mapa", () => {
    for (const p of DO_VIX.filter((x) => x.startsWith("lib/assistente/provedor/"))) {
      expect(ler(p), p).not.toMatch(/origemDaChave|ORIGEM_DA_CHAVE/);
    }
  });
});

describe("5. o assistente não é item de plano", () => {
  it("lib/cobranca/vocabulario.ts não cita o Vix nem o assistente", () => {
    expect(ler("lib", "cobranca", "vocabulario.ts")).not.toMatch(/vix|assistente/i);
  });
});

describe("6. não sobrou limite de mensagens por plano", () => {
  const LIMITE = /mensagens_por_mes|assistente_planos|sem_limite|limite_de_mensagens|limite_atingido|limite de mensagens/i;

  it("nas migrations e nos blocos do baseline", () => {
    for (const nome of MIGRATIONS) {
      const semComentario = ler("supabase", "migrations", nome)
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n");
      expect(semComentario, nome).not.toMatch(LIMITE);
    }
    expect(blocosDoVixNoBaseline()).not.toMatch(/mensagens_por_mes|assistente_planos|sem_limite/);
  });

  it("no código do Vix, fora de comentário que diz que NÃO há limite", () => {
    const culpados = DO_VIX.filter((p) =>
      ler(p)
        .split("\n")
        .some((l) => LIMITE.test(l) && !/não há limite|sem limite no pedido|não aplica limite|NÃO HÁ LIMITE/i.test(l)),
    );
    expect(culpados).toEqual([]);
  });

  it("nos textos de tela e nas traduções", () => {
    for (const p of [["lib", "i18n", "dicionario.ts"], ["lib", "i18n", "traducoes", "en.json"], ["lib", "assistente", "frases.ts"]]) {
      const fonte = ler(...p);
      expect(fonte, p.join("/")).not.toMatch(/limite de mensagens do assistente/i);
      expect(fonte, p.join("/")).not.toMatch(/assistente não está incluído no plano/i);
      expect(fonte, p.join("/")).not.toMatch(/limite de mensagens próprio por plano/i);
    }
  });
});
