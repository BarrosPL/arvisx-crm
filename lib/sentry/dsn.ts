/**
 * DSN do Sentry com opt-in em runtime.
 *
 * No ArvisX CRM o padrão é DESLIGADO: sem `SENTRY_DSN`, nada é enviado. O upstream
 * (DeskcommCRM) mandava, por padrão, os erros para o Sentry da comunidade DELE —
 * stack trace, URL e contexto de um CRM com dados de clientes saindo para um
 * terceiro sem ninguém ter decidido (risco LGPD). Quem hospeda liga pelo `.env`,
 * SEM rebuild da imagem:
 *
 *   SENTRY_DSN=  (vazio/ausente) → desligado (padrão: nada é enviado)
 *   SENTRY_DSN=off               → desligado (forma explícita, continua valendo)
 *   SENTRY_DSN=<seu-dsn>         → manda os erros pro SEU Sentry
 *
 * Vale para servidor (process.env) e navegador (window.__PUBLIC_ENV__.SENTRY_DSN,
 * injetado em runtime pelo <PublicEnvScript/>). O DSN não é segredo — DSNs do Sentry
 * são públicos por design.
 */

/**
 * DSN do "Sentry da comunidade". No ArvisX NÃO existe um: fica `undefined`, e
 * por isso `isCommunityDsn` nunca é verdadeiro e `resolveSentryDsn` nunca cai
 * nele. O nome continua exportado porque `sentry.server.config.ts` e o worker o
 * comparam para escolher a linha de boot; com `undefined` esse ramo não é
 * alcançado (o `!sentryDsn` vem antes).
 */
export const DEFAULT_SENTRY_DSN: string | undefined = undefined;

export function resolveSentryDsn(value: string | undefined | null): string | undefined {
  const v = (value ?? "").trim();
  const desligado = v.length === 0 || ["off", "false", "0"].includes(v.toLowerCase());
  return desligado ? undefined : v;
}

/**
 * Estamos mandando para o Sentry da COMUNIDADE (o nosso), e não para o do operador?
 *
 * Isso decide a amostragem (issue #100). No DSN da comunidade só vai ERRO:
 * `tracesSampleRate` e `replaysSessionSampleRate` vão a 0. O que ajuda a corrigir
 * "bug que afeta todo mundo" é o stack trace — não 100% das transações nem 10% das
 * sessões de um CRM que não é nosso. Quem aponta para o próprio Sentry recebe tudo,
 * porque aí o dado não sai da infraestrutura de quem é dono dele.
 */
export function isCommunityDsn(dsn: string | undefined): boolean {
  // Sem DSN da comunidade (ArvisX), ninguém é "comunidade": quem configura
  // `SENTRY_DSN` aponta para o próprio Sentry e recebe tudo.
  return DEFAULT_SENTRY_DSN !== undefined && dsn === DEFAULT_SENTRY_DSN;
}

/** Integração default do SDK que emite as sessões de release health do browser. */
export const INTEGRACAO_DE_SESSAO = "BrowserSession";

/**
 * Integração default do SDK que instrumenta performance (pageload/navegação) e,
 * como parte disso, registra `PerformanceObserver`s para Web Vitals (CLS/LCP/TTFB
 * etc. — `browserTracingIntegration` → `@sentry/react` → uma cópia interna do
 * `web-vitals`). Mesma classe de custo que `INTEGRACAO_DE_SESSAO`: no DSN da
 * comunidade `tracesSampleRate` já é 0 (declarado logo abaixo), então nenhum
 * trace desses observers É ENVIADO — mas os observers continuam INSTALADOS e
 * RODANDO mesmo assim, porque a decisão de amostragem do SDK acontece depois da
 * coleta, não antes de instalar o listener.
 *
 * Achado em produção (self-host, 2026-09-09): `TypeError: Cannot read
 * properties of undefined (reading 'startTime')` no console do navegador, saindo
 * de dentro do coletor de CLS/LCP desta integração — a lista de entries de um
 * `PerformanceObserver` trouxe um item `undefined`, quase certamente por uma
 * extensão do navegador que intercepta/corrompe a Performance API da página (o
 * mesmo usuário via outros dois erros de console vindos de uma extensão sua,
 * na mesma tela). O bug em si é upstream (`web-vitals`/Sentry SDK, não dá pra
 * corrigir daqui) — mas rodar esse coletor sem NUNCA poder enviar nada é o
 * exato "custo invisível" que este arquivo já rejeita para sessão. Tirar a
 * integração pra quem está na comunidade elimina o crash pra essa população
 * inteira, de graça, sem perder telemetria nenhuma (não havia o que perder).
 *
 * Quem aponta pro PRÓPRIO Sentry (`tracesSampleRate: 1`) mantém a integração —
 * ali o trace tem para onde ir, e o crash upstream (se acontecer, sob a mesma
 * combinação de extensão de navegador) é risco que a pessoa já assumiu ao
 * habilitar tracing de verdade.
 */
export const INTEGRACAO_DE_TRACING = "BrowserTracing";

/**
 * Quais integrações do browser valem para o DSN em uso.
 *
 * A política de `isCommunityDsn` estava DECLARADA e não estava em vigor. As duas
 * amostragens foram a zero (`tracesSampleRate`, `replaysSessionSampleRate`) e o
 * fluxo de SESSÃO ficou de fora da conta: `browserSessionIntegration` entra por
 * default no `@sentry/browser` e o `lifecycle` dela é `"route"`, então cada troca
 * de rota fecha uma sessão e abre outra — duas por navegação, `errors: 0`.
 *
 * Sessão não é stack trace: ela não explica bug de ninguém, e é exatamente o que o
 * comentário do `isCommunityDsn` diz não querer ("não 100% das transações nem 10%
 * das sessões de um CRM que não é nosso"). O custo era invisível porque o dado ia
 * embora sozinho.
 *
 * Medido em 2026-08-10 sobre `dc2f9f96`, um percurso de 7 telas: 17 respostas do
 * ingest, TODAS `429`, com `x-sentry-rate-limits: 60::organization:suspended` —
 * lista de categorias vazia, isto é, todas as categorias. A organização estava
 * suspensa por cota, então nem o erro real de instalação real entrava; e cada
 * tentativa barrada virava erro de console no browser de quem hospeda.
 *
 * Quem aponta para o PRÓPRIO Sentry continua recebendo tudo, sessão inclusive: lá
 * o dado não sai da infraestrutura de quem é dono dele, e release health é
 * legítimo. A assimetria é a mesma das amostragens.
 */
export function integracoesDoCliente<T extends { name: string }>(
  padraoDoSdk: readonly T[],
  paraAComunidade: boolean,
): T[] {
  if (!paraAComunidade) return [...padraoDoSdk];
  return padraoDoSdk.filter(
    (i) => i.name !== INTEGRACAO_DE_SESSAO && i.name !== INTEGRACAO_DE_TRACING,
  );
}
