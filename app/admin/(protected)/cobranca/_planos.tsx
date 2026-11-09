"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InterfaceEditor } from "@/components/team/InterfaceEditor";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { cadastroExigeEscolhaDePlano } from "@/lib/cobranca/cadastro";
import { MOEDAS, type Intervalo, type Moeda } from "@/lib/cobranca/vocabulario";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import { formatCents, simboloDaMoeda } from "@/lib/money";
import { INTERFACE_COMPLETA, interfaceTemDestino, lerInterface, type InterfaceSettings } from "@/lib/navigation/interface";
import { novoPlanoSchema, PRECO_MINIMO_CENTS } from "@/lib/schemas/cobranca-plano";

/** Um plano de `cobranca_planos` como a tela o recebe (COLUNAS_DO_PLANO). */
export interface PlanoDaTela {
  id: string;
  nome: string;
  preco_cents: number;
  moeda: Moeda;
  intervalo: Intervalo;
  trial_dias: number;
  max_assentos: number | null;
  max_canais: number | null;
  teto_ia_usd_cents: number | null;
  padrao_no_cadastro: boolean;
  /** false = só o dono atribui (plano negociado): a empresa não o vê nem o escolhe. */
  oferecido_ao_cliente: boolean;
  /** As telas que o plano libera (migration 9802): `preset` + `destinos`. */
  interface_settings: unknown;
  arquivado_em: string | null;
}

interface Campos {
  nome: string;
  preco: string;
  moeda: Moeda;
  intervalo: Intervalo;
  trial_dias: string;
  max_assentos: string;
  max_canais: string;
  /** As telas do plano, no formato do `InterfaceEditor` (só `preset` e `destinos`). */
  telas: InterfaceSettings;
}

const VAZIO: Campos = { nome: "", preco: "", moeda: "BRL", intervalo: "mes", trial_dias: "14", max_assentos: "", max_canais: "", telas: INTERFACE_COMPLETA };

/** Só o que é do plano: `preset` e `destinos` (o resto da interface é da empresa). */
function telasDoPlano(raw: unknown): InterfaceSettings {
  const { preset, destinos } = lerInterface(raw).settings;
  return destinos ? { preset, destinos } : { preset };
}
const AVISO_DE_CAMPOS =
  "Confira os campos do plano: preço a partir de {minimo}, teste grátis de 0 a 90 dias e limites a partir de 1.";

const centavos = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);
const inteiroOuNulo = (v: string) => (v.trim() === "" ? null : Number(v));
const decimal = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/**
 * O corpo que as rotas de plano recebem. Campo de limite vazio = sem limite (null).
 * Sem `teto_ia_usd_cents` (ArvisX, etapa 3): o cliente usa a própria credencial de
 * IA e os planos novos não têm teto. A coluna fica no banco; criar deixa o default
 * (sem teto) e editar não a toca.
 */
function corpoDoPlano(c: Campos) {
  return {
    nome: c.nome.trim(),
    preco_cents: centavos(c.preco),
    moeda: c.moeda,
    intervalo: c.intervalo,
    trial_dias: Number(c.trial_dias),
    max_assentos: inteiroOuNulo(c.max_assentos),
    max_canais: inteiroOuNulo(c.max_canais),
    interface_settings: telasDoPlano(c.telas),
  };
}

function camposDe(p: PlanoDaTela): Campos {
  return {
    nome: p.nome,
    preco: decimal(p.preco_cents),
    moeda: p.moeda,
    intervalo: p.intervalo,
    trial_dias: String(p.trial_dias),
    max_assentos: p.max_assentos === null ? "" : String(p.max_assentos),
    max_canais: p.max_canais === null ? "" : String(p.max_canais),
    telas: telasDoPlano(p.interface_settings),
  };
}

/** "Completa", "Simplificada" ou "Personalizada (N áreas)" — o que o plano libera, numa linha. */
function resumoDasTelas(raw: unknown, t: (texto: string) => string): string {
  const { preset, destinos } = telasDoPlano(raw);
  if (destinos) return t("Personalizada ({n} áreas)").replace("{n}", String(destinos.length));
  return preset === "simplificada" ? t("Simplificada") : t("Completa");
}

