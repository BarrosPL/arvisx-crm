/**
 * /api/v1/channels/meta-social — Instagram e Facebook Messenger conectados
 * DIRETO na Meta, pela organização, sem parceiro.
 *
 *   GET                                      → se dá para conectar e as conexões ativas
 *   POST { acao: "iniciar" }                 → { url } do login do Facebook
 *   POST { acao: "concluir", estado, code }  → páginas autorizadas + `selecao` lacrada
 *   POST { acao: "concluir", estado, erro }  → a recusa, com a frase certa
 *   POST { acao: "conectar", selecao, page_id, redes } → grava as sessões e assina a página
 *   POST { acao: "desconectar", channel_session_id }    → desassina, apaga o token, arquiva
 *
 * Como as rotas irmãs, não sabe com quem fala: o fluxo mora em
 * `lib/channels/meta-social/`. Aqui ficam as guardas — papel de admin da
 * organização, verificação em duas etapas, suporte só leitura, limite de
 * tentativas — e a auditoria. A ORGANIZAÇÃO vem sempre da sessão
 * autenticada; o corpo só escolhe a página dentre as que a própria pessoa
 * autorizou na Meta.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { mfaEmDivida } from "@/lib/auth/server";
import { emitirEstadoDaVolta, verificarEstadoDaVolta } from "@/lib/channels/estado-da-volta";
import { appDaConexaoDireta, oQueFaltaNoApp } from "@/lib/channels/meta-social/app";
import { ErroDaGraph } from "@/lib/channels/meta-social/graph";
import {
  CAMINHO_DA_VOLTA,
  ESCOPOS_DO_INSTAGRAM,
  ESCOPOS_OBRIGATORIOS,
  idDoUsuarioNoApp,
  paginasDoUsuario,
  permissoesNegadas,
  tokenDeUsuarioDeLongaDuracao,
  urlDoLogin,
} from "@/lib/channels/meta-social/oauth";
import { abrirSelecao, lacrarSelecao } from "@/lib/channels/meta-social/selecao";
import {
  ErroDaConexaoDireta,
  conectarPagina,
  conexoesDiretas,
  desconectarSessao,
} from "@/lib/channels/meta-social/store";
import { traduzirLimiteDoPlano } from "@/lib/cobranca/limites";
import { env } from "@/lib/env";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { basePublicaConfiguradaDaInstalacao } from "@/lib/webhooks/url-publica";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };
/** Marca do estado desta volta — o campo `profileId` do estado assinado. */
const MARCA_DO_ESTADO = "meta-social";
const NUMERICO = /^[0-9]{1,40}$/;

const corpoSchema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("iniciar") }).strict(),
  z
    .object({
      acao: z.literal("concluir"),
      estado: z.string().min(20).max(700),
      code: z.string().min(10).max(2000).optional(),
      erro: z
        .string()
        .regex(/^[a-z_]{1,60}$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      acao: z.literal("conectar"),
      selecao: z.string().min(40).max(4000),
      page_id: z.string().regex(NUMERICO),
      redes: z.array(z.enum(["facebook", "instagram"])).min(1).max(2),
    })
    .strict(),
  z.object({ acao: z.literal("desconectar"), channel_session_id: z.string().uuid() }).strict(),
]);

/** Para onde a Meta devolve o navegador: precisa ser EXATAMENTE o cadastrado no app. */
function enderecoDeVolta(): string | null {
  const base = basePublicaConfiguradaDaInstalacao({ aceitarMaquinaLocal: true });
  return base ? `${base}${CAMINHO_DA_VOLTA}` : null;
}

