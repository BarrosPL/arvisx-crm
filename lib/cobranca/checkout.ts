/**
 * O link de pagamento da assinatura (spec da cobrança do revendedor §7b, §7g).
 * Chamado pelo "Assinar" da empresa e pelo "Gerar link de pagamento" do dono.
 * Três fases, e nenhuma chamada ao provedor dentro de transação:
 *   1. reserva curta (compare-and-set em `checkout_expira_em`): link ainda
 *      válido é devolvido de novo; outro clique em curso → 409;
 *   2. fora de transação: assinatura já viva no provedor → 409 com o link;
 *      ajuste proporcional em aberto morre no provedor antes (sem cobrança dupla);
 *      senão cliente (nome legal e o e-mail que a rota passa; o documento não é
 *      guardado) e checkout hospedado, com o teste grátis que ainda resta;
 *   3. grava provedor, modo, cliente e link. Falha na fase 2 libera a reserva.
 * O retry do mesmo clique cai na fase 1 e recebe o MESMO link: a idempotência
 * é do estado, e a `Idempotency-Key` segue ao provedor como chave dele.
 * A org vem de quem chama, sempre de fonte confiável (sessão ou path).
 *
 * ESCOLHA DO PLANO NO ASSINAR (ArvisX, etapa 3 dos planos): a empresa no plano
 * de entrada (o "Teste") assina escolhendo um dos planos oferecidos. Com
 * `planoId` diferente do atual, e NADA assinado no provedor, o `plano_id` troca
 * para o escolhido ANTES da reserva (compare-and-set no plano lido) e o
 * Checkout sai com ele — também com o teste vencido e a empresa suspensa, que é
 * quando a troca comum (`troca.ts`) recusa. Recusas, todas antes do provedor:
 * plano não oferecido/arquivado, moeda que o provedor não cobra e uso acima do
 * teto (409 `plan_limit_reached` com o excesso, o uso e o teto; nada é
 * desconectado). Plano de entrada (padrão e não oferecido) nunca vai ao
 * Checkout: 409 `escolha_um_plano`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { provedorDaInstalacao } from "@/lib/cobranca/configuracao";
import { documentoDoPagador, exigeDocumento } from "@/lib/cobranca/documento";
import { limiteDoProvedorPorOrg, recusaDoProvedor } from "@/lib/cobranca/falhas";
import { adaptador, modoDoProvedor } from "@/lib/cobranca/provedores";
import { ErroDoProvedor } from "@/lib/cobranca/provedores/contrato";
import { desistirDoAjuste } from "@/lib/cobranca/troca";
import { excedenteDoPlano, lerUsoDaOrganizacao } from "@/lib/cobranca/uso";
import { provedorCobraEm, type EstadoDaAssinatura, type Intervalo, type Moeda, type ProvedorDeCobranca } from "@/lib/cobranca/vocabulario";
import { logger } from "@/lib/logger";

const RESERVA_MS = 2 * 60_000;
const VALIDADE_PADRAO_MS = 24 * 3_600_000;

interface Lida {
  plano_id: string;
  plano_agendado_id?: string | null;
  provedor_assinatura_id?: string | null;
  checkout_sessao_id?: string | null;
  estado: EstadoDaAssinatura;
  trial_ate: string | null;
  provedor: ProvedorDeCobranca | null;
  provedor_cliente_id: string | null;
  checkout_url: string | null;
  checkout_expira_em: string | null;
  troca_id: string | null;
  troca_status: string | null;
  troca_pagamento_ref: string | null;
  troca_reserva_ate: string | null;
}

export type ResultadoDoCheckout =
  | { ok: true; url: string }
  | { ok: false; status: number; code: string; message: string; details?: unknown; headers?: Record<string, string> };

export async function gerarLinkDePagamento(
  admin: SupabaseClient,
  p: {
    orgId: string;
    /** O `documento` do corpo, cru (com ou sem máscara). */
    documentoBruto: string | undefined;
    /** E-mail do cliente no provedor; null = a empresa não tem admin com e-mail. */
    email: string | null;
    chaveIdempotencia: string;
    urlDeVolta: string;
    actorUserId: string;
    requestId: string;
    /** O dono da instalação agindo sobre a empresa: o audit registra o bypass de RLS. */
    comoDono: boolean;
    /** O plano escolhido no Assinar (etapa 3). Ausente ou igual ao atual = assina o plano atual. */
    planoId?: string;
  },
): Promise<ResultadoDoCheckout> {
  const { orgId } = p;
  const recusar = (status: number, code: string, message: string, details?: unknown): ResultadoDoCheckout => ({
    ok: false,
    status,
    code,
    message,
    ...(details === undefined ? {} : { details }),
  });
  const documento = p.documentoBruto === undefined ? null : documentoDoPagador(p.documentoBruto);
  if (p.documentoBruto !== undefined && documento === null) {
    return recusar(422, "documento_invalido", "Confira o CPF ou CNPJ: os dígitos não batem.");
  }

  const { data, error } = await admin
    .from("cobranca_assinaturas")
    .select("plano_id, plano_agendado_id, estado, trial_ate, provedor, provedor_cliente_id, provedor_assinatura_id, checkout_url, checkout_expira_em, checkout_sessao_id, troca_id, troca_status, troca_pagamento_ref, troca_reserva_ate")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) return recusar(500, "internal_error", "Não foi possível ler a assinatura.");
  const lida = data as Lida | null;
  if (!lida) return recusar(404, "not_found", "Sua empresa não tem plano de cobrança.");

  const agora = new Date();
  const escolheOutro = p.planoId !== undefined && p.planoId !== lida.plano_id;
  const expira = lida.checkout_expira_em === null ? null : Date.parse(lida.checkout_expira_em);
  // Link do plano ATUAL ainda válido: só é devolvido de novo quando o pedido é o mesmo plano.
  if (!escolheOutro && lida.checkout_url && expira !== null && expira > agora.getTime()) return { ok: true, url: lida.checkout_url };
  if (!lida.checkout_url && expira !== null && expira > agora.getTime()) {
    return recusar(409, "checkout_em_preparo", "Já estamos gerando o seu link de pagamento. Aguarde alguns segundos.");
  }
  const provedor = lida.provedor ?? (await provedorDaInstalacao());
  if (!provedor) return recusar(409, "provedor_nao_conectado", "O administrador do sistema ainda não conectou a cobrança.");
  if (exigeDocumento(provedor, lida.provedor_cliente_id !== null) && documento === null) {
    return recusar(422, "documento_obrigatorio", "Informe o CPF ou CNPJ de quem paga: o provedor de pagamento exige para emitir a cobrança.");
  }
  // O e-mail só é usado ao criar o cliente: quem já é cliente segue sem ele.
  if (p.email === null && lida.provedor_cliente_id === null) {
    return recusar(409, "empresa_sem_email", "A empresa ainda não tem administrador com e-mail. Gere o link depois que um convite de administrador for aceito.");
  }
  if (!(await limiteDoProvedorPorOrg(orgId))) {
    return {
      ok: false,
      status: 429,
      code: "rate_limited",
      message: "Muitas tentativas seguidas. Aguarde um minuto e tente de novo.",
      headers: { "Retry-After": "60" },
    };
  }

  if (escolheOutro && p.planoId !== undefined) {
    const escolha = await escolherPlanoAoAssinar(admin, orgId, lida, p.planoId, provedor, agora);
    if (escolha) return escolha;
    void audit({
      action: "cobranca.plano_trocado",
      actorUserId: p.actorUserId,
      ...(p.comoDono ? { actingAsPlatformAdmin: true, bypassedRls: true } : {}),
      organizationId: orgId,
      resourceType: "cobranca_assinatura",
      resourceId: orgId,
      requestId: p.requestId,
      metadata: { de: lida.plano_id, para: p.planoId, quando: "ao_assinar" },
    });
    Object.assign(lida, { plano_id: p.planoId, plano_agendado_id: null, checkout_url: null, checkout_expira_em: null, checkout_sessao_id: null });
  }

  // Fase 1: a reserva. Quem chegar junto perde o compare-and-set. O ISO dela é a
  // "posse": liberar e gravar o link filtram por ele, para uma requisição lenta
  // não soltar nem sobrescrever a reserva de outra.
  const reserva = new Date(agora.getTime() + RESERVA_MS).toISOString();
  const { data: reservada, error: erroDaReserva } = await admin
    .from("cobranca_assinaturas")
    .update({ checkout_url: null, checkout_expira_em: reserva, checkout_sessao_id: null })
    .eq("organization_id", orgId)
    .or(`checkout_expira_em.is.null,checkout_expira_em.lt."${agora.toISOString()}"`)
    .select("organization_id")
    .maybeSingle();
  if (erroDaReserva) return recusar(500, "internal_error", "Não foi possível reservar o pagamento.");
  if (!reservada) return recusar(409, "checkout_em_preparo", "Já estamos gerando o seu link de pagamento. Aguarde alguns segundos.");

  try {
    const url = await gerarCheckout(admin, orgId, lida, provedor, {
      reserva,
      email: p.email ?? "",
      documento,
      chaveIdempotencia: p.chaveIdempotencia,
      actorUserId: p.actorUserId,
      requestId: p.requestId,
      urlDeVolta: p.urlDeVolta,
      comoDono: p.comoDono,
    });
    if ("recusa" in url) {
      await liberarReserva(admin, orgId, reserva);
      return url.recusa;
    }
    if ("vivo" in url) {
      await liberarReserva(admin, orgId, reserva);
      if (url.vivo === null) {
        // Assinatura viva sem fatura pagável agora (ex.: pausada): nunca uma frase que promete um link.
        return recusar(
          409,
          "sem_link_de_pagamento",
          "Não há cobrança aberta para pagar agora. Atualize o cartão em Gerenciar pagamento: a próxima tentativa sai sozinha.",
        );
      }
      return recusar(409, "pagamento_em_andamento", "Você já tem um pagamento em andamento. Use o link para concluir.", { link_de_pagamento: url.vivo });
    }
    return { ok: true, url: url.url };
  } catch (e) {
    await liberarReserva(admin, orgId, reserva);
    if (!(e instanceof ErroDoProvedor)) {
      // Defeito nosso (banco, adaptador, link não gravado): envelope e X-Request-Id, e só o nome/código no log.
      logger.error("cobranca: checkout falhou fora do provedor", {
        requestId: p.requestId,
        organizationId: orgId,
        erro: e instanceof Error ? e.name : "desconhecido",
        // As nossas ("cobranca: …") só levam o código do PostgREST: separam reserva perdida de incidente de banco.
        motivo: e instanceof Error && e.message.startsWith("cobranca:") ? e.message : null,
        codigo: (e as { code?: unknown } | null)?.code ?? null,
      });
      return recusar(500, "internal_error", "Não foi possível gerar o link de pagamento. Tente de novo em instantes.");
    }
    if (e.codigo === "invalid_cpfCnpj") {
      // Dígitos certos e o Asaas recusou (o CNPJ alfanumérico, por exemplo): é o
      // documento, e quem clicou consegue resolver. Nunca o 502 "fale com quem administra".
      return recusar(422, "documento_recusado", "O provedor de pagamento não aceitou este CPF ou CNPJ. Confira o número ou informe outro documento.");
    }
    const r = recusaDoProvedor(e);
    return recusar(r.status, r.code, r.message);
  }
}

