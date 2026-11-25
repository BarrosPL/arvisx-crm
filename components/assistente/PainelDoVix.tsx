"use client";

/**
 * O PAINEL DO VIX — o assistente em todas as telas do CRM.
 *
 * Um botão fixo (e o atalho ⌘J / Ctrl+J; o ⌘K é da paleta de navegação, que
 * também tem uma entrada para abrir o assistente) abre um painel lateral com a
 * conversa. A resposta chega em stream.
 *
 * O painel não decide nada de segurança: quem decide é o servidor. Aqui só se
 * desenha o que a rota devolve — texto, cartões de ação e botões de abrir tela.
 *
 *  - CARTÃO: o assistente propõe; a ação só acontece quando a pessoa clica em
 *    Confirmar. No cartão reforçado, o botão só libera depois de digitar a
 *    palavra. O clique chama `acoes/:id/confirmar`, que confere tudo de novo.
 *  - ABRIR TELA: o endereço vem do servidor (catálogo de navegação), nunca do
 *    texto da resposta. O texto do assistente é desenhado como TEXTO, sem
 *    transformar endereço em link.
 *  - Nenhuma mensagem técnica: erro vira frase simples.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useHotkeys } from "react-hotkeys-hook";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { HEADER_ORG_DA_ABA, orgDaAba } from "@/lib/auth/org-da-aba";
import { PaperPlaneTilt, Sparkle, X } from "@/lib/ui/icons";
import { randomId } from "@/lib/random-id";
import { cn } from "@/lib/utils";

import { EVENTO_ABRIR_O_VIX, definirVixPresente } from "./presenca";

type Modo = "suporte" | "consultor";

interface Cartao {
  id: string;
  nivel: "escrever" | "sensivel";
  resumo: string;
  itens: { id: string; rotulo: string }[];
  estado: "proposta" | "executada" | "cancelada" | "falhou";
  aviso?: string;
}

interface Item {
  chave: string;
  autor: "usuario" | "assistente";
  texto: string;
  cartoes: Cartao[];
  telas: { nome: string; abrir: string }[];
  /** Resposta fixa do servidor (bloqueio de segredo, limite, indisponível). */
  aviso?: boolean;
}


function cabecalhos(): Record<string, string> {
  const aba = orgDaAba();
  return { "content-type": "application/json", ...(aba?.orgId ? { [HEADER_ORG_DA_ABA]: aba.orgId } : {}) };
}

const PALAVRA = "confirmar";

