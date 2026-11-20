import { describe, expect, it } from "vitest";

import {
  BLOCOS_DO_QUESTIONARIO,
  BLOCOS_OBRIGATORIOS,
  ESTADOS_DA_EQUIPE,
  MODOS_DA_EQUIPE,
  instalarSchema,
  oQueFaltaNoRascunho,
  perfilSchema,
  rascunhoSchema,
  salvarPerfilSchema,
} from "./equipe-pronta";

/**
 * O PERFIL DO NEGÓCIO — o questionário da equipe pronta.
 *
 * Onze blocos, e a promessa é que dá para instalar respondendo só três
 * (negócio, atendente e primeiro passo): todo o resto tem padrão. Este arquivo
 * prende essa promessa, os padrões das decisões de produto (P-03, P-04) e o
 * que o questionário NÃO pergunta — preço e horário.
 */
const MINIMO = {
  negocio: { nome: "Empresa", o_que_faz: "Presta um serviço." },
  atendente: { nome: "Ana" },
  primeiro_passo: { tipo: "agendar" },
};

describe("os onze blocos", () => {
  it("são onze, e só três são obrigatórios", () => {
    expect(BLOCOS_DO_QUESTIONARIO).toHaveLength(11);
    expect([...BLOCOS_OBRIGATORIOS]).toEqual(["negocio", "atendente", "primeiro_passo"]);
  });

  it("⭐ dá para instalar respondendo só os blocos 1, 2 e 4", () => {
    const lido = perfilSchema.safeParse(MINIMO);
    expect(lido.success, JSON.stringify(lido.error?.issues)).toBe(true);
  });

  it.each([...BLOCOS_OBRIGATORIOS])("sem o bloco %s, não instala", (bloco) => {
    const semUm: Record<string, unknown> = { ...MINIMO };
    delete semUm[bloco];
    expect(perfilSchema.safeParse(semUm).success).toBe(false);
  });

  it("os padrões são os das decisões de produto", () => {
    const p = perfilSchema.parse(MINIMO);
    expect(p.negocio).toMatchObject({ fuso: "America/Sao_Paulo", idioma: "pt-BR" });
    expect(p.atendente).toMatchObject({ tom: "profissional", como_chamar: "cliente" });
    // Preço não é informado por mensagem, a menos que a empresa diga que é.
    expect(p.oferta.informa_preco_por_mensagem).toBe(false);
    // P-03: proposta em uso, sempre rascunho. Na v2 o agente envia, e o
    // padrão é só depois de a equipe aprovar (decisão 2 do dono).
    expect(p.proposta).toEqual({ usa: true, validade_dias: 7, envio_de_proposta: "apos_aprovacao" });
    // Desconto: nunca, até a empresa dizer outra coisa.
    expect(p.regras.desconto).toEqual({ modo: "nunca" });
    // P-04: 2 toques, lead frio em 30 dias.
    expect(p.recuperacao).toEqual({
      dias_para_esfriar: 3,
      toques_maximos: 2,
      intervalo_dias: 2,
      limite_lead_frio_dias: 30,
    });
    expect(p.humano.situacoes.length).toBeGreaterThan(0);
    expect(p.ligacoes.pode_ligar).toBe(false);
    expect(p.onde).toEqual({ etapas: {}, telefones_de_teste: [] });
  });

  it("⭐ o questionário não tem onde escrever preço nem horário", () => {
    // Campo de valor ou de hora no perfil levaria o dado para dentro do texto
    // do agente. Eles moram no catálogo e na agenda.
    const chaves = JSON.stringify(Object.keys(perfilSchema.shape).map((b) => b)).toLowerCase();
    const todas = (function coletar(schema: unknown, acc: string[] = []): string[] {
      const shape = (schema as { shape?: Record<string, unknown> })?.shape;
      if (!shape) return acc;
      for (const [k, v] of Object.entries(shape)) {
        acc.push(k);
        coletar((v as { unwrap?: () => unknown }).unwrap?.() ?? v, acc);
        coletar((v as { def?: { innerType?: unknown } }).def?.innerType, acc);
      }
      return acc;
    })(perfilSchema);
    expect(chaves).not.toMatch(/preco_|valor|horario/);
    expect(todas.filter((k) => /^(preco|valor|horario|hora)(_|$)/.test(k))).toEqual([]);
    // A única chave com "preco" é a regra de informar ou não por mensagem.
    expect([...new Set(todas.filter((k) => k.includes("preco")))]).toEqual(["informa_preco_por_mensagem"]);
  });

  it("recusa campo desconhecido no nível dos blocos (schema estrito)", () => {
    expect(perfilSchema.safeParse({ ...MINIMO, organization_id: "x" }).success).toBe(false);
  });
});

