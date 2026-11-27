/**
 * QUEM PAGA O MODELO DO VIX — UMA chave da instalação: `VIX_PAGADOR`.
 *
 * É, ao mesmo tempo, a chave GERAL de ligar e desligar o assistente e a
 * escolha do pagador:
 *
 *   `desligado`              o padrão. Vale também com a chave ausente ou com
 *                            valor desconhecido (falha fechada). O botão some
 *                            e as rotas recusam.
 *   `hermes`                 o Vix raciocina no Hermes (perfil `vix-crm`, Claude
 *                            pela assinatura da plataforma) e o CRM executa.
 *   `chave_plataforma`       um modelo pequeno pela chave de API da instalação.
 *
 * Editada em Painel › Configuração, por quem administra a instalação. Um
 * pagador novo é um arquivo novo nesta pasta e um valor novo aqui.
 *
 * SEM QUEDA entre pagadores: o que foi escolhido é o único tentado.
 */
import { valorDaInstalacao } from "@/lib/instalacao/config";
import type { createAdminClient } from "@/lib/supabase/admin";

import { chaveDaPlataforma } from "./chave-da-plataforma";
import { hermesDaPlataforma } from "./hermes";
import { PAGADORES, type Pagador, type ProvedorDoVix } from "./tipos";

/** O pagador em vigor. Ausente, ilegível ou desconhecido = `desligado`. */
export async function pagadorDoVix(): Promise<Pagador> {
  const bruto = ((await valorDaInstalacao("VIX_PAGADOR")).valor ?? "").trim().toLowerCase();
  return (PAGADORES as readonly string[]).includes(bruto) ? (bruto as Pagador) : "desligado";
}

/** O provedor do pagador escolhido, pronto para chamar, ou o motivo de não estar. */
export async function provedorDoVix(_admin?: ReturnType<typeof createAdminClient>): Promise<ProvedorDoVix> {
  const pagador = await pagadorDoVix();
  switch (pagador) {
    case "hermes":
      return hermesDaPlataforma();
    case "chave_plataforma":
      return chaveDaPlataforma();
    default:
      return { disponivel: false, pagador: "desligado", motivo: "desligado" };
  }
}

export type { MotivoDeIndisponibilidade, Pagador, ProvedorDoVix, ProvedorPronto, UsoDeTokens } from "./tipos";
