"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { FRASE_DO_EXCEDENTE } from "@/components/admin/tenants/CardDeCobranca";
import { ComparativoDosPlanos } from "@/components/cobranca/ComparativoDosPlanos";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { documentoDoPagador, exigeDocumento } from "@/lib/cobranca/documento";
import { formatadorDeData } from "@/lib/cobranca/fuso";
import { linkDePagamentoSeguro } from "@/lib/cobranca/link";
import { excessoDosDetalhes, preencherFrase, type ItemDoExcesso } from "@/lib/cobranca/excesso";
import { calcularAjusteProporcional } from "@/lib/cobranca/prorata";
import { abrirNoNavegador } from "@/lib/cobranca/navegar";
import { formatCents } from "@/lib/money";
import type { DadosDoPainel, PlanoParaAssinar, PlanoParaTroca } from "@/lib/cobranca/painel";
import type { UsoDaOrganizacao } from "@/lib/cobranca/uso";
import type { EstadoDaAssinatura, ProvedorDeCobranca } from "@/lib/cobranca/vocabulario";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";

export interface PropsDasAcoes {
  estado: EstadoDaAssinatura;
  temProvedor: boolean;
  assinaturasVivas: number;
  linkDePagamento: string | null;
  cancelaNoFim: boolean;
  planosParaTroca: readonly PlanoParaTroca[];
  planoAtual: PlanoParaTroca | null;
  periodoPagoDesde: string | null;
  proximoVencimento: string | null;
  trocaPagamentoUrl: string | null;
  trocaStatus: string | null;
  instanteCalculo: string;
  /** A página recebeu `?voltou=1`: relê uma vez e dá o recado. */
  voltouDoCheckout: boolean;
  /** No hub de conta suspensa: pagar e voltar ao sistema é o único assunto. */
  noHub: boolean;
  /** IANA da empresa; o mesmo dia do painel. Ausente, o padrão. */
  fuso?: string | null;
  /** Quem cobra: o provedor da assinatura; sem ele, o da instalação (D-8). */
  provedor: ProvedorDeCobranca | null;
  /** CNPJ do cadastro, já conferido e sem máscara: pré-preenche o documento que o Asaas exige. */
  documentoDoCadastro: string | null;
  /**
   * Etapa 3 dos planos: nada assinado no provedor (o teste grátis, vencido ou
   * não). O "Assinar" vira a escolha entre `planosParaAssinar`, e assinar troca
   * o plano para o escolhido antes do Checkout (`lib/cobranca/checkout.ts`).
   */
  escolheAoAssinar?: boolean;
  planosParaAssinar?: readonly PlanoParaAssinar[];
  /** O uso de hoje: a frase do excesso diz "você tem N". */
  uso?: UsoDaOrganizacao;
  /**
   * Tarefa 2 dos planos: o comparativo em linguagem de benefício, o mesmo na
   * escolha do Assinar e na troca. Ausente = nenhum card (só o que já havia).
   */
  comparativo?: DadosDoPainel["comparativo"];
  /** A instalação cobra IVA: preço e ajuste proporcional dizem "+ IVA". */
  iva?: boolean;
}

