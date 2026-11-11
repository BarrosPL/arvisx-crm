import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";
import {
  assinar,
  chaveDeCobranca,
  comoServidor,
  comoUsuario,
  criarOrg,
  criarPlano,
  criarUsuarios,
  erroDe,
  numero,
  uuid,
  valor,
} from "./cobranca-helpers";

/**
 * A VAGA DE CANAL NÃO É BURLÁVEL PELO BANCO (ArvisX, migration 9805).
 *
 * Auditoria de 11/11/2026, reproduzida em produção com a chave pública e a
 * sessão do dono de uma empresa no Essencial (3 canais):
 *
 *   1. INSERT de uma conexão `STOPPED` e sem número — não conta vaga (0809);
 *   2. PATCH `status = 'WORKING'` + `phone_number` — o gatilho da vaga não
 *      observa essas colunas, de propósito.
 *
 * Resultado: 4 conexões. A 9805 reserva ao servidor as colunas que contam a
 * vaga. Os casos com ⭐ são os que o banco de antes deixava passar.
 *
 * ⚠️ O gatilho e a RLS recusam com o MESMO SQLSTATE (42501): cada recusa
 * confere também a MENSAGEM do gatilho.
 */

const P = "c0b09805-0000-4000-8000";
const ORG = uuid(P, 1); // Essencial: 3 canais, no teto
const ORG_LIVRE = uuid(P, 2); // Essencial com 1 canal: tem vaga
const ORG_ISENTA = uuid(P, 3); // sem assinatura
const canal = (n: number) => uuid(P, 100 + n);
const ADMIN = uuid(P, 800);
const DONO = uuid(P, 801); // platform admin full
const ESSENCIAL = uuid(P, 901);
const RECUSA = "canal_vaga_e_do_servidor";

type Estado = "STARTING" | "SCAN_QR_CODE" | "WORKING" | "STOPPED" | "FAILED";

function insercaoDeCanal(id: string, orgId: string, estado: Estado, telefone: string | null = null): string {
  return `insert into public.channel_sessions
    (id, organization_id, waha_session_name, webhook_secret_encrypted, status, phone_number)
    values ('${id}', '${orgId}', 'v98-${id.slice(-12)}', '\\x00'::bytea, '${estado}',
            ${telefone === null ? "null" : `'${telefone}'`})`;
}

/** A régua de quem ocupa a vaga (0809), como o gatilho e a tela contam. */
function ocupadas(orgId: string): number {
  return numero(`select count(*) from public.channel_sessions cs
                  where cs.organization_id = '${orgId}' and cs.archived_at is null and cs.provider <> 'wacalls'
                    and (cs.provider <> 'waha' or cs.phone_number is not null or cs.status not in ('FAILED', 'STOPPED'));`);
}

function linha(id: string): string {
  return valor(`select status || '/' || coalesce(phone_number, '-') || '/' || provider
                  from public.channel_sessions where id = '${id}';`);
}

function existe(id: string): boolean {
  return numero(`select count(*) from public.channel_sessions where id = '${id}';`) === 1;
}

/** Quantas linhas a sessão do admin alterou; a recusa do gatilho sobe como erro. */
function alterou(usuario: string, dml: string): number {
  return Number(valor(comoUsuario(usuario, `with w as (${dml} returning 1) select count(*) from w`)));
}

