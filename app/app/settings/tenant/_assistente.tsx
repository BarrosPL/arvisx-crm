"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { HEADER_ORG_DA_ABA, orgDaAba } from "@/lib/auth/org-da-aba";

interface Props {
  /** O que a empresa escolheu até agora. Sem escolha gravada, vale ligado. */
  ligadoNaEmpresa: boolean;
  /** O plano (ou a liberação da plataforma) dá direito ao assistente? */
  temDireito: boolean;
}

/**
 * A chave do assistente POR EMPRESA, em Configurações › Empresa.
 *
 * Este cartão só aparece quando o assistente está ligado na instalação: ele
 * decide se ESTA empresa o usa. Desligado, o botão do assistente some de todas
 * as telas e as rotas dele recusam. Manda só `ligado`; quem é a empresa o
 * servidor tira da sessão.
 */
export function AssistenteDaEmpresa({ ligadoNaEmpresa, temDireito }: Props) {
  const t = useT();
  const router = useRouter();
  const [ligado, setLigado] = useState(ligadoNaEmpresa);
  const [isPending, startTransition] = useTransition();

  function trocar() {
    const novo = !ligado;
    startTransition(async () => {
      const aba = orgDaAba();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (aba?.orgId) headers[HEADER_ORG_DA_ABA] = aba.orgId;
      const r = await fetch("/api/v1/assistente/configuracao", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ ligado: novo }),
      }).catch(() => null);
      if (!r || !r.ok) {
        toast.error(t("Não foi possível salvar."));
        return;
      }
      setLigado(novo);
      toast.success(novo ? t("Assistente ligado para a empresa.") : t("Assistente desligado para a empresa."));
      // O botão do assistente é montado pelo layout: atualizar para ele aparecer ou sumir já.
      router.refresh();
    });
  }

  return (
    <Card className="space-y-3 p-4" data-testid="assistente-da-empresa">
      <h2 className="text-sm font-medium">{t("Assistente")}</h2>
      <p className="max-w-2xl text-sm text-muted-foreground">
        {t(
          "O assistente tira dúvidas de uso, consulta os dados da empresa com a permissão de quem pergunta e mostra a tela certa. Desligado, o botão dele some de todas as telas para todos da empresa.",
        )}
      </p>
      {!temDireito ? (
        <p className="max-w-2xl text-sm text-muted-foreground" data-testid="assistente-sem-direito">
          {t("O plano da sua empresa não inclui o assistente. A escolha abaixo fica guardada, mas ele só aparece quando o plano o incluir.")}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <span className="text-sm" data-testid="assistente-estado">
          {ligado ? t("Ligado para a empresa") : t("Desligado para a empresa")}
        </span>
        <Button type="button" size="sm" variant={ligado ? "outline" : "default"} disabled={isPending} onClick={trocar} data-testid="assistente-trocar">
          {ligado ? t("Desligar o assistente") : t("Ligar o assistente")}
        </Button>
      </div>
    </Card>
  );
}
