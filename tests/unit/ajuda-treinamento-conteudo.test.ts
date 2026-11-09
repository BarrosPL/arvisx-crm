import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buscar, indiceDeBusca } from "@/lib/ajuda/treinamento/busca";
import {
  MODULOS_FORA_DO_ESCOPO,
  carregarTreinamento,
  type FotoDoPasso,
} from "@/lib/ajuda/treinamento/conteudo";
import { desenharDestaques } from "@/lib/ajuda/treinamento/destaques";
import { menuDoTreinamento, menuVisivel } from "@/lib/ajuda/treinamento/menu";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import { destinosDaInterface } from "@/lib/navigation/interface";

/**
 * O TREINAMENTO DO CLIENTE NÃO PODE TER PASSO EM BRANCO NEM LINK MORTO.
 *
 * A carga (`carregarTreinamento`) já falha alto; aqui cada garantia vira uma
 * linha que diz qual peça quebrou. As fotos são versionadas em
 * `public/ajuda-curso/`: o teste (a) confere no disco cada uma que o pacote cita.
 */

const dados = carregarTreinamento();
const PUBLICO = path.join(process.cwd(), "public");
const todasAsFotos: { onde: string; foto: FotoDoPasso }[] = [
  ...dados.modulos.flatMap((m) =>
    m.licoes.flatMap((l) =>
      l.passos.flatMap((p) => (p.foto ? [{ onde: `${m.id}/${l.id}/${p.id}`, foto: p.foto }] : [])),
    ),
  ),
  ...dados.nichos.flatMap((n) =>
    n.jornadas.flatMap((j) => j.cenas.map((c) => ({ onde: `${n.id}/${j.id}/${c.id}`, foto: c.foto }))),
  ),
];
const passos = dados.modulos.flatMap((m) =>
  m.licoes.flatMap((l) => l.passos.map((p) => ({ chave: `${m.id}--${l.id}--${p.id}`, p }))),
);

