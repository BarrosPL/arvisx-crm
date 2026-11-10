/**
 * OS PLANOS NA PÁGINA INICIAL PÚBLICA (ArvisX, tarefa 2 dos planos).
 *
 * A landing mostra os planos que o dono oferece às empresas (`cobranca_planos`
 * vivos e `oferecido_ao_cliente`), com o preço e os textos do CADASTRO do
 * plano (migration 9803) — o código não tem preço nem texto de plano. Com o
 * IVA pela Stripe Tax ligado (`cobraIva`), o preço diz "+ IVA".
 *
 * Só leitura de colunas públicas por natureza (é o que a vitrine anuncia), pelo
 * cliente de serviço porque `cobranca_planos` não tem policy para anon. Nunca
 * lança: falha de leitura, cobrança desligada ou nenhum plano = lista vazia, e
 * a landing mostra a seção sem cards (o teste grátis continua).
 */
import { telasDoPlanoNoSeletor } from "@/lib/cobranca/comparativo";
import { cobraIva } from "@/lib/cobranca/configuracao";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PlanoDaVitrine {
  id: string;
  nome: string;
  preco_cents: number;
  moeda: string;
  intervalo: string;
  max_canais: number | null;
  max_assentos: number | null;
  descricao_curta: string | null;
  para_quem: string | null;
  destaques: string[];
  como_funciona: string | null;
  inclui_agentes_arvisx: boolean;
  /** Quantas telas o plano libera (para o "Mais completo"). */
  telas: string[];
}

export interface VitrineDePlanos {
  planos: PlanoDaVitrine[];
  iva: boolean;
}

export async function planosDaVitrine(): Promise<VitrineDePlanos> {
  try {
    const admin = createAdminClient();
    if (!(await moduloLigado(admin, "cobranca"))) return { planos: [], iva: false };
    const [lidos, iva] = await Promise.all([
      admin
        .from("cobranca_planos")
        .select(
          "id, nome, preco_cents, moeda, intervalo, max_canais, max_assentos, descricao_curta, para_quem, destaques, como_funciona, inclui_agentes_arvisx, interface_settings",
        )
        .is("arquivado_em", null)
        .eq("oferecido_ao_cliente", true)
        .order("preco_cents"),
      cobraIva(),
    ]);
    if (lidos.error) throw new Error(lidos.error.code ?? "sem_codigo");
    const planos = ((lidos.data ?? []) as Array<Omit<PlanoDaVitrine, "telas" | "destaques"> & { destaques: string[] | null; interface_settings: unknown }>).map(
      ({ interface_settings, destaques, ...p }) => ({
        ...p,
        destaques: destaques ?? [],
        inclui_agentes_arvisx: p.inclui_agentes_arvisx === true,
        telas: telasDoPlanoNoSeletor(interface_settings),
      }),
    );
    return { planos, iva };
  } catch (e) {
    logger.warn("landing.planos_ilegiveis", { erro: e instanceof Error ? e.message : String(e) });
    return { planos: [], iva: false };
  }
}
