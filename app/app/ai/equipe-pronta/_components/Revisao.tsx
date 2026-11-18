"use client";

/**
 * A REVISÃO antes de instalar: o texto que cada agente vai receber.
 *
 * O texto vem do servidor (`texto_gerado`), feito pelo MESMO renderizador que o
 * instalador usa — o que se lê aqui é o que será publicado. Antes da primeira
 * instalação o bloco "Esta empresa" ainda não cita agenda, funil nem base: eles
 * são criados pelo instalador, e a tela diz isso em vez de parecer incompleta.
 */
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import type { EstadoDaEquipe } from "@/lib/ai/equipe-pronta/estado";
import {
  PASSOS_DO_QUESTIONARIO,
  passosComPendencia,
  type PassoId,
} from "@/lib/ai/equipe-pronta/questionario";

export function Revisao({
  estado,
  administra,
  ocupado,
  aoInstalar,
  aoVoltar,
  aoVerPainel,
}: {
  estado: EstadoDaEquipe;
  administra: boolean;
  ocupado: boolean;
  aoInstalar: () => void;
  aoVoltar: (passo?: PassoId) => void;
  aoVerPainel?: () => void;
}) {
  const t = useT();
  const pendentes = passosComPendencia(estado.faltam);
  const instalada = estado.estado === "instalado";

  return (
    <div className="max-w-4xl space-y-5" data-testid="ep-revisao">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{t("Revisar e instalar")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Este é o texto que cada agente vai receber. A parte do papel é igual para toda empresa; o bloco Esta empresa sai das suas respostas.")}
        </p>
      </header>

      {!estado.perfil_completo ? (
        <Card className="space-y-2 p-4" role="status" data-testid="ep-faltam">
          <p className="text-sm font-medium">{t("Ainda faltam respostas obrigatórias nestes passos:")}</p>
          <ul className="flex flex-wrap gap-2">
            {pendentes.map((id) => (
              <li key={id}>
                <Button type="button" variant="outline" size="sm" onClick={() => aoVoltar(id)}>
                  {t(PASSOS_DO_QUESTIONARIO.find((p) => p.id === id)!.titulo)}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <>
          {!instalada ? (
            <p className="text-xs text-muted-foreground">
              {t("A agenda, o funil e a base de conhecimento entram no texto depois de instalar: é a instalação que os cria.")}
            </p>
          ) : null}
          <ul className="space-y-3">
            {estado.agentes.map((agente) => (
              <li key={agente.papel}>
                <Card className="p-4">
                  <details data-testid={`ep-texto-${agente.papel}`}>
                    <summary className="cursor-pointer text-sm font-semibold">
                      {t(agente.nome)}
                      <span className="ml-2 font-normal text-muted-foreground">{t(agente.descricao)}</span>
                    </summary>
                    <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                      {agente.texto_gerado}
                    </pre>
                  </details>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={ocupado} onClick={() => aoVoltar()}>
          {t("Voltar às respostas")}
        </Button>
        {administra ? (
          <Button
            type="button"
            disabled={ocupado || !estado.perfil_completo}
            onClick={aoInstalar}
            data-testid="ep-instalar"
          >
            {ocupado ? t("Instalando…") : instalada ? t("Instalar de novo com estas respostas") : t("Instalar a equipe")}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="ep-so-admin">
            {t("Quem instala é quem administra a empresa. As suas respostas já estão salvas.")}
          </p>
        )}
        {aoVerPainel ? (
          <Button type="button" variant="ghost" disabled={ocupado} onClick={aoVerPainel}>
            {t("Voltar à equipe")}
          </Button>
        ) : null}
      </div>
      {administra && !instalada ? (
        <p className="text-xs text-muted-foreground">
          {t("A equipe é instalada em ensaio: só os telefones de teste falam com ela, até você ativar.")}
        </p>
      ) : null}
    </div>
  );
}
