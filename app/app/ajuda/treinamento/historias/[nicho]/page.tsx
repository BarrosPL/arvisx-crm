import { notFound } from "next/navigation";

import { requireAuth } from "@/lib/auth/server";
import { treinamento } from "@/lib/ajuda/treinamento/conteudo";

import { ConteudoDoNicho } from "../../_componentes/Nicho";

export const dynamic = "force-dynamic";

export default async function NichoDoTreinamentoPage({
  params,
}: {
  params: Promise<{ nicho: string }>;
}) {
  await requireAuth();
  const { nicho: id } = await params;
  const dados = treinamento();
  const nicho = dados.nichos.find((n) => n.id === id);
  if (!nicho) notFound();
  // Só o que os links das histórias precisam: tela (visibilidade) e títulos.
  const licoes = Object.fromEntries(
    dados.modulos.map((m) => [
      m.id,
      {
        titulo: m.titulo,
        tela: m.tela,
        licoes: Object.fromEntries(m.licoes.map((l) => [l.id, l.titulo])),
      },
    ]),
  );
  return <ConteudoDoNicho nicho={nicho} licoes={licoes} />;
}
