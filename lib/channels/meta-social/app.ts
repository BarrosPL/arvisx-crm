/**
 * O app da Meta que a conexão direta usa — o MESMO da instalação.
 *
 * Não existe segundo cadastro: o App Secret e o verify token são os de
 * `platform_meta_app` (`../meta/app.ts`, banco primeiro, `.env` como piso), e o
 * que faltava para o login do Facebook era só o App ID, que é PÚBLICO (vai na
 * URL do diálogo de login) e por isso mora em claro na mesma linha
 * (`platform_meta_app.app_id`, migration 9800), com `META_APP_ID` do `.env` como
 * piso — a variável já existia no `.env.example` sem ninguém lê-la.
 *
 * Nunca lança: quem chama decide o que dizer ("o app da Meta não está
 * configurado nesta instalação") a partir de `motivo`.
 */
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

import { appDaMeta } from "../meta/app";

export type MotivoIndisponivel = "sem_app_id" | "sem_app_secret";

export interface AppDaConexaoDireta {
  appId: string | null;
  appSecret: string | null;
  verifyToken: string | null;
}

/** Só dígitos: é o formato do App ID, e o valor vai parar numa URL. */
export const FORMATO_DO_APP_ID = /^[0-9]{5,25}$/;

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function appIdDoBanco(): Promise<string | null> {
  try {
    const { data, error } = await createAdminClient()
      .from("platform_meta_app")
      .select("app_id")
      .eq("id", 1)
      .maybeSingle();
    // 42703 = coluna ainda não existe (banco sem a 9800): o `.env` assume.
    if (error) return null;
    const valor = texto((data as { app_id?: string | null } | null)?.app_id);
    return FORMATO_DO_APP_ID.test(valor) ? valor : null;
  } catch (erro) {
    logger.warn("[meta-social.app] leitura do App ID falhou; vale o .env", {
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return null;
  }
}

export async function appDaConexaoDireta(
  ambiente: Record<string, string | undefined> = process.env,
): Promise<AppDaConexaoDireta> {
  const { appSecret, verifyToken } = await appDaMeta();
  const doAmbiente = texto(ambiente.META_APP_ID);
  const appId = (await appIdDoBanco()) ?? (FORMATO_DO_APP_ID.test(doAmbiente) ? doAmbiente : null);
  return { appId, appSecret, verifyToken };
}

/** O que falta para o botão "Conectar" funcionar — vazio = pronto. Pura. */
export function oQueFaltaNoApp(app: AppDaConexaoDireta): MotivoIndisponivel[] {
  const falta: MotivoIndisponivel[] = [];
  if (!app.appId) falta.push("sem_app_id");
  if (!app.appSecret) falta.push("sem_app_secret");
  return falta;
}
