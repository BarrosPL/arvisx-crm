/**
 * GET /api/v1/contacts/duplicates — quem é a MESMA pessoa cadastrada duas vezes.
 *
 * A detecção é PURA (`lib/contacts/duplicados.ts`) e roda no servidor, pela
 * varredura de `lib/contacts/varredura-de-duplicados.ts`, sobre os contatos
 * vivos que a RLS deixa o usuário ver. Não é um
 * `select` esperto: os três índices únicos parciais de `contacts` já impedem
 * duas linhas ativas com a MESMA string, então o que sobra para o produto é a
 * grafia diferente do mesmo número (o nono dígito) e o telefone que a ingestão
 * do WhatsApp parkou em `source_metadata.telefone_em_conflito`. Nenhum dos dois
 * é comparação de igualdade, e é por isso que a regra vive em TypeScript
 * testável em vez de virar SQL que ninguém relê.
 *
 * Há um segundo motivo, que NÃO é igualdade: `nome_parecido` (Spec 31). Ele vem
 * DEPOIS dos fortes, com o mesmo formato, e é sugestão para conferir — o nome
 * sozinho não prova nada. Os pares que a pessoa dispensou ("não são a mesma
 * empresa") saem da lista para todo papel, porque a leitura da dispensa usa o
 * cliente administrador, filtrado pela organização da sessão.
 *
 * `viewer` pode LISTAR (é leitura de contato, que ele já enxerga na tabela);
 * quem funde é `manager`, e esse gate está na rota de POST /contacts/merge.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser } from "@/lib/auth/server";
import { orgAtivaDaApi } from "@/lib/auth/require-role";
import { varrerContatosDuplicados } from "@/lib/contacts/varredura-de-duplicados";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();

  const user = await loadAuthUser();
  if (!user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }
  const ativa = await orgAtivaDaApi(user, requestId);
  if (!ativa.ok) return ativa.response;
  const org = ativa.org;
  if (!org) {
    const t = (texto: string) => traduzir(texto, user.idioma);
    return fail("forbidden_tenant", t("Organização ativa não resolvida."), 403, { requestId });
  }

  // A varredura (páginas, teto, dispensas e detecção) mora em
  // `lib/contacts/varredura-de-duplicados.ts`, que o agente também usa. Aqui os
  // contatos são lidos com o cliente da SESSÃO, para a RLS valer, e as dispensas
  // com o cliente administrador, filtrado pela organização da sessão.
  const varredura = await varrerContatosDuplicados(
    { contatos: await createClient(), dispensas: createAdminClient() },
    org.orgId,
  );
  if (!varredura.ok) {
    if (varredura.etapa === "contatos") {
      return fail("internal_error", varredura.mensagem, 500, { requestId });
    }
    // Sem o detalhe do erro na resposta: a mensagem do banco não é para quem opera a tela.
    return fail("internal_error", "Não foi possível ler as dispensas de duplicados.", 500, {
      requestId,
    });
  }

  return ok(
    varredura.grupos.map(({ grupo, principalSugerido }) => ({
      chave: grupo.chave,
      motivos: grupo.motivos,
      principal_sugerido: principalSugerido,
      contatos: grupo.contatos.map((c) => ({
        id: c.id,
        name: c.name,
        display_name: c.display_name,
        address_book_name: c.address_book_name ?? null,
        email: c.email,
        phone_number: c.phone_number,
        created_at: c.created_at,
        last_activity_at: c.last_activity_at,
      })),
    })),
    {
      requestId,
      meta: { varreu_tudo: varredura.varreuTudo, contatos_varridos: varredura.contatosVarridos },
    },
  );
}
