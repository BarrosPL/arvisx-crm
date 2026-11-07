import { notFound } from "next/navigation";

/**
 * ArvisX: o showcase de design do upstream fica BLOQUEADO. Toda a rota `/design`
 * (e as sub-rotas) responde 404.
 *
 * Por quê: é o showcase interno do design system (nome do produto, "ArvisX CRM", no `<h1>`),
 * e a rota é pública (sem login). Uma tela pública com a marca do upstream não pode
 * ir ao ar na instalação da Arvisx.
 *
 * Por que bloquear em vez de apagar a pasta: `app/design/lib/tokens.ts` (as
 * paletas) é importado por `tests/unit/barra-de-rolagem-do-tema.test.ts` e é a
 * origem documentada das paletas de `lib/extensions/tema.ts`, e apagar a pasta
 * daria conflito a cada atualização do upstream. O `notFound()` aqui corta o
 * render antes de qualquer filho (a `page.tsx` e as seções nem chegam a rodar).
 *
 * Para reabrir em desenvolvimento, remova a chamada abaixo e restaure o layout do
 * upstream (`git show upstream/main:app/design/layout.tsx`).
 */
export default function DesignLayout({ children }: { children: React.ReactNode }) {
  void children;
  notFound();
}