describe("validações que protegem o instalador", () => {
  it("telefone de teste só em E.164 com +", () => {
    const com = (telefones: string[]) =>
      perfilSchema.safeParse({ ...MINIMO, onde: { telefones_de_teste: telefones } }).success;
    expect(com(["+5511999990000"])).toBe(true);
    expect(com(["11999990000"])).toBe(false);
    expect(com(["+55 11 99999-0000"])).toBe(false);
  });

  it("o desconto com aprovação exige o limite; 'nunca' não aceita limite solto", () => {
    const com = (desconto: unknown) => perfilSchema.safeParse({ ...MINIMO, regras: { desconto } }).success;
    expect(com({ modo: "com_aprovacao", ate_percentual: 10 })).toBe(true);
    expect(com({ modo: "com_aprovacao" })).toBe(false);
    expect(com({ modo: "com_aprovacao", ate_percentual: 150 })).toBe(false);
    expect(com({ modo: "nunca" })).toBe(true);
  });

  it("agenda principal: uma existente (por id) ou uma a criar (com nome)", () => {
    const com = (agenda: unknown) =>
      perfilSchema.safeParse({ ...MINIMO, primeiro_passo: { tipo: "agendar", agenda } }).success;
    expect(com({ modo: "existente", event_type_id: "11111111-1111-4111-8111-111111111111" })).toBe(true);
    expect(com({ modo: "existente", event_type_id: "consulta" })).toBe(false);
    expect(com({ modo: "criar", nome: "Primeira conversa" })).toBe(true);
    expect(com({ modo: "criar" })).toBe(false);
  });

  it("recuperação: no máximo 4 toques, e o silêncio cabe na janela do motor de follow-up", () => {
    const com = (r: unknown) => perfilSchema.safeParse({ ...MINIMO, recuperacao: r }).success;
    expect(com({ toques_maximos: 4 })).toBe(true);
    expect(com({ toques_maximos: 5 })).toBe(false);
    expect(com({ dias_para_esfriar: 6 })).toBe(true);
    expect(com({ dias_para_esfriar: 7 })).toBe(false);
  });

  it("qualificação: lista curta", () => {
    const perguntas = (n: number) => Array.from({ length: n }, (_, i) => `Pergunta ${i + 1}?`);
    expect(perfilSchema.safeParse({ ...MINIMO, qualificacao: { perguntas: perguntas(5) } }).success).toBe(true);
    expect(perfilSchema.safeParse({ ...MINIMO, qualificacao: { perguntas: perguntas(6) } }).success).toBe(false);
  });
});

describe("o rascunho", () => {
  it("aceita vazio e aceita bloco pela metade — é o que a tela salva a cada passo", () => {
    expect(rascunhoSchema.safeParse({}).success).toBe(true);
    expect(rascunhoSchema.safeParse({ negocio: { nome: "Só o nome" } }).success).toBe(true);
    expect(rascunhoSchema.safeParse({ atendente: {} }).success).toBe(true);
  });

  it("mas não aceita valor inválido nem bloco desconhecido", () => {
    expect(rascunhoSchema.safeParse({ atendente: { tom: "agressivo" } }).success).toBe(false);
    expect(rascunhoSchema.safeParse({ organization_id: "x" }).success).toBe(false);
  });

  it("oQueFaltaNoRascunho diz, por bloco, o que falta para instalar", () => {
    const r = oQueFaltaNoRascunho({ negocio: { nome: "Só o nome" } });
    expect(r).toEqual({ ok: false, faltam: ["atendente", "negocio.o_que_faz", "primeiro_passo"] });
    expect(oQueFaltaNoRascunho(MINIMO)).toMatchObject({ ok: true });
  });
});

describe("os corpos das rotas", () => {
  it("salvar: só `respostas`, estrito", () => {
    expect(salvarPerfilSchema.safeParse({ respostas: { negocio: { nome: "A" } } }).success).toBe(true);
    expect(salvarPerfilSchema.safeParse({ respostas: {}, organization_id: "x" }).success).toBe(false);
    expect(salvarPerfilSchema.safeParse({}).success).toBe(false);
  });

  it("instalar: `forcar` é opcional e nasce falso", () => {
    expect(instalarSchema.parse({})).toEqual({ forcar: false });
    expect(instalarSchema.parse({ forcar: true })).toEqual({ forcar: true });
    expect(instalarSchema.safeParse({ forcar: "sim" }).success).toBe(false);
  });

  it("o vocabulário de estado e modo é o do banco (CHECK da migration 9808)", () => {
    expect([...ESTADOS_DA_EQUIPE]).toEqual(["rascunho", "instalado"]);
    expect([...MODOS_DA_EQUIPE]).toEqual(["ensaio", "ativo"]);
  });
});
