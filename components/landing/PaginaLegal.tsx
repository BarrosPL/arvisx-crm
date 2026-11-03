import Image from "next/image";
import Link from "next/link";

import "@/app/landing.css";

/**
 * Moldura das páginas legais da vitrine (/termos-de-uso e
 * /privacidade-e-cookies): topo com o logo e "Voltar ao início", coluna de
 * leitura e rodapé com o copyright. Mesma paleta escura da landing (`.lp-doc`
 * em app/landing.css).
 */
export function PaginaLegal({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp-doc">
      <header className="topo">
        <Link className="marca" href="/" aria-label="Arvisx CRM, início">
          <Image src="/marca/arvisx-crm-escuro.png" alt="Arvisx CRM" width={715} height={85} />
        </Link>
        <Link className="btn" href="/">
          Voltar ao início
        </Link>
      </header>

      <main className="doc">{children}</main>

      <footer className="rodape">
        <div className="miolo">
          <span>© 2026 Arvisx AI. Todos os direitos reservados.</span>
          <nav aria-label="Legal">
            <Link href="/termos-de-uso">Termos de uso</Link>
            <Link href="/privacidade-e-cookies">Privacidade e cookies</Link>
            <Link href="/">Início</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
