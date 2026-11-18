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

/** O roteador que já atende o canal, como o instalador o devolve no 409. */
export interface RoteadorNoCanal {
  id: string;
  nome: string;
  de_fora: boolean;
  fallback: { agent_id: string; nome: string } | null;
  membros: { agent_id: string; nome: string; intencao: string }[];
}

/** O WhatsApp que já atende clientes, como o instalador o devolve no 409. */
export interface CanalEmProducao {
  agentes: { agent_id: string; nome: string }[];
  conversas_recentes: number;
}

/** O que instalar muda no que é do cliente: pede uma confirmação só, com tudo. */
interface Conflito {
  agentes: AgenteEditado[];
  roteador: RoteadorNoCanal | null;
  canal: CanalEmProducao | null;
}

const CODIGOS_DE_CONFIRMACAO = new Set([
  "equipe_pronta_agentes_editados_a_mao",
  "equipe_pronta_canal_com_roteador",
  "equipe_pronta_canal_em_producao",
]);

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
  /**
   * O que é do cliente e instalar por cima muda: agentes editados fora daqui
   * e o roteador que já atende o canal. Pede confirmação antes de `forcar`.
   */
  const [conflito, setConflito] = useState<Conflito | null>(null);

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
      setConflito(null);
      await reler();
      setVista("painel");
    } catch (e) {
      if (e instanceof ApiError && CODIGOS_DE_CONFIRMACAO.has(e.code)) {
        const d = (e.details ?? {}) as {
          agentes?: AgenteEditado[];
          roteador?: RoteadorNoCanal;
          canal?: CanalEmProducao;
        };
        setConflito({
          agentes: Array.isArray(d.agentes) ? d.agentes : [],
          roteador: d.roteador && typeof d.roteador === "object" ? d.roteador : null,
          canal: d.canal && typeof d.canal === "object" ? d.canal : null,
        });
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

  async function mudarModo(acao: "ativar" | "pausar" | "retomar") {
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

  const roteador = conflito?.roteador ?? null;
  const canal = conflito?.canal ?? null;
  /** Nada é substituído: a instalação só fecha o número para o ensaio. */
  const soOCanal = conflito !== null && conflito.agentes.length === 0 && roteador === null;
  const confirmacao = conflito ? (
    <div
      className="max-w-2xl space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4"
      role="alertdialog"
      aria-label={t("Confirmar o que a instalação substitui")}
      data-testid="ep-confirmar-forcar"
    >
      {conflito.agentes.length > 0 ? (
        <div className="space-y-2" data-testid="ep-conflito-agentes">
          <p className="text-sm font-medium">
            {t("Há agentes que foram alterados fora da equipe pronta. Instalar de novo substitui essas alterações.")}
          </p>
          <ul className="list-disc pl-5 text-sm">
            {conflito.agentes.map((a) => (
              <li key={a.papel}>{t(estado.agentes.find((x) => x.papel === a.papel)?.nome ?? a.papel)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {roteador ? (
        <div className="space-y-2" data-testid="ep-conflito-roteador">
          <p className="text-sm font-medium">
            {t("Este WhatsApp já tem um roteador com agentes que não são da equipe pronta:")}{" "}
            <span data-testid="ep-conflito-roteador-nome">{roteador.nome}</span>
          </p>
          <ul className="list-disc pl-5 text-sm">
            {roteador.fallback ? (
              <li data-testid="ep-conflito-fallback">
                {t("Hoje, quem recebe as conversas que ninguém pegou:")} {roteador.fallback.nome}
              </li>
            ) : null}
            {roteador.membros.map((m) => (
              <li key={m.agent_id}>
                {m.nome} ({m.intencao})
              </li>
            ))}
          </ul>
          <p className="text-sm">
            {t(
              "Se você instalar, as conversas que ninguém pegou passam a ir para o Atendimento da equipe pronta. Os agentes que você colocou no roteador continuam nele.",
            )}
          </p>
          {estado.modo === "ensaio" && canal === null ? (
            <p className="text-sm" data-testid="ep-conflito-ensaio">
              {t(
                "A equipe é instalada em ensaio, e o ensaio vale para o número inteiro: até você ativar, a IA deste WhatsApp só responde aos telefones de teste, inclusive os agentes que já atendem por ele.",
              )}
            </p>
          ) : null}
        </div>
      ) : null}
      {canal ? (
        <div className="space-y-2" data-testid="ep-conflito-canal">
          <p className="text-sm font-medium">
            {t(
              "Este WhatsApp já atende clientes. Durante o ensaio, a IA só responde os números de teste. Recomendamos instalar em outro número ou ativar logo depois de testar.",
            )}
          </p>
          <ul className="list-disc pl-5 text-sm">
            {canal.agentes.map((a) => (
              <li key={a.agent_id} data-testid="ep-conflito-canal-agente">
                {t("Agente que atende por este número hoje:")} {a.nome}
              </li>
            ))}
            {canal.conversas_recentes > 0 ? (
              <li data-testid="ep-conflito-canal-conversas">
                {t("Conversas que a IA respondeu por este número nos últimos 7 dias:")} {canal.conversas_recentes}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="destructive" disabled={ocupado} onClick={() => instalar(true)} data-testid="ep-forcar">
          {soOCanal ? t("Instalar mesmo assim") : t("Substituir e instalar")}
        </Button>
        <Button type="button" variant="outline" disabled={ocupado} onClick={() => setConflito(null)}>
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
          aoRetomar={() => mudarModo("retomar")}
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
