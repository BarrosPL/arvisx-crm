import { describe, expect, it } from "vitest";

import { versionCreateSchema } from "@/lib/ai/agents/validation";
import { perfilSchema, type PerfilDoNegocio } from "@/lib/schemas/equipe-pronta";
import { PAPEIS, REGRAS_COMUNS, papelPorId } from "./index";
import {
  TITULO_DE_ESTA_EMPRESA,
  blocoEstaEmpresa,
  camposCanonicos,
  hashDosCampos,
  renderizarAgente,
  situacaoDoAgente,
} from "./renderizar";
import type { ContextoDaInstalacao } from "./tipos";

/**
 * O RENDERIZADOR, PROVADO EM DOIS RAMOS BEM DIFERENTES.
 *
 * A promessa da equipe pronta: os MESMOS quatro papéis servem a qualquer
 * negócio, e o que muda de uma empresa para outra é só o bloco gerado
 * "## Esta empresa". Aqui são duas empresas que não têm nada em comum — uma
 * clínica e uma assessoria de cidadania — passando pelo mesmo renderizador.
 *
 * As palavras de ramo aparecem NESTE arquivo de propósito: são as respostas das
 * empresas. O que o teste prova é que elas ficam confinadas ao bloco gerado.
 */

const CLINICA: PerfilDoNegocio = perfilSchema.parse({
  negocio: {
    nome: "Clínica Bem Viver",
    o_que_faz: "Clínica odontológica com avaliação, limpeza e tratamentos estéticos.",
    cidade: "Campinas, SP",
  },
  atendente: { nome: "Bia", tom: "caloroso", como_chamar: "paciente" },
  oferta: { informa_preco_por_mensagem: false },
  primeiro_passo: { tipo: "agendar" },
  qualificacao: {
    perguntas: ["É a primeira vez na clínica?", "Qual é a queixa principal?"],
  },
  regras: { desconto: { modo: "nunca" } },
});

const ASSESSORIA: PerfilDoNegocio = perfilSchema.parse({
  negocio: {
    nome: "Raízes Assessoria",
    o_que_faz: "Assessoria para reconhecimento de cidadania europeia por descendência.",
    cidade: "Atendimento online",
    idioma: "pt-BR",
  },
  atendente: { nome: "Marcos", tom: "profissional", como_chamar: "cliente" },
  oferta: { informa_preco_por_mensagem: true },
  primeiro_passo: { tipo: "proposta" },
  qualificacao: {
    perguntas: ["Quem é o antepassado europeu?", "Você já tem alguma certidão?"],
  },
  proposta: { usa: true, validade_dias: 15 },
  regras: { desconto: { modo: "com_aprovacao", ate_percentual: 10 } },
  humano: { situacoes: ["Processo já em andamento com outro escritório"], palavras: ["urgente"] },
  recuperacao: { toques_maximos: 3, limite_lead_frio_dias: 45 },
  ligacoes: { pode_ligar: true },
});

const CTX_CLINICA: ContextoDaInstalacao = {
  agenda: { id: "11111111-1111-4111-8111-111111111111", slug: "avaliacao", nome: "Avaliação" },
  funil: {
    id: "22222222-2222-4222-8222-222222222222",
    nome: "Atendimento",
    etapas: {
      qualificado: { id: "33333333-3333-4333-8333-333333333333", nome: "Qualificado" },
      perdido: { id: "44444444-4444-4444-8444-444444444444", nome: "Não fechou" },
    },
  },
  knowledgeSourceIds: ["55555555-5555-4555-8555-555555555555"],
  reguaDeFollowupId: "66666666-6666-4666-8666-666666666666",
};

const CTX_ASSESSORIA: ContextoDaInstalacao = {
  agenda: null,
  funil: {
    id: "77777777-7777-4777-8777-777777777777",
    nome: "Cidadania",
    etapas: {
      qualificado: { id: "88888888-8888-4888-8888-888888888888", nome: "Elegível" },
      proposta_enviada: { id: "99999999-9999-4999-8999-999999999999", nome: "Proposta enviada" },
      perdido: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nome: "Perdido" },
    },
  },
  knowledgeSourceIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
  reguaDeFollowupId: null,
};

