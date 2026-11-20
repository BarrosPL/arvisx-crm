/**
 * EQUIPE PRONTA — o PERFIL DO NEGÓCIO (as respostas do questionário).
 *
 * É a camada 2 das três (`lib/ai/equipe-pronta/tipos.ts`): o que muda de uma
 * empresa para outra e que o cliente edita pela tela. Onze blocos; só 1
 * (negócio), 2 (atendente) e 4 (primeiro passo) são obrigatórios — todo o resto
 * tem padrão sensato, para dar para instalar respondendo o mínimo.
 *
 * Dois schemas, uma fonte:
 *
 *   • `perfilSchema`     — o perfil COMPLETO, com os padrões aplicados. É o que
 *                          o instalador e o renderizador recebem.
 *   • `rascunhoSchema`   — o mesmo formato com tudo opcional. É o que a tela
 *                          salva a cada passo; ninguém instala a partir dele.
 *
 * ⚠️ PREÇO E HORÁRIO NÃO SÃO PERGUNTADOS AQUI, e a ausência é o desenho: eles
 * moram no catálogo e na agenda, que o agente consulta por ferramenta. Um campo
 * "quanto custa" neste arquivo levaria o valor para dentro do texto do agente,
 * que é exatamente o que a equipe pronta existe para impedir.
 */
import { z } from "zod";

import { ETAPAS_DA_EQUIPE } from "@/lib/ai/equipe-pronta/etapas";

const linha = (max: number) => z.string().trim().min(1).max(max);
const listaCurta = (itens: number, max: number) => z.array(linha(max)).max(itens);

export const TONS_DO_ATENDENTE = ["caloroso", "profissional", "direto"] as const;
export const IDIOMAS_DA_EQUIPE = ["pt-BR", "es", "en"] as const;
export const PRIMEIROS_PASSOS = ["agendar", "proposta", "humano"] as const;

/** 1 — o negócio. Vira a memória da organização. */
const negocioSchema = z.object({
  nome: linha(120),
  o_que_faz: linha(1000),
  cidade: z.string().trim().max(120).default(""),
  fuso: z.string().trim().min(1).max(64).default("America/Sao_Paulo"),
  idioma: z.enum(IDIOMAS_DA_EQUIPE).default("pt-BR"),
});

/** 2 — o atendente: como os agentes se apresentam e falam. */
const atendenteSchema = z.object({
  nome: linha(60),
  tom: z.enum(TONS_DO_ATENDENTE).default("profissional"),
  /** Como chamar quem escreve: cliente, paciente, aluno… A palavra é da EMPRESA. */
  como_chamar: z.string().trim().min(1).max(40).default("cliente"),
});

/** 3 — o que vende. O QUÊ e QUANTO moram no catálogo; aqui só a regra de falar preço. */
const ofertaSchema = z.object({
  informa_preco_por_mensagem: z.boolean().default(false),
});

/**
 * O tipo de agenda principal: um que já existe, ou um a criar.
 *
 * ⚠️ "pago" é só uma marca do tipo (vira a descrição dele). O VALOR não entra
 * aqui — é item do catálogo.
 */
export const agendaPrincipalSchema = z.discriminatedUnion("modo", [
  z.object({ modo: z.literal("existente"), event_type_id: z.string().uuid() }),
  z.object({
    modo: z.literal("criar"),
    nome: linha(80),
    duracao_minutos: z.number().int().min(5).max(480).default(30),
    pago: z.boolean().default(false),
  }),
]);

/** 4 — o primeiro passo que leva à venda. */
const primeiroPassoSchema = z.object({
  tipo: z.enum(PRIMEIROS_PASSOS),
  /** Ausente = a empresa não agenda (o agente de Agendamento fica sem tipo). */
  agenda: agendaPrincipalSchema.optional(),
});

/** 5 — as perguntas que o SDR faz. Lista curta, de propósito. */
const qualificacaoSchema = z.object({
  perguntas: listaCurta(5, 200).default([]),
});

/**
 * COMO A PROPOSTA SAI PARA O CLIENTE (decisão do dono, Equipe pronta v2).
 *
 *   • `apos_aprovacao` — o padrão: a equipe aprova o rascunho e o agente envia;
 *   • `direto`         — o agente envia sozinho quando TODOS os itens são do
 *                        catálogo, com o preço do catálogo e sem desconto.
 *                        Qualquer desconto ou condição fora disso volta a pedir
 *                        aprovação.
 *
 * Quem lê é a ferramenta `crm_send_proposal` (`lib/propostas/envio-pelo-agente.ts`).
 */
export const MODOS_DE_ENVIO_DE_PROPOSTA = ["apos_aprovacao", "direto"] as const;
export type ModoDeEnvioDeProposta = (typeof MODOS_DE_ENVIO_DE_PROPOSTA)[number];

/** 6 — proposta. O modelo é o genérico "Proposta comercial" do catálogo base. */
const propostaSchema = z.object({
  usa: z.boolean().default(true),
  validade_dias: z.number().int().min(1).max(180).default(7),
  envio_de_proposta: z.enum(MODOS_DE_ENVIO_DE_PROPOSTA).default("apos_aprovacao"),
});

