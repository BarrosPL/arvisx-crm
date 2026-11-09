import { notFound } from "next/navigation";

import { requireAuth } from "@/lib/auth/server";
import { treinamento } from "@/lib/ajuda/treinamento/conteudo";

import { ConteudoDoModulo } from "../_componentes/Modulo";

export const dynamic = "force-dynamic";

export default async function ModuloDoTreinamentoPage({
  params,
}: {
  params: Promise<{ modulo: string }>;
}) {
  await requireAuth();
  const { modulo: id } = await params;
  const modulo = treinamento().modulos.find((m) => m.id === id);
  if (!modulo) notFound();
  return <ConteudoDoModulo modulo={modulo} />;
}
