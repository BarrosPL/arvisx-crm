/**
 * O TREINAMENTO DO CLIENTE — a carga do pacote de conteúdo.
 *
 * ─── De onde vem ───────────────────────────────────────────────────────────
 *
 * O conteúdo (textos, manifestos de foto e avisos) chegou pronto num pacote e
 * mora em `content/ajuda-curso/`, separado de `curso/licoes/` e de
 * `curso/demonstracoes/` — esses são os 85 módulos do upstream que os testes e
 * os gates do `curso/` usam, e não podem ser sobrescritos. As fotos (~105 MB,
 * WebP) ficam versionadas em `public/ajuda-curso/` por decisão do Lucas
 * (09/11/2026) e entram na imagem do app; a base da URL pode ir para outro
 * lugar com `AJUDA_FOTOS_BASE`.
 *
 * ─── O que esta carga garante ──────────────────────────────────────────────
 *
 * Os textos passam pelos MESMOS esquemas do curso (`Modulo` e `Nicho`), e a
 * carga falha alto quando: um módulo fora do escopo do cliente aparece; a tela
 * de um módulo não existe no catálogo do menu; um passo não tem foto nem aviso;
 * uma história aponta para lição que não existe. Página de ajuda com link morto
 * ou passo em branco é pior do que página nenhuma.
 *
 * O campo `papel` da lição NÃO sai daqui: ele só diz com qual perfil a foto foi
 * tirada. Quem decide o que cada pessoa vê é o menu (ver `visibilidade`).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { Modulo, chaveDoPasso } from "@/curso/licao";
import { Nicho, validarJornadas } from "@/curso/jornada";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";

/** Base 1440×900 em que as medidas dos destaques foram tiradas. */
export interface DestaqueDaFoto {
  x: number;
  y: number;
  w: number;
  h: number;
  rotulo: string;
  tipo: "caixa" | "seta" | "numero";
}

export interface FotoDoPasso {
  src: string;
  largura: number;
  altura: number;
  destaques: DestaqueDaFoto[];
}

export interface PassoDoTreinamento {
  id: string;
  titulo: string;
  texto: string;
  dica: string | null;
  /** `null` só nos passos listados em AVISOS-MODULOS-TECNICOS.json. */
  foto: FotoDoPasso | null;
  /** O aviso que entra no lugar da foto. Nunca convive com `foto`. */
  aviso: string | null;
}

export interface LicaoDoTreinamento {
  id: string;
  titulo: string;
  objetivo: string;
  busca: string[];
  passos: PassoDoTreinamento[];
}

export interface ModuloDoTreinamento {
  id: string;
  titulo: string;
  /** Href do catálogo do menu: é por ela que a visibilidade é decidida. */
  tela: string;
  resumo: string;
  licoes: LicaoDoTreinamento[];
}

export interface CenaDaHistoria {
  id: string;
  titulo: string;
  cliente: string;
  operacao: string;
  valor: string;
  foto: FotoDoPasso;
}

export interface JornadaDaHistoria {
  id: string;
  titulo: string;
  empresa: string;
  contexto: string;
  resultado: string;
  nota: string;
  montagem: { modulo: string; licao: string; porque: string }[];
  cenas: CenaDaHistoria[];
}

export interface NichoDoTreinamento {
  id: string;
  titulo: string;
  resumo: string;
  jornadas: JornadaDaHistoria[];
}

export interface Treinamento {
  modulos: ModuloDoTreinamento[];
  nichos: NichoDoTreinamento[];
}

/**
 * Fora do escopo do cliente (ESPECIFICACAO-PARA-CLAUDE.md, seção 5). O pacote
 * já veio sem eles; a lista existe para um pacote novo não trazê-los de volta
 * em silêncio.
 */
export const MODULOS_FORA_DO_ESCOPO = [
  "marca",
  "marcas",
  "extensoes",
  "servidor-mcp-externo",
  "dados-externos",
  "plano-e-cobranca",
] as const;

export const PASTA_DO_CONTEUDO = path.join(process.cwd(), "content", "ajuda-curso");

/** Onde as fotos são servidas. Padrão: `public/ajuda-curso/` deste app. */
export function baseDasFotos(): string {
  return (process.env.AJUDA_FOTOS_BASE ?? "/ajuda-curso").replace(/\/+$/, "");
}

interface ManifestoDeFotos {
  largura: number;
  altura: number;
  capturas: Record<string, { foto: string; destaques?: DestaqueDaFoto[] }>;
}

const lerJson = (arquivo: string): unknown =>
  JSON.parse(readFileSync(path.join(PASTA_DO_CONTEUDO, arquivo), "utf8"));

