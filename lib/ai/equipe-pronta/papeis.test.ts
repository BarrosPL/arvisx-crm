import { describe, expect, it } from "vitest";

import { catalogEntry, VALID_TOOL_IDS } from "@/lib/mcp/tools/catalogo";
import { TETO_TOOLS_POR_AGENTE } from "@/lib/mcp/tools/selecao-por-pacote";
import { FERRAMENTA_DE_PASSAGEM_ENTRE_COLEGAS, TITULO_DO_RESUMO_DO_ATENDIMENTO } from "@/lib/agent-engine/agent/passagem-entre-colegas";
import { ROLE_RANK } from "@/lib/auth/types";
import { ESCOPO_DAS_ESCRITAS } from "@/lib/ai/runtime/escopo-das-escritas";
import { allTools } from "@/lib/mcp/tools";
import { IDS_DO_HARNESS } from "@/lib/mcp/tools/ferramentas-do-harness";
import {
  PAPEIS,
  PAPEIS_DA_EQUIPE,
  PAPEL_DE_ENTRADA,
  REGRAS_COMUNS,
  VERSAO_DAS_REGRAS_COMUNS,
  papelPorId,
} from "./index";

/**
 * A REGRA DE UNIVERSALIDADE, como cerca.
 *
 * Os quatro papéis da equipe pronta servem a QUALQUER negócio. O texto de um
 * papel é igual para todas as empresas, então ele não pode carregar:
 *
 *   • termo de nicho  — a palavra de um ramo dentro do papel faz o agente de
 *                       uma loja falar como o de outro ramo;
 *   • valor em moeda  — preço mora no catálogo, e o agente consulta;
 *   • hora            — horário mora na agenda, e o agente consulta.
 *
 * Medido num ensaio (17/11/2026): os textos tinham o nome e o ramo de uma
 * empresa escritos dentro, e a falha de agendamento veio de o agente escolher o
 * tipo de agenda pelo nome citado no texto.
 *
 * Esta cerca lê o TEXTO de cada papel e das regras comuns. O bloco "## Esta
 * empresa" fica de fora de propósito: ele é gerado a partir das respostas da
 * empresa, e é lá que a palavra do ramo dela pode aparecer.
 */

/** Radicais de ramo. Radical, e não palavra, para pegar plural e derivado. */
const TERMOS_DE_NICHO = [
  "clínic",
  "clinic",
  "pacient",
  "odonto",
  "dentist",
  "dental",
  "médic",
  "medic",
  "consultório",
  "exame",
  "cirurgi",
  "tratamento",
  "procedimento",
  "imóve",
  "imóvel",
  "imovel",
  "imobili",
  "corretor",
  "alun",
  "matrícul",
  "matricul",
  "escola",
  "curso",
  "advog",
  "jurídic",
  "juridic",
  "processo judicial",
  "cidadania",
  "visto",
  "imigra",
  "restaurante",
  "cardápio",
  "salão",
  "estétic",
  "petshop",
  "veterin",
  "academia",
];

/** Valor em moeda: símbolo, código ou a palavra, com ou sem número. */
const MOEDA = /R\$|US\$|€|\$\s?\d|\b(?:BRL|EUR|USD)\b|\b\d+(?:[.,]\d+)?\s?(?:reais|real|euros?|d[oó]lar(?:es)?)\b/i;

/**
 * Hora escrita: 9h, 9h30, 09:30, 14 horas, "às 9".
 *
 * ⚠️ "às" NÃO leva `\b` na frente: `à` não é caractere de palavra para o regex
 * sem a flag `u`, então `\bàs` nunca casa depois de um espaço. A âncora é o
 * começo do texto ou um espaço.
 */
const HORA =
  /\b\d{1,2}\s?h(?:\d{2})?\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s?horas?\b|(?:^|\s)às\s+\d{1,2}\b/i;

/** Tudo o que o papel escreve e que chega a um modelo: texto, intenção e exemplos. */
const TUDO_DO_PAPEL: [string, string][] = PAPEIS.map((p) => [
  `papel ${p.id}`,
  [
    p.prompt,
    p.nomePadrao,
    p.descricao,
    p.intencao.nome,
    p.intencao.descricao,
    ...p.intencao.exemplos,
    ...p.handoffKeywordsPadrao,
  ].join("\n"),
]);

