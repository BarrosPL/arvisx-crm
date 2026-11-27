/**
 * POST /api/v1/assistente/mensagens — uma mensagem do usuário ao Vix, com a
 * resposta em stream.
 *
 * A empresa vem da SESSÃO (`requireRole`). Nenhum campo do corpo, nenhum
 * argumento do modelo e nenhuma ferramenta escolhe a empresa.
 *
 * ## A ordem das portas, e por que é esta
 *
 * Cada porta que recusa o faz ANTES de qualquer custo ou gravação:
 *
 *  1. sessão, papel (`viewer`), empresa operante: `requireRole`. Empresa
 *     suspensa para aqui, com 403 `org_suspended`;
 *  2. o Vix está ligado na instalação e na empresa, e a empresa tem acesso
 *     (assinatura ativa ou a marca da plataforma): `estadoDoVix`. Senão, 403;
 *  3. FREIO TÉCNICO: tamanho máximo da mensagem (413) e mensagens por minuto,
 *     por pessoa e por empresa (429). Nada gravado, modelo não chamado;
 *  4. FILTRO DE SEGREDO: mensagem com cara de chave, senha ou código não vai
 *     ao modelo, não entra no histórico, não entra na auditoria nem no log;
 *  5. o provedor do pagador escolhido está pronto: senão, "indisponível";
 *  6. a conversa é DESTE usuário NESTA empresa: senão, 404;
 *  7. o registro de uso: gravado no banco antes do modelo (não há limite de mensagens).
 *
 * Só então a mensagem é gravada, o modelo é chamado e a resposta sai em stream.
 *
 * ## O que o modelo consegue fazer
 *
 * Ler, pelo executor, com a sessão do usuário; e PROPOR escrita, que só grava
 * um cartão. Quem executa escrita é `acoes/[id]/confirmar`, no clique.
 *
 * ## Respostas que não são stream
 *
 * Recusa de porta volta em JSON (`fail`). Bloqueio de segredo, limite do mês e
 * provedor indisponível voltam em JSON 200 com `data.tipo` e a frase fixa: são
 * respostas do assistente ao usuário, não erros da rota.
 *
 * ## Silêncio
 *
 * Nenhum erro técnico chega ao usuário: falha do provedor ou de capacidade
 * vira frase fixa; o motivo vai para a auditoria e para o log.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { ModelMessage } from "ai";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { TAMANHO_MAXIMO_ABSOLUTO, concluirUso, registrarMensagem } from "@/lib/assistente/custo";
import { escritasDoVixLigadas, estadoDoVix } from "@/lib/assistente/disponibilidade";
import { detectarSegredo } from "@/lib/assistente/filtro-de-segredo";
import { FRASES } from "@/lib/assistente/frases";
import { descreverImplantacao, lerImplantacao } from "@/lib/assistente/implantacao";
import { montarPrompt } from "@/lib/assistente/prompt";
import { provedorDoVix } from "@/lib/assistente/provedor";
import { abrirConversa, auditarVix, dependenciasReais, gravarMensagem, historicoCurto } from "@/lib/assistente/servidor";
import { MODOS, RANK_DO_PAPEL, type ContextoDoAssistente, type PapelHumano } from "@/lib/assistente/tipos";
import { rodarTurno } from "@/lib/assistente/turno";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const JANELA_SEGUNDOS = 60;
/** O teto por empresa é este múltiplo do teto por usuário. */
const FATOR_DA_EMPRESA = 10;

const corpoDoPost = z
  .object({
    conversa_id: z.string().uuid().optional(),
    // Gerado no cliente: agrupa pergunta e resposta e é a idempotência do envio.
    turn_id: z.string().uuid(),
    // Texto já transcrito também entra por aqui (`origem_da_entrada`): a voz é fase posterior.
    texto: z.string().trim().min(1).max(TAMANHO_MAXIMO_ABSOLUTO),
    origem_da_entrada: z.enum(["texto", "voz_transcrita"]).default("texto"),
    // O painel não escolhe mais o modo (quem decide é o servidor). O campo continua aceito,
    // e ignorado, para uma aba aberta com a versão anterior não receber 422.
    modo: z.enum(MODOS).optional(),
    // A resposta será lida em voz alta: o Vix escreve como se fala.
    resposta_em_voz: z.boolean().optional(),
    tela_atual: z.string().trim().startsWith("/app").max(200).optional(),
  })
  .strict();