beforeAll(() => {
  criarPlano({ id: ESSENCIAL, nome: "Essencial (3 canais)", maxCanais: 3 });
  criarUsuarios([
    [ADMIN, "vaga-9805@invariant.test"],
    [DONO, "dono-9805@invariant.test"],
  ]);
  sql(`insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason)
         values ('${DONO}', '${DONO}', 'full', false, 'fixture da 9805') on conflict do nothing;`);
  for (const [org, slug] of [[ORG, "v9805-teto"], [ORG_LIVRE, "v9805-livre"], [ORG_ISENTA, "v9805-isenta"]] as const) {
    criarOrg(org, slug);
    sql(`insert into public.user_organizations (organization_id, user_id, role, accepted_at)
           values ('${org}', '${ADMIN}', 'admin', now()) on conflict do nothing;`);
  }
  assinar(ORG, ESSENCIAL);
  assinar(ORG_LIVRE, ESSENCIAL);
  chaveDeCobranca("ligado");

  // Essencial no teto: 3 números no ar.
  sql(`${insercaoDeCanal(canal(1), ORG, "WORKING", "5511998050001")};
       ${insercaoDeCanal(canal(2), ORG, "WORKING", "5511998050002")};
       ${insercaoDeCanal(canal(3), ORG, "WORKING", "5511998050003")};`);
  // Uma linha morta e sem número, deixada por um QR que ninguém leu (legítima).
  sql(`${insercaoDeCanal(canal(4), ORG, "STOPPED")};`);
  sql(`${insercaoDeCanal(canal(11), ORG_LIVRE, "WORKING", "5511998050011")};`);
});

describe("o roteiro da auditoria: Essencial com 3 canais não consegue o 4º pelo banco", () => {
  it("o ponto de partida é o teto: 3 ocupadas, e a 4ª que ocupa já era recusada (PT402)", () => {
    expect(ocupadas(ORG)).toBe(3);
    const e = erroDe(comoUsuario(ADMIN, insercaoDeCanal(canal(20), ORG, "WORKING", "5511998050020")));
    expect(e).toContain("PT402");
    expect(e).toContain("limite_do_plano:canais:3");
  });

  it("⭐ passo 1: INSERT pela sessão de uma conexão STOPPED e sem número é recusado", () => {
    const e = erroDe(comoUsuario(ADMIN, insercaoDeCanal(canal(21), ORG, "STOPPED")));
    expect(e).toContain("42501");
    expect(e).toContain(RECUSA);
    expect(existe(canal(21))).toBe(false);
  });

  it("⭐ o mesmo com FAILED, e com as colunas omitidas (o padrão da tabela)", () => {
    expect(erroDe(comoUsuario(ADMIN, insercaoDeCanal(canal(22), ORG, "FAILED")))).toContain(RECUSA);
    const e = erroDe(
      comoUsuario(
        ADMIN,
        `insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
           values ('${canal(23)}', '${ORG}', 'v98-padrao', '\\x00'::bytea)`,
      ),
    );
    // Se o padrão da coluna ocupa vaga, quem recusa é o teto; se não ocupa, é a 9805.
    expect(e).toMatch(new RegExp(`${RECUSA}|limite_do_plano:canais:3`));
    expect(existe(canal(22))).toBe(false);
    expect(existe(canal(23))).toBe(false);
  });

  it("⭐ passo 2: PATCH de status = WORKING + phone_number na linha morta é recusado", () => {
    const e = erroDe(
      comoUsuario(
        ADMIN,
        `update public.channel_sessions set status = 'WORKING', phone_number = '5511998050004' where id = '${canal(4)}'`,
      ),
    );
    expect(e).toContain("42501");
    expect(e).toContain(RECUSA);
    expect(linha(canal(4))).toBe("STOPPED/-/waha");
  });

  it("⭐ nem só o status, nem só o número", () => {
    for (const set of ["status = 'WORKING'", "status = 'STARTING'", "status = 'SCAN_QR_CODE'", "phone_number = '5511998050004'"]) {
      expect(erroDe(comoUsuario(ADMIN, `update public.channel_sessions set ${set} where id = '${canal(4)}'`)), set).toContain(
        RECUSA,
      );
    }
    expect(linha(canal(4))).toBe("STOPPED/-/waha");
    expect(ocupadas(ORG)).toBe(3);
  });

  it("⭐ o caminho inverso: tirar da contagem um número que está no ar também é recusado", () => {
    const e = erroDe(
      comoUsuario(ADMIN, `update public.channel_sessions set status = 'STOPPED', phone_number = null where id = '${canal(1)}'`),
    );
    expect(e).toContain(RECUSA);
    expect(erroDe(comoUsuario(ADMIN, `update public.channel_sessions set phone_number = null where id = '${canal(1)}'`))).toContain(
      RECUSA,
    );
    expect(linha(canal(1))).toBe("WORKING/5511998050001/waha");
    expect(ocupadas(ORG)).toBe(3);
  });

  it("⭐ trocar o provedor ou a empresa da linha pela sessão é recusado", () => {
    expect(erroDe(comoUsuario(ADMIN, `update public.channel_sessions set provider = 'wacalls' where id = '${canal(1)}'`))).toContain(
      RECUSA,
    );
    expect(
      erroDe(comoUsuario(ADMIN, `update public.channel_sessions set organization_id = '${ORG_LIVRE}' where id = '${canal(1)}'`)),
    ).toContain(RECUSA);
    expect(linha(canal(1))).toBe("WORKING/5511998050001/waha");
  });

  it("⭐ o dono da instalação, pela sessão, também não: a coluna é do servidor, não de um papel", () => {
    const e = erroDe(
      comoUsuario(DONO, `update public.channel_sessions set status = 'WORKING', phone_number = '5511998050004' where id = '${canal(4)}'`),
    );
    expect(e).toContain(RECUSA);
  });

  it("no fim do roteiro a empresa continua com 3", () => {
    expect(ocupadas(ORG)).toBe(3);
  });
});

