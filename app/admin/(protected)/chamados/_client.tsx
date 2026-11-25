"use client";

/**
 * Os chamados que as empresas abriram pelo assistente, para a equipe da
 * plataforma: lista, o diagnóstico anexado e duas marcações (visto, resolvido).
 *
 * Só leitura do conteúdo: a equipe não edita o texto do chamado.
 */
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";

type Estado = "aberto" | "em_andamento" | "resolvido";
type Filtro = Estado | "todos";

interface Chamado {
  id: string;
  organization_id: string;
  resumo: string;
  diagnostico: Record<string, unknown>;
  estado: Estado;
  created_at: string;
  visto_em: string | null;
  resolvido_em: string | null;
  empresa: { nome: string; slug: string } | null;
}

const FILTROS: { valor: Filtro; rotulo: string }[] = [
  { valor: "aberto", rotulo: "Abertos" },
  { valor: "em_andamento", rotulo: "Em andamento" },
  { valor: "resolvido", rotulo: "Resolvidos" },
  { valor: "todos", rotulo: "Todos" },
];

const ROTULO_DO_ESTADO: Record<Estado, string> = {
  aberto: "Aberto",
  em_andamento: "Em andamento",
  resolvido: "Resolvido",
};

export function ChamadosDoAssistente() {
  const t = useT();
  const [filtro, setFiltro] = useState<Filtro>("aberto");
  const [chamados, setChamados] = useState<Chamado[] | null>(null);
  const [erro, setErro] = useState<"carregar" | "salvar" | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async (qual: Filtro) => {
    try {
      const r = await fetch(`/api/v1/admin/assistente/chamados?estado=${qual}`, { cache: "no-store" });
      const corpo = (await r.json().catch(() => null)) as { data?: Chamado[] } | null;
      if (!r.ok || !corpo?.data) {
        setChamados([]);
        setErro("carregar");
        return;
      }
      setChamados(corpo.data);
      setErro(null);
    } catch {
      setChamados([]);
      setErro("carregar");
    }
  }, []);

  useEffect(() => {
    // Leitura inicial e a cada troca de filtro: sincroniza a lista com o servidor.
    void carregar(filtro);
  }, [carregar, filtro]);

  async function marcar(id: string, acao: "visto" | "resolvido") {
    setOcupado(id);
    try {
      const r = await fetch(`/api/v1/admin/assistente/chamados/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acao }),
      });
      if (!r.ok) setErro("salvar");
      await carregar(filtro);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Chamados do assistente")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Pedidos de ajuda que as empresas abriram pelo assistente, com o diagnóstico anexado.")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("Filtrar chamados")}>
        {FILTROS.map((f) => (
          <Button
            key={f.valor}
            type="button"
            size="sm"
            variant={filtro === f.valor ? "default" : "outline"}
            role="tab"
            aria-selected={filtro === f.valor}
            onClick={() => setFiltro(f.valor)}
          >
            {t(f.rotulo)}
          </Button>
        ))}
      </div>

      {erro ? (
        <p role="alert" className="text-sm text-destructive">
          {erro === "carregar" ? t("Não foi possível carregar os chamados.") : t("Não foi possível salvar.")}
        </p>
      ) : null}

      {chamados === null ? (
        <p className="text-sm text-muted-foreground">{t("Carregando...")}</p>
      ) : chamados.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="chamados-vazio">
          {t("Nenhum chamado neste filtro.")}
        </p>
      ) : (
        <ul className="space-y-3" data-testid="chamados-lista">
          {chamados.map((c) => (
            <li key={c.id} className="rounded-lg border bg-card p-4" data-testid="chamado" data-estado={c.estado}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.empresa?.nome ?? c.organization_id}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(c.created_at).toLocaleString()} · {t(ROTULO_DO_ESTADO[c.estado])}
                    {c.visto_em ? ` · ${t("Visto")}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  {!c.visto_em ? (
                    <Button type="button" size="sm" variant="outline" disabled={ocupado === c.id} onClick={() => void marcar(c.id, "visto")}>
                      {t("Marcar como visto")}
                    </Button>
                  ) : null}
                  {c.estado !== "resolvido" ? (
                    <Button type="button" size="sm" disabled={ocupado === c.id} onClick={() => void marcar(c.id, "resolvido")}>
                      {t("Marcar como resolvido")}
                    </Button>
                  ) : null}
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm">{c.resumo}</p>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-muted-foreground">{t("Diagnóstico anexado")}</summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-3 text-xs" data-testid="chamado-diagnostico">
                  {JSON.stringify(c.diagnostico, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
