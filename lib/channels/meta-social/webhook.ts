/**
 * Leitura do webhook da Messenger Platform — Messenger (`object: "page"`) e
 * Instagram (`object: "instagram"`). PURO: nada de banco nem rede, para provar
 * sem dublê o que decide (é mensagem? de quem? é eco nosso?).
 *
 * O envelope é o mesmo nas duas redes:
 *
 *   { object, entry: [ { id: <conta>, time, messaging: [ { sender, recipient,
 *     timestamp, message | delivery | read | postback } ] } ] }
 *
 * `entry.id` é a CONTA (página no Messenger, conta profissional no Instagram) —
 * é por ele que a rota acha a sessão e, por ela, a organização. O corpo nunca
 * escolhe a organização: só aponta a conta, e a conta só existe numa sessão
 * ativa (índice único entre ativas, migration 9800).
 *
 * ─── Comentários (só no Instagram) ──────────────────────────────────────────
 *
 * Comentário em publicação não vem em `messaging`: vem em `changes`, um item
 * por comentário, com `field: "comments"` (ou `"live_comments"`, numa
 * transmissão ao vivo) e o comentário em `value`:
 *
 *   { object: "instagram", entry: [ { id: <conta>, time, changes: [ { field,
 *     value: { id, from: { id, username }, text, media: { id,
 *     media_product_type }, parent_id? } } ] } ] }
 *
 * A documentação da Meta descreve o mesmo comentário de dois jeitos, e a
 * leitura aceita os dois em vez de apostar num: a referência do campo traz
 * `value.id`, `value.ad_id` e `value.ad_title`; a página de exemplos traz
 * `value.comment_id` e o anúncio DENTRO de `value.media`. No login direto do
 * Instagram o envelope nem tem `changes` (`field` e `value` ficam na própria
 * entrada) — também é lido.
 *
 * O comentário feito pela PRÓPRIA conta (inclusive a resposta que o CRM
 * publica) volta como evento igual aos outros, com `from.id` = a conta
 * (`entry.id`). Quem decide o que fazer com ele é a entrada (`./ingest.ts`);
 * aqui ele só sai marcado (`proprio`). A marca é SÓ essa igualdade: a Meta
 * também manda `from.self_ig_scoped_id` nesse caso, mas a referência lista o
 * campo sem dizer quando ele vem, e tratá-lo como "é da conta" arriscaria
 * descartar comentário de cliente.
 *
 * Tolerante por construção: evento que não interessa (ou que não tem o mínimo
 * para ser lido) some daqui sem lançar — a rota responde 200 e a Meta não
 * reentrega um corpo que nunca vai melhorar.
 */
import { z } from "zod";

export type RedeDireta = "facebook" | "instagram";

export interface AnexoDireto {
  type: "image" | "video" | "audio" | "file";
  url: string;
}

export type EventoDireto =
  | {
      tipo: "mensagem";
      rede: RedeDireta;
      conta: string;
      participante: string;
      mid: string;
      texto: string | null;
      anexos: AnexoDireto[];
      quando: string;
      /** Saiu DA conta (eco): enviada pelo CRM, pelo app do celular ou por outra ferramenta. */
      eco: boolean;
      /** O app que enviou, quando a Meta diz (eco do Messenger). */
      appId: string | null;
    }
  | { tipo: "entrega"; rede: RedeDireta; conta: string; participante: string; mids: string[]; quando: string }
  | {
      tipo: "leitura";
      rede: RedeDireta;
      conta: string;
      participante: string;
      /** O Instagram diz QUAL mensagem; o Messenger diz "até quando" (`watermark`). */
      mid: string | null;
      ate: string | null;
      quando: string;
    }
  | {
      tipo: "comentario";
      /** Sempre `instagram`: comentário do Facebook não é lido. */
      rede: RedeDireta;
      conta: string;
      /** O id do comentário na rede — a chave da idempotência. */
      commentId: string;
      /** Preenchido quando o comentário é resposta a outro. */
      parentId: string | null;
      mediaId: string | null;
      mediaProductType: string | null;
      adId: string | null;
      adTitle: string | null;
      autorId: string | null;
      autorUsuario: string | null;
      /** O texto INTEIRO. `null` quando o comentário não tem texto. */
      texto: string | null;
      /** Veio de `live_comments` (transmissão ao vivo). */
      aoVivo: boolean;
      /** Escrito pela própria conta — inclusive a resposta que o CRM publicou. */
      proprio: boolean;
      /** A hora da notificação: o payload não traz a hora do comentário em si. */
      quando: string;
    };

