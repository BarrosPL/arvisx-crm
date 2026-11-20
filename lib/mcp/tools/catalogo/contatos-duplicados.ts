/**
 * Capacidades de CONTATOS DUPLICADOS — achar a mesma pessoa cadastrada duas
 * vezes, juntar os dois cadastros e desfazer a junção.
 *
 * ESTE ARQUIVO FALA COM O HUMANO que configura o agente — `rotulo`,
 * `explicacao` e `oQueToca`. O texto que vai ao MODELO é a `description` do
 * handler (`lib/mcp/tools/contatos-duplicados.ts`), e ela não tem cópia aqui.
 *
 * ─── Por que o pacote é `reter`, e não `organizar` ──────────────────────────
 * Limpar a base é "manter a casa em ordem", mas `organizar` está a uma vaga do
 * teto de capacidades por agente (`TETO_TOOLS_POR_AGENTE`): três capacidades a
 * mais e o pacote deixaria de caber sozinho num agente. `evoluir` também não
 * serve: é o único pacote que ainda cabe como SEGUNDO pacote do agente que
 * nasce no onboarding, e três capacidades a mais tirariam isso dele
 * (`tests/unit/pacote-reserva-vaga-da-critica.test.ts`). Fica em `reter`, como
 * a linha do tempo do negócio: a pessoa cadastrada duas vezes tem a história
 * partida em duas fichas, e é assim que um retorno se perde.
 *
 * ─── As duas escritas são `apenasHumano` e `critico` ────────────────────────
 * É paridade com a tela: `POST /api/v1/contacts/merge` exige gerente, e nem um
 * atendente humano junta contatos. O agente do CRM, em atendimento, não alcança
 * as duas (o papel dele fica abaixo de gerente) e a tela diz isso. Quem usa é o
 * sistema externo cujo token o administrador marcou como "tratado como
 * gerente". `critico` porque a junção troca o dono de conversas e negócios, e
 * o desfazer não devolve tudo (as etiquetas, por exemplo): não entra por
 * pacote, só marcada à mão.
 */
import { declararTools } from "./tipos";

export const TOOLS_CONTATOS_DUPLICADOS = declararTools([
  {
    name: "crm_find_duplicate_contacts",
    category: "read",
    rotulo: "Encontrar contatos duplicados",
    explicacao:
      "Mostra os cadastros que parecem ser da mesma pessoa, por telefone, e-mail ou nome parecido, para alguém decidir se junta. Não funciona durante um atendimento: serve para limpar a base.",
    oQueToca: "Cadastro de contatos",
    risco: "seguro",
    pacotes: ["reter"],
  },
  {
    name: "crm_merge_contacts",
    category: "write",
    rotulo: "Juntar dois contatos da mesma pessoa",
    explicacao:
      "Passa as conversas, os negócios e as tarefas de um cadastro para o outro e deixa um só. Guarda o que foi juntado para poder voltar atrás, mas nem tudo volta: as etiquetas ficam misturadas.",
    oQueToca: "Cadastro de contatos",
    risco: "critico",
    pacotes: ["reter"],
    apenasHumano: true,
  },
  {
    name: "crm_undo_contact_merge",
    category: "write",
    rotulo: "Desfazer a junção de dois contatos",
    explicacao:
      "Volta a separar dois cadastros que foram juntados por um sistema externo, devolvendo a cada um as conversas, os negócios e as tarefas que eram dele. Junção feita pela tela não é desfeita por aqui.",
    oQueToca: "Cadastro de contatos",
    risco: "critico",
    pacotes: ["reter"],
    apenasHumano: true,
  },
]);
