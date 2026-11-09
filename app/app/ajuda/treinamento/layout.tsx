import { requireAuth } from "@/lib/auth/server";
import { treinamento } from "@/lib/ajuda/treinamento/conteudo";
import { menuDoTreinamento } from "@/lib/ajuda/treinamento/menu";

import { CascaDoTreinamento } from "./_componentes/Casca";

/**
 * O TREINAMENTO DO CLIENTE dentro da Ajuda: lições passo a passo com a foto de
 * cada tela, histórias por nicho e busca. Conteúdo em `content/ajuda-curso/`
 * (ver `lib/ajuda/treinamento/conteudo.ts`). Porta autenticada, como a Ajuda.
 */
export const dynamic = "force-dynamic";

export default async function TreinamentoLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  const dados = treinamento();
  return (
    <CascaDoTreinamento
      menu={menuDoTreinamento(dados.modulos)}
      nichos={dados.nichos.map((n) => ({ id: n.id, titulo: n.titulo, jornadas: n.jornadas.length }))}
    >
      {children}
    </CascaDoTreinamento>
  );
}
