import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { perfilSchema, rascunhoSchema, SITUACOES_PADRAO_DE_HUMANO, type PerfilDoNegocio } from "@/lib/schemas/equipe-pronta";

import { PAPEIS } from "../index";
import { recusaAntesDeInstalar, textoDaBase } from "../instalar";
import { padroesDoPacote } from "../questionario";
import { TITULO_DE_ESTA_EMPRESA, blocoEstaEmpresa, hashDosCampos, renderizarAgente, situacaoDoAgente } from "../renderizar";
import type { ContextoDaInstalacao } from "../tipos";
import { PACOTE_ADVOCACIA } from "./advocacia";
import {
  MARCA_DE_CAMPO_A_PREENCHER,
  NICHOS_COM_PACOTE,
  PACOTES,
  TITULO_DAS_REGRAS_DO_RAMO,
  pacoteDoTipo,
  secaoDoRamo,
  semCamposPorPreencher,
  tipoDeNegocioDe,
  type PacoteDeNicho,
} from "./index";
import { TERMOS_DE_NICHO, TERMOS_DE_NICHO_DOS_FLUXOS, TERMOS_DE_NICHO_DOS_PAPEIS } from "./termos-de-nicho";

/**
 * A CAMADA DE NICHO DA EQUIPE PRONTA (Tarefa 8, parte 4).
 *
 * O que este arquivo prova:
 *   1. a régua de termos de ramo não encolheu ao mudar de arquivo;
 *   2. CERCA: fora de `nichos/`, nenhum texto da equipe pronta cita ramo;
 *   3. as regras duras do pacote aparecem no prompt montado dos quatro agentes;
 *   4. sem pacote, o que o renderizador gera não muda um byte;
 *   5. o pacote pré-preenche o questionário sem trocar o que a empresa respondeu;
 *   6. atualizar o pacote reaplica no agente intacto e para no editado à mão.
 */

const PASTA_DA_EQUIPE = join(__dirname, "..");
const PASTA_DOS_NICHOS = __dirname;

const CONTEXTO: ContextoDaInstalacao = {
  agenda: { id: "11111111-1111-4111-8111-111111111111", slug: "primeira-conversa", nome: "Primeira conversa" },
  funil: { id: "22222222-2222-4222-8222-222222222222", nome: "Comercial", etapas: {} },
  knowledgeSourceIds: ["33333333-3333-4333-8333-333333333333"],
  reguaDeFollowupId: "44444444-4444-4444-8444-444444444444",
};

/** O mesmo negócio, com e sem o ramo escolhido: só o campo muda. */
const respostas = (tipo?: string) => ({
  negocio: {
    nome: "Empresa de Exemplo",
    o_que_faz: "Atende pessoas e empresas com hora marcada.",
    ...(tipo === undefined ? {} : { tipo_de_negocio: tipo }),
  },
  atendente: { nome: "Lia" },
  primeiro_passo: { tipo: "agendar" },
});
const SEM_O_CAMPO: PerfilDoNegocio = perfilSchema.parse(respostas());
const GENERICO: PerfilDoNegocio = perfilSchema.parse(respostas("generico"));
const DO_RAMO: PerfilDoNegocio = perfilSchema.parse(respostas("advocacia"));

describe("a régua de termos de ramo não encolheu ao mudar de arquivo", () => {
  it("a lista dos papéis é a de sempre, item por item", () => {
    expect([...TERMOS_DE_NICHO_DOS_PAPEIS]).toEqual([
      "clínic", "clinic", "pacient", "odonto", "dentist", "dental", "médic", "medic", "consultório", "exame",
      "cirurgi", "tratamento", "procedimento", "imóve", "imóvel", "imovel", "imobili", "corretor", "alun",
      "matrícul", "matricul", "escola", "curso", "advog", "jurídic", "juridic", "processo judicial", "cidadania",
      "visto", "imigra", "restaurante", "cardápio", "salão", "estétic", "petshop", "veterin", "academia",
    ]);
  });

  it("a lista dos fluxos de gatilho é a de sempre, item por item", () => {
    expect([...TERMOS_DE_NICHO_DOS_FLUXOS]).toEqual([
      "clínic", "pacient", "consultório", "tratamento", "procedimento", "imóve", "alun", "curso", "advog",
    ]);
  });

  it("a união cobre as duas", () => {
    for (const termo of [...TERMOS_DE_NICHO_DOS_PAPEIS, ...TERMOS_DE_NICHO_DOS_FLUXOS]) expect(TERMOS_DE_NICHO).toContain(termo);
    expect(new Set(TERMOS_DE_NICHO).size).toBe(TERMOS_DE_NICHO.length);
  });
});