function linhaSse(dados: unknown): string {
  return `data: ${JSON.stringify(dados)}\n\n`;
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "assistente" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const t = (texto: string) => traduzir(texto, user.idioma);

  const lido = corpoDoPost.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, { requestId });
  }
  const corpo = lido.data;

  // O papel vem do banco (`requireRole`), e só um papel de PESSOA serve aqui.
  const papel = org.role as PapelHumano;
  if (RANK_DO_PAPEL[papel] === undefined) {
    return fail("forbidden_role", t("Você não tem permissão para esta ação."), 403, { requestId });
  }

  const admin = createAdminClient();
  const ctx: ContextoDoAssistente = {
    orgId: org.orgId,
    userId: user.id,
    papel,
    idioma: user.idioma,
    requestId,
    db: await createClient(),
  };

  const estado = await estadoDoVix(admin, org.orgId);
  if (!estado.ligado) {
    return estado.motivo === "sem_acesso"
      ? fail("assistente_sem_acesso", t(FRASES.semAcesso), 403, { requestId })
      : fail("assistente_desligado", t(FRASES.desligado), 403, { requestId });
  }
  const { config } = estado;

  // FREIO TÉCNICO 1: o tamanho da mensagem, da configuração da instalação.
  // Antes de taxa, de banco e de modelo: mensagem recusada aqui não gasta nada.
  if (corpo.texto.length > config.tamanhoMaximoDaMensagem) {
    return fail("assistente_mensagem_longa", t(FRASES.longa), 413, {
      requestId,
      details: { maximo: config.tamanhoMaximoDaMensagem },
    });
  }

  // FREIO TÉCNICO 2: mensagens por minuto, por pessoa (e um teto por empresa).

  const porUsuario = await checkRateLimit(`vix:u:${user.id}`, config.mensagensPorMinuto, JANELA_SEGUNDOS);
  const porEmpresa = await checkRateLimit(
    `vix:o:${org.orgId}`,
    config.mensagensPorMinuto * FATOR_DA_EMPRESA,
    JANELA_SEGUNDOS,
  );
  if (!porUsuario.allowed || !porEmpresa.allowed) {
    return fail("rate_limited", t(FRASES.taxa), 429, {
      requestId,
      headers: {
        "Retry-After": String(JANELA_SEGUNDOS),
        "X-RateLimit-Limit": String(porUsuario.limit),
        "X-RateLimit-Remaining": String(Math.max(0, porUsuario.limit - porUsuario.count)),
      },
    });
  }

  // O FILTRO DE SEGREDO, antes de o texto ir a qualquer lugar. A auditoria leva
  // só o TIPO do padrão; o texto não é gravado nem logado.
  const segredo = detectarSegredo(corpo.texto);
  if (segredo) {
    auditarVix("assistente.segredo_bloqueado", ctx, { metadata: { tipo: segredo } });
    return ok({ tipo: "segredo_bloqueado", mensagem: t(FRASES.segredo), abrir: "/app/ai/credentials" }, { requestId });
  }

  const provedor = await provedorDoVix(admin);
  if (!provedor.disponivel) {
    logger.warn("vix: provedor indisponível", { organization_id: org.orgId, motivo: provedor.motivo });
    auditarVix("assistente.recusa", ctx, { metadata: { motivo: `provedor:${provedor.motivo}` } });
    return ok({ tipo: "indisponivel", mensagem: t(FRASES.indisponivel) }, { requestId });
  }

  // A implantação (o que a empresa já montou) só acompanha quem pode montar: o administrador.
  // Enquanto faltar passo, o Vix conduz como consultor de implantação; depois, é o mesmo Vix.
  const implantacao = papel === "admin" ? await lerImplantacao(admin, org.orgId).catch(() => null) : null;
  const emImplantacao = implantacao !== null && !implantacao.completa;

  const conversa = await abrirConversa(admin, ctx, {
    conversaId: corpo.conversa_id,
    modo: emImplantacao ? "onboarding" : "consultor",
    telaDeOrigem: corpo.tela_atual ?? null,
    titulo: corpo.texto,
  });
  if (!conversa.ok) {
    return conversa.motivo === "nao_encontrada"
      ? fail("not_found", t("Conversa não encontrada."), 404, { requestId })
      : fail("internal_error", t(FRASES.naoConseguiu), 500, { requestId });
  }

  // O histórico é lido ANTES de gravar a mensagem nova, que entra por último.
  const historico = await historicoCurto(admin, ctx, conversa.id);

  // A mensagem do usuário entra primeiro: a unique do turno é a idempotência, e
  // um segundo POST do mesmo turno para aqui, antes de contar e de chamar o modelo.
  const gravada = await gravarMensagem(admin, ctx, {
    conversaId: conversa.id,
    turnId: corpo.turn_id,
    autor: "usuario",
    corpo: corpo.texto,
    origemDaEntrada: corpo.origem_da_entrada,
  });
  if (!gravada.ok) {
    return gravada.motivo === "turno_repetido"
      ? fail("conflict", t("Esta mensagem já foi enviada."), 409, { requestId })
      : fail("internal_error", t(FRASES.naoConseguiu), 500, { requestId });
  }

  // O registro de uso, gravado antes do modelo. Não há limite a conferir: sem
  // conseguir registrar, o assistente não chama o modelo.
  const contada = await registrarMensagem(admin, {
    orgId: org.orgId,
    userId: user.id,
    conversaId: conversa.id,
    pagador: provedor.pagador,
  });
  if (!contada.ok) {
    const frase = t(FRASES.indisponivel);
    auditarVix("assistente.recusa", ctx, {
      recursoTipo: "assistente_conversa",
      recursoId: conversa.id,
      metadata: { motivo: "uso_nao_registrado" },
    });
    await gravarMensagem(admin, ctx, {
      conversaId: conversa.id,
      turnId: corpo.turn_id,
      autor: "assistente",
      corpo: frase,
      erroCodigo: contada.motivo,
    });
    return ok(
      { tipo: "indisponivel", mensagem: frase, conversa_id: conversa.id },
      { requestId },
    );
  }

  auditarVix("assistente.pedido", ctx, {
    recursoTipo: "assistente_conversa",
    recursoId: conversa.id,
    metadata: { turn_id: corpo.turn_id, modo: conversa.modo, tamanho: corpo.texto.length, origem: corpo.origem_da_entrada },
  });

  const escritasLigadas = await escritasDoVixLigadas(admin);
  const deps = await dependenciasReais(admin, ctx, { escritasLigadas, limiteDeLote: config.limiteDeLote });

  const mensagens: ModelMessage[] = [
    ...historico.map((m): ModelMessage => ({ role: m.autor === "usuario" ? "user" : "assistant", content: m.corpo })),
    { role: "user", content: corpo.texto },
  ];
  const system = montarPrompt({
    papel,
    idioma: user.idioma,
    implantacao: emImplantacao && implantacao ? descreverImplantacao(implantacao) : null,
    respostaEmVoz: corpo.resposta_em_voz === true,
    nomeDoUsuario: user.full_name,
    telaAtual: corpo.tela_atual ?? null,
    podePropor: escritasLigadas && RANK_DO_PAPEL[papel] >= RANK_DO_PAPEL.agent,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enviar = (dados: unknown) => {
        try {
          controller.enqueue(encoder.encode(linhaSse(dados)));
        } catch {
          /* o navegador fechou a conexão: o turno segue e é gravado */
        }
      };
      enviar({ tipo: "inicio", conversa_id: conversa.id, modo: conversa.modo });
      let texto = "";
      let falha: string | null = null;
      let uso = { entrada: 0, saida: 0 };
      try {
        const r = await rodarTurno({
          ctx,
          conversaId: conversa.id,
          modo: conversa.modo,
          system,
          mensagens,
          provedor,
          ferramentasPorTurno: config.ferramentasPorTurno,
          deps,
          aoEscrever: (pedaco) => enviar({ tipo: "texto", texto: pedaco }),
          aoApontarTela: (tela) => enviar({ tipo: "tela", nome: tela.nome, abrir: tela.abrir }),
          aoCartao: (cartao) =>
            enviar({
              tipo: "cartao",
              cartao: {
                id: cartao.acaoId,
                nivel: cartao.nivel,
                resumo: cartao.resumo,
                itens: cartao.itens,
                expira_em: cartao.expiraEm,
              },
            }),
        });
        texto = r.texto;
        uso = r.uso;
        falha = r.falha ?? null;
      } catch (erro) {
        falha = "falha_do_turno";
        logger.error("vix: o turno lançou", {
          organization_id: org.orgId,
          erro: erro instanceof Error ? erro.message : String(erro),
        });
      }

      if (falha) {
        logger.warn("vix: resposta não concluída", { organization_id: org.orgId, motivo: falha });
        const frase = texto === "" ? t(FRASES.indisponivel) : t(FRASES.naoConseguiu);
        enviar({ tipo: "indisponivel", mensagem: frase });
        texto = texto === "" ? frase : `${texto}\n\n${frase}`;
      }

      await gravarMensagem(admin, ctx, {
        conversaId: conversa.id,
        turnId: corpo.turn_id,
        autor: "assistente",
        corpo: texto,
        erroCodigo: falha,
      });
      await concluirUso(admin, {
        orgId: org.orgId,
        usoId: contada.usoId,
        provedor: provedor.provedor,
        modelo: provedor.modelo,
        tokensDeEntrada: uso.entrada,
        tokensDeSaida: uso.saida,
        falhou: falha !== null,
        custoUsdCents: provedor.custoUsdCents(uso),
        pagador: provedor.pagador,
      });
      enviar({ tipo: "fim", conversa_id: conversa.id });
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Request-Id": requestId,
    },
  });
}
