import type { FlexibleSchema } from "ai";
import { countTokens } from "gpt-tokenizer/encoding/o200k_base";
import type { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  AGENT_TOOL_DEFS,
  SCHEDULE_FOLLOWUP_COM_NEGOCIO,
} from "@/lib/agent-engine/agent/inbound-turn";
import {
  ESQUEMA_SEM_PADRAO_PADRAO,
  esquemaParaOProvedor,
} from "@/lib/agent-engine/edge/llm/stable-prefix";
import { shapeToZodObject } from "@/lib/ai/runtime/tools";
import { allTools } from "@/lib/mcp/tools";

/**
 * CERCA DE PESO POR FERRAMENTA.
 *
 * Toda ferramenta do agente vai INTEIRA em todo passo do turno (nome, descrição e
 * esquema), e o peso cresce calado: uma frase a mais numa descrição, um `.uuid()`
 * que traz 100 tokens de regex. Medido em 2026-10-31: o catálogo pesava 30.518
 * tokens, e um terço era `pattern` e `$schema` gerados pelo zod.
 *
 * A régua é o que vai no fio: o esquema passa por `esquemaParaOProvedor` com o
 * default ÚNICO do knob (`ESQUEMA_SEM_PADRAO_PADRAO`, importado, nunca literal),
 * e conta com o tokenizer o200k_base (gpt-tokenizer, já dependência). Não é o
 * tokenizer de todo provedor — é uma régua estável para comparar consigo mesma.
 *
 * Reprova quando:
 *  - uma ferramenta não tem teto, ou um teto não tem ferramenta;
 *  - uma ferramenta passa do teto — suba o teto E reescreva o motivo;
 *  - uma ferramenta fica abaixo de 90% do teto — CATRACA: desça o teto no mesmo PR
 *    (é o que obriga a baixar os tetos no PR que virar o default do knob);
 *  - a soma passa de TETO_TOTAL.
 */

const BASE = "linha de base, medida quando a cerca nasceu (2026-10-31)";

const SUPERFICIE_DE_AGENTE =
  "capacidade nova (superfície de agente, PR 1): o agente externo e o nativo passam a registrar tarefa, nota, anexo e próxima ação por MCP; datas e responsável vão como texto e são conferidos no handler, para não pagar a expressão regular do zod";

