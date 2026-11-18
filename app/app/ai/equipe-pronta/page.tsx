import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { lerPerfil } from "@/lib/ai/equipe-pronta/instalar";
import { PAPEIS } from "@/lib/ai/equipe-pronta";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * IA › EQUIPE PRONTA (ArvisX, migration 9808) — a tela dos quatro agentes
 * prontos do plano que a libera.
 *
 * Esta é a porta e o estado: o que é a equipe, se já foi instalada e em que
 * modo está. O questionário em passos, a revisão do texto de cada agente, o
 * checklist e os botões de instalar, ativar e pausar entram na entrega
 * seguinte, sobre as rotas de `/api/v1/ai/equipe-pronta` que já existem.
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
  let linha: Awaited<ReturnType<typeof lerPerfil>> = null;
  let leituraFalhou = false;
  try {
    linha = await lerPerfil(getRequestPool(), activeOrg.orgId);
  } catch (erro) {
    leituraFalhou = true;
    logger.error("[equipe-pronta] leitura do perfil falhou", {
      organization_id: activeOrg.orgId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
  }

  const instalada = linha?.estado === "instalado";
  const situacao = leituraFalhou
    ? t("Não foi possível ler o estado da equipe agora. Recarregue em instantes.")
    : !instalada
      ? t("A equipe ainda não foi instalada nesta empresa.")
      : linha?.modo === "ativo"
        ? t("A equipe está instalada e ativa: atende todos os contatos do canal.")
        : t("A equipe está instalada em ensaio: só os telefones de teste falam com ela.");

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

      <Card className="max-w-2xl p-4" role="status" data-testid="equipe-pronta-situacao">
        <p className="text-sm">{situacao}</p>
      </Card>

      <ul className="grid max-w-4xl gap-3 sm:grid-cols-2" data-testid="equipe-pronta-papeis">
        {PAPEIS.map((papel) => (
          <li key={papel.id}>
            <Card className="h-full space-y-1 p-4">
              <h2 className="text-sm font-semibold">{t(papel.nomePadrao)}</h2>
              <p className="text-sm text-muted-foreground">{t(papel.descricao)}</p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