/** Tudo antes do título do bloco gerado: o papel e as regras comuns. */
function parteFixa(prompt: string): string {
  const corte = prompt.indexOf(TITULO_DE_ESTA_EMPRESA);
  expect(corte, "o bloco 'Esta empresa' precisa existir").toBeGreaterThan(0);
  return prompt.slice(0, corte);
}

describe("só o bloco 'Esta empresa' muda de uma empresa para outra", () => {
  it.each(PAPEIS.map((p) => [p.id, p] as const))(
    "%s: a parte fixa é idêntica nos dois ramos, byte a byte",
    (_id, papel) => {
      const naClinica = renderizarAgente(papel, CLINICA, CTX_CLINICA);
      const naAssessoria = renderizarAgente(papel, ASSESSORIA, CTX_ASSESSORIA);

      expect(parteFixa(naClinica.system_prompt)).toBe(parteFixa(naAssessoria.system_prompt));
      // E a parte fixa é exatamente papel + regras comuns, sem nada da empresa.
      expect(parteFixa(naClinica.system_prompt)).toBe(`${papel.prompt}\n\n${REGRAS_COMUNS}\n\n`);
      // As ferramentas são do papel, não da empresa.
      expect(naClinica.tool_ids).toEqual(naAssessoria.tool_ids);
      // E o que sobra — o bloco — é de fato diferente.
      expect(naClinica.system_prompt).not.toBe(naAssessoria.system_prompt);
    },
  );

  it("as palavras do ramo ficam confinadas ao bloco gerado", () => {
    for (const papel of PAPEIS) {
      const fixa = parteFixa(renderizarAgente(papel, CLINICA, CTX_CLINICA).system_prompt);
      for (const palavra of ["Clínica", "odonto", "paciente", "Bia", "Campinas"]) {
        expect(fixa, `${papel.id}: "${palavra}" vazou para a parte fixa`).not.toContain(palavra);
      }
    }
  });

  it("o bloco 'Esta empresa' da clínica (snapshot)", () => {
    expect(blocoEstaEmpresa(CLINICA, CTX_CLINICA)).toMatchSnapshot();
  });

  it("o bloco 'Esta empresa' da assessoria de cidadania (snapshot)", () => {
    expect(blocoEstaEmpresa(ASSESSORIA, CTX_ASSESSORIA)).toMatchSnapshot();
  });

  it.each(PAPEIS.map((p) => [p.id, p] as const))("%s: texto completo na clínica (snapshot)", (_id, papel) => {
    expect(renderizarAgente(papel, CLINICA, CTX_CLINICA)).toMatchSnapshot();
  });

  it.each(PAPEIS.map((p) => [p.id, p] as const))(
    "%s: texto completo na assessoria (snapshot)",
    (_id, papel) => {
      expect(renderizarAgente(papel, ASSESSORIA, CTX_ASSESSORIA)).toMatchSnapshot();
    },
  );
});