describe("os papéis da equipe pronta são universais", () => {
  it("guarda de vacuidade: os quatro papéis existem e têm texto de verdade", () => {
    expect(PAPEIS.map((p) => p.id)).toEqual([...PAPEIS_DA_EQUIPE]);
    for (const p of PAPEIS) expect(p.prompt.length).toBeGreaterThan(400);
    expect(REGRAS_COMUNS.length).toBeGreaterThan(200);
  });

  it.each([...TUDO_DO_PAPEL, ["regras comuns", REGRAS_COMUNS] as [string, string]])(
    "%s não tem termo de nicho",
    (_nome, texto) => {
      const minusculo = texto.toLowerCase();
      const achados = TERMOS_DE_NICHO.filter((termo) => minusculo.includes(termo));
      expect(achados).toEqual([]);
    },
  );

  it.each([...TUDO_DO_PAPEL, ["regras comuns", REGRAS_COMUNS] as [string, string]])(
    "%s não tem valor em moeda",
    (_nome, texto) => {
      expect(texto.match(MOEDA)?.[0] ?? null).toBeNull();
    },
  );

  it.each([...TUDO_DO_PAPEL, ["regras comuns", REGRAS_COMUNS] as [string, string]])(
    "%s não tem hora escrita",
    (_nome, texto) => {
      expect(texto.match(HORA)?.[0] ?? null).toBeNull();
    },
  );

  it("a cerca PEGA o que diz pegar (controle positivo)", () => {
    // Sem isto, um regex quebrado deixaria os três casos acima verdes para sempre.
    const sujo = "Atenda o paciente da clínica, a avaliação custa R$ 150 e é às 9h30.";
    expect(TERMOS_DE_NICHO.some((t) => sujo.toLowerCase().includes(t))).toBe(true);
    expect(MOEDA.test(sujo)).toBe(true);
    expect(HORA.test(sujo)).toBe(true);
    expect(MOEDA.test("custa 150 reais")).toBe(true);
    expect(HORA.test("atendemos das 14:00 em diante")).toBe(true);
    expect(HORA.test("sábado às 9")).toBe(true);
  });

  it("a cerca NÃO acusa o texto limpo (controle negativo)", () => {
    const limpo = "Ofereça no máximo três opções e marque em até 2 dias. Consulte o catálogo.";
    expect(TERMOS_DE_NICHO.some((t) => limpo.toLowerCase().includes(t))).toBe(false);
    expect(MOEDA.test(limpo)).toBe(false);
    expect(HORA.test(limpo)).toBe(false);
  });

  it("nenhum papel cita o tipo de agenda pelo nome: o identificador vem de 'Esta empresa'", () => {
    const agendamento = papelPorId("agendamento")!;
    expect(agendamento.prompt).toContain("event_type_id");
    expect(agendamento.prompt).toContain("Esta empresa");
    // Slug escrito no papel seria o defeito do ensaio com outro nome.
    expect(agendamento.prompt).not.toMatch(/event_type_slug\W+[a-z]+-[a-z]+/);
  });
});

describe("as ferramentas de cada papel", () => {
  it.each(PAPEIS.map((p) => [p.id, p] as const))("%s: lista explícita, sem repetição, até o teto", (_id, p) => {
    expect(p.toolIds.length).toBeGreaterThan(0);
    expect(p.toolIds.length).toBeLessThanOrEqual(TETO_TOOLS_POR_AGENTE);
    expect(new Set(p.toolIds).size).toBe(p.toolIds.length);
  });

  it.each(PAPEIS.map((p) => [p.id, p] as const))("%s: toda ferramenta existe no catálogo MCP", (_id, p) => {
    const validas = new Set<string>(VALID_TOOL_IDS);
    expect(p.toolIds.filter((id) => !validas.has(id))).toEqual([]);
  });

  it.each(PAPEIS.map((p) => [p.id, p] as const))(
    "%s: nenhuma ferramenta é só de humano (o turno não a montaria)",
    (_id, p) => {
      expect(p.toolIds.filter((id) => catalogEntry(id)?.apenasHumano === true)).toEqual([]);
    },
  );

  it("o papel que promete uma capacidade tem a ferramenta dela", () => {
    const tem = (papel: string, ferramenta: string) =>
      papelPorId(papel)!.toolIds.includes(ferramenta);
    // Agenda: consulta, marca na mesma ação, remarca e desmarca.
    for (const f of [
      "crm_find_free_slots",
      "crm_find_and_book_appointment",
      "crm_reschedule_appointment",
      "crm_cancel_appointment",
      "crm_list_appointments",
    ]) {
      expect(tem("agendamento", f), f).toBe(true);
    }
    // Proposta: catálogo, rascunho, consulta e envio.
    for (const f of ["crm_search_products", "crm_preparar_proposta", "crm_get_proposal", "crm_send_proposal"]) {
      expect(tem("proposta", f), f).toBe(true);
    }
    // Recuperador: lead frio só com aprovação humana.
    expect(tem("recuperador", "crm_propose_reactivation")).toBe(true);
    // Quem move o negócio de etapa tem a ferramenta de mover.
    for (const p of PAPEIS) expect(p.toolIds, p.id).toContain("crm_move_lead_stage");
    // Todos consultam a base antes de responder.
    for (const p of PAPEIS) expect(p.toolIds, p.id).toContain("crm_search_knowledge");
  });
});