const BASE = "/api/v1/cobranca/assinatura";
/** Código da API → frase do dicionário. Nunca a `message` do servidor, que não é traduzida. */
const FRASE_DO_ERRO: Record<string, string> = {
  rate_limited: "Muitas tentativas seguidas. Aguarde um minuto e tente de novo.",
  provedor_indisponivel: "O provedor de pagamento não respondeu. Nada mudou; tente de novo em alguns minutos.",
  provedor_recusou: "O provedor de pagamento recusou o pedido. Fale com quem administra o sistema.",
  checkout_em_preparo: "Já estamos gerando o seu link de pagamento. Aguarde alguns segundos.",
  checkout_em_aberto: "Há um link de pagamento em aberto com o plano atual. Conclua o pagamento ou aguarde o link expirar para trocar de plano.",
  pagamento_em_andamento: "Você já tem um pagamento em andamento. Use o link para concluir.",
  sem_link_de_pagamento: "Não há cobrança aberta para pagar agora. Atualize o cartão em Gerenciar pagamento: a próxima tentativa sai sozinha.",
  provedor_nao_conectado: "O administrador do sistema ainda não conectou a cobrança.",
  not_found: "Sua empresa não tem plano de cobrança.",
  documento_invalido: "Confira o CPF ou CNPJ: os dígitos não batem.",
  documento_obrigatorio: "Informe o CPF ou CNPJ de quem paga.",
  documento_recusado: "O provedor de pagamento não aceitou este CPF ou CNPJ. Confira o número ou informe outro documento.",
  pagamento_pendente: "Regularize o pagamento antes de trocar de plano.",
  moeda_fora_do_provedor: "Este plano é cobrado numa moeda que o provedor de pagamento conectado não cobra. Fale com quem administra o sistema.",
  troca_de_moeda: "O plano escolhido é cobrado em outra moeda, e a assinatura em curso não muda de moeda. Fale com quem administra o sistema.",
  pagamento_do_periodo_pendente:
    'A mensalidade de agora ainda não foi paga. Pague em "Pagar agora" e troque de plano depois que o pagamento for confirmado (Pix: minutos; boleto: até 1 dia útil).',
  troca_em_preparo: "Estamos preparando o ajuste proporcional. Aguarde alguns segundos e tente novamente.",
  troca_pendente: "Conclua ou aguarde a cobrança proporcional antes de solicitar outra troca de plano.",
  pagamento_nao_registrado: "A cobrança foi iniciada, mas não conseguimos registrar o pagamento. Tente novamente; se houver uma cobrança aberta, fale com o suporte.",
  periodo_indisponivel: "Não foi possível calcular o período pago. Atualize a assinatura e tente novamente.",
  plano_invalido: "Este plano não está disponível. Recarregue a página e escolha outro.",
  escolha_um_plano: "O plano atual é só o teste grátis. Escolha um dos planos para assinar.",
  assinatura_no_provedor: "Sua assinatura já existe no provedor de pagamento. Para mudar de plano, use Trocar de plano.",
};
const FRASE_GENERICA = "Não foi possível concluir agora. Tente de novo.";
type Leitura = { estado: EstadoDaAssinatura | null; assinaturas_vivas: number; org_operante: boolean };

/**
 * As ações de Plano e cobrança (spec §7b–§7f, §9). Pagar em UM clique é o que
 * recupera a receita: o link da fatura aparece sempre que existe. "Já paguei"
 * relê o provedor na hora — quem pagou volta sozinho, sem esperar ninguém.
 */
