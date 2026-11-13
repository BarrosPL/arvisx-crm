/**
 * O ONBOARDING GUIADO — o roteiro feito DENTRO do CRM (ArvisX).
 *
 * O wizard de `/onboarding` monta a empresa numa sequência de formulários,
 * fora do produto: a pessoa só vê o CRM depois do último passo, e chega nele
 * sem saber onde fica nada do que acabou de configurar.
 *
 * Aqui o roteiro é o MESMO (`lib/onboarding/passos.ts` continua a única
 * definição de ordem, de rótulo e de "cumprido"), e o que muda é o lugar: depois
 * das boas-vindas a pessoa entra no CRM, e cada passo é feito na tela onde
 * aquilo mora — o telefone em Conexões, o agente em Agentes, o quadro em Funis,
 * a equipe em Equipe. Um guia fixo diz o próximo clique.
 *
 * Os formulários e as actions são os do wizard, sem cópia: a action grava o
 * passo e redireciona para `/onboarding`, e é o roteador de lá que devolve a
 * pessoa à tela certa (`destinoDoRoteador`).
 *
 * Desligado por padrão: sem `ONBOARDING_GUIADO=on` nada aqui é alcançado e o
 * wizard segue como sempre foi.
 */
import type { OnboardingState } from "@/lib/schemas/onboarding";
import {
  passosVisiveis,
  proximoPasso,
  rotuloDoPasso,
  type ContextoDoPasso,
  type PassoDoOnboarding,
} from "./passos";

/** O roteiro guiado está ligado nesta instalação? Só o valor exato `on` liga. */
export function onboardingGuiadoLigado(
  valor: string | undefined = process.env.ONBOARDING_GUIADO,
): boolean {
  return valor?.trim().toLowerCase() === "on";
}

/** O passo que é feito ANTES de entrar no CRM: o nome, o ramo e o aceite dos termos. */
export const SEGMENTO_DAS_BOAS_VINDAS = "welcome";

/** Para onde o roteador manda quem não tem tela de missão para onde voltar. */
export const TELA_DE_ENTRADA = "/app/inbox";

interface TelaDaMissao {
  /** Onde a missão é feita. É também o destino do menu que o guia aponta. */
  href: string;
  /**
   * Para onde a pessoa volta DEPOIS de resolver a missão. Ausente = a própria
   * tela, que é onde o resultado aparece (o número conectado, o agente criado).
   */
  depois?: string;
}

/**
 * A tela do CRM em que cada passo do roteiro é feito.
 *
 * A integração de loja não tem tela própria dentro do CRM para o primeiro
 * acesso: o passo dela continua na página do wizard, e a volta é a entrada.
 */
export const TELA_DA_MISSAO: Readonly<Record<string, TelaDaMissao>> = {
  "connect-whatsapp": { href: "/app/connections" },
  "connect-nuvemshop": { href: "/onboarding/connect-nuvemshop", depois: TELA_DE_ENTRADA },
  "setup-ai": { href: "/app/ai/agents" },
  funil: { href: "/app/kanban" },
  testar: { href: "/app/inbox" },
  "invite-team": { href: "/app/team" },
};

/** As missões do guia: os passos do roteiro menos as boas-vindas. */
function passosDoGuia(ctx: ContextoDoPasso): PassoDoOnboarding[] {
  return passosVisiveis(ctx).filter((p) => p.segmento !== SEGMENTO_DAS_BOAS_VINDAS);
}

/** As boas-vindas já foram aceitas? Sem elas ninguém entra no CRM. */
export function boasVindasFeitas(state: OnboardingState): boolean {
  return Boolean(state.welcome);
}

/**
 * A missão em que a pessoa está — ou `null` quando não falta nenhuma.
 * Antes das boas-vindas não há missão: o guia ainda não começou.
 */
export function missaoAtual(
  state: OnboardingState,
  ctx: ContextoDoPasso,
): PassoDoOnboarding | null {
  if (!boasVindasFeitas(state)) return null;
  const proximo = proximoPasso(state, ctx);
  return proximo && proximo.segmento !== SEGMENTO_DAS_BOAS_VINDAS ? proximo : null;
}

export type EstadoDaMissao = "feita" | "pulada" | "atual" | "espera";

export interface MissaoDoGuia {
  segmento: string;
  rotulo: string;
  /** A tela do CRM onde a missão é feita. */
  href: string;
  estado: EstadoDaMissao;
}

/** A lista que o guia desenha: cada missão, onde ela é feita e em que pé está. */
export function missoesDoGuia(state: OnboardingState, ctx: ContextoDoPasso): MissaoDoGuia[] {
  const atual = missaoAtual(state, ctx);
  return passosDoGuia(ctx).map((p) => ({
    segmento: p.segmento,
    rotulo: rotuloDoPasso(p, ctx),
    href: TELA_DA_MISSAO[p.segmento]?.href ?? TELA_DE_ENTRADA,
    estado: p.pulado(state)
      ? "pulada"
      : p.cumprido(state)
        ? "feita"
        : p.segmento === atual?.segmento
          ? "atual"
          : "espera",
  }));
}

/**
 * Para onde o roteador de `/onboarding` manda no roteiro guiado.
 *
 * As actions do wizard terminam em `redirect("/onboarding")`. No wizard, o
 * roteador responde com o PRÓXIMO passo. Aqui ele responde com a tela do passo
 * que a pessoa ACABOU de resolver: é nela que o resultado aparece, e é o guia
 * que diz qual é o próximo clique. Mandar direto à tela seguinte esconderia o
 * que ela acabou de fazer.
 */
export function destinoDoRoteador(state: OnboardingState, ctx: ContextoDoPasso): string {
  if (!boasVindasFeitas(state)) return `/onboarding/${SEGMENTO_DAS_BOAS_VINDAS}`;
  const missoes = passosDoGuia(ctx);
  const atual = missaoAtual(state, ctx);
  const indice = atual ? missoes.indexOf(atual) : missoes.length;
  const anterior = indice > 0 ? missoes[indice - 1] : undefined;
  if (!anterior) return TELA_DE_ENTRADA;
  const tela = TELA_DA_MISSAO[anterior.segmento];
  return tela?.depois ?? tela?.href ?? TELA_DE_ENTRADA;
}