const TETO: Readonly<Record<string, { tokens: number; motivo: string }>> = {
  "crm_list_event_types": { tokens: 227, motivo: "+23 de `tem_horarios`: sem a frase, o modelo escolhe um tipo de agenda sem horário publicado, ouve recusa e chama humano (ensaio de 17/11/2026)" },
  "crm_find_free_slots": { tokens: 930, motivo: "+71: aceita `event_type_id` ao lado do slug (campo sem `.uuid()`, para não pagar o pattern) e ensina a repetir a chamada com `tipos_validos` na recusa de tipo desconhecido" },
  "crm_list_appointments": { tokens: 1478, motivo: BASE },
  "crm_search_contacts": { tokens: 135, motivo: BASE },
  "crm_get_contact": { tokens: 188, motivo: BASE },
  "crm_propose_contact_field": { tokens: 438, motivo: BASE },
  "crm_list_conversations": { tokens: 283, motivo: BASE },
  "crm_get_conversation": { tokens: 228, motivo: BASE },
  "crm_get_conversation_history": { tokens: 246, motivo: "+22 da frase que avisa que cada mensagem traz `author` (cliente, ia, agente, equipe ou sistema) e `channel` (ajustes, AJ-2): sem ela o agente não sabe que pode separar o que a equipe disse do que a IA disse. +21 de `agente` e `is_self` (ajustes, AJ-4): sem a frase o agente externo não sabe que a própria fala vem marcada, e a confunde com a de outra integração" },
  "crm_get_queue_status": { tokens: 83, motivo: BASE },
  "crm_list_leads": { tokens: 602, motivo: "+11 (revisão 20/11, item 2.27): o campo `tag` diz que a comparação ignora caixa, para o modelo não repetir a busca em cada grafia; +91 de cinco filtros (ajustes, AJ-2): criados desde, na etapa atual desde, sem atividade desde, com tag e sem tag. Os instantes vão como texto sem `.min()`/`.max()` e são conferidos no handler, para não pagar a expressão regular do zod" },
  "crm_get_lead": { tokens: 202, motivo: BASE },
  "crm_list_pipelines": { tokens: 63, motivo: BASE },
  "crm_get_pipeline_forecast": { tokens: 263, motivo: BASE },
  "crm_search_knowledge": { tokens: 250, motivo: BASE },
  "crm_list_knowledge_sources": { tokens: 86, motivo: BASE },
  "crm_list_improvement_proposals": { tokens: 85, motivo: BASE },
  "crm_get_org_memory": { tokens: 114, motivo: BASE },
  "crm_save_org_memory": { tokens: 285, motivo: BASE },
  "crm_list_contact_orders": { tokens: 234, motivo: BASE },
  "crm_search_products": { tokens: 362, motivo: BASE },
  "crm_get_honorarios_contrato": { tokens: 253, motivo: BASE },
  "crm_list_honorarios_parcelas": { tokens: 222, motivo: BASE },
  "crm_preparar_proposta": { tokens: 132, motivo: BASE },
  "crm_describe_external_data": { tokens: 300, motivo: BASE },
  "crm_query_external_data": { tokens: 641, motivo: BASE },
  "crm_consultar_receita": { tokens: 403, motivo: BASE },
  "crm_list_privacy_requests": { tokens: 248, motivo: BASE },
  "crm_get_prospecting_site_audit": { tokens: 220, motivo: BASE },
  "crm_list_stages": { tokens: 255, motivo: BASE },
  "crm_list_tags": { tokens: 111, motivo: BASE },
  "crm_list_message_templates": { tokens: 146, motivo: BASE },
  "crm_render_message_template": { tokens: 597, motivo: BASE },
  "crm_list_webhook_sources": { tokens: 82, motivo: BASE },
  "crm_list_webhook_source_events": { tokens: 229, motivo: BASE },
  "crm_list_automation_rules": { tokens: 99, motivo: BASE },
  "crm_list_automation_runs": { tokens: 229, motivo: BASE },
  "crm_list_team_members": { tokens: 154, motivo: BASE },
  "crm_list_followups": { tokens: 472, motivo: BASE },
  "crm_list_at_risk_leads": {
    tokens: 255,
    motivo:
      "+6 da dica do argumento (o contact_id do item), devolvida quando o nome da ferramenta de retorno saiu da descrição: o Operador e o MCP externo dependem dela",
  },
  "crm_list_available_attendants": { tokens: 179, motivo: BASE },
  "crm_list_human_cases": { tokens: 149, motivo: BASE },
  "crm_get_human_case": { tokens: 208, motivo: BASE },
  "crm_find_and_book_appointment": { tokens: 1115, motivo: "+87: aceita `event_type_id` ao lado do slug (campo sem `.uuid()`) e ensina a repetir a chamada com `tipos_validos` — a recusa de tipo desconhecido fazia o agente chamar humano (ensaio de 17/11/2026)" },
  "crm_book_appointment": { tokens: 1203, motivo: BASE },
  "crm_reschedule_appointment": { tokens: 572, motivo: BASE },
  "crm_cancel_appointment": { tokens: 275, motivo: BASE },
  "crm_confirm_appointment": { tokens: 318, motivo: BASE },
  "crm_set_appointment_outcome": { tokens: 263, motivo: BASE },
  "crm_create_lead": { tokens: 933, motivo: BASE },
  "crm_update_lead": { tokens: 817, motivo: BASE },
  "crm_move_lead_stage": { tokens: 380, motivo: BASE },
  "crm_retomar_lead": { tokens: 394, motivo: BASE },
  "crm_propose_lead_fields_from_document": { tokens: 583, motivo: BASE },
  "crm_send_whatsapp_message": { tokens: 281, motivo: BASE },
  "crm_start_conversation_and_send": { tokens: 593, motivo: BASE },
  "crm_create_conversation_draft": { tokens: 411, motivo: BASE },
  "crm_set_conversation_sector": { tokens: 383, motivo: "capacidade nova (#3881): a triagem da IA escolhe a FILA da conversa; a descrição precisa nomear os setores de exemplo e as recusas, senão o modelo tenta resolver fila com crm_assign_conversation (que é dono, não setor)" },
  "crm_assign_conversation": { tokens: 380, motivo: "+26 da frase que diz ao modelo que atribuir não interrompe o próprio turno e pode ir junto com a passagem (#3926, veio da main)" },
  "crm_manage_tags": { tokens: 229, motivo: BASE },
  "crm_create_stage": { tokens: 212, motivo: BASE },
  "crm_update_stage": { tokens: 611, motivo: BASE },
  "crm_archive_stage": { tokens: 454, motivo: BASE },
  "crm_create_webhook_source": { tokens: 363, motivo: BASE },
  "crm_set_webhook_source_active": { tokens: 199, motivo: BASE },
  "crm_set_automation_rule_active": { tokens: 232, motivo: BASE },
  "crm_schedule_followup": { tokens: 539, motivo: BASE },
  "crm_enroll_followup_flow": { tokens: 365, motivo: BASE },
  "crm_cancel_followup": { tokens: 254, motivo: BASE },
  "crm_close_demand": { tokens: 244, motivo: BASE },
  "crm_propose_reactivation": { tokens: 204, motivo: BASE },
  "crm_add_case_note": { tokens: 216, motivo: BASE },
  "crm_close_human_case": { tokens: 246, motivo: BASE },
  "crm_resume_ai_attendance": { tokens: 228, motivo: BASE },
  "crm_draft_proposal": { tokens: 1059, motivo: BASE },
  "crm_request_human_handoff": { tokens: 583, motivo: BASE },
  "crm_list_tasks": { tokens: 431, motivo: SUPERFICIE_DE_AGENTE },
  "crm_create_task": { tokens: 441, motivo: SUPERFICIE_DE_AGENTE },
  "crm_complete_task": { tokens: 206, motivo: SUPERFICIE_DE_AGENTE },
  "crm_update_task": { tokens: 240, motivo: SUPERFICIE_DE_AGENTE },
  "crm_list_lead_notes": { tokens: 325, motivo: SUPERFICIE_DE_AGENTE },
  "crm_add_lead_note": { tokens: 247, motivo: SUPERFICIE_DE_AGENTE },
  "crm_list_lead_attachments": { tokens: 194, motivo: SUPERFICIE_DE_AGENTE },
  "crm_attach_to_lead": { tokens: 428, motivo: SUPERFICIE_DE_AGENTE },
  "crm_set_next_action": { tokens: 233, motivo: SUPERFICIE_DE_AGENTE },
  "crm_get_proposal": { tokens: 338, motivo: "capacidade nova (superfície de agente, PR 2): o agente consulta status, validade, itens, valor e link do PDF de uma proposta; a descrição lista os status porque o modelo os recebe como estão no banco" },
  "crm_list_lead_events": { tokens: 494, motivo: "+24 (revisão 20/11, item 2.28): a descrição diz que a página pode vir vazia com `has_more` e que o autor `nao_registrado` da troca de responsável nunca casa o filtro `author`; capacidade nova (ajustes, AJ-2): a linha do tempo de um negócio ou de um funil por MCP, com filtro de período, tipo e autor. A descrição diz o que não entra (mensagem) e que a página pode vir menor que o limite, porque o modelo pararia de paginar numa página curta. +7 de `is_self` (ajustes, AJ-4): diz ao agente que a linha feita por ele vem marcada" },
  "crm_find_duplicate_contacts": { tokens: 201, motivo: "capacidade nova (ajustes, AJ-3): os grupos de contatos que parecem a mesma pessoa. A descrição diz que `nome_parecido` é sugestão e não prova, porque é o motivo que junta gente diferente" },
  "get_lead_context": { tokens: 46, motivo: BASE },
  "send_message": { tokens: 137, motivo: BASE },
  "update_lead_state": { tokens: 240, motivo: BASE },
  "schedule_followup": { tokens: 200, motivo: BASE },
  "save_lead_note": { tokens: 229, motivo: BASE },
  "get_lead_note": { tokens: 99, motivo: BASE },
  "search_knowledge": { tokens: 131, motivo: BASE },
  "request_human_handoff": { tokens: 510, motivo: BASE },
  "read_skill_reference": { tokens: 154, motivo: BASE },
  "open_human_case": { tokens: 384, motivo: BASE },
  "provide_case_update": { tokens: 102, motivo: BASE },
  "send_template": { tokens: 227, motivo: BASE },
  "schedule_followup (com negócio)": { tokens: 314, motivo: BASE },
};

