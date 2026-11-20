import { describe, expect, it } from "vitest";

import { INTENCAO_DO_PAPEL, recusaDoMovimento } from "./dono-de-etapa";
import {
  DEFINICOES_DAS_ETAPAS,
  ETAPAS_DA_EQUIPE,
  chaveDaEtapa,
  etapaSeAplica,
  mapaPelasMarcas,
  nomeNormalizado,
  papelPodeCriarEm,
  papelPodeMover,
  type ChaveDeEtapa,
} from "./etapas";
import { PAPEIS } from "./index";
import { mapearEtapasDaEquipe, posicaoDaEtapaNova } from "./instalar";
import { PAPEIS_DA_EQUIPE, type PapelId } from "./tipos";

/**
 * DONO DE ETAPA — a tabela da tarefa, como cerca.
 *
 *   novo                                → entrada do canal
 *   em_atendimento, qualificado         → Atendimento
 *   agendado, compareceu                → Agendamento
 *   proposta_enviada, em_negociacao     → Propostas
 *   ganho                               → Propostas
 *   perdido (motivo obrigatório)        → qualquer papel; reabrir só Recuperação
 */
const mover = (papel: PapelId, destino: ChaveDeEtapa | null, extra: Partial<Parameters<typeof papelPodeMover>[0]> = {}) =>
  papelPodeMover({ papel, destino, origem: "novo", negocioPerdido: false, temMotivoDaPerda: false, ...extra });

describe("dono de etapa: quem move para onde", () => {
  const TABELA: Array<[ChaveDeEtapa, PapelId[]]> = [
    ["em_atendimento", ["sdr"]],
    ["qualificado", ["sdr"]],
    ["agendado", ["agendamento"]],
    ["compareceu", ["agendamento"]],
    ["proposta_enviada", ["proposta"]],
    ["em_negociacao", ["proposta"]],
    ["ganho", ["proposta"]],
  ];

  it.each(TABELA)("%s: só o dono move", (destino, donos) => {
    for (const papel of PAPEIS_DA_EQUIPE) {
      const veredito = mover(papel, destino);
      expect(veredito.ok, `${papel} → ${destino}`).toBe(donos.includes(papel));
      if (!veredito.ok) {
        expect(veredito.motivo).toBe("etapa_de_outro_papel");
        expect(veredito.donos).toEqual(donos);
      }
    }
  });

  it("perdido: qualquer papel, e só com o motivo", () => {
    for (const papel of PAPEIS_DA_EQUIPE) {
      expect(mover(papel, "perdido", { temMotivoDaPerda: true })).toEqual({ ok: true });
      expect(mover(papel, "perdido")).toMatchObject({ ok: false, motivo: "perda_sem_motivo" });
    }
  });

  it("reabrir um negócio perdido é só de quem cuida da retomada", () => {
    for (const papel of PAPEIS_DA_EQUIPE) {
      const peloStatus = mover(papel, "em_atendimento", { negocioPerdido: true });
      const pelaEtapa = mover(papel, "em_atendimento", { origem: "perdido" });
      expect(peloStatus.ok, papel).toBe(papel === "recuperador");
      expect(pelaEtapa.ok, papel).toBe(papel === "recuperador");
      if (!peloStatus.ok) expect(peloStatus.motivo).toBe("reabrir_e_da_retomada");
    }
    // Quem reabre devolve a qualquer etapa aberta, mas não fecha como ganho.
    expect(mover("recuperador", "qualificado", { negocioPerdido: true })).toEqual({ ok: true });
    expect(mover("recuperador", "novo", { negocioPerdido: true })).toEqual({ ok: true });
    expect(mover("recuperador", "ganho", { negocioPerdido: true })).toMatchObject({ ok: false });
    // Sem reabertura, a retomada não move para a etapa dos outros.
    expect(mover("recuperador", "agendado")).toMatchObject({ ok: false, motivo: "etapa_de_outro_papel" });
  });

  it("etapa que a empresa criou por conta própria não tem dono", () => {
    for (const papel of PAPEIS_DA_EQUIPE) expect(mover(papel, null)).toEqual({ ok: true });
  });

  it("criar negócio: na entrada, ou numa etapa do próprio papel", () => {
    for (const papel of PAPEIS_DA_EQUIPE) {
      expect(papelPodeCriarEm(papel, "novo")).toEqual({ ok: true });
      expect(papelPodeCriarEm(papel, null)).toEqual({ ok: true });
      expect(papelPodeCriarEm(papel, "ganho").ok).toBe(false);
      expect(papelPodeCriarEm(papel, "perdido").ok).toBe(false);
    }
    expect(papelPodeCriarEm("agendamento", "agendado")).toEqual({ ok: true });
    expect(papelPodeCriarEm("sdr", "agendado")).toMatchObject({ ok: false, donos: ["agendamento"] });
  });

  it("a recusa diz a quem passar a vez, pelo nome que `passar_para_colega` espera", () => {
    const veredito = mover("sdr", "agendado");
    if (veredito.ok) throw new Error("deveria recusar");
    const recusa = recusaDoMovimento(veredito, "agendado");
    expect(recusa).toMatchObject({ permitido: false, motivo: "etapa_de_outro_papel", passe_para: ["agenda"] });
    expect(recusa.mensagem).toContain("passar_para_colega");
    expect(recusa.mensagem).toContain('"agenda"');
  });

  it("o nome de cada colega é a intenção do papel no roteador", () => {
    for (const papel of PAPEIS) expect(INTENCAO_DO_PAPEL[papel.id]).toBe(papel.intencao.nome);
  });
});

