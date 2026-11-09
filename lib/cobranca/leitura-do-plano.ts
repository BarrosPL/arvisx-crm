/**
 * A leitura do plano da organização, UMA vez por requisição (ArvisX, migration 9802).
 *
 * `resolveActiveOrg` (páginas), `requireRole`/`resolveAuthDual` (API) e quem mais
 * perguntar na mesma requisição dividem a mesma ida ao banco. Usa o cliente de
 * serviço porque `fn_telas_do_plano` só é concedida ao service_role; o `orgId`
 * vem sempre de fonte confiável (cookie validado contra o vínculo, token, job).
 * Nunca lança — ver `lerTelasDoPlano`.
 */
import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/admin";
import { lerTelasDoPlano, type LeituraDoPlano } from "./telas-do-plano";

export const leituraDoPlanoDaOrg = cache(async (orgId: string): Promise<LeituraDoPlano> => {
  try {
    return await lerTelasDoPlano(createAdminClient(), orgId);
  } catch {
    // `createAdminClient` sem as variáveis de ambiente lança; a régua não.
    return { tipo: "falha" };
  }
});
