"use client";

/**
 * O PAINEL da equipe instalada: em que modo está, o que falta para ativar, e
 * como está cada agente.
 *
 *   • ENSAIO → ATIVO. Em ensaio só os telefones de teste falam com a equipe.
 *     Ativar abre para todos os contatos do canal, e só fica disponível com o
 *     checklist inteiro pronto.
 *   • PAUSAR ↔ RETOMAR. Pausar para os quatro agentes da equipe e mais nada:
 *     o acesso da IA no número não muda, e os outros agentes dele seguem
 *     atendendo. Nada é desinstalado. Retomar volta ao modo em que estava.
 *   • CHECKLIST. Cada pendência leva à tela que a resolve.
 *   • CARTÃO POR AGENTE: publicado ou não, a versão do papel instalada, se foi
 *     editado à mão, e se há versão nova do papel (nunca aplicada sozinha).
 */
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import type { AgenteNoEstado, EstadoDaEquipe } from "@/lib/ai/equipe-pronta/estado";

const SITUACAO: Record<AgenteNoEstado["situacao"], string> = {
  em_dia: "Em dia com as suas respostas",
  desatualizado: "As respostas mudaram: instale de novo para aplicar",
  editado_a_mao: "Editado à mão",
  nao_instalado: "Não instalado",
};