describe("as nove etapas", () => {
  it("todo dono é um papel que existe, e ganho e perda são coerentes com a marca", () => {
    for (const chave of ETAPAS_DA_EQUIPE) {
      const def = DEFINICOES_DAS_ETAPAS[chave];
      expect(def.chave).toBe(chave);
      expect(def.slug).toMatch(/^[a-z0-9_-]{2,40}$/);
      for (const dono of def.donos) expect(PAPEIS_DA_EQUIPE).toContain(dono);
      // O banco exige: marca `won` só em etapa de ganho, `lost` só em etapa de perda.
      expect(def.hint === "won").toBe(def.ganho);
      expect(def.hint === "lost").toBe(def.perda);
    }
  });

  it("agenda e proposta são opcionais; o resto vale sempre", () => {
    const nada = { agenda: false, proposta: false };
    expect(ETAPAS_DA_EQUIPE.filter((c) => etapaSeAplica(c, nada))).toEqual([
      "novo",
      "em_atendimento",
      "qualificado",
      "ganho",
      "perdido",
    ]);
    expect(etapaSeAplica("agendado", { agenda: true, proposta: false })).toBe(true);
    expect(etapaSeAplica("em_negociacao", { agenda: false, proposta: true })).toBe(true);
  });

  it("a chave de uma etapa sai do mapeamento, sem diferença de caixa", () => {
    const mapa = { qualificado: "AAAAAAAA-0000-4000-8000-000000000001" };
    expect(chaveDaEtapa(mapa, "aaaaaaaa-0000-4000-8000-000000000001")).toBe("qualificado");
    expect(chaveDaEtapa(mapa, "bbbbbbbb-0000-4000-8000-000000000001")).toBeNull();
    expect(chaveDaEtapa(mapa, null)).toBeNull();
  });
});

const etapa = (id: string, name: string, extra: Partial<{ agent_stage_hint: string | null; is_won: boolean; is_lost: boolean }> = {}) => ({
  id,
  name,
  agent_stage_hint: null,
  is_won: false,
  is_lost: false,
  ...extra,
});

