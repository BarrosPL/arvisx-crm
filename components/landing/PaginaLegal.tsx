import Image from "next/image";
import Link from "next/link";

import { traduzir } from "@/lib/i18n/dicionario";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";

import "@/app/landing.css";

/**
 * Moldura das páginas legais da vitrine (/termos-de-uso,
 * /privacidade-e-cookies e /exclusao-de-dados): topo com o logo e "Voltar ao início", coluna de
 * leitura e rodapé com o copyright. Mesma paleta escura da landing (`.lp-doc`
 * em app/landing.css).
 *
 * O idioma é o de quem visita (`idiomaDoVisitante`), o mesmo das páginas que ela
 * emoldura: sem sessão, vale o `Accept-Language` do navegador.
 */
export async function PaginaLegal({ children }: { children: React.ReactNode }) {
  const locale = await idiomaDoVisitante(null);
  const t = (texto: string) => traduzir(texto, locale);

  return (
    <div className="lp-doc">
      <header className="topo">
        <Link className="marca" href="/" aria-label={t("Arvisx CRM, início")}>
          <Image src="/marca/arvisx-crm-escuro.png" alt="Arvisx CRM" width={715} height={85} />
        </Link>
        <Link className="btn" href="/">
          {t("Voltar ao início")}
        </Link>
      </header>

      <main className="doc">{children}</main>

      <footer className="rodape">
        <div className="miolo">
          <span>{t("© 2026 Arvisx AI. Todos os direitos reservados.")}</span>
          <nav aria-label="Legal">
            <Link href="/termos-de-uso">{t("Termos de uso")}</Link>
            <Link href="/privacidade-e-cookies">{t("Privacidade e cookies")}</Link>
            <Link href="/exclusao-de-dados">{t("Exclusão de dados")}</Link>
            <Link href="/">{t("Início")}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
