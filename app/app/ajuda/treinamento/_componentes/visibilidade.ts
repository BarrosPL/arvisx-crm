"use client";

import { useMemo } from "react";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { telasLiberadasDaOrganizacao } from "@/lib/cobranca/telas-do-plano";

/**
 * As telas que o menu desta pessoa mostra — a MESMA régua do Sidebar, do hub
 * e do ⌘K (`telasLiberadasDaOrganizacao`: plano da empresa ∩ interface da
 * empresa e do vínculo, papel, módulos e capacidades ligados), lida do
 * AuthProvider — o servidor já entrega a interface com o recorte do plano. Um módulo do treinamento só aparece se a
 * tela dele está aqui. O `papel` da lição não entra: ele só diz com qual perfil
 * a foto foi tirada. Apresentação, nunca autorização.
 */
export function useTelasVisiveis(): ReadonlySet<string> {
  const { user, activeOrg } = useAuth();
  const plataforma = user.is_platform_admin && !user.support;
  const interfaceDaOrg = activeOrg?.interface_settings;
  const papel = activeOrg?.role ?? null;
  const modulos = activeOrg?.modulos_ligados;
  const capacidades = activeOrg?.capacidades_ligadas;
  return useMemo(
    () =>
      new Set(
        telasLiberadasDaOrganizacao(
          { interface_settings: interfaceDaOrg },
          plataforma,
          papel,
          modulos ?? [],
          capacidades ?? [],
        ).map((d) => d.href),
      ),
    [interfaceDaOrg, plataforma, papel, modulos, capacidades],
  );
}
