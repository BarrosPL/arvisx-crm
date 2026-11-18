"use client";

/**
 * O QUESTIONÁRIO EM PASSOS da equipe pronta.
 *
 * Um passo por vez, e "Salvar e continuar" grava o rascunho daquele passo
 * (`respostasDoPasso`: os blocos dele, limpos). Quem sai no meio volta de onde
 * parou — o que foi salvo está no servidor, não no navegador.
 *
 * ⚠️ PREÇO E HORÁRIO NÃO SÃO PERGUNTADOS AQUI, de propósito: moram no catálogo
 * e na agenda, que os agentes consultam. O que este formulário pergunta é o
 * que muda o COMPORTAMENTO deles.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import type { OpcoesDaInstalacao } from "@/lib/ai/equipe-pronta/opcoes";
import {
  PASSOS_DO_QUESTIONARIO,
  passosComPendencia,
  respostasDoPasso,
  type PassoId,
} from "@/lib/ai/equipe-pronta/questionario";
import {
  SITUACOES_PADRAO_DE_HUMANO,
  salvarPerfilSchema,
  type RascunhoDoPerfil,
} from "@/lib/schemas/equipe-pronta";

/** As respostas como o formulário as segura: blocos de campos soltos. */
export type Formulario = Record<string, Record<string, unknown> | undefined>;

const SELECT = "h-9 w-full rounded-md border bg-background px-3 text-sm";

interface Props {
  passo: PassoId;
  respostas: Formulario;
  faltam: readonly string[];
  opcoes: OpcoesDaInstalacao;
  ocupado: boolean;
  aoSalvar: (passo: PassoId, respostas: Formulario) => Promise<boolean>;
  aoIrPara: (passo: PassoId) => void;
  aoRevisar: () => void;
  aoVerPainel?: () => void;
}

