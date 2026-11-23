"use client";

/**
 * Comentários do Instagram — a tela da equipe (gerente e administrador).
 *
 * A tela NÃO tem regra própria: lista e age pelas rotas
 * `/api/v1/social-comments`, e quem decide o que pode (uma resposta por
 * comentário, 7 dias da privada, modo da conexão, permissão) é
 * `lib/comentarios/acoes.ts`. Aqui ficam só os estados que a pessoa precisa ver
 * com clareza:
 *
 *   - SIMULADA  a conexão estava em modo de registro: a resposta ficou anotada
 *               e NADA foi publicado;
 *   - INCERTA   a rede não confirmou e a resposta PODE ter saído. A tela não
 *               repete sozinha: mostra o aviso e só reenvia depois de a pessoa
 *               conferir na rede e confirmar (`confirmar_reenvio`);
 *   - ENVIANDO  outra chamada está publicando agora.
 *
 * Resposta SIMULADA não trava a resposta de verdade: quando a conexão já está
 * em modo real (`modo_do_canal`), o comentário que só tem resposta simulada
 * volta a oferecer Responder, e a tela avisa que a simulada será substituída.
 * Em modo de registro a simulada continua valendo, como no servidor.
 *
 * A recusa do servidor é mostrada com a frase que ele mandou (já no idioma da
 * pessoa); a tela não adivinha o motivo.
 */
