/**
 * O QUE O CLIENTE PERDE EM CADA PLANO (ArvisX, etapa 3 dos planos).
 *
 * A tela de assinatura (Plano e cobrança e a conta suspensa) mostra, para cada
 * plano oferecido, as telas que ele NÃO libera, comparando com a interface
 * "completa". A lista sai do catálogo (`NAV_CATALOG`, agrupado por `NAV_GROUPS`)
 * e do `interface_settings` do plano, pela MESMA régua da trava
 * (`destinosDoPlano`): o que aparece aqui como perdido é exatamente o que a
 * trava de página e de API recusaria. Nenhum texto solto: tela nova no catálogo
 * entra na lista sozinha.
 *
 * "Completa" é o que quem administra vê nesta instalação: o catálogo filtrado
 * pelo papel `admin` e pelos módulos opcionais LIGADOS (tela de módulo
 * desligado não é perda de plano nenhum). As portas essenciais nunca entram:
 * `destinosDoPlano` as devolve em todo plano.
 */
import { destinosDoPlano } from "@/lib/cobranca/telas-do-plano";
import type { ModuloOpcional } from "@/lib/instalacao/modulos";
import { NAV_GROUPS, type NavGroupId } from "@/lib/navigation/catalogo";
import { permitidos } from "@/lib/navigation/interface";

export interface GrupoQueOPlanoTira {
  grupo: NavGroupId;
  /** O rótulo do grupo no catálogo (pt-BR; a tela traduz). */
  rotulo: string;
  /** O plano não libera NENHUMA tela do grupo: a tela diz o grupo inteiro. */
  inteiro: boolean;
  /** Os rótulos das telas que ficam de fora, na ordem do catálogo (pt-BR; a tela traduz). */
  telas: string[];
}

/** Vazio = o plano libera tudo o que a interface completa mostra. */
export function oQueOPlanoTira(
  interfaceDoPlano: unknown,
  modulos?: readonly ModuloOpcional[],
): GrupoQueOPlanoTira[] {
  const liberadas = (destinosDoPlano({ tipo: "plano", interface: interfaceDoPlano }) ?? []) as readonly string[];
  const completa = permitidos(false, "admin", modulos);
  return NAV_GROUPS.flatMap((g) => {
    const doGrupo = completa.filter((d) => d.group === g.id);
    const fora = doGrupo.filter((d) => !liberadas.includes(d.href));
    if (fora.length === 0) return [];
    return [{ grupo: g.id, rotulo: g.label, inteiro: fora.length === doGrupo.length, telas: fora.map((d) => d.label) }];
  });
}
