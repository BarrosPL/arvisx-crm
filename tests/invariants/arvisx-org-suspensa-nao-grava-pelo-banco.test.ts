import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";
import { comoServidor, comoUsuario, criarOrg, criarUsuarios, erroDe, numero, uuid, valor } from "./cobranca-helpers";

/**
 * EMPRESA SUSPENSA NÃO GRAVA PELO BANCO (ArvisX, migration 9806).
 *
 * Auditoria de 11/11/2026: com `organizations.status = 'suspended'` a API do
 * CRM recusava tudo (403 `org_suspended`), mas um INSERT em `contacts` direto
 * na API do banco, com a chave pública e a sessão de um membro, passava.
 *
 * A 9806 põe três policies RESTRICTIVE para `authenticated` em toda tabela com
 * `organization_id`. Medido aqui em `contacts` e em mais duas tabelas
 * (`crm_pipelines` e `message_templates`), nos três verbos, com o CONTROLE da
 * mesma escrita na empresa ativa — sem ele, uma recusa por outro motivo
 * passaria por prova. Os casos com ⭐ são os que o banco de antes aceitava.
 */

const P = "c0b09806-0000-4000-8000";
const ORG_SUSPENSA = uuid(P, 1);
const ORG_ATIVA = uuid(P, 2);
const ORG_VAI_E_VOLTA = uuid(P, 3);
const ADMIN = uuid(P, 800); // admin das três empresas
const DONO = uuid(P, 801); // dono da instalação (platform admin full), sem vínculo
const DONO_MEMBRO = uuid(P, 802); // dono da instalação que TAMBÉM é membro da suspensa
const DE_FORA = uuid(P, 803); // logado, sem vínculo nenhum
const linha = (n: number) => uuid(P, 1000 + n);

const POLICIES = ["org_suspensa_nao_grava_ins", "org_suspensa_nao_grava_upd", "org_suspensa_nao_grava_del"] as const;

/** As três tabelas medidas: como inserir, e a coluna de texto que o UPDATE troca. */
const TABELAS = {
  contacts: {
    inserir: (id: string, org: string) =>
      `insert into public.contacts (id, organization_id, name) values ('${id}', '${org}', 'Contato 9806')`,
    coluna: "name",
  },
  crm_pipelines: {
    inserir: (id: string, org: string) =>
      `insert into public.crm_pipelines (id, organization_id, name, slug) values ('${id}', '${org}', 'Funil 9806', 'f-${id.slice(-6)}')`,
    coluna: "name",
  },
  message_templates: {
    inserir: (id: string, org: string) =>
      `insert into public.message_templates (id, organization_id, title, body) values ('${id}', '${org}', 'Resposta 9806', 'Olá')`,
    coluna: "title",
  },
} as const;
type Tabela = keyof typeof TABELAS;
const NOMES = Object.keys(TABELAS) as Tabela[];

function existe(tabela: Tabela, id: string): boolean {
  return numero(`select count(*) from public.${tabela} where id = '${id}';`) === 1;
}

function texto(tabela: Tabela, id: string): string {
  return valor(`select ${TABELAS[tabela].coluna} from public.${tabela} where id = '${id}';`);
}

/** Quantas linhas a sessão alterou (RLS que filtra devolve 0, sem erro). */
function alterou(usuario: string, dml: string): number {
  return Number(valor(comoUsuario(usuario, `with w as (${dml} returning 1) select count(*) from w`)));
}

function suspender(org: string): void {
  // Como o servidor faz (fn_suspender_organizacao): pelo dono do banco.
  sql(`update public.organizations set status = 'suspended', suspended_kind = 'cobranca', suspended_at = now(),
              suspended_reason = 'fixture da 9806' where id = '${org}';`);
}

function reativar(org: string): void {
  sql(`update public.organizations set status = 'active', suspended_kind = null, suspended_at = null,
              suspended_reason = null where id = '${org}';`);
}

