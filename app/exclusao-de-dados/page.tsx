import type { Metadata } from "next";

import { PaginaLegal } from "@/components/landing/PaginaLegal";
import { lerCodigoDeConfirmacao } from "@/lib/channels/meta-social/exclusao";
import { env } from "@/lib/env";
import { tagDeIdioma } from "@/lib/i18n/datas";
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
/** As páginas legais da vitrine são só em português, como o protótipo. */
const IDIOMA_DA_VITRINE: Idioma = "pt-BR";

function quando(data: Date): string {
  return data.toLocaleString(tagDeIdioma(IDIOMA_DA_VITRINE), { timeZone: "America/Sao_Paulo", dateStyle: "long", timeStyle: "short" });
}

export default async function ExclusaoDeDadosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const bruto = (await searchParams).codigo;
  const codigo = typeof bruto === "string" ? bruto : null;
  const status = codigo ? lerCodigoDeConfirmacao(codigo, env.INTERNAL_SECRET) : null;

  return (
    <PaginaLegal>
      <p className="eyebrow">Documento legal</p>
      <h1>Exclusão de dados do usuário</h1>
      <p className="atualizado">Última atualização: 5 de novembro de 2026</p>

      {codigo ? (
        <div className="resumo" role="status" data-testid="status-da-exclusao">
          {status ? (
            <>
              <b>Pedido de exclusão concluído.</b> Recebido em {quando(status.recebidoEm)}.{" "}
              {status.conexoes > 0
                ? `As autorizações da sua conta do Facebook foram apagadas e ${status.conexoes === 1 ? "1 conexão foi desligada" : `${status.conexoes} conexões foram desligadas`}.`
                : "Não havia autorização da sua conta do Facebook guardada no Arvisx CRM."}{" "}
              Código de confirmação: <code>{codigo}</code>.
            </>
          ) : (
            <>
              <b>Código de confirmação não reconhecido.</b> Confira o endereço recebido ou escreva
              para <a href={`mailto:${CONTATO}`}>{CONTATO}</a>.
            </>
          )}
        </div>
      ) : null}

      <h2>1. O que esta página cobre</h2>
      <p>
        Esta página explica como solicitar a exclusão de dados pessoais tratados pelo Arvisx CRM,
        incluindo dados da integração com a API do WhatsApp Business Platform (Meta). Aplica-se a:
      </p>
      <ul>
        <li>
          Titulares de conta (proprietários ou membros das equipes de empresas que usam o Arvisx
          CRM);
        </li>
        <li>
          Clientes finais que trocaram mensagens via WhatsApp com empresas usuárias do Arvisx CRM.
        </li>
      </ul>

      <h2>2. Como pedir</h2>
      <p>
        Envie a solicitação para <a href={`mailto:${CONTATO}`}>{CONTATO}</a> informando:
      </p>
      <ul>
        <li>Nome completo;</li>
        <li>Número de telefone ou e-mail usado na conversa ou no cadastro;</li>
        <li>Nome da empresa (para clientes finais).</li>
      </ul>
      <p>
        Clientes finais também podem solicitar a exclusão diretamente à empresa controladora do
        atendimento, conforme detalhado na{" "}
        <a href="/privacidade-e-cookies">Política de Privacidade</a>.
      </p>

      <h2>3. O que acontece depois do pedido</h2>
      <p>
        A identidade será confirmada pelo mesmo canal de atendimento ou cadastro. Os dados
        solicitados (nome, telefone, e-mail e conteúdo de conversa) serão excluídos ou anonimizados
        em até 15 dias.
      </p>
      <p>
        Para dados da integração oficial com o WhatsApp (Meta), a exclusão abrange mensagens, perfil
        e histórico de entrega associados ao número.
      </p>
      <p>
        Alguns registros podem ser retidos conforme obrigações legais (por exemplo, dados fiscais e
        auditoria de segurança).
      </p>

      <h2>4. Contato</h2>
      <p>
        Dúvidas: <a href={`mailto:${CONTATO}`}>{CONTATO}</a>.
      </p>
    </PaginaLegal>
  );
}
