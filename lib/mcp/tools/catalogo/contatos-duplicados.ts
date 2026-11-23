/**
 * Capacidade de CONTATOS DUPLICADOS — achar a mesma pessoa cadastrada duas
 * vezes. Juntar os dois cadastros é gesto da tela, não do agente.
 *
 * ESTE ARQUIVO FALA COM O HUMANO que configura o agente — `rotulo`,
 * `explicacao` e `oQueToca`. O texto que vai ao MODELO é a `description` do
 * handler (`lib/mcp/tools/contatos-duplicados.ts`), e ela não tem cópia aqui.
 *
 * ─── Por que o pacote é `reter`, e não `organizar` ──────────────────────────
 * Limpar a base é "manter a casa em ordem", mas `organizar` está a uma vaga do
 * teto de capacidades por agente (`TETO_TOOLS_POR_AGENTE`). Fica em `reter`,
 * como a linha do tempo do negócio: a pessoa cadastrada duas vezes tem a
 * história partida em duas fichas, e é assim que um retorno se perde.
 *
 * ─── Juntar e desfazer NÃO estão aqui (revisão 20/11, item 1.2, Opção A) ────
 * `crm_merge_contacts` e `crm_undo_contact_merge` saíram do MCP e deste
 * catálogo por decisão do dono (23/11). Juntar contatos é da tela
 * (`POST /api/v1/contacts/merge`, papel gerente).
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
]);
