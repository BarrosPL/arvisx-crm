"use client";

/**
 * Instagram e Facebook Messenger conectados DIRETO na Meta — o cartão da
 * organização em Conexões › Facebook / Instagram.
 *
 * A porta preferida (a primeira do catálogo, `lib/channels/social/catalog.ts`):
 * fica no topo da aba, acima da conexão por parceiro, que continua lá para quem
 * já a usa. O fluxo inteiro mora no servidor (`/api/v1/channels/meta-social`);
 * aqui ficam os estados que a pessoa vê:
 *
 *   - app da Meta não configurado na INSTALAÇÃO → botão desligado, dizendo a
 *     quem pedir (não é algo que o admin da empresa resolva);
 *   - pronto → "Conectar" leva ao login do Facebook;
 *   - volta do login (`?meta_estado&meta_code`) → conclui sozinho e mostra as
 *     páginas autorizadas para escolher;
 *   - conectadas → cada conta com pausar, renomear, IA, atendimento e desconectar;
 *   - no Instagram → o estado dos COMENTÁRIOS (desligado, registrando, ativo), a
 *     troca de modo, o aviso de permissão que falta e "Reautorizar para
 *     comentários".
 *
 * Reautorizar é o MESMO login, refeito: a conexão não é apagada, e o modo dos
 * comentários não muda (quem o grava é só `definirModoDeComentarios`, no
 * servidor). A tela só lembra, de uma ida à Meta para a volta, qual conta
 * estava sendo reautorizada — para já deixar marcada a página dela e as redes
 * que ela já tinha, em vez de oferecer uma conexão nova por engano.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
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
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { canalDesativado } from "@/lib/channels/desativado";

import { ChannelAiAccess } from "./ChannelAiAccess";
import { RenomearConexao } from "./RenomearConexao";

type Rede = "facebook" | "instagram";
type ModoDeComentarios = "off" | "registrar" | "real";

/** O que `GET /api/v1/channels/meta-social` diz dos comentários de uma conexão do Instagram. */
interface Comentarios {
  modo: ModoDeComentarios;
  escopo_concedido: boolean;
  disponivel: boolean;
}

interface Conexao {
  id: string;
  rede: Rede;
  conta: string;
  pagina: string | null;
  display_name: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  /** Só nas conexões do Instagram; ausente em servidor anterior aos comentários. */
  comentarios?: Comentarios | null;
}

interface Estado {
  disponivel: boolean;
  falta: string[];
  conexoes: Conexao[];
}

interface Pagina {
  id: string;
  nome: string;
  pode_mensagens: boolean;
  instagram: { id: string; username: string | null } | null;
}

interface Escolha {
  selecao: string;
  instagram_permitido: boolean;
  paginas: Pagina[];
}

const ROTULO_DA_REDE: Record<Rede, string> = { facebook: "Facebook Messenger", instagram: "Instagram" };

const MODOS: readonly ModoDeComentarios[] = ["off", "registrar", "real"];
const ROTULO_DO_MODO: Record<ModoDeComentarios, string> = { off: "Desligado", registrar: "Registrando", real: "Ativo" };
const SELO_DO_MODO: Record<ModoDeComentarios, "neutral" | "info" | "success"> = {
  off: "neutral",
  registrar: "info",
  real: "success",
};
const O_QUE_O_MODO_FAZ: Record<ModoDeComentarios, string> = {
  off: "Os comentários que chegam são descartados e nada é respondido.",
  registrar: "Os comentários são guardados. As respostas ficam só anotadas, como simuladas: nada é publicado.",
  real: "Os comentários são guardados e as respostas são publicadas de verdade no Instagram.",
};

/**
 * A reautorização em andamento, guardada só durante a ida à Meta. `sessionStorage`
 * pode faltar ou lançar (janela privada, dado bloqueado): sem ela a volta do
 * login funciona como um Conectar comum, e a pessoa escolhe a página à mão.
 */
const CHAVE_DA_REAUTORIZACAO = "conexao-direta-reautorizar";
interface Reautorizacao {
  conta: string;
  contasConectadas: string[];
}
function guardarReautorizacao(r: Reautorizacao): void {
  try {
    window.sessionStorage.setItem(CHAVE_DA_REAUTORIZACAO, JSON.stringify(r));
  } catch {
    // Sem armazenamento: segue como um Conectar comum.
  }
}
function retomarReautorizacao(): Reautorizacao | null {
  try {
    const cru = window.sessionStorage.getItem(CHAVE_DA_REAUTORIZACAO);
    window.sessionStorage.removeItem(CHAVE_DA_REAUTORIZACAO);
    if (!cru) return null;
    const v = JSON.parse(cru) as Partial<Reautorizacao> | null;
    if (!v || typeof v.conta !== "string" || !Array.isArray(v.contasConectadas)) return null;
    return { conta: v.conta, contasConectadas: v.contasConectadas.filter((c): c is string => typeof c === "string") };
  } catch {
    return null;
  }
}

