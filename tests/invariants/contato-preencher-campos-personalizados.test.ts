import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_ORG, seedGov, sql } from "./gov-helpers";

/**
 * CAMPO PERSONALIZADO DO CONTATO: O AGENTE PREENCHE NO BANCO, SÓ ONDE ESTÁ VAZIO
 * (migration 9820).
 *
 * Revisão de 20/11, item 2.3. `crm_update_contact` lia `contacts.custom_fields`,
 * juntava as chaves novas na memória e regravava o mapa inteiro: duas escritas
 * no mesmo contato terminavam com a segunda apagando a chave da primeira. E o
 * agente trocava um valor que já estava no cadastro pelo texto que o cliente
 * mandou na conversa.
 *
 * `fn_contato_preencher_campos_personalizados` faz a mescla com a linha
 * travada, grava só a chave vazia e devolve os nomes: os que gravou e os que já
 * tinham outro valor. Nunca devolve valor.
 */
const CONTATO = "cccccccc-9820-4000-8000-000000000001";
const ANONIMIZADO = "cccccccc-9820-4000-8000-000000000002";
const OUTRA_ORG = "cccccccc-9820-4000-8000-0000000000f1";

const preencher = (campos: string, contato = CONTATO, org = GOV_ORG): string =>
  sql(
    `select coalesce(public.fn_contato_preencher_campos_personalizados('${org}', '${contato}', '${campos}'::jsonb)::text, 'nulo');`,
  );

const gravado = (contato = CONTATO): Record<string, unknown> =>
  JSON.parse(sql(`select custom_fields::text from public.contacts where id = '${contato}';`)) as Record<string, unknown>;

beforeAll(() => {
  seedGov();
});

beforeEach(() => {
  sql(`
    delete from public.contacts where id in ('${CONTATO}', '${ANONIMIZADO}');
    insert into public.contacts (id, organization_id, display_name, custom_fields)
    values
      ('${CONTATO}', '${GOV_ORG}', 'Contato 9820',
        '{"origem":"indicacao","plano":"basico","vazio_texto":"","vazio_nulo":null}'::jsonb),
      ('${ANONIMIZADO}', '${GOV_ORG}', 'Cliente Anonimizado #9820', '{}'::jsonb);
    update public.contacts set is_anonymized = true, anonymized_at = now() where id = '${ANONIMIZADO}';
  `);
});

describe("fn_contato_preencher_campos_personalizados", () => {
  it("grava a chave ausente e a que está vazia; o resto do mapa fica como estava", () => {
    const r = JSON.parse(preencher(`{"renda":"10 mil","vazio_texto":"agora tem","vazio_nulo":7}`)) as Record<string, string[]>;
    expect(r.gravados).toEqual(["renda", "vazio_nulo", "vazio_texto"]);
    expect(r.ja_preenchidos).toEqual([]);
    expect(gravado()).toEqual({
      origem: "indicacao",
      plano: "basico",
      renda: "10 mil",
      vazio_texto: "agora tem",
      vazio_nulo: 7,
    });
  });

  it("⭐ campo já preenchido com OUTRO valor não é trocado, e o nome dele volta", () => {
    const r = JSON.parse(preencher(`{"plano":"premium","renda":"10 mil"}`)) as Record<string, string[]>;
    expect(r.gravados).toEqual(["renda"]);
    expect(r.ja_preenchidos).toEqual(["plano"]);
    expect(gravado().plano).toBe("basico");
  });

  it("valor igual ao que já está não é escrita nem recusa", () => {
    const antes = sql(`select updated_at::text from public.contacts where id = '${CONTATO}';`);
    const r = JSON.parse(preencher(`{"plano":"basico"}`)) as Record<string, string[]>;
    expect(r).toEqual({ gravados: [], ja_preenchidos: [] });
    expect(sql(`select updated_at::text from public.contacts where id = '${CONTATO}';`)).toBe(antes);
  });

  it("valor vazio que chega não apaga nem grava nada", () => {
    const r = JSON.parse(preencher(`{"plano":"","origem":null,"novo":""}`)) as Record<string, string[]>;
    expect(r).toEqual({ gravados: [], ja_preenchidos: [] });
    expect(gravado()).toMatchObject({ origem: "indicacao", plano: "basico" });
    expect(gravado()).not.toHaveProperty("novo");
  });

  it("⭐ a resposta só tem nomes de chave: nem o valor que estava, nem o que entrou", () => {
    const r = preencher(`{"plano":"premium-secreto","renda":"valor-secreto"}`);
    expect(r).not.toContain("basico");
    expect(r).not.toContain("premium-secreto");
    expect(r).not.toContain("valor-secreto");
  });

  it("⭐ duas escritas seguidas em chaves diferentes: nenhuma apaga a outra (a mescla lê o que está gravado, não uma cópia)", () => {
    preencher(`{"renda":"10 mil"}`);
    preencher(`{"profissao":"medica"}`);
    expect(gravado()).toMatchObject({ origem: "indicacao", plano: "basico", renda: "10 mil", profissao: "medica" });
  });

  it("⭐ a leitura do mapa trava a linha (`for update`): quem tirar a trava reabre a perda de escrita", () => {
    // A corrida de verdade pede duas conexões ao mesmo tempo, que este arnês
    // (um psql por chamada) não abre. O que se guarda aqui é a trava no corpo
    // da função: sem ela, duas chamadas simultâneas leriam o mesmo mapa.
    expect(
      sql(
        `select pg_get_functiondef(p.oid) ilike '%for update%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'fn_contato_preencher_campos_personalizados';`,
      ),
    ).toBe("t");
  });

  it("contato de outra organização, contato inexistente e contato anonimizado: nulo, nada gravado", () => {
    expect(preencher(`{"renda":"x"}`, CONTATO, OUTRA_ORG)).toBe("nulo");
    expect(preencher(`{"renda":"x"}`, "cccccccc-9820-4000-8000-0000000000ee")).toBe("nulo");
    expect(preencher(`{"renda":"x"}`, ANONIMIZADO)).toBe("nulo");
    expect(gravado()).not.toHaveProperty("renda");
    expect(gravado(ANONIMIZADO)).toEqual({});
  });

  it("o que não é objeto não grava nada", () => {
    expect(JSON.parse(preencher(`["a","b"]`))).toEqual({ gravados: [], ja_preenchidos: [] });
    expect(JSON.parse(preencher(`"texto"`))).toEqual({ gravados: [], ja_preenchidos: [] });
  });

  it("⭐ só o servidor chama: nem a chave anônima nem a sessão de um usuário executam", () => {
    const assinatura = "public.fn_contato_preencher_campos_personalizados(uuid, uuid, jsonb)";
    expect(sql(`select has_function_privilege('anon', '${assinatura}', 'execute');`)).toBe("f");
    expect(sql(`select has_function_privilege('authenticated', '${assinatura}', 'execute');`)).toBe("f");
    expect(sql(`select has_function_privilege('service_role', '${assinatura}', 'execute');`)).toBe("t");
    expect(() =>
      sql(`
        set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${GOV_AGENT_A}"}', false);
        select public.fn_contato_preencher_campos_personalizados('${GOV_ORG}', '${CONTATO}', '{"renda":"x"}'::jsonb);
      `),
    ).toThrow(/permission denied/);
  });
});
