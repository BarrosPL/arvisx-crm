import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { lerEstadoDaEquipe, type EstadoDaEquipe } from "@/lib/ai/equipe-pronta/estado";
import { lerOpcoesDaInstalacao, type OpcoesDaInstalacao } from "@/lib/ai/equipe-pronta/opcoes";
import { portasDoEstadoDeProducao } from "@/lib/ai/equipe-pronta/portas-do-estado";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

import { EquipeProntaClient } from "./_components/EquipeProntaClient";

export const dynamic = "force-dynamic";

/**
 * IA › EQUIPE PRONTA (ArvisX, migration 9808) — os quatro agentes prontos do
 * plano que libera esta tela.
 *
 * A página lê, no servidor, o estado da equipe e o que a empresa já tem para
 * escolher (canais, funis, tipos de agenda), e entrega ao cliente
 * (`EquipeProntaClient`), que mostra o questionário em passos ou o painel de
 * quem já instalou. Toda escrita passa pelas rotas de
 * `/api/v1/ai/equipe-pronta`; a página não grava nada.
 *
 * A trava de plano não mora aqui: quem não tem a tela no plano é reescrito
 * pelo `proxy.ts` para `/app/fora-do-plano` antes de chegar a esta página.
 */
export default async function EquipeProntaPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");
  const t = (texto: string) => traduzir(texto, user.idioma);

  // "Não consegui ler" e "ainda não instalou" não podem pintar a mesma tela: a
  // falha de leitura deixa rastro e a tela diz que não sabe.
  let estado: EstadoDaEquipe | null = null;
  let opcoes: OpcoesDaInstalacao | null = null;
  try {
    const pool = getRequestPool();
    [estado, opcoes] = await Promise.all([
      lerEstadoDaEquipe(pool, portasDoEstadoDeProducao(createAdminClient()), activeOrg.orgId),
      lerOpcoesDaInstalacao(pool, activeOrg.orgId),
    ]);
  } catch (erro) {
    logger.error("[equipe-pronta] leitura do estado falhou", {
      organization_id: activeOrg.orgId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Equipe pronta")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t(
            "Quatro agentes prontos: você responde um questionário sobre o seu negócio, instala, testa e ativa.",
          )}
        </p>
      </header>

      {estado && opcoes ? (
        <EquipeProntaClient
          estadoInicial={estado}
          opcoes={opcoes}
          administra={ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin}
        />
      ) : (
        <Card className="max-w-2xl p-4" role="status" data-testid="equipe-pronta-situacao">
          <p className="text-sm">
            {t("Não foi possível ler o estado da equipe agora. Recarregue em instantes.")}
          </p>
        </Card>
      )}
    </div>
  );
}
