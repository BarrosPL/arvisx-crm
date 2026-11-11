"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { ModoFiscal } from "@/lib/cobranca/vocabulario";

const MINIMO = 5;
const MAXIMO = 30;

/** As três opções do imposto (migration 9807), na ordem em que a tela as mostra. */
const OPCOES_DO_IMPOSTO: readonly { modo: ModoFiscal; titulo: string; texto: string }[] = [
  { modo: "desligado", titulo: "Desligado", texto: "Nenhum imposto no pagamento: o cliente paga o preço do plano." },
  {
    modo: "stripe_tax",
    titulo: "Stripe Tax",
    texto: "Você vende. O preço do plano é sem IVA e a Stripe soma o IVA na fatura. Exige o Stripe Tax ativo na sua conta.",
  },
  {
    modo: "managed_payments",
    titulo: "Managed Payments",
    texto: "A Stripe é a vendedora oficial e recolhe o IVA; taxa adicional da Stripe. Exige o Managed Payments ativo na conta e os produtos sincronizados (aba Planos).",
  },
];

/** A Régua (spec §7g, D-5): a tolerância, e a linha do tempo que a empresa vai viver com ela. */
export function ReguaDaCobranca({ tolerancia, modoFiscal }: { tolerancia: number; modoFiscal: ModoFiscal }) {
  const t = useT();
  const router = useRouter();
  const [dias, setDias] = useState(String(tolerancia));
  const [ocupado, setOcupado] = useState(false);
  const [modo, setModo] = useState<ModoFiscal>(modoFiscal);
  const n = Number(dias);
  const valido = Number.isInteger(n) && n >= MINIMO && n <= MAXIMO;
  const efetivo = valido ? n : tolerancia;

  async function salvar() {
    setOcupado(true);
    try {
      await apiClient.patch("/api/v1/admin/cobranca/regua", { tolerancia_dias: n, modo_fiscal: modo });
      toast.success(t("Régua salva."));
      router.refresh();
    } catch (e) {
      showApiError(e);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card className="max-w-2xl space-y-4 p-6">
      <div className="space-y-1">
        <Label htmlFor="tolerancia">{t("Dias de tolerância")}</Label>
        <Input id="tolerancia" type="number" min={MINIMO} max={MAXIMO} value={dias} onChange={(e) => setDias(e.target.value)} className="w-28" />
        <p className="text-xs text-muted-foreground">{t("De 5 a 30 dias. Abaixo de 5, quem paga boleto na sexta seria suspenso antes de o pagamento compensar.")}</p>
      </div>
      <ol className="space-y-1 text-sm">
        <li>{t("Dia 0: aviso de pagamento não identificado, com o link para pagar.")}</li>
        <li>{t("Dia {n}: aviso final, com a data da suspensão.").replace("{n}", String(efetivo - 2))}</li>
        <li>{t("Dia {n} (e pelo menos 48 horas depois do aviso final): a empresa é suspensa.").replace("{n}", String(efetivo))}</li>
        <li>{t("Pagou: volta a funcionar sozinha, na hora, sem disparar o que ficou parado.")}</li>
      </ol>
      <p className="text-xs text-muted-foreground">
        {t("Essa tolerância é para pagamento em atraso. O teste grátis que acaba sem pagamento não espera por ela: o aviso final sai no fim do teste e a suspensão acontece 48 horas depois.")}
      </p>
      <fieldset className="space-y-2 border-t pt-4">
        <legend className="pt-4 text-sm font-medium">{t("Imposto (IVA) na cobrança")}</legend>
        {OPCOES_DO_IMPOSTO.map((o) => (
          <label key={o.modo} className="flex items-start gap-2 text-sm">
            <input type="radio" name="modo-fiscal" className="mt-1" value={o.modo} checked={modo === o.modo} onChange={() => setModo(o.modo)} />
            <span>
              <span className="font-medium">{t(o.titulo)}</span>
              <span className="block text-xs text-muted-foreground">{t(o.texto)}</span>
            </span>
          </label>
        ))}
        <p className="text-xs text-muted-foreground">
          {t("Com imposto, as telas e a página inicial mostram \"+ IVA\". Plano marcado como fora do Managed Payments usa Stripe Tax. Só vale para a Stripe.")}
        </p>
      </fieldset>
      <Button disabled={ocupado || !valido} onClick={() => void salvar()}>
        {t("Salvar régua")}
      </Button>
    </Card>
  );
}
