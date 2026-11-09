/**
 * CERCA: nenhuma chave da Stripe nem segredo de webhook mora no repositório.
 *
 * A chave (`sk_`/`rk_`) e o segredo do webhook (`whsec_`) são do dono, que os
 * põe pela tela `/admin/cobranca` (cifrados em `platform_config`). Nada disso
 * vai para arquivo nem commit — nem a de teste: o GitHub varre segredo no push
 * e a de teste dá acesso à conta de teste inteira.
 *
 * O tamanho separa o real do de mentira: uma chave secreta da Stripe tem mais
 * de 90 caracteres depois do prefixo, e um `whsec_` tem 32 ou mais. Os dublês
 * dos testes e do curso (`sk_test_51Curso…`, montados ou curtos) ficam abaixo.
 * `git grep --untracked` mede também o arquivo novo, antes do commit.
 */
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const PADRAO = String.raw`(sk|rk)_(live|test)_[A-Za-z0-9]{60,}|whsec_[A-Za-z0-9]{32,}`;

/** Exemplo comentado do próprio Supabase (base64 de "This is an example of a shorter Base64 string"). */
const PERMITIDOS = new Set(["deploy/arvisx/supabase/UPSTREAM-docker-compose.yml"]);

function achados(): string[] {
  try {
    const saida = execFileSync("git", ["grep", "--untracked", "-lIE", PADRAO], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return saida.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch (e) {
    // `git grep` sai com 1 quando não acha nada: é o resultado esperado.
    if ((e as { status?: number }).status === 1) return [];
    throw e;
  }
}

describe("nenhuma chave da Stripe no repositório", () => {
  it("⭐ git grep não acha chave secreta, restrita nem segredo de webhook com cara de real", () => {
    expect(achados().filter((arquivo) => !PERMITIDOS.has(arquivo))).toEqual([]);
  });

  it("controle: o padrão pega uma chave no formato real e deixa passar os dublês curtos", () => {
    const re = new RegExp(PADRAO);
    expect(re.test(["sk", "test", "51" + "A".repeat(97)].join("_"))).toBe(true);
    expect(re.test(["whsec", "B".repeat(32)].join("_"))).toBe(true);
    expect(re.test(["sk", "test", "51CursoBemViverDemonstracao7Xq2"].join("_"))).toBe(false);
  });
});
