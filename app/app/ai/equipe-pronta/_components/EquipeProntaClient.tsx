"use client";

/**
 * IA › EQUIPE PRONTA — a tela inteira, no cliente.
 *
 * Duas vistas sobre o MESMO estado (`GET /api/v1/ai/equipe-pronta`):
 *
 *   • o QUESTIONÁRIO em passos, que salva o rascunho ao fim de cada passo e
 *     termina na revisão (o texto que cada agente vai receber) com o Instalar;
 *   • o PAINEL de quem já instalou: modo (ensaio ou ativo), checklist com o
 *     link que resolve cada pendência, e um cartão por agente.
 *
 * Nada aqui decide regra: o que falta, o que pode ativar e se um agente foi
 * editado à mão vêm do servidor. Depois de toda escrita a tela relê o estado,
 * em vez de adivinhar o que mudou.
 */
import { useState } from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import type { EstadoDaEquipe } from "@/lib/ai/equipe-pronta/estado";
import type { OpcoesDaInstalacao } from "@/lib/ai/equipe-pronta/opcoes";
import {
  PASSOS_DO_QUESTIONARIO,
  primeiroPassoPendente,
  type PassoId,
} from "@/lib/ai/equipe-pronta/questionario";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";

import { Painel } from "./Painel";
import { Questionario, type Formulario } from "./Questionario";
import { Revisao } from "./Revisao";

type Vista = "questionario" | "revisao" | "painel";

export interface AgenteEditado {
  papel: string;
}

export function EquipeProntaClient({
  estadoInicial,
  opcoes,
  administra,
}: {
  estadoInicial: EstadoDaEquipe;
  opcoes: OpcoesDaInstalacao;
  /** Instalar, ativar e pausar são de quem administra a empresa. */
  administra: boolean;
}) {
  const t = useT();
  const [estado, setEstado] = useState(estadoInicial);
  const [vista, setVista] = useState<Vista>(estadoInicial.estado === "instalado" ? "painel" : "questionario");
  const [passo, setPasso] = useState<PassoId>(primeiroPassoPendente(estadoInicial.faltam) ?? "negocio");
  const [ocupado, setOcupado] = useState(false);
  /** Agentes que o cliente editou fora daqui: instalar por cima pede confirmação. */
  const [editados, setEditados] = useState<AgenteEditado[] | null>(null);

  async function reler(): Promise<EstadoDaEquipe> {
    const { data } = await apiClient.get<{ data: EstadoDaEquipe }>("/api/v1/ai/equipe-pronta");
    setEstado(data);
    return data;
  }

  async function salvarPasso(id: PassoId, respostas: Formulario): Promise<boolean> {
    setOcupado(true);
    try {
      await apiClient.put("/api/v1/ai/equipe-pronta", { respostas });
      await reler();
      const i = PASSOS_DO_QUESTIONARIO.findIndex((p) => p.id === id);
      const proximo = PASSOS_DO_QUESTIONARIO[i + 1];
      if (proximo) setPasso(proximo.id);
      else setVista("revisao");
      return true;
    } catch (e) {
      showApiError(e);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function instalar(forcar: boolean) {
    setOcupado(true);
    try {
      await apiClient.post("/api/v1/ai/equipe-pronta/instalar", { forcar });
      setEditados(null);
      await reler();
      setVista("painel");
    } catch (e) {
      if (e instanceof ApiError && e.code === "equipe_pronta_agentes_editados_a_mao") {
        const lista = (e.details as { agentes?: AgenteEditado[] } | undefined)?.agentes;
        setEditados(Array.isArray(lista) ? lista : []);
      } else {
        showApiError(e);
        // O instalador pede uma escolha que mora no último passo.
        if (e instanceof ApiError && /escolha_o_|_invalid|etapa_/.test(e.code)) {
          setPasso("onde");
          setVista("questionario");
        }
      }
    } finally {
      setOcupado(false);
    }
  }

  async function mudarModo(acao: "ativar" | "pausar") {
    setOcupado(true);
    try {
      await apiClient.post(`/api/v1/ai/equipe-pronta/${acao}`, {});
      await reler();
    } catch (e) {
      showApiError(e);
      await reler().catch(() => undefined);
    } finally {
      setOcupado(false);
    }
  }

  const confirmacao = editados ? (
    <div
      className="max-w-2xl space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4"
      role="alertdialog"
      aria-label={t("Substituir alterações feitas à mão")}
      data-testid="ep-confirmar-forcar"
    >
      <p className="text-sm font-medium">
        {t("Há agentes que foram alterados fora da equipe pronta. Instalar de novo substitui essas alterações.")}
      </p>
      {editados.length > 0 ? (
        <ul className="list-disc pl-5 text-sm">
          {editados.map((a) => (
            <li key={a.papel}>{t(estado.agentes.find((x) => x.papel === a.papel)?.nome ?? a.papel)}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="destructive" disabled={ocupado} onClick={() => instalar(true)} data-testid="ep-forcar">
          {t("Substituir e instalar")}
        </Button>
        <Button type="button" variant="outline" disabled={ocupado} onClick={() => setEditados(null)}>
          {t("Manter como está")}
        </Button>
      </div>
    </div>
  ) : null;

  if (vista === "painel") {
    return (
      <>
        {confirmacao}
        <Painel
          estado={estado}
          administra={administra}
          ocupado={ocupado}
          aoAtivar={() => mudarModo("ativar")}
          aoPausar={() => mudarModo("pausar")}
          aoInstalar={() => instalar(false)}
          aoEditar={() => {
            setPasso("negocio");
            setVista("questionario");
          }}
        />
      </>
    );
  }

  if (vista === "revisao") {
    return (
      <>
        {confirmacao}
        <Revisao
          estado={estado}
          administra={administra}
          ocupado={ocupado}
          aoInstalar={() => instalar(false)}
          aoVoltar={(id) => {
            setPasso(id ?? "onde");
            setVista("questionario");
          }}
          aoVerPainel={estado.estado === "instalado" ? () => setVista("painel") : undefined}
        />
      </>
    );
  }

  return (
    <Questionario
      // Trocar de passo remonta o formulário com o que o servidor guardou.
      key={passo}
      passo={passo}
      respostas={(estado.respostas ?? {}) as Formulario}
      faltam={estado.faltam}
      opcoes={opcoes}
      ocupado={ocupado}
      aoSalvar={salvarPasso}
      aoIrPara={setPasso}
      aoRevisar={() => setVista("revisao")}
      aoVerPainel={estado.estado === "instalado" ? () => setVista("painel") : undefined}
    />
  );
}