describe("o Reconectar (fn_vaga_ao_reviver_canal) não dá um canal a mais", () => {
  it("linha morta e sem número, com o teto tomado: PT402 e a linha continua morta", () => {
    const e = erroDe(comoServidor(`select public.fn_vaga_ao_reviver_canal('${ORG}', '${canal(4)}')`));
    expect(e).toContain("PT402");
    expect(e).toContain("limite_do_plano:canais:3");
    expect(linha(canal(4))).toBe("STOPPED/-/waha");
  });

  it("linha COM número que caiu: reconecta, e a empresa continua em 3 — ela já ocupava a vaga", () => {
    sql(`update public.channel_sessions set status = 'FAILED' where id = '${canal(2)}';`);
    expect(ocupadas(ORG)).toBe(3);
    expect(erroDe(comoServidor(`select public.fn_vaga_ao_reviver_canal('${ORG}', '${canal(2)}')`))).toBe("");
    sql(`update public.channel_sessions set status = 'WORKING' where id = '${canal(2)}';`);
    expect(ocupadas(ORG)).toBe(3);
  });

  it("linha com número ARQUIVADA (fora da contagem): só volta pela vaga — desarquivar no teto é PT402", () => {
    sql(`${insercaoDeCanal(canal(5), ORG_LIVRE, "STOPPED", "5511998050005")};`);
    sql(`update public.channel_sessions set archived_at = now() where id = '${canal(5)}';
         ${insercaoDeCanal(canal(12), ORG_LIVRE, "WORKING", "5511998050012")};
         ${insercaoDeCanal(canal(13), ORG_LIVRE, "WORKING", "5511998050013")};`);
    expect(ocupadas(ORG_LIVRE)).toBe(3);
    // A função não revive linha arquivada (a rota a recusa antes, com 409)…
    expect(erroDe(comoServidor(`select public.fn_vaga_ao_reviver_canal('${ORG_LIVRE}', '${canal(5)}')`))).toBe("");
    expect(valor(`select status from public.channel_sessions where id = '${canal(5)}';`)).toBe("STOPPED");
    // …e desarquivar, por quem for, passa pela contagem.
    for (const script of [
      comoUsuario(ADMIN, `update public.channel_sessions set archived_at = null where id = '${canal(5)}'`),
      comoServidor(`update public.channel_sessions set archived_at = null where id = '${canal(5)}'`),
    ]) {
      expect(erroDe(script)).toContain("limite_do_plano:canais:3");
    }
    expect(ocupadas(ORG_LIVRE)).toBe(3);
  });
});

