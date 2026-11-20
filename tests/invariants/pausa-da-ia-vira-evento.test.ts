/**
 * 9811 — a pausa e a retomada da IA numa conversa viram evento.
 *
 * O gatilho `trg_anunciar_pausa_da_ia` olha o estado da linha de
 * `conversations`, então vale para todo escritor. Aqui ele é exercitado pelos
 * caminhos de verdade: a função nativa de assumir (`fn_conversation_assign`) e
 * a escrita direta do silêncio (o que a rota de pausar, a resposta pela tela e
 * a passagem do agente fazem).
 *
 * Roda no PostgreSQL descartável de `scripts/test-db.sh`, com o baseline
 * inteiro. Não mede a entrega do webhook (isso é do motor de automações, com
 * os testes dele).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { sql } from "./psql-transporte";

const ORG = "98110001-0000-4000-8000-000000000001";
const OUTRA_ORG = "98110001-0000-4000-8000-000000000011";
const CONTATO = "98110001-0000-4000-8000-000000000002";
const CANAL = "98110001-0000-4000-8000-000000000003";
const CONVERSA = "98110001-0000-4000-8000-000000000004";
const GRUPO = "98110001-0000-4000-8000-000000000006";
const ATENDENTE = "98110001-0000-4000-8000-000000000005";
const OUTRO_ATENDENTE = "98110001-0000-4000-8000-000000000007";

function ultimaLinha(saida: string): string {
  return saida.trim().split("\n").at(-1) ?? "";
}
function numero(consulta: string): number {
  return Number(ultimaLinha(sql(consulta)));
}
const eventos = (tipo: string, conversa = CONVERSA) =>
  numero(
    `select count(*) from public.event_log where organization_id='${ORG}' and event_type='${tipo}' and entity_kind='conversation' and entity_id='${conversa}';`,
  );
/** O payload do evento mais recente daquele tipo, como JSON. */
function ultimoPayload(tipo: string): Record<string, unknown> {
  const linha = ultimaLinha(
    sql(
      `select payload::text from public.event_log where organization_id='${ORG}' and event_type='${tipo}' and entity_id='${CONVERSA}' order by created_at desc, id desc limit 1;`,
    ),
  );
  return JSON.parse(linha) as Record<string, unknown>;
}
function assumir(quem: string | null, motivo = "claim") {
  sql(
    `select public.fn_conversation_assign('${ORG}', '${CONVERSA}', ${quem ? `'${quem}'` : "null"}, '${motivo}', null, false);`,
  );
}
const silenciar = (ate: string | null, conversa = CONVERSA) =>
  sql(
    `update public.conversations set bot_silenced_until=${ate === null ? "null" : `${ate}`} where organization_id='${ORG}' and id='${conversa}';`,
  );

beforeAll(() => {
  sql(`insert into auth.users (id,email) values
      ('${ATENDENTE}', 'pausa-9811-a@invariant.test'), ('${OUTRO_ATENDENTE}', 'pausa-9811-b@invariant.test') on conflict do nothing;
    insert into public.organizations (id,slug,legal_name,display_name) values
      ('${ORG}','pausa-9811','Pausa','Pausa'), ('${OUTRA_ORG}','pausa-9811-outra','Outra','Outra') on conflict do nothing;
    insert into public.user_organizations (user_id,organization_id,role,accepted_at) values
      ('${ATENDENTE}','${ORG}','agent',now()), ('${OUTRO_ATENDENTE}','${ORG}','agent',now()) on conflict do nothing;
    insert into public.contacts (id,organization_id,display_name) values ('${CONTATO}','${ORG}','Cliente fictício') on conflict do nothing;
    insert into public.channel_sessions (id,organization_id,waha_session_name,webhook_secret_encrypted)
      values ('${CANAL}','${ORG}','pausa-9811','\\x00'::bytea) on conflict do nothing;
    insert into public.conversations (id,organization_id,contact_id,channel_session_id,status) values
      ('${CONVERSA}','${ORG}','${CONTATO}','${CANAL}','open') on conflict do nothing;
    insert into public.conversations (id,organization_id,contact_id,channel_session_id,status,is_group) values
      ('${GRUPO}','${ORG}','${CONTATO}','${CANAL}','open',true) on conflict do nothing;`);
});

beforeEach(() => {
  sql(`update public.conversations set assigned_to_user_id=null, assignee_kind=null, bot_silenced_until=null,
         last_handoff_at=null, status='open' where organization_id='${ORG}';
    delete from public.event_log where organization_id='${ORG}' and event_type in ('conversation.ai_paused','conversation.ai_resumed');`);
});

