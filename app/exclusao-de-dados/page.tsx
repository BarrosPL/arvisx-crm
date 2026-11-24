import type { Metadata } from "next";

import { PaginaLegal } from "@/components/landing/PaginaLegal";
import { lerCodigoDeConfirmacao } from "@/lib/channels/meta-social/exclusao";
import { env } from "@/lib/env";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { traduzir } from "@/lib/i18n/dicionario";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import type { Idioma } from "@/lib/i18n/idiomas";

/**
 * Exclusão de dados do usuário (crm.arvisx.com.br/exclusao-de-dados).
 *
 * Texto aprovado no protótipo (docs/arvisx/prototipo/landing/exclusao-de-dados.html),
 * idêntico; os dois campos `[CANAL DE CONTATO…]` do protótipo viraram o e-mail de
 * suporte (suporte@arvisx.com.br, decisão do Lucas em 06/11/2026). É a URL de
 * "instruções de exclusão de dados" que o App Review da Meta pede para o login
 * do Facebook da conexão direta do Instagram e do Messenger.
 *
 * Com `?codigo=` ela também é a página de STATUS do callback de exclusão da Meta
 * (`app/api/v1/webhooks/meta-social/exclusao-de-dados`): o código é assinado e
 * carrega a hora e a contagem do que foi feito — não há dado a consultar.
 */
export const metadata: Metadata = {
  title: "Exclusão de dados | Arvisx CRM",
  description:
    "Como solicitar a exclusão de dados pessoais tratados pelo Arvisx CRM, incluindo os dados da integração com a Meta.",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const CONTATO = "suporte@arvisx.com.br";

/** A data sai no idioma de quem visita; o fuso é sempre o de Brasília. */
function quando(data: Date, locale: Idioma): string {
  return data.toLocaleString(tagDeIdioma(locale), { timeZone: "America/Sao_Paulo", dateStyle: "long", timeStyle: "short" });
}

export default async function ExclusaoDeDadosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const bruto = (await searchParams).codigo;
  const codigo = typeof bruto === "string" ? bruto : null;
  const status = codigo ? lerCodigoDeConfirmacao(codigo, env.INTERNAL_SECRET) : null;
  const locale = await idiomaDoVisitante(null);
  const t = (texto: string) => traduzir(texto, locale);

  return (
    <PaginaLegal>
      <p className="eyebrow">{t("Documento legal")}</p>
      <h1>{t("Exclusão de dados do usuário")}</h1>
      <p className="atualizado">{t("Última atualização: 5 de novembro de 2026")}</p>

      {codigo ? (
        <div className="resumo" role="status" data-testid="status-da-exclusao">
          {status ? (
            <>
              <b>{t("Pedido de exclusão concluído.")}</b>{" "}
              {t("Recebido em {data}.").replace("{data}", quando(status.recebidoEm, locale))}{" "}
              {status.conexoes > 0
                ? status.conexoes === 1
                  ? t(
                      "As autorizações da sua conta do Facebook foram apagadas e 1 conexão foi desligada.",
                    )
                  : t(
                      "As autorizações da sua conta do Facebook foram apagadas e {n} conexões foram desligadas.",
                    ).replace("{n}", String(status.conexoes))
                : t("Não havia autorização da sua conta do Facebook guardada no Arvisx CRM.")}{" "}
              {t("Código de confirmação:")} <code>{codigo}</code>.
            </>
          ) : (
            <>
              <b>{t("Código de confirmação não reconhecido.")}</b>{" "}
              {t("Confira o endereço recebido ou escreva para")}{" "}
              <a href={`mailto:${CONTATO}`}>{CONTATO}</a>.
            </>
          )}
        </div>
      ) : null}

      <h2>{t("1. O que esta página cobre")}</h2>
      <p>
        {t(
          "Esta página explica como solicitar a exclusão de dados pessoais tratados pelo Arvisx CRM, incluindo dados da integração com a API do WhatsApp Business Platform (Meta). Aplica-se a:",
        )}
      </p>
      <ul>
        <li>
          {t(
            "Titulares de conta (proprietários ou membros das equipes de empresas que usam o Arvisx CRM);",
          )}
        </li>
        <li>
          {t(
            "Clientes finais que trocaram mensagens via WhatsApp com empresas usuárias do Arvisx CRM.",
          )}
        </li>
      </ul>

      <h2>{t("2. Como pedir")}</h2>
      <p>
        {t("Envie a solicitação para")} <a href={`mailto:${CONTATO}`}>{CONTATO}</a>{" "}
        {t("informando:")}
      </p>
      <ul>
        <li>{t("Nome completo;")}</li>
        <li>{t("Número de telefone ou e-mail usado na conversa ou no cadastro;")}</li>
        <li>{t("Nome da empresa (para clientes finais).")}</li>
      </ul>
      <p>
        {t(
          "Clientes finais também podem solicitar a exclusão diretamente à empresa controladora do atendimento, conforme detalhado na",
        )}{" "}
        <a href="/privacidade-e-cookies">{t("Política de Privacidade")}</a>.
      </p>

      <h2>{t("3. O que acontece depois do pedido")}</h2>
      <p>
        {t(
          "A identidade será confirmada pelo mesmo canal de atendimento ou cadastro. Os dados solicitados (nome, telefone, e-mail e conteúdo de conversa) serão excluídos ou anonimizados em até 15 dias.",
        )}
      </p>
      <p>
        {t(
          "Para dados da integração oficial com o WhatsApp (Meta), a exclusão abrange mensagens, perfil e histórico de entrega associados ao número.",
        )}
      </p>
      <p>
        {t(
          "Alguns registros podem ser retidos conforme obrigações legais (por exemplo, dados fiscais e auditoria de segurança).",
        )}
      </p>

      <h2>{t("4. Contato")}</h2>
      <p>
        {t("Dúvidas:")} <a href={`mailto:${CONTATO}`}>{CONTATO}</a>.
      </p>
    </PaginaLegal>
  );
}