const id = z.union([z.string(), z.number()]).transform((v) => String(v));
const anexoSchema = z
  .object({ type: z.string().optional(), payload: z.object({ url: z.string().optional() }).loose().nullish() })
  .loose();
const mensagemSchema = z
  .object({
    mid: z.string().optional(),
    text: z.string().optional(),
    is_echo: z.boolean().optional(),
    is_deleted: z.boolean().optional(),
    app_id: id.optional(),
    attachments: z.array(anexoSchema).optional(),
  })
  .loose();
const itemSchema = z
  .object({
    sender: z.object({ id: id.optional() }).loose().optional(),
    recipient: z.object({ id: id.optional() }).loose().optional(),
    timestamp: z.number().optional(),
    message: mensagemSchema.optional(),
    postback: z.object({ mid: z.string().optional(), title: z.string().optional() }).loose().optional(),
    delivery: z.object({ mids: z.array(z.string()).optional(), watermark: z.number().optional() }).loose().optional(),
    read: z.object({ mid: z.string().optional(), watermark: z.number().optional() }).loose().optional(),
  })
  .loose();
const comentarioSchema = z
  .object({
    id: id.optional(),
    comment_id: id.optional(),
    parent_id: id.nullish(),
    text: z.string().nullish(),
    ad_id: id.nullish(),
    ad_title: z.string().nullish(),
    from: z
      .object({ id: id.optional(), username: z.string().nullish() })
      .loose()
      .nullish(),
    media: z
      .object({
        id: id.optional(),
        media_product_type: z.string().nullish(),
        ad_id: id.nullish(),
        ad_title: z.string().nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();
const mudancaSchema = z.object({ field: z.string(), value: z.unknown() }).loose();
const envelopeSchema = z
  .object({
    object: z.string(),
    entry: z.array(
      z
        .object({
          id: id,
          time: z.number().optional(),
          messaging: z.array(z.unknown()).optional(),
          changes: z.array(z.unknown()).optional(),
          // Login direto do Instagram: sem `changes`, a mudança é a própria entrada.
          field: z.string().optional(),
          value: z.unknown().optional(),
        })
        .loose(),
    ),
  })
  .loose();

const SO_DIGITOS = /^[0-9]{1,40}$/;
/**
 * Id de comentário, de mídia e de anúncio. Hoje são números, mas a Meta não
 * promete o formato; o que NÃO pode passar é barra, ponto ou espaço: o id do
 * comentário vira pedaço do caminho da chamada que responde a ele.
 */
const ID_DA_REDE = /^[A-Za-z0-9_-]{1,100}$/;
const CAMPOS_DE_COMENTARIO = new Set(["comments", "live_comments"]);

function idDaRede(valor: string | null | undefined): string | null {
  return valor && ID_DA_REDE.test(valor) ? valor : null;
}

function textoCurto(valor: string | null | undefined, teto: number): string | null {
  const limpo = (valor ?? "").trim();
  return limpo ? limpo.slice(0, teto) : null;
}

/** Uma mudança de `comments`/`live_comments` → o evento. `null` = não é comentário legível. */
function lerComentario(
  conta: string,
  campo: string,
  valor: unknown,
  quando: string,
): Extract<EventoDireto, { tipo: "comentario" }> | null {
  if (!CAMPOS_DE_COMENTARIO.has(campo)) return null;
  const lido = comentarioSchema.safeParse(valor);
  if (!lido.success) return null;
  const c = lido.data;
  const commentId = idDaRede(c.id ?? c.comment_id);
  if (!commentId) return null;
  const autorId = idDaRede(c.from?.id);
  // O texto vai inteiro: o corte é defeito conhecido do aviso de mensagem, e
  // quem decide a resposta precisa do comentário todo.
  const texto = typeof c.text === "string" && c.text.length > 0 ? c.text : null;
  return {
    tipo: "comentario",
    rede: "instagram",
    conta,
    commentId,
    parentId: idDaRede(c.parent_id),
    mediaId: idDaRede(c.media?.id),
    mediaProductType: textoCurto(c.media?.media_product_type, 40),
    adId: idDaRede(c.ad_id ?? c.media?.ad_id),
    adTitle: textoCurto(c.ad_title ?? c.media?.ad_title, 500),
    autorId,
    autorUsuario: textoCurto(c.from?.username, 100),
    texto,
    aoVivo: campo === "live_comments",
    proprio: autorId === conta,
    quando,
  };
}

function iso(ms: number | undefined): string {
  // Segundos ou milissegundos: a Meta usa ms em `timestamp`, mas o watermark
  // antigo de alguns eventos veio em s. Abaixo de 10^12 é segundo.
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return new Date().toISOString();
  return new Date(ms < 1e12 ? ms * 1000 : ms).toISOString();
}

function tipoDoAnexo(tipo: string | undefined): AnexoDireto["type"] | null {
  switch (tipo) {
    case "image":
    case "video":
    case "audio":
      return tipo;
    case "file":
      return "file";
    default:
      return null;
  }
}

/** URL de anexo só https: é o que a persistência de mídia vai baixar. */
function urlSegura(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function lerWebhookDireto(corpo: unknown): EventoDireto[] {
  const env = envelopeSchema.safeParse(corpo);
  if (!env.success) return [];
  const rede: RedeDireta | null =
    env.data.object === "page" ? "facebook" : env.data.object === "instagram" ? "instagram" : null;
  if (!rede) return [];
  const eventos: EventoDireto[] = [];
  for (const entrada of env.data.entry) {
    const conta = entrada.id;
    if (!SO_DIGITOS.test(conta)) continue;
    if (rede === "instagram") {
      const mudancas: unknown[] = [...(entrada.changes ?? [])];
      if (entrada.field !== undefined) mudancas.push({ field: entrada.field, value: entrada.value });
      for (const bruta of mudancas) {
        const mudanca = mudancaSchema.safeParse(bruta);
        if (!mudanca.success) continue;
        const comentario = lerComentario(conta, mudanca.data.field, mudanca.data.value, iso(entrada.time));
        if (comentario) eventos.push(comentario);
      }
    }
    for (const bruto of entrada.messaging ?? []) {
      const item = itemSchema.safeParse(bruto);
      if (!item.success) continue;
      const it = item.data;
      const remetente = it.sender?.id ?? null;
      const destinatario = it.recipient?.id ?? null;
      const quando = iso(it.timestamp);
      if (it.message) {
        const m = it.message;
        if (!m.mid || m.is_deleted) continue;
        const eco = m.is_echo === true;
        const participante = eco ? destinatario : remetente;
        if (!participante || !SO_DIGITOS.test(participante) || participante === conta) continue;
        const anexos: AnexoDireto[] = [];
        let semSuporte = false;
        for (const a of m.attachments ?? []) {
          const tipo = tipoDoAnexo(a.type);
          const url = urlSegura(a.payload?.url ?? undefined);
          if (tipo && url) anexos.push({ type: tipo, url });
          else semSuporte = true;
        }
        const texto = m.text ?? (semSuporte && anexos.length === 0 ? "[conteúdo não suportado — abra na rede para ver]" : null);
        if (!texto && anexos.length === 0) continue;
        eventos.push({
          tipo: "mensagem",
          rede,
          conta,
          participante,
          mid: m.mid,
          texto,
          anexos,
          quando,
          eco,
          appId: m.app_id ?? null,
        });
        continue;
      }
      if (it.postback?.mid && remetente && SO_DIGITOS.test(remetente) && remetente !== conta) {
        // O clique num botão chega como postback: o título é o que a pessoa "disse".
        eventos.push({
          tipo: "mensagem",
          rede,
          conta,
          participante: remetente,
          mid: it.postback.mid,
          texto: it.postback.title ?? null,
          anexos: [],
          quando,
          eco: false,
          appId: null,
        });
        continue;
      }
      if (it.delivery && remetente && SO_DIGITOS.test(remetente)) {
        const mids = (it.delivery.mids ?? []).filter((x) => typeof x === "string" && x.length > 0);
        if (mids.length > 0) eventos.push({ tipo: "entrega", rede, conta, participante: remetente, mids, quando });
        continue;
      }
      if (it.read && remetente && SO_DIGITOS.test(remetente)) {
        eventos.push({
          tipo: "leitura",
          rede,
          conta,
          participante: remetente,
          mid: it.read.mid ?? null,
          ate: typeof it.read.watermark === "number" ? iso(it.read.watermark) : null,
          quando,
        });
      }
    }
  }
  return eventos;
}