function CartaoDeAcao({
  cartao,
  aoMudar,
}: {
  cartao: Cartao;
  aoMudar: (id: string, mudanca: Partial<Cartao>) => void;
}) {
  const t = useT();
  const [palavra, setPalavra] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const reforcado = cartao.nivel === "sensivel";
  const liberado = !reforcado || palavra.trim().toLowerCase() === PALAVRA;

  const chamar = async (acao: "confirmar" | "cancelar") => {
    setOcupado(true);
    try {
      const r = await fetch(`/api/v1/assistente/acoes/${cartao.id}/${acao}`, {
        method: "POST",
        headers: cabecalhos(),
        body: JSON.stringify(acao === "confirmar" && reforcado ? { confirmacao: palavra.trim() } : {}),
      });
      if (r.ok) {
        aoMudar(cartao.id, { estado: acao === "confirmar" ? "executada" : "cancelada", aviso: undefined });
        return;
      }
      const corpo = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
      aoMudar(cartao.id, {
        estado: "falhou",
        aviso: corpo?.error?.message ?? t("Não consegui concluir esta ação. Nada foi alterado."),
      });
    } catch {
      aoMudar(cartao.id, { estado: "falhou", aviso: t("Não consegui concluir esta ação. Nada foi alterado.") });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div
      data-testid="vix-cartao"
      data-estado={cartao.estado}
      className={cn(
        "mt-2 rounded-md border bg-surface p-3 text-[13px]",
        reforcado ? "border-warning" : "border-border-strong",
      )}
    >
      <p className="font-medium text-text">{reforcado ? t("Ação que pede atenção") : t("Ação proposta")}</p>
      <p className="mt-1 text-text">{cartao.resumo}</p>
      {cartao.itens.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted-foreground">
          {cartao.itens.map((item) => (
            <li key={item.id}>{item.rotulo}</li>
          ))}
        </ul>
      )}

      {cartao.estado === "proposta" && (
        <>
          <p className="mt-2 text-muted-foreground">{t("Nada foi alterado ainda. A ação só acontece se você confirmar.")}</p>
          {reforcado && (
            <div className="mt-2">
              <label htmlFor={`vix-palavra-${cartao.id}`} className="text-muted-foreground">
                {t("Para confirmar esta ação, digite a palavra confirmar.")}
              </label>
              <Input
                id={`vix-palavra-${cartao.id}`}
                value={palavra}
                onChange={(e) => setPalavra(e.target.value)}
                autoComplete="off"
                className="mt-1"
              />
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={ocupado || !liberado} onClick={() => void chamar("confirmar")}>
              {t("Confirmar")}
            </Button>
            <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void chamar("cancelar")}>
              {t("Cancelar")}
            </Button>
          </div>
        </>
      )}
      {cartao.estado === "executada" && <p className="mt-2 font-medium text-success">{t("Feito.")}</p>}
      {cartao.estado === "cancelada" && <p className="mt-2 text-muted-foreground">{t("Cancelado. Nada foi alterado.")}</p>}
      {cartao.estado === "falhou" && (
        <p role="alert" className="mt-2 text-error">
          {cartao.aviso ?? t("Não consegui concluir esta ação. Nada foi alterado.")}
        </p>
      )}
    </div>
  );
}

export function PainelDoVix() {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const [modo, setModo] = useState<Modo>("suporte");
  const [itens, setItens] = useState<Item[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement | null>(null);

  const abrirPainel = useCallback(() => setAberto(true), []);

  useHotkeys("mod+j", () => (aberto ? setAberto(false) : abrirPainel()), { preventDefault: true, enableOnFormTags: true });

  useEffect(() => {
    const abrir = () => abrirPainel();
    window.addEventListener(EVENTO_ABRIR_O_VIX, abrir);
    definirVixPresente(true);
    return () => {
      window.removeEventListener(EVENTO_ABRIR_O_VIX, abrir);
      definirVixPresente(false);
    };
  }, [abrirPainel]);

  useEffect(() => {
    fim.current?.scrollIntoView?.({ block: "end" });
  }, [itens]);

  const mudarCartao = (id: string, mudanca: Partial<Cartao>) =>
    setItens((atuais) =>
      atuais.map((item) => ({ ...item, cartoes: item.cartoes.map((c) => (c.id === id ? { ...c, ...mudanca } : c)) })),
    );

  const enviar = async () => {
    const pergunta = texto.trim();
    if (pergunta === "" || enviando) return;
    const turno = randomId();
    const chaveDaResposta = `${turno}:assistente`;
    setTexto("");
    setEnviando(true);
    setItens((atuais) => [
      ...atuais,
      { chave: `${turno}:usuario`, autor: "usuario", texto: pergunta, cartoes: [], telas: [] },
      { chave: chaveDaResposta, autor: "assistente", texto: "", cartoes: [], telas: [] },
    ]);
    const naResposta = (mudar: (item: Item) => Item) =>
      setItens((atuais) => atuais.map((item) => (item.chave === chaveDaResposta ? mudar(item) : item)));
    const falhar = (frase: string) => naResposta((item) => ({ ...item, texto: frase, aviso: true }));

    try {
      const r = await fetch("/api/v1/assistente/mensagens", {
        method: "POST",
        headers: cabecalhos(),
        body: JSON.stringify({
          turn_id: turno,
          texto: pergunta,
          modo,
          ...(conversaId ? { conversa_id: conversaId } : {}),
          ...(typeof window !== "undefined" && window.location.pathname.startsWith("/app")
            ? { tela_atual: window.location.pathname.slice(0, 200) }
            : {}),
        }),
      });

      const tipo = r.headers.get("content-type") ?? "";
      if (!tipo.includes("text/event-stream")) {
        const corpo = (await r.json().catch(() => null)) as {
          data?: { mensagem?: string; abrir?: string; conversa_id?: string };
          error?: { message?: string };
        } | null;
        if (corpo?.data?.conversa_id) setConversaId(corpo.data.conversa_id);
        const frase = corpo?.data?.mensagem ?? corpo?.error?.message ?? t("Não consegui concluir a resposta agora. Tente de novo em instantes.");
        naResposta((item) => ({
          ...item,
          texto: frase,
          aviso: true,
          telas: corpo?.data?.abrir ? [{ nome: t("Credenciais de IA"), abrir: corpo.data.abrir }] : [],
        }));
        return;
      }

      const leitor = r.body?.getReader();
      if (!leitor) {
        falhar(t("Não consegui concluir a resposta agora. Tente de novo em instantes."));
        return;
      }
      const decodificador = new TextDecoder();
      let resto = "";
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        resto += decodificador.decode(value, { stream: true });
        const blocos = resto.split("\n\n");
        resto = blocos.pop() ?? "";
        for (const bloco of blocos) {
          if (!bloco.startsWith("data: ")) continue;
          let evento: Record<string, unknown>;
          try {
            evento = JSON.parse(bloco.slice(6)) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (evento.tipo === "inicio" && typeof evento.conversa_id === "string") setConversaId(evento.conversa_id);
          if (evento.tipo === "texto" && typeof evento.texto === "string") {
            const pedaco = evento.texto;
            naResposta((item) => ({ ...item, texto: item.texto + pedaco }));
          }
          if (evento.tipo === "cartao" && evento.cartao && typeof evento.cartao === "object") {
            const c = evento.cartao as Omit<Cartao, "estado">;
            naResposta((item) => ({ ...item, cartoes: [...item.cartoes, { ...c, estado: "proposta" }] }));
          }
          if (evento.tipo === "tela" && typeof evento.abrir === "string" && typeof evento.nome === "string") {
            const tela = { nome: evento.nome, abrir: evento.abrir };
            naResposta((item) =>
              item.telas.some((x) => x.abrir === tela.abrir) ? item : { ...item, telas: [...item.telas, tela] },
            );
          }
          if (evento.tipo === "indisponivel" && typeof evento.mensagem === "string") {
            const frase = evento.mensagem;
            naResposta((item) => ({ ...item, texto: item.texto === "" ? frase : `${item.texto}\n\n${frase}`, aviso: true }));
          }
        }
      }
    } catch {
      falhar(t("Não consegui concluir a resposta agora. Tente de novo em instantes."));
    } finally {
      setEnviando(false);
    }
  };

  const novaConversa = () => {
    setItens([]);
    setConversaId(null);
  };

  return (
    <>
      <button
        type="button"
        data-testid="vix-botao"
        aria-label={t("Abrir o assistente")}
        title={t("Assistente (Ctrl+J)")}
        onClick={abrirPainel}
        className={cn(
          "fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-cta text-cta-foreground shadow-lg",
          "transition-transform hover:scale-105 focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-cta-leve md:bottom-6 md:right-6",
          aberto && "hidden",
        )}
      >
        <Sparkle size={22} aria-hidden />
      </button>

      {aberto && (
        <aside
          data-testid="vix-painel"
          role="dialog"
          aria-label={t("Assistente")}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-border-strong bg-surface shadow-xl"
        >
          <header className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Sparkle size={18} aria-hidden className="text-cta" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-text">Vix</p>
              <p className="truncate text-[12px] text-muted-foreground">{t("Assistente do CRM")}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={novaConversa} disabled={enviando || itens.length === 0}>
              {t("Nova conversa")}
            </Button>
            <button
              type="button"
              aria-label={t("Fechar o assistente")}
              onClick={() => setAberto(false)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-elevated hover:text-text"
            >
              <X size={16} aria-hidden />
            </button>
          </header>

          <div className="flex items-center gap-1 border-b border-border px-4 py-2 text-[12px]" role="group" aria-label={t("Modo do assistente")}>
            {(["suporte", "consultor"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={modo === m}
                onClick={() => setModo(m)}
                className={cn(
                  "rounded-full px-3 py-1",
                  modo === m ? "bg-cta-leve font-medium text-text" : "text-muted-foreground hover:text-text",
                )}
              >
                {m === "suporte" ? t("Suporte") : t("Consultor")}
              </button>
            ))}
            <span className="ml-1 rounded-full px-3 py-1 text-text-subtle" aria-disabled="true">
              {t("Primeiros passos (em breve)")}
            </span>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" data-testid="vix-conversa">
            {itens.length === 0 && (
              <div className="text-[13px] text-muted-foreground">
                <p className="text-text">{t("Oi! Sou o Vix. Posso tirar dúvidas de uso, consultar os dados da sua conta e mostrar a tela certa.")}</p>
                <p className="mt-2">{t("Nunca cole chave, senha ou código aqui: isso é feito pela tela de Credenciais.")}</p>
              </div>
            )}
            {itens.map((item) => (
              <div key={item.chave} className={cn("flex", item.autor === "usuario" ? "justify-end" : "justify-start")}>
                <div
                  data-testid={item.autor === "usuario" ? "vix-pergunta" : "vix-resposta"}
                  className={cn(
                    "max-w-[92%] rounded-lg px-3 py-2 text-[13px] leading-relaxed",
                    item.autor === "usuario" ? "bg-cta-leve text-text" : "bg-surface-elevated text-text",
                    item.aviso && "border border-border-strong",
                  )}
                >
                  {item.texto === "" && item.cartoes.length === 0 ? (
                    <span className="text-muted-foreground">{t("Pensando...")}</span>
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{item.texto}</p>
                  )}
                  {item.telas.map((tela) => (
                    <Link
                      key={tela.abrir}
                      href={tela.abrir}
                      data-testid="vix-abrir-tela"
                      className="mt-2 inline-flex items-center rounded-md border border-border-strong px-2.5 py-1 text-[12px] font-medium text-text hover:bg-surface"
                    >
                      {t("Abrir a tela")} {tela.nome}
                    </Link>
                  ))}
                  {item.cartoes.map((cartao) => (
                    <CartaoDeAcao key={cartao.id} cartao={cartao} aoMudar={mudarCartao} />
                  ))}
                </div>
              </div>
            ))}
            <div ref={fim} />
          </div>

          <footer className="border-t border-border px-4 py-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void enviar();
                  }
                }}
                placeholder={t("Escreva sua pergunta...")}
                aria-label={t("Mensagem para o assistente")}
                maxLength={4000}
                rows={2}
                className="min-h-[44px] flex-1 resize-none"
              />
              <Button size="sm" onClick={() => void enviar()} disabled={enviando || texto.trim() === ""} aria-label={t("Enviar")}>
                <PaperPlaneTilt size={16} aria-hidden />
              </Button>
            </div>
          </footer>
        </aside>
      )}
    </>
  );
}