export function Painel({
  estado,
  administra,
  ocupado,
  aoAtivar,
  aoPausar,
  aoRetomar,
  aoInstalar,
  aoEditar,
}: {
  estado: EstadoDaEquipe;
  administra: boolean;
  ocupado: boolean;
  aoAtivar: () => void;
  aoPausar: () => void;
  aoRetomar: () => void;
  aoInstalar: () => void;
  aoEditar: () => void;
}) {
  const t = useT();
  const ativo = estado.modo === "ativo";
  const pausada = estado.pausada === true;
  const pendencias = estado.checklist.filter((i) => !i.ok).length;
  const precisaReinstalar = estado.agentes.some((a) => a.situacao === "desatualizado" || a.situacao === "nao_instalado");

  return (
    <div className="max-w-5xl space-y-6" data-testid="ep-painel">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge
            variant={ativo && !pausada ? "default" : "secondary"}
            data-testid="ep-modo"
            data-modo={estado.modo}
            data-pausada={pausada ? "sim" : "nao"}
          >
            {pausada ? t("Pausada") : ativo ? t("Ativa") : t("Em ensaio")}
          </Badge>
          <p className="text-sm" role="status">
            {pausada
              ? t(
                  "A equipe está pausada: os quatro agentes não respondem. Os outros agentes deste número continuam atendendo.",
                )
              : ativo
                ? t("A equipe está instalada e ativa: atende todos os contatos do canal.")
                : t("A equipe está instalada em ensaio: só os telefones de teste falam com ela.")}
          </p>
        </div>
        {administra ? (
          <div className="flex flex-wrap items-center gap-2">
            {!ativo ? (
              <Button
                type="button"
                disabled={ocupado || !estado.pode_ativar}
                onClick={aoAtivar}
                data-testid="ep-ativar"
              >
                {t("Ativar para todos os contatos")}
              </Button>
            ) : null}
            {pausada ? (
              <Button
                type="button"
                variant={ativo ? "default" : "outline"}
                disabled={ocupado}
                onClick={aoRetomar}
                data-testid="ep-retomar"
              >
                {t("Retomar a equipe")}
              </Button>
            ) : (
              <Button type="button" variant="outline" disabled={ocupado} onClick={aoPausar} data-testid="ep-pausar">
                {t("Pausar a equipe")}
              </Button>
            )}
            <Button type="button" variant="outline" disabled={ocupado} onClick={aoEditar} data-testid="ep-editar">
              {t("Editar respostas")}
            </Button>
            {precisaReinstalar ? (
              <Button type="button" variant="outline" disabled={ocupado} onClick={aoInstalar} data-testid="ep-reinstalar">
                {t("Instalar de novo com estas respostas")}
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("Ativar, pausar e instalar são de quem administra a empresa.")}
          </p>
        )}
        {administra && !pausada ? (
          <p className="text-xs text-muted-foreground" data-testid="ep-o-que-pausar-faz">
            {t(
              "Pausar para só os quatro agentes da equipe. O acesso da IA neste número não muda, e nada é desinstalado.",
            )}
          </p>
        ) : null}
        {!ativo && !estado.pode_ativar ? (
          <p className="text-xs text-muted-foreground" data-testid="ep-por-que-nao-ativa">
            {t("Para ativar, resolva os itens pendentes abaixo.")}
          </p>
        ) : null}
      </Card>

      <section className="space-y-2" aria-labelledby="ep-checklist-titulo">
        <h2 id="ep-checklist-titulo" className="text-sm font-semibold">
          {t("O que precisa estar pronto")}
          <span className="ml-2 font-normal text-muted-foreground" data-testid="ep-pendencias" data-total={pendencias}>
            {pendencias === 0 ? t("Tudo pronto") : `${pendencias} ${t("pendente(s)")}`}
          </span>
        </h2>
        <ul className="space-y-2" data-testid="ep-checklist">
          {estado.checklist.map((item) => (
            <li key={item.id}>
              <Card
                className="flex flex-wrap items-center justify-between gap-3 p-3"
                data-testid={`ep-item-${item.id}`}
                data-ok={item.ok ? "sim" : "nao"}
              >
                <p className="flex items-start gap-2 text-sm">
                  <span aria-hidden className={item.ok ? "text-emerald-600" : "text-destructive"}>
                    {item.ok ? "✓" : "•"}
                  </span>
                  <span>
                    <span className="sr-only">{item.ok ? t("Pronto:") : t("Pendente:")} </span>
                    {t(item.texto)}
                  </span>
                </p>
                {!item.ok ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={item.link}>{t("Resolver")}</Link>
                  </Button>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2" aria-labelledby="ep-agentes-titulo">
        <h2 id="ep-agentes-titulo" className="text-sm font-semibold">
          {t("Os agentes da equipe")}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="ep-agentes">
          {estado.agentes.map((agente) => (
            <li key={agente.papel}>
              <Card
                className="flex h-full flex-col gap-2 p-4"
                data-testid={`ep-agente-${agente.papel}`}
                data-situacao={agente.situacao}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{t(agente.nome)}</h3>
                  <Badge variant={agente.publicado ? "default" : "outline"}>
                    {agente.publicado ? t("Publicado") : t("Não publicado")}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{t(agente.descricao)}</p>
                <p className="text-xs">
                  {t(SITUACAO[agente.situacao])}
                  {agente.versao_do_papel_instalada !== null
                    ? ` · ${t("versão do papel")} ${agente.versao_do_papel_instalada}`
                    : ""}
                </p>
                {agente.situacao === "editado_a_mao" ? (
                  <p className="text-xs text-muted-foreground" data-testid={`ep-editado-${agente.papel}`}>
                    {t("Este agente foi alterado fora da equipe pronta. Instalar de novo pede confirmação antes de substituir.")}
                  </p>
                ) : null}
                {agente.atualizacao_disponivel ? (
                  <div className="space-y-2 rounded-md border p-2" data-testid={`ep-atualizacao-${agente.papel}`}>
                    <p className="text-xs font-medium">
                      {t("Atualização disponível:")} {t("versão")} {agente.atualizacao_disponivel.de} →{" "}
                      {agente.atualizacao_disponivel.para}
                    </p>
                    <p className="text-xs text-muted-foreground">{t(agente.atualizacao_disponivel.notas)}</p>
                    {administra ? (
                      <Button type="button" size="sm" variant="outline" disabled={ocupado} onClick={aoInstalar}>
                        {t("Aplicar atualização")}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {agente.agent_id ? (
                  <Link
                    href={`/app/ai/agents/${agente.agent_id}`}
                    className="mt-auto text-xs underline underline-offset-2"
                  >
                    {t("Abrir o agente")}
                  </Link>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
