import Link from "next/link";

import { EntrarComGoogle } from "@/components/auth/EntrarComGoogle";
import { SignupForm } from "@/components/auth/SignupForm";
import { SimboloDoProduto } from "@/components/branding/MarcaDoProduto";
import { Button } from "@/components/ui/button";
import { marcaEhADoProduto } from "@/lib/branding";
import { marcaDaSaida } from "@/lib/branding/saida";
import { estadoDoProvedorGoogle } from "@/lib/auth/provedor-google";
import { verifyInviteToken } from "@/lib/auth/invite-token";
import { modoDeCadastro } from "@/lib/auth/politica-de-cadastro";
import { createClient } from "@/lib/supabase/server";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { lerCadastroNaTela, planoInicialDoSeletor, planosDoSeletor } from "@/lib/cobranca/cadastro";
import { tituloDaTelaPublica } from "@/lib/i18n/titulo-da-tela-publica";

// A aba no idioma do visitante, como o corpo (`lib/i18n/titulo-da-tela-publica.ts`).
export const generateMetadata = () => tituloDaTelaPublica((t) => t("Criar conta"));

/**
 * Aceita `?invite=<token>`: é o caminho de quem foi convidado e ainda não tem
 * conta. Sem isso, essa pessoa criava uma conta comum, e o provisionamento —
 * sem encontrar vínculo nenhum — abria uma organização e a tornava admin dela.
 *
 * O token só é lido aqui para MONTAR a tela (esconder o nome da empresa, travar
 * o e-mail). Quem decide o que ele vale é o servidor, duas vezes: ao criar a
 * conta e ao confirmar o e-mail.
 *
 * ── A recusa por política (migration 0233) ──────────────────────────────────
 *
 * Quando a instalação está em `so_convite`, esta tela RECUSA em vez de mostrar
 * o formulário — mas só nesse modo, e só sem convite válido. Ela é a SUPERFÍCIE
 * da recusa, nunca a autoridade: `signUp()` e `/auth/confirm` recusam por conta
 * própria, porque esta tela é adulterável e a server action é chamável direto.
 *
 * Por que uma tela e não um 403 do proxy: um 403 cru não tem marca, não tem
 * idioma e não tem saída — é o `return` mudo que o invariante 6(c) do Sistema
 * Vivo proíbe, e é péssima primeira impressão de um produto que se vende pela
 * instalação. Medido: a regra de nginx que fazia isso numa instalação real
 * barrou junto o `/signup?invite=…`, porque proxy não sabe o que é um convite.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  const payload = invite ? verifyInviteToken(invite) : null;
  const convite = invite && payload ? { token: invite, email: payload.email } : undefined;
  const conviteExpirado = Boolean(invite) && !payload;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = await idiomaDoVisitante(
    (user?.user_metadata?.locale as string | undefined) ?? null,
  );
  const t = (texto: string) => traduzir(texto, idioma);
  // O nome da marca vem do resolvedor que LÊ O BANCO (`marcaDaSaida`: banco
  // acima do `.env`, e nunca lança) — `branding()` só veria a semente do `.env`,
  // e o convite não muda isso (#2511, mesmo defeito das páginas `/legal`).
  const marca = await marcaDaSaida(null);
  // Com plano oferecido, o seletor aparece. O Google não leva a escolha: ele
  // some enquanto não há plano padrão — o gatilho recusaria a empresa —, e com
  // padrão a empresa dele nasce no padrão. Sem plano nenhum, nasce isenta e o
  // Google fica (doc 146, opção B). O critério é o de `lib/cobranca/cadastro.ts`,
  // o mesmo do gatilho. Leitura que falha não esconde nada: quem recusa é a action.
  // Plano de entrada (o "Teste", padrão e não oferecido): sem seletor, a
  // empresa nasce nele; os planos pagos se escolhem depois, em Plano e cobrança.
  const cadastro = convite ? null : await lerCadastroNaTela(createAdminClient());
  const planos = planosDoSeletor(cadastro);
  const googleSemPlano = cadastro?.exigeEscolha ?? false;

  // Convite VÁLIDO passa em qualquer modo — é o ponto inteiro do convite.
  const modo = convite ? null : await modoDeCadastro();
  const soPorConvite = modo === "so_convite";

  // O mesmo cabeçalho do /login: o ícone do app sobre o título, só quando a
  // marca é a do produto (com logo de revendedor, quem assina é o painel ao lado).
  const icone = marcaEhADoProduto({ name: marca.nome, logoUrl: marca.logoUrl }) ? (
    <div className="flex h-16 w-16 items-center justify-center rounded-[18px] border border-border bg-surface shadow-sm">
      <SimboloDoProduto nome={marca.nome} decorativo sobreClaro className="h-11 w-auto" />
    </div>
  ) : null;

  if (soPorConvite) {
    return (
      <div className="space-y-6">
        <div className="space-y-5">
          {icone}
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("Cadastro apenas por convite")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {conviteExpirado
                ? t(
                    "Esse convite expirou ou não vale mais. Peça um novo a quem convidou você e abra o link que chegar no seu e-mail.",
                  )
                : `${t("No momento, as contas do")} ${marca.nome} ${t("são criadas apenas por convite. Se você foi convidado, abra o link do convite que chegou no seu e-mail.")}`}
            </p>
          </div>
        </div>
        <Button asChild className="w-full">
          <Link href="/login">{t("Entrar")}</Link>
        </Button>
      </div>
    );
  }

  // O Google só aparece quando o provedor está ligado no Supabase desta
  // instalação, como no /login: desligado, o botão só renderia um erro ao clicar.
  const googleLigado = (await estadoDoProvedorGoogle()) === "ligado";

  return (
    <div className="space-y-6">
      <div className="space-y-5">
        {icone}
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Criar conta")}</h1>
          <p className="text-sm text-muted-foreground">
            {convite
              ? t("Crie sua senha para entrar na empresa que te convidou")
              : `${t("Comece a usar o")} ${marca.nome} ${t("em minutos")}`}
          </p>
          {modo === "com_aprovacao" && (
            <p className="text-sm text-muted-foreground">
              {t("Nesta instalação, a empresa só é criada depois da aprovação de quem administra.")}
            </p>
          )}
        </div>
      </div>

      {conviteExpirado && (
        <p
          role="alert"
          className="rounded-md border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-950/20"
        >
          {t(
            "Esse convite expirou ou não é mais válido. Peça um novo a quem te convidou — criar uma conta agora abriria uma empresa nova, e não é isso que você quer.",
          )}
        </p>
      )}

      <SignupForm
        convite={convite}
        planos={planos}
        planoInicial={planoInicialDoSeletor(planos, cadastro?.padraoId ?? null)}
        diasDeTesteGratis={cadastro?.diasDeTesteSemEscolha ?? null}
      />
      {/* O convite atravessa o Google na URL de retorno: sem ele, quem foi
          convidado e cria a conta com Google ganharia uma empresa própria. */}
      {!googleLigado ? null : googleSemPlano ? (
        <p className="text-center text-xs text-muted-foreground">
          {t(
            "Para garantir que o plano selecionado seja contratado, conclua o cadastro com e-mail e senha.",
          )}
        </p>
      ) : (
        <>
          <EntrarComGoogle convite={convite?.token} />
          {planos.length > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              {t(
                "Com o Google, a empresa começa no plano padrão. Para escolher outro, use e-mail e senha.",
              )}
            </p>
          )}
        </>
      )}

      <p className="text-center text-sm text-muted-foreground">
        {t("Já tem conta?")}{" "}
        <Link
          href={
            convite
              ? `/login?next=${encodeURIComponent(`/team/accept-invite/${convite.token}`)}`
              : "/login"
          }
          className="font-medium text-foreground underline underline-offset-4"
        >
          {t("Entrar")}
        </Link>
      </p>
    </div>
  );
}