/**
 * Troca o plano da empresa para o escolhido no Assinar (etapa 3). Devolve a
 * RECUSA, ou `null` depois de gravar. Só vale com NADA assinado no provedor:
 * com assinatura lá, mudar de plano é `troca.ts` (Trocar de plano). Link de
 * pagamento do plano antigo ainda aberto morre no provedor antes (#2609).
 */
async function escolherPlanoAoAssinar(
  admin: SupabaseClient,
  orgId: string,
  lida: Lida,
  planoId: string,
  provedor: ProvedorDeCobranca,
  agora: Date,
): Promise<ResultadoDoCheckout | null> {
  const recusa = (status: number, code: string, message: string, details?: unknown): ResultadoDoCheckout => ({
    ok: false, status, code, message, ...(details === undefined ? {} : { details }),
  });
  if (lida.provedor_assinatura_id) {
    return recusa(409, "assinatura_no_provedor", "Sua assinatura já existe no provedor de pagamento. Para mudar de plano, use Trocar de plano.");
  }
  const { data: lido, error } = await admin
    .from("cobranca_planos")
    .select("id, nome, moeda, max_assentos, max_canais, arquivado_em, oferecido_ao_cliente")
    .eq("id", planoId)
    .maybeSingle();
  if (error) return recusa(500, "internal_error", "Não foi possível ler o plano.");
  const novo = lido as {
    id: string; nome: string; moeda: Moeda; max_assentos: number | null; max_canais: number | null;
    arquivado_em: string | null; oferecido_ao_cliente: boolean;
  } | null;
  if (!novo || novo.arquivado_em !== null || !novo.oferecido_ao_cliente) {
    return recusa(422, "plano_invalido", "Este plano não está disponível. Recarregue a página e escolha outro.");
  }
  if (!provedorCobraEm(provedor, novo.moeda)) {
    return recusa(422, "moeda_fora_do_provedor", `Este plano é cobrado em ${novo.moeda}, e o provedor de pagamento conectado não cobra nessa moeda. Fale com quem administra o sistema.`);
  }
  // A régua dos gatilhos do banco (`fn_limite_do_plano`, 0583/0809), espelhada em
  // `lerUsoDaOrganizacao`: o que passa do teto é recusado com o número; nada é desconectado.
  const uso = await lerUsoDaOrganizacao(admin, orgId);
  if (!uso) return recusa(500, "internal_error", "Não foi possível medir o uso da empresa.");
  const excedente = excedenteDoPlano(uso, novo);
  if (Object.keys(excedente).length > 0) {
    return recusa(409, "plan_limit_reached", "O uso atual não cabe no plano escolhido.", {
      excedente,
      uso,
      limites: { assentos: novo.max_assentos, canais: novo.max_canais },
    });
  }
  // O link aberto foi gerado para o plano antigo: morre no provedor antes da troca.
  const linkAberto = lida.checkout_url !== null && lida.checkout_expira_em !== null && Date.parse(lida.checkout_expira_em) > agora.getTime();
  if (linkAberto) {
    if (!lida.checkout_sessao_id) {
      return recusa(409, "checkout_em_aberto", "Há um link de pagamento em aberto com o plano atual. Conclua o pagamento ou aguarde o link expirar para trocar de plano.");
    }
    try {
      await adaptador(provedor).expirarSessao(lida.checkout_sessao_id);
    } catch (e) {
      if (!(e instanceof ErroDoProvedor)) throw e;
      return e.transitorio
        ? recusa(503, "provedor_indisponivel", "O provedor de pagamento não respondeu. Nada mudou; tente de novo.")
        : recusa(409, "checkout_em_aberto", "Há um link de pagamento em aberto com o plano atual. Conclua o pagamento ou aguarde o link expirar para trocar de plano.");
    }
  }
  let pedido = admin
    .from("cobranca_assinaturas")
    .update({ plano_id: novo.id, plano_agendado_id: null, checkout_url: null, checkout_expira_em: null, checkout_sessao_id: null, updated_at: agora.toISOString() })
    .eq("organization_id", orgId)
    .eq("plano_id", lida.plano_id)
    .is("provedor_assinatura_id", null);
  pedido = lida.checkout_expira_em ? pedido.eq("checkout_expira_em", lida.checkout_expira_em) : pedido.is("checkout_expira_em", null);
  const { data: gravada, error: erroDaGravacao } = await pedido.select("organization_id").maybeSingle();
  if (erroDaGravacao) return recusa(500, "internal_error", "Não foi possível trocar o plano.");
  if (!gravada) return recusa(409, "state_conflict", "A assinatura mudou enquanto você escolhia o plano. Recarregue e tente de novo.");
  return null;
}

