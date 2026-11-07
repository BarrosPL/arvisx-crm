"use client";

/**
 * Instagram e Facebook Messenger conectados DIRETO na Meta — o cartão da
 * organização em Conexões › Redes sociais.
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
 *   - conectadas → cada conta com pausar, renomear, IA, atendimento e desconectar.
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
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { canalDesativado } from "@/lib/channels/desativado";

import { ChannelAiAccess } from "./ChannelAiAccess";
import { RenomearConexao } from "./RenomearConexao";

type Rede = "facebook" | "instagram";

interface Conexao {
  id: string;
  rede: Rede;
  conta: string;
  pagina: string | null;
  display_name: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
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

/** Nome da CONEXÃO (página/conta da Meta), não de contato: primeiro valor preenchido. */
function nomeDaConexao(c: { display_name?: string | null; pagina?: string | null; conta?: string | null }) {
  return [c.display_name, c.pagina, c.conta].find((v) => v && v.trim()) ?? "";
}

export function ConexaoDiretaMeta() {
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
        const primeira = r.data.paginas[0];
        setPagina(primeira?.id ?? "");
        setRedes(primeira?.instagram ? ["facebook", "instagram"] : ["facebook"]);
      })
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : t("Não foi possível concluir a conexão.")))
      .finally(() => setOcupado(null));
  }, [metaEstado, metaCode, metaErro, t]);

  async function iniciar() {
    setOcupado("iniciar");
    setErro(null);
    try {
      const r = await apiClient.post<{ data: { url: string } }>("/api/v1/channels/meta-social", { acao: "iniciar" });
      window.location.assign(r.data.url);
    } catch (e) {
      setErro(e instanceof Error ? e.message : t("Não foi possível abrir a Meta."));
      setOcupado(null);
    }
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
          disabled={!estado || !!semAppDaMeta || !!ocupado}
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
            : t("O app da Meta desta instalação ainda não foi configurado. Peça a quem administra a instalação para cadastrar o App ID e a chave secreta em Administração › API Oficial da Meta. Até lá, use a conexão por parceiro abaixo.")}
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
                <Button variant="outline" disabled={!!ocupado} onClick={() => setEscolha(null)}>
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
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
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
    </Card>
  );
}
