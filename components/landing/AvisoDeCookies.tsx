"use client";

import { useSyncExternalStore } from "react";

const CHAVE = "arvisx-crm-aviso-cookies";

/**
 * Aviso de cookies da página inicial pública.
 *
 * A vitrine não tem rastreador nem analytics: só cookies necessários (sessão,
 * preferências e este próprio aviso). Por isso é um aviso, não um pedido de
 * consentimento — um botão só. Se um dia entrar analytics, este componente é
 * o lugar de virar "aceitar / recusar", antes de qualquer script carregar.
 *
 * A escolha fica no navegador da pessoa (`localStorage`) e nunca chega ao
 * servidor. `useSyncExternalStore` lê o armazenamento no próprio render e
 * reconcilia logo após a hidratação: o HTML do servidor vem sem o aviso
 * (`getServerSnapshot`) e o cliente o mostra só se ninguém o dispensou — sem
 * `setState` em efeito nem divergência de hidratação.
 */
type Ouvinte = () => void;
const ouvintes = new Set<Ouvinte>();

function assinar(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

function dispensado(): boolean {
  try {
    return localStorage.getItem(CHAVE) !== null;
  } catch {
    return false;
  }
}

function dispensar() {
  try {
    localStorage.setItem(CHAVE, new Date().toISOString());
  } catch {
    // navegador sem armazenamento: o aviso volta na próxima visita, e tudo bem
  }
  for (const ouvinte of ouvintes) ouvinte();
}

export function AvisoDeCookies() {
  // No servidor, "dispensado": o aviso nunca entra no HTML inicial.
  const jaDispensou = useSyncExternalStore(assinar, dispensado, () => true);
  if (jaDispensou) return null;

  return (
    <div className="aviso-cookies visivel" role="region" aria-label="Aviso de cookies">
      <p>
        Usamos apenas cookies necessários para o funcionamento do CRM e para lembrar as suas
        preferências. Nada de rastreamento. <a href="/privacidade-e-cookies">Saiba mais</a>.
      </p>
      <button className="btn primario" type="button" onClick={dispensar}>
        Entendi
      </button>
    </div>
  );
}
