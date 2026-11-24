import type { Metadata } from "next";

import { PaginaLegal } from "@/components/landing/PaginaLegal";
import { traduzir } from "@/lib/i18n/dicionario";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";

/**
 * Termos de uso da vitrine do Arvisx CRM (crm.arvisx.com.br).
 *
 * Texto padrão aprovado no protótipo (docs/arvisx/prototipo/landing/termos-de-uso.html),
 * com os campos da empresa ainda por preencher — marcados em dourado na tela
 * (`.campo`). Os documentos legais do APP (`/legal/terms` e `/legal/privacy`)
 * continuam separados: eles resolvem o operador da instalação e trazem a seção
 * que a verificação do Google exige.
 *
 * O texto em português é a chave de `t()`; o espanhol mora em lib/i18n/legais.ts.
 * Frase cortada por `<strong>`/`<span>`/`<a>` vira um pedaço por trecho, na mesma ordem.
 */
export const metadata: Metadata = {
  title: "Termos de uso | Arvisx CRM",
  description:
    "Termos de uso do Arvisx CRM: condições para acesso e uso da plataforma, responsabilidades das partes e regras sobre os agentes de inteligência artificial.",
  robots: { index: false },
};

export default async function TermosDeUsoPage() {
  const locale = await idiomaDoVisitante(null);
  const t = (texto: string) => traduzir(texto, locale);

  return (
    <PaginaLegal>
      <p className="eyebrow">{t("Documento legal")}</p>
      <h1>{t("Termos de uso do Arvisx CRM")}</h1>
      <p className="atualizado">{t("Última atualização: 3 de novembro de 2026")}</p>

      <div className="resumo">
        <b>{t("Em resumo:")}</b>{" "}
        {t(
          "o Arvisx CRM é uma plataforma contratada por empresas. Quem acessa recebe um convite da empresa contratante, usa a conta com responsabilidade e respeita os dados das pessoas cadastradas. A Arvisx configura e opera os agentes de inteligência artificial; decisões sensíveis passam por uma pessoa da equipe.",
        )}
      </div>

      <h2>{t("1. Quem somos e o que estes termos regulam")}</h2>
      <p>
        {t("Estes Termos de uso regulam o acesso e o uso da plataforma")}{" "}
        <strong>Arvisx CRM</strong>{" "}
        {t('(a "Plataforma"), disponível em crm.arvisx.com.br, oferecida por')}{" "}
        <span className="campo">{t("[RAZÃO SOCIAL DA ARVISX]")}</span>
        {t(", inscrita no CNPJ sob o nº")} <span className="campo">[CNPJ]</span>
        {t(", com sede em")} <span className="campo">{t("[ENDEREÇO COMPLETO]")}</span>{" "}
        {t('("Arvisx", "nós").')}
      </p>
      <p>
        {t(
          "Ao acessar a Plataforma, você declara que leu, entendeu e concorda com estes Termos e com a",
        )}{" "}
        <a href="/privacidade-e-cookies">{t("Política de privacidade e cookies")}</a>
        {t(". Se não concordar, não use a Plataforma.")}
      </p>

      <h2>{t("2. Definições")}</h2>
      <ul>
        <li>
          <strong>{t("Empresa contratante:")}</strong>{" "}
          {t(
            "a pessoa jurídica que contratou o Arvisx CRM e é responsável pela sua conta na Plataforma.",
          )}
        </li>
        <li>
          <strong>{t("Usuário:")}</strong>{" "}
          {t(
            "a pessoa física que acessa a Plataforma por convite da Empresa contratante (sócios, gestores, atendentes e demais membros da equipe).",
          )}
        </li>
        <li>
          <strong>{t("Contatos:")}</strong>{" "}
          {t(
            "as pessoas cujos dados são registrados na Plataforma pela Empresa contratante ou pelos seus canais (por exemplo, leads e clientes que falam com a empresa pelo WhatsApp).",
          )}
        </li>
        <li>
          <strong>{t("Agentes de IA:")}</strong>{" "}
          {t(
            "os assistentes de inteligência artificial configurados e operados pela Arvisx para atender, qualificar e acompanhar Contatos em nome da Empresa contratante.",
          )}
        </li>
      </ul>

      <h2>{t("3. Acesso à Plataforma")}</h2>
      <p>
        {t("O acesso é feito por")} <strong>{t("convite")}</strong>{" "}
        {t(
          "da Empresa contratante. Não há cadastro aberto ao público. Cada Usuário recebe um login individual e intransferível e é responsável por manter a senha em sigilo e por toda atividade realizada com a sua conta.",
        )}
      </p>
      <p>
        {t(
          "A Empresa contratante define o papel de cada Usuário (o que ele pode ver e fazer) e pode suspender ou remover acessos a qualquer momento. Avise a empresa e a Arvisx imediatamente se suspeitar de uso indevido da sua conta.",
        )}
      </p>

      <h2>{t("4. O que a Plataforma oferece")}</h2>
      <p>
        {t(
          "A Plataforma reúne, entre outros recursos, inbox de WhatsApp, agenda, funis de venda, contatos, tarefas, propostas, faturamento, desempenho e gestão de equipe. Os recursos disponíveis a cada Empresa contratante são os definidos no contrato comercial firmado com a Arvisx.",
        )}
      </p>
      <p>
        {t(
          "A Arvisx configura a Plataforma para a Empresa contratante (funis, campos, equipe e Agentes de IA) e pode ajustar essa configuração a pedido da empresa ao longo do contrato.",
        )}
      </p>

      <h2>{t("5. Agentes de inteligência artificial")}</h2>
      <ul>
        <li>
          {t(
            "Os Agentes de IA geram respostas automaticamente, a partir das instruções e dos materiais fornecidos pela Empresa contratante. Apesar do cuidado na configuração, podem produzir conteúdo impreciso. A Empresa contratante deve revisar as informações relevantes antes de se comprometer com um Contato.",
          )}
        </li>
        <li>
          {t(
            "Ações sensíveis, como o envio de contratos, dependem da aprovação de um Usuário. Quando um Usuário assume uma conversa, o Agente de IA deixa de responder nela.",
          )}
        </li>
        <li>
          {t(
            "A Empresa contratante é responsável pelas instruções, pelos materiais e pelas regras de negócio que fornece à Arvisx para a configuração dos Agentes, e por informar aos seus Contatos, quando exigido por lei, que o atendimento pode ser feito com apoio de inteligência artificial.",
          )}
        </li>
        <li>
          {t(
            "As telas de configuração dos Agentes, automações e integrações são operadas pela Arvisx e não ficam disponíveis aos Usuários.",
          )}
        </li>
      </ul>

      <h2>{t("6. Uso aceitável")}</h2>
      <p>{t("Ao usar a Plataforma, você se compromete a não:")}</p>
      <ul>
        <li>
          {t(
            "enviar mensagens em massa não solicitadas, spam ou conteúdo que viole as políticas do WhatsApp ou a legislação aplicável;",
          )}
        </li>
        <li>
          {t(
            "cadastrar dados de pessoas sem base legal para isso, nem usar a Plataforma para fins discriminatórios, fraudulentos ou ilícitos;",
          )}
        </li>
        <li>
          {t(
            "compartilhar seu login, tentar acessar contas, dados ou áreas que não lhe pertencem, ou contornar controles de segurança;",
          )}
        </li>
        <li>
          {t(
            "copiar, modificar, fazer engenharia reversa ou explorar comercialmente a Plataforma fora do contrato;",
          )}
        </li>
        <li>
          {t("inserir código malicioso ou sobrecarregar a infraestrutura de forma deliberada.")}
        </li>
      </ul>
      <p>
        {t(
          "A Arvisx pode suspender acessos que violem estes Termos, comunicando a Empresa contratante.",
        )}
      </p>

      <h2>{t("7. Dados pessoais")}</h2>
      <p>
        {t("Em relação aos dados dos Contatos, a")}{" "}
        <strong>{t("Empresa contratante é a controladora")}</strong> {t("e a")}{" "}
        <strong>{t("Arvisx atua como operadora")}</strong>
        {t(
          ", tratando os dados conforme as instruções da empresa e o contrato firmado. Em relação aos dados de conta dos Usuários, a Arvisx atua como controladora, nos termos da",
        )}{" "}
        <a href="/privacidade-e-cookies">{t("Política de privacidade e cookies")}</a>.
      </p>
      <p>
        {t(
          "A Plataforma oferece recursos para atender a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), como exportação e anonimização de dados de Contatos e registro de auditoria. A Empresa contratante é responsável por atender às solicitações dos seus Contatos dentro dos prazos legais.",
        )}
      </p>

      <h2>{t("8. Conteúdo e propriedade intelectual")}</h2>
      <p>
        {t(
          "A Plataforma, sua marca, layout, código e documentação pertencem à Arvisx ou aos seus licenciantes. Os dados inseridos pela Empresa contratante (contatos, conversas, propostas, documentos) pertencem à Empresa contratante, que concede à Arvisx a licença necessária para operar a Plataforma e os Agentes de IA em seu nome.",
        )}
      </p>

      <h2>{t("9. Disponibilidade e suporte")}</h2>
      <p>
        {t(
          "A Arvisx trabalha para manter a Plataforma disponível de forma contínua, mas podem ocorrer interrupções para manutenção, atualizações ou por falhas de terceiros (provedores de nuvem, WhatsApp, provedores de inteligência artificial). Avisaremos a Empresa contratante sobre manutenções programadas sempre que possível. Os canais e prazos de suporte são os previstos no contrato comercial.",
        )}
      </p>

      <h2>{t("10. Limitação de responsabilidade")}</h2>
      <p>
        {t(
          "Na extensão permitida pela lei, a Arvisx não responde por lucros cessantes, perda de negócios ou danos indiretos decorrentes do uso ou da indisponibilidade da Plataforma, nem por decisões tomadas pela Empresa contratante com base em conteúdo gerado pelos Agentes de IA sem revisão humana. A responsabilidade total da Arvisx fica limitada ao valor pago pela Empresa contratante nos 12 meses anteriores ao evento, salvo em caso de dolo ou culpa grave.",
        )}
      </p>

      <h2>{t("11. Vigência e encerramento")}</h2>
      <p>
        {t(
          "O acesso do Usuário dura enquanto o convite da Empresa contratante estiver ativo e o contrato comercial vigente. Ao fim do contrato, a Arvisx disponibiliza à Empresa contratante a exportação dos seus dados pelo prazo previsto no contrato e, depois, os exclui ou anonimiza, ressalvadas as obrigações legais de guarda.",
        )}
      </p>

      <h2>{t("12. Alterações destes Termos")}</h2>
      <p>
        {t(
          "Podemos atualizar estes Termos para refletir mudanças na Plataforma ou na legislação. A versão vigente fica sempre publicada nesta página, com a data da última atualização. Mudanças relevantes serão comunicadas à Empresa contratante com antecedência razoável.",
        )}
      </p>

      <h2>{t("13. Lei aplicável e foro")}</h2>
      <p>
        {t(
          "Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro da comarca de",
        )}{" "}
        <span className="campo">{t("[CIDADE/UF]")}</span>{" "}
        {t(
          "para resolver qualquer controvérsia, sem prejuízo dos direitos do consumidor, quando aplicáveis.",
        )}
      </p>

      <h2>{t("14. Contato")}</h2>
      <p>
        {t("Dúvidas sobre estes Termos:")}{" "}
        <span className="campo">{t("[E-MAIL DE CONTATO]")}</span>.
      </p>
    </PaginaLegal>
  );
}
