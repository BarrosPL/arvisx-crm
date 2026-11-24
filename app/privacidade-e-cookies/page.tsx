import type { Metadata } from "next";

import { PaginaLegal } from "@/components/landing/PaginaLegal";
import { traduzir } from "@/lib/i18n/dicionario";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";

/**
 * Privacidade e cookies da vitrine do Arvisx CRM (crm.arvisx.com.br).
 *
 * Texto padrão aprovado no protótipo (docs/arvisx/prototipo/landing/privacidade-e-cookies.html),
 * com os campos da empresa ainda por preencher — marcados em dourado na tela
 * (`.campo`). Os documentos legais do APP (`/legal/terms` e `/legal/privacy`)
 * continuam separados: eles resolvem o operador da instalação e trazem a seção
 * que a verificação do Google exige.
 *
 * O texto em português é a chave de `t()`; o espanhol mora em lib/i18n/legais.ts.
 * Frase cortada por `<strong>`/`<span>` vira um pedaço por trecho, na mesma ordem.
 */
export const metadata: Metadata = {
  title: "Privacidade e cookies | Arvisx CRM",
  description:
    "Política de privacidade e cookies do Arvisx CRM: quais dados tratamos, para quê, com quem compartilhamos, por quanto tempo guardamos e quais cookies usamos.",
  robots: { index: false },
};

