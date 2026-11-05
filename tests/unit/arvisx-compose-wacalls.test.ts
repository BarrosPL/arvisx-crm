import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * O serviço `wacalls` do compose do Easypanel (`deploy/arvisx/crm/`) segue as mesmas
 * regras do `docker-compose.prod.yml` do upstream, e este teste as cobra porque
 * `tests/unit/portas-do-compose.test.ts` só lê os três compose do upstream.
 *
 *  1. Vive num profile (`voz`): sem COMPOSE_PROFILES o conteiner nem é criado.
 *  2. Imagem do upstream fixada por digest, `pull_policy: missing`.
 *  3. A única porta publicada é UDP, igual no host e no conteiner. Nenhum TCP.
 *  4. Só na rede `internal`.
 *  5. `crm-app` e `worker` NÃO têm `depends_on` nele (profile inativo derrubaria o CRM).
 */
const arquivo = path.resolve(__dirname, "../../deploy/arvisx/crm/docker-compose.easypanel.yml");
const yml = fs.readFileSync(arquivo, "utf8").replace(/\r\n/g, "\n");

/** O texto de um serviço de primeiro nível: do `  nome:` até o próximo serviço ou seção. */
function bloco(nome: string): string {
  const inicio = yml.indexOf(`\n  ${nome}:\n`);
  expect(inicio, `serviço ${nome} não existe no compose do Easypanel`).toBeGreaterThan(-1);
  const resto = yml.slice(inicio + 1);
  const fim = resto.slice(1).search(/\n(?:  [a-z][a-z0-9-]*:\n|[a-z]+:\n)/);
  return fim === -1 ? resto : resto.slice(0, fim + 1);
}

describe("compose do Easypanel: serviço wacalls (chamada de voz)", () => {
  const w = bloco("wacalls");

  it("vive no profile voz", () => {
    expect(w).toMatch(/profiles:\s*\["voz"\]/);
  });

  it("usa a imagem do upstream fixada por digest e pull_policy missing", () => {
    expect(w).toMatch(
      /image:\s*\$\{WACALLS_IMAGE:-ghcr\.io\/jotadev66\/wacalls@sha256:[0-9a-f]{64}\}/,
    );
    expect(w).toMatch(/pull_policy:\s*\$\{WACALLS_PULL_POLICY:-missing\}/);
  });

  it("publica só uma porta, UDP, igual no host e no conteiner", () => {
    // Neste bloco, item de lista entre aspas só pode ser porta (volume e rede não levam aspas).
    const portas = [...w.matchAll(/^\s+-\s*"([^"]+)"\s*$/gm)].map((m) => m[1]!);
    expect(portas).toEqual([
      "${WACALLS_WEBRTC_UDP_PORT:-7881}:${WACALLS_WEBRTC_UDP_PORT:-7881}/udp",
    ]);
    expect(w).not.toMatch(/\/tcp/);
    expect(w.match(/^\s+ports:/gm)).toHaveLength(1);
  });

  it("fica só na rede internal", () => {
    expect(w).toMatch(/networks:\s*\[internal\]/);
    expect(w).not.toMatch(/easypanel|crm\b/);
  });

  it("crm-app e worker não dependem dele", () => {
    for (const nome of ["crm-app", "worker"]) {
      const b = bloco(nome);
      const dep = b.match(/depends_on:\n((?:\s{6,}.*\n)+)/);
      expect(dep?.[1] ?? "", `${nome} não pode ganhar depends_on: wacalls`).not.toMatch(/wacalls/);
    }
  });

  it("o volume da sessão existe", () => {
    expect(yml).toMatch(/\nvolumes:\n(?:  .*\n)*  wacalls-data:/);
  });
});