function lerPasta(pasta: string): unknown[] {
  return readdirSync(path.join(PASTA_DO_CONTEUDO, pasta))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => lerJson(path.join(pasta, f)));
}

function foto(manifesto: ManifestoDeFotos, chave: string, pasta: string): FotoDoPasso | null {
  const cap = Object.hasOwn(manifesto.capturas, chave) ? manifesto.capturas[chave] : undefined;
  if (!cap) return null;
  if (!/^capturas\/[a-z0-9-]+\.webp$/.test(cap.foto)) {
    throw new Error(`treinamento: caminho de foto inválido em ${chave}: ${cap.foto}`);
  }
  return {
    src: `${baseDasFotos()}/${pasta}/${cap.foto}`,
    largura: manifesto.largura,
    altura: manifesto.altura,
    destaques: cap.destaques ?? [],
  };
}

/** Lê e valida o pacote. Sem cache: use `treinamento()` nas páginas. */
export function carregarTreinamento(): Treinamento {
  const avisos = lerJson("AVISOS-MODULOS-TECNICOS.json") as Record<
    string,
    { aviso_cliente: string; passos: string[] }
  >;
  const avisoDoPasso = new Map<string, string>();
  for (const { aviso_cliente, passos } of Object.values(avisos)) {
    for (const chave of passos) avisoDoPasso.set(chave, aviso_cliente);
  }

  const fotosDasLicoes = lerJson("licoes/capturas.json") as ManifestoDeFotos;
  const fotosDasHistorias = lerJson("historias/capturas.json") as ManifestoDeFotos;
  const telas = new Map<string, number>(NAV_CATALOG.map((d, i) => [d.href, i]));

  const brutos = lerPasta("licoes/textos").map((m) => Modulo.parse(m));
  const modulos: ModuloDoTreinamento[] = brutos
    .map((m) => {
      if ((MODULOS_FORA_DO_ESCOPO as readonly string[]).includes(m.id)) {
        throw new Error(`treinamento: o módulo ${m.id} está fora do escopo do cliente`);
      }
      if (!telas.has(m.tela)) {
        throw new Error(`treinamento: a tela ${m.tela} do módulo ${m.id} não está no menu`);
      }
      return {
        id: m.id,
        titulo: m.titulo,
        tela: m.tela,
        resumo: m.resumo,
        licoes: m.licoes.map((l) => ({
          id: l.id,
          titulo: l.titulo,
          objetivo: l.objetivo,
          busca: l.busca,
          passos: l.passos.map((p) => {
            const chave = chaveDoPasso(m.id, l.id, p.id);
            const daFoto = foto(fotosDasLicoes, chave, "licoes");
            const aviso = avisoDoPasso.get(chave) ?? null;
            if (!daFoto && !aviso) throw new Error(`treinamento: passo sem foto e sem aviso: ${chave}`);
            if (daFoto && aviso) throw new Error(`treinamento: passo com foto E aviso: ${chave}`);
            return {
              id: p.id,
              titulo: p.titulo,
              texto: p.texto,
              dica: p.dica ?? null,
              foto: daFoto,
              aviso,
            };
          }),
        })),
      };
    })
    // A ordem do menu do produto, como em curso/montar.ts.
    .sort((a, b) => (telas.get(a.tela) ?? 0) - (telas.get(b.tela) ?? 0));

  const nichosBrutos = lerPasta("historias/textos");
  validarJornadas(nichosBrutos, modulos, fotosDasHistorias.capturas);
  const nichos: NichoDoTreinamento[] = nichosBrutos.map((bruto) => {
    const n = Nicho.parse(bruto);
    return {
      id: n.id,
      titulo: n.titulo,
      resumo: n.resumo,
      jornadas: n.jornadas.map((j) => ({
        id: j.id,
        titulo: j.titulo,
        empresa: j.empresa,
        contexto: j.contexto,
        resultado: j.resultado,
        nota: j.nota,
        montagem: j.montagem,
        cenas: j.cenas.map((c) => {
          const daFoto = foto(fotosDasHistorias, c.captura, "historias");
          if (!daFoto) throw new Error(`treinamento: cena sem foto: ${c.captura}`);
          return {
            id: c.id,
            titulo: c.titulo,
            cliente: c.cliente,
            operacao: c.operacao,
            valor: c.valor,
            foto: daFoto,
          };
        }),
      })),
    };
  });

  return { modulos, nichos };
}

let emMemoria: Treinamento | null = null;
/** O pacote é estático: lido e validado uma vez por processo. */
export function treinamento(): Treinamento {
  emMemoria ??= carregarTreinamento();
  return emMemoria;
}
