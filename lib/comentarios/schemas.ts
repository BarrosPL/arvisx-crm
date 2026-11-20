/**
 * Comentários de rede social — a FORMA do que é guardado e do que é pedido.
 *
 * `social_comments.public_reply`, `private_reply` e `hidden` são `jsonb`. O
 * banco não conhece a forma deles (migrations 9810 e 9812): quem a define é
 * este arquivo, e TODA leitura e toda gravação passa por aqui. Sem um schema
 * central, cada tela leria o caminho que quisesse — o anti-padrão 6 da doutrina.
 */
import { z } from "zod";

import { ESTADOS_DO_COMENTARIO } from "@/lib/channels/meta-social/comentarios";

/** Quem respondeu, ocultou ou ignorou: pessoa, agente ou integração. */
export const autorDaAcaoSchema = z.object({
  tipo: z.enum(["user", "ai_agent", "api_token", "webhook_source"]),
  id: z.string().min(1),
  /** O token que agiu, quando foi por token. */
  api_token_id: z.string().nullable().optional(),
});
export type AutorDaAcao = z.infer<typeof autorDaAcaoSchema>;

/**
 * Em que pé está a resposta.
 *
 *   enviando   o servidor reservou o comentário e está chamando a rede;
 *   concluida  a rede confirmou (ou a resposta é simulada);
 *   incerta    a rede não confirmou e a resposta PODE ter saído. Ninguém a
 *              repete sozinho: quem decide é quem chamou, com `confirmar_reenvio`.
 */
export const SITUACOES_DA_RESPOSTA = ["enviando", "concluida", "incerta"] as const;
export type SituacaoDaResposta = (typeof SITUACOES_DA_RESPOSTA)[number];

const respostaBase = {
  /** O id da resposta NA REDE. `null` enquanto envia, quando é simulada ou quando ficou incerta. */
  id: z.string().nullable(),
  texto: z.string(),
  /** ISO-8601 UTC de quando a resposta foi pedida. */
  quando: z.string(),
  quem: autorDaAcaoSchema,
  /** `true` = o canal estava em modo de registro: nada foi publicado. */
  simulada: z.boolean(),
  situacao: z.enum(SITUACOES_DA_RESPOSTA),
};

/** `social_comments.public_reply`. */
export const respostaPublicaSchema = z.object(respostaBase);
export type RespostaPublica = z.infer<typeof respostaPublicaSchema>;

/** `social_comments.private_reply`: a pública mais a mensagem gravada na conversa. */
export const respostaPrivadaSchema = z.object({
  ...respostaBase,
  /** O id da linha em `messages`. `null` quando a resposta não foi gravada em conversa. */
  message_id: z.string().nullable(),
  /** A conversa onde a resposta ficou, quando ficou. */
  conversation_id: z.string().nullable().optional(),
});
export type RespostaPrivada = z.infer<typeof respostaPrivadaSchema>;

/** `social_comments.hidden`. */
export const ocultacaoSchema = z.object({
  quando: z.string(),
  quem: autorDaAcaoSchema,
  simulada: z.boolean(),
});
export type Ocultacao = z.infer<typeof ocultacaoSchema>;

/** Lê um dos três `jsonb`. Valor fora da forma é `null`: na dúvida, não existe. */
export function lerRespostaPublica(valor: unknown): RespostaPublica | null {
  const r = respostaPublicaSchema.safeParse(valor);
  return r.success ? r.data : null;
}
export function lerRespostaPrivada(valor: unknown): RespostaPrivada | null {
  const r = respostaPrivadaSchema.safeParse(valor);
  return r.success ? r.data : null;
}
export function lerOcultacao(valor: unknown): Ocultacao | null {
  const r = ocultacaoSchema.safeParse(valor);
  return r.success ? r.data : null;
}

// ─── O que as rotas e as ferramentas aceitam ────────────────────────────────

/**
 * O texto de uma resposta. O CRM exige só que não seja vazio: o limite de
 * tamanho é da rede, e é ela quem o cobra (a documentação lida não o informa).
 * O teto abaixo é de transporte — não deixar um corpo sem fim chegar ao banco —
 * e fica muito acima de qualquer limite de rede.
 */
export const TETO_DE_TRANSPORTE_DO_TEXTO = 10_000;
const texto = z
  .string()
  .max(TETO_DE_TRANSPORTE_DO_TEXTO)
  .refine((t) => t.trim().length > 0, { message: "O texto não pode ser vazio." });

/** Repetir uma resposta que ficou incerta é decisão de quem chama, nunca automática. */
const confirmarReenvio = z.boolean().optional();

export const responderSchema = z.object({ text: texto, confirmar_reenvio: confirmarReenvio }).strict();
export const responderEmPrivadoSchema = z
  .object({ text: texto, criar_contato: z.boolean().optional(), confirmar_reenvio: confirmarReenvio })
  .strict();
export const ignorarSchema = z.object({ motivo: z.string().trim().max(500).optional() }).strict();
export const criarContatoSchema = z
  .object({
    /** O funil onde abrir o negócio. Sem ele, só o contato é criado. */
    pipeline_id: z.string().uuid().optional(),
    /** A etapa. Sem ela, a primeira etapa ativa do funil. */
    stage_id: z.string().uuid().optional(),
    /** O título do negócio. Sem ele, o nome de usuário de quem comentou. */
    title: z.string().trim().min(2).max(200).optional(),
  })
  .strict()
  .refine((v) => !v.stage_id || v.pipeline_id, {
    message: "stage_id exige pipeline_id.",
    path: ["stage_id"],
  });

export const LIMITE_PADRAO_DA_LISTA = 50;
export const LIMITE_MAXIMO_DA_LISTA = 100;

export const filtrosDaListaSchema = z.object({
  canal: z.string().uuid().optional(),
  estado: z.enum(ESTADOS_DO_COMENTARIO).optional(),
  desde: z.string().datetime({ offset: true }).optional(),
  midia: z.string().trim().min(1).max(100).optional(),
  limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO_DA_LISTA).optional(),
  cursor: z.string().min(1).max(400).optional(),
});
export type FiltrosDaLista = z.infer<typeof filtrosDaListaSchema>;

const cursorSchema = z.object({
  quando: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});
export type CursorDaLista = z.infer<typeof cursorSchema>;

export function codificarCursor(c: CursorDaLista): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

/** `null` quando o cursor não é um que este servidor emitiria. */
export function decodificarCursor(cru: string): CursorDaLista | null {
  try {
    const r = cursorSchema.safeParse(JSON.parse(Buffer.from(cru, "base64url").toString("utf8")));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