export default async function PrivacidadeECookiesPage() {
  const locale = await idiomaDoVisitante(null);
  const t = (texto: string) => traduzir(texto, locale);

  return (
    <PaginaLegal>
      <p className="eyebrow">{t("Documento legal")}</p>
      <h1>{t("Política de privacidade e cookies")}</h1>
      <p className="atualizado">{t("Última atualização: 3 de novembro de 2026")}</p>

      <div className="resumo">
        <b>{t("Em resumo:")}</b>{" "}
        {t(
          "tratamos os dados necessários para você acessar o Arvisx CRM e para a sua empresa atender os clientes dela. Não vendemos dados. Esta página pública usa apenas cookies necessários; a Plataforma usa cookies de sessão e de preferências. Você pode exercer os seus direitos pela LGPD pelo contato indicado no fim.",
        )}
      </div>

      <h2>{t("1. Quem é responsável")}</h2>
      <p>
        {t("Esta Política explica como")}{" "}
        <span className="campo">{t("[RAZÃO SOCIAL DA ARVISX]")}</span>, CNPJ{" "}
        <span className="campo">[CNPJ]</span>{" "}
        {t(
          '("Arvisx"), trata dados pessoais na página crm.arvisx.com.br e na plataforma Arvisx CRM (a "Plataforma"), em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018, "LGPD").',
        )}
      </p>
      <p>
        {t("Encarregado pelo tratamento de dados (DPO):")}{" "}
        <span className="campo">{t("[NOME DO ENCARREGADO]")}</span>,{" "}
        <span className="campo">{t("[E-MAIL DO ENCARREGADO]")}</span>.
      </p>

      <h2>{t("2. Dois papéis diferentes")}</h2>
      <ul>
        <li>
          <strong>{t("Dados de conta dos usuários")}</strong>{" "}
          {t("(pessoas da equipe da empresa contratante): a Arvisx é a")}{" "}
          <strong>{t("controladora")}</strong>.
        </li>
        <li>
          <strong>{t("Dados dos contatos")}</strong>{" "}
          {t(
            "(leads e clientes da empresa contratante, registrados na Plataforma ou vindos do WhatsApp): a",
          )}{" "}
          <strong>{t("empresa contratante é a controladora")}</strong> {t("e a Arvisx é a")}{" "}
          <strong>{t("operadora")}</strong>
          {t(
            ", tratando os dados conforme as instruções dela e o contrato. Pedidos sobre esses dados devem ser feitos à empresa contratante; a Arvisx a apoia no atendimento.",
          )}
        </li>
      </ul>

      <h2>{t("3. Quais dados tratamos")}</h2>
      <h3>{t("3.1 Nesta página pública")}</h3>
      <p>
        {t(
          "Esta página não tem formulário e não usa ferramentas de analytics ou rastreamento. Os servidores registram dados técnicos de acesso (endereço IP, data e hora, navegador), usados apenas para segurança e funcionamento.",
        )}
      </p>
      <h3>{t("3.2 Na Plataforma, sobre os usuários")}</h3>
      <ul>
        <li>{t("Nome, e-mail, papel na empresa e, quando configurado, telefone e foto.")}</li>
        <li>
          {t(
            "Credenciais de acesso (a senha é armazenada de forma protegida) e, se ativado, o segundo fator de autenticação.",
          )}
        </li>
        <li>
          {t(
            "Registros de uso: ações realizadas na Plataforma, datas, endereço IP e navegador, para auditoria e segurança.",
          )}
        </li>
      </ul>
      <h3>{t("3.3 Na Plataforma, sobre os contatos da empresa contratante")}</h3>
      <ul>
        <li>
          {t(
            "Dados de identificação e contato: nome, telefone, e-mail, etiquetas e campos personalizados definidos pela empresa.",
          )}
        </li>
        <li>
          {t(
            "Conversas de WhatsApp com a empresa, incluindo mensagens e mídias enviadas pelo contato.",
          )}
        </li>
        <li>
          {t(
            "Documentos e informações que a empresa registra sobre o atendimento (propostas, agendamentos, notas).",
          )}
        </li>
      </ul>

      <h2>{t("4. Para que usamos os dados")}</h2>
      <ul>
        <li>{t("Permitir o acesso à Plataforma e autenticar os usuários.")}</li>
        <li>
          {t(
            "Operar os recursos contratados: inbox, agenda, funis, propostas, faturamento e os agentes de inteligência artificial que atendem em nome da empresa contratante.",
          )}
        </li>
        <li>{t("Garantir segurança, prevenir fraudes e manter registros de auditoria.")}</li>
        <li>{t("Prestar suporte e comunicar mudanças no serviço.")}</li>
        <li>{t("Cumprir obrigações legais e regulatórias.")}</li>
      </ul>

      <h2>{t("5. Bases legais")}</h2>
      <p>
        {t("Tratamos os dados com base na")} <strong>{t("execução de contrato")}</strong>{" "}
        {t("(com a empresa contratante e para o acesso dos usuários), no")}{" "}
        <strong>{t("legítimo interesse")}</strong>{" "}
        {t(
          "(segurança, auditoria e melhoria do serviço, sempre avaliado contra os direitos dos titulares), no",
        )}{" "}
        <strong>{t("cumprimento de obrigação legal")}</strong> {t("e, quando aplicável, no")}{" "}
        <strong>{t("consentimento")}</strong>
        {t(
          ". Para os dados dos contatos, a base legal é definida pela empresa contratante, na condição de controladora.",
        )}
      </p>

      <h2>{t("6. Agentes de inteligência artificial")}</h2>
      <p>
        {t(
          "As conversas atendidas pelos agentes de IA são processadas por provedores de modelos de linguagem contratados pela Arvisx, apenas para gerar as respostas e executar as ações configuradas. As instruções enviadas a esses provedores contêm o necessário para o atendimento. Os provedores atuam como suboperadores, sob contrato, e não usam esses dados para treinar modelos, conforme as condições que firmamos com eles.",
        )}
      </p>

      <h2>{t("7. Com quem compartilhamos")}</h2>
      <ul>
        <li>
          <strong>{t("Provedores de infraestrutura")}</strong>{" "}
          {t(
            "(hospedagem, banco de dados, armazenamento de arquivos e envio de e-mail), para manter a Plataforma funcionando.",
          )}
        </li>
        <li>
          <strong>{t("Provedores de inteligência artificial")}</strong>
          {t(", conforme o item 6.")}
        </li>
        <li>
          <strong>WhatsApp</strong>
          {t(
            ", para enviar e receber as mensagens da empresa contratante, conforme as políticas do próprio WhatsApp.",
          )}
        </li>
        <li>
          <strong>{t("Autoridades")}</strong>
          {t(", quando exigido por lei ou ordem judicial.")}
        </li>
      </ul>
      <p>
        {t(
          "Não vendemos dados pessoais e não os compartilhamos para publicidade de terceiros. Alguns provedores podem estar fora do Brasil; nesses casos, a transferência segue as regras da LGPD, com cláusulas contratuais adequadas.",
        )}
      </p>

      <h2>{t("8. Por quanto tempo guardamos")}</h2>
      <ul>
        <li>
          {t(
            "Dados de conta dos usuários: enquanto o acesso estiver ativo e, depois, pelo prazo necessário para obrigações legais.",
          )}
        </li>
        <li>
          {t(
            "Dados dos contatos e conversas: enquanto o contrato com a empresa contratante estiver vigente, ou até que a empresa os exclua ou anonimize pela Plataforma.",
          )}
        </li>
        <li>
          {t(
            "Registros de auditoria: pelo prazo definido no contrato, com padrão de até 5 anos, para segurança e defesa em processos.",
          )}
        </li>
      </ul>
      <p>
        {t(
          "Ao fim do contrato, a empresa contratante pode exportar os seus dados; depois do prazo previsto, eles são excluídos ou anonimizados.",
        )}
      </p>

      <h2>{t("9. Seus direitos")}</h2>
      <p>
        {t(
          "Nos termos do art. 18 da LGPD, você pode solicitar: confirmação do tratamento, acesso, correção, anonimização, bloqueio ou eliminação, portabilidade, informação sobre compartilhamentos e revogação do consentimento. Se for usuário da Plataforma, escreva para o Encarregado indicado no item 1. Se for contato de uma empresa que usa o Arvisx CRM, dirija o pedido a essa empresa; se preferir, escreva para nós e encaminharemos.",
        )}
      </p>
      <p>
        {t(
          "Respondemos no prazo legal. Você também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).",
        )}
      </p>

      <h2>{t("10. Segurança")}</h2>
      <p>
        {t(
          "Adotamos medidas técnicas e organizacionais para proteger os dados: criptografia em trânsito, controle de acesso por papel, isolamento entre empresas na Plataforma, registro de auditoria e autenticação em dois fatores disponível aos usuários. Nenhum sistema é totalmente imune a incidentes; se ocorrer um que possa causar risco relevante, comunicaremos os afetados e a ANPD conforme a lei.",
        )}
      </p>

      <h2>11. Cookies</h2>
      <p>
        {t("Cookies são pequenos arquivos gravados no seu navegador. Usamos apenas o necessário:")}
      </p>
      <table>
        <thead>
          <tr>
            <th>Cookie</th>
            <th>{t("Finalidade")}</th>
            <th>{t("Tipo")}</th>
            <th>{t("Duração")}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t("Sessão de acesso")}</td>
            <td>{t("Manter você autenticado na Plataforma depois do login.")}</td>
            <td>{t("Necessário")}</td>
            <td>{t("Enquanto a sessão durar")}</td>
          </tr>
          <tr>
            <td>{t("Preferências")}</td>
            <td>{t("Lembrar tema (claro ou escuro) e idioma escolhidos.")}</td>
            <td>{t("Necessário (funcional)")}</td>
            <td>{t("Até 1 ano")}</td>
          </tr>
          <tr>
            <td>{t("Aviso de cookies")}</td>
            <td>{t("Registrar que você viu este aviso, para não exibi-lo de novo.")}</td>
            <td>{t("Necessário")}</td>
            <td>{t("Até 1 ano")}</td>
          </tr>
        </tbody>
      </table>
      <p>
        {t(
          "Não usamos cookies de publicidade nem de analytics de terceiros nesta página. Se isso mudar, esta Política será atualizada e pediremos o seu consentimento antes de ativá-los. Você pode apagar ou bloquear cookies nas configurações do navegador; sem os cookies necessários, o login na Plataforma deixa de funcionar.",
        )}
      </p>

      <h2>{t("12. Alterações desta Política")}</h2>
      <p>
        {t(
          "Podemos atualizar esta Política para refletir mudanças no serviço ou na legislação. A versão vigente fica publicada nesta página, com a data da última atualização. Mudanças relevantes serão comunicadas à empresa contratante.",
        )}
      </p>

      <h2>{t("13. Contato")}</h2>
      <p>
        {t("Para falar sobre privacidade:")}{" "}
        <span className="campo">{t("[E-MAIL DO ENCARREGADO]")}</span>.
      </p>
    </PaginaLegal>
  );
}
