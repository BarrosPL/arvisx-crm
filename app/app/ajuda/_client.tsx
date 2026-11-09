"use client";

import Link from "next/link";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { blocosVisiveis } from "@/lib/ajuda/hub";
import { destinosDaInterface } from "@/lib/navigation/interface";

export function AjudaConteudo({
  atualizacaoPelaTela = false,
}: {
  /**
   * ArvisX: `ATUALIZACAO_PELA_TELA=on` no servidor (lido em `page.tsx`).
   * Desligado (padrão), o atalho do instalador não aparece: a tela dá 404.
   */
  atualizacaoPelaTela?: boolean;
} = {}) {
  const t = useT();
  const { user, activeOrg } = useAuth();
  // O mesmo contexto enriquecido pelo layout e a mesma régua do Sidebar.
  // Arrays vazios são intencionais: undefined desligaria esses filtros.
  const destinos = destinosDaInterface(
    activeOrg?.interface_settings,
    user.is_platform_admin && !user.support,
    activeOrg?.role ?? null,
    activeOrg?.modulos_ligados ?? [],
    activeOrg?.capacidades_ligadas ?? [],
  );
  // A leitura de Atualização aceita plataforma também em suporte; não é o
  // bypass de papel dos atalhos regulares (settings/atualizacao/page.tsx).
  const blocos = blocosVisiveis(user.is_platform_admin && atualizacaoPelaTela, destinos);
  // ArvisX: o treinamento do cliente segue a mesma régua (é item do catálogo).
  const treinamento = destinos.find((d) => d.href === "/app/ajuda/treinamento");

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Ajuda")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "O caminho para cada tarefa, e onde ir quando algo não sai como esperado.",
          )}
        </p>
      </header>

      {treinamento && (
        <Link
          href="/app/ajuda/treinamento"
          data-testid="ajuda-treinamento"
          className="flex min-h-11 flex-col gap-1 rounded-lg border border-[var(--color-brand)] bg-[var(--color-cta-leve)] p-4 text-[var(--color-cta-fg)] hover:bg-[var(--color-cta-leve)]/70"
        >
          <span className="text-base font-semibold">{t(treinamento.label)}</span>
          <span className="text-sm">{t(treinamento.description)}</span>
        </Link>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {blocos.map((bloco) => (
          <section key={bloco.titulo} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t(bloco.titulo)}
            </h2>
            <ul className="flex flex-col divide-y rounded-lg border">
              {bloco.itens.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    data-testid={`ajuda-${item.href.replace(/\//g, "-")}`}
                    className="flex min-h-11 flex-col gap-0.5 p-3 hover:bg-muted/50"
                  >
                    <span className="text-sm font-medium">{t(item.texto)}</span>
                    <span className="text-xs text-muted-foreground">{t(item.detalhe)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
