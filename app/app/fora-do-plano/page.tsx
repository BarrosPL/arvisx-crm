import Link from "next/link";
import { headers } from "next/headers";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { roleAtLeast } from "@/lib/auth/types";
import { destinoDaPagina } from "@/lib/cobranca/rotas-do-plano";
import { traduzir } from "@/lib/i18n/dicionario";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";

export const dynamic = "force-dynamic";

/**
 * "ISSO NÃO ESTÁ NO SEU PLANO" (ArvisX, telas do plano — migration 9802).
 *
 * Não tem porta no menu de propósito: quem chega aqui é o `proxy.ts`, que
 * REESCREVE a página pedida para esta quando o plano da empresa não a libera
 * (a URL da barra continua a que a pessoa pediu). O caminho original chega pelo
 * `x-pathname`, gravado pelo proxy antes do rewrite, e dá o nome da tela.
 *
 * Nunca um 404 mudo: diz o que falta, que os dados continuam guardados, e o
 * caminho — a tela de assinatura para quem administra; para os outros, quem
 * pode resolver.
 */
export default async function ForaDoPlanoPage() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);
  const caminho = (await headers()).get("x-pathname") ?? "";
  const destino = destinoDaPagina(caminho);
  const tela = destino ? NAV_CATALOG.find((d) => d.href === destino) : undefined;
  const administra = !!org && (roleAtLeast(org.role, "admin") || (user.is_platform_admin && !user.support));

  return (
    <div className="flex h-full items-start justify-center p-6">
      <Card className="w-full max-w-xl space-y-4 p-6" role="status" data-testid="fora-do-plano">
        <h1 className="text-xl font-semibold tracking-tight">{t("Isso não está no seu plano")}</h1>
        <p className="text-sm text-muted-foreground">
          {tela
            ? t("A tela {tela} não faz parte do plano da sua empresa.").replace("{tela}", t(tela.label))
            : t("Esta tela não faz parte do plano da sua empresa.")}{" "}
          {t("Nada foi apagado: o que já existe continua guardado e volta quando o plano incluir esta tela.")}
        </p>
        {administra ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/app/settings/billing">{t("Ver planos e assinatura")}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/app">{t("Voltar ao início")}</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">{t("Peça a quem administra a empresa para mudar o plano.")}</p>
            <Button asChild variant="outline">
              <Link href="/app">{t("Voltar ao início")}</Link>
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