export function Questionario({
  passo,
  respostas,
  faltam,
  opcoes,
  ocupado,
  aoSalvar,
  aoIrPara,
  aoRevisar,
  aoVerPainel,
}: Props) {
  const t = useT();
  const [form, setForm] = useState<Formulario>(respostas);
  const [erro, setErro] = useState<string | null>(null);

  const indice = PASSOS_DO_QUESTIONARIO.findIndex((p) => p.id === passo);
  const atual = PASSOS_DO_QUESTIONARIO[indice]!;
  const pendentes = new Set(passosComPendencia(faltam));
  const ultimo = indice === PASSOS_DO_QUESTIONARIO.length - 1;

  const bloco = (nome: string) => form[nome] ?? {};
  const mudar = (nome: string, parte: Record<string, unknown>) =>
    setForm((f) => ({ ...f, [nome]: { ...(f[nome] ?? {}), ...parte } }));
  const texto = (nome: string, campo: string, padrao = "") => {
    const v = bloco(nome)[campo];
    return typeof v === "string" ? v : padrao;
  };
  const numero = (nome: string, campo: string, padrao: number) => {
    const v = bloco(nome)[campo];
    return typeof v === "number" ? String(v) : v === "" ? "" : String(padrao);
  };
  const marcado = (nome: string, campo: string, padrao: boolean) => {
    const v = bloco(nome)[campo];
    return typeof v === "boolean" ? v : padrao;
  };
  const lista = (nome: string, campo: string, padrao: readonly string[] = []) => {
    const v = bloco(nome)[campo];
    return (Array.isArray(v) ? (v as string[]) : padrao).join("\n");
  };
  const inteiro = (bruto: string): number | "" => {
    const n = Number.parseInt(bruto, 10);
    return Number.isFinite(n) ? n : "";
  };

  async function salvar() {
    setErro(null);
    // Os campos de número e de lista têm padrão na tela: o que a pessoa VIU é o
    // que vai, mesmo sem ter tocado no campo.
    const comPadroes: Formulario = { ...form };
    if (passo === "regras") {
      comPadroes.humano = {
        ...bloco("humano"),
        situacoes: lista("humano", "situacoes", SITUACOES_PADRAO_DE_HUMANO).split("\n"),
      };
    }
    const corpo = respostasDoPasso(passo, comPadroes as RascunhoDoPerfil);
    const conferido = salvarPerfilSchema.safeParse({ respostas: corpo });
    if (!conferido.success) {
      const campos = [...new Set(conferido.error.issues.map((i) => i.path.slice(1).join(" › ")))];
      setErro(`${t("Confira o que foi preenchido em:")} ${campos.join(", ")}`);
      return;
    }
    await aoSalvar(passo, corpo as Formulario);
  }

  // ── a agenda principal (união: existente, criar, ou nenhuma) ────────────
  const agenda = bloco("primeiro_passo").agenda as Record<string, unknown> | undefined;
  const modoDaAgenda = agenda?.modo === "existente" || agenda?.modo === "criar" ? (agenda.modo as string) : "nenhuma";
  const mudarAgenda = (valor: Record<string, unknown> | undefined) => mudar("primeiro_passo", { agenda: valor });

  // ── o desconto (união: nunca, ou com aprovação até X%) ──────────────────
  const desconto = (bloco("regras").desconto as Record<string, unknown> | undefined) ?? { modo: "nunca" };

  // ── o funil escolhido e as etapas dele ─────────────────────────────────
  const funilEscolhido =
    opcoes.funis.find((f) => f.id === bloco("onde").pipeline_id) ?? (opcoes.funis.length === 1 ? opcoes.funis[0] : undefined);
  const etapas = (bloco("onde").etapas as Record<string, string> | undefined) ?? {};

  return (
    <div className="grid max-w-5xl gap-6 md:grid-cols-[14rem_1fr]" data-testid="ep-questionario">
      <nav aria-label={t("Passos do questionário")}>
        <ol className="space-y-1">
          {PASSOS_DO_QUESTIONARIO.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => aoIrPara(p.id)}
                aria-current={p.id === passo ? "step" : undefined}
                data-testid={`ep-ir-${p.id}`}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${
                  p.id === passo ? "bg-muted font-medium" : "hover:bg-muted/60"
                }`}
              >
                <span>
                  {i + 1}. {t(p.titulo)}
                </span>
                {pendentes.has(p.id) ? (
                  <span className="text-xs text-destructive" data-testid={`ep-pendente-${p.id}`}>
                    {t("falta")}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={aoRevisar}
              data-testid="ep-ir-revisao"
              className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted/60"
            >
              {PASSOS_DO_QUESTIONARIO.length + 1}. {t("Revisar e instalar")}
            </button>
          </li>
        </ol>
        {aoVerPainel ? (
          <Button type="button" variant="outline" size="sm" className="mt-4 w-full" onClick={aoVerPainel}>
            {t("Voltar à equipe")}
          </Button>
        ) : null}
      </nav>

      <form
        className="space-y-5"
        data-testid={`ep-passo-${passo}`}
        onSubmit={(e) => {
          e.preventDefault();
          void salvar();
        }}
      >
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">{t(atual.titulo)}</h2>
          <p className="text-sm text-muted-foreground">{t(atual.resumo)}</p>
        </header>

        {passo === "negocio" ? (
          <>
            <Campo id="ep-negocio-nome" rotulo={t("Nome da empresa")} obrigatorio>
              <Input
                id="ep-negocio-nome"
                maxLength={120}
                value={texto("negocio", "nome")}
                onChange={(e) => mudar("negocio", { nome: e.target.value })}
              />
            </Campo>
            <Campo
              id="ep-negocio-o-que-faz"
              rotulo={t("O que a empresa faz")}
              ajuda={t("Em poucas linhas, como você explicaria a um cliente novo. Não escreva preço nem horário aqui.")}
              obrigatorio
            >
              <Textarea
                id="ep-negocio-o-que-faz"
                rows={4}
                maxLength={1000}
                value={texto("negocio", "o_que_faz")}
                onChange={(e) => mudar("negocio", { o_que_faz: e.target.value })}
              />
            </Campo>
            <Campo id="ep-negocio-cidade" rotulo={t("Cidade")}>
              <Input
                id="ep-negocio-cidade"
                maxLength={120}
                value={texto("negocio", "cidade")}
                onChange={(e) => mudar("negocio", { cidade: e.target.value })}
              />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id="ep-negocio-fuso" rotulo={t("Fuso horário")}>
                <Input
                  id="ep-negocio-fuso"
                  maxLength={64}
                  value={texto("negocio", "fuso", "America/Sao_Paulo")}
                  onChange={(e) => mudar("negocio", { fuso: e.target.value })}
                />
              </Campo>
              <Campo id="ep-negocio-idioma" rotulo={t("Idioma do atendimento")}>
                <select
                  id="ep-negocio-idioma"
                  className={SELECT}
                  value={texto("negocio", "idioma", "pt-BR")}
                  onChange={(e) => mudar("negocio", { idioma: e.target.value })}
                >
                  <option value="pt-BR">{t("Português")}</option>
                  <option value="es">{t("Espanhol")}</option>
                  <option value="en">{t("Inglês")}</option>
                </select>
              </Campo>
            </div>
          </>
        ) : null}

        {passo === "atendente" ? (
          <>
            <Campo
              id="ep-atendente-nome"
              rotulo={t("Nome do atendente")}
              ajuda={t("O nome com que os agentes se apresentam a quem escreve.")}
              obrigatorio
            >
              <Input
                id="ep-atendente-nome"
                maxLength={60}
                value={texto("atendente", "nome")}
                onChange={(e) => mudar("atendente", { nome: e.target.value })}
              />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id="ep-atendente-tom" rotulo={t("Jeito de falar")}>
                <select
                  id="ep-atendente-tom"
                  className={SELECT}
                  value={texto("atendente", "tom", "profissional")}
                  onChange={(e) => mudar("atendente", { tom: e.target.value })}
                >
                  <option value="caloroso">{t("Caloroso")}</option>
                  <option value="profissional">{t("Profissional")}</option>
                  <option value="direto">{t("Direto")}</option>
                </select>
              </Campo>
              <Campo
                id="ep-atendente-como-chamar"
                rotulo={t("Como você chama quem escreve")}
                ajuda={t("Cliente, paciente, aluno: a palavra que a sua empresa usa.")}
              >
                <Input
                  id="ep-atendente-como-chamar"
                  maxLength={40}
                  value={texto("atendente", "como_chamar", "cliente")}
                  onChange={(e) => mudar("atendente", { como_chamar: e.target.value })}
                />
              </Campo>
            </div>
          </>
        ) : null}

        {passo === "venda" ? (
          <>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                {t("Qual é o primeiro passo que leva à venda?")} <span className="text-destructive">*</span>
              </legend>
              {(
                [
                  ["agendar", t("Marcar um horário")],
                  ["proposta", t("Enviar uma proposta")],
                  ["humano", t("Passar para uma pessoa da equipe")],
                ] as const
              ).map(([valor, rotulo]) => (
                <label key={valor} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="ep-primeiro-passo"
                    data-testid={`ep-primeiro-passo-${valor}`}
                    checked={bloco("primeiro_passo").tipo === valor}
                    onChange={() => mudar("primeiro_passo", { tipo: valor })}
                  />
                  {rotulo}
                </label>
              ))}
            </fieldset>

            <Campo
              id="ep-agenda-modo"
              rotulo={t("Agenda principal")}
              ajuda={t("Os horários continuam na Agenda. Aqui você só diz qual tipo de atendimento os agentes marcam.")}
            >
              <select
                id="ep-agenda-modo"
                className={SELECT}
                value={modoDaAgenda}
                onChange={(e) => {
                  const modo = e.target.value;
                  if (modo === "nenhuma") mudarAgenda(undefined);
                  else if (modo === "existente") mudarAgenda({ modo, event_type_id: opcoes.tiposDeAgenda[0]?.id ?? "" });
                  else mudarAgenda({ modo, nome: "", duracao_minutos: 30, pago: false });
                }}
              >
                <option value="nenhuma">{t("A empresa não agenda")}</option>
                {opcoes.tiposDeAgenda.length > 0 ? (
                  <option value="existente">{t("Usar um tipo de atendimento que já existe")}</option>
                ) : null}
                <option value="criar">{t("Criar um tipo de atendimento")}</option>
              </select>
            </Campo>
            {modoDaAgenda === "existente" ? (
              <Campo id="ep-agenda-tipo" rotulo={t("Tipo de atendimento")}>
                <select
                  id="ep-agenda-tipo"
                  className={SELECT}
                  value={String(agenda?.event_type_id ?? "")}
                  onChange={(e) => mudarAgenda({ modo: "existente", event_type_id: e.target.value })}
                >
                  {opcoes.tiposDeAgenda.map((tipo) => (
                    <option key={tipo.id} value={tipo.id}>
                      {tipo.nome}
                    </option>
                  ))}
                </select>
              </Campo>
            ) : null}
            {modoDaAgenda === "criar" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo id="ep-agenda-nome" rotulo={t("Nome do atendimento")}>
                  <Input
                    id="ep-agenda-nome"
                    maxLength={80}
                    value={String(agenda?.nome ?? "")}
                    onChange={(e) => mudarAgenda({ ...agenda, nome: e.target.value })}
                  />
                </Campo>
                <Campo id="ep-agenda-duracao" rotulo={t("Duração em minutos")}>
                  <Input
                    id="ep-agenda-duracao"
                    type="number"
                    min={5}
                    max={480}
                    value={String(agenda?.duracao_minutos ?? 30)}
                    onChange={(e) => mudarAgenda({ ...agenda, duracao_minutos: inteiro(e.target.value) })}
                  />
                </Campo>
                <Marcar
                  id="ep-agenda-pago"
                  rotulo={t("Este atendimento é pago")}
                  ajuda={t("O valor não é pedido aqui: ele fica no catálogo.")}
                  marcado={agenda?.pago === true}
                  aoMudar={(v) => mudarAgenda({ ...agenda, pago: v })}
                />
              </div>
            ) : null}

            <Marcar
              id="ep-oferta-preco"
              rotulo={t("Os agentes podem informar preço por mensagem")}
              ajuda={t("Quando ligado, o preço vem do catálogo de produtos. Desligado, eles encaminham sem dizer valor.")}
              marcado={marcado("oferta", "informa_preco_por_mensagem", false)}
              aoMudar={(v) => mudar("oferta", { informa_preco_por_mensagem: v })}
            />
            <Marcar
              id="ep-proposta-usa"
              rotulo={t("A empresa envia proposta")}
              marcado={marcado("proposta", "usa", true)}
              aoMudar={(v) => mudar("proposta", { usa: v })}
            />
            {marcado("proposta", "usa", true) ? (
              <Campo id="ep-proposta-validade" rotulo={t("Validade da proposta, em dias")}>
                <Input
                  id="ep-proposta-validade"
                  type="number"
                  min={1}
                  max={180}
                  className="max-w-32"
                  value={numero("proposta", "validade_dias", 7)}
                  onChange={(e) => mudar("proposta", { validade_dias: inteiro(e.target.value) })}
                />
              </Campo>
            ) : null}
          </>
        ) : null}

        {passo === "regras" ? (
          <>
            <Campo
              id="ep-qualificacao-perguntas"
              rotulo={t("Perguntas para quem chega")}
              ajuda={t("Uma por linha, até cinco. São as perguntas que ajudam a entender o que a pessoa precisa.")}
            >
              <Textarea
                id="ep-qualificacao-perguntas"
                rows={4}
                value={lista("qualificacao", "perguntas")}
                onChange={(e) => mudar("qualificacao", { perguntas: e.target.value.split("\n") })}
              />
            </Campo>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("Desconto")}</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="ep-desconto"
                  data-testid="ep-desconto-nunca"
                  checked={desconto.modo !== "com_aprovacao"}
                  onChange={() => mudar("regras", { desconto: { modo: "nunca" } })}
                />
                {t("Os agentes nunca oferecem desconto")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="ep-desconto"
                  data-testid="ep-desconto-com-aprovacao"
                  checked={desconto.modo === "com_aprovacao"}
                  onChange={() => mudar("regras", { desconto: { modo: "com_aprovacao", ate_percentual: 10 } })}
                />
                {t("Só com aprovação de uma pessoa da equipe")}
              </label>
              {desconto.modo === "com_aprovacao" ? (
                <Campo id="ep-desconto-percentual" rotulo={t("Até quantos por cento")}>
                  <Input
                    id="ep-desconto-percentual"
                    type="number"
                    min={1}
                    max={100}
                    className="max-w-32"
                    value={String(desconto.ate_percentual ?? "")}
                    onChange={(e) =>
                      mudar("regras", {
                        desconto: { modo: "com_aprovacao", ate_percentual: inteiro(e.target.value) },
                      })
                    }
                  />
                </Campo>
              ) : null}
            </fieldset>

            <Campo
              id="ep-regras-pagamento"
              rotulo={t("Formas de pagamento")}
              ajuda={t("Vai para a base de conhecimento, de onde os agentes respondem.")}
            >
              <Textarea
                id="ep-regras-pagamento"
                rows={3}
                maxLength={1000}
                value={texto("regras", "formas_de_pagamento")}
                onChange={(e) => mudar("regras", { formas_de_pagamento: e.target.value })}
              />
            </Campo>

            <Campo
              id="ep-humano-situacoes"
              rotulo={t("Quando chamar uma pessoa da equipe")}
              ajuda={t("Uma situação por linha.")}
            >
              <Textarea
                id="ep-humano-situacoes"
                rows={4}
                value={lista("humano", "situacoes", SITUACOES_PADRAO_DE_HUMANO)}
                onChange={(e) => mudar("humano", { situacoes: e.target.value.split("\n") })}
              />
            </Campo>
            <Campo
              id="ep-humano-palavras"
              rotulo={t("Palavras que passam a conversa para uma pessoa")}
              ajuda={t("Uma por linha. Quando quem escreve usa uma delas, o agente para e chama a equipe.")}
            >
              <Textarea
                id="ep-humano-palavras"
                rows={3}
                value={lista("humano", "palavras")}
                onChange={(e) => mudar("humano", { palavras: e.target.value.split("\n") })}
              />
            </Campo>
          </>
        ) : null}

        {passo === "recuperacao" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo
                id="ep-recuperacao-esfriar"
                rotulo={t("Dias sem resposta até o primeiro retorno")}
                ajuda={t("De 1 a 6.")}
              >
                <Input
                  id="ep-recuperacao-esfriar"
                  type="number"
                  min={1}
                  max={6}
                  value={numero("recuperacao", "dias_para_esfriar", 3)}
                  onChange={(e) => mudar("recuperacao", { dias_para_esfriar: inteiro(e.target.value) })}
                />
              </Campo>
              <Campo id="ep-recuperacao-toques" rotulo={t("Quantas vezes voltar a falar")} ajuda={t("De 1 a 4.")}>
                <Input
                  id="ep-recuperacao-toques"
                  type="number"
                  min={1}
                  max={4}
                  value={numero("recuperacao", "toques_maximos", 2)}
                  onChange={(e) => mudar("recuperacao", { toques_maximos: inteiro(e.target.value) })}
                />
              </Campo>
              <Campo id="ep-recuperacao-intervalo" rotulo={t("Dias entre um retorno e outro")}>
                <Input
                  id="ep-recuperacao-intervalo"
                  type="number"
                  min={1}
                  max={30}
                  value={numero("recuperacao", "intervalo_dias", 2)}
                  onChange={(e) => mudar("recuperacao", { intervalo_dias: inteiro(e.target.value) })}
                />
              </Campo>
              <Campo
                id="ep-recuperacao-frio"
                rotulo={t("Dias parado até contar como contato frio")}
                ajuda={t("De 7 a 365.")}
              >
                <Input
                  id="ep-recuperacao-frio"
                  type="number"
                  min={7}
                  max={365}
                  value={numero("recuperacao", "limite_lead_frio_dias", 30)}
                  onChange={(e) => mudar("recuperacao", { limite_lead_frio_dias: inteiro(e.target.value) })}
                />
              </Campo>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("O retorno para sozinho quando a pessoa responde.")}
            </p>
            <Campo
              id="ep-faq-texto"
              rotulo={t("Perguntas frequentes e políticas")}
              ajuda={t("Cole aqui o que os clientes mais perguntam e as respostas. Vira a base de conhecimento dos agentes.")}
            >
              <Textarea
                id="ep-faq-texto"
                rows={8}
                maxLength={20000}
                value={texto("faq", "texto")}
                onChange={(e) => mudar("faq", { texto: e.target.value })}
              />
            </Campo>
            <Marcar
              id="ep-ligacoes"
              rotulo={t("Os agentes podem ligar para o contato")}
              ajuda={t("Só tem efeito se a empresa já usa o módulo de ligações.")}
              marcado={marcado("ligacoes", "pode_ligar", false)}
              aoMudar={(v) => mudar("ligacoes", { pode_ligar: v })}
            />
          </>
        ) : null}

        {passo === "onde" ? (
          <>
            {opcoes.canais.length === 0 ? (
              <p className="rounded-md border p-3 text-sm" data-testid="ep-sem-canal">
                {t("Nenhum WhatsApp conectado ainda. Você pode instalar agora e conectar depois, em Conexões.")}
              </p>
            ) : (
              <Campo id="ep-onde-canal" rotulo={t("WhatsApp em que a equipe atende")}>
                <select
                  id="ep-onde-canal"
                  className={SELECT}
                  value={texto("onde", "channel_session_id")}
                  onChange={(e) => mudar("onde", { channel_session_id: e.target.value })}
                >
                  {opcoes.canais.length === 1 ? null : <option value="">{t("Escolha")}</option>}
                  {opcoes.canais.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                      {c.conectado ? "" : ` (${t("desconectado")})`}
                    </option>
                  ))}
                </select>
              </Campo>
            )}

            {opcoes.funis.length > 0 ? (
              <Campo id="ep-onde-funil" rotulo={t("Funil em que a equipe trabalha")}>
                <select
                  id="ep-onde-funil"
                  className={SELECT}
                  value={texto("onde", "pipeline_id")}
                  onChange={(e) => mudar("onde", { pipeline_id: e.target.value, etapas: {} })}
                >
                  {opcoes.funis.length === 1 ? null : <option value="">{t("Escolha")}</option>}
                  {opcoes.funis.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
              </Campo>
            ) : null}

            {funilEscolhido ? (
              <div className="grid gap-4 sm:grid-cols-3">
                {(
                  [
                    ["qualificado", t("Etapa de quem foi qualificado")],
                    ["proposta", t("Etapa de proposta enviada")],
                    ["perdido", t("Etapa de venda perdida")],
                  ] as const
                ).map(([passoDoFunil, rotulo]) => (
                  <Campo key={passoDoFunil} id={`ep-etapa-${passoDoFunil}`} rotulo={rotulo}>
                    <select
                      id={`ep-etapa-${passoDoFunil}`}
                      className={SELECT}
                      value={etapas[passoDoFunil] ?? ""}
                      onChange={(e) =>
                        mudar("onde", { etapas: { ...etapas, [passoDoFunil]: e.target.value } })
                      }
                    >
                      <option value="">{t("Não mexer")}</option>
                      {funilEscolhido.etapas
                        .filter((e) => (passoDoFunil === "perdido" ? e.perdida : !e.perdida))
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.nome}
                          </option>
                        ))}
                    </select>
                  </Campo>
                ))}
              </div>
            ) : null}

            <Campo
              id="ep-onde-telefones"
              rotulo={t("Telefones de teste")}
              ajuda={t("Um por linha, com o código do país: +5511999990000. Enquanto a equipe está em ensaio, só estes números falam com ela.")}
            >
              <Textarea
                id="ep-onde-telefones"
                rows={3}
                value={lista("onde", "telefones_de_teste")}
                onChange={(e) => mudar("onde", { telefones_de_teste: e.target.value.split("\n") })}
              />
            </Campo>
          </>
        ) : null}

        {erro ? (
          <p className="text-sm text-destructive" role="alert" data-testid="ep-erro">
            {erro}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-2">
          {indice > 0 ? (
            <Button
              type="button"
              variant="outline"
              disabled={ocupado}
              onClick={() => aoIrPara(PASSOS_DO_QUESTIONARIO[indice - 1]!.id)}
            >
              {t("Voltar")}
            </Button>
          ) : null}
          <Button type="submit" disabled={ocupado} data-testid="ep-salvar">
            {ultimo ? t("Salvar e revisar") : t("Salvar e continuar")}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Campo({
  id,
  rotulo,
  ajuda,
  obrigatorio,
  children,
}: {
  id: string;
  rotulo: string;
  ajuda?: string;
  obrigatorio?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {rotulo}
        {obrigatorio ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {ajuda ? <p className="text-xs text-muted-foreground">{ajuda}</p> : null}
    </div>
  );
}

function Marcar({
  id,
  rotulo,
  ajuda,
  marcado,
  aoMudar,
}: {
  id: string;
  rotulo: string;
  ajuda?: string;
  marcado: boolean;
  aoMudar: (valor: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
        <input id={id} type="checkbox" checked={marcado} onChange={(e) => aoMudar(e.target.checked)} />
        {rotulo}
      </label>
      {ajuda ? <p className="pl-6 text-xs text-muted-foreground">{ajuda}</p> : null}
    </div>
  );
}
