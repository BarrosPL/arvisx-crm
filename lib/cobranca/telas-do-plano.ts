/**
 * AS TELAS DO PLANO — a régua única (ArvisX, etapa 2 dos planos; migration 9802).
 *
 * O plano de cobrança guarda um `interface_settings` (`preset` + `destinos`) no
 * MESMO formato do `InterfaceEditor` de /admin/tenants/new. Daqui sai, num lugar
 * só, o que cada empresa pode usar:
 *
 *  - o MENU (sidebar, hubs, ⌘K, barra de baixo, Guia de uso): `resolveActiveOrg`
 *    pendura a lista na interface da sessão (`comTelasDoPlano`), e
 *    `destinosDaInterface` faz a interseção plano ∩ empresa ∩ vínculo;
 *  - a TRAVA DE PÁGINA (`proxy.ts`), a TRAVA DE API (`requireRole`, `resolveAuthDual`)
 *    e o MOTOR DE IA e os crons — todos chamam `destinosDoPlano`/`planoLibera`.
 *
 * ── As três respostas da leitura ─────────────────────────────────────────────
 *  - `isenta`: cobrança desligada na instalação, ou a empresa não tem assinatura
 *    (como a Você na Europa hoje). TODAS as telas; nada muda para ela.
 *  - `plano`: o recorte do plano, MAIS as portas essenciais (perfil, segurança,
 *    notificações, app, equipe, empresa, plano e cobrança, Guia de uso, Ajuda),
 *    que nenhum plano tira.
 *  - `falha`: a leitura não respondeu. ⚠️ DECISÃO DE FALHA, escrita aqui de
 *    propósito: mantém o ATENDIMENTO (o preset `simplificada` — Inbox, Agenda,
 *    Funis, Contatos, Tarefas, Conexões, que é o plano Essencial) e as portas
 *    essenciais, e fecha o resto até a próxima leitura. NUNCA derruba o Inbox
 *    nem o recebimento de mensagens: webhooks de entrada e gravação de mensagem
 *    não passam por esta régua. O motor de IA e os crons têm decisão própria
 *    para a falha (`planoIncluiIaParaOMotor`, `planoLiberaParaCron`): seguem.
 *
 * Nada aqui lança. Nada aqui apaga dado: tela fora do plano some e a rota
 * responde `fora_do_plano:<destino>`; ao voltar para um plano maior, tudo volta.
 */
import { logger } from "@/lib/logger";
import { NAV_CATALOG, type NavDestinationId, type NavGroupId, type NavMetadata } from "@/lib/navigation/catalogo";
import {
  DESTINOS_DA_SIMPLIFICADA,
  PORTAS_ESSENCIAIS,
  destinosDaInterface,
  portasDaEscolha,
} from "@/lib/navigation/interface";
import type { Role } from "@/lib/auth/types";
import type { ModuloOpcional } from "@/lib/instalacao/modulos";
import type { CapacidadeDaOrganizacao } from "@/lib/organizacao/capacidades";

export type LeituraDoPlano =
  | { tipo: "isenta" }
  | { tipo: "plano"; interface: unknown }
  | { tipo: "falha" };

const TODOS: readonly NavDestinationId[] = NAV_CATALOG.map((d) => d.href);
const ESSENCIAIS = PORTAS_ESSENCIAIS as readonly NavDestinationId[];

/** O que sobra quando a leitura falha: Atendimento (o preset simplificada) + essenciais. */
export const TELAS_NA_FALHA_DE_LEITURA: readonly NavDestinationId[] = TODOS.filter(
  (h) => DESTINOS_DA_SIMPLIFICADA.includes(h) || ESSENCIAIS.includes(h),
);

/**
 * A resposta de `fn_telas_do_plano`/`fn_telas_do_plano_da_sessao` como leitura.
 * `null` (sem usuário, sem organização) vira `isenta`: aí quem decide é o app
 * (login, /get-started), não o plano.
 */
export function leituraDaResposta(data: unknown, error: unknown): LeituraDoPlano {
  if (error) return { tipo: "falha" };
  if (data == null) return { tipo: "isenta" };
  if (typeof data !== "object") return { tipo: "falha" };
  const v = data as { restrito?: unknown; interface?: unknown };
  if (v.restrito === false) return { tipo: "isenta" };
  if (v.restrito === true) return { tipo: "plano", interface: v.interface };
  return { tipo: "falha" };
}