beforeAll(() => {
  criarUsuarios([
    [ADMIN, "admin-9806@invariant.test"],
    [DONO, "dono-9806@invariant.test"],
    [DONO_MEMBRO, "dono-membro-9806@invariant.test"],
    [DE_FORA, "de-fora-9806@invariant.test"],
  ]);
  for (const dono of [DONO, DONO_MEMBRO]) {
    sql(`insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason)
           values ('${dono}', '${dono}', 'full', false, 'fixture da 9806') on conflict do nothing;`);
  }
  for (const [org, slug] of [[ORG_SUSPENSA, "s9806-suspensa"], [ORG_ATIVA, "s9806-ativa"], [ORG_VAI_E_VOLTA, "s9806-volta"]] as const) {
    criarOrg(org, slug);
    sql(`insert into public.user_organizations (organization_id, user_id, role, accepted_at)
           values ('${org}', '${ADMIN}', 'admin', now()) on conflict do nothing;`);
  }
  sql(`insert into public.user_organizations (organization_id, user_id, role, accepted_at)
         values ('${ORG_SUSPENSA}', '${DONO_MEMBRO}', 'admin', now()) on conflict do nothing;`);

  // Uma linha de cada tabela em cada empresa, gravada ANTES da suspensão.
  NOMES.forEach((tabela, i) => {
    sql(`${TABELAS[tabela].inserir(linha(10 + i), ORG_SUSPENSA)};
         ${TABELAS[tabela].inserir(linha(20 + i), ORG_ATIVA)};`);
  });
  suspender(ORG_SUSPENSA);
});

describe.each(NOMES.map((t, i) => [t, i] as const))("%s — a sessão do admin de uma empresa suspensa", (tabela, i) => {
  it("CONTROLE: na empresa ATIVA o mesmo admin insere, altera e apaga", () => {
    expect(erroDe(comoUsuario(ADMIN, TABELAS[tabela].inserir(linha(30 + i), ORG_ATIVA)))).toBe("");
    expect(alterou(ADMIN, `update public.${tabela} set ${TABELAS[tabela].coluna} = 'mudou' where id = '${linha(30 + i)}'`)).toBe(1);
    expect(alterou(ADMIN, `delete from public.${tabela} where id = '${linha(30 + i)}'`)).toBe(1);
  });

  it("⭐ INSERT na empresa suspensa é recusado pela policy da 9806", () => {
    const e = erroDe(comoUsuario(ADMIN, TABELAS[tabela].inserir(linha(40 + i), ORG_SUSPENSA)));
    expect(e).toContain("42501");
    expect(e).toContain("org_suspensa_nao_grava_ins");
    expect(existe(tabela, linha(40 + i))).toBe(false);
  });

  it("⭐ UPDATE na empresa suspensa não alcança linha nenhuma, e o valor fica como estava", () => {
    const antes = texto(tabela, linha(10 + i));
    expect(alterou(ADMIN, `update public.${tabela} set ${TABELAS[tabela].coluna} = 'mudou' where id = '${linha(10 + i)}'`)).toBe(0);
    expect(texto(tabela, linha(10 + i))).toBe(antes);
  });

  it("⭐ DELETE na empresa suspensa não apaga nada", () => {
    expect(alterou(ADMIN, `delete from public.${tabela} where id = '${linha(10 + i)}'`)).toBe(0);
    expect(existe(tabela, linha(10 + i))).toBe(true);
  });

  it("⭐ mudar a linha DE uma empresa ativa PARA a suspensa também é recusado", () => {
    const e = erroDe(
      comoUsuario(ADMIN, `update public.${tabela} set organization_id = '${ORG_SUSPENSA}' where id = '${linha(20 + i)}'`),
    );
    expect(e).not.toBe("");
    expect(valor(`select organization_id from public.${tabela} where id = '${linha(20 + i)}';`)).toBe(ORG_ATIVA);
  });

  it("a LEITURA segue: o admin ainda enxerga a linha da empresa suspensa", () => {
    expect(valor(comoUsuario(ADMIN, `select count(*) from public.${tabela} where id = '${linha(10 + i)}'`))).toBe("1");
  });

  it("o SERVIDOR segue gravando na empresa suspensa (webhook de entrada, worker, cron)", () => {
    expect(erroDe(comoServidor(TABELAS[tabela].inserir(linha(50 + i), ORG_SUSPENSA)))).toBe("");
    expect(
      erroDe(comoServidor(`update public.${tabela} set ${TABELAS[tabela].coluna} = 'pelo servidor' where id = '${linha(50 + i)}'`)),
    ).toBe("");
    expect(texto(tabela, linha(50 + i))).toBe("pelo servidor");
    expect(erroDe(comoServidor(`delete from public.${tabela} where id = '${linha(50 + i)}'`))).toBe("");
  });
});

