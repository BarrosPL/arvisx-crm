import Link from "next/link";

import { EntrarComGoogle } from "@/components/auth/EntrarComGoogle";
import { SimboloDoProduto } from "@/components/branding/MarcaDoProduto";
import { marcaEhADoProduto } from "@/lib/branding";
import { LoginForm } from "@/components/auth/LoginForm";
import { verifyInviteToken } from "@/lib/auth/invite-token";
import { marcaDaSaida } from "@/lib/branding/saida";
import { estadoDoProvedorGoogle } from "@/lib/auth/provedor-google";
import { createClient } from "@/lib/supabase/server";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { traduzir } from "@/lib/i18n/dicionario";
import { tituloDaTelaPublica } from "@/lib/i18n/titulo-da-tela-publica";

// A aba no idioma do visitante, como o corpo (`lib/i18n/titulo-da-tela-publica.ts`).
export const generateMetadata = () => tituloDaTelaPublica((t) => t("Entrar"));

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; error?: string }>;
}) {
  const { next, reset, error } = await searchParams;
  const invite =
    typeof next === "string" ? next.match(/^\/team\/accept-invite\/([^/?#]+)$/)?.[1] : undefined;
  const convite = invite ? verifyInviteToken(invite) : null;
  // Fora da árvore de `app/app/layout.tsx` — sem `IdiomaProvider` do lado do
  // servidor (o cliente já tem o seu, montado em `app/(public)/layout.tsx`).
  // Quase nunca há sessão aqui (é a própria tela de entrar), mas resolve do
  // mesmo jeito por segurança — `user` opcional.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = await idiomaDoVisitante(
    (user?.user_metadata?.locale as string | undefined) ?? null,
  );
  const t = (texto: string) => traduzir(texto, idioma);
  const marca = await marcaDaSaida(null);
  // O botão do Google só aparece quando o provedor está ligado no Supabase desta
  // instalação; sem isso ele só renderia um erro ao clicar. ("desconhecido" = o
  // Supabase não respondeu: também não mostra, para não prometer o que pode falhar.)
  const googleLigado = (await estadoDoProvedorGoogle()) === "ligado";

  return (
    <div className="space-y-6">
      <div className="space-y-5">
        {/* O ícone do app sobre o título, só quando a marca é a do produto: com
            logo de revendedor, quem assina a tela é o painel ao lado. */}
        {marcaEhADoProduto({ name: marca.nome, logoUrl: marca.logoUrl }) ? (
          <div className="flex h-16 w-16 items-center justify-center rounded-[18px] border border-border bg-surface shadow-sm">
            <SimboloDoProduto nome={marca.nome} decorativo sobreClaro className="h-11 w-auto" />
          </div>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight">{t("Entrar")}</h1>
        {/* O nome da instalação fica para o leitor de tela (e para quem mede a
            marca branca); visualmente o painel ao lado já o traz. */}
        <p className="sr-only">{marca.nome}</p>
      </div>
      {reset === "success" && (
        <div
          className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm"
          role="status"
        >
          {t("Senha redefinida com sucesso. Entre com a nova senha.")}
        </div>
      )}
      {error === "link_invalido" && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {t("Link inválido ou expirado. Peça um novo em Recuperar senha ou refaça o cadastro.")}
        </div>
      )}
      {/*
        Os dois avisos abaixo chegaram por frentes diferentes e falam de erros
        diferentes — o merge os pôs no mesmo lugar, e ficar com um só apagaria um
        diagnóstico inteiro da tela de login.
      */}
      {error === "convite_invalido" && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {t(
            "Sua conta foi confirmada, mas o convite não vale mais — ele expirou ou foi emitido para outro e-mail. Peça um novo a quem te convidou. Não criamos uma empresa nova para você, porque não era isso que você estava fazendo.",
          )}
        </div>
      )}
      {error === "cadastro_por_convite" && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {t(
            "Sua conta foi confirmada, mas esta instalação aceita cadastro apenas por convite — então não criamos uma empresa para você. Peça um convite a quem administra o sistema; o link dele já traz tudo o que falta.",
          )}
        </div>
      )}
      {error === "template_padrao" && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {t(
            "Este link veio do modelo de e-mail padrão do Supabase, que não fecha o acesso nesta instalação — pedir outro link não resolve. Quem administra o sistema precisa configurar os modelos de e-mail: na nuvem do Supabase, com ",
          )}
          <code>marca-emails.sh</code>
          {t(
            "; num Supabase próprio, apontando GOTRUE_MAILER_TEMPLATES_* para as rotas /email-templates/ do app.",
          )}
        </div>
      )}
      {error === "provisionamento" && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {t(
            "Sua conta foi confirmada, mas houve um erro ao preparar seu ambiente. Tente entrar novamente em instantes.",
          )}
        </div>
      )}
      {/*
        As duas recusas da entrada com Google, separadas de propósito: uma é
        falha da volta (o `code` não virou sessão), a outra é desistência de
        quem estava do outro lado. A mesma mensagem para as duas mandaria a
        pessoa "tentar de novo" quando ela só fechou a tela — e procurar
        defeito onde não há.
      */}
      {error === "entrada_com_google" && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {t(
            "Não foi possível concluir a entrada com o Google. Tente novamente — se acontecer de novo, entre com e-mail e senha.",
          )}
        </div>
      )}
      {error === "entrada_com_google_cancelada" && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {t("A entrada com o Google foi cancelada antes de terminar. Nada mudou na sua conta.")}
        </div>
      )}
      {/* A terceira recusa da entrada com Google: a conta está confirmada, mas o
          acesso dela foi retirado. Não é convite inválido (não havia convite
          nenhum) nem falha do Google — é decisão de quem administra, e a tela
          diz exatamente isso, em vez de mandar a pessoa "tentar de novo". */}
      {error === "acesso_revogado" && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {t(
            "O acesso desta conta foi retirado por quem administra o sistema — então não criamos uma empresa nova para você. Se o acesso deveria continuar, peça a quem administra para restaurá-lo; se você está entrando em outra equipe, peça um convite.",
          )}
        </div>
      )}
      <LoginForm next={next} email={convite?.email} />
      {googleLigado ? <EntrarComGoogle next={next} /> : null}
      <div className="space-y-2 text-center text-sm">
        <p>
          <Link
            href="/login/forgot"
            className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            {t("Esqueci minha senha")}
          </Link>
        </p>
      </div>
    </div>
  );
}