describe("o pacote do treinamento", () => {
  it("tem os 58 módulos, os 1.090 passos e as 26 histórias do relatório", () => {
    expect(dados.modulos).toHaveLength(58);
    expect(passos).toHaveLength(1090);
    expect(dados.nichos.flatMap((n) => n.jornadas)).toHaveLength(26);
    expect(dados.nichos.flatMap((n) => n.jornadas.flatMap((j) => j.cenas))).toHaveLength(104);
  });

  it("(a) todo arquivo de foto referenciado existe", () => {
    expect(
      existsSync(path.join(PUBLICO, "ajuda-curso")),
      "faltam as fotos em public/ajuda-curso/",
    ).toBe(true);
    const faltando = todasAsFotos
      .filter(({ foto }) => !existsSync(path.join(PUBLICO, foto.src.replace(/^\//, ""))))
      .map(({ onde, foto }) => `${onde}: ${foto.src}`);
    expect(faltando).toEqual([]);
    expect(todasAsFotos).toHaveLength(1080 + 104);
  });

  it("(b) todo passo tem foto ou aviso, nunca os dois, e os sem foto são os 10 do pacote", () => {
    const vazios = passos.filter(({ p }) => !p.foto && !p.aviso).map(({ chave }) => chave);
    const ambos = passos.filter(({ p }) => p.foto && p.aviso).map(({ chave }) => chave);
    expect(vazios).toEqual([]);
    expect(ambos).toEqual([]);
    const avisos = JSON.parse(
      readFileSync(path.join(process.cwd(), "content/ajuda-curso/AVISOS-MODULOS-TECNICOS.json"), "utf8"),
    ) as Record<string, { passos: string[] }>;
    const esperados = Object.values(avisos).flatMap((a) => a.passos).sort();
    const semFoto = passos.filter(({ p }) => !p.foto).map(({ chave }) => chave).sort();
    expect(semFoto).toEqual(esperados);
    expect(semFoto).toHaveLength(10);
  });

  it("(c) todos os links história → lição resolvem", () => {
    const quebrados = dados.nichos.flatMap((n) =>
      n.jornadas.flatMap((j) =>
        j.montagem
          .filter(
            (ref) =>
              !dados.modulos.some(
                (m) => m.id === ref.modulo && m.licoes.some((l) => l.id === ref.licao),
              ),
          )
          .map((ref) => `${n.id}/${j.id} → ${ref.modulo}/${ref.licao}`),
      ),
    );
    expect(quebrados).toEqual([]);
  });

  it("(d) a busca encontra um título conhecido, sem acento e por passo", () => {
    const indice = indiceDeBusca(dados);
    expect(buscar(indice, "Conhecendo a Inbox")[0]).toMatchObject({
      tipo: "licao",
      titulo: "Conhecendo a Inbox",
      href: "/app/ajuda/treinamento/inbox#licao-conhecendo-a-tela",
      tela: "/app/inbox",
    });
    expect(buscar(indice, "tres partes da tela").map((r) => r.href)).toContain(
      "/app/ajuda/treinamento/inbox#passo-conhecendo-a-tela-p1",
    );
    expect(buscar(indice, "advocacia").some((r) => r.tipo === "historia")).toBe(true);
    expect(buscar(indice, "x")).toEqual([]);
  });

  it("(e) nenhum módulo fora do escopo aparece", () => {
    const ids = dados.modulos.map((m) => m.id);
    for (const fora of ["marca", "extensoes", "servidor-mcp-externo", "dados-externos", "plano-e-cobranca"]) {
      expect(MODULOS_FORA_DO_ESCOPO).toContain(fora);
      expect(ids).not.toContain(fora);
    }
    const telas = dados.modulos.map((m) => m.tela);
    expect(telas).not.toContain("/app/integracao-dados");
    expect(telas.some((t) => t.startsWith("/admin/"))).toBe(false);
  });
});

describe("o menu do treinamento", () => {
  const menu = menuDoTreinamento(dados.modulos);

  it("cobre todos os módulos, nos grupos e na ordem do menu do app", () => {
    expect(menu.flatMap((g) => g.modulos)).toHaveLength(dados.modulos.length);
    expect(menu.map((g) => g.grupo)).toEqual([
      "Atendimento",
      "CRM",
      "Agente de IA",
      "Canais",
      "Análise",
      "Configurações",
    ]);
    for (const g of menu) {
      const indices = g.modulos.map((m) => NAV_CATALOG.findIndex((d) => d.href === m.tela));
      expect(indices, g.grupo).toEqual([...indices].sort((a, b) => a - b));
    }
  });

  it("segue a régua do menu lateral, não o `papel` da lição", () => {
    const telas = (role: "viewer" | "agent" | "manager" | "admin") =>
      new Set(destinosDaInterface(undefined, false, role, [], []).map((d) => d.href));
    const doAdmin = menuVisivel(menu, telas("admin")).flatMap((g) => g.modulos);
    const doAtendente = menuVisivel(menu, telas("agent")).flatMap((g) => g.modulos);
    // Atendente não vê Equipe/Conexões de admin; o admin vê tudo que o menu dele mostra.
    expect(doAtendente.length).toBeLessThan(doAdmin.length);
    expect(doAtendente.map((m) => m.id)).not.toContain("conexoes");
    expect(doAdmin.map((m) => m.id)).toContain("conexoes");
    // `papel` da lição é "admin" no Inbox, e mesmo assim o atendente o vê.
    expect(doAtendente.map((m) => m.id)).toContain("inbox");
  });

  it("a interface escolhida pela empresa recorta o treinamento junto com o menu", () => {
    const visiveis = new Set(
      destinosDaInterface({ preset: "completa", destinos: ["/app/inbox"] }, false, "admin", [], []).map(
        (d) => d.href,
      ),
    );
    const ids = menuVisivel(menu, visiveis).flatMap((g) => g.modulos.map((m) => m.id));
    expect(ids).toContain("inbox");
    expect(ids).not.toContain("funis");
  });
});

describe("os destaques desenhados por cima da foto", () => {
  it("ficam dentro da base e numerados na ordem do manifesto", () => {
    const foto = todasAsFotos.find(({ foto }) => foto.destaques.some((d) => d.tipo === "seta"))!.foto;
    const desenhos = desenharDestaques(foto.destaques, foto.largura, foto.altura);
    expect(desenhos.map((d) => d.numero)).toEqual(desenhos.map((_, i) => i + 1));
    for (const d of desenhos) {
      expect(d.selo.x).toBeGreaterThanOrEqual(0);
      expect(d.selo.x).toBeLessThanOrEqual(foto.largura);
      expect(d.selo.y).toBeGreaterThanOrEqual(0);
      expect(d.selo.y).toBeLessThanOrEqual(foto.altura);
      expect(d.seta !== null).toBe(d.tipo === "seta");
    }
  });

  it("destaque fora da foto é descartado, não vira seta para o nada", () => {
    const desenhos = desenharDestaques(
      [
        { x: 2000, y: 10, w: 50, h: 50, rotulo: "fora", tipo: "seta" },
        { x: 100, y: 100, w: 200, h: 40, rotulo: "dentro", tipo: "caixa" },
      ],
      1440,
      900,
    );
    expect(desenhos.map((d) => d.rotulo)).toEqual(["dentro"]);
    expect(desenhos[0]?.numero).toBe(1);
  });
});