describe("quem continua podendo agir", () => {
  it("o dono da instalação (acesso total) grava na empresa suspensa pela sessão — sem vínculo e com vínculo", () => {
    expect(erroDe(comoUsuario(DONO, TABELAS.contacts.inserir(linha(60), ORG_SUSPENSA)))).toBe("");
    expect(alterou(DONO, `update public.contacts set name = 'pelo dono' where id = '${linha(60)}'`)).toBe(1);
    expect(erroDe(comoUsuario(DONO_MEMBRO, TABELAS.contacts.inserir(linha(61), ORG_SUSPENSA)))).toBe("");
    expect(alterou(DONO_MEMBRO, `delete from public.contacts where id = '${linha(61)}'`)).toBe(1);
  });

  it("a empresa ATIVA do mesmo admin não é afetada pela suspensão da outra", () => {
    expect(erroDe(comoUsuario(ADMIN, TABELAS.contacts.inserir(linha(62), ORG_ATIVA)))).toBe("");
  });

  it("reativar devolve a escrita na hora; suspender de novo a tira", () => {
    expect(erroDe(comoUsuario(ADMIN, TABELAS.contacts.inserir(linha(70), ORG_VAI_E_VOLTA)))).toBe("");
    suspender(ORG_VAI_E_VOLTA);
    expect(erroDe(comoUsuario(ADMIN, TABELAS.contacts.inserir(linha(71), ORG_VAI_E_VOLTA)))).toContain(
      "org_suspensa_nao_grava_ins",
    );
    reativar(ORG_VAI_E_VOLTA);
    expect(erroDe(comoUsuario(ADMIN, TABELAS.contacts.inserir(linha(72), ORG_VAI_E_VOLTA)))).toBe("");
    expect(existe("contacts", linha(71))).toBe(false);
  });

  it("LGPD nunca é bloqueada: lgpd_requests não recebe a trava", () => {
    expect(
      numero(`select count(*) from pg_policies where schemaname = 'public' and tablename = 'lgpd_requests'
               and policyname like 'org_suspensa_nao_grava_%';`),
    ).toBe(0);
  });
});

describe("a função que as policies leem", () => {
  it("devolve só as empresas suspensas DE QUEM PERGUNTA — não é lista da instalação", () => {
    expect(valor(comoUsuario(ADMIN, `select string_agg(x::text, ',') from public.fn_orgs_que_a_sessao_nao_grava() x`))).toBe(
      ORG_SUSPENSA,
    );
    expect(valor(comoUsuario(DE_FORA, `select count(*) from public.fn_orgs_que_a_sessao_nao_grava()`))).toBe("0");
    expect(valor(comoUsuario(DONO_MEMBRO, `select count(*) from public.fn_orgs_que_a_sessao_nao_grava()`))).toBe("0");
  });

  it("anon não a executa; a função que cria as policies não é RPC de nenhum papel da API", () => {
    expect(valor(`select has_function_privilege('anon', 'public.fn_orgs_que_a_sessao_nao_grava()', 'execute');`)).toBe("f");
    for (const papel of ["anon", "authenticated", "service_role"]) {
      expect(
        valor(`select has_function_privilege('${papel}', 'public.fn_aplicar_trava_de_org_suspensa()', 'execute');`),
        papel,
      ).toBe("f");
    }
  });
});