/** Nome da CONEXÃO (página/conta da Meta), não de contato: primeiro valor preenchido. */
function nomeDaConexao(c: { display_name?: string | null; pagina?: string | null; conta?: string | null }) {
  return [c.display_name, c.pagina, c.conta].find((v) => v && v.trim()) ?? "";
}

/**
 * `emHomologacao`: a conexão ainda não foi liberada pela Meta. O botão de
 * conectar fica apagado; quem já conectou segue podendo pausar e desconectar.
 */
export function ConexaoDiretaMeta({ emHomologacao = false }: { emHomologacao?: boolean } = {}) {
  const t = useT();
  const params = useSearchParams();
  const query = useQuery({
    queryKey: ["meta-social"],
    queryFn: async () => (await apiClient.get<{ data: Estado }>("/api/v1/channels/meta-social")).data,
  });
  // Defensivo: resposta fora do formato (proxy, versão antiga do servidor) não
  // derruba a aba inteira — o cartão só fica sem conexões.
  const estado = query.data
    ? { ...query.data, falta: query.data.falta ?? [], conexoes: query.data.conexoes ?? [] }
    : undefined;
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [escolha, setEscolha] = useState<Escolha | null>(null);
  const [pagina, setPagina] = useState<string>("");
  const [redes, setRedes] = useState<Rede[]>(["facebook", "instagram"]);
  const [desconectando, setDesconectando] = useState<Conexao | null>(null);
  const [ligandoDeVerdade, setLigandoDeVerdade] = useState<Conexao | null>(null);
  /** `achou`: a página da conexão reautorizada veio entre as autorizadas. */
  const [reautorizando, setReautorizando] = useState<{ achou: boolean } | null>(null);
  const concluiu = useRef(false);

  const metaEstado = params.get("meta_estado");
  const metaCode = params.get("meta_code");
  const metaErro = params.get("meta_erro");

  // A volta do login: conclui UMA vez e limpa a URL (o código é de uso único,
  // e um F5 com ele na barra só produziria um erro confuso).
  useEffect(() => {
    if (!metaEstado || concluiu.current) return;
    concluiu.current = true;
    // `history.replaceState` e não `router.replace`: limpar a URL não é navegar
    // (o App Router sincroniza os parâmetros com o histórico nativo), e uma
    // navegação aqui remontaria a aba no meio da conclusão.
    window.history.replaceState(null, "", "/app/connections?aba=sociais");
    setOcupado("concluir");
    setErro(null);
    apiClient
      .post<{ data: Escolha }>("/api/v1/channels/meta-social", {
        acao: "concluir",
        estado: metaEstado,
        ...(metaCode ? { code: metaCode } : {}),
        ...(metaErro ? { erro: metaErro } : {}),
      })
      .then((r) => {
        setEscolha(r.data);
        // Volta de "Reautorizar para comentários": a página daquela conta já
        // vem marcada, só com as redes que ela JÁ tinha — reautorizar não pode
        // criar, de carona, uma conexão do Messenger que a empresa não pediu.
        const reautorizacao = retomarReautorizacao();
        const daConta = reautorizacao ? r.data.paginas.find((p) => p.instagram?.id === reautorizacao.conta) : undefined;
        if (reautorizacao) setReautorizando({ achou: Boolean(daConta) });
        if (reautorizacao && daConta) {
          setPagina(daConta.id);
          setRedes(reautorizacao.contasConectadas.includes(daConta.id) ? ["facebook", "instagram"] : ["instagram"]);
          return;
        }
        const primeira = r.data.paginas[0];
        setPagina(primeira?.id ?? "");
        setRedes(primeira?.instagram ? ["facebook", "instagram"] : ["facebook"]);
      })
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : t("Não foi possível concluir a conexão.")))
      .finally(() => setOcupado(null));
  }, [metaEstado, metaCode, metaErro, t]);

  /**
   * Abre o login da Meta. `paraComentarios` é o login de REAUTORIZAÇÃO: o único
   * que pede as permissões de comentários. O Conectar comum nunca as pede — se
   * a Meta ainda não as liberou para o app, pedi-las derrubaria o login de quem
   * só quer mensagens.
   */
  async function iniciar(paraComentarios = false) {
    setOcupado("iniciar");
    setErro(null);
    try {
      const r = await apiClient.post<{ data: { url: string } }>(
        "/api/v1/channels/meta-social",
        paraComentarios ? { acao: "iniciar", para_comentarios: true } : { acao: "iniciar" },
      );
      window.location.assign(r.data.url);
    } catch (e) {
      setErro(e instanceof Error ? e.message : t("Não foi possível abrir a Meta."));
      setOcupado(null);
    }
  }

  /**
   * Refaz o login para a conexão ganhar as permissões de comentários. É um
   * login PRÓPRIO (pede as permissões de comentários, que o Conectar comum não
   * pede), com a mesma volta do Conectar: a conexão existente é atualizada (não
   * apagada) e o modo dos comentários fica como estava.
   */
  async function reautorizar(conexao: Conexao) {
    guardarReautorizacao({
      conta: conexao.conta,
      contasConectadas: (estado?.conexoes ?? []).map((c) => c.conta),
    });
    await iniciar(true);
  }

  async function mudarModo(conexao: Conexao, modo: ModoDeComentarios) {
    // Duplo clique na confirmação não manda a troca duas vezes.
    if (ocupado) return;
    setOcupado(conexao.id);
    setErro(null);
    try {
      await apiClient.post("/api/v1/channels/meta-social", {
        acao: "comentarios_modo",
        channel_session_id: conexao.id,
        modo,
      });
      toast.success(t("Modo dos comentários atualizado."));
      await query.refetch();
    } catch (e) {
      setErro(e instanceof Error ? e.message : t("Não foi possível mudar o modo dos comentários. Tente de novo."));
    } finally {
      setLigandoDeVerdade(null);
      setOcupado(null);
    }
  }

  /** Publicar de verdade pede confirmação; desligar e registrar, não. */
  function escolherModo(conexao: Conexao, modo: ModoDeComentarios) {
    if (modo === conexao.comentarios?.modo) return;
    if (modo === "real") setLigandoDeVerdade(conexao);
    else void mudarModo(conexao, modo);
  }

  async function conectar() {
    if (!escolha || !pagina) return;
    setOcupado("conectar");
    setErro(null);
    try {
      await apiClient.post("/api/v1/channels/meta-social", {
        acao: "conectar",
        selecao: escolha.selecao,
        page_id: pagina,
        redes,
      });
      toast.success(t("Conectado. As novas mensagens entram na caixa de entrada."));
      setEscolha(null);
      setReautorizando(null);
      await query.refetch();
    } catch (e) {
      setErro(e instanceof Error ? e.message : t("Não foi possível concluir a conexão."));
    } finally {
      setOcupado(null);
    }
  }

  async function desconectar(conexao: Conexao) {
    setOcupado(conexao.id);
    setErro(null);
    try {
      await apiClient.post("/api/v1/channels/meta-social", { acao: "desconectar", channel_session_id: conexao.id });
      toast.success(t("Conta desconectada. As conversas já recebidas continuam no CRM."));
      setDesconectando(null);
      await query.refetch();
    } catch (e) {
      setErro(e instanceof Error ? e.message : t("Não foi possível desconectar."));
    } finally {
      setOcupado(null);
    }
  }

  async function alternarPausa(conexao: Conexao) {
    const desligar = !canalDesativado(conexao.metadata);
    setOcupado(conexao.id);
    setErro(null);
    try {
      await apiClient.patch(`/api/v1/channel-sessions/${conexao.id}/disabled`, { disabled: desligar });
      toast.success(t(desligar ? "Canal pausado." : "Canal reativado."));
      await query.refetch();
    } catch (e) {
      setErro(e instanceof Error ? e.message : t("Não foi possível mudar o estado do canal."));
    } finally {
      setOcupado(null);
    }
  }

  const paginaEscolhida = escolha?.paginas.find((p) => p.id === pagina) ?? null;
  const semAppDaMeta = estado && !estado.disponivel;
  const redesValidas = redes.filter((r) => r === "facebook" || Boolean(paginaEscolhida?.instagram));
  const podeConectar = !ocupado && Boolean(pagina) && redesValidas.length > 0;

  return (
    <Card className="flex flex-col gap-4 p-4" data-testid="conexao-direta-meta">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{t("Instagram e Facebook Messenger")}</h3>
            <Badge variant="secondary">{t("Recomendado")}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("Conecte direto pela Meta, sem parceiro: entre com o Facebook, escolha a página e as mensagens do Messenger e do Instagram ligado a ela chegam no atendimento.")}
          </p>
        </div>
        <Button
          data-testid="conectar-direto-meta"
          disabled={emHomologacao || !estado || !!semAppDaMeta || !!ocupado}
          onClick={() => void iniciar()}
        >
          {ocupado === "iniciar" ? t("Abrindo…") : t("Conectar Instagram / Facebook")}
        </Button>
      </div>

      {semAppDaMeta && (
        <p
          role="status"
          data-testid="meta-app-nao-configurado"
          className="rounded-md border border-warning/40 bg-warning-bg p-3 text-sm text-text-muted"
        >
          {estado.falta.includes("sem_endereco_publico") && estado.falta.length === 1
            ? t("O endereço público desta instalação não está configurado, então a Meta não teria para onde devolver a conexão. Peça a quem administra a instalação para defini-lo.")
            : t("O app da Meta desta instalação ainda não foi configurado. Peça a quem administra a instalação para cadastrar o App ID e a chave secreta em Administração › API Oficial da Meta.")}
        </p>
      )}

      {ocupado === "concluir" && (
        <p role="status" className="text-sm">
          {t("Conferindo a autorização na Meta…")}
        </p>
      )}

      {erro && (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {erro}
        </p>
      )}

      {escolha && (
        <div className="flex flex-col gap-3 rounded-md border p-3" data-testid="escolha-da-pagina">
          {escolha.paginas.length === 0 ? (
            <p className="text-sm">
              {t("Nenhuma página do Facebook foi autorizada. Clique em Conectar de novo e marque a página da empresa — o Instagram profissional precisa estar ligado a uma página.")}
            </p>
          ) : (
            <>
              {reautorizando && (
                <p role="status" data-testid="aviso-de-reautorizacao" className="text-sm text-muted-foreground">
                  {reautorizando.achou
                    ? t("Reautorização: a página desta conexão já está marcada. Confirme para atualizar as permissões. A conexão não é apagada e o modo dos comentários não muda.")
                    : t("A página desta conexão não veio entre as autorizadas. Clique em Reautorizar de novo e marque a mesma página na Meta.")}
                </p>
              )}
              <p className="text-sm font-medium">{t("Qual página você quer conectar?")}</p>
              <div className="flex flex-col gap-2">
                {escolha.paginas.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm">
                    <input
                      type="radio"
                      name="pagina-meta"
                      value={p.id}
                      checked={pagina === p.id}
                      onChange={() => {
                        setPagina(p.id);
                        setRedes(p.instagram ? ["facebook", "instagram"] : ["facebook"]);
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{p.nome}</span>
                      <span className="block text-xs text-muted-foreground">
                        {p.instagram
                          ? `${t("Instagram ligado:")} ${p.instagram.username ? `@${p.instagram.username}` : p.instagram.id}`
                          : t("Sem Instagram profissional ligado a esta página.")}
                      </span>
                      {!p.pode_mensagens && (
                        <span className="block text-xs text-destructive">
                          {t("Sua função nesta página não permite responder mensagens.")}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
              <fieldset className="flex flex-wrap gap-4 text-sm">
                <legend className="mb-1 text-sm font-medium">{t("Receber mensagens de")}</legend>
                {(["facebook", "instagram"] as const).map((rede) => {
                  const semIg = rede === "instagram" && (!paginaEscolhida?.instagram || !escolha.instagram_permitido);
                  return (
                    <label key={rede} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        disabled={semIg}
                        checked={redes.includes(rede) && !semIg}
                        onChange={(e) =>
                          setRedes((atual) =>
                            e.target.checked ? [...new Set([...atual, rede])] : atual.filter((r) => r !== rede),
                          )
                        }
                      />
                      {t(ROTULO_DA_REDE[rede])}
                    </label>
                  );
                })}
              </fieldset>
              {!escolha.instagram_permitido && (
                <p className="text-xs text-muted-foreground">
                  {t("As permissões do Instagram não foram aceitas. Para conectar o Instagram, clique em Conectar de novo e mantenha todas marcadas.")}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  data-testid="confirmar-pagina-meta"
                  disabled={!podeConectar}
                  onClick={() => void conectar()}
                >
                  {ocupado === "conectar" ? t("Conectando…") : t("Conectar")}
                </Button>
                <Button
                  variant="outline"
                  disabled={!!ocupado}
                  onClick={() => {
                    setEscolha(null);
                    setReautorizando(null);
                  }}
                >
                  {t("Cancelar")}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {(estado?.conexoes ?? []).length > 0 && (
        <div className="grid gap-3 xl:grid-cols-2">
          {(estado?.conexoes ?? []).map((c) => (
            <div key={c.id} className="flex flex-col gap-3 rounded-md border p-3" data-testid="conexao-direta">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t(ROTULO_DA_REDE[c.rede])}
                  </p>
                  <p className="truncate font-semibold">{nomeDaConexao(c)}</p>
                  {c.pagina && <p className="truncate text-xs text-muted-foreground">{`${t("Página:")} ${c.pagina}`}</p>}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant={c.status === "WORKING" ? "secondary" : "outline"}>
                    {c.status === "WORKING" ? t("Recebendo") : t("Reconectar")}
                  </Badge>
                  {canalDesativado(c.metadata) && <Badge variant="neutral">{t("Pausado")}</Badge>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <RenomearConexao channelId={c.id} currentName={c.display_name} onSaved={() => query.refetch()} />
                <Button variant="outline" disabled={!!ocupado} onClick={() => void alternarPausa(c)}>
                  {canalDesativado(c.metadata) ? t("Retomar") : t("Pausar")}
                </Button>
                <Button asChild variant="outline">
                  <Link href="/app/inbox">{t("Abrir atendimento")}</Link>
                </Button>
                <Button variant="destructive" disabled={!!ocupado} onClick={() => setDesconectando(c)}>
                  {t("Desconectar")}
                </Button>
              </div>
              {c.status !== "WORKING" && (
                <p className="text-xs text-muted-foreground">
                  {t("A Meta não confirmou o recebimento desta conta. Clique em Conectar de novo e escolha a mesma página.")}
                </p>
              )}
              {c.rede === "instagram" && c.comentarios && (
                <div className="flex flex-col gap-2 border-t pt-3" data-testid="comentarios-da-conexao">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{t("Comentários")}</p>
                    <Badge variant={SELO_DO_MODO[c.comentarios.modo]} data-testid="estado-dos-comentarios">
                      {t(ROTULO_DO_MODO[c.comentarios.modo])}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{t(O_QUE_O_MODO_FAZ[c.comentarios.modo])}</p>
                  {!c.comentarios.escopo_concedido && (
                    <p
                      role="status"
                      data-testid="falta-permissao-de-comentarios"
                      className="rounded-md border border-warning/40 bg-warning-bg p-3 text-sm text-text-muted"
                    >
                      {t("Esta conexão ainda não tem a permissão de comentários do Instagram, então a Meta não entrega os comentários nem aceita as respostas. Reautorize e mantenha todas as permissões marcadas. As mensagens continuam funcionando normalmente.")}
                    </p>
                  )}
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`modo-dos-comentarios-${c.id}`}>{t("Modo dos comentários")}</Label>
                      <select
                        id={`modo-dos-comentarios-${c.id}`}
                        data-testid="modo-dos-comentarios"
                        className="rounded-md border bg-background p-2 text-sm"
                        disabled={!!ocupado}
                        value={c.comentarios.modo}
                        onChange={(e) => escolherModo(c, e.target.value as ModoDeComentarios)}
                      >
                        {MODOS.map((m) => (
                          <option key={m} value={m}>
                            {t(ROTULO_DO_MODO[m])}
                          </option>
                        ))}
                      </select>
                    </div>
                    {!c.comentarios.escopo_concedido && (
                      <Button
                        variant="outline"
                        data-testid="reautorizar-para-comentarios"
                        disabled={emHomologacao || !!semAppDaMeta || !!ocupado}
                        onClick={() => void reautorizar(c)}
                      >
                        {t("Reautorizar para comentários")}
                      </Button>
                    )}
                    <Button asChild variant="outline">
                      <Link href={`/app/inbox/comentarios?canal=${c.id}`}>{t("Ver comentários")}</Link>
                    </Button>
                  </div>
                </div>
              )}
              <ChannelAiAccess channelId={c.id} phoneTesting={false} />
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!desconectando} onOpenChange={(open) => !open && setDesconectando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Desconectar esta conta?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("As mensagens param de chegar e a autorização da Meta é apagada do CRM. As conversas já recebidas continuam no CRM. Para voltar, é só conectar de novo.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => desconectando && void desconectar(desconectando)}>
              {t("Desconectar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!ligandoDeVerdade} onOpenChange={(open) => !open && setLigandoDeVerdade(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Publicar as respostas de verdade?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("No modo ativo, toda resposta a comentário feita pela equipe ou por um sistema externo é publicada no Instagram, à vista de todos, e a resposta privada chega como mensagem direta a quem comentou. Para testar sem publicar, use Registrando.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="confirmar-modo-real"
              disabled={!!ocupado}
              onClick={() => ligandoDeVerdade && void mudarModo(ligandoDeVerdade, "real")}
            >
              {t("Ativar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
