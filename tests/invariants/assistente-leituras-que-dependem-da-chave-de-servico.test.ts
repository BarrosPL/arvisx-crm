import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LEITURAS_MCP } from "@/lib/assistente/capacidades/mcp";
import { abrirAcesso } from "@/lib/external-db/acesso";
import { moduloLigado } from "@/lib/instalacao/modulos";

import { subirPostgrest, type PostgrestEfemero } from "../db/postgrest-efemero";
import { GOV_MANAGER, GOV_ORG, seedGov, sql } from "./gov-helpers";

/**
 * POR QUE QUATRO LEITURAS FICARAM FORA DO CATÁLOGO DO VIX: A MEDIDA.
 *
 * O Vix lê com o cliente da SESSÃO (RLS), nunca com a chave de serviço. Quatro
 * ferramentas de leitura do MCP perguntam, antes de ler, se um módulo da
 * instalação está ligado, e fazem essa pergunta com o cliente que receberam:
 *
 *   crm_query_external_data, crm_describe_external_data, crm_consultar_receita
 *     → `abrirAcesso(ctx.supabase, …)` → `moduloLigado(…, "banco_externo")`
 *   crm_get_proposal (e crm_preparar_proposta)
 *     → o módulo "propostas", pela mesma leitura.
 *
 * O módulo mora em `platform_config`, tabela sem policy: a sessão não a lê. O
 * efeito, medido aqui com os dois módulos LIGADOS de verdade no banco:
 *
 *   - com a chave de serviço, o módulo aparece ligado (controle);
 *   - com a sessão de um GERENTE da empresa, o mesmo módulo aparece desligado,
 *     e `abrirAcesso` recusa com `modulo_desligado` antes de olhar a conexão.
 *
 * Com o cliente de sessão essas leituras respondem sempre "módulo desligado".
 * Por isso estão fora do catálogo, e este arquivo trava que não entrem sem que
 * essa dependência seja resolvida.
 */

let rest: PostgrestEfemero;

beforeAll(async () => {
  seedGov();
  sql(`
    insert into public.platform_config (chave, valor, eh_segredo, semeado_do_env) values
      ('MODULO_BANCO_EXTERNO', 'ligado', false, false),
      ('MODULO_PROPOSTAS', 'ligado', false, false)
    on conflict (chave) do update set valor = excluded.valor;
  `);
  rest = await subirPostgrest();
}, 240_000);

afterAll(() => rest?.derrubar());

describe("o módulo da instalação só é legível pela chave de serviço", () => {
  it.each(["banco_externo", "propostas"] as const)("%s: ligado para a chave de serviço (controle), desligado para a sessão", async (modulo) => {
    expect(await moduloLigado(await rest.clienteDeServico(), modulo)).toBe(true);
    expect(await moduloLigado(await rest.clienteDeSessao(GOV_MANAGER), modulo)).toBe(false);
  });

  it("abrirAcesso com a sessão recusa por 'modulo_desligado'; com a chave de serviço passa dessa porta", async () => {
    const conexaoQualquer = "a1770000-aaaa-4000-8000-000000000001";
    const comSessao = await abrirAcesso(await rest.clienteDeSessao(GOV_MANAGER), GOV_ORG, conexaoQualquer);
    expect(comSessao).toEqual({ ok: false, motivo: "modulo_desligado" });
    const comServico = await abrirAcesso(await rest.clienteDeServico(), GOV_ORG, conexaoQualquer);
    expect(comServico.ok).toBe(false);
    // Passou da porta do módulo: a recusa agora é outra (a conexão não existe).
    expect((comServico as { motivo: string }).motivo).not.toBe("modulo_desligado");
  });
});

describe("continuam fora do catálogo", () => {
  it.each(["crm_query_external_data", "crm_describe_external_data", "crm_consultar_receita", "crm_get_proposal", "crm_preparar_proposta", "crm_list_privacy_requests"])(
    "%s não é capacidade do Vix",
    (nome) => {
      expect(LEITURAS_MCP.map((c) => c.nome)).not.toContain(nome);
    },
  );
});
