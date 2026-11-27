/**
 * PACOTE DE NICHO — ADVOCACIA.
 *
 * ⚠️ RASCUNHO. NÃO VALIDADO COM CLIENTE REAL. A REVISAR PELO DR. RENAN.
 *
 * O conteúdo abaixo foi escrito pela equipe do produto, sem passar por um
 * escritório em operação e sem revisão de um advogado. Ele serve para a equipe
 * pronta nascer com um ponto de partida no ramo; antes de ser tratado como
 * recomendação, precisa da revisão do Dr. Renan (em especial as regras duras,
 * que tocam as regras de publicidade e de captação da advocacia) e de um
 * ensaio com um escritório de verdade. Enquanto `validadoComClienteReal` for
 * `false`, a tela mostra esse aviso a quem escolhe o ramo.
 *
 * O que o pacote NÃO faz: não promete nada, não traz preço, prazo nem resposta
 * pronta. O modelo de perguntas frequentes tem só campos a preencher.
 */
import { MARCA_DE_CAMPO_A_PREENCHER, type PacoteDeNicho } from "./tipos";

const campo = (oQue: string) => `${MARCA_DE_CAMPO_A_PREENCHER}: ${oQue}]`;

export const PACOTE_ADVOCACIA: PacoteDeNicho = {
  id: "advocacia",
  nome: "Advocacia",
  versao: 1,
  validadoComClienteReal: false,
  revisaoPendente: "Dr. Renan",

  perguntasDeQualificacao: [
    "Sobre qual área do direito é o seu assunto (por exemplo: família, trabalho, consumidor, previdência, imigração)?",
    "Em poucas palavras, o que aconteceu?",
    "Existe algum prazo, audiência ou notificação com data marcada?",
    "Você já tem advogado cuidando deste assunto?",
    "Em que cidade e país você está?",
  ],

  situacoesDeHumano: [
    "Há prazo correndo, intimação, citação, audiência marcada, liminar ou outra urgência",
    "A pessoa pede opinião sobre o caso ou orientação jurídica",
    "A pessoa quer enviar documentos",
  ],

  faqModelo: [
    `Em quais áreas do direito o escritório atua?\n${campo("as áreas em que o escritório atua")}`,
    `Como funciona a primeira conversa com o advogado?\n${campo("presencial ou online, duração, e se é cobrada")}`,
    `Como são cobrados os honorários?\n${campo("só o que o escritório decidiu informar por mensagem; se nada, apague este item")}`,
    `Quais são as formas de contato e o horário de atendimento da equipe?\n${campo("canais e horário")}`,
    `O escritório atende pessoas de outras cidades ou países?\n${campo("onde atende")}`,
    `Como a pessoa deve enviar documentos?\n${campo("o canal seguro indicado pelo escritório")}`,
  ].join("\n\n"),

  etapasSugeridas: [
    "Novo contato",
    "Triagem",
    "Consulta agendada",
    "Proposta de honorários enviada",
    "Contrato assinado",
    "Não seguiu",
  ],

  vocabulario: [
    { termo: "intimação", significado: "aviso oficial de um processo, quase sempre com prazo para agir" },
    { termo: "citação", significado: "aviso oficial de que a pessoa foi chamada a responder a um processo" },
    { termo: "audiência", significado: "compromisso marcado pelo juízo, com data e hora" },
    { termo: "liminar", significado: "pedido ou decisão de urgência, antes do fim do processo" },
    { termo: "honorários", significado: "o valor cobrado pelo trabalho do advogado" },
    { termo: "procuração", significado: "o documento que autoriza o advogado a agir pela pessoa" },
  ],

  resumoDasRegras:
    "Os agentes deste ramo seguem regras fixas: não prometem resultado, não opinam sobre o caso, não dão orientação jurídica e passam a conversa para a equipe quando há prazo ou urgência.",

  regrasDuras: [
    "Nunca prometa resultado, chance de ganhar nem prazo de decisão de um caso.",
    "Nunca dê opinião sobre o caso da pessoa: não diga se ela tem direito, se vale a pena ou quem tem razão.",
    "Nunca dê orientação jurídica: não diga o que a pessoa deve fazer, assinar, responder ou deixar de fazer. Quem orienta é o advogado.",
    "Honorários e custos: informe só o que esta empresa cadastrou no catálogo ou na base de conhecimento. Sem isso, diga que o advogado informa.",
    "Passe a conversa para uma pessoa da equipe na hora quando houver prazo correndo, intimação, citação, audiência marcada, liminar ou qualquer urgência. Não tente resolver antes.",
    "Não peça documentos sensíveis pela conversa (documentos pessoais, peças de processo, laudos, extratos, contratos). Se a pessoa quiser enviar, diga que a equipe indica o canal seguro.",
  ],
};
