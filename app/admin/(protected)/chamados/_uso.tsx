"use client";

/**
 * O uso do assistente no mês, por organização, com destaque de quem destoa.
 * Só para a administração da plataforma. Só contagem e tokens.
 */
import { useEffect, useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { cn } from "@/lib/utils";

interface Linha {
  organization_id: string;
  mensagens: number;
  tokens_de_entrada: number;
  tokens_de_saida: number;
  falhas: number;
  usuarios: number;
  destoa: boolean;
  motivo: "acima_do_numero" | "acima_da_mediana" | null;
  empresa: { nome: string; slug: string } | null;
}

interface Uso {
  criterio: { mensagens: number; multiplo: number };
  organizacoes: Linha[];
}

export function UsoDoAssistente() {
  const t = useT();
  const [uso, setUso] = useState<Uso | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/v1/admin/assistente/uso", { cache: "no-store" })
      .then(async (r) => {
        const corpo = (await r.json().catch(() => null)) as { data?: Uso } | null;
        if (!vivo) return;
        if (r.ok && corpo?.data) setUso(corpo.data);
        else setFalhou(true);
      })
      .catch(() => {
        if (vivo) setFalhou(true);
      });
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <section className="space-y-3" data-testid="uso-do-assistente">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t("Uso do assistente neste mês")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Mensagens que chegaram à IA, por empresa. Não há limite por plano: o destaque é só um aviso para alguém olhar.")}
        </p>
      </div>
      {falhou ? (
        <p role="alert" className="text-sm text-destructive">
          {t("Não foi possível carregar o uso do assistente.")}
        </p>
      ) : uso === null ? (
        <p className="text-sm text-muted-foreground">{t("Carregando...")}</p>
      ) : uso.organizacoes.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="uso-vazio">
          {t("Nenhuma empresa usou o assistente neste mês.")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("Empresa")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("Mensagens")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("Pessoas")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("Tokens de entrada")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("Tokens de saída")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("Falhas")}</th>
                <th className="px-3 py-2 font-medium">{t("Atenção")}</th>
              </tr>
            </thead>
            <tbody>
              {uso.organizacoes.map((l) => (
                <tr
                  key={l.organization_id}
                  data-testid="uso-linha"
                  data-destoa={l.destoa ? "sim" : "nao"}
                  className={cn("border-t", l.destoa && "bg-destructive/10")}
                >
                  <td className="px-3 py-2">{l.empresa?.nome ?? l.organization_id}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.mensagens}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.usuarios}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.tokens_de_entrada}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.tokens_de_saida}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.falhas}</td>
                  <td className="px-3 py-2">
                    {l.motivo === "acima_do_numero"
                      ? t("Acima do número de alerta")
                      : l.motivo === "acima_da_mediana"
                        ? t("Muito acima das outras empresas")
                        : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
