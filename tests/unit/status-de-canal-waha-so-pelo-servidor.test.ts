// @vitest-environment node
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * STATUS E NÚMERO DE CONEXÃO WAHA SÃO GRAVADOS PELO SERVIDOR (migration 9805).
 *
 * O gatilho `trg_channel_sessions_vaga_e_do_servidor` recusa (42501) a sessão
 * que muda `status` ou `phone_number` de uma conexão WAHA: são as colunas que
 * contam a vaga de canal do plano. O banco está coberto por
 * `tests/invariants/arvisx-canais-vaga-so-pelo-servidor.test.ts`; esta cerca
 * cobre o OUTRO lado — as rotas que gravam essas colunas precisam usar o
 * service role. Rota que voltar a gravar com o cliente da sessão não falha em
 * teste nenhum com banco de mentira: falha em produção, com 42501 no meio de
 * um "Reconectar".
 *
 * A régua é estática e de propósito estreita: nas três rotas que falam com o
 * WAHA, nenhum `update` de `channel_sessions` pelo cliente da sessão
 * (`supabase`/`db`) leva `status` ou `phone_number`.
 */

const RAIZ = process.cwd();
const ROTAS = [
  "app/api/v1/channel-sessions/[id]/route.ts",
  "app/api/v1/channel-sessions/[id]/reconnect/route.ts",
  "app/api/v1/onboarding/whatsapp/session/route.ts",
];

/** Cada `<cliente>.from("channel_sessions").update(<argumento>`, com o começo do argumento. */
function escritasDe(fonte: string): Array<{ cliente: string; argumento: string }> {
  const achadas: Array<{ cliente: string; argumento: string }> = [];
  const re = /([\w.()]+)\s*\.from\("channel_sessions"\)\s*\.update\(/g;
  for (let m = re.exec(fonte); m; m = re.exec(fonte)) {
    const depois = fonte.slice(re.lastIndex, re.lastIndex + 200);
    achadas.push({ cliente: m[1]!, argumento: depois.slice(0, depois.indexOf(")") + 1) });
  }
  return achadas;
}

/** O argumento leva status/número — literal, ou o objeto montado antes (`patch`, `corpo`). */
const LEVA_STATUS = /\b(status|phone_number|patch|corpo)\b/;

describe.each(ROTAS)("%s", (rota) => {
  const fonte = fs.readFileSync(path.join(RAIZ, rota), "utf8");
  const escritas = escritasDe(fonte);

  it("a rota grava channel_sessions (a cerca não pode passar por não ver nada)", () => {
    expect(escritas.length).toBeGreaterThan(0);
  });

  it("nenhuma escrita pelo cliente da SESSÃO leva status ou phone_number", () => {
    const pelaSessao = escritas.filter((e) => /^(supabase|db)$/.test(e.cliente));
    for (const e of pelaSessao) {
      expect(e.argumento, `${rota}: ${e.argumento}`).not.toMatch(LEVA_STATUS);
    }
  });

  it("as escritas de status saem pelo service role", () => {
    const deStatus = escritas.filter((e) => LEVA_STATUS.test(e.argumento));
    expect(deStatus.length).toBeGreaterThan(0);
    for (const e of deStatus) {
      expect(e.cliente, `${rota}: ${e.argumento}`).toMatch(/^(createAdminClient\(\)|servidor|escritor)$/);
    }
  });
});

describe("o escritor da exclusão do canal", () => {
  it("é sempre o service role — o arquivamento leva o status a STOPPED", () => {
    const fonte = fs.readFileSync(path.join(RAIZ, "app/api/v1/channel-sessions/[id]/route.ts"), "utf8");
    expect(fonte).toMatch(/const escritor = createAdminClient\(\);/);
  });
});
