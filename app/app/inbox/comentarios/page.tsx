import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ComentariosClient } from "@/components/comentarios/ComentariosClient";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Comentários" };

/**
 * Comentários do Instagram — a tela da equipe humana.
 *
 * Mora DENTRO do Atendimento (`/app/inbox/comentarios`) e não tem item próprio
 * no menu: o menu lateral está no limite medido (`tests/e2e/navegacao.spec.ts`),
 * e comentário é uma entrada de conversa como a mensagem direta. Chega-se por
 * dois atalhos: o do Inbox (`AtalhoDosComentarios`, para gerente e
 * administrador, quando a empresa tem a conexão direta) e o do cartão do
 * Instagram em Conexões. Como filha do Inbox, herda o plano dele.
 *
 * Gerente para cima — o mesmo papel que as rotas `/api/v1/social-comments`
 * exigem (`app/api/v1/social-comments/_borda.ts`). Quem recusa de verdade é a
 * rota; o redirecionamento daqui só evita uma tela que só devolveria 403.
 *
 * Quem administra a PLATAFORMA sem ter papel de gerente nesta empresa NÃO vê a
 * tela (decisão da revisão de 20/11/2026, item 2.25): as rotas exigem o papel
 * na empresa e recusariam tudo com 403. O comentário é texto de gente de fora,
 * dado da empresa; a porta é a mesma para todos, o papel na empresa. Se o
 * papel mudar com a tela aberta, ela mostra "sem permissão" em vez do 403 cru
 * (`ComentariosClient`).
 */
export default async function ComentariosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  const podeVer = !!activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  if (!podeVer) redirect("/app/inbox");
  const idioma = user.idioma;
  const pedido = (await searchParams).canal;
  const canal =
    typeof pedido === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pedido)
      ? pedido
      : null;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Comentários", idioma)}</h1>
          <p className="text-sm text-muted-foreground">
            {traduzir(
              "O que as pessoas comentaram nas publicações do Instagram, e o que já foi respondido em público e em privado.",
              idioma,
            )}
          </p>
        </div>
        <Link className="text-sm text-primary underline underline-offset-4" href="/app/inbox">
          {traduzir("Voltar ao Inbox", idioma)}
        </Link>
      </header>
      <ComentariosClient canalInicial={canal} />
    </div>
  );
}
