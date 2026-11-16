"use client";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { useConversationCounts } from "@/hooks/inbox/useConversationCounts";
import { useT } from "@/hooks/i18n/useT";
import { cn } from "@/lib/utils";

/**
 * Quantas conversas esperam uma PESSOA — o número ao lado de "Inbox" no menu.
 *
 * É a aba Fila: conversa sem dono em que o automático saiu de campo — a IA
 * passou a conversa para a equipe (cliente irritado, pedido de atendente,
 * reclamação) ou alguém a devolveu à fila. Medido numa loja (26/09/2026): a IA
 * passou duas conversas numa manhã e o dono só soube abrindo o Inbox e
 * procurando; pediu para "ver as transferências no menu". Reusa a MESMA
 * contagem das abas do Inbox (sem filtros, a chave do React Query é a mesma).
 */
export function ContadorDaFila({ compacto }: { compacto: boolean }) {
  const t = useT();
  const { activeOrg } = useAuth();
  const { data } = useConversationCounts(activeOrg?.orgId ?? null);
  const esperando = data?.fila ?? data?.unassigned ?? 0;
  if (!esperando) return null;
  const rotulo =
    esperando === 1 ? t("1 conversa esperando uma pessoa") : `${esperando} ${t("conversas esperando uma pessoa")}`;
  return (
    <span
      data-testid="contador-da-fila"
      aria-label={rotulo}
      title={rotulo}
      className={cn(
        "text-[11px] leading-[18px] font-semibold tabular-nums",
        compacto ? "absolute top-1 right-1 h-2 w-2 rounded-full bg-info" : "ml-auto h-[18px] min-w-[18px] rounded-full px-[5px] text-center bg-info-bg text-info-fg",
      )}
    >
      {compacto ? null : esperando}
    </span>
  );
}