/**
 * VERSÃO 2 — os agentes completos. O que a tarefa manda liberar em cada papel,
 * escrito como lista: papel que perde uma destas ferramentas numa edição futura
 * reprova aqui, e não numa conversa com cliente.
 */
describe("versão 2: o que cada papel passou a fazer", () => {
  const ferramentas = (papel: string) => papelPorId(papel)!.toolIds;

  it("os quatro papéis estão na versão 2, com a nota do que mudou", () => {
    for (const p of PAPEIS) {
      expect(p.versao, p.id).toBe(2);
      expect(p.notasDaVersao.length, p.id).toBeGreaterThan(40);
    }
    expect(VERSAO_DAS_REGRAS_COMUNS).toBe(2);
  });

  it("⭐ nenhum papel propõe dado para confirmar: todos gravam direto no cadastro", () => {
    for (const p of PAPEIS) {
      expect(p.toolIds, p.id).not.toContain("crm_propose_contact_field");
      expect(p.toolIds, p.id).toContain("crm_update_contact");
    }
  });

  it("Atendimento", () => {
    expect(ferramentas("sdr")).toEqual(
      expect.arrayContaining([
        "crm_search_contacts",
        "crm_list_contact_orders",
        "crm_close_demand",
        "crm_list_available_attendants",
        "crm_assign_conversation",
        "crm_set_conversation_sector",
        "crm_create_lead",
        "crm_update_lead",
        "crm_move_lead_stage",
        "crm_manage_tags",
        "crm_create_task",
      ]),
    );
  });

  it("Agendamento", () => {
    expect(ferramentas("agendamento")).toEqual(
      expect.arrayContaining([
        "crm_create_lead",
        "crm_update_lead",
        "crm_move_lead_stage",
        "crm_set_appointment_outcome",
        "crm_confirm_appointment",
        "crm_manage_tags",
      ]),
    );
  });

  it("Propostas", () => {
    expect(ferramentas("proposta")).toEqual(
      expect.arrayContaining([
        "crm_close_demand",
        "crm_get_proposal",
        "crm_send_proposal",
        "crm_attach_to_lead",
        "crm_create_task",
      ]),
    );
  });

  it("Recuperação", () => {
    expect(ferramentas("recuperador")).toEqual(
      expect.arrayContaining([
        "crm_enroll_followup_flow",
        "crm_list_message_templates",
        "crm_render_message_template",
        "crm_close_demand",
        "crm_retomar_lead",
        "crm_move_lead_stage",
      ]),
    );
    // Quem retoma passa a vez: não marca compromisso nem envia proposta.
    for (const f of ["crm_find_and_book_appointment", "crm_book_appointment", "crm_send_proposal"]) {
      expect(ferramentas("recuperador"), f).not.toContain(f);
    }
  });

  it("gatilhos: a Recuperação só LÊ os horários livres, para oferecer um novo a quem faltou", () => {
    expect(ferramentas("recuperador")).toContain("crm_find_free_slots");
    expect(catalogEntry("crm_find_free_slots")).toBeDefined();
    expect(allTools.find((t) => t.name === "crm_find_free_slots")?.category).toBe("read");
    const texto = papelPorId("recuperador")!.prompt;
    expect(texto).toContain("passe a vez para `agenda`");
  });

  it("gatilhos: o pedido de desconto vira caso para a equipe, e só Propostas abre caso", () => {
    expect(PAPEIS.filter((p) => p.abreCasoParaAEquipe === true).map((p) => p.id)).toEqual(["proposta"]);
    const texto = papelPorId("proposta")!.prompt;
    expect(texto).toContain("`open_human_case`");
    expect(texto).toContain("A resposta da equipe volta para você");
    // Quem decide o desconto é a equipe: o texto não manda mais "registrar numa tarefa e aguardar".
    expect(texto).not.toContain("registre o pedido numa tarefa");
  });

  it("gatilhos: a tarefa de seguimento do ganho é do sistema; Propostas não cria a segunda", () => {
    const texto = papelPorId("proposta")!.prompt;
    expect(texto).toContain("é criada sozinha quando o negócio é ganho");
    expect(texto).not.toContain("crie uma tarefa para a equipe dar seguimento");
  });

  it("só quem cuida da proposta envia proposta; ninguém manda mensagem solta por ferramenta", () => {
    expect(PAPEIS.filter((p) => p.toolIds.includes("crm_send_proposal")).map((p) => p.id)).toEqual(["proposta"]);
    for (const p of PAPEIS) expect(p.toolIds, p.id).not.toContain("crm_send_whatsapp_message");
  });

  it.each(PAPEIS.map((p) => [p.id, p] as const))(
    "%s: toda ferramenta tem handler, não é do motor, e toda escrita cabe num turno",
    (_id, p) => {
      const porNome = new Map(allTools.map((t) => [t.name, t]));
      for (const id of p.toolIds) {
        const tool = porNome.get(id);
        expect(tool, id).toBeDefined();
        // Ferramenta do motor não conta no teto e não entra na lista do papel.
        expect(IDS_DO_HARNESS.has(id), id).toBe(false);
        // Ao alcance do agente nativo; escrita sem escopo de turno seria recusada na conversa.
        expect(ROLE_RANK[tool!.requiresRole], id).toBeLessThanOrEqual(ROLE_RANK.ai_operator);
        if (tool!.category !== "read") expect(Object.hasOwn(ESCOPO_DAS_ESCRITAS, id), id).toBe(true);
      }
    },
  );

  it("a passagem entre colegas não é da lista do papel: quem a liga é o roteador", () => {
    for (const p of PAPEIS) expect(p.toolIds, p.id).not.toContain(FERRAMENTA_DE_PASSAGEM_ENTRE_COLEGAS);
    expect(REGRAS_COMUNS).toContain(`\`${FERRAMENTA_DE_PASSAGEM_ENTRE_COLEGAS}\``);
  });

  it("as regras comuns citam a ficha pelo título que o motor grava, e os colegas pelo nome do roteador", () => {
    expect(REGRAS_COMUNS).toContain(`"${TITULO_DO_RESUMO_DO_ATENDIMENTO}"`);
    for (const p of PAPEIS) expect(REGRAS_COMUNS, p.id).toContain(`\`${p.intencao.nome}\``);
  });

  it("as regras comuns dizem o que o agente nunca faz", () => {
    for (const trecho of [
      "Um negócio por pessoa",
      "Cada etapa do funil tem um dono",
      "Inventar preço",
      "desconto fora da regra",
      "Apagar",
      "Cobrar",
      "Responder por cima de uma pessoa da equipe",
      "pediu para parar",
    ]) {
      expect(REGRAS_COMUNS, trecho).toContain(trecho);
    }
  });

  it("o papel só cita, no texto, ferramenta que ele tem", () => {
    for (const p of PAPEIS) {
      const citadas = [...p.prompt.matchAll(/`(crm_[a-z_]+)`/g)].map((m) => m[1]!);
      expect(citadas.filter((f) => !p.toolIds.includes(f)), p.id).toEqual([]);
    }
  });

  it("o papel só passa a vez para colega que existe", () => {
    const colegas = new Set(PAPEIS.map((p) => p.intencao.nome));
    for (const p of PAPEIS) {
      const citados = [...p.prompt.matchAll(/passe a vez para `([a-z_]+)`/g)].map((m) => m[1]!);
      expect(citados.filter((c) => !colegas.has(c) || c === p.intencao.nome), p.id).toEqual([]);
    }
  });
});

describe("o catálogo de papéis", () => {
  it("as intenções têm nome único — é a chave do membro no roteador", () => {
    const nomes = PAPEIS.map((p) => p.intencao.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    for (const p of PAPEIS) {
      expect(p.intencao.descricao.length).toBeGreaterThan(20);
      expect(p.intencao.exemplos.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("o papel de entrada existe e é o SDR", () => {
    expect(PAPEL_DE_ENTRADA).toBe("sdr");
    expect(papelPorId(PAPEL_DE_ENTRADA)).toBeDefined();
  });

  it("só o Recuperador leva a régua de follow-up", () => {
    expect(PAPEIS.filter((p) => p.usaReguaDeFollowup).map((p) => p.id)).toEqual(["recuperador"]);
  });

  it("toda versão é inteira positiva e tem nota do que mudou", () => {
    for (const p of PAPEIS) {
      expect(Number.isInteger(p.versao) && p.versao >= 1, p.id).toBe(true);
      expect(p.notasDaVersao.trim().length, p.id).toBeGreaterThan(0);
    }
  });

  it("papel desconhecido devolve undefined, não erro", () => {
    expect(papelPorId("financeiro")).toBeUndefined();
  });
});