describe("o que continua funcionando", () => {
  it("o admin segue editando o resto da linha pela sessão (nome, metadados, limite diário)", () => {
    expect(
      alterou(
        ADMIN,
        `update public.channel_sessions
            set display_name = 'Recepção', daily_message_limit = 300, metadata = metadata || '{"sonda":"9805"}'::jsonb
          where id = '${canal(1)}'`,
      ),
    ).toBe(1);
    expect(valor(`select display_name from public.channel_sessions where id = '${canal(1)}';`)).toBe("Recepção");
  });

  it("reenviar o MESMO status e número não é alteração (PATCH que devolve a linha inteira)", () => {
    expect(
      alterou(
        ADMIN,
        `update public.channel_sessions set status = 'WORKING', phone_number = '5511998050001', display_name = 'Recepção 2'
          where id = '${canal(1)}'`,
      ),
    ).toBe(1);
  });

  it("o servidor (webhook, cron de saúde, rota) segue espelhando status e número", () => {
    expect(
      erroDe(comoServidor(`update public.channel_sessions set status = 'FAILED' where id = '${canal(3)}'`)),
    ).toBe("");
    expect(
      erroDe(
        comoServidor(`update public.channel_sessions set status = 'WORKING', phone_number = '5511998050033' where id = '${canal(3)}'`),
      ),
    ).toBe("");
    expect(linha(canal(3))).toBe("WORKING/5511998050033/waha");
  });

  it("a reserva pela sessão (fn_reserve_channel_connection) cria a conexão quando há vaga, e recusa no teto", () => {
    const reservar = (org: string, chave: string) => `set role authenticated;
select set_config('request.jwt.claims', '{"sub":"${ADMIN}","role":"authenticated","aal":"aal1"}', false);
select public.fn_reserve_channel_connection('${org}', '${chave}', '${"a".repeat(64)}', null, false);`;
    expect(erroDe(reservar(ORG, uuid(P, 701)))).toContain("limite_do_plano:canais:3");
    sql(`update public.channel_sessions set archived_at = now() where id = '${canal(13)}';`);
    const r = JSON.parse(valor(reservar(ORG_LIVRE, uuid(P, 702)))) as { channel: { status: string } };
    expect(r.channel.status).toBe("STARTING");
    expect(ocupadas(ORG_LIVRE)).toBe(3);
  });

  it("voz (wacalls) não conta vaga: a sessão segue gravando o status dela", () => {
    sql(`insert into public.channel_sessions (id, organization_id, provider, wacalls_session_id, webhook_secret_encrypted, status)
           values ('${canal(30)}', '${ORG}', 'wacalls', 'wac-9805', '\\x00'::bytea, 'STOPPED');`);
    expect(alterou(ADMIN, `update public.channel_sessions set status = 'STARTING' where id = '${canal(30)}'`)).toBe(1);
    expect(ocupadas(ORG)).toBe(3);
  });

  it("arquivar pela sessão segue possível e libera a vaga; a empresa isenta não tem teto, mas a coluna segue do servidor", () => {
    expect(alterou(ADMIN, `update public.channel_sessions set archived_at = now() where id = '${canal(11)}'`)).toBe(1);
    sql(`${insercaoDeCanal(canal(40), ORG_ISENTA, "STOPPED")};`);
    expect(
      erroDe(comoUsuario(ADMIN, `update public.channel_sessions set status = 'WORKING' where id = '${canal(40)}'`)),
    ).toContain(RECUSA);
  });

  it("a função do gatilho não é RPC de quem está logado", () => {
    for (const papel of ["anon", "authenticated"]) {
      expect(
        valor(`select has_function_privilege('${papel}', 'public.fn_channel_sessions_vaga_e_do_servidor()', 'execute');`),
        papel,
      ).toBe("f");
    }
  });
});
