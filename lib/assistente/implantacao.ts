/**
 * A IMPLANTAÇÃO DA CONTA: o que a empresa já montou no CRM e o que falta.
 *
 * É a base do acompanhamento do Vix nos primeiros dias: em vez de o cliente
 * escolher um "modo", o servidor lê o estado real da conta e entrega ao Vix,
 * como DADO, o que já está pronto. O Vix conduz a pessoa pelo próximo passo.
 *
 * Só leitura e só CONTAGEM (nenhum conteúdo de contato, conversa ou agente sai
 * daqui), sempre filtrada pela organização. Nenhum passo grava nada. Falha de leitura de um passo não
 * derruba os outros: o passo vira "desconhecido" e o Vix não afirma nada sobre
 * ele.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { listarConexoesCaidas } from "@/lib/channels/health";

export const PASSOS_DA_IMPLANTACAO = ["canal", "agente", "agente_publicado", "conhecimento", "contatos", "equipe"] as const;
export type PassoDaImplantacao = (typeof PASSOS_DA_IMPLANTACAO)[number];

export type SituacaoDoPasso = "feito" | "pendente" | "desconhecido";

/** O nome que a PESSOA vê, nunca o de tabela. O prompt usa este texto. */
export const ROTULO_DO_PASSO: Record<PassoDaImplantacao, string> = {
  canal: "Conectar um canal de atendimento (WhatsApp, Instagram etc.)",
  agente: "Criar o primeiro agente de IA",
  agente_publicado: "Publicar o agente para ele começar a atender",
  conhecimento: "Dar conhecimento ao agente (o que ele precisa saber sobre a empresa)",
  contatos: "Ter contatos no CRM (importados ou vindos das conversas)",
  equipe: "Convidar a equipe",
};

export interface Implantacao {
  passos: { passo: PassoDaImplantacao; situacao: SituacaoDoPasso }[];
  /** Todos os passos conhecidos estão feitos. */
  completa: boolean;
  feitos: number;
  total: number;
}

async function contar(consulta: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> {
  try {
    const { count, error } = await consulta;
    return error ? null : (count ?? 0);
  } catch {
    return null;
  }
}

const situacao = (n: number | null): SituacaoDoPasso => (n === null ? "desconhecido" : n > 0 ? "feito" : "pendente");

export async function lerImplantacao(db: SupabaseClient, orgId: string): Promise<Implantacao> {
  const [canaisTotal, caidas, agentes, publicados, conhecimento, contatos, equipe] = await Promise.all([
    contar(
      db
        .from("channel_sessions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .is("archived_at", null),
    ),
    listarConexoesCaidas(db, orgId)
      .then((l) => l.length)
      .catch(() => null),
    contar(
      db
        .from("ai_agents")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .is("archived_at", null),
    ),
    contar(
      db
        .from("ai_agents")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .is("archived_at", null)
        .not("published_version_id", "is", null),
    ),
    contar(
      db
        .from("ai_knowledge_sources")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("is_active", true),
    ),
    contar(db.from("contacts").select("id", { count: "exact", head: true }).eq("organization_id", orgId)),
    contar(
      db
        .from("user_organizations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .is("revoked_at", null),
    ),
  ]);

  const conectados = canaisTotal === null || caidas === null ? null : Math.max(0, canaisTotal - caidas);
  const situacoes: Record<PassoDaImplantacao, SituacaoDoPasso> = {
    canal: situacao(conectados),
    agente: situacao(agentes),
    agente_publicado: situacao(publicados),
    conhecimento: situacao(conhecimento),
    contatos: situacao(contatos),
    // A pessoa que criou a conta já é um membro: "equipe" só conta com mais de um.
    equipe: equipe === null ? "desconhecido" : equipe > 1 ? "feito" : "pendente",
  };
  const passos = PASSOS_DA_IMPLANTACAO.map((passo) => ({ passo, situacao: situacoes[passo] }));
  const feitos = passos.filter((p) => p.situacao === "feito").length;
  return {
    passos,
    feitos,
    total: passos.length,
    completa: passos.every((p) => p.situacao !== "pendente"),
  };
}

/** O bloco do prompt: o que está pronto e o que falta, em palavras da pessoa. */
export function descreverImplantacao(i: Implantacao): string {
  const linha = (p: Implantacao["passos"][number]) =>
    `- ${ROTULO_DO_PASSO[p.passo]}: ${p.situacao === "feito" ? "pronto" : p.situacao === "pendente" ? "FALTA" : "não consegui conferir"}`;
  return i.passos.map(linha).join("\n");
}
