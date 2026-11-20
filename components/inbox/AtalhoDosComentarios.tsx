"use client";

/**
 * O atalho do Inbox para a tela de Comentários do Instagram.
 *
 * Só aparece para quem pode usar a tela (gerente e administrador) e só quando
 * a empresa tem a conexão direta com a Meta — a única que recebe comentários.
 * Para todo o resto ele não desenha NADA: a coluna da lista fica exatamente
 * como era, sem linha a mais.
 *
 * A lista de conexões é a mesma consulta que o filtro de canal do Inbox já faz
 * (`useChannelSessions`, mesma chave de cache): o atalho não acrescenta chamada.
 */
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { useT } from "@/hooks/i18n/useT";
import { roleAtLeast } from "@/lib/auth/types";
import { CHANNEL_PROVIDER_SOCIAL_DIRETO } from "@/lib/channels/capabilities";
import { ChatCircle } from "@/lib/ui/icons";

export function AtalhoDosComentarios() {
  const t = useT();
  const { user, activeOrg } = useAuth();
  const { data: sessoes } = useChannelSessions();
  const podeVer = (user.is_platform_admin && !user.support) || roleAtLeast(activeOrg?.role, "manager");
  const temConexaoDireta = (sessoes ?? []).some((s) => s.provider === CHANNEL_PROVIDER_SOCIAL_DIRETO);
  if (!podeVer || !temConexaoDireta) return null;

  return (
    <div className="px-3 pt-2" data-testid="atalho-dos-comentarios">
      <Button asChild variant="ghost" size="sm" className="w-full justify-center gap-2">
        <Link href="/app/inbox/comentarios">
          <ChatCircle size={16} weight="regular" aria-hidden />
          {t("Comentários do Instagram")}
        </Link>
      </Button>
    </div>
  );
}
