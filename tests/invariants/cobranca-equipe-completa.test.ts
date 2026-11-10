import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";
import {
  assinar, comoAnon, comoServidor, comoUsuario, criarOrg, criarPlano, criarUsuarios, erroDe, uuid, valor, vincular,
} from "./cobranca-helpers";

/**
 * EQUIPE COMPLETA AGUARDANDO CONTATO (ArvisX, migration 9804).
 *
 * 1. Isolamento de `cobranca_equipe_completa`: o admin da empresa lê as linhas
 *    dela e zero da outra, o agent não lê, a sessão não escreve, anon não lê.
 *    Fora de TABLES de rls-isolation.test.ts pela mesma razão de
 *    `cobranca_assinaturas` (a leitura é de admin); declarada em PROVA_PROPRIA.
 * 2. O gatilho em `cobranca_assinaturas`: só o pagamento confirmado num plano
 *    com `inclui_agentes_arvisx` é ENTRADA; atraso que volta não avisa de novo;
 *    troca para plano sem os agentes é SAÍDA; cada linha emite
 *    `cobranca.equipe_completa` no event_log.
 */
const P = "c0b09804-0000-4000-8000";
const ORG_A = uuid(P, 1);
const ORG_B = uuid(P, 2);
const ADMIN_A = uuid(P, 11);
const AGENTE_A = uuid(P, 12);
const ADMIN_B = uuid(P, 13);
const EQUIPE = uuid(P, 101);
const PREMIUM = uuid(P, 102);

const linhas = (org: string) =>
  valor(`select coalesce(string_agg(tipo, ',' order by criado_em, id), '') from public.cobranca_equipe_completa where organization_id = '${org}';`);
const eventos = (org: string) =>
  valor(`select count(*) from public.event_log where event_type = 'cobranca.equipe_completa' and organization_id = '${org}';`);
const estado = (org: string, campos: string) => sql(`update public.cobranca_assinaturas set ${campos} where organization_id = '${org}';`);

beforeAll(() => {
  criarUsuarios([
    [ADMIN_A, "admin-a-9804@invariant.test"],
    [AGENTE_A, "agente-a-9804@invariant.test"],
    [ADMIN_B, "admin-b-9804@invariant.test"],
  ]);
  criarOrg(ORG_A, "equipe-completa-a");
  criarOrg(ORG_B, "equipe-completa-b");
  vincular(ADMIN_A, ORG_A, "admin");
  vincular(AGENTE_A, ORG_A, "agent");
  vincular(ADMIN_B, ORG_B, "admin");
  criarPlano({ id: EQUIPE, nome: "Equipe Completa" });
  criarPlano({ id: PREMIUM, nome: "Premium" });
  sql(`update public.cobranca_planos set inclui_agentes_arvisx = true where id = '${EQUIPE}';`);
  assinar(ORG_A, EQUIPE);
  assinar(ORG_B, EQUIPE);
});

describe("9804 — o gatilho do Equipe Completa", () => {
  it("⭐ em teste grátis, nada; pago (ativa), uma ENTRADA e um evento", () => {
    expect(linhas(ORG_A)).toBe("");
    estado(ORG_A, "estado = 'ativa'");
    expect(linhas(ORG_A)).toBe("entrada");
    expect(eventos(ORG_A)).toBe("1");
    expect(valor(`select plano_nome from public.cobranca_equipe_completa where organization_id = '${ORG_A}';`)).toBe("Equipe Completa");
  });

  it("primeiro pagamento ainda pendente não é pagamento confirmado", () => {
    estado(ORG_B, "estado = 'ativa', pagamento_inicial_pendente = true");
    expect(linhas(ORG_B)).toBe("");
    estado(ORG_B, "pagamento_inicial_pendente = false");
    expect(linhas(ORG_B)).toBe("entrada");
  });

  it("atraso que volta a 'ativa' no mesmo plano não avisa de novo", () => {
    estado(ORG_A, "estado = 'em_atraso'");
    estado(ORG_A, "estado = 'ativa'");
    expect(linhas(ORG_A)).toBe("entrada");
  });

  it("⭐ troca para plano sem os agentes é SAÍDA; voltar e pagar é nova ENTRADA", () => {
    estado(ORG_A, `plano_id = '${PREMIUM}'`);
    expect(linhas(ORG_A)).toBe("entrada,saida");
    estado(ORG_A, `plano_id = '${EQUIPE}'`);
    expect(linhas(ORG_A)).toBe("entrada,saida,entrada");
    expect(eventos(ORG_A)).toBe("3");
  });
});

describe("9804 — isolamento de cobranca_equipe_completa", () => {
  it("⭐ admin de A lê as de A e zero de B; agent de A não lê", () => {
    expect(countAs(ADMIN_A, `select count(*) from public.cobranca_equipe_completa where organization_id = '${ORG_A}';`)).toBe(3);
    expect(countAs(ADMIN_A, `select count(*) from public.cobranca_equipe_completa where organization_id = '${ORG_B}';`)).toBe(0);
    expect(countAs(ADMIN_B, `select count(*) from public.cobranca_equipe_completa;`)).toBe(1);
    expect(countAs(AGENTE_A, `select count(*) from public.cobranca_equipe_completa;`)).toBe(0);
  });

  it("a sessão não escreve (nem marca o contato), e anon não lê", () => {
    for (const comando of [
      `update public.cobranca_equipe_completa set contatado_em = now() where organization_id = '${ORG_A}'`,
      `insert into public.cobranca_equipe_completa (organization_id, tipo, plano_nome) values ('${ORG_A}', 'entrada', 'x')`,
      `delete from public.cobranca_equipe_completa where organization_id = '${ORG_A}'`,
    ]) {
      expect(erroDe(comoUsuario(ADMIN_A, comando)), comando).toContain("permission denied for table cobranca_equipe_completa");
    }
    expect(erroDe(comoAnon(`select count(*) from public.cobranca_equipe_completa`))).toContain("permission denied for table cobranca_equipe_completa");
  });

  it("controle: o servidor lê as duas organizações", () => {
    expect(valor(comoServidor(`select count(*) from public.cobranca_equipe_completa where organization_id in ('${ORG_A}', '${ORG_B}')`))).toBe("4");
  });
});
