/**
 * O EQUIPE COMPLETA DEPOIS DO PAGAMENTO (ArvisX, tarefa 2 dos planos; migration 9804).
 *
 * O plano com `inclui_agentes_arvisx` é o Premium mais 4 agentes de IA que a
 * equipe cria para a empresa depois da assinatura. O CRM não cria nem liga
 * agente nenhum. O que ele faz:
 *
 *  - o gatilho `fn_cobranca_equipe_completa_marcar` grava uma linha em
 *    `cobranca_equipe_completa` quando o pagamento é confirmado (entrada) ou o
 *    plano troca para um sem os agentes (saída), e emite
 *    `cobranca.equipe_completa` no `event_log`;
 *  - o handler daqui manda o e-mail aos platform admins (melhor esforço, como o
 *    aviso de troca de chave) e marca `equipe_avisada_em`;
 *  - /admin/cobranca lista o que aguarda contato, e a equipe marca o contato;
 *  - a tela de assinatura do cliente diz que o contato vem aí enquanto não foi
 *    marcado.
 *
 * A LISTA é a fonte: e-mail que não sai (SMTP desligado, nenhum dono) não
 * perde o aviso, e não volta à fila — `skipped`, nunca `error`, para não abrir
 * `event_dead` na Central da EMPRESA por um problema da instalação.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { avisarEquipeCompleta } from "@/lib/cobranca/emails";
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

export interface AvisoDaEquipeCompleta {
  id: string;
  organization_id: string;
  tipo: "entrada" | "saida";
  plano_nome: string;
  criado_em: string;
  equipe_avisada_em: string | null;
  contatado_em: string | null;
}

const COLUNAS = "id, organization_id, tipo, plano_nome, criado_em, equipe_avisada_em, contatado_em";

/**
 * A empresa espera o contato da equipe? Sim quando a linha mais nova dela é uma
 * ENTRADA ainda não marcada como contatada. Nunca lança: falha = não mostra a
 * mensagem (melhor calar do que prometer contato que não se pode confirmar).
 */
export async function aguardaContatoDaEquipe(db: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await db
    .from("cobranca_equipe_completa")
    .select("tipo, contatado_em")
    .eq("organization_id", orgId)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return false;
  const linha = data as { tipo: string; contatado_em: string | null };
  return linha.tipo === "entrada" && linha.contatado_em === null;
}

/** O que aguarda contato, o mais antigo primeiro, com o nome da empresa. LANÇA se a leitura falhar. */
export async function listarAguardandoContato(
  admin: SupabaseClient,
): Promise<Array<AvisoDaEquipeCompleta & { empresa: string }>> {
  const { data, error } = await admin
    .from("cobranca_equipe_completa")
    .select(COLUNAS)
    .is("contatado_em", null)
    .order("criado_em", { ascending: true })
    .limit(100);
  if (error) throw new Error(`equipe completa: leitura falhou (${error.code ?? "sem_codigo"})`);
  const avisos = (data ?? []) as AvisoDaEquipeCompleta[];
  const nomes = await nomesDasEmpresas(admin, [...new Set(avisos.map((a) => a.organization_id))]);
  return avisos.map((a) => ({ ...a, empresa: nomes.get(a.organization_id) ?? a.organization_id }));
}

async function nomesDasEmpresas(admin: SupabaseClient, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await admin.from("organizations").select("id, display_name").in("id", ids);
  // Nome da EMPRESA (organizations), não de contato: sem nome, o id.
  const empresas = (data ?? []) as Array<{ id: string; display_name: string | null }>;
  return new Map(empresas.map(({ id, display_name: nome }) => [id, nome ?? id]));
}

const CONSUMER_KEY = "cobranca.equipe_completa";
const resultado = (status: HandlerResult["status"], detail?: string): HandlerResult => ({ consumer_key: CONSUMER_KEY, status, detail });

/**
 * O aviso por e-mail. O `aviso_id` vem do payload, mas a linha é relida
 * filtrando a organização do EVENTO: um `emit_event` forjado por um membro, com
 * id de outra empresa ou inventado, não acha nada. Linha já avisada não manda
 * de novo.
 */
export async function avisarPeloEvento(row: EventRow, admin: SupabaseClient = createAdminClient()): Promise<HandlerResult> {
  const avisoId = (row.payload as { aviso_id?: unknown } | null)?.aviso_id;
  if (typeof avisoId !== "string") return resultado("skipped", "sem_aviso_id");
  const { data, error } = await admin
    .from("cobranca_equipe_completa")
    .select(COLUNAS)
    .eq("id", avisoId)
    .eq("organization_id", row.organization_id)
    .maybeSingle();
  if (error) return resultado("error", `leitura do aviso falhou: ${error.code ?? "sem_codigo"}`);
  if (!data) return resultado("skipped", "aviso_desconhecido");
  const aviso = data as AvisoDaEquipeCompleta;
  if (aviso.equipe_avisada_em !== null) return resultado("skipped", "ja_avisada");
  const nome = (await nomesDasEmpresas(admin, [aviso.organization_id])).get(aviso.organization_id) ?? aviso.organization_id;
  const sairam = await avisarEquipeCompleta(admin, { empresa: nome, plano: aviso.plano_nome, tipo: aviso.tipo });
  if (sairam === 0) return resultado("skipped", "email_nao_saiu_fica_na_lista");
  await admin.from("cobranca_equipe_completa").update({ equipe_avisada_em: new Date().toISOString() }).eq("id", aviso.id);
  return resultado("ok", `${aviso.tipo}:${sairam}`);
}

export const equipeCompletaHandler: EventHandler = {
  key: CONSUMER_KEY,
  // Sai para fora (e-mail). Empresa parada: o evento é pulado, e o aviso segue na
  // lista de /admin/cobranca, que é a fonte.
  naOrgParada: "pula",
  events: ["cobranca.equipe_completa"],
  handle: (row) => avisarPeloEvento(row),
};