/** 7 — regras comerciais. */
const regrasSchema = z.object({
  desconto: z
    .discriminatedUnion("modo", [
      z.object({ modo: z.literal("nunca") }),
      z.object({
        modo: z.literal("com_aprovacao"),
        ate_percentual: z.number().int().min(1).max(100),
      }),
    ])
    .default({ modo: "nunca" }),
  /** Texto livre: vai para a base de conhecimento, não para o texto do agente. */
  formas_de_pagamento: z.string().trim().max(1000).default(""),
});

export const SITUACOES_PADRAO_DE_HUMANO = [
  "A pessoa reclama ou está insatisfeita",
  "A pessoa pede desconto ou condição especial",
  "Assunto urgente ou sensível",
] as const;

/** 8 — quando chamar uma pessoa da equipe. */
const humanoSchema = z.object({
  situacoes: listaCurta(10, 200).default([...SITUACOES_PADRAO_DE_HUMANO]),
  palavras: listaCurta(12, 60).default([]),
});

/**
 * 9 — recuperação. Padrões da decisão P-04: 2 toques, lead frio em 30 dias.
 *
 * `dias_para_esfriar` vai até 6: o gatilho de silêncio do motor de follow-up só
 * alcança silêncio de até 7 dias (`triggerConfigSchema`), e o limiar precisa
 * ficar abaixo do teto para sobrar janela.
 */
const recuperacaoSchema = z.object({
  dias_para_esfriar: z.number().int().min(1).max(6).default(3),
  toques_maximos: z.number().int().min(1).max(4).default(2),
  intervalo_dias: z.number().int().min(1).max(30).default(2),
  limite_lead_frio_dias: z.number().int().min(7).max(365).default(30),
});

/** 10 — perguntas frequentes e políticas. Vira a fonte de conhecimento. */
const faqSchema = z.object({
  texto: z.string().trim().max(20000).default(""),
});

/** 11 — ligações. Só tem efeito se o módulo de voz existir na organização. */
const ligacoesSchema = z.object({
  pode_ligar: z.boolean().default(false),
});

/**
 * ONDE instalar — não é pergunta do questionário, é o alvo da instalação.
 *
 * Ausente = o instalador escolhe quando só há uma opção (um canal, um funil);
 * com mais de uma, ele recusa e pede a escolha, em vez de adivinhar.
 */
const ondeSchema = z.object({
  channel_session_id: z.string().uuid().optional(),
  pipeline_id: z.string().uuid().optional(),
  /**
   * As etapas do funil, por passo. Ausente = o instalador não mexe nas marcas
   * que o funil já tem.
   */
  etapas: z
    .object({
      qualificado: z.string().uuid().optional(),
      /** O nome da v1 para `proposta_enviada`. Continua aceito. */
      proposta: z.string().uuid().optional(),
      perdido: z.string().uuid().optional(),
      // As demais chaves da equipe (v2). Ausente = o instalador acha a etapa
      // pelo nome ou cria a que falta.
      novo: z.string().uuid().optional(),
      em_atendimento: z.string().uuid().optional(),
      agendado: z.string().uuid().optional(),
      compareceu: z.string().uuid().optional(),
      proposta_enviada: z.string().uuid().optional(),
      em_negociacao: z.string().uuid().optional(),
      ganho: z.string().uuid().optional(),
    })
    .default({}),
  /** E.164 com `+`. É a lista do ENSAIO: só estes números falam com a equipe. */
  telefones_de_teste: z
    .array(
      z
        .string()
        .trim()
        .regex(/^\+[1-9]\d{7,14}$/, "telefone deve estar no formato +5511999990000"),
    )
    .max(20)
    .default([]),
});

/** Os onze blocos do questionário, na ordem da tela. `onde` fica de fora. */
export const BLOCOS_DO_QUESTIONARIO = [
  "negocio",
  "atendente",
  "oferta",
  "primeiro_passo",
  "qualificacao",
  "proposta",
  "regras",
  "humano",
  "recuperacao",
  "faq",
  "ligacoes",
] as const;

/** Os três que não têm padrão: sem eles não há o que instalar. */
export const BLOCOS_OBRIGATORIOS = [
  "negocio",
  "atendente",
  "primeiro_passo",
] as const satisfies readonly (typeof BLOCOS_DO_QUESTIONARIO)[number][];

/**
 * O PERFIL COMPLETO. Os blocos com padrão aceitam ausência (`prefault({})`
 * aplica os padrões de dentro); os três obrigatórios não.
 */
export const perfilSchema = z.strictObject({
  negocio: negocioSchema,
  atendente: atendenteSchema,
  oferta: ofertaSchema.prefault({}),
  primeiro_passo: primeiroPassoSchema,
  qualificacao: qualificacaoSchema.prefault({}),
  proposta: propostaSchema.prefault({}),
  regras: regrasSchema.prefault({}),
  humano: humanoSchema.prefault({}),
  recuperacao: recuperacaoSchema.prefault({}),
  faq: faqSchema.prefault({}),
  ligacoes: ligacoesSchema.prefault({}),
  onde: ondeSchema.prefault({}),
});
export type PerfilDoNegocio = z.infer<typeof perfilSchema>;

