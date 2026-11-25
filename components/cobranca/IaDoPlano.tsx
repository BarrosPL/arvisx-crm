import { formatadorDeData } from "@/lib/cobranca/fuso";
import type { IaDoPlanoNaTela } from "@/lib/cobranca/ia-do-plano";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

/**
 * A IA INCLUÍDA NO PLANO: franquia usada e total, e o aviso (Tarefa 8, parte 1).
 *
 * O MESMO bloco nas duas telas que o mostram — Uso de IA e Plano e cobrança —,
 * para as duas dizerem a mesma coisa com as mesmas palavras. Sem hooks: é
 * desenhado pelo servidor, no idioma de quem abriu.
 *
 * O cliente vê CONVERSAS. O teto em dólar aparece só como percentual do uso
 * incluído, que é o que explica uma parada antes de a franquia encher.
 */
export function IaDoPlano({
  ia,
  idioma,
  fuso,
  comTitulo = true,
}: {
  ia: IaDoPlanoNaTela;
  idioma: Idioma;
  fuso: string | null;
  comTitulo?: boolean;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const data = formatadorDeData(idioma, fuso, { dateStyle: "short" });
  const saidas = t(
    "Para a IA voltar: fale com a ArvisX para contratar um pacote extra, ou cadastre uma chave de IA própria em IA › Credenciais.",
  );

  const conversas =
    ia.franquia === null
      ? `${ia.conversas} · ${t("sem limite")}`
      : t("{usados} de {limite}").replace("{usados}", String(ia.conversas)).replace("{limite}", String(ia.franquia));

  const aviso =
    ia.situacao === "sem_teto"
      ? `${t("O plano desta empresa não tem limite de uso de IA configurado, e por isso a IA incluída não foi liberada.")} ${saidas}`
      : ia.situacao === "esgotada"
        ? `${t("A IA incluída no plano acabou neste ciclo. As conversas novas vão para a equipe.")} ${saidas}`
        : ia.situacao === "perto_do_fim"
          ? t("A IA incluída no plano está perto do fim neste ciclo. Ao chegar ao limite, a IA para e as conversas passam para a equipe. Para continuar: fale com a ArvisX para contratar um pacote extra, ou cadastre uma chave de IA própria em IA › Credenciais.")
          : null;

  return (
    <div className="space-y-2" data-ia-do-plano={ia.situacao}>
      {comTitulo ? <h3 className="text-sm font-semibold">{t("IA incluída no plano")}</h3> : null}
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        <dt>{t("Conversas com IA neste ciclo")}</dt>
        <dd data-uso="conversas-com-ia">{conversas}</dd>
        {ia.percentualDoUsoIncluido !== null ? (
          <>
            <dt>{t("Uso de IA incluído já consumido")}</dt>
            <dd data-uso="ia-incluida">{ia.percentualDoUsoIncluido}%</dd>
          </>
        ) : null}
      </dl>
      <p className="text-xs text-muted-foreground">
        {t("Conta cada contato atendido por um agente com a IA do plano. Quem usa a própria chave de IA não gasta a franquia.")}{" "}
        {ia.cicloFim
          ? `${ia.peloPeriodoPago ? t("O ciclo acompanha a sua assinatura e renova em") : t("O ciclo é o mês e renova em")} ${data.format(new Date(ia.cicloFim))}.`
          : null}
      </p>
      {aviso ? (
        <p
          role={ia.situacao === "perto_do_fim" ? "status" : "alert"}
          data-aviso-da-ia-do-plano={ia.situacao}
          className="rounded-md border border-warning-fg/40 bg-warning-bg p-3 text-sm"
        >
          {aviso}
        </p>
      ) : null}
    </div>
  );
}
