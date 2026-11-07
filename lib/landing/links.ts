/**
 * Oferta e destinos da página inicial pública (crm.arvisx.com.br) e de
 * /agendar. Edite só aqui: a landing (`app/page.tsx`) e a página de
 * agendamento (`app/agendar/`) leem estas constantes, como o protótipo
 * aprovado lia `OFERTA` e `LINKS` (docs/arvisx/prototipo/landing/).
 */

export const OFERTA = {
  moeda: "€",
  preco: "189,90",
  periodo: "por mês",
  trial: "7 dias de teste grátis",
  cta: "Começar o teste grátis",
  ilimitados: "Usuários e números de WhatsApp ilimitados",
} as const;

export const LINKS = {
  /**
   * Cadastro aberto do próprio app (`app/(public)/signup`). A rota é pública
   * no proxy e, com a política de cadastro `aberto` (o padrão), cria a conta e
   * a empresa sem convite. Se a instalação passar a `so_convite`, a tela de
   * cadastro mostra a recusa: troque este destino junto.
   *
   * É o destino de "Começar o teste grátis" (topo, hero e card de preço). Em
   * produção resolve para https://crm.arvisx.com.br/signup. Sem plano
   * cadastrado no módulo de cobrança, o cadastro não mostra plano, preço nem
   * teste: os 7 dias são contados à mão e não há cobrança automática — por
   * isso a landing não promete cobrança ao fim do teste.
   */
  cadastro: "/signup",
  /** Página própria com a agenda do Google incorporada (`app/agendar/page.tsx`). */
  agendar: "/agendar",
  entrar: "/login",
  /**
   * "Termos de Serviço" e "Política de Privacidade" do rodapé apontam para os
   * documentos legais do APP (`app/legal/terms` e `app/legal/privacy`): são as
   * URLs cadastradas na tela de permissão OAuth do Google, que exige os dois
   * links visíveis na página inicial pública para exibir a marca.
   */
  termos: "/legal/terms",
  privacidade: "/legal/privacy",
  /**
   * O protótipo tem a página "Exclusão de Dados" (exclusao-de-dados.html),
   * que ainda não existe no app. Até ela existir, o link do rodapé leva à
   * política de privacidade e cookies da vitrine (`app/privacidade-e-cookies`),
   * que explica os direitos do titular — a mesma que o aviso de cookies abre.
   */
  exclusaoDeDados: "/privacidade-e-cookies",
  suporte: "mailto:suporte@arvisx.com.br",
  site: "https://arvisx.com.br/",
} as const;

/**
 * Endereço do `src` do <iframe> que o Google Agenda dá em Compartilhar >
 * Incorporação no site (página de agendamento do time Arvisx, 30 min, Google
 * Meet). É o navegador do visitante que carrega a página do Google; o app não
 * chama esse host. O corte do topo da página do Google no desktop é o
 * `--corte-google` de `app/agendar/agendar.css`.
 */
export const AGENDA_EMBED =
  "https://calendar.google.com/calendar/appointments/schedules/AcZssZ27QMpyozSqav5a58f-5jS65xPkOEVKXCXdj746LZIpl9A4_zh0pTgYTTHf9EdtblEJY1x9gHaq?gv=true";