const TETO_TOTAL = 34056;

const VARIANTE = "schedule_followup (com negócio)";

const FERRAMENTAS: ReadonlyArray<{
  chave: string;
  nome: string;
  description: string;
  schema: FlexibleSchema<unknown>;
}> = [
  ...allTools.map((t) => ({
    chave: t.name,
    nome: t.name,
    description: t.description,
    schema: shapeToZodObject(t.inputSchema as Record<string, z.ZodTypeAny>),
  })),
  ...Object.entries(AGENT_TOOL_DEFS).map(([nome, d]) => ({
    chave: nome,
    nome,
    description: d.description,
    schema: d.inputSchema,
  })),
  {
    chave: VARIANTE,
    nome: "schedule_followup",
    description: SCHEDULE_FOLLOWUP_COM_NEGOCIO.description,
    schema: SCHEDULE_FOLLOWUP_COM_NEGOCIO.inputSchema,
  },
];

async function medir(): Promise<Map<string, number>> {
  const medidas = new Map<string, number>();
  for (const f of FERRAMENTAS) {
    const parameters = await esquemaParaOProvedor(f.schema, { semPadrao: ESQUEMA_SEM_PADRAO_PADRAO });
    medidas.set(f.chave, countTokens(JSON.stringify({ name: f.nome, description: f.description, parameters })));
  }
  return medidas;
}