/**
 * Planos da instalação (spec da cobrança §9, aba Planos): criar, editar,
 * arquivar e marcar o plano do cadastro. Quem recusa de verdade é a rota (e o
 * CHECK); o formulário só evita a ida e volta no erro óbvio.
 */
export function PlanosDaInstalacao({ planos }: { planos: readonly PlanoDaTela[] }) {
  const t = useT();
  const idioma = useIdioma();
  const router = useRouter();
  const [campos, setCampos] = useState<Campos>(VAZIO);
  const [editando, setEditando] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const usd = new Intl.NumberFormat(idioma, { style: "currency", currency: "USD" });
  const campo = (k: Exclude<keyof Campos, "intervalo" | "moeda" | "telas">) => ({
    value: campos[k],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setCampos({ ...campos, [k]: e.target.value }),
  });
  const limite = (n: number | null) => (n === null ? t("sem limite") : String(n));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const corpo = corpoDoPlano(campos);
    if (!interfaceTemDestino(corpo.interface_settings, "admin")) {
      toast.error(t("Selecione ao menos uma área de trabalho permitida ao papel."));
      return;
    }
    if (!novoPlanoSchema.safeParse(corpo).success) {
      toast.error(t(AVISO_DE_CAMPOS).replace("{minimo}", formatCents(PRECO_MINIMO_CENTS, campos.moeda)));
      return;
    }
    setSalvando(true);
    try {
      if (editando) await apiClient.patch(`/api/v1/admin/cobranca/planos/${editando}`, corpo);
      else await apiClient.post("/api/v1/admin/cobranca/planos", corpo);
      toast.success(t("Plano salvo."));
      setCampos(VAZIO);
      setEditando(null);
      router.refresh();
    } catch (err) {
      showApiError(err);
    } finally {
      setSalvando(false);
    }
  }

  async function mudar(id: string, corpo: Record<string, unknown>) {
    try {
      await apiClient.patch(`/api/v1/admin/cobranca/planos/${id}`, corpo);
      router.refresh();
    } catch (err) {
      showApiError(err);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <form onSubmit={salvar} className="space-y-3 rounded-lg border p-4" aria-label={editando ? t("Editar plano") : t("Novo plano")}>
        <h3 className="text-sm font-semibold">{editando ? t("Editar plano") : t("Novo plano")}</h3>
        <div className="space-y-1">
          <Label htmlFor="plano-nome">{t("Nome do plano")}</Label>
          <Input id="plano-nome" maxLength={60} {...campo("nome")} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="plano-preco">
              {t("Preço")} ({simboloDaMoeda(campos.moeda)})
            </Label>
            <Input id="plano-preco" inputMode="decimal" {...campo("preco")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="plano-moeda">{t("Moeda")}</Label>
            {/* Código ISO + símbolo: não se traduz (ver `simboloDaMoeda`). Com assinantes, a rota trava a moeda como o preço. */}
            <select
              id="plano-moeda"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={campos.moeda}
              onChange={(e) => setCampos({ ...campos, moeda: e.target.value as Moeda })}
            >
              {MOEDAS.map((m) => (
                <option key={m} value={m}>
                  {m} ({simboloDaMoeda(m)})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="plano-intervalo">{t("Intervalo de cobrança")}</Label>
          <select
            id="plano-intervalo"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={campos.intervalo}
            onChange={(e) => setCampos({ ...campos, intervalo: e.target.value as Intervalo })}
          >
            <option value="mes">{t("Mensal")}</option>
            <option value="ano">{t("Anual")}</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="plano-trial">{t("Dias de teste grátis")}</Label>
          <Input id="plano-trial" inputMode="numeric" aria-describedby="plano-trial-dica" {...campo("trial_dias")} />
          <p id="plano-trial-dica" className="text-xs text-muted-foreground">
            {t("0 = entrada paga: a empresa que entra neste plano fica suspensa até o primeiro pagamento.")}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="plano-assentos">{t("Máximo de pessoas")}</Label>
            <Input id="plano-assentos" inputMode="numeric" {...campo("max_assentos")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="plano-canais">{t("Máximo de números conectados")}</Label>
            <Input id="plano-canais" inputMode="numeric" {...campo("max_canais")} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("Deixe um limite vazio para não limitar.")}</p>
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("Telas liberadas no plano")}</p>
          <p className="text-xs text-muted-foreground">
            {t("O que a empresa deste plano pode usar. Perfil, segurança, equipe, plano e cobrança, Guia de uso e Ajuda valem em todo plano. Tela fora do plano some do menu e é recusada no servidor; nada é apagado.")}
          </p>
          <InterfaceEditor value={campos.telas} onChange={(telas) => setCampos({ ...campos, telas })} role="admin" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={salvando}>
            {editando ? t("Salvar alterações") : t("Salvar plano")}
          </Button>
          {editando && (
            <Button type="button" variant="ghost" onClick={() => { setEditando(null); setCampos(VAZIO); }}>
              {t("Cancelar edição")}
            </Button>
          )}
        </div>
      </form>

      <div className="space-y-2">
        {/* O critério do gatilho da 0679 (doc 146): com plano oferecido e sem padrão, quem se cadastra é obrigado a escolher. */}
        {cadastroExigeEscolhaDePlano({
          padraoId: planos.find((p) => p.padrao_no_cadastro && !p.arquivado_em)?.id ?? null,
          oferecidos: planos.filter((p) => p.oferecido_ao_cliente && !p.arquivado_em),
        }) && (
          <p role="status" className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/30 dark:bg-amber-950/20">
            {t("Nenhum plano está marcado para o cadastro. Quem se cadastra precisa escolher um plano, o “Entrar com Google” some da tela de cadastro e empresas criadas sem plano pela integração são recusadas. Use “Usar no cadastro” em um plano.")}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {t("O preço, a moeda e o intervalo de um plano travam quando alguém o assina: para mudar, arquive e crie outro.")}
        </p>
        {planos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("Nenhum plano ainda. Crie o primeiro no formulário acima: nome, preço, dias de teste grátis e, se quiser, os limites. Depois atribua-o a cada empresa no painel dela, em Tenants.")}
          </p>
        ) : (
          <ul className="space-y-2">
            {planos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium">
                    {p.nome}
                    {p.padrao_no_cadastro && <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-xs">{t("Plano do cadastro")}</span>}
                    {p.arquivado_em && <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-xs">{t("Arquivado")}</span>}
                    {!p.oferecido_ao_cliente && <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-xs">{t("Só você atribui")}</span>}
                  </p>
                  <p className="text-muted-foreground">
                    {formatCents(p.preco_cents, p.moeda)} {p.intervalo === "mes" ? t("por mês") : t("por ano")} · {p.trial_dias} {t("dias de teste")}
                  </p>
                  <p className="text-muted-foreground">
                    {t("Pessoas")}: {limite(p.max_assentos)} · {t("Números conectados")}: {limite(p.max_canais)}
                    {/* Teto de IA só de plano antigo: os novos não têm (sem campo no formulário). */}
                    {p.teto_ia_usd_cents !== null && <> · {t("IA")}: {usd.format(p.teto_ia_usd_cents / 100)}</>}
                  </p>
                  <p className="text-muted-foreground">
                    {t("Telas")}: {resumoDasTelas(p.interface_settings, t)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setEditando(p.id); setCampos(camposDe(p)); }}>
                    {t("Editar")}
                  </Button>
                  {!p.arquivado_em && (
                    <Button size="sm" variant="outline" onClick={() => mudar(p.id, { padrao_no_cadastro: !p.padrao_no_cadastro })}>
                      {p.padrao_no_cadastro ? t("Tirar do cadastro") : t("Usar no cadastro")}
                    </Button>
                  )}
                  {!p.arquivado_em && (
                    <Button size="sm" variant="outline" onClick={() => mudar(p.id, { oferecido_ao_cliente: !p.oferecido_ao_cliente })}>
                      {p.oferecido_ao_cliente ? t("Esconder das empresas") : t("Mostrar às empresas")}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => mudar(p.id, { arquivado: !p.arquivado_em })}>
                    {p.arquivado_em ? t("Desarquivar") : t("Arquivar")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
