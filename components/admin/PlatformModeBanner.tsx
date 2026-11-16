"use client";
import Link from "next/link";
import { Buildings } from "@/lib/ui/icons";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { useT } from "@/hooks/i18n/useT";

/**
 * Sticky top banner that signals the user is operating in cross-tenant
 * Platform mode. Persistent visual cue to prevent accidental destructive
 * actions when the operator forgets which surface they're in.
 *
 * ── Por que a troca de tema mora AQUI ────────────────────────────────────────
 *
 * O `AdminShell` tem uma barra de topo nas duas larguras desde que ganhou a
 * busca (⌘K): no celular ela leva o menu, a marca e a busca; no desktop, só a
 * busca. A troca de tema continua nesta tarja, que é o elemento do topo que
 * diz em que superfície a pessoa está — e a catraca
 * `admin-tem-troca-de-tema.test.tsx` vigia que ela siga aqui.
 *
 * ── Por que as cores são token e não `amber-*` ───────────────────────────────
 *
 * A versão anterior usava `bg-amber-100 border-amber-300 text-amber-900`, cru
 * do Tailwind e portanto FIXO: a tarja não acompanhava claro e escuro, e num
 * tema escuro ela virava uma faixa clara gritando no topo. Depois ela usou os
 * tokens de `warning`, os mesmos do `Badge variant="warning"`.
 *
 * No design "Folha" (11/2026) a tarja é a TINTA escura do produto
 * (`accent-600`, a mesma nos dois temas) com texto branco: âmbar passou a
 * querer dizer só aviso, e o modo plataforma não é um aviso, é um lugar.
 *
 * Continuam DOIS elementos, como no tempo do `--color-warning-bg` translúcido:
 * o de fora dá o fundo opaco da página, o de dentro dá a cor da tarja. Hoje a
 * tinta é opaca e um só bastaria; o de fora fica para a tarja seguir tampando o
 * que rola por baixo se a cor voltar a ser translúcida. Sem `backdrop-blur`,
 * que é anti-pattern nº 5.
 */
export function PlatformModeBanner() {
  const t = useT();
  return (
    <div role="region" aria-label={t("Modo Plataforma")} className="sticky top-0 z-40 w-full bg-bg">
      <div className="flex h-10 w-full items-center justify-between bg-accent-600 px-4 text-white">
        <div className="flex items-center gap-2 text-xs">
          <Buildings size={18} weight="fill" aria-hidden />
          <span className="font-semibold tracking-tight">{t("MODO PLATAFORMA")}</span>
          <span className="hidden opacity-80 sm:inline">{t("— operação cross-tenant")}</span>
        </div>
        <div className="flex items-center gap-1">
          {/* 40px de tarja não comportam os 44px de alvo de toque do `size="icon"`.
              O mesmo já valia para o link ao lado, que é `text-xs`: quem opera o
              modo plataforma está num desktop, com cursor. */}
          <ThemeToggle className="h-7 w-7 text-white hover:bg-white/10 hover:text-white lg:h-7 lg:w-7" />
          <Link
            href="/app"
            className="rounded-md px-2 py-1 text-xs font-medium underline-offset-2 hover:underline"
          >
            {t("Sair pra app pessoal")}
          </Link>
        </div>
      </div>
    </div>
  );
}