/** O mínimo que as leituras precisam: um cliente com `.rpc` (Supabase). */
interface ClienteComRpc {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * Lê o plano da organização pela função do servidor (`fn_telas_do_plano`,
 * só service_role). Nunca lança: erro vira `falha`, com log.
 */
export async function lerTelasDoPlano(admin: ClienteComRpc, orgId: string): Promise<LeituraDoPlano> {
  try {
    const { data, error } = await admin.rpc("fn_telas_do_plano", { p_org: orgId });
    if (error) {
      logger.warn("cobrança: telas do plano ilegíveis — Atendimento e essenciais", {
        organization_id: orgId,
        erro: (error as { message?: string }).message ?? String(error),
      });
    }
    return leituraDaResposta(data, error);
  } catch (err) {
    logger.warn("cobrança: telas do plano ilegíveis — Atendimento e essenciais", {
      organization_id: orgId,
      erro: err instanceof Error ? err.message : String(err),
    });
    return { tipo: "falha" };
  }
}

/**
 * A lista de telas que o PLANO libera, ou `null` = todas (isenta).
 * Plano `completa` sem lista devolve todas, mas como LISTA: quem pergunta "há
 * recorte?" deve olhar `leitura.tipo`, não o tamanho.
 */
export function destinosDoPlano(leitura: LeituraDoPlano): readonly NavDestinationId[] | null {
  if (leitura.tipo === "isenta") return null;
  if (leitura.tipo === "falha") return TELAS_NA_FALHA_DE_LEITURA;
  const escolha = portasDaEscolha(leitura.interface);
  if (!escolha) return TODOS;
  return TODOS.filter((h) => escolha.includes(h) || ESSENCIAIS.includes(h));
}

/** O plano libera esta tela? */
export function planoLibera(leitura: LeituraDoPlano, destino: string): boolean {
  const lista = destinosDoPlano(leitura);
  return lista === null || (lista as readonly string[]).includes(destino);
}

/** O plano libera ALGUMA tela deste grupo do catálogo? (o grupo `ia` = Agente de IA) */
export function planoIncluiGrupo(leitura: LeituraDoPlano, grupo: NavGroupId): boolean {
  const lista = destinosDoPlano(leitura);
  if (lista === null) return true;
  return NAV_CATALOG.some((d) => d.group === grupo && lista.includes(d.href));
}

/**
 * O motor de IA responde para esta empresa?
 *
 * ⚠️ Decisão de falha DIFERENTE da tela, e de propósito: na `falha`, o motor
 * SEGUE respondendo. A tela fechada numa falha de leitura se reabre no próximo
 * clique; o cliente final que escreveu e não teve resposta, não. E um cliente
 * Premium não pode perder o agente por uma leitura que oscilou.
 */
export function planoIncluiIaParaOMotor(leitura: LeituraDoPlano): boolean {
  return leitura.tipo === "falha" || planoIncluiGrupo(leitura, "ia");
}

/**
 * Um cron que roda a função de uma tela (campanhas, prospecção) pode rodar para
 * esta empresa? Na falha de leitura, SIM, pela mesma razão do motor: a campanha
 * em andamento foi criada pela própria empresa, e parar todas as campanhas de
 * todas as empresas porque uma leitura oscilou é pior que um tique a mais de
 * uma campanha que o plano já não cobriria.
 */
export function planoLiberaParaCron(leitura: LeituraDoPlano, destino: string): boolean {
  return leitura.tipo === "falha" || planoLibera(leitura, destino);
}

/**
 * O que o MEMBRO vê: o plano ∩ a interface da empresa ∩ a do vínculo, filtrado
 * pelo papel, módulos e capacidades — a régua do Sidebar, do hub, do ⌘K e do
 * Guia de uso. Recebe a organização ativa como o servidor a entregou
 * (`interface_settings` já com o recorte do plano pendurado por
 * `resolveActiveOrg`). Apresentação: a autorização é a trava de página e de API.
 */
export function telasLiberadasDaOrganizacao(
  org: { interface_settings?: unknown } | null | undefined,
  plataforma: boolean,
  papel: Role | null,
  modulos?: readonly ModuloOpcional[],
  capacidades?: readonly CapacidadeDaOrganizacao[],
): NavMetadata[] {
  return destinosDaInterface(org?.interface_settings, plataforma, papel, modulos, capacidades);
}
