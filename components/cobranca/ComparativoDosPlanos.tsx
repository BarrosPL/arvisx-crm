"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { blocosDoPlano, diferencaDePreco, entraESai, maisCompleto, nomeDaTela } from "@/lib/cobranca/comparativo";
import { itensDoExcesso, preencherFrase } from "@/lib/cobranca/excesso";
import type { PlanoDoComparativo } from "@/lib/cobranca/painel";
import type { UsoDaOrganizacao } from "@/lib/cobranca/uso";
import { formatCents } from "@/lib/money";
import { Check, Sparkle, X } from "@/lib/ui/icons";

export interface PropsDoComparativo {
  planos: readonly PlanoDoComparativo[];
  /** A base do "o que entra / o que sai": o plano de hoje. */
  atual: PlanoDoComparativo | null;
  selecionadoId: string | null;
  onEscolher: (id: string) => void;
  /** O uso de hoje: o card diz quando não cabe. */
  uso?: UsoDaOrganizacao;
  /** O botão de confirmar, desenhado DEPOIS do que se perde e da diferença de preço. */
  confirmar?: (plano: PlanoDoComparativo, naoCabe: boolean) => ReactNode;
  desabilitado?: boolean;
  /** A instalação cobra IVA (Stripe Tax): os preços são "+ IVA". */
  iva?: boolean;
  /** Na escolha do Assinar, o plano atual também se escolhe (assinar o mesmo plano do teste). Na troca, não. */
  atualEscolhivel?: boolean;
}

/**
 * O COMPARATIVO DOS PLANOS (ArvisX, tarefa 2 dos planos): o MESMO componente na
 * tela de fim do teste (conta suspensa), no Assinar e na troca de plano em
 * /app/settings/billing.
 *
 * 1. Um card por plano, com o que o dono escreveu (descrição, para quem, o que
 *    tem, o que não tem e, em destaque, o "como funciona"). Nenhum texto de
 *    plano mora aqui; o preço vem do cadastro do plano.
 * 2. Escolhido um plano, a diferença de preço e o que entra e o que sai em
 *    relação ao atual, por bloco de benefício, com os nomes de tela do seletor
 *    no detalhe — e só então o botão de confirmar. Num plano menor, o que se
 *    perde aparece antes do botão.
 */
export function ComparativoDosPlanos(p: PropsDoComparativo) {
  const t = useT();
  const destaque = maisCompleto(p.planos);
  const selecionado = p.planos.find((plano) => plano.id === p.selecionadoId) ?? null;
  const intervalo = (plano: PlanoDoComparativo) => (plano.intervalo === "ano" ? t("por ano") : t("por mês"));
  const limite = (n: number | null) => (n === null ? t("ilimitados") : String(n));
  const excesso = (plano: PlanoDoComparativo) =>
    p.uso ? itensDoExcesso(plano.excedente, p.uso, { assentos: plano.max_assentos, canais: plano.max_canais }) : [];
  const nome = (href: string) => {
    const n = nomeDaTela(href);
    return n.grupo ? `${t(n.tela)} (${t(n.grupo)})` : t(n.tela);
  };

  return (
    <div className="space-y-4" data-comparativo>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {p.planos.map((plano) => {
          const escolhido = plano.id === p.selecionadoId;
          const naoCabe = excesso(plano).length > 0;
          return (
            <li
              key={plano.id}
              data-plano={plano.nome}
              aria-current={plano.atual ? "true" : undefined}
              className={`flex min-w-0 flex-col gap-3 rounded-lg border p-4 text-sm ${
                escolhido ? "border-cta ring-2 ring-cta/40" : plano.id === destaque ? "border-cta/60" : ""
              }`}
            >
              <div className="flex flex-wrap gap-1.5 empty:hidden">
                {plano.atual && <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs">{t("Plano atual")}</span>}
                {plano.id === destaque && (
                  <span data-selo="mais-completo" className="rounded-md bg-cta-leve px-1.5 py-0.5 text-xs font-medium text-cta-forte">
                    {t("Mais completo")}
                  </span>
                )}
                {plano.inclui_agentes_arvisx && (
                  <span data-selo="agentes" className="inline-flex items-center gap-1 rounded-md bg-cta px-1.5 py-0.5 text-xs font-medium text-cta-foreground">
                    <Sparkle aria-hidden weight="fill" className="h-3 w-3" />
                    {t("Agentes de IA sob medida")}
                  </span>
                )}
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold">{plano.nome}</h3>
                <p className="text-lg font-semibold">
                  {formatCents(plano.preco_cents, plano.moeda)}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    {p.iva ? `${t("+ IVA")} ` : ""}
                    {intervalo(plano)}
                  </span>
                </p>
                {plano.descricao_curta && <p className="font-medium">{plano.descricao_curta}</p>}
                {plano.para_quem && <p className="text-muted-foreground">{plano.para_quem}</p>}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("Números conectados")}: {limite(plano.max_canais)} · {t("Pessoas")}: {limite(plano.max_assentos)}
              </p>
              {plano.como_funciona && (
                <div data-como-funciona className="rounded-md border border-cta/40 bg-cta-leve p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-cta-forte">{t("Como funciona")}</p>
                  <p>{plano.como_funciona}</p>
                </div>
              )}
              {plano.destaques.length > 0 && (
                <ul className="space-y-1" aria-label={t("O que tem")}>
                  {plano.destaques.map((frase) => (
                    <li key={frase} className="flex gap-2">
                      <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      <span>{frase}</span>
                    </li>
                  ))}
                </ul>
              )}
              {plano.limites.length > 0 && (
                <ul className="space-y-1 text-muted-foreground" aria-label={t("O que não tem")}>
                  {plano.limites.map((frase) => (
                    <li key={frase} className="flex gap-2">
                      <X aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{frase}</span>
                    </li>
                  ))}
                </ul>
              )}
              {naoCabe && (
                <p className="text-xs text-warning-fg" data-excesso>
                  {excesso(plano).map((item) => preencherFrase(t(item.frase), item)).join(" ")}
                </p>
              )}
              <Button
                className="mt-auto"
                variant={escolhido ? "default" : "outline"}
                disabled={p.desabilitado || (plano.atual && !p.atualEscolhivel)}
                aria-pressed={escolhido}
                onClick={() => p.onEscolher(plano.id)}
              >
                {plano.atual && !p.atualEscolhivel ? t("Seu plano") : escolhido ? t("Escolhido") : t("Escolher {plano}").replace("{plano}", plano.nome)}
              </Button>
            </li>
          );
        })}
      </ul>

      {selecionado && (
        <MudancaDePlano
          de={p.atual}
          para={selecionado}
          iva={p.iva === true}
          nome={nome}
          confirmar={p.confirmar?.(selecionado, excesso(selecionado).length > 0)}
        />
      )}
    </div>
  );
}