describe("o bloco 'Esta empresa' carrega identificador real, nunca preço nem horário", () => {
  const bloco = blocoEstaEmpresa(CLINICA, CTX_CLINICA);

  it("o tipo de agenda entra com o id E o slug reais", () => {
    expect(bloco).toContain("`event_type_id`: `11111111-1111-4111-8111-111111111111`");
    expect(bloco).toContain("`event_type_slug`: `avaliacao`");
  });

  it("as etapas entram com o id real", () => {
    expect(bloco).toContain("`to_stage_id`: `33333333-3333-4333-8333-333333333333`");
    expect(bloco).toContain("`lost_reason`");
    // Passo sem etapa marcada não é inventado.
    expect(bloco).not.toContain("Proposta enviada: etapa");
    // Cada etapa diz quem move o negócio para ela.
    expect(bloco).toContain("Quem move: quem recebe.");
  });

  it("sem tipo de agenda, o bloco diz para chamar a equipe em vez de inventar um", () => {
    const semAgenda = blocoEstaEmpresa(ASSESSORIA, CTX_ASSESSORIA);
    expect(semAgenda).toContain("não marca compromisso pela conversa");
    expect(semAgenda).not.toContain("event_type_id");
  });

  it("nenhum valor em moeda e nenhuma hora, em nenhum dos dois ramos", () => {
    for (const texto of [bloco, blocoEstaEmpresa(ASSESSORIA, CTX_ASSESSORIA)]) {
      expect(texto).not.toMatch(/R\$|€|\breais\b/i);
      expect(texto).not.toMatch(/\b\d{1,2}h\d{0,2}\b|\b\d{1,2}:\d{2}\b/);
    }
  });

  it("a regra de preço e a de desconto seguem as respostas", () => {
    expect(bloco).toContain("Preço: NÃO é informado por mensagem");
    expect(bloco).toContain("não dá desconto pela conversa");
    const assessoria = blocoEstaEmpresa(ASSESSORIA, CTX_ASSESSORIA);
    expect(assessoria).toContain("Preço: pode ser informado por mensagem");
    expect(assessoria).toContain("de até 10%");
    expect(assessoria).toContain("No máximo 3 tentativa(s)");
    expect(assessoria).toContain("mais de 45 dias");
  });
});