describe("cerca: toda tabela com organization_id que a sessão pode gravar tem a trava, verbo a verbo", () => {
  /**
   * `tabela:policy` para cada verbo que a tabela ABRE à sessão (policy
   * permissiva do verbo, ou `ALL`). Tabela que só o servidor grava não tem
   * policy de escrita — e tem de continuar sem.
   */
  const VERBOS = `(values ('org_suspensa_nao_grava_ins', 'INSERT'), ('org_suspensa_nao_grava_upd', 'UPDATE'),
                          ('org_suspensa_nao_grava_del', 'DELETE')) as v(nome, verbo)`;
  const DEVIDAS = `select c.relname as tabela, v.nome, v.verbo
           from pg_class c
           join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and a.attnum > 0 and not a.attisdropped
           cross join ${VERBOS}
          where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relname <> 'lgpd_requests'
            and exists (select 1 from pg_policies pp
                         where pp.schemaname = 'public' and pp.tablename = c.relname
                           and pp.permissive = 'PERMISSIVE' and pp.cmd in (v.verbo, 'ALL'))`;

  it("acha as tabelas (a cerca não pode passar por não ver nada)", () => {
    const tabelas = sql(`select distinct tabela from (${DEVIDAS}) d order by 1;`).split("\n").filter(Boolean);
    expect(tabelas.length).toBeGreaterThan(100);
    expect(tabelas).toEqual(expect.arrayContaining(["contacts", "conversations", "messages", "crm_leads", "channel_sessions"]));
  });

  it("nenhuma ficou de fora, e cada policy é RESTRICTIVE, do verbo certo, só para authenticated", () => {
    const faltando = sql(`select d.tabela || ':' || d.nome from (${DEVIDAS}) d
          where not exists (
              select 1 from pg_policies pp
               where pp.schemaname = 'public' and pp.tablename = d.tabela and pp.policyname = d.nome
                 and pp.permissive = 'RESTRICTIVE' and pp.cmd = d.verbo and pp.roles = array['authenticated']::name[])
          order by 1;`);
    expect(faltando).toBe("");
  });

  it("a tabela que só o servidor grava continua sem policy de escrita — a trava não inventa uma", () => {
    const sobrando = sql(`select pp.tablename || ':' || pp.policyname from pg_policies pp
          where pp.schemaname = 'public' and pp.policyname like 'org_suspensa_nao_grava_%'
            and not exists (select 1 from (${DEVIDAS}) d where d.tabela = pp.tablename and d.nome = pp.policyname)
          order by 1;`);
    expect(sobrando).toBe("");
  });

  it("tabela que nasce depois fica coberta ao chamar a função de novo — e num banco em dia ela não cria nada", () => {
    expect(valor(`select public.fn_aplicar_trava_de_org_suspensa();`)).toBe("0");
    sql(`create table public.sonda_9806 (id uuid primary key default gen_random_uuid(),
           organization_id uuid not null references public.organizations(id) on delete cascade);
         alter table public.sonda_9806 enable row level security;`);
    try {
      // Sem policy de escrita a tabela é só do servidor: nada a restringir.
      expect(valor(`select public.fn_aplicar_trava_de_org_suspensa();`)).toBe("0");
      sql(`create policy sonda_9806_escrita on public.sonda_9806 for all
             using (organization_id in (select public.fn_user_org_ids()))
             with check (organization_id in (select public.fn_user_org_ids()));`);
      expect(valor(`select public.fn_aplicar_trava_de_org_suspensa();`)).toBe(String(POLICIES.length));
      expect(
        numero(`select count(*) from pg_policies where schemaname = 'public' and tablename = 'sonda_9806'
                 and policyname = any (array['${POLICIES.join("','")}']);`),
      ).toBe(3);
      expect(valor(`select public.fn_aplicar_trava_de_org_suspensa();`)).toBe("0");
    } finally {
      sql(`drop table public.sonda_9806;`);
    }
  });
});