/** Não lança: a reserva que não sai expira sozinha em RESERVA_MS, mas fica no log (o próximo clique vê `checkout_em_preparo`). */
async function liberarReserva(admin: SupabaseClient, orgId: string, reserva: string): Promise<void> {
  try {
    const { error } = await admin
      .from("cobranca_assinaturas")
      .update({ checkout_expira_em: null })
      .eq("organization_id", orgId)
      .eq("checkout_expira_em", reserva)
      .is("checkout_url", null);
    if (error) logger.error("cobranca: reserva do checkout não liberada", { organizationId: orgId, codigo: error.code });
  } catch (e) {
    logger.error("cobranca: reserva do checkout não liberada", { organizationId: orgId, erro: e instanceof Error ? e.name : "desconhecido" });
  }
}

/** Fases 2 e 3. Lança `ErroDoProvedor` (quem chama libera a reserva) ou erro de banco. */
async function gerarCheckout(
  admin: SupabaseClient,
  orgId: string,
  lida: Lida,
  provedor: ProvedorDeCobranca,
  quem: {
    reserva: string;
    email: string;
    documento: string | null;
    chaveIdempotencia: string;
    actorUserId: string;
    requestId: string;
    urlDeVolta: string;
    comoDono: boolean;
  },
): Promise<{ url: string } | { vivo: string | null } | { recusa: ResultadoDoCheckout }> {
  const ad = adaptador(provedor);
  if (lida.provedor_cliente_id) {
    const situacao = await ad.lerSituacao({ clienteRef: lida.provedor_cliente_id });
    if (situacao.assinaturasVivas > 0) return { vivo: situacao.linkDePagamento };
  }
  if (lida.troca_id) {
    // Ajuste proporcional em aberto e nenhuma assinatura viva (o Asaas cancela na
    // hora): o checkout cheio por cima seria cobrança dupla. O ajuste morre no
    // provedor ANTES; já pago, recusa — o plano pago está sendo aplicado.
    const desistencia = await desistirDoAjuste(admin, orgId, lida, () => ad, new Date());
    if (desistencia && !desistencia.ok) return { recusa: desistencia };
  }
  const [org, plano] = await Promise.all([
    admin.from("organizations").select("legal_name, display_name").eq("id", orgId).maybeSingle(),
    admin
      .from("cobranca_planos")
      .select("id, nome, preco_cents, moeda, intervalo, padrao_no_cadastro, oferecido_ao_cliente, fora_do_managed_payments")
      .eq("id", lida.plano_id)
      .maybeSingle(),
  ]);
  if (org.error || plano.error || !plano.data) throw new Error("cobranca: empresa ou plano ilegível no checkout");
  const nomes = org.data as { legal_name: string | null; display_name: string } | null;
  const p = plano.data as {
    id: string; nome: string; preco_cents: number; moeda: Moeda; intervalo: Intervalo;
    padrao_no_cadastro?: boolean; oferecido_ao_cliente?: boolean; fora_do_managed_payments?: boolean;
  };
  if (p.padrao_no_cadastro === true && p.oferecido_ao_cliente === false) {
    // O plano de entrada (o "Teste": padrão do cadastro e não oferecido) é só o
    // teste grátis; nunca se paga por ele. Quem assina escolhe um plano oferecido.
    return {
      recusa: {
        ok: false,
        status: 409,
        code: "escolha_um_plano",
        message: "O plano atual é só o teste grátis. Escolha um dos planos para assinar.",
      },
    };
  }
  if (!provedorCobraEm(provedor, p.moeda)) {
    // Plano em euro com o Asaas (que só cobra em real): recusa ANTES de criar o
    // cliente no provedor. Quem resolve é o dono: outro plano ou outro provedor.
    return {
      recusa: {
        ok: false,
        status: 422,
        code: "moeda_fora_do_provedor",
        message: `Este plano é cobrado em ${p.moeda}, e o provedor de pagamento conectado não cobra nessa moeda. Fale com quem administra o sistema.`,
      },
    };
  }
  const clienteRef =
    lida.provedor_cliente_id ??
    (await ad.garantirCliente({ id: orgId, nome: nomes?.legal_name || nomes?.display_name || orgId, email: quem.email, documento: quem.documento }));
  if (provedor === "asaas" && lida.provedor_cliente_id === null) {
    // O Asaas manda o SUBSCRIPTION_CREATED DURANTE o POST /subscriptions: sem o
    // cliente gravado antes, o aviso não acha a empresa (cliente_desconhecido) e a
    // Visão geral acusa um problema que não existe. A Stripe só cria a assinatura
    // depois do pagamento, e nela a fase 3 basta. Mesmo compare-and-set da reserva.
    const { data: comCliente, error: erroDoCliente } = await admin
      .from("cobranca_assinaturas")
      .update({ provedor, modo: await modoDoProvedor(provedor), provedor_cliente_id: clienteRef, updated_at: new Date().toISOString() })
      .eq("organization_id", orgId)
      .eq("checkout_expira_em", quem.reserva)
      .is("checkout_url", null)
      .select("organization_id")
      .maybeSingle();
    if (erroDoCliente || !comCliente) throw new Error(`cobranca: cliente do Asaas não gravado (${erroDoCliente?.code ?? "reserva_perdida"})`);
  }
  const inicio = await ad.iniciarAssinatura({
    clienteRef,
    orgId,
    plano: { id: p.id, nome: p.nome, precoCents: p.preco_cents, moeda: p.moeda, intervalo: p.intervalo, foraDoManagedPayments: p.fora_do_managed_payments === true },
    trialAte: lida.estado === "trial" && lida.trial_ate ? new Date(lida.trial_ate) : null,
    urlDeVolta: quem.urlDeVolta,
    chaveIdempotencia: quem.chaveIdempotencia,
  });
  const modo = await modoDoProvedor(provedor);
  const { data: gravada, error } = await admin
    .from("cobranca_assinaturas")
    .update({
      provedor,
      modo,
      provedor_cliente_id: clienteRef,
      // O Asaas cria a assinatura no Assinar (ACTIVE, à espera do 1º pagamento): sem a
      // referência, a troca de plano no teste grátis não chegaria a ele (troca.ts).
      // A Stripe devolve null, e a escrita dela fica como era.
      ...(inicio.assinaturaRef ? { provedor_assinatura_id: inicio.assinaturaRef } : {}),
      checkout_url: inicio.url,
      checkout_expira_em: (inicio.expiraEm ?? new Date(Date.now() + VALIDADE_PADRAO_MS)).toISOString(),
      // A id da sessão NO PROVEDOR (#2609): é ela que a troca de plano expira,
      // para o link antigo não sobreviver à troca. Reserva acima já a zerou.
      checkout_sessao_id: inicio.sessaoId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId)
    .eq("checkout_expira_em", quem.reserva)
    .is("checkout_url", null)
    // O link vale só para o plano com que foi gerado.
    .eq("plano_id", lida.plano_id)
    .select("organization_id")
    .maybeSingle();
  if (error || !gravada) throw new Error(`cobranca: link de pagamento não gravado (${error?.code ?? "reserva_perdida"})`);
  void audit({
    action: "cobranca.checkout_iniciado",
    actorUserId: quem.actorUserId,
    ...(quem.comoDono ? { actingAsPlatformAdmin: true, bypassedRls: true } : {}),
    organizationId: orgId,
    resourceType: "cobranca_assinatura",
    resourceId: orgId,
    requestId: quem.requestId,
    metadata: { provedor, modo, plano_id: p.id },
  });
  return { url: inicio.url };
}
