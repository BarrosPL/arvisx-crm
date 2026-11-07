/**
 * Nome e foto de quem escreve — pela API de perfil de cada rede.
 *
 * O webhook da Meta não traz o nome de ninguém: só o id (PSID no Messenger,
 * IGSID no Instagram). Sem esta consulta o contato nasceria sem nome e a Inbox
 * mostraria um número opaco. Os campos são os que cada rede libera para a
 * página com `pages_messaging` / `instagram_manage_messages`:
 *
 *   Messenger: first_name, last_name, profile_pic
 *   Instagram: name, username, profile_pic
 *
 * Best-effort: perfil fechado, conta apagada ou falta de permissão devolvem
 * `null`, e a ingestão segue sem nome.
 */
import { chamarGraph } from "./graph";
import type { RedeDireta } from "./webhook";

export interface PerfilDoParticipante {
  nome: string | null;
  usuario: string | null;
  foto: string | null;
}

const SO_DIGITOS = /^[0-9]{1,40}$/;

export async function perfilDoParticipante(entrada: {
  rede: RedeDireta;
  participante: string;
  token: string;
  appSecret: string | null;
}): Promise<PerfilDoParticipante | null> {
  if (!SO_DIGITOS.test(entrada.participante)) return null;
  try {
    if (entrada.rede === "facebook") {
      const r = await chamarGraph<{ first_name?: string; last_name?: string; profile_pic?: string }>(
        entrada.participante,
        {
          token: entrada.token,
          appSecret: entrada.appSecret,
          query: { fields: "first_name,last_name,profile_pic" },
          timeoutMs: 5_000,
        },
      );
      const nome = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
      return { nome: nome || null, usuario: null, foto: r.profile_pic ?? null };
    }
    const r = await chamarGraph<{ name?: string; username?: string; profile_pic?: string }>(entrada.participante, {
      token: entrada.token,
      appSecret: entrada.appSecret,
      query: { fields: "name,username,profile_pic" },
      timeoutMs: 5_000,
    });
    return {
      nome: r.name?.trim() || (r.username ? `@${r.username}` : null),
      usuario: r.username ?? null,
      foto: r.profile_pic ?? null,
    };
  } catch {
    return null;
  }
}