describe("os campos da versão", () => {
  it("cabem no schema da versão do agente, em todo papel e nos dois ramos", () => {
    for (const papel of PAPEIS) {
      for (const [perfil, ctx] of [
        [CLINICA, CTX_CLINICA],
        [ASSESSORIA, CTX_ASSESSORIA],
      ] as const) {
        const lido = versionCreateSchema.safeParse({
          ...renderizarAgente(papel, perfil, ctx),
          provider: "openai",
          model: "modelo-de-teste",
          credential_id: null,
          channel_session_id: null,
        });
        expect(lido.success, `${papel.id}: ${JSON.stringify(lido.error?.issues)}`).toBe(true);
      }
    }
  });

  it("só o Recuperador liga o follow-up — e só quando a régua existe", () => {
    const recuperador = papelPorId("recuperador")!;
    expect(renderizarAgente(recuperador, CLINICA, CTX_CLINICA).followup).toEqual({
      enabled: true,
      flow_pointer_ids: ["66666666-6666-4666-8666-666666666666"],
    });
    // Sem régua instalada, ligar o follow-up apontaria para lugar nenhum.
    expect(renderizarAgente(recuperador, ASSESSORIA, CTX_ASSESSORIA).followup).toEqual({
      enabled: false,
      flow_pointer_ids: [],
    });
    expect(renderizarAgente(papelPorId("sdr")!, CLINICA, CTX_CLINICA).followup.enabled).toBe(false);
  });

  it("funil e base vêm do contexto; as palavras de passagem somam papel e empresa, sem repetir", () => {
    const campos = renderizarAgente(papelPorId("sdr")!, ASSESSORIA, CTX_ASSESSORIA);
    expect(campos.pipeline_ids).toEqual(["77777777-7777-4777-8777-777777777777"]);
    expect(campos.knowledge_source_ids).toEqual(["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
    expect(campos.handoff_keywords).toEqual([
      "falar com humano",
      "atendente",
      "pessoa real",
      "urgente",
    ]);
  });

  it("empresa que não usa proposta desliga o rascunho de proposta em todo papel", () => {
    const semProposta = perfilSchema.parse({ ...CLINICA, proposta: { usa: false } });
    for (const papel of PAPEIS) {
      expect(renderizarAgente(papel, semProposta, CTX_CLINICA).proposal_ai_draft_enabled).toBe(false);
      expect(renderizarAgente(papel, CLINICA, CTX_CLINICA).proposal_ai_draft_enabled).toBe(true);
    }
  });

  it("é puro: a mesma entrada dá a mesma saída", () => {
    const papel = papelPorId("agendamento")!;
    expect(renderizarAgente(papel, CLINICA, CTX_CLINICA)).toEqual(
      renderizarAgente(papel, CLINICA, CTX_CLINICA),
    );
  });
});

describe("o hash dos campos e a detecção de edição à mão", () => {
  const papel = papelPorId("sdr")!;
  const gerado = renderizarAgente(papel, CLINICA, CTX_CLINICA);

  it("a versão lida do banco tem o mesmo hash do que o renderizador gerou", () => {
    // O banco devolve mais colunas, as listas em outra ordem e o texto com
    // espaço nas pontas: nada disso é edição.
    const doBanco = {
      ...gerado,
      system_prompt: `${gerado.system_prompt}\n`,
      tool_ids: [...gerado.tool_ids].reverse(),
      provider: "openai",
      model: "outro-modelo",
      token_budget: 99999,
      followup: { ...gerado.followup, send_window: null },
    };
    expect(hashDosCampos(doBanco)).toBe(hashDosCampos(gerado));
  });

  it("trocar o modelo não é editar à mão; trocar o texto, a ferramenta ou a base é", () => {
    const base = hashDosCampos(gerado);
    expect(hashDosCampos({ ...gerado, system_prompt: `${gerado.system_prompt} Ofereça brinde.` })).not.toBe(base);
    expect(hashDosCampos({ ...gerado, tool_ids: gerado.tool_ids.slice(1) })).not.toBe(base);
    expect(hashDosCampos({ ...gerado, knowledge_source_ids: [] })).not.toBe(base);
    expect(hashDosCampos({ ...gerado, handoff_keywords: ["humano"] })).not.toBe(base);
    expect(hashDosCampos({ ...gerado, proposal_ai_draft_enabled: false })).not.toBe(base);
  });

  it("forma canônica: campo ausente vira o padrão, e não um hash diferente por acaso", () => {
    expect(camposCanonicos({})).toEqual({
      system_prompt: "",
      tool_ids: [],
      handoff_keywords: [],
      followup: { enabled: false, flow_pointer_ids: [] },
      pipeline_ids: [],
      knowledge_source_ids: [],
      proposal_ai_draft_enabled: true,
    });
  });

  const A = "a".repeat(64);
  const B = "b".repeat(64);
  const C = "c".repeat(64);

  it("publicado igual ao gerado: em dia — mesmo com o hash guardado velho ou ausente", () => {
    expect(situacaoDoAgente({ publicado: A, gerado: A, instalado: A })).toBe("em_dia");
    // O hash guardado não manda: o que vale é o que está publicado de fato.
    expect(situacaoDoAgente({ publicado: A, gerado: A, instalado: B })).toBe("em_dia");
    expect(situacaoDoAgente({ publicado: A, gerado: A, instalado: null })).toBe("em_dia");
  });

  it("publicado como o instalador deixou, mas o perfil mudou: desatualizado (reaplicar é seguro)", () => {
    expect(situacaoDoAgente({ publicado: A, gerado: B, instalado: A })).toBe("desatualizado");
  });

  it("publicado diferente do instalado E do gerado: editado à mão", () => {
    expect(situacaoDoAgente({ publicado: C, gerado: B, instalado: A })).toBe("editado_a_mao");
  });

  it("sem hash guardado e diferente do gerado: fecha na dúvida, como edição à mão", () => {
    expect(situacaoDoAgente({ publicado: C, gerado: B, instalado: null })).toBe("editado_a_mao");
  });

  it("⭐ ponta a ponta: mudar uma resposta não é editar à mão; mexer no agente é", () => {
    const instalado = hashDosCampos(gerado);
    // O cliente mudou uma resposta do questionário: o gerado muda, o publicado não.
    const outroPerfil = perfilSchema.parse({ ...CLINICA, atendente: { ...CLINICA.atendente, nome: "Lia" } });
    const geradoAgora = hashDosCampos(renderizarAgente(papel, outroPerfil, CTX_CLINICA));
    expect(situacaoDoAgente({ publicado: instalado, gerado: geradoAgora, instalado })).toBe(
      "desatualizado",
    );
    // O cliente abriu o editor do agente e mudou o texto.
    const mexido = hashDosCampos({ ...gerado, system_prompt: `${gerado.system_prompt}\nSeja breve.` });
    expect(situacaoDoAgente({ publicado: mexido, gerado: instalado, instalado })).toBe(
      "editado_a_mao",
    );
  });
});