/**
 * O RASCUNHO: cada bloco opcional, e cada campo de bloco opcional. Os blocos
 * com união (`agenda`, `desconto`) entram inteiros ou não entram — meia união
 * não tem como ser lida depois.
 */
export const rascunhoSchema = z.strictObject({
  negocio: negocioSchema.partial().optional(),
  atendente: atendenteSchema.partial().optional(),
  oferta: ofertaSchema.partial().optional(),
  primeiro_passo: primeiroPassoSchema.partial().optional(),
  qualificacao: qualificacaoSchema.partial().optional(),
  proposta: propostaSchema.partial().optional(),
  regras: regrasSchema.partial().optional(),
  humano: humanoSchema.partial().optional(),
  recuperacao: recuperacaoSchema.partial().optional(),
  faq: faqSchema.partial().optional(),
  ligacoes: ligacoesSchema.partial().optional(),
  onde: ondeSchema.partial().optional(),
});
export type RascunhoDoPerfil = z.infer<typeof rascunhoSchema>;

/** O que falta para o rascunho virar perfil — em termos de bloco, para a tela. */
export function oQueFaltaNoRascunho(
  rascunho: unknown,
): { ok: true; perfil: PerfilDoNegocio } | { ok: false; faltam: string[] } {
  const lido = perfilSchema.safeParse(rascunho);
  if (lido.success) return { ok: true, perfil: lido.data };
  const faltam = [...new Set(lido.error.issues.map((i) => i.path.slice(0, 2).join(".")))].sort();
  return { ok: false, faltam };
}

export const ESTADOS_DA_EQUIPE = ["rascunho", "instalado"] as const;
export type EstadoDaEquipe = (typeof ESTADOS_DA_EQUIPE)[number];
export const MODOS_DA_EQUIPE = ["ensaio", "ativo"] as const;
export type ModoDaEquipe = (typeof MODOS_DA_EQUIPE)[number];

/** PUT /api/v1/ai/equipe-pronta — salva o rascunho. */
export const salvarPerfilSchema = z.strictObject({ respostas: rascunhoSchema });

/** POST /api/v1/ai/equipe-pronta/instalar. */
export const instalarSchema = z.strictObject({
  /** `true` = pode sobrescrever agente que o cliente editou à mão. */
  forcar: z.boolean().default(false),
});

/** O que o instalador guarda de cada agente — é com isto que se detecta edição à mão. */
export const agenteInstaladoSchema = z.object({
  agent_id: z.string().uuid(),
  version_id: z.string().uuid(),
  versao_do_papel: z.number().int().positive(),
  /** Hash dos campos que o instalador gravou na versão. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

/** `equipe_pronta_perfis.instalacao` — os ids criados e as versões aplicadas. */
export const instalacaoSchema = z.object({
  channel_session_id: z.string().uuid().nullable().default(null),
  router_id: z.string().uuid().nullable().default(null),
  pipeline_id: z.string().uuid().nullable().default(null),
  event_type_id: z.string().uuid().nullable().default(null),
  knowledge_source_id: z.string().uuid().nullable().default(null),
  followup_flow_pointer_id: z.string().uuid().nullable().default(null),
  proposal_template_id: z.string().uuid().nullable().default(null),
  /**
   * O mapeamento das etapas da equipe: chave interna → etapa real do funil
   * (`lib/ai/equipe-pronta/etapas.ts`). É o que a ferramenta lê para saber de
   * quem é cada etapa. Vazio numa instalação anterior ao mapeamento.
   */
  etapas: z.partialRecord(z.enum(ETAPAS_DA_EQUIPE), z.string().uuid()).default({}),
  /** As etapas que ESTA instalação criou no funil — para a tela poder dizer quais. */
  etapas_criadas: z.array(z.string().uuid()).default([]),
  /** Tipos de agenda que ESTA instalação desativou — para a tela poder dizer quais. */
  tipos_de_agenda_desativados: z.array(z.string().uuid()).default([]),
  agentes: z.partialRecord(
    z.enum(["sdr", "agendamento", "proposta", "recuperador"]),
    agenteInstaladoSchema,
  ),
  /**
   * A assinatura do que havia de ALHEIO no roteador do canal quando a pessoa
   * confirmou instalar por cima (`forcar`). Enquanto o roteador seguir igual,
   * instalar de novo não pergunta outra vez; mudou, pergunta.
   */
  roteador_confirmado: z.string().nullable().default(null),
  /**
   * A pausa da equipe: quando, e QUAIS agentes ela pausou. Retomar religa só
   * esses — quem o cliente pausou à mão antes continua pausado.
   */
  pausa: z
    .object({ em: z.string(), agentes: z.array(z.string().uuid()) })
    .nullable()
    .default(null),
});
export type InstalacaoDaEquipe = z.infer<typeof instalacaoSchema>;
