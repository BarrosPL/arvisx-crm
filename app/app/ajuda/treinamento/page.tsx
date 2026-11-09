import { requireAuth } from "@/lib/auth/server";
import { buscar, indiceDeBusca } from "@/lib/ajuda/treinamento/busca";
import { treinamento } from "@/lib/ajuda/treinamento/conteudo";
import { menuDoTreinamento } from "@/lib/ajuda/treinamento/menu";

import { InicioDoTreinamento } from "./_componentes/Inicio";

export const dynamic = "force-dynamic";

export default async function TreinamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  await requireAuth();
  const { q } = await searchParams;
  const consulta = (Array.isArray(q) ? q[0] : q)?.trim().slice(0, 120) ?? "";
  const dados = treinamento();
  const resultados = consulta ? buscar(indiceDeBusca(dados), consulta) : null;
  return (
    <InicioDoTreinamento
      consulta={consulta}
      resultados={resultados}
      menu={menuDoTreinamento(dados.modulos).map((g) => ({
        ...g,
        modulos: g.modulos.map((m) => ({
          ...m,
          resumo: dados.modulos.find((d) => d.id === m.id)?.resumo ?? "",
        })),
      }))}
      nichos={dados.nichos.map((n) => ({
        id: n.id,
        titulo: n.titulo,
        resumo: n.resumo,
        jornadas: n.jornadas.map((j) => ({ id: j.id, titulo: j.titulo })),
      }))}
    />
  );
}