function MudancaDePlano({
  de,
  para,
  iva,
  nome,
  confirmar,
}: {
  de: PlanoDoComparativo | null;
  para: PlanoDoComparativo;
  iva: boolean;
  nome: (href: string) => string;
  confirmar: ReactNode;
}) {
  const t = useT();
  const blocos = de ? entraESai(de.telas, para.telas) : [];
  const diferenca = de ? diferencaDePreco(de, para) : null;
  const intervalo = para.intervalo === "ano" ? t("por ano") : t("por mês");
  const limite = (n: number | null) => (n === null ? t("ilimitados") : String(n));
  const mudaLimite = de && (de.max_canais !== para.max_canais || de.max_assentos !== para.max_assentos);
  const perde = blocos.some((b) => b.saem.length > 0);
  // A frase da credencial só onde há IA: nada de texto de IA num plano que não a tem.
  const temIa = blocosDoPlano(para.telas).includes("automatizar");

  return (
    <section aria-labelledby="mudanca-de-plano" className="space-y-3 rounded-lg border p-4 text-sm" data-mudanca>
      <h3 id="mudanca-de-plano" className="font-semibold">
        {de ? t("De {origem} para {destino}").replace("{origem}", de.nome).replace("{destino}", para.nome) : para.nome}
      </h3>
      {de && diferenca !== null && (
        <p data-diferenca>
          {t("De {origem} para {destino}")
            .replace("{origem}", formatCents(de.preco_cents, de.moeda))
            .replace("{destino}", formatCents(para.preco_cents, para.moeda))}
          {": "}
          <strong>
            {diferenca === 0
              ? t("mesmo preço")
              : `${diferenca > 0 ? "+" : "−"}${formatCents(Math.abs(diferenca), para.moeda)}${iva ? ` ${t("+ IVA")}` : ""} ${intervalo}`}
          </strong>
        </p>
      )}
      {mudaLimite && (
        <p data-limites>
          {t("Números conectados")}: {limite(de.max_canais)} → {limite(para.max_canais)} · {t("Pessoas")}: {limite(de.max_assentos)} →{" "}
          {limite(para.max_assentos)}
        </p>
      )}
      {de && blocos.length === 0 && <p>{t("As mesmas telas do plano atual.")}</p>}
      {blocos.length > 0 && (
        <table className="w-full text-left">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">{t("Área")}</th>
              <th scope="col" className="py-1 pr-3 font-medium">{t("O que entra")}</th>
              <th scope="col" className="py-1 font-medium">{t("O que sai")}</th>
            </tr>
          </thead>
          <tbody>
            {blocos.map((b) => (
              <tr key={b.bloco} data-bloco={b.bloco} className="border-t align-top">
                <th scope="row" className="py-2 pr-3 font-medium">{t(b.rotulo)}</th>
                <td className="py-2 pr-3" data-entram>
                  {b.entram.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-success">
                        {"+ "}
                        {t("{n} telas").replace("{n}", String(b.entram.length))}
                      </summary>
                      <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                        {b.entram.map((h) => <li key={h}>{nome(h)}</li>)}
                      </ul>
                    </details>
                  )}
                </td>
                <td className="py-2" data-saem>
                  {b.saem.length > 0 && (
                    <details open>
                      <summary className="cursor-pointer text-warning-fg">
                        {"− "}
                        {t("{n} telas").replace("{n}", String(b.saem.length))}
                      </summary>
                      <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                        {b.saem.map((h) => <li key={h}>{nome(h)}</li>)}
                      </ul>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {perde && (
        <p className="text-xs text-muted-foreground">
          {t("Nada é apagado: as telas que saem somem do menu e voltam quando você assinar um plano que as inclua.")}
        </p>
      )}
      {temIa && (
        <p className="text-xs text-muted-foreground">
          {t("A IA usa a credencial que a sua empresa conecta: o consumo é cobrado pelo provedor de IA, não por este plano.")}
        </p>
      )}
      {confirmar}
    </section>
  );
}