export async function GET(): Promise<NextResponse> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "social_connections" });
  if (!authz.ok) return authz.response;
  const app = await appDaConexaoDireta();
  const falta = oQueFaltaNoApp(app);
  const volta = enderecoDeVolta();
  let conexoes: Awaited<ReturnType<typeof conexoesDiretas>> = [];
  try {
    conexoes = await conexoesDiretas(createAdminClient(), authz.org.orgId);
  } catch (erro) {
    logger.warn("[channels.meta-social] conexões não lidas", {
      organization_id: authz.org.orgId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
  }
  return ok(
    {
      disponivel: falta.length === 0 && volta !== null,
      // O que falta é da INSTALAÇÃO, não da organização: a tela diz isso ao
      // admin em vez de oferecer um botão que só falharia na Meta.
      falta: volta ? falta : [...falta, "sem_endereco_publico"],
      conexoes: conexoes.map((c) => ({
        id: c.id,
        rede: c.rede,
        conta: c.conta,
        pagina: typeof c.metadata.meta_page_name === "string" ? c.metadata.meta_page_name : null,
        display_name: c.displayName,
        status: c.status,
        metadata: { disabled: c.metadata.disabled ?? null },
      })),
    },
    { requestId, headers },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "social_connections" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  if (await mfaEmDivida()) {
    return fail("mfa_required", t("Confirme a verificação em duas etapas."), 403, { requestId, headers });
  }
  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Confira os dados da conexão."), 400, { requestId, headers });
  }
  const orgId = authz.org.orgId;
  const userId = authz.user.id;
  const limite = await checkRateLimit(`meta-social:${orgId}`, 30, 60);
  if (!limite.allowed) {
    return fail("rate_limited", t("Aguarde um minuto antes de tentar novamente."), 429, {
      requestId,
      headers: { ...headers, "Retry-After": "60" },
    });
  }

  const corpo = parsed.data;
  const admin = createAdminClient();
  const app = await appDaConexaoDireta();
  const agora = new Date();

  try {
    if (corpo.acao === "desconectar") {
      const r = await desconectarSessao(admin, orgId, corpo.channel_session_id, app.appSecret);
      void audit({
        action: "channel.social_disconnected",
        actorUserId: userId,
        organizationId: orgId,
        resourceType: "channel_session",
        resourceId: corpo.channel_session_id,
        requestId,
        metadata: { canal: "rede_social", porta: "direta", desassinada: r.desassinada, avisos: r.avisos },
      });
      return ok({ desconectada: true, desassinada: r.desassinada }, { requestId, headers });
    }

    const falta = oQueFaltaNoApp(app);
    const volta = enderecoDeVolta();
    if (falta.length > 0 || !volta || !app.appId || !app.appSecret) {
      return fail(
        "meta_app_nao_configurado",
        t("O app da Meta desta instalação ainda não está configurado. Quem administra a instalação precisa cadastrar o App ID e a chave secreta em Administração › API Oficial da Meta."),
        503,
        { requestId, headers, details: { falta: volta ? falta : [...falta, "sem_endereco_publico"] } },
      );
    }

    if (corpo.acao === "iniciar") {
      const estado = emitirEstadoDaVolta(
        { organizationId: orgId, userId, profileId: MARCA_DO_ESTADO },
        { segredo: env.INTERNAL_SECRET, agora },
      );
      return ok({ url: urlDoLogin({ appId: app.appId, redirectUri: volta, estado }) }, { requestId, headers });
    }

    if (corpo.acao === "concluir") {
      // O estado prova que a volta é DESTA organização e DESTA pessoa: a
      // assinatura confere, o prazo não venceu, e quem conclui é quem pediu.
      const estado = verificarEstadoDaVolta(corpo.estado, { segredo: env.INTERNAL_SECRET, agora });
      if (!estado || estado.profileId !== MARCA_DO_ESTADO || estado.organizationId !== orgId || estado.userId !== userId) {
        return fail("state_invalid", t("A autorização expirou ou não é desta conta. Clique em Conectar de novo."), 400, {
          requestId,
          headers,
        });
      }
      if (corpo.erro || !corpo.code) {
        return fail(
          "permissao_negada",
          t("A conexão foi cancelada na Meta. Para conectar, clique em Conectar de novo e aceite as permissões pedidas."),
          400,
          { requestId, headers },
        );
      }
      const tokenDoUsuario = await tokenDeUsuarioDeLongaDuracao({
        appId: app.appId,
        appSecret: app.appSecret,
        redirectUri: volta,
        code: corpo.code,
      });
      const negadas = await permissoesNegadas(tokenDoUsuario, app.appSecret);
      if (ESCOPOS_OBRIGATORIOS.some((e) => negadas.includes(e))) {
        return fail(
          "permissao_negada",
          t("Faltou aceitar permissões necessárias para receber e responder mensagens. Clique em Conectar de novo e mantenha todas marcadas."),
          400,
          { requestId, headers, details: { negadas } },
        );
      }
      const paginas = await paginasDoUsuario(tokenDoUsuario, app.appSecret);
      const metaUserId = await idDoUsuarioNoApp(tokenDoUsuario, app.appSecret).catch(() => null);
      const selecao = lacrarSelecao(
        { organizationId: orgId, userId, tokenDoUsuario, metaUserId },
        { segredo: env.INTERNAL_SECRET, agora },
      );
      const semInstagram = ESCOPOS_DO_INSTAGRAM.some((e) => negadas.includes(e));
      return ok(
        {
          selecao,
          instagram_permitido: !semInstagram,
          paginas: paginas.map((p) => ({
            id: p.id,
            nome: p.nome,
            pode_mensagens: p.podeMensagens,
            instagram: p.instagram && !semInstagram ? { id: p.instagram.id, username: p.instagram.username } : null,
          })),
        },
        { requestId, headers },
      );
    }

    // conectar
    const aberta = abrirSelecao(corpo.selecao, { organizationId: orgId, userId }, { segredo: env.INTERNAL_SECRET, agora });
    if (!aberta) {
      return fail("state_invalid", t("A escolha expirou. Clique em Conectar de novo."), 400, { requestId, headers });
    }
    // A página vem da Meta de novo, com o token do usuário: o corpo só ESCOLHE
    // dentre as que a pessoa autorizou — um id de página alheio não acha nada.
    const pagina = (await paginasDoUsuario(aberta.tokenDoUsuario, app.appSecret)).find((p) => p.id === corpo.page_id);
    if (!pagina) {
      return fail("not_found", t("Esta página não está entre as que você autorizou. Clique em Conectar de novo."), 404, {
        requestId,
        headers,
      });
    }
    const gravadas = await conectarPagina(admin, {
      organizationId: orgId,
      pagina,
      redes: corpo.redes,
      appSecret: app.appSecret,
      metaUserId: aberta.metaUserId,
      conectadoPor: userId,
    });
    for (const g of gravadas) {
      void audit({
        action: "channel.connected",
        actorUserId: userId,
        organizationId: orgId,
        resourceType: "channel_session",
        resourceId: g.channelSessionId,
        requestId,
        metadata: { canal: "rede_social", porta: "direta", rede: g.rede, reconexao: g.jaExistia },
      });
    }
    return ok(
      {
        conectadas: gravadas.map((g) => ({ channel_session_id: g.channelSessionId, rede: g.rede, nome: g.nome })),
      },
      { requestId, headers },
    );
  } catch (erro) {
    if (erro instanceof ErroDaConexaoDireta) {
      return fail(erro.code, t(erro.message), erro.status, { requestId, headers });
    }
    if (erro instanceof ErroDaGraph) {
      logger.warn("[channels.meta-social] a Meta recusou", {
        organization_id: orgId,
        acao: corpo.acao,
        detalhe: erro.detalhe,
      });
      return fail("upstream_unavailable", t(erro.message), 502, { requestId, headers });
    }
    const limiteDoPlano = traduzirLimiteDoPlano(erro, authz.user.idioma);
    if (limiteDoPlano) {
      return fail(limiteDoPlano.code, limiteDoPlano.message, 409, {
        requestId,
        headers,
        details: limiteDoPlano.details,
      });
    }
    logger.warn("[channels.meta-social] operação não concluída", {
      organization_id: orgId,
      acao: corpo.acao,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return fail("upstream_unavailable", t("Não foi possível concluir a conexão. Tente novamente."), 502, {
      requestId,
      headers,
    });
  }
}
