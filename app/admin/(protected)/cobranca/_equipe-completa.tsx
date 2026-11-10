"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";

export interface AvisoDaTela {
  id: string;
  organization_id: string;
  empresa: string;
  tipo: "entrada" | "saida";
  plano_nome: string;
  criado_em: string;
  equipe_avisada_em: string | null;
}

/**
 * "Equipe Completa aguardando contato" (ArvisX, migration 9804): quem assinou
 * o plano com os agentes feitos sob medida — e quem saiu dele — esperando a
 * equipe. A lista é a fonte; o e-mail aos donos é melhor esforço. Marcar o
 * contato tira a linha daqui e a mensagem da tela da empresa.
 */
export function EquipeCompletaAguardandoContato({ avisos }: { avisos: readonly AvisoDaTela[] }) {
  const t = useT();
  const idioma = useIdioma();
  const router = useRouter();
  const [marcando, setMarcando] = useState<string | null>(null);
  const data = new Intl.DateTimeFormat(idioma, { dateStyle: "short", timeStyle: "short" });
  if (avisos.length === 0) return null;

  async function marcar(id: string) {
    setMarcando(id);
    try {
      await apiClient.patch(`/api/v1/admin/cobranca/equipe-completa/${id}`, { contatado: true });
      router.refresh();
    } catch (err) {
      showApiError(err);
    } finally {
      setMarcando(null);
    }
  }

  return (
    <section aria-labelledby="equipe-completa-aguardando" className="space-y-3 rounded-lg border border-cta/50 bg-cta-leve/40 p-4">
      <div className="space-y-1">
        <h2 id="equipe-completa-aguardando" className="text-sm font-semibold">{t("Equipe Completa aguardando contato")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("Empresas que assinaram ou deixaram um plano com os agentes feitos sob medida. Fale com cada uma e marque o contato.")}
        </p>
      </div>
      <ul className="space-y-2">
        {avisos.map((a) => (
          <li key={a.id} data-aviso={a.tipo} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-3 text-sm">
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium">
                {a.empresa}{" "}
                <span className="font-normal text-muted-foreground">
                  · {(a.tipo === "entrada" ? t("assinou o {plano}") : t("deixou o {plano}")).replace("{plano}", a.plano_nome)}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {data.format(new Date(a.criado_em))} ·{" "}
                {a.equipe_avisada_em ? t("e-mail enviado à equipe") : t("e-mail não enviado: o aviso está só aqui")}
              </p>
            </div>
            <Button size="sm" variant="outline" disabled={marcando !== null} onClick={() => void marcar(a.id)}>
              {t("Marcar como contatado")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