/** A tabela como ela deveria estar — vai na mensagem de erro, pronta para colar. */
function tabelaSugerida(medidas: Map<string, number>): string {
  const linhas = [...medidas].map(([chave, n]) => {
    const motivo = TETO[chave]?.motivo;
    return `  ${JSON.stringify(chave)}: { tokens: ${n}, motivo: ${motivo === undefined || motivo === BASE ? "BASE" : JSON.stringify(motivo)} },`;
  });
  const total = [...medidas.values()].reduce((a, b) => a + b, 0);
  return `\nconst TETO = {\n${linhas.join("\n")}\n};\nconst TETO_TOTAL = ${total};\n`;
}

describe("o peso de cada ferramenta tem teto", () => {
  it("guarda de vacuidade: a cerca alcança o catálogo, as nativas e a variante", async () => {
    const medidas = await medir();
    expect(medidas.size).toBeGreaterThan(50);
    expect(medidas.has("crm_list_appointments")).toBe(true);
    expect(medidas.has("send_message")).toBe(true);
    expect(medidas.has(VARIANTE)).toBe(true);
  });

  it("⭐ cada ferramenta cabe no próprio teto, e a catraca não deixa o teto sobrar", async () => {
    const medidas = await medir();
    const problemas: string[] = [];
    for (const [chave, n] of medidas) {
      const teto = TETO[chave];
      if (teto === undefined) problemas.push(`${chave}: sem teto (mede ${n})`);
      else if (n > teto.tokens)
        problemas.push(`${chave}: cresceu ${n - teto.tokens} (mede ${n}, teto ${teto.tokens}) — suba o teto E reescreva o motivo`);
      else if (n < 0.9 * teto.tokens)
        problemas.push(`${chave}: mede ${n}, abaixo de 90% do teto ${teto.tokens} — desça o teto`);
    }
    for (const chave of Object.keys(TETO)) {
      if (!medidas.has(chave)) problemas.push(`${chave}: teto sem ferramenta — apague a linha`);
    }
    expect(problemas, tabelaSugerida(medidas)).toEqual([]);
  });

  it("a soma cabe em TETO_TOTAL", async () => {
    const medidas = await medir();
    const total = [...medidas.values()].reduce((a, b) => a + b, 0);
    expect(total, tabelaSugerida(medidas)).toBeLessThanOrEqual(TETO_TOTAL);
  });
});
