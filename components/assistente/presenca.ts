"use client";

/**
 * O painel do Vix está montado nesta tela? A paleta de navegação (⌘K) pergunta
 * isto para oferecer a entrada "Perguntar ao assistente" só quando ele existe.
 *
 * Um valor de módulo com assinantes, e não contexto React: o painel e a paleta
 * moram em ramos diferentes da casca, e o único fato a compartilhar é um
 * booleano que muda quando o painel monta e desmonta.
 */
import { useSyncExternalStore } from "react";

let presente = false;
const assinantes = new Set<() => void>();

export function definirVixPresente(valor: boolean): void {
  if (presente === valor) return;
  presente = valor;
  for (const avisar of assinantes) avisar();
}

function assinar(avisar: () => void): () => void {
  assinantes.add(avisar);
  return () => assinantes.delete(avisar);
}

export function useVixPresente(): boolean {
  return useSyncExternalStore(
    assinar,
    () => presente,
    () => false,
  );
}

/** O evento que abre o painel. Quem o escuta é `PainelDoVix`. */
export const EVENTO_ABRIR_O_VIX = "vix:abrir";

export function abrirOVix(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_ABRIR_O_VIX));
}