// ── CERCA: só `nichos/` cita ramo ────────────────────────────────────────────

/** Os `.ts` de produto de uma pasta (sem testes, sem snapshots). */
function arquivosDeProduto(pasta: string): string[] {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) return nome === "__snapshots__" ? [] : arquivosDeProduto(caminho);
    return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

/**
 * Todo TEXTO que o arquivo escreve: literal de string e cada pedaço de template.
 * Pelo compilador, e não por expressão regular: comentário e nome de variável
 * não são texto que chega a um agente (`exame`, `vistos` e `recurso` são
 * identificadores e comentários deste módulo, e não ramo de ninguém).
 */
function textosDoArquivo(caminho: string): string[] {
  const fonte = ts.createSourceFile(caminho, readFileSync(caminho, "utf8"), ts.ScriptTarget.Latest, true);
  const textos: string[] = [];
  const visitar = (no: ts.Node): void => {
    if (ts.isStringLiteralLike(no) || ts.isTemplateHead(no) || ts.isTemplateMiddle(no) || ts.isTemplateTail(no)) {
      textos.push(no.text);
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return textos;
}

const termosEm = (textos: readonly string[]) => {
  const tudo = textos.join("\n").toLowerCase();
  return TERMOS_DE_NICHO.filter((termo) => tudo.includes(termo));
};

const rel = (caminho: string) => relative(PASTA_DA_EQUIPE, caminho).split(sep).join("/");
const FORA_DOS_NICHOS = arquivosDeProduto(PASTA_DA_EQUIPE).filter((c) => !rel(c).startsWith("nichos/"));
const DENTRO_DOS_NICHOS = arquivosDeProduto(PASTA_DOS_NICHOS);

describe("cerca: só nichos/ pode citar ramo", () => {
  it("guarda de vacuidade: a varredura alcança os papéis, o renderizador e o instalador, e lê texto de verdade", () => {
    const alcancados = FORA_DOS_NICHOS.map(rel);
    for (const esperado of ["papeis/sdr.ts", "papeis/comum.ts", "renderizar.ts", "instalar.ts", "gatilhos/fluxos.ts", "regua.ts"]) {
      expect(alcancados).toContain(esperado);
    }
    expect(alcancados.some((c) => c.startsWith("nichos/"))).toBe(false);
    const sdr = FORA_DOS_NICHOS.find((c) => rel(c) === "papeis/sdr.ts")!;
    expect(textosDoArquivo(sdr).join("\n").length).toBeGreaterThan(400);
  });

  it("controle: a mesma varredura ACHA os termos onde eles podem estar", () => {
    const advocacia = DENTRO_DOS_NICHOS.find((c) => c.endsWith("advocacia.ts"))!;
    const achados = termosEm(textosDoArquivo(advocacia));
    expect(achados).toContain("advog");
    expect(achados).toContain("jurídic");
  });

  it.each(FORA_DOS_NICHOS.map((c) => [rel(c), c] as const))("%s não escreve termo de ramo", (_nome, caminho) => {
    expect(termosEm(textosDoArquivo(caminho))).toEqual([]);
  });

  it("os papéis, as regras comuns e os fluxos de gatilho não importam nada de nichos/", () => {
    const universais = FORA_DOS_NICHOS.filter((c) => /^(papeis|gatilhos)\//.test(rel(c)) || ["regua.ts", "etapas.ts"].includes(rel(c)));
    expect(universais.length).toBeGreaterThan(8);
    const importam = universais.filter((c) => /from\s+["'][^"']*nichos/.test(readFileSync(c, "utf8"))).map(rel);
    expect(importam).toEqual([]);
  });
});

// ── o pacote no prompt montado ───────────────────────────────────────────────

describe("o pacote de advocacia no prompt montado", () => {
  it("guarda de vacuidade: o pacote tem as seis regras duras, e é o que o tipo de negócio escolhe", () => {
    expect(PACOTE_ADVOCACIA.regrasDuras).toHaveLength(6);
    expect(pacoteDoTipo("advocacia")).toBe(PACOTE_ADVOCACIA);
    expect(Object.keys(PACOTES)).toEqual([...NICHOS_COM_PACOTE]);
  });

  it.each(PAPEIS.map((p) => [p.id, p] as const))("⭐ %s: cada regra dura aparece, literal, depois do bloco Esta empresa", (_id, papel) => {
    const prompt = renderizarAgente(papel, DO_RAMO, CONTEXTO).system_prompt;
    const depoisDoBloco = prompt.slice(prompt.indexOf(TITULO_DE_ESTA_EMPRESA));
    expect(depoisDoBloco).toContain(TITULO_DAS_REGRAS_DO_RAMO);
    for (const regra of PACOTE_ADVOCACIA.regrasDuras) expect(depoisDoBloco, regra).toContain(`- ${regra}`);
  });

  it("⭐ as seis proibições pedidas estão nas regras: resultado, opinião, orientação, honorários, urgência e documentos", () => {
    const regras = PACOTE_ADVOCACIA.regrasDuras.join("\n");
    expect(regras).toMatch(/Nunca prometa resultado/);
    expect(regras).toMatch(/Nunca dê opinião sobre o caso/);
    expect(regras).toMatch(/Nunca dê orientação jurídica/);
    expect(regras).toMatch(/Honorários e custos: informe só o que esta empresa cadastrou/);
    for (const gatilho of ["prazo", "intimação", "citação", "audiência", "liminar", "urgência"]) {
      expect(regras, gatilho).toMatch(new RegExp(`Passe a conversa para uma pessoa da equipe[^\\n]*${gatilho}`));
    }
    expect(regras).toMatch(/Não peça documentos sensíveis pela conversa/);
  });

  it("⭐ o pacote não toca na parte universal: papel e regras comuns saem iguais com e sem ele", () => {
    for (const papel of PAPEIS) {
      const com = renderizarAgente(papel, DO_RAMO, CONTEXTO).system_prompt;
      const sem = renderizarAgente(papel, GENERICO, CONTEXTO).system_prompt;
      const antesDoBloco = (texto: string) => texto.slice(0, texto.indexOf(TITULO_DE_ESTA_EMPRESA));
      expect(antesDoBloco(com)).toBe(antesDoBloco(sem));
      // E o resto do bloco também: o pacote só ACRESCENTA, no fim.
      expect(com.startsWith(sem)).toBe(true);
      expect(com.slice(sem.length)).toBe(`\n\n${secaoDoRamo(PACOTE_ADVOCACIA)}`);
    }
  });

  it("o pacote não muda ferramenta, palavra de passagem nem nenhum outro campo do agente", () => {
    for (const papel of PAPEIS) {
      const { system_prompt: _a, ...com } = renderizarAgente(papel, DO_RAMO, CONTEXTO);
      const { system_prompt: _b, ...sem } = renderizarAgente(papel, GENERICO, CONTEXTO);
      expect(com).toEqual(sem);
    }
  });
});

describe("sem pacote, nada muda", () => {
  it("⭐ perfil gravado antes do campo é lido como genérico e gera o mesmo texto, byte a byte", () => {
    expect(SEM_O_CAMPO.negocio.tipo_de_negocio).toBe("generico");
    for (const papel of PAPEIS) {
      const semCampo = renderizarAgente(papel, SEM_O_CAMPO, CONTEXTO);
      const generico = renderizarAgente(papel, GENERICO, CONTEXTO);
      expect(semCampo.system_prompt).toBe(generico.system_prompt);
      expect(hashDosCampos(semCampo)).toBe(hashDosCampos(generico));
      expect(semCampo.system_prompt).not.toContain(TITULO_DAS_REGRAS_DO_RAMO);
    }
  });

  it("o genérico não escreve termo de ramo em lugar nenhum do texto gerado", () => {
    for (const papel of PAPEIS) {
      const texto = renderizarAgente(papel, GENERICO, CONTEXTO).system_prompt.toLowerCase();
      expect(TERMOS_DE_NICHO.filter((termo) => texto.includes(termo))).toEqual([]);
    }
  });

  it("valor desconhecido não vira pacote, e o schema o recusa", () => {
    expect(pacoteDoTipo("clinica")).toBeNull();
    expect(pacoteDoTipo(undefined)).toBeNull();
    expect(tipoDeNegocioDe("qualquer coisa")).toBe("generico");
    expect(perfilSchema.safeParse(respostas("clinica")).success).toBe(false);
  });
});

// ── o questionário ───────────────────────────────────────────────────────────

describe("o pacote pré-preenche o questionário", () => {
  it("sem pacote, os padrões são os de hoje", () => {
    expect(padroesDoPacote(null)).toEqual({ perguntas: [], situacoes: SITUACOES_PADRAO_DE_HUMANO, faq: "" });
  });

  it("⭐ com o pacote: as cinco perguntas de qualificação pedidas, as situações de chamar uma pessoa e o modelo de perguntas", () => {
    const padroes = padroesDoPacote(PACOTE_ADVOCACIA);
    expect(padroes.perguntas).toHaveLength(5);
    const perguntas = padroes.perguntas.join("\n");
    for (const assunto of [/área do direito/, /o que aconteceu/, /prazo, audiência ou notificação/, /já tem advogado/, /cidade e país/]) {
      expect(perguntas).toMatch(assunto);
    }
    expect(padroes.situacoes.slice(0, SITUACOES_PADRAO_DE_HUMANO.length)).toEqual([...SITUACOES_PADRAO_DE_HUMANO]);
    expect(padroes.situacoes.length).toBe(SITUACOES_PADRAO_DE_HUMANO.length + PACOTE_ADVOCACIA.situacoesDeHumano.length);
    expect(padroes.faq).toBe(PACOTE_ADVOCACIA.faqModelo);
  });

  it("o que o pacote sugere cabe no questionário: passa no schema do rascunho como está", () => {
    const padroes = padroesDoPacote(PACOTE_ADVOCACIA);
    const conferido = rascunhoSchema.safeParse({
      negocio: { tipo_de_negocio: "advocacia" },
      qualificacao: { perguntas: [...padroes.perguntas] },
      humano: { situacoes: [...padroes.situacoes] },
      faq: { texto: padroes.faq },
    });
    expect(conferido.success, JSON.stringify(conferido.error?.issues)).toBe(true);
  });

  it("⭐ o que a empresa respondeu vence: o bloco gerado usa as perguntas dela, não as do pacote", () => {
    const comRespostas = perfilSchema.parse({
      ...respostas("advocacia"),
      qualificacao: { perguntas: ["Pergunta escolhida pela empresa?"] },
    });
    const bloco = blocoEstaEmpresa(comRespostas, CONTEXTO);
    expect(bloco).toContain("- Pergunta escolhida pela empresa?");
    for (const sugerida of PACOTE_ADVOCACIA.perguntasDeQualificacao) expect(bloco).not.toContain(sugerida);
  });
});

describe("o modelo de perguntas frequentes só tem campos a preencher", () => {
  const itens = PACOTE_ADVOCACIA.faqModelo.split("\n\n");

  it("⭐ todo item é uma pergunta seguida de um campo a preencher, sem resposta pronta, sem valor e sem promessa", () => {
    expect(itens.length).toBeGreaterThanOrEqual(5);
    for (const item of itens) {
      const [pergunta, resposta, ...sobra] = item.split("\n");
      expect(sobra).toEqual([]);
      expect(pergunta!.endsWith("?"), item).toBe(true);
      expect(resposta!.startsWith(MARCA_DE_CAMPO_A_PREENCHER), item).toBe(true);
      expect(resposta!.endsWith("]"), item).toBe(true);
    }
    expect(PACOTE_ADVOCACIA.faqModelo).not.toMatch(/R\$|€|US\$|\d+\s?(reais|euros|dias|horas)|garant|grátis|gratuit/i);
  });

  it("⭐ item que a empresa não preencheu não chega à base de conhecimento", () => {
    expect(semCamposPorPreencher(PACOTE_ADVOCACIA.faqModelo)).toBe("");
    const semPreencher = perfilSchema.parse({ ...respostas("advocacia"), faq: { texto: PACOTE_ADVOCACIA.faqModelo } });
    expect(textoDaBase(semPreencher)).toBe("");

    const preenchido = [itens[0]!.split("\n")[0], "Família e sucessões."].join("\n");
    const misto = [preenchido, ...itens.slice(1)].join("\n\n");
    expect(semCamposPorPreencher(misto)).toBe(preenchido);
    const comUmItem = perfilSchema.parse({ ...respostas("advocacia"), faq: { texto: misto } });
    expect(textoDaBase(comUmItem)).toBe(`## Perguntas frequentes e políticas\n\n${preenchido}`);
  });

  it("texto sem campo a preencher volta igual, byte a byte", () => {
    const texto = "Atendemos de segunda a sexta.\n\n\nPagamento: consulte a equipe.";
    expect(semCamposPorPreencher(texto)).toBe(texto);
  });
});

// ── atualização do pacote ────────────────────────────────────────────────────

describe("atualizar o pacote segue a regra do instalador", () => {
  const sdr = PAPEIS[0]!;
  const PACOTE_V2: PacoteDeNicho = {
    ...PACOTE_ADVOCACIA,
    versao: PACOTE_ADVOCACIA.versao + 1,
    regrasDuras: [...PACOTE_ADVOCACIA.regrasDuras, "Regra acrescentada na versão seguinte do pacote."],
  };
  const instaladoComV1 = hashDosCampos(renderizarAgente(sdr, DO_RAMO, CONTEXTO, PACOTE_ADVOCACIA));
  const geradoComV2 = hashDosCampos(renderizarAgente(sdr, DO_RAMO, CONTEXTO, PACOTE_V2));

  it("guarda de vacuidade: a versão nova do pacote muda o que o renderizador gera", () => {
    expect(geradoComV2).not.toBe(instaladoComV1);
  });

  it("⭐ agente como foi instalado: fica desatualizado, e reaplicar é seguro (nada a recusar)", () => {
    const situacao = situacaoDoAgente({ publicado: instaladoComV1, gerado: geradoComV2, instalado: instaladoComV1 });
    expect(situacao).toBe("desatualizado");
    expect(recusaAntesDeInstalar({ forcar: false, editados: [], roteador: null, canal: null })).toBeNull();
  });

  it("⭐ agente que o cliente editou: é editado à mão, e a instalação para antes de gravar, sem sobrescrever", () => {
    const editado = renderizarAgente(sdr, DO_RAMO, CONTEXTO, PACOTE_ADVOCACIA);
    const publicado = hashDosCampos({ ...editado, system_prompt: `${editado.system_prompt}\n\nFrase que o cliente acrescentou.` });
    const situacao = situacaoDoAgente({ publicado, gerado: geradoComV2, instalado: instaladoComV1 });
    expect(situacao).toBe("editado_a_mao");

    const recusa = recusaAntesDeInstalar({
      forcar: false,
      editados: [{ papel: sdr.id, agent_id: "55555555-5555-4555-8555-555555555555" }],
      roteador: null,
      canal: null,
    });
    expect(recusa?.codigo).toBe("agentes_editados_a_mao");
    expect(recusa?.status).toBe(409);
    // Só quem pede de propósito sobrescreve.
    expect(
      recusaAntesDeInstalar({ forcar: true, editados: [{ papel: sdr.id, agent_id: null }], roteador: null, canal: null }),
    ).toBeNull();
  });

  it("escolher o ramo depois de instalar também é atualização: o genérico instalado fica desatualizado, não editado", () => {
    const instaladoGenerico = hashDosCampos(renderizarAgente(sdr, GENERICO, CONTEXTO));
    const geradoDoRamo = hashDosCampos(renderizarAgente(sdr, DO_RAMO, CONTEXTO));
    expect(situacaoDoAgente({ publicado: instaladoGenerico, gerado: geradoDoRamo, instalado: instaladoGenerico })).toBe("desatualizado");
  });
});

describe("o pacote de advocacia é rascunho", () => {
  it("está marcado como não validado com cliente real, com a revisão pendente nomeada", () => {
    expect(PACOTE_ADVOCACIA.validadoComClienteReal).toBe(false);
    expect(PACOTE_ADVOCACIA.revisaoPendente).toBe("Dr. Renan");
    const fonte = readFileSync(join(PASTA_DOS_NICHOS, "advocacia.ts"), "utf8");
    expect(fonte).toMatch(/RASCUNHO\. NÃO VALIDADO COM CLIENTE REAL\. A REVISAR PELO DR\. RENAN\./);
  });
});