describe("o instalador acha a etapa de cada chave", () => {
  const FUNIL = [
    etapa("e-novo", "NOVOS"),
    etapa("e-atend", "Em Atendimento"),
    etapa("e-quali", "Triagem", { agent_stage_hint: "qualified" }),
    etapa("e-negoc", "Negociação", { agent_stage_hint: "negotiating" }),
    etapa("e-ganho", "Fechou!", { is_won: true }),
    etapa("e-perda", "Não deu", { is_lost: true }),
  ];
  const empresa = { agenda: true, proposta: true };

  it("pela marca do funil, e depois pelo nome sem caixa nem acento", () => {
    const { mapa, faltam } = mapearEtapasDaEquipe({ etapas: FUNIL, escolhidas: {}, anteriores: {}, empresa });
    expect(mapa).toEqual({
      novo: "e-novo",
      em_atendimento: "e-atend",
      qualificado: "e-quali",
      // A marca `negotiating` é a da proposta, como na primeira versão.
      proposta_enviada: "e-negoc",
      ganho: "e-ganho",
      perdido: "e-perda",
    });
    // O que não existe é o que o instalador cria.
    expect(faltam).toEqual(["agendado", "compareceu", "em_negociacao"]);
  });

  it("a escolha da empresa vence a marca e o nome; o que já estava mapeado vence o nome", () => {
    const { mapa } = mapearEtapasDaEquipe({
      etapas: FUNIL,
      escolhidas: { qualificado: "e-atend" },
      anteriores: { em_atendimento: "e-novo" },
      empresa,
    });
    expect(mapa.qualificado).toBe("e-atend");
    expect(mapa.em_atendimento).toBe("e-novo");
    // Uma etapa serve a uma chave só.
    expect(new Set(Object.values(mapa)).size).toBe(Object.values(mapa).length);
  });

  it("etapa de ganho ou de perda nunca vira etapa aberta, nem o contrário", () => {
    const { mapa } = mapearEtapasDaEquipe({
      etapas: [etapa("x", "Qualificado", { is_lost: true }), etapa("y", "Perdido")],
      escolhidas: {},
      anteriores: { qualificado: "x" },
      empresa,
    });
    expect(mapa.qualificado).toBeUndefined();
    expect(mapa.perdido).toBe("x");
  });

  it("empresa sem agenda e sem proposta: essas etapas não são criadas", () => {
    const { faltam } = mapearEtapasDaEquipe({
      etapas: [],
      escolhidas: {},
      anteriores: {},
      empresa: { agenda: false, proposta: false },
    });
    expect(faltam).toEqual(["novo", "em_atendimento", "qualificado", "ganho", "perdido"]);
  });

  it("⭐ idempotente: com o que foi criado no funil, a segunda passada não cria nada", () => {
    const primeira = mapearEtapasDaEquipe({ etapas: FUNIL, escolhidas: {}, anteriores: {}, empresa });
    const criadas = primeira.faltam.map((chave) => etapa(`nova-${chave}`, DEFINICOES_DAS_ETAPAS[chave].nome));
    const mapaGravado = { ...primeira.mapa, ...Object.fromEntries(primeira.faltam.map((c) => [c, `nova-${c}`])) };
    const segunda = mapearEtapasDaEquipe({
      etapas: [...FUNIL, ...criadas],
      escolhidas: {},
      anteriores: mapaGravado,
      empresa,
    });
    expect(segunda.faltam).toEqual([]);
    expect(segunda.mapa).toEqual(mapaGravado);
    // E mesmo sem o mapeamento gravado, o nome reencontra o que foi criado.
    const semMemoria = mapearEtapasDaEquipe({ etapas: [...FUNIL, ...criadas], escolhidas: {}, anteriores: {}, empresa });
    expect(semMemoria.faltam).toEqual([]);
  });

  it("as marcas dizem o mapeamento de uma instalação anterior a ele", () => {
    expect(mapaPelasMarcas(FUNIL)).toEqual({
      qualificado: "e-quali",
      proposta_enviada: "e-negoc",
      ganho: "e-ganho",
      perdido: "e-perda",
    });
  });

  it("a etapa nova entra depois da anterior que existe; ganho e perda, no fim", () => {
    const posicoes = [
      { id: "e-novo", position: 1 },
      { id: "e-quali", position: 2 },
      { id: "e-ganho", position: 3 },
    ];
    const mapa = { novo: "e-novo", qualificado: "e-quali", ganho: "e-ganho" };
    expect(posicaoDaEtapaNova("em_atendimento", mapa, posicoes)).toBe(1.5);
    expect(posicaoDaEtapaNova("agendado", mapa, posicoes)).toBe(2.5);
    expect(posicaoDaEtapaNova("perdido", mapa, posicoes)).toBe(4);
    expect(posicaoDaEtapaNova("novo", {}, posicoes)).toBe(0);
    expect(posicaoDaEtapaNova("novo", {}, [])).toBe(1);
  });

  it("o nome é comparado sem caixa, acento nem espaço sobrando", () => {
    expect(nomeNormalizado("  Em  Negociação ")).toBe("em negociacao");
  });
});
