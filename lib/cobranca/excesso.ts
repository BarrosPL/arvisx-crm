/**
 * O EXCESSO DE USO, EM FRASE (ArvisX, etapa 3 dos planos).
 *
 * Escolher um plano menor do que o uso de hoje é recusado (no Assinar e na
 * troca), e a recusa diz o número: "Você tem 5 números conectados, o plano
 * permite 3: desconecte 2 em Conexões." Nada é desconectado nem revogado
 * sozinho — quem decide o que sai é a empresa.
 *
 * A conta é a de `excedenteDoPlano` (`lib/cobranca/uso.ts`), que espelha os
 * gatilhos do banco (`fn_limite_do_plano`). As frases são modelos do
 * dicionário (pt-BR com `{uso}`, `{limite}`, `{n}`); quem desenha traduz e
 * preenche com `preencherFrase`.
 */
import type { Excedente, UsoDaOrganizacao } from "@/lib/cobranca/uso";

export const FRASE_DO_EXCESSO = {
  canais: "Você tem {uso} números conectados, o plano permite {limite}: desconecte {n} em Conexões.",
  assentos: "Você tem {uso} pessoas na equipe, o plano permite {limite}: revogue o acesso de {n} em Equipe.",
} as const;

export interface LimitesDoExcesso {
  assentos: number | null;
  canais: number | null;
}

export interface ItemDoExcesso {
  recurso: keyof typeof FRASE_DO_EXCESSO;
  /** O modelo da frase (chave do dicionário). */
  frase: string;
  uso: number;
  limite: number;
  n: number;
}

/** Os recursos que passam do plano, canais primeiro. Vazio = cabe. */
export function itensDoExcesso(excedente: Excedente, uso: UsoDaOrganizacao, limites: LimitesDoExcesso): ItemDoExcesso[] {
  return (["canais", "assentos"] as const).flatMap((recurso) => {
    const n = excedente[recurso] ?? 0;
    const limite = limites[recurso];
    if (n <= 0 || limite === null) return [];
    return [{ recurso, frase: FRASE_DO_EXCESSO[recurso], uso: uso[recurso], limite, n }];
  });
}

/** O modelo (já traduzido) com os números. */
export function preencherFrase(modelo: string, item: Pick<ItemDoExcesso, "uso" | "limite" | "n">): string {
  return modelo.replace("{uso}", String(item.uso)).replace("{limite}", String(item.limite)).replace("{n}", String(item.n));
}

/**
 * Lê o `details` do 409 `plan_limit_reached` do Assinar (`excedente`, `uso`,
 * `limites`). Sem `uso`/`limites` (a troca comum manda só `excedente`), `null`:
 * quem chama cai na frase antiga, que só diz quanto remover.
 */
export function excessoDosDetalhes(details: unknown): ItemDoExcesso[] | null {
  if (!details || typeof details !== "object") return null;
  const d = details as { excedente?: unknown; uso?: unknown; limites?: unknown };
  if (!d.excedente || !d.uso || !d.limites || typeof d.uso !== "object" || typeof d.limites !== "object") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const uso = d.uso as Record<string, unknown>;
  const limites = d.limites as Record<string, unknown>;
  const excedente = d.excedente as Record<string, unknown>;
  const itens = itensDoExcesso(
    { ...(num(excedente.canais) !== null ? { canais: num(excedente.canais)! } : {}), ...(num(excedente.assentos) !== null ? { assentos: num(excedente.assentos)! } : {}) },
    { canais: num(uso.canais) ?? 0, assentos: num(uso.assentos) ?? 0 },
    { canais: num(limites.canais), assentos: num(limites.assentos) },
  );
  return itens.length > 0 ? itens : null;
}