export function AcoesDaAssinatura(p: PropsDasAcoes) {
  const t = useT();
  const idioma = useIdioma();
  const router = useRouter();
  const link = linkDePagamentoSeguro(p.linkDePagamento);
  const linkDoAjuste = linkDePagamentoSeguro(p.trocaPagamentoUrl);
  const [ocupado, setOcupado] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);
  const [trocando, setTrocando] = useState(false);
  // Nenhum plano pré-escolhido: o botão de confirmar só aparece depois da escolha e do que ela muda.
  const [novo, setNovo] = useState("");
  const [escolha, setEscolha] = useState<string | null>(null);
  const comparativo = p.comparativo ?? { planos: [], atual: null };
  const [cancelando, setCancelando] = useState(false);
  const [documento, setDocumento] = useState(p.documentoDoCadastro ?? "");
  // A fatura do Asaas que o Assinar acabou de gerar: abre numa NOVA aba, por um link
  // que a pessoa clica (popup aberto depois de um await é bloqueado no Safari).
  const [fatura, setFatura] = useState<string | null>(null);
  const releu = useRef(false);
  // Falso depois do desmonte: a espera da volta do checkout para, sem setState nem router.
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  const dia = (v: string | null) => (v ? formatadorDeData(idioma, p.fuso ?? null, { day: "2-digit", month: "2-digit" }).format(new Date(v)) : "");
  const selecionado = p.planosParaTroca.find((plano) => plano.id === novo) ?? null;
  // A MESMA conta da cobrança (`troca.ts`), mínimo do provedor incluído: abaixo
  // dele a tela diz "na próxima renovação", que é o que o servidor faz.
  const ajusteProporcional = !p.planoAtual || !selecionado
    ? 0
    : calcularAjusteProporcional({
        precoAtualCents: p.planoAtual.preco_cents,
        precoNovoCents: selecionado.preco_cents,
        periodoPagoDesde: p.periodoPagoDesde ? new Date(p.periodoPagoDesde) : null,
        proximoVencimento: p.proximoVencimento ? new Date(p.proximoVencimento) : null,
        agora: new Date(p.instanteCalculo),
        moeda: selecionado.moeda,
      });

  const emDivida = p.estado === "em_atraso" || p.estado === "cancelada";
  const podeAssinar = p.assinaturasVivas === 0 && p.estado !== "ativa";
  // Em atraso com assinatura viva e sem fatura pagável agora (pausada; incobrável
  // sem página): o único caminho é trocar o cartão no portal — e a tela diz isso.
  // O Asaas não tem portal: "gerenciar" seria o link da cobrança, que já é o Pagar agora.
  const temPortal = p.provedor !== "asaas";
  const soPeloPortal = temPortal && emDivida && p.temProvedor && p.assinaturasVivas > 0 && !link;
  // O Asaas só cria o cliente com CPF/CNPJ; quem já é cliente lá (reassinar) não digita de novo.
  const pedeDocumento = exigeDocumento(p.provedor, p.temProvedor);
  const documentoNormalizado = documentoDoPagador(documento);
  const documentoErrado = documento.trim() !== "" && documentoNormalizado === null;
  // A fatura do Asaas não devolve o cliente ao sistema: quem pagou o Pix volta à aba
  // que ficou aberta e relê aqui, sem esperar o cron — também no teste grátis.
  const aguardandoAsaas = p.provedor === "asaas" && (fatura !== null || (p.temProvedor && (p.estado === "trial" || link !== null)));
  // "Já paguei" só onde há o que reler: quem nunca assinou (teste que acabou) não pagou nada.
  const podeDizerQuePagou = (emDivida && p.temProvedor) || p.noHub || aguardandoAsaas || p.trocaPagamentoUrl !== null;
  // Etapa 3: com nada assinado no provedor, o "Assinar" é a escolha do plano (cards), e
  // ela substitui o botão único e a troca — um caminho só para sair do teste grátis.
  const planosParaAssinar = p.planosParaAssinar ?? [];
  const escolhendo = podeAssinar && p.escolheAoAssinar === true && planosParaAssinar.length > 0;
  const podeTrocar = !escolhendo && p.planosParaTroca.length > 0 && (p.estado === "trial" || p.estado === "ativa") && !p.cancelaNoFim && p.trocaStatus !== "criando";
  const frasesDoExcesso = (itens: readonly ItemDoExcesso[]) => itens.map((item) => preencherFrase(t(item.frase), item));
  // A troca mostra os planos da troca e o atual (marcado, sem botão); a escolha do Assinar, os oferecidos.
  const planosDaTroca = comparativo.planos.filter((plano) => plano.atual || p.planosParaTroca.some((x) => x.id === plano.id));
  const podeCancelar = p.temProvedor && p.assinaturasVivas > 0 && !p.cancelaNoFim && (p.estado === "ativa" || p.estado === "trial");

  async function agir(acao: () => Promise<void>) {
    setOcupado(true);
    setRecado(null);
    try {
      await acao();
    } catch (e) {
      const excesso = e instanceof ApiError && e.code === "plan_limit_reached" ? excessoDosDetalhes(e.details) : null;
      if (excesso) {
        setRecado([t("O uso atual não cabe no plano escolhido. Nada foi desconectado."), ...frasesDoExcesso(excesso)].join(" "));
      } else if (e instanceof ApiError && e.code === "plan_limit_reached") {
        const excedente = (e.details?.excedente ?? {}) as Record<string, number>;
        const passos = (Object.keys(FRASE_DO_EXCEDENTE) as Array<keyof typeof FRASE_DO_EXCEDENTE>)
          .filter((r) => (excedente[r] ?? 0) > 0)
          .map((r) => t(FRASE_DO_EXCEDENTE[r]).replace("{n}", String(excedente[r])));
        setRecado([t("O uso atual não cabe no plano escolhido. Para trocar, primeiro:"), ...passos].join(" "));
      } else if (e instanceof ApiError) {
        setRecado(t(FRASE_DO_ERRO[e.code] ?? FRASE_GENERICA));
      } else {
        showApiError(e);
      }
    } finally {
      if (montado.current) setOcupado(false);
    }
  }

  /** Relê o provedor. `true` = a empresa voltou a operar no hub (e já foi levada ao sistema). */
  async function reler(): Promise<boolean> {
    const { data: r } = await apiClient.post<{ data: Leitura }>(`${BASE}/sincronizar`, {});
    if (!montado.current) return true;
    if (p.noHub && r.org_operante) {
      router.push("/app");
      return true;
    }
    if (r.estado === "ativa") setRecado(t("Pagamento confirmado. Obrigado!"));
    else if (r.estado === "trial" && r.assinaturas_vivas > 0) setRecado(t("Tudo certo: a primeira cobrança sai no fim do teste grátis."));
    else setRecado(t("Ainda não identificamos o pagamento. Se pagou por boleto, a compensação leva até 1 dia útil."));
    router.refresh();
    return false;
  }

  /**
   * A volta do checkout. No hub, quem acabou de pagar não pode ver "suspensa" sem
   * retorno: relê até 3 vezes mais, a cada 30 s, dizendo que está confirmando
   * (o aviso do provedor costuma chegar em segundos; a reconciliação cura o resto).
   */
  async function confirmarNaVolta(): Promise<boolean> {
    for (let tentativa = 0; tentativa < (p.noHub ? 4 : 1); tentativa += 1) {
      if (tentativa > 0) {
        if (!montado.current) return true;
        setRecado(t("Confirmando seu pagamento…"));
        await new Promise((pronto) => setTimeout(pronto, 30_000));
        if (!montado.current) return true;
      }
      if (await reler()) return true;
    }
    return false;
  }

  useEffect(() => {
    if (!p.voltouDoCheckout || releu.current) return;
    releu.current = true;
    void agir(async () => {
      // Tira o ?voltou=1 da barra (recarregar não relê de novo) — salvo se a empresa já voltou e foi levada a /app.
      if (!(await confirmarNaVolta())) router.replace(p.noHub ? "/account-suspended" : "/app/settings/billing");
    });
    // agir/reler são recriadas a cada render; o ref garante uma leitura só.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.voltouDoCheckout]);

  /** O "Assinar": o plano atual, ou (etapa 3) o escolhido no card. */
  const assinar = (planoId?: string) =>
    void agir(async () => {
      const corpo = {
        ...(p.noHub ? { volta: "hub" } : {}),
        ...(pedeDocumento && documentoNormalizado !== null ? { documento: documentoNormalizado } : {}),
        ...(planoId ? { plano_id: planoId } : {}),
      };
      const { data: r } = await apiClient.post<{ data: { url: string } }>(`${BASE}/checkout`, corpo);
      if (p.provedor !== "asaas") return abrirNoNavegador(r.url);
      // O Asaas não devolve o cliente: a fatura vai para uma aba nova e esta fica, com o "Já paguei".
      setFatura(linkDePagamentoSeguro(r.url));
      router.refresh();
    });

  const gerenciar = () =>
    void agir(async () => {
      const { data: r } = await apiClient.post<{ data: { url: string } }>(`${BASE}/gerenciar`, {});
      abrirNoNavegador(r.url);
    });

  return (
    <div className={escolhendo || trocando ? "max-w-6xl space-y-3" : "max-w-xl space-y-3"}>
      {soPeloPortal && (
        <p className="text-sm">
          {t("Não há cobrança aberta para pagar agora. Atualize o cartão em Gerenciar pagamento: a próxima tentativa sai sozinha.")}
        </p>
      )}
      {podeAssinar && pedeDocumento && (
        <div className="space-y-1">
          <Label htmlFor="documento-de-quem-paga">{t("CPF ou CNPJ de quem paga")}</Label>
          <Input
            id="documento-de-quem-paga"
            className="max-w-xs"
            autoComplete="off"
            value={documento}
            onChange={(e) => setDocumento(e.target.value)}
            aria-invalid={documentoErrado}
            aria-describedby="documento-de-quem-paga-ajuda"
          />
          <p id="documento-de-quem-paga-ajuda" className="text-xs text-muted-foreground">
            {documentoErrado
              ? t("Confira o CPF ou CNPJ: os dígitos não batem.")
              : t("Vai direto para o Asaas, que emite a cobrança neste documento; não fica guardado neste sistema. Confira antes de assinar: para trocar depois, fale com quem administra o sistema.")}
          </p>
        </div>
      )}
      {fatura && (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          <p>{t("Sua fatura está pronta. Pague por Pix, boleto ou cartão.")}</p>
          <Button asChild>
            <a href={fatura} target="_blank" rel="noopener noreferrer">
              {t("Abrir a fatura")}
            </a>
          </Button>
        </div>
      )}
      {p.provedor === "asaas" && (fatura !== null || link !== null) && (
        <p className="text-xs text-muted-foreground">
          {t("A fatura abre no Asaas, numa nova aba. Depois de pagar, volte aqui e clique em Já paguei: Pix confirma em minutos; boleto, em até 1 dia útil.")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {soPeloPortal && (
          <Button disabled={ocupado} onClick={gerenciar}>
            {t("Gerenciar pagamento")}
          </Button>
        )}
        {link && (
          <Button asChild>
            <a href={link} target="_blank" rel="noopener noreferrer">
              {/* Asaas em dia: o link é a cobrança seguinte, gerada até 40 dias antes. "Pagar agora" ao lado de "Em dia" leria como dívida. */}
              {p.provedor === "asaas" && p.estado === "ativa" ? t("Adiantar a próxima mensalidade") : t("Pagar agora")}
            </a>
          </Button>
        )}
        {linkDoAjuste && (
          <Button asChild variant="outline">
            <a href={linkDoAjuste} target="_blank" rel="noopener noreferrer">{t("Pagar ajuste do upgrade")}</a>
          </Button>
        )}
        {podeAssinar && !escolhendo && (
          <Button
            disabled={ocupado || (pedeDocumento && documentoNormalizado === null)}
            variant={link ? "outline" : "default"}
            onClick={() => assinar()}
          >
            {t(p.estado === "cancelada" ? "Assinar de novo" : "Assinar")}
          </Button>
        )}
        {podeDizerQuePagou && (
          <Button
            variant="outline"
            disabled={ocupado}
            onClick={() =>
              void agir(async () => {
                await reler();
              })
            }
          >
            {t("Já paguei")}
          </Button>
        )}
        {temPortal && p.temProvedor && p.assinaturasVivas > 0 && !soPeloPortal && (
          <Button variant="outline" disabled={ocupado} onClick={gerenciar}>
            {t("Gerenciar pagamento")}
          </Button>
        )}
        {podeTrocar && !trocando && (
          <Button variant="outline" disabled={ocupado} onClick={() => setTrocando(true)}>
            {t("Trocar de plano")}
          </Button>
        )}
        {p.trocaStatus && (
          <p className="basis-full text-sm text-muted-foreground" role="status">
            {t(p.trocaStatus === "criando" ? "Estamos preparando o ajuste proporcional. Aguarde alguns segundos." : "Há um ajuste proporcional esperando pagamento. Escolher outro plano cancela esse ajuste.")}
          </p>
        )}
        {podeCancelar && !cancelando && (
          <Button variant="ghost" disabled={ocupado} onClick={() => setCancelando(true)}>
            {t("Cancelar assinatura")}
          </Button>
        )}
      </div>

      {escolhendo && (
        <section aria-labelledby="escolha-do-plano" className="space-y-3">
          <h2 id="escolha-do-plano" className="text-sm font-semibold">{t("Escolha seu plano")}</h2>
          <ComparativoDosPlanos
            planos={comparativo.planos}
            atual={comparativo.atual}
            atualEscolhivel
            iva={p.iva}
            selecionadoId={escolha}
            onEscolher={setEscolha}
            uso={p.uso}
            desabilitado={ocupado}
            confirmar={(plano, naoCabe) => (
              <Button
                disabled={ocupado || naoCabe || (pedeDocumento && documentoNormalizado === null)}
                onClick={() => assinar(plano.id)}
              >
                {t("Assinar {plano}").replace("{plano}", plano.nome)}
              </Button>
            )}
          />
        </section>
      )}

      {trocando && (
        <section aria-labelledby="troca-de-plano" className="space-y-3">
          <h2 id="troca-de-plano" className="text-sm font-semibold">{t("Trocar de plano")}</h2>
          <ComparativoDosPlanos
            planos={planosDaTroca}
            atual={comparativo.atual}
            iva={p.iva}
            selecionadoId={novo || null}
            onEscolher={setNovo}
            uso={p.uso}
            desabilitado={ocupado}
            confirmar={() => (
              <div className="space-y-3">
                {selecionado && selecionado.preco_cents > (p.planoAtual?.preco_cents ?? 0) && (
                  <p className="text-sm">
                    {ajusteProporcional === null
                      ? t("Não foi possível calcular o proporcional com os dados do período pago. Nenhuma troca será realizada.")
                      : ajusteProporcional === 0
                        ? `${t("O ajuste proporcional é zero; o novo plano entra na próxima renovação")}: ${dia(p.proximoVencimento)}.`
                        : `${t("Ajuste proporcional estimado para hoje")}: ${formatCents(ajusteProporcional, selecionado.moeda)}${p.iva ? ` ${t("+ IVA")}` : ""}. ${t("A data da próxima renovação permanece")}: ${dia(p.proximoVencimento)}.`}
                  </p>
                )}
                {selecionado && p.planoAtual && selecionado.preco_cents <= p.planoAtual.preco_cents && (
                  <p className="text-sm text-muted-foreground">{t("O plano escolhido e seus limites passam a valer na próxima renovação. A fatura atual mantém o valor e o vencimento.")}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={ocupado || !novo}
                    onClick={() =>
                      void agir(async () => {
                        const { data: r } = await apiClient.post<{ data: { quando: string; vale_a_partir_de: string | null; url_pagamento?: string | null } }>(`${BASE}/plano`, { plano_id: novo });
                        setTrocando(false);
                        if (r.url_pagamento) {
                          if (p.provedor === "asaas") setFatura(linkDePagamentoSeguro(r.url_pagamento));
                          else abrirNoNavegador(r.url_pagamento);
                          setRecado(t("Pague o ajuste proporcional para aplicar o novo plano. Seus limites atuais permanecem até a confirmação."));
                          return;
                        }
                        setRecado(
                          r.quando === "agendado" && r.vale_a_partir_de
                            ? t("O novo plano vale a partir de {data}.").replace("{data}", dia(r.vale_a_partir_de))
                            : t("Plano trocado."),
                        );
                        router.refresh();
                      })
                    }
                  >
                    {t("Confirmar troca")}
                  </Button>
                  <Button variant="ghost" disabled={ocupado} onClick={() => { setTrocando(false); setNovo(""); }}>
                    {t("Fechar")}
                  </Button>
                </div>
              </div>
            )}
          />
        </section>
      )}

      {cancelando && (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          <p>{t("Você mantém o acesso até o fim do período já pago. Não há reembolso proporcional.")}</p>
          <Button
            variant="destructive"
            disabled={ocupado}
            onClick={() =>
              void agir(async () => {
                const { data: r } = await apiClient.post<{ data: { acesso_ate: string | null } }>(`${BASE}/cancelar`, {});
                setCancelando(false);
                setRecado(t("Você mantém o acesso até {data}.").replace("{data}", dia(r.acesso_ate)));
                router.refresh();
              })
            }
          >
            {t("Confirmar cancelamento")}
          </Button>
        </div>
      )}

      {recado && (
        <p role="status" className="text-sm">
          {recado}
        </p>
      )}
    </div>
  );
}