describe("a pausa da IA vira evento", () => {
  it("assumir a conversa grava ai_paused: sem prazo, com dono, e não é renovação", () => {
    assumir(ATENDENTE);
    expect(eventos("conversation.ai_paused")).toBe(1);
    expect(ultimoPayload("conversation.ai_paused")).toEqual({
      conversation_id: CONVERSA,
      contact_id: CONTATO,
      channel_session_id: CANAL,
      paused_until: null,
      durable: true,
      human_assigned: true,
      renewed: false,
    });
    expect(eventos("conversation.ai_resumed")).toBe(0);
  });

  it("silêncio com prazo (uma pessoa respondeu): ai_paused leva a hora da volta", () => {
    silenciar("now() + interval '5 minutes'");
    const payload = ultimoPayload("conversation.ai_paused");
    expect(payload).toMatchObject({ durable: false, human_assigned: false, renewed: false });
    const ate = new Date(String(payload.paused_until)).getTime();
    expect(ate).toBeGreaterThan(Date.now() + 3 * 60_000);
    expect(ate).toBeLessThan(Date.now() + 7 * 60_000);
  });

  it("renovar o prazo grava outro ai_paused, marcado como renovação", () => {
    silenciar("now() + interval '5 minutes'");
    silenciar("now() + interval '10 minutes'");
    expect(eventos("conversation.ai_paused")).toBe(2);
    expect(ultimoPayload("conversation.ai_paused")).toMatchObject({ renewed: true, durable: false });
  });

  it("trocar o dono de uma conversa já assumida avisa de novo (renovação), sem ai_resumed no meio", () => {
    assumir(ATENDENTE);
    assumir(OUTRO_ATENDENTE, "transfer");
    expect(eventos("conversation.ai_paused")).toBe(2);
    expect(ultimoPayload("conversation.ai_paused")).toMatchObject({ renewed: true, human_assigned: true });
    expect(eventos("conversation.ai_resumed")).toBe(0);
  });

  it("escrever o MESMO estado não grava nada (uma regra só não se realimenta)", () => {
    silenciar("'infinity'");
    silenciar("'infinity'");
    sql(`update public.conversations set last_message_preview='oi' where organization_id='${ORG}' and id='${CONVERSA}';`);
    expect(eventos("conversation.ai_paused")).toBe(1);
  });
});

describe("a retomada da IA vira evento", () => {
  it("devolver ao automático (limpar o silêncio e o dono) grava ai_resumed", () => {
    assumir(ATENDENTE);
    sql(`select public.fn_conversation_assign('${ORG}', '${CONVERSA}', null, 'release', null, false);
      update public.conversations set bot_silenced_until=null, assignee_kind='ai' where organization_id='${ORG}' and id='${CONVERSA}';`);
    expect(eventos("conversation.ai_resumed")).toBe(1);
    expect(ultimoPayload("conversation.ai_resumed")).toEqual({
      conversation_id: CONVERSA,
      contact_id: CONTATO,
      channel_session_id: CANAL,
    });
  });

  it("limpar um silêncio que JÁ tinha vencido não é retomada: a IA já tinha voltado", () => {
    silenciar("now() - interval '1 minute'");
    silenciar(null);
    expect(eventos("conversation.ai_paused")).toBe(0);
    expect(eventos("conversation.ai_resumed")).toBe(0);
  });
});

describe("o que o gatilho não faz", () => {
  it("conversa de grupo não emite: o automático nunca a atende", () => {
    silenciar("'infinity'", GRUPO);
    expect(eventos("conversation.ai_paused", GRUPO)).toBe(0);
  });

  it("o evento nasce pendente, para o motor de automações consumir", () => {
    assumir(ATENDENTE);
    expect(
      numero(
        `select count(*) from public.event_log where organization_id='${ORG}' and event_type='conversation.ai_paused' and status='pending';`,
      ),
    ).toBe(1);
  });

  it("o evento é da organização da conversa: a outra organização não ganha linha", () => {
    assumir(ATENDENTE);
    expect(
      numero(
        `select count(*) from public.event_log where organization_id='${OUTRA_ORG}' and event_type like 'conversation.ai_%';`,
      ),
    ).toBe(0);
  });

  it("a função do gatilho não é chamável por ninguém pela API", () => {
    for (const papel of ["anon", "authenticated", "service_role"]) {
      expect(
        ultimaLinha(sql(`select has_function_privilege('${papel}', 'public.fn_anunciar_pausa_da_ia()', 'EXECUTE');`)),
      ).toBe("f");
    }
  });
});