import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { channelLabel, useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { CHANNEL_PROVIDER_SOCIAL_DIRETO } from "@/lib/channels/capabilities";
import type { Comentario, RespostaPrivada, RespostaPublica } from "@/lib/comentarios/schemas";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import { tagDeIdioma } from "@/lib/i18n/datas";

type Estado = Comentario["estado"];
type Resposta = RespostaPublica | RespostaPrivada;
type Acao = "publica" | "privada";

const ESTADOS: readonly Estado[] = ["novo", "respondido", "sem_acao", "ignorado"];
const ROTULO_DO_ESTADO: Record<Estado, string> = {
  novo: "Novo",
  respondido: "Respondido",
  sem_acao: "Sem ação",
  ignorado: "Ignorado",
};
const SELO_DO_ESTADO: Record<Estado, "default" | "success" | "neutral"> = {
  novo: "default",
  respondido: "success",
  sem_acao: "neutral",
  ignorado: "neutral",
};

const ROTA = "/api/v1/social-comments";
const POR_PAGINA = 30;
/**
 * O teto do texto de uma resposta: o mesmo `TETO_DE_TRANSPORTE_DO_TEXTO` de
 * `lib/comentarios/schemas.ts` (a tela não importa valor de módulo do
 * servidor; um teste confere que os dois números são iguais). Acima disso a
 * rota recusaria com "Dados inválidos".
 */
export const TETO_DO_TEXTO_DA_RESPOSTA = 10_000;

/**
 * A resposta gravada é uma SIMULADA que a resposta real pode substituir agora?
 * Só quando ela é de modo de registro (nada saiu) e a conexão está hoje em
 * modo real — a mesma regra de `lib/comentarios/acoes.ts`.
 */
function simuladaSubstituivel(resposta: Resposta | null, comentario: Comentario): boolean {
  return (
    resposta !== null &&
    resposta.simulada &&
    resposta.situacao === "concluida" &&
    comentario.modo_do_canal === "real"
  );
}

/** O servidor recusou por papel: a pessoa não é gerente desta empresa. */
function semPermissao(e: unknown): boolean {
  const erro = e as { status?: unknown; code?: unknown } | null;
  return erro?.status === 403 || erro?.code === "forbidden" || erro?.code === "insufficient_role";
}

interface Pagina {
  data: Comentario[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

function codigoDoErro(e: unknown): string | null {
  const codigo = (e as { code?: unknown } | null)?.code;
  return typeof codigo === "string" ? codigo : null;
}

/** O selo de uma resposta: simulada, incerta ou enviando. Publicada de verdade não leva selo. */
function SeloDaResposta({ resposta }: { resposta: Resposta }) {
  const t = useT();
  if (resposta.situacao === "incerta") {
    return (
      <Badge variant="warning" data-testid="selo-incerta">
        {t("Incerta")}
      </Badge>
    );
  }
  if (resposta.situacao === "enviando") return <Badge variant="neutral">{t("Enviando")}</Badge>;
  if (resposta.simulada) {
    return (
      <Badge variant="info" data-testid="selo-simulada">
        {t("Simulada")}
      </Badge>
    );
  }
  return <Badge variant="success">{t("Publicada")}</Badge>;
}

function BlocoDaResposta({
  titulo,
  resposta,
  quando,
  onReenviar,
  ocupado,
  substituivel,
}: {
  titulo: string;
  resposta: Resposta;
  quando: string;
  onReenviar: () => void;
  ocupado: boolean;
  /** A simulada pode ser substituída por uma resposta de verdade agora. */
  substituivel: boolean;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1 rounded-md border p-3" data-testid="resposta-do-comentario">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
        <SeloDaResposta resposta={resposta} />
        <span className="text-xs text-muted-foreground">{quando}</span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{resposta.texto}</p>
      {resposta.simulada && resposta.situacao === "concluida" && (
        <p className="text-xs text-muted-foreground">
          {t("Resposta simulada: a conexão estava em modo de registro, então nada foi publicado.")}
        </p>
      )}
      {substituivel && (
        <p className="text-xs text-muted-foreground" data-testid="simulada-substituivel">
          {t("A conexão agora publica de verdade: você pode responder a este comentário, e a resposta publicada substitui a simulada.")}
        </p>
      )}
      {resposta.situacao === "incerta" && (
        <div role="status" className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-bg p-3 text-sm text-text-muted">
          <p>
            {t("A rede não confirmou esta resposta: ela pode ter sido publicada ou não. Confira no Instagram antes de enviar de novo.")}
          </p>
          <div>
            <Button variant="outline" disabled={ocupado} onClick={onReenviar} data-testid="reenviar-incerta">
              {t("Conferi, enviar de novo")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ComentariosClient({ canalInicial = null }: { canalInicial?: string | null }) {
  const t = useT();
  const idioma = useIdioma();
  const cache = useQueryClient();
  const { data: sessoes } = useChannelSessions();
  const canais = (sessoes ?? []).filter((s) => s.provider === CHANNEL_PROVIDER_SOCIAL_DIRETO);

  const [canal, setCanal] = useState<string>(canalInicial ?? "");
  const [estado, setEstado] = useState<Estado | "">("");
  const [midia, setMidia] = useState<string>("");

  const [respondendo, setRespondendo] = useState<{ comentario: Comentario; acao: Acao; reenvio: boolean } | null>(null);
  const [texto, setTexto] = useState("");
  const [criarContato, setCriarContato] = useState(true);
  const [ignorando, setIgnorando] = useState<Comentario | null>(null);
  const [motivo, setMotivo] = useState("");
  const [ocultando, setOcultando] = useState<Comentario | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erroDaAcao, setErroDaAcao] = useState<string | null>(null);

  const chave = ["social-comments", canal, estado, midia] as const;
  const lista = useInfiniteQuery({
    queryKey: chave,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const q = new URLSearchParams({ limite: String(POR_PAGINA) });
      if (canal) q.set("canal", canal);
      if (estado) q.set("estado", estado);
      if (midia) q.set("midia", midia);
      if (pageParam) q.set("cursor", pageParam);
      return apiClient.get<Pagina>(`${ROTA}?${q.toString()}`);
    },
    getNextPageParam: (ultima) => (ultima.meta?.has_more && ultima.meta.cursor ? ultima.meta.cursor : null),
  });
  const comentarios = (lista.data?.pages ?? []).flatMap((p) => p.data ?? []);
  // O "agora" do prazo da resposta privada é a hora da última leitura da lista,
  // e não o relógio lido a cada desenho: o servidor é quem recusa de verdade, e
  // a tela só evita oferecer um botão que ele já recusaria.
  const lidoEm = lista.dataUpdatedAt;

  const recarregar = () => cache.invalidateQueries({ queryKey: ["social-comments"] });
  const data = (iso: string) => new Date(iso).toLocaleString(tagDeIdioma(idioma));
  const nomeDoCanal = (id: string) => {
    const s = canais.find((c) => c.id === id);
    return s ? channelLabel(s, t) : t("Conexão removida");
  };

  function abrirResposta(comentario: Comentario, acao: Acao, reenvio = false) {
    const anterior = acao === "publica" ? comentario.public_reply : comentario.private_reply;
    setTexto(reenvio ? (anterior?.texto ?? "") : "");
    setCriarContato(true);
    setErroDaAcao(null);
    setRespondendo({ comentario, acao, reenvio });
  }

  async function enviarResposta() {
    // Duplo clique (ou Enter repetido) não manda duas respostas.
    if (ocupado) return;
    if (!respondendo || !texto.trim()) return;
    const { comentario, acao, reenvio } = respondendo;
    setOcupado(true);
    setErroDaAcao(null);
    try {
      const r = await apiClient.post<{ data: { simulada: boolean } }>(
        `${ROTA}/${comentario.id}/${acao === "publica" ? "reply" : "private-reply"}`,
        {
          text: texto,
          ...(acao === "privada" ? { criar_contato: criarContato } : {}),
          ...(reenvio ? { confirmar_reenvio: true } : {}),
        },
      );
      toast.success(
        t(
          r.data.simulada
            ? "Resposta registrada como simulada. Nada foi publicado."
            : acao === "publica"
              ? "Resposta publicada no Instagram."
              : "Resposta privada enviada.",
        ),
      );
      setRespondendo(null);
      await recarregar();
    } catch (e) {
      setErroDaAcao(e instanceof Error ? e.message : t("Não foi possível enviar a resposta."));
      // Incerta ou já respondida: o que está gravado mudou, e a lista precisa mostrar.
      if (["resposta_incerta", "ja_respondido", "ja_respondido_em_privado"].includes(codigoDoErro(e) ?? "")) {
        await recarregar();
      }
    } finally {
      setOcupado(false);
    }
  }

  async function ocultar() {
    if (ocupado) return;
    if (!ocultando) return;
    setOcupado(true);
    try {
      const r = await apiClient.post<{ data: { simulada: boolean } }>(`${ROTA}/${ocultando.id}/hide`, {});
      toast.success(
        t(r.data.simulada ? "Ocultação registrada como simulada. Nada mudou no Instagram." : "Comentário ocultado no Instagram."),
      );
      await recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Não foi possível ocultar o comentário."));
    } finally {
      setOcultando(null);
      setOcupado(false);
    }
  }

  async function ignorar() {
    if (ocupado) return;
    if (!ignorando) return;
    setOcupado(true);
    setErroDaAcao(null);
    try {
      await apiClient.post(`${ROTA}/${ignorando.id}/ignore`, motivo.trim() ? { motivo: motivo.trim() } : {});
      toast.success(t("Comentário marcado como sem ação."));
      setIgnorando(null);
      await recarregar();
    } catch (e) {
      setErroDaAcao(e instanceof Error ? e.message : t("Não foi possível marcar o comentário."));
    } finally {
      setOcupado(false);
    }
  }

  const seletor = "w-full rounded-md border bg-background p-2 text-sm";

  return (
    <div className="flex flex-col gap-4" data-testid="tela-de-comentarios">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-48 flex-1 space-y-2">
          <Label htmlFor="comentarios-canal">{t("Conexão")}</Label>
          <select id="comentarios-canal" className={seletor} value={canal} onChange={(e) => setCanal(e.target.value)}>
            <option value="">{t("Todas as conexões")}</option>
            {canal && !canais.some((c) => c.id === canal) && <option value={canal}>{t("Conexão removida")}</option>}
            {canais.map((c) => (
              <option key={c.id} value={c.id}>
                {channelLabel(c, t)}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-48 flex-1 space-y-2">
          <Label htmlFor="comentarios-estado">{t("Estado")}</Label>
          <select
            id="comentarios-estado"
            className={seletor}
            value={estado}
            onChange={(e) => setEstado(e.target.value as Estado | "")}
          >
            <option value="">{t("Todos os estados")}</option>
            {ESTADOS.map((e) => (
              <option key={e} value={e}>
                {t(ROTULO_DO_ESTADO[e])}
              </option>
            ))}
          </select>
        </div>
        {midia && (
          <Button variant="outline" onClick={() => setMidia("")} data-testid="limpar-filtro-de-publicacao">
            {t("Mostrar todas as publicações")}
          </Button>
        )}
        <Button variant="outline" disabled={lista.isFetching} onClick={() => void lista.refetch()}>
          {t("Atualizar")}
        </Button>
      </Card>

      {lista.isError &&
        (semPermissao(lista.error) ? (
          // Quem não é gerente desta empresa (inclusive quem administra a
          // plataforma sem papel na empresa) vê o motivo, não um 403 cru.
          <Card className="p-6 text-sm text-muted-foreground" role="status" data-testid="comentarios-sem-permissao">
            <p className="font-medium text-foreground">{t("Você não tem permissão para ver os comentários desta empresa.")}</p>
            <p>{t("Esta tela é de gerentes e administradores da empresa. Peça a quem administra a empresa para ajustar o seu papel.")}</p>
          </Card>
        ) : (
          <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
            {lista.error instanceof Error ? lista.error.message : t("Não foi possível carregar os comentários.")}
          </p>
        ))}
      {lista.isLoading && <p role="status">{t("Carregando…")}</p>}
      {!lista.isLoading && !lista.isError && comentarios.length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground" data-testid="comentarios-vazio">
          <p>{t("Nenhum comentário por aqui.")}</p>
          <p>
            {t("Os comentários só são guardados quando a conexão do Instagram está em modo Registrando ou Ativo. Quem administra liga isso em Conexões › Facebook / Instagram.")}
          </p>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {comentarios.map((c) => {
          const prazoVencido = Date.parse(c.private_reply_deadline) < lidoEm;
          const oculto = c.hidden !== null;
          // Os botões se repetem em cada cartão: o nome acessível diz de quem
          // é o comentário, para quem navega por leitor de tela.
          const autor = c.author.username ? `@${c.author.username}` : t("Autor não informado");
          const publicaSubstituivel = simuladaSubstituivel(c.public_reply, c);
          const privadaSubstituivel = simuladaSubstituivel(c.private_reply, c);
          return (
            <Card key={c.id} className="flex flex-col gap-3 p-4" data-testid="comentario">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">
                    {nomeDoCanal(c.channel_session_id)} · {data(c.commented_at)}
                  </p>
                  <p className="truncate font-semibold">
                    {c.author.username ? `@${c.author.username}` : t("Autor não informado")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant={SELO_DO_ESTADO[c.estado]} data-testid="estado-do-comentario">
                    {t(ROTULO_DO_ESTADO[c.estado])}
                  </Badge>
                  {c.ao_vivo && <Badge variant="neutral">{t("Ao vivo")}</Badge>}
                  {c.parent_comment_id && <Badge variant="neutral">{t("Resposta a outro comentário")}</Badge>}
                  {oculto && <Badge variant="neutral">{t(c.hidden?.simulada ? "Oculto (simulado)" : "Oculto")}</Badge>}
                </div>
              </div>

              <p className="whitespace-pre-wrap break-words text-sm" data-testid="texto-do-comentario">
                {c.text ?? t("(sem texto)")}
              </p>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {t("Publicação:")} {c.media_product_type ? `${c.media_product_type} · ` : ""}
                  {c.media_id ?? t("não informada")}
                </span>
                {c.ad_title && (
                  <span>
                    {t("Anúncio:")} {c.ad_title}
                  </span>
                )}
                {c.media_id && midia !== c.media_id && (
                  <Button variant="ghost" size="sm" onClick={() => setMidia(c.media_id ?? "")}>
                    {t("Só desta publicação")}
                  </Button>
                )}
              </div>

              {c.public_reply && (
                <BlocoDaResposta
                  titulo={t("Resposta pública")}
                  resposta={c.public_reply}
                  quando={data(c.public_reply.quando)}
                  ocupado={ocupado}
                  substituivel={publicaSubstituivel}
                  onReenviar={() => abrirResposta(c, "publica", true)}
                />
              )}
              {c.private_reply && (
                <BlocoDaResposta
                  titulo={t("Resposta privada")}
                  resposta={c.private_reply}
                  quando={data(c.private_reply.quando)}
                  ocupado={ocupado}
                  substituivel={privadaSubstituivel && !prazoVencido}
                  onReenviar={() => abrirResposta(c, "privada", true)}
                />
              )}
              {c.estado === "sem_acao" && c.ignore_reason && (
                <p className="text-xs text-muted-foreground">
                  {t("Motivo:")} {c.ignore_reason}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  data-testid="responder-em-publico"
                  aria-label={`${t("Responder")} — ${autor}`}
                  disabled={ocupado || (c.public_reply !== null && !publicaSubstituivel)}
                  onClick={() => abrirResposta(c, "publica")}
                >
                  {t("Responder")}
                </Button>
                <Button
                  variant="outline"
                  data-testid="responder-em-privado"
                  aria-label={`${t("Responder em privado")} — ${autor}`}
                  disabled={ocupado || (c.private_reply !== null && !privadaSubstituivel) || prazoVencido}
                  onClick={() => abrirResposta(c, "privada")}
                >
                  {t("Responder em privado")}
                </Button>
                <Button
                  variant="outline"
                  data-testid="ocultar-comentario"
                  aria-label={`${t("Ocultar")} — ${autor}`}
                  disabled={ocupado || oculto}
                  onClick={() => setOcultando(c)}
                >
                  {t("Ocultar")}
                </Button>
                <Button
                  variant="outline"
                  data-testid="ignorar-comentario"
                  aria-label={`${t("Ignorar")} — ${autor}`}
                  disabled={ocupado || c.estado === "respondido" || c.estado === "sem_acao"}
                  onClick={() => {
                    setMotivo("");
                    setErroDaAcao(null);
                    setIgnorando(c);
                  }}
                >
                  {t("Ignorar")}
                </Button>
              </div>
              {prazoVencido && c.private_reply === null && (
                <p className="text-xs text-muted-foreground">
                  {t("O Instagram só aceita resposta privada até 7 dias depois do comentário, e este prazo já passou.")}
                </p>
              )}
            </Card>
          );
        })}
      </div>

      {lista.hasNextPage && (
        <Button
          variant="outline"
          className="self-center"
          disabled={lista.isFetchingNextPage}
          onClick={() => void lista.fetchNextPage()}
        >
          {lista.isFetchingNextPage ? t("Carregando…") : t("Carregar mais")}
        </Button>
      )}

      <Dialog open={!!respondendo} onOpenChange={(aberto) => !aberto && !ocupado && setRespondendo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(respondendo?.acao === "privada" ? "Responder em privado" : "Responder em público")}
            </DialogTitle>
            <DialogDescription>
              {t(
                respondendo?.acao === "privada"
                  ? "A mensagem vai direto para quem comentou. O Instagram aceita uma por comentário, até 7 dias depois dele."
                  : "A resposta aparece na publicação, à vista de todos. O Instagram aceita uma por comentário.",
              )}
            </DialogDescription>
          </DialogHeader>
          {respondendo &&
            !respondendo.reenvio &&
            simuladaSubstituivel(
              respondendo.acao === "publica" ? respondendo.comentario.public_reply : respondendo.comentario.private_reply,
              respondendo.comentario,
            ) && (
              <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground" data-testid="aviso-substitui-simulada">
                {t("Este comentário tem uma resposta simulada, que não foi publicada. A resposta que você enviar agora será publicada de verdade e fica no lugar dela.")}
              </p>
            )}
          {respondendo?.reenvio && (
            <p role="status" className="rounded-md border border-warning/40 bg-warning-bg p-3 text-sm text-text-muted">
              {t("Você está enviando de novo uma resposta que pode já ter sido publicada. Se ela saiu, a pessoa verá duas.")}
            </p>
          )}
          <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-md border p-3 text-sm text-muted-foreground">
            {respondendo?.comentario.text ?? ""}
          </p>
          <div className="space-y-2">
            <Label htmlFor="texto-da-resposta">{t("Sua resposta")}</Label>
            <Textarea
              id="texto-da-resposta"
              rows={4}
              maxLength={TETO_DO_TEXTO_DA_RESPOSTA}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
          </div>
          {respondendo?.acao === "privada" && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={criarContato} onChange={(e) => setCriarContato(e.target.checked)} />
              {t("Criar o contato desta pessoa, se ainda não existir, e guardar a mensagem na conversa dela.")}
            </label>
          )}
          {erroDaAcao && (
            <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
              {erroDaAcao}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={ocupado} onClick={() => setRespondendo(null)}>
              {t("Cancelar")}
            </Button>
            <Button disabled={ocupado || !texto.trim()} onClick={() => void enviarResposta()} data-testid="enviar-resposta">
              {ocupado ? t("Enviando…") : t(respondendo?.reenvio ? "Enviar de novo" : "Enviar resposta")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!ignorando} onOpenChange={(aberto) => !aberto && !ocupado && setIgnorando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Marcar como sem ação?")}</DialogTitle>
            <DialogDescription>
              {t("O comentário sai da fila de novos. Nada é enviado nem publicado.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="motivo-do-ignorar">{t("Motivo (opcional)")}</Label>
            <Input id="motivo-do-ignorar" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          {erroDaAcao && (
            <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
              {erroDaAcao}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={ocupado} onClick={() => setIgnorando(null)}>
              {t("Cancelar")}
            </Button>
            <Button disabled={ocupado} onClick={() => void ignorar()} data-testid="confirmar-ignorar">
              {t("Marcar como sem ação")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!ocultando} onOpenChange={(aberto) => !aberto && !ocupado && setOcultando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Ocultar este comentário?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("O comentário deixa de aparecer para o público na publicação. Com a conexão em modo de registro, a ocultação fica só anotada e nada muda no Instagram.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ocupado}>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction disabled={ocupado} onClick={() => void ocultar()} data-testid="confirmar-ocultar">
              {t("Ocultar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
